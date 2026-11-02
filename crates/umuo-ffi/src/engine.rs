//! `Engine`：Swift 端拿到的应用层入口，背后是一个 `umuo_app::AppCore` 和一个自建的 tokio 运行时。
//!
//! **流式请求不做成 `async fn`**：UniFFI 0.32 的 Swift 绑定不支持把 Task 的取消传进 Rust
//! （`Helpers.swift` 里是 `fatalError("Cancellation not supported yet")`），做成 async 的话
//! 用户关掉窗口后请求照跑、照计费。所以是「同步启动、立即返回 [`RequestHandle`]」，
//! 事件经 sink 推送，取消走 `RequestHandle::cancel`（Swift 在 `AsyncStream.onTermination` 里调）。
//!
//! 运行时自己建、不开 uniffi 的 `tokio` feature：reqwest 的连接池只活在这一个运行时里，
//! 不会出现两套运行时抢同一个连接池的情况。
//! 工作线程数用 tokio 默认（CPU 核数）：宿主回调是同步的外部调用，个别回调卡住（例如 Keychain 弹窗）
//! 不该拖住其他流和取消轮询；`BridgeHost` 还会用 `block_in_place` 把工作线程让出来。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use umuo_app::requests::Ticket;
use umuo_app::translate::{self, Mode, Request};
use umuo_app::AppCore;

use crate::event::{ForwardTranslate, TranslateSink};
use crate::host::{BridgeHost, FocusSource, HostBridge};

/// Engine 方法的失败。文案是给用户看的中文，Swift 端直接显示。
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum EngineError {
    /// 打不开（目前只有 HTTP 客户端或运行时建不起来会走到这里）。
    #[error("{message}")]
    Open { message: String },
    /// 设置的改动没通过：不是 JSON 对象、类型不对、校验不过或写盘失败。内存和文件都没变。
    #[error("{message}")]
    InvalidSetting { message: String },
    /// `umuo_app::ops` 的其余命令失败（历史库打不开、术语表写盘失败、未知供应商……），文案原样透传。
    #[error("{message}")]
    Failed { message: String },
}

/// 一次翻译的用途，决定结果往哪儿去、发到哪个窗口。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum TranslateMode {
    Selection,
    SilentReplace,
    Compose,
    Ocr,
}

impl From<TranslateMode> for Mode {
    fn from(mode: TranslateMode) -> Self {
        match mode {
            TranslateMode::Selection => Self::Selection,
            TranslateMode::SilentReplace => Self::SilentReplace,
            TranslateMode::Compose => Self::Compose,
            TranslateMode::Ocr => Self::Ocr,
        }
    }
}

/// 一次翻译请求。字段语义见 `umuo_app::translate::Request`。
#[derive(Debug, Clone, uniffi::Record)]
pub struct TranslateRequest {
    pub text: String,
    pub mode: TranslateMode,
    pub target_override: Option<String>,
    pub source_override: Option<String>,
    /// 只有静默翻译设置它；为空就不写回。
    pub focus_source: Option<FocusSource>,
}

impl From<TranslateRequest> for Request {
    fn from(request: TranslateRequest) -> Self {
        let TranslateRequest {
            text,
            mode,
            target_override,
            source_override,
            focus_source,
        } = request;
        let mut out = Self::with_overrides(
            text,
            mode.into(),
            umuo_app::translate::Overrides {
                source_lang: source_override,
                target_lang: target_override,
            },
        );
        out.focus_source = focus_source.map(Into::into);
        out
    }
}

/// 一次设置保存的结果。
#[derive(Debug, Clone, uniffi::Record)]
pub struct SettingsUpdate {
    /// 规范化之后的整份设置（JSON，字段名与 settings.json 一致）。
    pub settings_json: String,
    /// 快捷键改了：Swift 要当场重注册。
    pub hotkeys_changed: bool,
}

/// 一次流式请求的句柄。丢掉句柄**不会**取消请求——取消必须显式调 [`RequestHandle::cancel`]。
#[derive(uniffi::Object)]
pub struct RequestHandle {
    id: u64,
    cancel: Arc<AtomicBool>,
}

impl RequestHandle {
    pub(crate) fn new(id: u64, cancel: Arc<AtomicBool>) -> Self {
        Self { id, cancel }
    }
}

#[uniffi::export]
impl RequestHandle {
    /// 事件里带的请求 id（`Route.request_id` / `run_id`）。
    pub fn id(&self) -> u64 {
        self.id
    }

    /// 取消这次请求。幂等；传输层最迟 100 ms 内停下，之后不再有增量。
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

/// Swift 端的应用层入口：一个配置目录对应一个 Engine，整个进程只开一个。
#[derive(uniffi::Object)]
pub struct Engine {
    pub(crate) core: Arc<AppCore>,
    /// 只在 `Drop` 里取走，其余时候一定是 `Some`。
    rt: Option<tokio::runtime::Runtime>,
}

/// 最后一个引用可能在任意线程上释放：Swift 主线程，或者运行时自己的工作线程（任务结束时丢掉的 sink 持有 Engine）。
/// 普通的 `Runtime` drop 会等工作线程退出——在运行时工作线程上 drop 会导致 tokio 直接 panic，在主线程上也会阻塞界面。
/// 所以只发关闭信号、不等：还在跑的任务在下一个 await 点被丢弃。
impl Engine {
    pub(crate) fn rt(&self) -> &tokio::runtime::Runtime {
        self.rt.as_ref().expect("运行时只在 drop 时取走")
    }

    /// 用一张已登记的凭据在运行时上跑一次翻译，返回取消用的句柄。
    fn spawn_translation(
        &self,
        request: Request,
        ticket: Ticket,
        guard_token: Option<String>,
        sink: Arc<dyn TranslateSink>,
    ) -> Arc<RequestHandle> {
        let handle = RequestHandle {
            id: ticket.id,
            cancel: ticket.cancel.clone(),
        };
        let core = self.core.clone();
        let sink = ForwardTranslate(sink);
        self.rt().spawn(async move {
            translate::run(&core, &sink, request, guard_token, ticket).await;
        });
        Arc::new(handle)
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        if let Some(rt) = self.rt.take() {
            rt.shutdown_background();
        }
    }
}

#[uniffi::export]
impl Engine {
    /// 打开配置目录（`settings.json`、`history.db` 等都在这里）。
    ///
    /// 要读文件、开 SQLite，Swift 端在后台 Task 里调用，不要阻塞菜单栏出现。
    #[uniffi::constructor]
    pub fn open(config_dir: String, host: Arc<dyn HostBridge>) -> Result<Arc<Self>, EngineError> {
        let open_error = |message: String| EngineError::Open { message };
        let rt = tokio::runtime::Builder::new_multi_thread()
            .thread_name("umuo-engine")
            .enable_all()
            .build()
            .map_err(|e| open_error(e.to_string()))?;
        let core = AppCore::open(PathBuf::from(config_dir), Arc::new(BridgeHost(host)))
            .map_err(open_error)?;
        Ok(Arc::new(Self {
            core: Arc::new(core),
            rt: Some(rt),
        }))
    }

    /// 开始一次翻译，立即返回。同一窗口的上一次请求随之取消。
    ///
    /// `guard_token` 只有静默翻译需要：取词时记下的前台应用标识，写回前与当时的比对。
    pub fn translate(
        &self,
        request: TranslateRequest,
        guard_token: Option<String>,
        sink: Arc<dyn TranslateSink>,
    ) -> Arc<RequestHandle> {
        let request: Request = request.into();
        // 登记同步完成：新请求立刻顶掉同一窗口的旧请求，不必等任务排上队。
        let ticket = self.core.requests.begin(request.mode.surface());
        self.spawn_translation(request, ticket, guard_token, sink)
    }

    /// 用按快捷键时 `begin_request` 登记的那张凭据开始翻译（划词、原地替换），立即返回。
    ///
    /// 不再登记新请求：取词慢的那次（⌘C 降级）若在之后登记，会拿到更大的 id、旧选区的译文反而赢过新的。
    /// 这张凭据已被更新的请求顶掉时返回 None，什么都不跑（也就不会写回）：以按键时的凭据为准，
    /// 被顶掉的旧请求连发都不必发出去。
    pub fn translate_with_ticket(
        &self,
        request: TranslateRequest,
        ticket_id: u64,
        guard_token: Option<String>,
        sink: Arc<dyn TranslateSink>,
    ) -> Option<Arc<RequestHandle>> {
        let request: Request = request.into();
        let ticket = self
            .core
            .requests
            .ticket(request.mode.surface(), ticket_id)?;
        Some(self.spawn_translation(request, ticket, guard_token, sink))
    }

    /// 当前设置（JSON，字段名与 settings.json 一致）。Swift 只解码视图要用的字段。
    pub fn settings_json(&self) -> String {
        let settings = self.core.settings.lock().expect("设置锁不应中毒");
        serde_json::to_string(&*settings).expect("设置结构体一定可序列化")
    }

    /// 把 `patch_json`（JSON 对象）的顶层键叠在最新设置上，校验通过才落盘。
    ///
    /// 只交自己改的键；不认识的键原样保留在 settings.json 里（另一个客户端可能认识）。
    pub fn apply_settings_patch(&self, patch_json: String) -> Result<SettingsUpdate, EngineError> {
        let invalid = |message: String| EngineError::InvalidSetting { message };
        let patch = serde_json::from_str(&patch_json).map_err(|e| invalid(e.to_string()))?;
        let (settings, effects) = self.core.apply_settings_patch(patch).map_err(invalid)?;
        let umuo_app::settings_patch::SettingsEffects { hotkeys } = effects;
        Ok(SettingsUpdate {
            settings_json: serde_json::to_string(&settings).expect("设置结构体一定可序列化"),
            hotkeys_changed: hotkeys,
        })
    }
}

/// Bundle ID（`umuo_app::paths::BUNDLE_ID`）。Keychain 的服务名也是它，Swift 端读 Key 用这个，不自己再写一份。
#[uniffi::export]
pub fn bundle_id() -> String {
    umuo_app::paths::BUNDLE_ID.to_owned()
}

/// 默认的配置目录（已发布版本一直用的那个，见 `umuo_app::paths`）。拿不到 HOME 时为空。
#[uniffi::export]
pub fn default_config_dir() -> Option<String> {
    let home = std::env::var_os("HOME")?;
    Some(
        umuo_app::paths::config_dir_for(std::path::Path::new(&home))
            .to_string_lossy()
            .into_owned(),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use serde_json::{json, Value};

    use super::*;
    use crate::event::{Route, TranslateEvent};
    use crate::host::HostFailure;
    use crate::stub::selftest_sse_stub;

    /// 只有 OpenAI 的 Key；不写回。
    struct FakeHost;

    impl HostBridge for FakeHost {
        fn api_key(&self, provider_id: String) -> Result<Option<String>, HostFailure> {
            Ok((provider_id == "openai").then(|| "sk-test".to_string()))
        }
        fn frontmost_app_name(&self) -> Option<String> {
            Some("TextEdit".into())
        }
        fn frontmost_app_token(&self) -> Option<String> {
            Some("pid-1".into())
        }
        fn write_back(&self, _: FocusSource, _: String, _: String) -> Result<(), HostFailure> {
            Err(HostFailure::Failed {
                detail: "这些测试不写回".into(),
            })
        }
    }

    struct Recorder<T>(Mutex<Sender<T>>);

    impl TranslateSink for Recorder<(Route, TranslateEvent)> {
        fn on_event(&self, route: Route, event: TranslateEvent) {
            let _ = self.0.lock().unwrap().send((route, event));
        }
    }

    fn recorder<T>() -> (Arc<Recorder<T>>, Receiver<T>) {
        let (tx, rx) = channel();
        (Arc::new(Recorder(Mutex::new(tx))), rx)
    }

    /// 临时配置目录。代理在打开时就定了：先写 `proxyMode: none`，免得开发机的系统代理接管 127.0.0.1。
    fn open(initial: Value) -> Arc<Engine> {
        open_with_host(initial, Arc::new(FakeHost))
    }

    fn open_with_host(initial: Value, host: Arc<dyn HostBridge>) -> Arc<Engine> {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "umuo-ffi-engine-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut settings = json!({ "proxyMode": "none" });
        settings
            .as_object_mut()
            .unwrap()
            .extend(initial.as_object().unwrap().clone());
        std::fs::write(dir.join("settings.json"), settings.to_string()).unwrap();
        Engine::open(dir.to_string_lossy().into_owned(), host).unwrap()
    }

    /// 打开并把 OpenAI 指到桩上。
    fn open_with_stub(deltas: &[&str], delay_ms: u64, gap_ms: u64) -> Arc<Engine> {
        let base = selftest_sse_stub(
            deltas.iter().map(|d| d.to_string()).collect(),
            delay_ms,
            gap_ms,
        )
        .unwrap();
        let engine = open(json!({}));
        engine
            .apply_settings_patch(
                json!({
                    "providerId": "openai",
                    "model": "gpt-4o-mini",
                    "providerBaseUrls": { "openai": base },
                })
                .to_string(),
            )
            .unwrap();
        engine
    }

    fn selection(text: &str) -> TranslateRequest {
        TranslateRequest {
            text: text.into(),
            mode: TranslateMode::Selection,
            target_override: None,
            source_override: None,
            focus_source: None,
        }
    }

    /// 收事件直到 `last` 为真或超时。
    fn collect<T>(rx: &Receiver<T>, last: impl Fn(&T) -> bool) -> Vec<T> {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut events = Vec::new();
        while let Ok(event) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            let done = last(&event);
            events.push(event);
            if done {
                break;
            }
        }
        events
    }

    fn kind(event: &TranslateEvent) -> &'static str {
        match event {
            TranslateEvent::Start { .. } => "start",
            TranslateEvent::Delta { .. } => "delta",
            TranslateEvent::Card { .. } => "card",
            TranslateEvent::Done { .. } => "done",
            TranslateEvent::Error { .. } => "error",
        }
    }

    // 超过三个词：三个词以内走词卡，增量会被抑制。
    const SENTENCE: &str = "This is a whole sentence here.";

    #[test]
    fn a_settings_patch_round_trip_keeps_unknown_fields() {
        let engine = open(json!({ "futureField": { "x": [1, 2] } }));
        let update = engine
            .apply_settings_patch(json!({ "theme": "dark" }).to_string())
            .unwrap();
        let saved: Value = serde_json::from_str(&update.settings_json).unwrap();
        assert_eq!(saved["theme"], "dark");
        assert_eq!(saved["futureField"], json!({ "x": [1, 2] }), "未知字段保留");
        assert!(!update.hotkeys_changed);
        let current: Value = serde_json::from_str(&engine.settings_json()).unwrap();
        assert_eq!(current, saved, "读到的就是存下的");
    }

    #[test]
    fn a_bad_patch_is_an_invalid_setting_error() {
        let engine = open(json!({}));
        assert!(matches!(
            engine.apply_settings_patch("[]".into()),
            Err(EngineError::InvalidSetting { .. })
        ));
        assert!(matches!(
            engine.apply_settings_patch("{ 半截".into()),
            Err(EngineError::InvalidSetting { .. })
        ));
    }

    #[test]
    fn translate_streams_start_deltas_done_through_the_sink() {
        let engine = open_with_stub(&["你好", "世界"], 0, 0);
        let (sink, rx) = recorder();
        let handle = engine.translate(selection(SENTENCE), None, sink);
        let events = collect(&rx, |(_, e)| matches!(kind(e), "done" | "error"));

        let kinds: Vec<_> = events.iter().map(|(_, e)| kind(e)).collect();
        assert_eq!(kinds, ["start", "delta", "delta", "done"], "{events:?}");
        assert!(events
            .iter()
            .all(|(route, _)| route.request_id == handle.id() && route.surface == "panel"));
        let text: String = events
            .iter()
            .filter_map(|(_, e)| match e {
                TranslateEvent::Delta { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "你好世界");
    }

    #[test]
    fn translate_with_ticket_runs_only_the_latest_begun_request() {
        let engine = open_with_stub(&["你好"], 0, 0);
        // 按下 A、再按下 B；A 的取词更慢，取完时 B 已经登记过了
        let a = engine.core.requests.begin("panel").id;
        let b = engine.core.requests.begin("panel").id;

        let (stale_sink, stale_rx) = recorder();
        assert!(engine
            .translate_with_ticket(selection(SENTENCE), a, None, stale_sink)
            .is_none());
        assert!(
            stale_rx.recv_timeout(Duration::from_millis(300)).is_err(),
            "被顶掉的请求不发任何事件"
        );

        let (sink, rx) = recorder();
        let handle = engine
            .translate_with_ticket(selection(SENTENCE), b, None, sink)
            .expect("B 仍是当前请求");
        assert_eq!(handle.id(), b, "沿用按键时的 id，不再登记新的");
        let events = collect(&rx, |(_, e)| matches!(kind(e), "done" | "error"));
        assert_eq!(kind(&events.last().unwrap().1), "done", "{events:?}");
        assert!(events.iter().all(|(route, _)| route.request_id == b));
    }

    #[test]
    fn cancel_stops_the_deltas() {
        // 段间隔远大于传输层 100 ms 的取消轮询
        let engine = open_with_stub(&["一", "二", "三"], 0, 500);
        let (sink, rx) = recorder();
        let handle = engine.translate(selection(SENTENCE), None, sink);
        let before = collect(&rx, |(_, e)| matches!(kind(e), "delta" | "error"));
        assert_eq!(kind(&before.last().unwrap().1), "delta", "{before:?}");
        handle.cancel();
        assert!(handle.is_cancelled());

        // 等到流水线结束（sink 被丢掉）或 1.5 秒内再没有事件
        let mut after = Vec::new();
        while let Ok((_, event)) = rx.recv_timeout(Duration::from_millis(1500)) {
            after.push(kind(&event));
        }
        assert!(
            !after.iter().any(|k| matches!(*k, "delta" | "done")),
            "取消后不再有增量，也没有完成：{after:?}"
        );
    }

    /// 持有 Engine 最后一个引用的 sink：任务结束时它在运行时自己的工作线程上被丢掉。
    struct OwningSink {
        engine: Mutex<Option<Arc<Engine>>>,
        dropped: Mutex<Sender<()>>,
    }

    impl TranslateSink for OwningSink {
        fn on_event(&self, _: Route, _: TranslateEvent) {}
    }

    impl Drop for OwningSink {
        fn drop(&mut self) {
            drop(self.engine.lock().unwrap().take());
            // 上面 panic 的话走不到这里，测试就超时失败
            let _ = self.dropped.lock().unwrap().send(());
        }
    }

    #[test]
    fn the_last_engine_ref_can_drop_on_its_own_worker() {
        let engine = open_with_stub(&["你好"], 0, 0);
        let (tx, rx) = channel();
        let sink = Arc::new(OwningSink {
            engine: Mutex::new(Some(engine.clone())),
            dropped: Mutex::new(tx),
        });
        let _handle = engine.translate(selection(SENTENCE), None, sink);
        drop(engine);
        rx.recv_timeout(Duration::from_secs(10))
            .expect("在工作线程上释放 Engine 不该 panic");
    }

    /// 放行之前取 Key 一律卡住（好比 Keychain 弹窗没人点），并报告自己被卡住了。
    struct StuckHost {
        stuck: Mutex<Sender<()>>,
        released: AtomicBool,
    }

    impl HostBridge for StuckHost {
        fn api_key(&self, _provider_id: String) -> Result<Option<String>, HostFailure> {
            if self.released.load(Ordering::SeqCst) {
                return Ok(Some("sk-test".into()));
            }
            let _ = self.stuck.lock().unwrap().send(());
            std::thread::sleep(Duration::from_secs(3));
            Ok(None)
        }
        fn frontmost_app_name(&self) -> Option<String> {
            None
        }
        fn frontmost_app_token(&self) -> Option<String> {
            None
        }
        fn write_back(&self, _: FocusSource, _: String, _: String) -> Result<(), HostFailure> {
            Ok(())
        }
    }

    fn open_stuck(stub_base: Option<String>) -> (Arc<Engine>, Receiver<()>, Arc<StuckHost>) {
        let (tx, stuck) = channel();
        let mut settings = json!({ "providerId": "openai", "model": "gpt-4o-mini" });
        if let Some(base) = stub_base {
            settings["providerBaseUrls"] = json!({ "openai": base });
        }
        let host = Arc::new(StuckHost {
            stuck: Mutex::new(tx),
            released: AtomicBool::new(false),
        });
        let engine = open_with_host(settings, host.clone());
        (engine, stuck, host)
    }

    #[test]
    fn dropping_the_engine_does_not_wait_for_a_stuck_host_call() {
        // 普通的 Runtime drop 要等卡住的工作线程回来；在 Swift 主线程上这就是死锁的一半
        let (engine, stuck, _host) = open_stuck(None);
        let (sink, _rx) = recorder();
        let _handle = engine.translate(selection(SENTENCE), None, sink);
        stuck.recv_timeout(Duration::from_secs(5)).unwrap();
        let started = Instant::now();
        drop(engine);
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "{:?}",
            started.elapsed()
        );
    }

    #[test]
    fn stuck_host_calls_do_not_stall_other_requests() {
        // 比工作线程还多的翻译请求卡在取 Key 上，一次翻译照样流完
        let base = selftest_sse_stub(vec!["你好".into()], 0, 0).unwrap();
        let (engine, stuck, host) = open_stuck(Some(base));
        let workers = std::thread::available_parallelism().map_or(8, |n| n.get());
        let mut parked = Vec::new();
        for _ in 0..workers + 4 {
            let (sink, rx) = recorder();
            parked.push((engine.translate(selection(SENTENCE), None, sink), rx));
            // 确认此请求已经进入阻塞 Host，再发下一次，避免新请求提前取消尚未执行的旧请求。
            stuck.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        host.released.store(true, Ordering::SeqCst);
        let (sink, rx) = recorder();
        let _handle = engine.translate(selection(SENTENCE), None, sink);
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut kinds = Vec::new();
        while let Ok((_, event)) =
            rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            kinds.push(kind(&event));
            if matches!(kind(&event), "done" | "error") {
                break;
            }
        }
        assert_eq!(kinds.last(), Some(&"done"), "{kinds:?}");
    }

    // ------------------------------------------------ 语音后处理

    impl crate::voice::VoiceSink for Recorder<(u64, crate::voice::VoicePostResult)> {
        fn on_result(&self, session: u64, result: crate::voice::VoicePostResult) {
            let _ = self.0.lock().unwrap().send((session, result));
        }
    }

    fn voice_request(task: crate::voice::VoiceTask) -> crate::voice::VoicePostRequest {
        crate::voice::VoicePostRequest {
            transcript: "嗯，那个，周四开会".into(),
            task,
            source_lang: None,
            target_lang: Some("en".into()),
        }
    }

    #[test]
    fn start_voice_returns_the_result_for_its_session_and_records_history() {
        use crate::voice::{VoicePostResult, VoiceTask};
        let engine = open_with_stub(&["We meet ", "on Thursday."], 0, 0);
        let (sink, rx) = recorder();
        let handle = engine.start_voice(7, voice_request(VoiceTask::Translate), sink);
        assert_eq!(handle.id(), 7, "句柄 id 就是语音会话号");
        let (session, result) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert_eq!(session, 7);
        let VoicePostResult::Done { output } = result else {
            panic!("应当成功：{result:?}");
        };
        assert_eq!(output.text, "We meet on Thursday.");
        assert_eq!(output.task, VoiceTask::Translate);
        assert_eq!(output.output_lang.as_deref(), Some("en"));
        assert!(!output.truncated);
        let rows = engine.history_query(None, 10, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].scene, "voice");
        assert_eq!(rows[0].source_text, "嗯，那个，周四开会");
    }

    #[test]
    fn cancelling_start_voice_reports_a_cancelled_failure_with_the_transcript() {
        use crate::voice::{VoicePostResult, VoiceTask};
        // 先等 2 秒才回第一段：取消一定落在结果之前
        let engine = open_with_stub(&["周四开会。"], 2_000, 0);
        let (sink, rx) = recorder();
        let handle = engine.start_voice(1, voice_request(VoiceTask::Tidy), sink);
        handle.cancel();
        let (_, result) = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let VoicePostResult::Failed { failure } = result else {
            panic!("取消后不能有结果：{result:?}");
        };
        assert!(failure.cancelled);
        assert!(!failure.retryable);
        assert_eq!(failure.transcript, "嗯，那个，周四开会");
    }

    #[test]
    fn the_default_config_dir_is_the_released_one() {
        let dir = default_config_dir().unwrap();
        assert!(
            dir.ends_with("/Library/Application Support/app.umuo.desktop"),
            "{dir}"
        );
    }
}
