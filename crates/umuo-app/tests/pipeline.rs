//! 翻译与对比流水线的端到端回归测试（假宿主 + 本地 SSE）。
//!
//! 翻译流水线（PR5）与对比（PR6）都已搬进 `umuo-app`。这些测试写在搬迁之前，钉住的是搬迁前的行为：
//! 假宿主（内存 Keychain、可改的前台应用、记下每次写回）+ 本地 SSE 桩（tokio TcpListener），
//! 从「发请求」一路测到「发给界面的事件」与「写没写回原处」。搬完这些测试原样通过，才算没改行为。
//!
//! 只用 OpenAI 协议的供应商（OpenAI、DeepSeek、Ollama），一种 SSE 格式就够；
//! 每个供应商的地址都经 `providerBaseUrls` 指到桩上，路径前缀区分是谁被请求了。

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use umuo_app::compare;
use umuo_app::event::{CompareEvent, CompareSink, Route, TranslateEvent, TranslateSink};
use umuo_app::host::FocusSource;
use umuo_app::translate::{self, Request};
use umuo_app::{AppCore, Host};
use umuo_core::error::CoreError;
use umuo_core::wire::ModelRef;

const COMPARE_LABEL: &str = "compare";
const PANEL_LABEL: &str = "panel";

// ---------------------------------------------------------------- 假宿主

/// 假宿主：内存里的 Key、可改的前台应用、记下每次写回。翻译与对比都经它读 Key。
struct Fake {
    keys: HashMap<String, String>,
    /// 前台应用的标识。测试中途改它，模拟「翻译期间用户切走了」。
    frontmost: Mutex<Option<String>>,
    /// 每次静默翻译的写回：（来源，原文，译文）。
    writes: Mutex<Vec<(FocusSource, String, String)>>,
}

impl Fake {
    fn new() -> Self {
        Self {
            keys: [("openai", "sk-openai"), ("deepseek", "sk-deepseek")]
                .into_iter()
                .map(|(id, key)| (id.to_string(), key.to_string()))
                .collect(),
            frontmost: Mutex::new(Some("pid-1".into())),
            writes: Mutex::new(Vec::new()),
        }
    }

    fn writes(&self) -> Vec<(FocusSource, String, String)> {
        self.writes.lock().unwrap().clone()
    }
}

impl Host for Fake {
    fn api_key(&self, provider_id: &str) -> Result<Option<String>, String> {
        Ok(self.keys.get(provider_id).cloned())
    }
    fn frontmost_app_name(&self) -> Option<String> {
        Some("TextEdit".into())
    }
    fn frontmost_app_token(&self) -> Option<String> {
        self.frontmost.lock().unwrap().clone()
    }
    fn write_back(&self, source: FocusSource, original: &str, text: &str) -> Result<(), String> {
        self.writes
            .lock()
            .unwrap()
            .push((source, original.to_string(), text.to_string()));
        Ok(())
    }
}

// ---------------------------------------------------------------- 事件记录

/// 收到的一个事件：请求 id、事件名、载荷的 JSON（字段名与前端收到的一致）。
#[derive(Debug, Clone)]
struct Ev {
    request_id: u64,
    name: &'static str,
    body: serde_json::Value,
}

impl Ev {
    fn str(&self, field: &str) -> &str {
        self.body[field].as_str().unwrap_or_default()
    }
}

/// 事件进通道：测试既能事后看全量，也能边跑边反应（收到第一个增量就按 Esc）。
struct Recorder(mpsc::UnboundedSender<Ev>);

impl TranslateSink for Recorder {
    fn send(&self, route: Route, event: TranslateEvent) {
        let _ = self.0.send(Ev {
            request_id: route.request_id,
            name: event.name(),
            body: serde_json::to_value(&event).unwrap(),
        });
    }
}

impl CompareSink for Recorder {
    fn send(&self, event: CompareEvent) {
        let _ = self.0.send(Ev {
            request_id: 0,
            name: event.name(),
            body: serde_json::to_value(&event).unwrap(),
        });
    }
}

fn drain(rx: &mut mpsc::UnboundedReceiver<Ev>) -> Vec<Ev> {
    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
        events.push(event);
    }
    events
}

fn names(events: &[Ev]) -> Vec<&'static str> {
    events.iter().map(|e| e.name).collect()
}

fn deltas(events: &[Ev]) -> String {
    events
        .iter()
        .filter(|e| e.name == "translate://delta")
        .map(|e| e.str("text"))
        .collect()
}

// ---------------------------------------------------------------- SSE 桩

/// 桩收到的一次请求。
#[derive(Debug, Clone)]
struct Hit {
    path: String,
    auth: Option<String>,
    body: String,
}

impl Hit {
    /// 请求体里的模型名。
    fn model(&self) -> String {
        serde_json::from_str::<serde_json::Value>(&self.body)
            .ok()
            .and_then(|v| v["model"].as_str().map(str::to_string))
            .unwrap_or_default()
    }
}

/// 桩对一次请求的回应。
enum Reply {
    /// 先等 `delay`，再按 OpenAI 的流式格式逐段发 `deltas`（段间隔 `gap`），
    /// 然后发 `[DONE]` 收尾；`error` 不为空时改为在增量之后发一条流内错误。
    Sse {
        delay: Duration,
        deltas: Vec<String>,
        gap: Duration,
        error: Option<&'static str>,
    },
    Status(u16, &'static str),
    /// `GET …/models`：本机模型探测。
    Models(&'static [&'static str]),
    /// 读完请求直接断开：传输层把它当成网络错误（等同断网）。
    Hangup,
}

fn sse(deltas: &[&str]) -> Reply {
    Reply::Sse {
        delay: Duration::ZERO,
        deltas: deltas.iter().map(|d| d.to_string()).collect(),
        gap: Duration::ZERO,
        error: None,
    }
}

type Handler = dyn Fn(&Hit) -> Reply + Send + Sync;

struct Stub {
    base: String,
    hits: Arc<Mutex<Vec<Hit>>>,
    /// 同时在途的对话请求数的峰值（分片并发用）。
    peak: Arc<AtomicUsize>,
}

impl Stub {
    async fn start(handler: impl Fn(&Hit) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(Mutex::new(Vec::new()));
        let peak = Arc::new(AtomicUsize::new(0));
        let inflight = Arc::new(AtomicUsize::new(0));
        let handler: Arc<Handler> = Arc::new(handler);
        let (hits_, peak_) = (hits.clone(), peak.clone());
        tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                let (handler, hits, peak, inflight) = (
                    handler.clone(),
                    hits_.clone(),
                    peak_.clone(),
                    inflight.clone(),
                );
                tokio::spawn(async move {
                    let Some(hit) = read_request(&socket).await else {
                        return;
                    };
                    hits.lock().unwrap().push(hit.clone());
                    let now = inflight.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    respond(socket, handler(&hit)).await;
                    inflight.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        Self { base, hits, peak }
    }

    /// 某个供应商在桩上的地址（路径前缀 = 供应商 id）。
    fn url(&self, provider_id: &str) -> String {
        format!("{}/{provider_id}", self.base)
    }

    fn hits(&self) -> Vec<Hit> {
        self.hits.lock().unwrap().clone()
    }

    fn chat_hits(&self, provider_id: &str) -> Vec<Hit> {
        let path = format!("/{provider_id}/chat/completions");
        self.hits().into_iter().filter(|h| h.path == path).collect()
    }
}

/// 读完整个请求（头 + `Content-Length` 指定的体）再回应：没读完就回写并关闭，
/// macOS 会发 RST，客户端看到的是连接错误而不是我们的回应。
async fn read_request(socket: &TcpStream) -> Option<Hit> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        if let Some(pos) = find(&buf, b"\r\n\r\n") {
            break pos + 4;
        }
        socket.readable().await.ok()?;
        match socket.try_read(&mut chunk) {
            Ok(0) => return None,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
            Err(_) => return None,
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let header = |name: &str| {
        head.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case(name)
                .then(|| value.trim().to_string())
        })
    };
    let length: usize = header("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    while buf.len() < header_end + length {
        socket.readable().await.ok()?;
        match socket.try_read(&mut chunk) {
            Ok(0) => return None,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
            Err(_) => return None,
        }
    }
    let path = head.split_whitespace().nth(1)?.to_string();
    Some(Hit {
        path,
        auth: header("authorization"),
        body: String::from_utf8_lossy(&buf[header_end..header_end + length]).to_string(),
    })
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

async fn respond(mut socket: TcpStream, reply: Reply) {
    match reply {
        Reply::Hangup => {}
        Reply::Status(code, body) => {
            let head = format!(
                "HTTP/1.1 {code} Stub\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(body.as_bytes()).await;
        }
        Reply::Models(ids) => {
            let data: Vec<_> = ids
                .iter()
                .map(|id| serde_json::json!({ "id": id }))
                .collect();
            let body = serde_json::json!({ "data": data }).to_string();
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(body.as_bytes()).await;
        }
        Reply::Sse {
            delay,
            deltas,
            gap,
            error,
        } => {
            tokio::time::sleep(delay).await;
            // 不带 Content-Length、Connection: close：正文读到连接关闭为止，与真实的流式响应一样。
            let head =
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            if socket.write_all(head.as_bytes()).await.is_err() {
                return;
            }
            for (i, delta) in deltas.iter().enumerate() {
                if i > 0 {
                    tokio::time::sleep(gap).await;
                }
                let event = serde_json::json!({ "choices": [{ "delta": { "content": delta } }] });
                if socket
                    .write_all(format!("data: {event}\n\n").as_bytes())
                    .await
                    .is_err()
                {
                    return;
                }
            }
            let tail = match error {
                Some(message) => {
                    let event = serde_json::json!({ "error": { "message": message } });
                    format!("data: {event}\n\n")
                }
                None => {
                    let stop = serde_json::json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] });
                    format!("data: {stop}\n\ndata: [DONE]\n\n")
                }
            };
            let _ = socket.write_all(tail.as_bytes()).await;
        }
    }
    let _ = socket.shutdown().await;
}

// ---------------------------------------------------------------- 环境

struct Env {
    core: Arc<AppCore>,
    fake: Arc<Fake>,
    stub: Stub,
}

impl Env {
    /// 临时配置目录 + 假宿主 + 桩。所有供应商（含两个本机的）都指到桩上：
    /// 不指的话离线回落会去探测开发机上真实的 localhost:11434。
    async fn new(handler: impl Fn(&Hit) -> Reply + Send + Sync + 'static) -> Self {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "umuo-pipeline-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // HTTP 客户端在打开时按设置建：直连，免得开发机的系统代理把 127.0.0.1 也接管了。
        std::fs::write(dir.join("settings.json"), r#"{"proxyMode":"none"}"#).unwrap();
        let fake = Arc::new(Fake::new());
        let core = Arc::new(AppCore::open(dir, fake.clone()).unwrap());
        let stub = Stub::start(handler).await;
        {
            let mut settings = core.settings.lock().unwrap();
            settings.provider_id = "openai".into();
            settings.model = "gpt-4o-mini".into();
            for id in ["openai", "deepseek", "ollama", "lmstudio"] {
                settings.provider_base_urls.insert(id.into(), stub.url(id));
            }
        }
        Self { core, fake, stub }
    }

    fn settings(&self, change: impl FnOnce(&mut umuo_app::settings::Settings)) {
        change(&mut self.core.settings.lock().unwrap());
    }

    /// 走一遍翻译流水线，返回发给界面的全部事件。
    async fn translate(&self, request: Request, guard: Option<&str>) -> Vec<Ev> {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let sink = Recorder(tx);
        let ticket = self.core.requests.begin(PANEL_LABEL);
        translate::run(
            &self.core,
            &sink,
            request,
            guard.map(str::to_string),
            ticket,
        )
        .await;
        drain(&mut rx)
    }

    fn history_count(&self) -> u32 {
        umuo_app::history::with_store(&self.core, |store| store.count()).unwrap()
    }

    fn spent(&self, provider_id: &str) -> Option<f64> {
        umuo_app::history::with_store(&self.core, |store| {
            store.usage_by_provider(store.month_start_unix()?)
        })
        .unwrap()
        .into_iter()
        .find(|row| row.provider_id == provider_id)
        .map(|row| row.cost_usd)
    }
}

/// 不会被判成单词词卡（≤3 个词）、也不会被切分的普通句子。
const SENTENCE: &str = "The quick brown fox jumps over the lazy dog.";

fn not_found() -> Reply {
    Reply::Status(404, r#"{"error":{"message":"not found"}}"#)
}

fn server_error() -> Reply {
    Reply::Status(500, r#"{"error":{"message":"upstream exploded"}}"#)
}

// ---------------------------------------------------------------- 翻译流水线

#[tokio::test]
async fn a_plain_translation_streams_start_deltas_done_and_records_history() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => sse(&["敏捷的", "棕色狐狸"]),
        _ => not_found(),
    })
    .await;

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(
        names(&events),
        [
            "translate://start",
            "translate://delta",
            "translate://delta",
            "translate://done"
        ]
    );
    assert_eq!(events[0].str("provider"), "OpenAI");
    assert_eq!(events[0].str("mode"), "selection");
    assert_eq!(deltas(&events), "敏捷的棕色狐狸");
    let done = &events[3];
    assert_eq!(done.str("model"), "gpt-4o-mini");
    assert_eq!(done.body["replaced"], false);
    assert_eq!(done.body["offline"], false);
    let hits = env.stub.chat_hits("openai");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].auth.as_deref(), Some("Bearer sk-openai"));
    assert_eq!(env.history_count(), 1);
}

#[tokio::test]
async fn failover_mid_stream_restarts_the_same_request_on_the_next_candidate() {
    // 首选流出半句后流内报错：前端要先收到同一个 id 的第二个 start 把半句清掉，
    // 再收到备用模型的译文（start 的供应商也要换成真正在翻的那家）。
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => Reply::Sse {
            delay: Duration::ZERO,
            deltas: vec!["半句".into()],
            gap: Duration::ZERO,
            error: Some("model overloaded"),
        },
        "/deepseek/chat/completions" => sse(&["完整译文"]),
        _ => not_found(),
    })
    .await;
    env.settings(|s| {
        s.fallback_models = vec![ModelRef {
            provider_id: "deepseek".into(),
            model: "deepseek-chat".into(),
        }]
    });

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(
        names(&events),
        [
            "translate://start",
            "translate://delta",
            "translate://start",
            "translate://delta",
            "translate://done"
        ]
    );
    let id = events[0].request_id;
    assert!(events.iter().all(|e| e.request_id == id), "同一次请求");
    assert_eq!(events[0].str("provider"), "OpenAI");
    assert_eq!(events[2].str("provider"), "DeepSeek");
    assert_eq!(events[2].str("model"), "deepseek-chat");
    assert_eq!(
        events[2].str("text"),
        SENTENCE,
        "重发的 start 带着同一段原文"
    );
    assert_eq!(events[3].str("text"), "完整译文");
    assert_eq!(events[4].str("model"), "deepseek-chat", "结果卡片说真话");
    let hits = env.stub.chat_hits("deepseek");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].auth.as_deref(), Some("Bearer sk-deepseek"));
    assert_eq!(hits[0].model(), "deepseek-chat");
}

#[tokio::test]
async fn failover_after_an_http_error_also_restarts() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => server_error(),
        "/deepseek/chat/completions" => sse(&["译文"]),
        _ => not_found(),
    })
    .await;
    env.settings(|s| {
        s.fallback_models = vec![ModelRef {
            provider_id: "deepseek".into(),
            model: "deepseek-chat".into(),
        }]
    });

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(
        names(&events),
        [
            "translate://start",
            "translate://start",
            "translate://delta",
            "translate://done"
        ]
    );
    assert_eq!(events[1].str("provider"), "DeepSeek");
}

#[tokio::test]
async fn esc_stops_the_stream_and_no_delta_arrives_after_it() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => Reply::Sse {
            delay: Duration::ZERO,
            deltas: (0..20).map(|i| format!("片{i}")).collect(),
            gap: Duration::from_millis(300),
            error: None,
        },
        _ => not_found(),
    })
    .await;

    let (tx, mut rx) = mpsc::unbounded_channel();
    let sink = Recorder(tx);
    let ticket = env.core.requests.begin(PANEL_LABEL);
    let started = Instant::now();
    let mut seen = Vec::new();
    let pipeline = translate::run(&env.core, &sink, Request::selection(SENTENCE), None, ticket);
    let esc = async {
        // 收到第一个增量就按 Esc（命令层的 cancel_translation 调的就是这个）。
        while let Some(event) = rx.recv().await {
            let first_delta = event.name == "translate://delta";
            seen.push(event);
            if first_delta {
                env.core.requests.cancel(PANEL_LABEL);
                break;
            }
        }
    };
    tokio::join!(pipeline, esc);
    seen.extend(drain(&mut rx));

    assert!(
        started.elapsed() < Duration::from_secs(2),
        "取消要立刻生效，不能等流跑完"
    );
    assert_eq!(
        names(&seen),
        [
            "translate://start",
            "translate://delta",
            "translate://error"
        ]
    );
    assert_eq!(seen[2].str("message"), CoreError::Cancelled.to_string());
    assert_eq!(env.history_count(), 0, "取消的不进历史");
}

#[tokio::test]
async fn going_over_the_monthly_limit_switches_to_another_provider_with_its_default_model() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/deepseek/chat/completions" => sse(&["译文"]),
        _ => not_found(),
    })
    .await;
    env.settings(|s| {
        s.monthly_limits = vec![umuo_core::budget::ProviderLimit {
            provider_id: "openai".into(),
            limit_usd: 1.0,
            extra: Default::default(),
        }];
        s.limit_action = umuo_core::budget::LimitAction::Failover;
    });
    umuo_app::history::record_usage(
        &env.core,
        "openai",
        "gpt-4o-mini",
        umuo_core::wire::TokenUsage::default(),
        Some(2.0),
    );

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(
        names(&events),
        ["translate://start", "translate://delta", "translate://done"]
    );
    assert_eq!(events[0].str("provider"), "DeepSeek");
    assert_eq!(events[0].str("model"), "deepseek-chat");
    assert!(
        events[2].body["warning"].is_string(),
        "要告诉用户换了供应商"
    );
    assert!(
        env.stub.chat_hits("openai").is_empty(),
        "超限的那家一次都不请求"
    );
    let hits = env.stub.chat_hits("deepseek");
    assert_eq!(hits.len(), 1);
    assert_eq!(
        hits[0].model(),
        "deepseek-chat",
        "用新供应商的默认模型，不沿用旧模型名"
    );
}

#[tokio::test]
async fn a_network_failure_falls_back_to_the_local_model_and_marks_it_offline() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => Reply::Hangup,
        "/ollama/models" => Reply::Models(&["qwen2.5:7b"]),
        "/ollama/chat/completions" => sse(&["本机译文"]),
        _ => not_found(),
    })
    .await;

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(
        names(&events),
        [
            "translate://start",
            "translate://start",
            "translate://delta",
            "translate://done"
        ]
    );
    assert_eq!(events[1].str("provider"), "Ollama（本机）");
    assert_eq!(events[1].str("model"), "qwen2.5:7b");
    assert_eq!(events[3].body["offline"], true);
    assert_eq!(env.stub.chat_hits("ollama")[0].model(), "qwen2.5:7b");
}

#[tokio::test]
async fn the_local_fallback_tries_lm_studio_when_ollama_has_no_models() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => Reply::Hangup,
        "/ollama/models" => Reply::Models(&[]),
        "/lmstudio/models" => Reply::Models(&["local-model"]),
        "/lmstudio/chat/completions" => sse(&["本机译文"]),
        _ => not_found(),
    })
    .await;

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(events[1].str("provider"), "LM Studio（本机）");
    assert_eq!(events.last().unwrap().body["offline"], true);
}

#[tokio::test]
async fn a_non_network_failure_does_not_probe_the_local_models() {
    // 401 换成本机也解决不了，不该标「离线」也不该多等一轮探测。
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => {
            Reply::Status(401, r#"{"error":{"message":"Incorrect API key provided"}}"#)
        }
        _ => not_found(),
    })
    .await;

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(names(&events), ["translate://start", "translate://error"]);
    assert!(env.stub.hits().iter().all(|h| !h.path.ends_with("/models")));
}

/// 每段约 1 万字符的英文：两段放不进一片（拉丁字符的预算约 1.6 万），所以一段一片。
fn long_text(paragraphs: usize) -> String {
    (0..paragraphs)
        .map(|i| {
            format!(
                "PARA{i} {}",
                "lorem ipsum dolor sit amet ".repeat(380).trim_end()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// 从请求体里认出这是第几段。
fn paragraph_of(hit: &Hit) -> usize {
    let at = hit.body.find("PARA").expect("分片请求带着原文");
    hit.body[at + 4..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap()
}

#[tokio::test]
async fn long_text_is_split_into_concurrent_chunks_and_merged_in_order() {
    const PIECES: usize = 6;
    // 越靠前的分片回得越慢：完成顺序与原文顺序相反，输出仍要按原文顺序。
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => {
            let index = paragraph_of(hit);
            Reply::Sse {
                delay: Duration::from_millis(80 * (PIECES - index) as u64),
                deltas: vec![format!("T{index}")],
                gap: Duration::ZERO,
                error: None,
            }
        }
        _ => not_found(),
    })
    .await;

    let events = env
        .translate(Request::selection(long_text(PIECES)), None)
        .await;

    assert_eq!(events.first().unwrap().name, "translate://start");
    assert_eq!(events.last().unwrap().name, "translate://done");
    assert_eq!(env.stub.chat_hits("openai").len(), PIECES, "一段一片");
    let expected: Vec<String> = (0..PIECES).map(|i| format!("T{i}")).collect();
    assert_eq!(
        deltas(&events),
        expected.join("\n\n"),
        "按原文顺序、还原段间空行"
    );
    assert_eq!(
        env.stub.peak.load(Ordering::SeqCst),
        umuo_core::transport::MAX_CONCURRENT_CHUNKS,
        "并发，但不超过上限"
    );
    assert_eq!(env.history_count(), 1);
}

#[tokio::test]
async fn a_failed_chunk_batch_is_resent_whole_to_the_next_candidate_after_a_restart() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => server_error(),
        "/deepseek/chat/completions" => sse(&[&format!("D{}", paragraph_of(hit))]),
        _ => not_found(),
    })
    .await;
    env.settings(|s| {
        s.fallback_models = vec![ModelRef {
            provider_id: "deepseek".into(),
            model: "deepseek-chat".into(),
        }]
    });

    let events = env.translate(Request::selection(long_text(3)), None).await;

    assert_eq!(
        names(&events)
            .iter()
            .filter(|n| **n == "translate://start")
            .count(),
        2
    );
    assert_eq!(events.last().unwrap().str("model"), "deepseek-chat");
    assert_eq!(env.stub.chat_hits("deepseek").len(), 3);
}

fn silent(text: &str) -> Request {
    Request::silent_replace(text, FocusSource::WholeField)
}

#[tokio::test]
async fn silent_replace_writes_back_only_after_success() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => sse(&["敏捷的棕色狐狸"]),
        _ => not_found(),
    })
    .await;

    let events = env.translate(silent(SENTENCE), Some("pid-1")).await;

    assert_eq!(events[0].str("mode"), "silentReplace");
    assert_eq!(events.last().unwrap().name, "translate://done");
    assert_eq!(events.last().unwrap().body["replaced"], true);
    assert_eq!(
        env.fake.writes(),
        [(
            FocusSource::WholeField,
            SENTENCE.to_string(),
            "敏捷的棕色狐狸".to_string()
        )]
    );
}

#[tokio::test]
async fn silent_replace_never_touches_the_document_when_translation_fails() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => server_error(),
        _ => not_found(),
    })
    .await;

    let events = env.translate(silent(SENTENCE), Some("pid-1")).await;

    assert_eq!(names(&events), ["translate://start", "translate://error"]);
    assert!(env.fake.writes().is_empty(), "失败时不修改原文（PRD §5.4）");
}

#[tokio::test]
async fn silent_replace_refuses_to_write_when_the_frontmost_app_changed() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => sse(&["译文"]),
        _ => not_found(),
    })
    .await;
    // 翻译期间用户切到了别的应用。
    *env.fake.frontmost.lock().unwrap() = Some("pid-2".into());

    let events = env.translate(silent(SENTENCE), Some("pid-1")).await;

    assert_eq!(events.last().unwrap().name, "translate://error");
    assert_eq!(
        events.last().unwrap().str("message"),
        CoreError::WriteTargetChanged.to_string()
    );
    assert!(env.fake.writes().is_empty(), "不能把译文打进别的应用");
    assert!(env.spent("openai").is_some(), "厂商已经计费，钱照样进账本");
    assert_eq!(env.history_count(), 0);
}

#[tokio::test]
async fn silent_replace_also_refuses_when_the_frontmost_app_can_no_longer_be_read() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => sse(&["译文"]),
        _ => not_found(),
    })
    .await;
    *env.fake.frontmost.lock().unwrap() = None;

    let events = env.translate(silent(SENTENCE), Some("pid-1")).await;

    assert_eq!(events.last().unwrap().name, "translate://error");
    assert!(env.fake.writes().is_empty());
}

// ---------------------------------------------------------------- 对比

#[tokio::test]
async fn compare_streams_every_card_by_index_and_reports_failures_on_their_own_card() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => sse(&["甲", "乙"]),
        "/deepseek/chat/completions" => server_error(),
        _ => not_found(),
    })
    .await;
    env.settings(|s| s.compare_providers = vec!["openai".into(), "deepseek".into()]);

    let (tx, mut rx) = mpsc::unbounded_channel();
    let ticket = env.core.requests.begin(COMPARE_LABEL);
    let run_id = ticket.id;
    compare::run(&env.core, &Recorder(tx), SENTENCE.to_string(), ticket).await;
    let events = drain(&mut rx);

    assert_eq!(events[0].name, "compare://start");
    let cards = events[0].body["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 2);
    assert_eq!(cards[0]["providerId"], "openai");
    assert_eq!(cards[1]["providerId"], "deepseek");
    assert!(events.iter().all(|e| e.body["runId"] == run_id));

    let of = |index: usize| -> Vec<&Ev> {
        events[1..]
            .iter()
            .filter(|e| e.body["index"] == index)
            .collect()
    };
    let first: Vec<_> = of(0).iter().map(|e| e.name).collect();
    assert_eq!(
        first,
        ["compare://delta", "compare://delta", "compare://done"]
    );
    let text: String = of(0)
        .iter()
        .filter(|e| e.name == "compare://delta")
        .map(|e| e.str("text"))
        .collect();
    assert_eq!(text, "甲乙");
    let second: Vec<_> = of(1).iter().map(|e| e.name).collect();
    assert_eq!(second, ["compare://error"], "失败只落在自己那张卡上");
    assert_eq!(env.history_count(), 1, "只有成功的卡进历史");
}

#[tokio::test]
async fn compare_with_no_usable_model_sends_a_window_level_notice() {
    let env = Env::new(|_| not_found()).await;
    // 只勾了一个没有 Key 的供应商。
    env.settings(|s| s.compare_providers = vec!["anthropic".into()]);

    let (tx, mut rx) = mpsc::unbounded_channel();
    let ticket = env.core.requests.begin(COMPARE_LABEL);
    compare::run(&env.core, &Recorder(tx), SENTENCE.to_string(), ticket).await;

    assert_eq!(names(&drain(&mut rx)), ["compare://notice"]);
    assert!(env.stub.hits().is_empty());
}

#[tokio::test]
async fn esc_mid_compare_stops_every_lane_at_once() {
    // N 路共用一张凭据上的取消标志：按一次 Esc，每一路都要停，而不是只停第一路、
    // 其余几路在看不见的地方继续计费。
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" | "/deepseek/chat/completions" => Reply::Sse {
            delay: Duration::ZERO,
            deltas: (0..20).map(|i| format!("片{i}")).collect(),
            gap: Duration::from_millis(300),
            error: None,
        },
        _ => not_found(),
    })
    .await;
    // 显式清单可以对比同一家的两个模型，于是这个桩上能凑出三路。
    env.settings(|s| {
        s.scene_models.compare = [
            ("openai", "gpt-4o"),
            ("openai", "gpt-4o-mini"),
            ("deepseek", "deepseek-chat"),
        ]
        .into_iter()
        .map(|(provider_id, model)| ModelRef {
            provider_id: provider_id.into(),
            model: model.into(),
        })
        .collect();
    });
    const LANES: usize = 3;

    let (tx, mut rx) = mpsc::unbounded_channel();
    let sink = Recorder(tx);
    let ticket = env.core.requests.begin(COMPARE_LABEL);
    let started = Instant::now();
    let mut seen = Vec::new();
    let pipeline = compare::run(&env.core, &sink, SENTENCE.to_string(), ticket);
    let esc = async {
        // 每一路都流出了增量（确实是「中途」）再按 Esc。
        let mut streaming = [false; LANES];
        while let Some(event) = rx.recv().await {
            if event.name == "compare://delta" {
                streaming[event.body["index"].as_u64().unwrap() as usize] = true;
            }
            seen.push(event);
            if streaming.iter().all(|&s| s) {
                env.core.requests.cancel(COMPARE_LABEL);
                break;
            }
        }
    };
    tokio::join!(pipeline, esc);
    seen.extend(drain(&mut rx));

    assert!(
        started.elapsed() < Duration::from_secs(2),
        "取消要立刻落到每一路，不能等流跑完"
    );
    assert_eq!(seen[0].name, "compare://start");
    assert_eq!(seen[0].body["cards"].as_array().unwrap().len(), LANES);
    for index in 0..LANES {
        let lane: Vec<&Ev> = seen[1..]
            .iter()
            .filter(|e| e.body["index"] == index)
            .collect();
        let last = lane.last().unwrap();
        assert_eq!(last.name, "compare://error", "第 {index} 路：{lane:?}");
        assert_eq!(last.str("message"), CoreError::Cancelled.to_string());
        assert!(
            lane[..lane.len() - 1]
                .iter()
                .all(|e| e.name == "compare://delta"),
            "第 {index} 路取消前只有增量：{lane:?}"
        );
    }
    assert_eq!(env.history_count(), 0, "取消的不进历史");
}
