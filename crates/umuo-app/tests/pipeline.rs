//! 翻译流水线的端到端回归测试（假宿主 + 本地 SSE）。
//!
//! 流水线在 umuo-app 中执行，测试覆盖应用编排与协议行为：
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
use umuo_app::event::{Route, TranslateEvent, TranslateSink};
use umuo_app::host::FocusSource;
use umuo_app::translate::{self, Request};
use umuo_app::{AppCore, Host};
use umuo_core::error::CoreError;

const PANEL_LABEL: &str = "panel";

// ---------------------------------------------------------------- 假宿主

/// 假宿主：内存里的 Key、可改的前台应用、记下每次写回。翻译请求经它读 Key。
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
    /// 万一有代码去探测本机模型，打到的是桩而不是开发机上真实的 localhost:11434，测试能看见。
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
async fn retired_presets_and_glossaries_do_not_influence_any_translation_path() {
    let mut env = Env::new(|_| sse(&["译文"])).await;
    let retired = serde_json::json!({
        "id": "old-custom", "instruction": "RETIRED_INSTRUCTION {app_name}",
        "temperature": 1.9, "explain": true,
        "fewShot": [{"source": "RETIRED_EXAMPLE", "target": "RETIRED_ANSWER"}],
        "future": {"keep": true}
    });
    env.settings(|settings| {
        settings.style_id = "old-custom".into();
        settings.custom_styles = vec![retired.clone()];
    });
    let glossary = r#"{"lists":[{"id":"old","entries":[{"source":"hello","target":"RETIRED_TERM"}]}],"future":true}"#;
    let path = env.core.config_dir.join("glossaries.json");
    std::fs::write(&path, glossary).unwrap();
    env.core
        .settings
        .lock()
        .unwrap()
        .save(&env.core.config_dir)
        .unwrap();
    env.core = Arc::new(AppCore::open(env.core.config_dir.clone(), env.fake.clone()).unwrap());
    for text in [SENTENCE.to_string(), "hello".to_string(), long_text(2)] {
        let events = env.translate(Request::selection(text), None).await;
        assert_eq!(events.last().unwrap().name, "translate://done");
    }
    let hits = env.stub.chat_hits("openai");
    assert_eq!(hits.len(), 4, "普通句子、词卡、两片长文都执行成功");
    for hit in hits {
        assert!(!hit.body.contains("RETIRED_"), "旧规则不得进入请求");
        let body: serde_json::Value = serde_json::from_str(&hit.body).unwrap();
        let expected = if body.get("response_format").is_some() {
            0.3
        } else {
            0.2
        };
        assert!((body["temperature"].as_f64().unwrap() - expected).abs() < 1e-6);
    }
    let records = umuo_app::ops::history_query(&env.core, None, 10, 0).unwrap();
    assert_eq!(records.len(), 3);
    assert!(records.iter().all(|row| row.style_id == "standard"));
    assert_eq!(std::fs::read_to_string(path).unwrap(), glossary);
    let settings = env.core.settings.lock().unwrap();
    assert_eq!(settings.style_id, "old-custom");
    assert_eq!(settings.custom_styles, vec![retired]);
}

#[tokio::test]
async fn a_corrupt_retired_glossary_is_untouched_on_startup_and_translation() {
    let mut env = Env::new(|_| sse(&["译文"])).await;
    let path = env.core.config_dir.join("glossaries.json");
    let corrupt = "{retired and broken";
    std::fs::write(&path, corrupt).unwrap();
    // 重新打开同一个目录，验证启动不会解析、备份或覆盖退役文件。
    env.core
        .settings
        .lock()
        .unwrap()
        .save(&env.core.config_dir)
        .unwrap();
    env.core = Arc::new(AppCore::open(env.core.config_dir.clone(), env.fake.clone()).unwrap());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), corrupt);
    let events = env.translate(Request::selection(SENTENCE), None).await;
    assert_eq!(events.last().unwrap().name, "translate://done");
    assert_eq!(std::fs::read_to_string(path).unwrap(), corrupt);
}

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
    assert!(done.body.get("costUsd").is_none(), "费用已退出事件");
    let hits = env.stub.chat_hits("openai");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].auth.as_deref(), Some("Bearer sk-openai"));
    assert_eq!(env.history_count(), 1);
}

/// 第三批精简前的旧配置：备用顺序、分场景模型、月度上限与「超限自动切换」。
/// 它们只作为未知字段保留，不得再让请求换到别的供应商或模型。
fn with_retired_routing(settings: &mut umuo_app::settings::Settings) {
    let deepseek = serde_json::json!({ "providerId": "deepseek", "model": "deepseek-chat" });
    settings.extra.insert(
        "fallbackModels".into(),
        serde_json::json!([deepseek.clone()]),
    );
    settings.extra.insert(
        "sceneModels".into(),
        serde_json::json!({ "selection": deepseek, "compare": [] }),
    );
    settings.extra.insert(
        "monthlyLimits".into(),
        serde_json::json!([{ "providerId": "openai", "limitUsd": 0.0 }]),
    );
    settings
        .extra
        .insert("limitAction".into(), serde_json::json!("failover"));
}

#[tokio::test]
async fn retired_routing_settings_never_move_a_request_to_another_model() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => sse(&["译文"]),
        "/deepseek/chat/completions" => sse(&["不该出现"]),
        _ => not_found(),
    })
    .await;
    env.settings(with_retired_routing);

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(
        names(&events),
        ["translate://start", "translate://delta", "translate://done"]
    );
    assert_eq!(events[0].str("provider"), "OpenAI", "只用当前模型");
    assert!(events[2].body["warning"].is_null(), "没有预算提醒");
    assert_eq!(env.stub.chat_hits("openai")[0].model(), "gpt-4o-mini");
    assert!(env.stub.chat_hits("deepseek").is_empty());
}

#[tokio::test]
async fn a_failure_is_reported_as_is_without_trying_another_model() {
    // 流出半句后流内报错、或直接 HTTP 失败：都把错误交给用户，由用户重试或换模型。
    for openai in [
        Reply::Sse {
            delay: Duration::ZERO,
            deltas: vec!["半句".into()],
            gap: Duration::ZERO,
            error: Some("model overloaded"),
        },
        server_error(),
    ] {
        let reply = std::sync::Mutex::new(Some(openai));
        let env = Env::new(move |hit| match hit.path.as_str() {
            "/openai/chat/completions" => reply.lock().unwrap().take().unwrap_or_else(server_error),
            "/deepseek/chat/completions" => sse(&["不该出现"]),
            _ => not_found(),
        })
        .await;
        env.settings(with_retired_routing);

        let events = env.translate(Request::selection(SENTENCE), None).await;

        assert_eq!(events.last().unwrap().name, "translate://error");
        let id = events[0].request_id;
        assert!(events.iter().all(|e| e.request_id == id), "同一次请求");
        assert_eq!(
            names(&events)
                .iter()
                .filter(|n| **n == "translate://start")
                .count(),
            1,
            "不换候选，也就不重发 start"
        );
        assert_eq!(env.stub.chat_hits("openai").len(), 1);
        assert!(env.stub.chat_hits("deepseek").is_empty());
        assert_eq!(env.history_count(), 0);
    }
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
async fn a_network_failure_is_reported_without_probing_local_models() {
    // 本地自动回落已退出：断网就如实报错，不去探测 Ollama / LM Studio，也不标「离线」。
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => Reply::Hangup,
        "/ollama/models" => Reply::Models(&["qwen2.5:7b"]),
        "/ollama/chat/completions" => sse(&["本机译文"]),
        _ => not_found(),
    })
    .await;

    let events = env.translate(Request::selection(SENTENCE), None).await;

    assert_eq!(names(&events), ["translate://start", "translate://error"]);
    assert!(env
        .stub
        .hits()
        .iter()
        .all(|h| !h.path.starts_with("/ollama")));
    assert!(env
        .stub
        .hits()
        .iter()
        .all(|h| !h.path.starts_with("/lmstudio")));
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
async fn a_failed_chunk_batch_is_reported_without_resending_it_elsewhere() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => server_error(),
        "/deepseek/chat/completions" => sse(&[&format!("D{}", paragraph_of(hit))]),
        _ => not_found(),
    })
    .await;
    env.settings(with_retired_routing);

    let events = env.translate(Request::selection(long_text(3)), None).await;

    assert_eq!(events.last().unwrap().name, "translate://error");
    assert_eq!(
        names(&events)
            .iter()
            .filter(|n| **n == "translate://start")
            .count(),
        1
    );
    assert!(env.stub.chat_hits("deepseek").is_empty());
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

#[tokio::test]
async fn silent_replace_never_writes_back_if_cancelled_just_as_stream_completes() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => sse(&["完整译文"]),
        _ => not_found(),
    })
    .await;

    struct CancelOnDelta {
        core: Arc<AppCore>,
        events: Mutex<Vec<Ev>>,
    }
    impl TranslateSink for CancelOnDelta {
        fn send(&self, route: Route, event: TranslateEvent) {
            if event.name() == "translate://delta" {
                self.core.requests.cancel(PANEL_LABEL);
            }
            self.events.lock().unwrap().push(Ev {
                request_id: route.request_id,
                name: event.name(),
                body: serde_json::to_value(&event).unwrap(),
            });
        }
    }

    let sink = CancelOnDelta {
        core: env.core.clone(),
        events: Mutex::new(Vec::new()),
    };
    let ticket = env.core.requests.begin(PANEL_LABEL);
    translate::run(
        &env.core,
        &sink,
        silent(SENTENCE),
        Some("pid-1".into()),
        ticket,
    )
    .await;

    let events = sink.events.lock().unwrap().clone();
    assert_eq!(events.last().unwrap().name, "translate://error");
    assert_eq!(
        events.last().unwrap().str("message"),
        CoreError::Cancelled.to_string()
    );
    assert!(
        env.fake.writes().is_empty(),
        "流完成瞬间取消也绝不能写回原文"
    );
    assert_eq!(env.history_count(), 0);
}

#[tokio::test]
async fn per_app_target_ignores_blank_overrides_and_trims_valid_ones() {
    let env = Env::new(|hit| match hit.path.as_str() {
        "/openai/chat/completions" => sse(&["译文"]),
        _ => not_found(),
    })
    .await;
    env.settings(|s| {
        s.target_lang_mode = "perApp".into();
    });

    let blank = Request::with_overrides(
        SENTENCE,
        translate::Mode::Compose,
        translate::Overrides {
            source_lang: Some("   ".into()),
            target_lang: Some("   ".into()),
        },
    );
    let _ = env.translate(blank, None).await;
    assert!(
        env.core
            .settings
            .lock()
            .unwrap()
            .app_target_langs
            .is_empty(),
        "空白覆盖不能写入 app_target_langs"
    );

    let chosen = Request::with_overrides(
        SENTENCE,
        translate::Mode::Compose,
        translate::Overrides {
            source_lang: None,
            target_lang: Some(" ja ".into()),
        },
    );
    let _ = env.translate(chosen, None).await;
    assert_eq!(
        env.core
            .settings
            .lock()
            .unwrap()
            .app_target_langs
            .get("TextEdit")
            .map(String::as_str),
        Some("ja")
    );
}
