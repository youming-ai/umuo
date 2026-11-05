//! 语音后处理的回归测试：假宿主 + 本地 SSE 桩，不访问真实供应商。
//!
//! 桩只实现 OpenAI 兼容的流式格式，够覆盖「请求里带了什么指令」与
//! 成功、失败、空结果、原样回声、取消这几条确定行为。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use umuo_core::error::CoreError;

use super::*;
use crate::host::{FocusSource, Host};

// ---------------------------------------------------------------- 假宿主

/// 内存里的 Key；语音后处理不该读前台应用、更不该写回。
struct Fake {
    keys: HashMap<String, String>,
}

impl Host for Fake {
    fn api_key(&self, provider_id: &str) -> Result<Option<String>, String> {
        Ok(self.keys.get(provider_id).cloned())
    }
    fn frontmost_app_name(&self) -> Option<String> {
        None
    }
    fn frontmost_app_token(&self) -> Option<String> {
        None
    }
    fn write_back(&self, _: FocusSource, _: &str, _: &str) -> Result<(), String> {
        panic!("语音后处理不写回，交付由会话层负责")
    }
}

// ---------------------------------------------------------------- SSE 桩

/// 桩收到的一次请求（只关心路径与请求体）。
#[derive(Debug, Clone)]
struct Hit {
    path: String,
    body: serde_json::Value,
}

impl Hit {
    /// 请求里的系统指令与 user 消息（OpenAI 兼容格式）。
    fn message(&self, role: &str) -> String {
        self.body["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|m| m["role"] == role)
            .and_then(|m| m["content"].as_str())
            .unwrap_or_default()
            .to_string()
    }
}

enum Reply {
    /// 按 OpenAI 流式格式逐段发 `deltas`（段间隔 `gap`），然后 `[DONE]`。
    Sse {
        deltas: Vec<String>,
        gap: Duration,
    },
    Status(u16, &'static str),
}

fn sse(deltas: &[&str]) -> Reply {
    Reply::Sse {
        deltas: deltas.iter().map(|d| d.to_string()).collect(),
        gap: Duration::ZERO,
    }
}

struct Stub {
    base: String,
    hits: Arc<Mutex<Vec<Hit>>>,
}

impl Stub {
    async fn start(handler: impl Fn(&Hit) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(Mutex::new(Vec::new()));
        let handler = Arc::new(handler);
        let hits_ = hits.clone();
        tokio::spawn(async move {
            while let Ok((socket, _)) = listener.accept().await {
                let (handler, hits) = (handler.clone(), hits_.clone());
                tokio::spawn(async move {
                    let Some(hit) = read_request(&socket).await else {
                        return;
                    };
                    hits.lock().unwrap().push(hit.clone());
                    respond(socket, handler(&hit)).await;
                });
            }
        });
        Self { base, hits }
    }

    fn hits(&self) -> Vec<Hit> {
        self.hits.lock().unwrap().clone()
    }
}

/// 读完头与 `Content-Length` 指定的体再回应，免得 macOS 发 RST。
async fn read_request(socket: &TcpStream) -> Option<Hit> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut read_more = |buf: &mut Vec<u8>| -> Option<bool> {
        match socket.try_read(&mut chunk) {
            Ok(0) => None,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                Some(true)
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Some(false),
            Err(_) => None,
        }
    };
    let header_end = loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        socket.readable().await.ok()?;
        read_more(&mut buf)?;
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let length: usize = head
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse().ok())?
        })
        .unwrap_or(0);
    while buf.len() < header_end + length {
        socket.readable().await.ok()?;
        read_more(&mut buf)?;
    }
    Some(Hit {
        path: head.split_whitespace().nth(1)?.to_string(),
        body: serde_json::from_slice(&buf[header_end..header_end + length]).unwrap_or_default(),
    })
}

async fn respond(mut socket: TcpStream, reply: Reply) {
    match reply {
        Reply::Status(code, body) => {
            let head = format!(
                "HTTP/1.1 {code} Stub\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = socket.write_all(head.as_bytes()).await;
            let _ = socket.write_all(body.as_bytes()).await;
        }
        Reply::Sse { deltas, gap } => {
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
            let stop = serde_json::json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] });
            let _ = socket
                .write_all(format!("data: {stop}\n\ndata: [DONE]\n\n").as_bytes())
                .await;
        }
    }
    let _ = socket.shutdown().await;
}

// ---------------------------------------------------------------- 环境

struct Env {
    core: AppCore,
    stub: Stub,
}

impl Env {
    /// 临时配置目录 + 假宿主 + 桩；当前供应商 OpenAI，地址指到桩上。
    async fn new(handler: impl Fn(&Hit) -> Reply + Send + Sync + 'static) -> Self {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "umuo-voice-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // 直连：免得开发机的系统代理把 127.0.0.1 也接管了。
        std::fs::write(dir.join("settings.json"), r#"{"proxyMode":"none"}"#).unwrap();
        let fake = Fake {
            keys: [("openai".to_string(), "sk-openai".to_string())].into(),
        };
        let core = AppCore::open(dir, Arc::new(fake)).unwrap();
        let stub = Stub::start(handler).await;
        {
            let mut settings = core.settings.lock().unwrap();
            settings.provider_id = "openai".into();
            settings.model = "gpt-4o-mini".into();
            for id in ["openai", "deepseek"] {
                settings
                    .provider_base_urls
                    .insert(id.into(), format!("{}/{id}", stub.base));
            }
        }
        Self { core, stub }
    }

    async fn run(&self, request: VoiceRequest) -> Result<VoiceOutput, VoiceFailure> {
        run(&self.core, &request, &AtomicBool::new(false)).await
    }

    fn chat_hits(&self) -> Vec<Hit> {
        self.stub
            .hits()
            .into_iter()
            .filter(|h| h.path == "/openai/chat/completions")
            .collect()
    }
}

/// 一段带口头语、自我纠正、金额、日期、姓名与否定的典型口述。
const DICTATION: &str = "嗯，那个，周三，不对，周四下午三点和张伟开会，预算不超过 1,200 元，别迟到";

fn server_error() -> Reply {
    Reply::Status(500, r#"{"error":{"message":"upstream exploded"}}"#)
}

// ---------------------------------------------------------------- 成功

#[tokio::test]
async fn tidy_keeps_the_source_language_and_sends_the_fidelity_rules() {
    let env =
        Env::new(|_| sse(&["周四下午三点和张伟开会，", "预算不超过 1,200 元，别迟到。"])).await;

    let output = env.run(VoiceRequest::tidy(DICTATION)).await.unwrap();

    assert_eq!(
        output.text,
        "周四下午三点和张伟开会，预算不超过 1,200 元，别迟到。"
    );
    assert_eq!(output.task, VoiceTask::Tidy);
    assert_eq!(output.transcript, DICTATION);
    assert!(output.source_lang.is_some(), "中文转写应能检测出源语言");
    assert_eq!(output.output_lang, output.source_lang, "整理不换语言");
    assert_eq!(output.model, "gpt-4o-mini", "沿用单一当前模型");
    assert!(!output.truncated);

    let hits = env.chat_hits();
    assert_eq!(hits.len(), 1);
    let system = hits[0].message("system");
    assert!(system.contains("同语言整理"));
    assert!(system.contains("不要翻译"));
    for rule in [
        "否定",
        "数字",
        "金额",
        "日期",
        "姓名",
        "「周三，不对，周四」",
    ] {
        assert!(system.contains(rule), "整理指令缺少「{rule}」");
    }
    assert_eq!(hits[0].message("user"), DICTATION, "转写只作为 user 消息");
    assert_eq!(hits[0].body["model"], "gpt-4o-mini");
}

#[tokio::test]
async fn translate_switches_to_the_secondary_target_when_the_source_is_the_primary() {
    // 默认设置：第一目标 zh-CN、第二目标 en。中文口述要翻成英文，而不是「中译中」。
    let env = Env::new(|_| {
        sse(&[
            "Meeting with Zhang Wei on Thursday at 3 p.m.; ",
            "budget no more than 1,200 yuan. Don't be late.",
        ])
    })
    .await;

    let output = env.run(VoiceRequest::translate(DICTATION)).await.unwrap();

    assert_eq!(output.task, VoiceTask::Translate);
    assert_eq!(output.output_lang.as_deref(), Some("en"));
    assert!(output.text.starts_with("Meeting with Zhang Wei"));
    let system = env.chat_hits()[0].message("system");
    assert!(system.contains(&format!("目标语言：{}", lang::display_name("en"))));
    assert!(system.contains("不要附带原文"));
    for rule in [
        "否定",
        "数字",
        "金额",
        "日期",
        "姓名",
        "「周三，不对，周四」",
    ] {
        assert!(system.contains(rule), "翻译指令缺少「{rule}」");
    }
}

#[tokio::test]
async fn an_explicit_target_and_pinned_source_win_over_detection() {
    let env = Env::new(|_| sse(&["木曜日の午後3時に会議。"])).await;
    let request = VoiceRequest {
        source_lang: Some(" zh-CN ".into()),
        target_lang: Some("ja".into()),
        ..VoiceRequest::translate("周四下午三点开会")
    };

    let output = env.run(request).await.unwrap();

    assert_eq!(output.source_lang.as_deref(), Some("zh-CN"));
    assert_eq!(output.output_lang.as_deref(), Some("ja"));
    let system = env.chat_hits()[0].message("system");
    assert!(system.contains(&format!("目标语言：{}", lang::display_name("ja"))));
}

// ---------------------------------------------------------------- 失败与空结果

#[tokio::test]
async fn a_provider_failure_keeps_the_transcript_and_never_returns_it_as_the_result() {
    let env = Env::new(|_| server_error()).await;
    let transcript = format!("  {DICTATION}\n");

    let failure = env
        .run(VoiceRequest::translate(transcript.clone()))
        .await
        .unwrap_err();

    assert_eq!(
        failure.kind,
        VoiceFailureKind::Failed(CoreError::ServerError { status: 500 })
    );
    assert_eq!(failure.transcript, transcript, "转写原样保留，连空白都不动");
    assert!(failure.retryable());
    assert!(!failure.is_cancelled());
    assert_eq!(env.chat_hits().len(), 1, "只用当前模型，不换供应商重发");
}

#[tokio::test]
async fn a_whitespace_only_answer_is_an_empty_result_not_a_success_or_a_failure() {
    for request in [
        VoiceRequest::tidy(DICTATION),
        VoiceRequest::translate(DICTATION),
    ] {
        let env = Env::new(|_| sse(&["  ", "\n"])).await;
        let failure = env.run(request).await.unwrap_err();
        assert_eq!(failure.kind, VoiceFailureKind::EmptyResult);
        assert_eq!(failure.transcript, DICTATION);
        assert!(failure.retryable());
    }
}

#[tokio::test]
async fn a_cleanly_finished_stream_with_no_content_is_an_empty_result() {
    // 整理指令要求「原文只有口头语时输出空」：模型照做时流正常结束、一个字也没有，
    // 这是空结果，不是「响应格式不符合预期」。
    let env = Env::new(|_| sse(&[])).await;
    let failure = env.run(VoiceRequest::tidy("嗯，那个")).await.unwrap_err();
    assert_eq!(failure.kind, VoiceFailureKind::EmptyResult);
    assert_eq!(failure.transcript, "嗯，那个");
}

#[tokio::test]
async fn a_translation_that_echoes_the_transcript_is_not_delivered() {
    let env = Env::new(|hit| sse(&[&format!("  {}  ", hit.message("user"))])).await;

    let failure = env
        .run(VoiceRequest::translate(DICTATION))
        .await
        .unwrap_err();

    assert_eq!(failure.kind, VoiceFailureKind::Untranslated);
    assert_eq!(failure.transcript, DICTATION);
    assert!(failure.retryable());
}

#[tokio::test]
async fn tidy_may_return_the_transcript_unchanged() {
    // 本来就很干净的口述，整理后不变是正常结果。
    let env = Env::new(|hit| sse(&[&hit.message("user")])).await;
    let output = env.run(VoiceRequest::tidy("周四开会。")).await.unwrap();
    assert_eq!(output.text, "周四开会。");
}

#[tokio::test]
async fn an_empty_transcript_sends_no_request() {
    let env = Env::new(|_| sse(&["不该被请求"])).await;
    for transcript in ["", "  \n\t "] {
        let failure = env
            .run(VoiceRequest::translate(transcript))
            .await
            .unwrap_err();
        assert_eq!(failure.kind, VoiceFailureKind::EmptyTranscript);
        assert_eq!(failure.transcript, transcript);
        assert!(!failure.retryable(), "空转写要重新录音，不是重试");
    }
    assert!(env.stub.hits().is_empty());
}

#[tokio::test]
async fn a_missing_key_fails_before_any_request_and_keeps_the_transcript() {
    let env = Env::new(|_| sse(&["不该被请求"])).await;
    env.core.settings.lock().unwrap().provider_id = "deepseek".into();

    let failure = env.run(VoiceRequest::tidy(DICTATION)).await.unwrap_err();

    assert_eq!(
        failure.kind,
        VoiceFailureKind::Failed(CoreError::MissingKey)
    );
    assert_eq!(failure.transcript, DICTATION);
    assert!(env.stub.hits().is_empty());
}

// ---------------------------------------------------------------- 取消

#[tokio::test]
async fn cancelling_before_the_start_sends_no_request() {
    let env = Env::new(|_| sse(&["不该被请求"])).await;
    let cancel = AtomicBool::new(true);

    let failure = run(&env.core, &VoiceRequest::translate(DICTATION), &cancel)
        .await
        .unwrap_err();

    assert!(failure.is_cancelled());
    assert!(!failure.retryable(), "取消是用户的意图，不给重试");
    assert_eq!(failure.transcript, DICTATION);
    assert!(env.stub.hits().is_empty());
}

#[tokio::test]
async fn cancelling_mid_stream_stops_at_once_and_keeps_the_transcript() {
    let env = Env::new(|_| Reply::Sse {
        deltas: (0..20).map(|i| format!("片{i}")).collect(),
        gap: Duration::from_millis(300),
    })
    .await;
    let cancel = AtomicBool::new(false);
    let request = VoiceRequest::tidy(DICTATION);
    let started = Instant::now();

    let (result, ()) = tokio::join!(run(&env.core, &request, &cancel), async {
        tokio::time::sleep(Duration::from_millis(400)).await;
        cancel.store(true, Ordering::Relaxed);
    });

    assert!(
        started.elapsed() < Duration::from_secs(2),
        "取消要立刻生效，不能等流跑完"
    );
    let failure = result.unwrap_err();
    assert!(failure.is_cancelled());
    assert_eq!(failure.transcript, DICTATION);
}

#[tokio::test]
async fn a_result_that_completes_as_cancel_lands_is_discarded() {
    // 最后一段增量到达的同一刻按下取消：完整结果已在手里，也必须按取消处理。
    let env = Env::new(|_| sse(&["Meeting on Thursday."])).await;
    let cancel = AtomicBool::new(false);

    let failure = process(
        &env.core,
        &VoiceRequest::translate(DICTATION),
        &cancel,
        &mut |_| cancel.store(true, Ordering::Relaxed),
    )
    .await
    .unwrap_err();

    assert_eq!(failure, VoiceFailureKind::Failed(CoreError::Cancelled));
    assert_eq!(env.chat_hits().len(), 1);
}

// ---------------------------------------------------------------- 纯函数

#[test]
fn echo_detection_only_applies_across_languages() {
    assert!(echoes_source(
        "周四开会",
        "周四开会",
        Some("zh"),
        Some("en")
    ));
    assert!(echoes_source("周四开会", "周四开会", None, Some("en")));
    assert!(!echoes_source("Thursday", "周四", Some("zh"), Some("en")));
    // 用户显式选了同一种语言：相同输出是合理的。
    assert!(!echoes_source(
        "周四开会",
        "周四开会",
        Some("zh-CN"),
        Some("zh")
    ));
}

#[test]
fn failure_messages_are_distinct_for_empty_and_failed() {
    let empty = VoiceFailure::new(VoiceFailureKind::EmptyResult, "x").to_string();
    let failed =
        VoiceFailure::new(VoiceFailureKind::Failed(CoreError::MissingKey), "x").to_string();
    assert_ne!(empty, failed);
    assert_eq!(failed, CoreError::MissingKey.to_string());
}

#[tokio::test]
async fn the_owned_entry_point_is_send_and_runs_to_the_same_result() {
    fn assert_send_static<T: Send + 'static>(_: &T) {}
    let env = Env::new(|_| sse(&["周四开会。"])).await;
    let core = Arc::new(env.core);
    let cancel = Arc::new(AtomicBool::new(false));

    let future = core.post_process_voice(VoiceRequest::tidy("嗯，周四开会"), cancel.clone());
    assert_send_static(&future);
    let output = tokio::spawn(future).await.unwrap().unwrap();

    assert_eq!(output.text, "周四开会。");
    assert_eq!(output.transcript, "嗯，周四开会");
}

// ---------------------------------------------------------------- 历史

fn history(core: &AppCore) -> Vec<umuo_store::Record> {
    crate::history::with_store(core, |store| store.recent(10, 0)).unwrap()
}

#[tokio::test]
async fn the_host_entry_records_a_voice_scene_history_row() {
    let env = Env::new(|_| sse(&["周四开会。"])).await;
    let core = Arc::new(env.core);

    let output = core
        .post_process_voice(
            VoiceRequest::tidy("嗯，周四开会"),
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();

    let rows = history(&core);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].entry.scene, HISTORY_SCENE);
    assert_eq!(rows[0].entry.source_text, "嗯，周四开会");
    assert_eq!(rows[0].entry.translated_text, output.text);
    assert_eq!(rows[0].entry.provider_id, "openai");
}

#[tokio::test]
async fn history_is_skipped_when_disabled_truncated_or_failed() {
    let env = Env::new(|_| server_error()).await;
    let core = Arc::new(env.core);
    // 失败：不写。
    assert!(core
        .post_process_voice(VoiceRequest::tidy("嗯"), Arc::new(AtomicBool::new(false)))
        .await
        .is_err());
    assert!(history(&core).is_empty());

    // 截断的结果：不写。
    let truncated = VoiceOutput {
        task: VoiceTask::Tidy,
        text: "半句".into(),
        transcript: "半句话".into(),
        source_lang: Some("zh-CN".into()),
        output_lang: Some("zh-CN".into()),
        provider: "OpenAI".into(),
        provider_id: "openai".into(),
        model: "gpt-4o-mini".into(),
        usage: TokenUsage::default(),
        first_token_ms: None,
        total_ms: 1,
        truncated: true,
    };
    record_history(&core, &truncated, None);
    assert!(history(&core).is_empty());

    // 关闭记录：完整结果也不写。
    let complete = VoiceOutput {
        truncated: false,
        ..truncated
    };
    core.settings.lock().unwrap().history_enabled = false;
    record_history(&core, &complete, None);
    assert!(history(&core).is_empty());
    core.settings.lock().unwrap().history_enabled = true;
    record_history(&core, &complete, None);
    assert_eq!(history(&core).len(), 1);
}
