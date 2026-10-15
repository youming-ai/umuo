//! 划词翻译的编排：取词 → 定位浮窗 → 流式翻译 → 通过事件把结果推给浮窗。
//!
//! 这一层只做「组装」：语言判断、Prompt、路由、计量、传输都在 `umuo-core` 里。
//! 它自己做三件事——读设置、读 Keychain、把增量发给 WebView。

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use umuo_core::error::{CoreError, SuggestedAction};
use umuo_core::router::{self, Scene};
use umuo_core::transport::{self, ChatTarget, StreamOptions};
use umuo_core::wire::ModelRef;
use umuo_core::{chunk, lang, prompt, provider, usage};
use umuo_platform::{PlatformError, SecretStore, SelectionReader, Speech};

use crate::settings::Settings;
use crate::{AppState, COMPOSE_LABEL, PANEL_LABEL};

pub const EVENT_START: &str = "translate://start";
pub const EVENT_DELTA: &str = "translate://delta";
pub const EVENT_DONE: &str = "translate://done";
pub const EVENT_ERROR: &str = "translate://error";
/// 单词词卡解析成功时发这个（PRD §5.2）。
///
/// 它与 delta 互斥：词卡模式下增量被抑制，整段 JSON 解析成结构后一次性推给前端。
pub const EVENT_CARD: &str = "translate://card";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPayload {
    pub text: String,
    pub provider: String,
    pub model: String,
    pub target_lang: String,
    /// 单选词时浮窗走词卡布局（PRD §5.2）。
    pub word_mode: bool,
    /// `selection` = 只显示；`silentReplace` = 结果会写回原处（PRD §5.4）。
    pub mode: &'static str,
}

#[derive(Clone, Serialize)]
pub struct DeltaPayload {
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DonePayload {
    /// 结果之外要说的一句话（目前只有月度上限用它）。
    ///
    /// 单独一个字段而不是复用错误事件：翻译**成功了**，
    /// 把它渲染成错误块会让用户以为没翻出来。
    pub warning: Option<String>,
    /// 实际服务的那一次尝试所用的模型——故障转移后可能与首选不同，
    /// 结果卡片必须说真话（PRD §6.3）。
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// 用量是本地估算的（厂商没回 usage）。
    pub estimated: bool,
    /// 价格表里查不到这个模型时为 null，UI 显示「无价格信息」而不是编一个数字。
    pub cost_usd: Option<f64>,
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
    /// 译文是否已经写回原处。静默翻译成功时为 true——UI 据此告诉用户
    /// 「原文已经被换掉了」，而不是让他以为这只是个预览。
    pub replaced: bool,
    /// 这次是用本机模型翻的（原请求因网络不通失败了）——PRD §7.5 要求标注「离线」。
    pub offline: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSense {
    pub part_of_speech: String,
    pub definition: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardExample {
    pub source: String,
    pub target: String,
}

/// 单词词卡。字段与 `umuo_core::word_card::WordCard` 一一对应，
/// 但刻意分成两个类型：核心的领域类型与 IPC 契约各自演进，加字段时不会互相牵制。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardPayload {
    pub word: String,
    pub phonetic: Option<String>,
    pub senses: Vec<CardSense>,
    pub forms: Vec<String>,
    pub examples: Vec<CardExample>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub message: String,
    pub actions: Vec<SuggestedAction>,
    /// 属于「去开系统权限就能解决」的错误（PRD §7.4）。
    pub needs_permission: bool,
    /// 该去开哪一个权限：`accessibility`（取词）或 `screenRecording`（截图）。
    ///
    /// 前端据此决定把用户送去哪个设置面板。只给一个布尔值时，截图缺权限会被
    /// 引导到「辅助功能」，用户照做之后仍然用不了——这比不提示更糟。
    pub permission: Option<&'static str>,
}

/// 跑一批分片请求。
///
/// 抽成函数是为了让「离线回落」能**原样再跑一次**——否则那 15 行请求代码
/// 要在两条路径上各写一份，而且迟早只有一份被改。
#[allow(clippy::too_many_arguments)]
async fn run_chunks(
    client: &reqwest::Client,
    provider: &'static provider::Provider,
    base_url: Option<&str>,
    model: &str,
    api_key: &str,
    requests: &[umuo_core::wire::ChatRequest],
    options: &transport::StreamOptions<'_>,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<transport::StreamOutcome, CoreError> {
    transport::stream_chunks(
        client,
        &transport::ChunkTarget {
            provider,
            base_url,
            model,
            api_key,
        },
        requests,
        options,
        on_delta,
    )
    .await
}

/// 这个错误值不值得改用本机模型重试（PRD §7.5「离线时自动切换到本地模型」）。
///
/// **只有网络类错误算「离线」。** 限流、Key 无效、余额不足、上下文超长这些
/// 换成 localhost 也解决不了；把它们也当离线，只会让用户看到「离线」字样
/// 却仍然失败，比不标更让人困惑。
pub fn should_fall_back_to_local(error: &CoreError) -> bool {
    matches!(error, CoreError::Network { .. })
}

/// 本机可用的兜底候选：探测 Ollama，其次 LM Studio。
///
/// **必须真的能列出模型才算可用。** 装了 Ollama 但没启动、或一个模型都没下时，
/// 把它当兜底只会把「网络不可达」变成「连接被拒绝」——错误更难懂，还多等一轮超时。
async fn local_candidate(
    client: &reqwest::Client,
    settings: &crate::settings::Settings,
) -> Option<umuo_core::wire::ModelRef> {
    for provider in provider::PROVIDERS
        .iter()
        .filter(|p| p.kind == provider::ProviderKind::Local)
    {
        // 用户可能改过本地地址（例如换了端口），所以要经过同一套覆盖解析。
        let Ok(base_url) = settings.base_url_override(provider) else {
            continue;
        };
        let wire = match base_url.as_deref() {
            Some(url) => umuo_core::wire::build_models_request_at(provider, url, ""),
            None => umuo_core::wire::build_models_request(provider, ""),
        };
        let Ok(wire) = wire else {
            continue;
        };
        // 本地探测给短的超时：本机连不上是立刻知道的，不该让用户等 15 秒。
        let Ok(body) = transport::fetch_json(client, &wire, Duration::from_secs(5)).await else {
            continue;
        };
        let Ok(models) = umuo_core::wire::parse_models_list(provider.protocol, &body) else {
            continue;
        };
        if let Some(model) = models.into_iter().next() {
            return Some(umuo_core::wire::ModelRef {
                provider_id: provider.id.to_string(),
                model,
            });
        }
    }
    None
}

/// 这次请求的源语言：用户钉住的优先，否则用自动检测的结果。
///
/// 钉住的不只是「给 Prompt 看的那一行」——目标语言的切换规则也用它
/// （原文已经是第一目标语言时改用第二目标语言）。两处用同一个值，
/// 才不会出现「Prompt 说源语言是英文，切换规则却按检测结果判断」这种自相矛盾。
pub fn resolve_source<'a>(request: &'a Request, detected: Option<&'a str>) -> Option<&'a str> {
    match request.source_override.as_deref().map(str::trim) {
        Some(pinned) if !pinned.is_empty() => Some(pinned),
        _ => detected,
    }
}

/// 浮窗的「重译」允许指定的模式（PRD §5.2 / §5.5）。
///
/// **只放 Selection 与 Ocr 进来。** 其余两个各自有专门的入口：
/// 撰写窗的结果要去另一个窗口，静默替换会真的改写用户的文档——
/// 让浮窗的重译按钮有机会触发它们，是纯粹的意外通道。
pub fn retranslate_mode(id: Option<&str>) -> Result<Mode, CoreError> {
    match id.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(Mode::Selection),
        // 走 `from_id` 而不是再手写一遍映射：两处映射迟早会分叉，
        // 而分叉的表现是「某个模式在别处能识别、在这里被拒」，很难查。
        Some(value) => match Mode::from_id(value) {
            Some(mode @ (Mode::Selection | Mode::Ocr)) => Ok(mode),
            _ => Err(CoreError::BadResponse {
                detail: format!("重译不支持的模式：{value}（只支持 selection 与 ocr）"),
            }),
        },
    }
}

/// 这次请求该用哪个供应商 id：显式覆盖（浮窗重译）> 设置。
pub fn resolve_provider_id<'a>(settings: &'a Settings, request: &'a Request) -> &'a str {
    request
        .provider_override
        .as_deref()
        .unwrap_or(&settings.provider_id)
}

/// 这次请求该用哪个模型：显式覆盖 > 设置里的模型 >供应商默认模型。
///
/// 「设置里为空就用供应商默认模型」这条一定要排在覆盖之后：
/// 浮窗选了某个模型却因为它为空而回落到默认，用户会以为切换没生效。
pub fn resolve_model(
    settings: &Settings,
    provider: &provider::Provider,
    request: &Request,
) -> String {
    if let Some(model) = request.model_override.as_deref() {
        if !model.trim().is_empty() {
            return model.trim().to_string();
        }
    }
    if settings.model.trim().is_empty() {
        provider.default_model.to_string()
    } else {
        settings.model.trim().to_string()
    }
}

/// 这次请求该用哪个风格：显式覆盖 > 设置。
pub fn resolve_style(settings: &Settings, request: &Request) -> prompt::StyleSpec {
    match request.style_override.as_deref() {
        Some(id) => prompt::find_style_with(&settings.custom_styles, id),
        None => settings.style(),
    }
}

/// 一次翻译的用途。决定结果往哪儿去、发到哪个窗口——这是唯一需要分支的地方。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// 划词翻译：结果只显示在浮窗里，**绝不改动用户的内容**。
    Selection,
    /// 静默翻译：结果写回原处，替换掉原文（PRD §5.4）。
    SilentReplace,
    /// 撰写窗：结果只显示在撰写窗下半区（PRD §5.3）。输入框里的草稿归前端管，
    /// 所以这里的 start/delta/done 只驱动「译文区」。
    Compose,
    /// 截图 OCR：源文本来自屏幕识别结果，结果只显示（PRD §5.5）。
    Ocr,
}

impl Mode {
    /// 前端按这个字符串决定展示文案，改了就是破坏性变更（有测试钉住）。
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Selection => "selection",
            Mode::SilentReplace => "silentReplace",
            Mode::Compose => "compose",
            Mode::Ocr => "ocr",
        }
    }

    /// 从字符串还原。`as_str` 的逆运算（有往返测试钉住）。
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "selection" => Some(Mode::Selection),
            "silentReplace" => Some(Mode::SilentReplace),
            "compose" => Some(Mode::Compose),
            "ocr" => Some(Mode::Ocr),
            _ => None,
        }
    }

    /// 事件发到哪个窗口。几个功能共用一套事件协议，靠窗口标签区分。
    fn surface(self) -> &'static str {
        match self {
            Mode::Selection | Mode::SilentReplace | Mode::Ocr => PANEL_LABEL,
            Mode::Compose => COMPOSE_LABEL,
        }
    }

    fn scene(self) -> Scene {
        match self {
            Mode::Selection => Scene::Selection,
            Mode::SilentReplace => Scene::SilentReplace,
            Mode::Compose => Scene::Compose,
            Mode::Ocr => Scene::Ocr,
        }
    }

    /// 成功后是否把译文写回原处。只有静默翻译会。
    fn write_back(self) -> bool {
        self == Mode::SilentReplace
    }
}

/// 一次翻译请求。
///
/// 打成一个结构体而不是继续加位置参数：撰写窗带来的「发到哪个窗口」「目标语言能不能被覆盖」
/// 两个维度，会让 `translate(app, text, mode, target, surface, override, …)` 变成一列
/// 分不清顺序的参数。
#[derive(Debug, Clone)]
pub struct Request {
    pub text: String,
    pub mode: Mode,
    /// 覆盖目标语言。回译用它把译文翻回**原文的语言**，而不是设置里的目标语言。
    pub target_override: Option<String>,
    /// 浮窗「换个模型 / 换个风格重译」用。
    ///
    /// **只影响这一次请求，不写回设置**：用户在浮窗上试一下别的模型，
    /// 不该把他配置的默认模型悄悄改掉。
    pub provider_override: Option<String>,
    pub model_override: Option<String>,
    pub style_override: Option<String>,
    /// 钉住源语言（PRD §5.3「支持选择源语言」）。为空则自动检测。
    ///
    /// 自动检测对短句经常猜不准，而用户明确知道自己在翻什么语言。
    pub source_override: Option<String>,
}

/// 一次请求的临时覆盖。
///
/// 打成一个结构体而不是继续往 `Request` 上加字段：调用点已经有五个可选参数了，
/// 再多几个签名会长到看不出哪个是哪个。
#[derive(Debug, Clone, Default)]
pub struct Overrides {
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub style_id: Option<String>,
}

impl Request {
    /// 只带文本与模式的骨架。覆盖字段默认全空——重复写五遍 `None` 迟早漏一个。
    fn base(text: impl Into<String>, mode: Mode) -> Self {
        Self {
            text: text.into(),
            mode,
            target_override: None,
            provider_override: None,
            model_override: None,
            style_override: None,
            source_override: None,
        }
    }

    /// 带临时覆盖的请求（撰写窗的语言 / 模型 / 风格选择用）。
    pub fn with_overrides(text: impl Into<String>, mode: Mode, overrides: Overrides) -> Self {
        Self {
            target_override: overrides.target_lang.filter(|v| !v.trim().is_empty()),
            provider_override: overrides.provider_id.filter(|v| !v.trim().is_empty()),
            model_override: overrides.model.filter(|v| !v.trim().is_empty()),
            style_override: overrides.style_id.filter(|v| !v.trim().is_empty()),
            source_override: overrides.source_lang.filter(|v| !v.trim().is_empty()),
            ..Self::base(text, mode)
        }
    }

    pub fn selection(text: impl Into<String>) -> Self {
        Self::base(text, Mode::Selection)
    }

    /// 浮窗的「重译」：同一段原文，换供应商 / 模型 / 风格再翻一次。
    pub fn retranslate(
        text: impl Into<String>,
        mode: Mode,
        provider_id: Option<String>,
        model: Option<String>,
        style_id: Option<String>,
    ) -> Self {
        Self {
            provider_override: provider_id,
            model_override: model,
            style_override: style_id,
            ..Self::base(text, mode)
        }
    }

    pub fn silent_replace(text: impl Into<String>) -> Self {
        Self::base(text, Mode::SilentReplace)
    }

    /// 截图 OCR 的识别结果：源文本来自屏幕，交给同一条翻译流水线。
    pub fn ocr(text: impl Into<String>) -> Self {
        Self::base(text, Mode::Ocr)
    }

    /// 回译：把译文再翻回原文语言，用于自检（PRD §5.3）。
    pub fn back_translate(text: impl Into<String>, target_language: impl Into<String>) -> Self {
        Self {
            target_override: Some(target_language.into()),
            ..Self::base(text, Mode::Compose)
        }
    }
}

/// 快捷键 / 托盘菜单触发的入口：划词翻译。
pub fn trigger(app: &AppHandle) {
    trigger_inner(app, Mode::Selection);
}

/// 快捷键 / 托盘菜单触发的入口：输入框原地替换（静默翻译）。
pub fn trigger_silent_replace(app: &AppHandle) {
    trigger_inner(app, Mode::SilentReplace);
}

/// 取词在**独立线程**上做：降级路径要等最多 400ms 的剪贴板轮询，
/// 放在主线程会让浮窗「先卡一下再出现」，PRD §8 的 150ms 唤醒指标立刻不达标。
///
/// 只有划词与静默翻译两个入口走这里；撰写窗的文本是用户打进去的，不取词。
fn trigger_inner(app: &AppHandle, mode: Mode) {
    // PRD §8 的「唤起速度 ≤ 150ms」从这里开始计时：这是按键事件到达我们手里的时刻。
    // 分段而不是只报一个总数——取词（AX / 剪贴板降级）才是主要成本，
    // 只报总数的话，超了也不知道该怪谁。
    let wake_started = std::time::Instant::now();
    debug_assert!(
        matches!(mode, Mode::Selection | Mode::SilentReplace),
        "撰写窗不取词，不该走到 trigger_inner"
    );
    let silent = mode == Mode::SilentReplace;

    let app = app.clone();
    std::thread::spawn(move || {
        // 作用域刻意收窄：State 借用了 app，而下面要把 app 移动进异步任务。
        let (read, target) = {
            let state = app.state::<AppState>();
            let settings = state.settings.lock().expect("设置锁不应中毒").clone();

            // PRD §7.3 的取词黑名单：密码管理器等应用**在读取之前**就拦下。
            // 判定需要前台应用名（一次 AX 往返），所以黑名单为空时跳过这一步，
            // 不给默认路径增加成本。拦下要用浮窗说清楚，而不是无声无息。
            if !settings.selection_blacklist.is_empty() {
                if let Some(app_name) = state.selection.frontmost_app_name().as_deref() {
                    if settings.is_selection_blocked(app_name) {
                        show_panel_near_cursor(&app);
                        let _ = app.emit_to(
                            PANEL_LABEL,
                            EVENT_ERROR,
                            ErrorPayload {
                                message: format!(
                                    "「{app_name}」在取词黑名单里，没有读取选中的内容。可在设置里调整。"
                                ),
                                actions: vec![SuggestedAction::OpenModelSettings],
                                needs_permission: false,
                                permission: None,
                            },
                        );
                        return;
                    }
                }
            }

            // 写回前要确认目标应用没被换掉，所以先记下它的标识。
            let target = if silent {
                state.selection.frontmost_app_token()
            } else {
                None
            };
            let read = if silent {
                // 静默翻译用 read_focus_text：没有选区时读整个输入框，
                // 且不做剪贴板降级（写回依赖同一条通道，降级取词救不回来）。
                state.selection.read_focus_text()
            } else {
                state.selection.read_selection()
            };
            (read, target)
        };

        let read_ms = wake_started.elapsed().as_millis();
        let text = match read {
            Ok(text) => text,
            Err(error) => {
                eprintln!("umuo: 取词耗时 {read_ms}ms（失败）");
                show_panel_near_cursor_traced(&app, Some(wake_started));
                emit_platform_error(&app, &error);
                return;
            }
        };

        eprintln!("umuo: 取词耗时 {read_ms}ms");
        show_panel_near_cursor_traced(&app, Some(wake_started));
        tauri::async_runtime::spawn(async move {
            let request = if silent {
                Request::silent_replace(text)
            } else {
                Request::selection(text)
            };
            run(app, request, target).await;
        });
    });
}

/// ⌥R：朗读当前选中的文本（PRD §7.2）。
///
/// 与翻译不同，它**不弹浮窗**——用户要的是把这段读出来，不是看译文。
/// 取不到选区时才用浮窗说话：一个"按了没反应"的全局快捷键比报错更让人困惑。
///
/// 再按一次不会停：`speak` 的契约是「先停上一段再开始新的」，
/// 连按两次的结果是重新读一遍，比叠音或没反应都好。
pub fn trigger_speak(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        // 朗读同样受黑名单约束：把密码读出声，比翻译它更糟。
        if let Some(app_name) = state.selection.frontmost_app_name() {
            let settings = state.settings.lock().expect("设置锁不应中毒").clone();
            if settings.is_selection_blocked(&app_name) {
                emit_platform_error(
                    &app,
                    &umuo_platform::PlatformError::PermissionDenied {
                        capability: "取词黑名单（该应用未读取）",
                    },
                );
                return;
            }
        }
        match state.selection.read_selection() {
            Ok(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return;
                }
                let language = lang::detect(trimmed);
                if let Err(error) = state.speech.speak(trimmed, language) {
                    emit_platform_error(&app, &error);
                }
            }
            Err(error) => emit_platform_error(&app, &error),
        }
    });
}

/// 从别处传入文本时用这个：浮窗的「重译」按钮，以及撰写窗的翻译命令。
///
/// `guard` 只有静默翻译才需要——它是写回前的目标校验凭据。
pub fn spawn(app: &AppHandle, request: Request, guard: Option<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = translate(&app, &request, guard.as_deref()).await {
            emit_core_error(&app, request.mode.surface(), &error);
        }
    });
}

/// 从浮窗传入文本时用这个。
pub fn trigger_with_text(app: &AppHandle, text: String) {
    // 手动重译永远走「只显示」：用户点的是浮窗里的按钮，
    // 没有理由让第二次尝试突然去改写他的原文。
    spawn(app, Request::selection(text), None);
}

async fn run(app: AppHandle, request: Request, guard: Option<String>) {
    if let Err(error) = translate(&app, &request, guard.as_deref()).await {
        emit_core_error(&app, request.mode.surface(), &error);
    }
}

async fn translate(
    app: &AppHandle,
    request: &Request,
    guard: Option<&str>,
) -> Result<(), CoreError> {
    let mode = request.mode;
    let surface = mode.surface();
    let text = request.text.as_str();
    let state = app.state::<AppState>();
    // 锁只在这个语句里存活：MutexGuard 不能跨 await，否则 future 不是 Send。
    let settings: Settings = state.settings.lock().expect("设置锁不应中毒").clone();

    let provider = provider::find_provider(resolve_provider_id(&settings, request))
        .ok_or(CoreError::NoEngine)?;

    // 首选供应商的 Key。**只用于「首选是否可用」的判断**——循环里每个候选会各自
    // 重新解析自己的 Key 与地址（见下面的注释）。
    let primary_key = state
        .secrets
        .get(provider.id)
        .map_err(|e| CoreError::BadResponse {
            detail: format!("读取 Keychain 失败：{e}"),
        })?
        .unwrap_or_default();
    if provider.requires_key() && primary_key.trim().is_empty() {
        return Err(CoreError::MissingKey);
    }

    // 月度上限（PRD §5.10）：可能把我们换到另一个供应商。
    // **必须放在解析模型与地址之前**——换了供应商还沿用旧供应商的模型名，
    // 请求会以一个「模型不存在」的 404 失败，而用户完全不知道为什么。
    let resolution = crate::budget::resolve(app, &settings, provider.id);
    let switched = resolution.provider_id != provider.id;
    let provider = if switched {
        umuo_core::provider::find_provider(&resolution.provider_id).unwrap_or(provider)
    } else {
        provider
    };
    let budget_warning = resolution.warning;

    let model = if switched {
        // 被月度上限换过来时用新供应商的默认模型：用户配置的模型名属于原来那家，
        // 拿它去新端点只会 404。
        provider.default_model.to_string()
    } else {
        resolve_model(&settings, provider, request)
    };

    // 语言判断与目标切换（PRD §5.2）：源语言 == 第一目标语言时改用第二目标语言。
    // 回译会直接覆盖目标语言，此时不做切换——「翻回原文语言」是用户的明确意图，
    // 再拿它跟第一目标语言比一遍反而会把意图改掉。
    // 检测不出源语言时用母语作为假设（PRD §7.3 的「母语」）：
    // 没有它，"撞车换第二目标语言"的规则在检测失败时就会失灵。
    let detected = lang::assume_source(lang::detect(text), &settings.native_lang);
    let source = resolve_source(request, detected.as_deref());
    // PRD §5.4 的目标语言规则：显式指定 > 按 App 记忆 > 常规规则。
    //
    // 只有开了「按 App 记忆」才去读来源 App——那是一次 AX 往返（十几毫秒），
    // 默认路径不该付这个成本（PRD §8 的唤起速度门槛很紧）。
    let per_app = settings.uses_per_app_target();
    let app_name = if per_app {
        state.selection.frontmost_app_name()
    } else {
        None
    };
    let remembered = app_name
        .as_deref()
        .and_then(|app| settings.app_target_langs.get(app))
        .cloned();

    let target_code = lang::resolve_target(
        request.target_override.as_deref(),
        remembered.as_deref(),
        source,
        &settings.target_lang,
        Some(&settings.secondary_target_lang),
    );

    // 用户为这个 App 手动选过语言：记下来，下次不用再选（PRD §5.4）。
    // **不做隐式学习**：只记用户明确选过的，因为"我们记住了什么"必须能被看见和删掉。
    if per_app {
        if let (Some(app), Some(chosen)) = (app_name.as_deref(), request.target_override.as_deref())
        {
            if settings.app_target_langs.get(app).map(String::as_str) != Some(chosen) {
                let mut updated = settings.clone();
                updated
                    .app_target_langs
                    .insert(app.to_string(), chosen.to_string());
                // 存不下也不影响这次翻译，只是下次还得再选一次。
                if updated.save(&state.config_dir).is_ok() {
                    *state.settings.lock().expect("设置锁不应中毒") = updated;
                }
            }
        }
    }
    let target_name = lang::display_name(&target_code);
    let source_name = source.map(lang::display_name);

    // 内置与用户自建预设走同一条查找路径（PRD §5.7）；浮窗重译可以覆盖这一次。
    let style = resolve_style(&settings, request);

    // 术语表（PRD §5.8）：按语言对筛选、只取命中的术语、跨表去重后渲染成一段。
    // 没有任何命中时是 None，`{glossary}` 段也就不会出现在 Prompt 里。
    let glossary_block = {
        let store = state.glossaries.lock().expect("术语表锁不应中毒");
        crate::glossaries::Glossaries::block_for(&store.lists, source, &target_code, text)
    };

    let vars = prompt::PromptVars {
        source_lang: source_name.as_deref(),
        target_lang: &target_name,
        glossary: glossary_block.as_deref(),
        app_name: None,
    };

    // 单选一个词（≤3 个词）时走词卡（PRD §5.2），其余的走普通翻译。
    // 判定与 Prompt 都来自核心层的同一份实现，客户端不重复写一遍。
    let word_mode = umuo_core::word_card::is_word_mode(text);
    let chat = if word_mode {
        umuo_core::word_card::build_request(text, &vars)
    } else {
        prompt::build_translation_request(&style, &vars, text)
    };

    let primary = ModelRef {
        provider_id: provider.id.to_string(),
        model: model.clone(),
    };
    // 分场景模型 + 用户的备用顺序（PRD §6.3）。两者都允许指向**另一家供应商**，
    // 所以下面的循环必须按候选逐个解析供应商与 Key。
    let mut plan = router::build_plan(
        mode.scene(),
        Some(&primary),
        &settings.scene_models,
        &settings.fallback_models,
    );

    state.cancel.store(false, Ordering::Relaxed);

    let _ = app.emit_to(
        surface,
        EVENT_START,
        StartPayload {
            text: text.to_string(),
            provider: provider.label.to_string(),
            model: model.clone(),
            target_lang: target_name.clone(),
            word_mode,
            mode: mode.as_str(),
        },
    );

    // ---------------------------------------------------------------
    // PRD §6.3：超过模型上下文 70% 时按段落切分**并发**请求，结果按顺序合并。
    //
    // 词卡模式永不切分：它处理的本来就是 ≤3 个词。
    //
    // 有意的简化：分片路径只用计划里的**首选**候选，不做逐片故障转移。
    // 逐片重试要按片重放并对齐顺序，复杂度上一个台阶；长文本先保证「能翻完」。
    // 这条简化记在 docs/PRD-CONFORMANCE.md 里。
    // ---------------------------------------------------------------
    let context_tokens = provider::context_window_for(&model);
    if !word_mode && chunk::needs_splitting(text, context_tokens) {
        let chunks = chunk::split(
            text,
            chunk::char_budget(context_tokens, chunk::cjk_ratio(text)),
        );
        let candidate = plan.candidates.first().ok_or(CoreError::NoEngine)?;
        let candidate_provider =
            provider::find_provider(&candidate.provider_id).ok_or(CoreError::NoEngine)?;
        let candidate_key = state
            .secrets
            .get(candidate_provider.id)
            .map_err(|e| CoreError::BadResponse {
                detail: format!("读取 Keychain 失败：{e}"),
            })?
            .unwrap_or_default();
        if candidate_provider.requires_key() && candidate_key.trim().is_empty() {
            return Err(CoreError::MissingKey);
        }
        let candidate_base_url = settings.base_url_override(candidate_provider)?;

        // 每片各建一个请求体：`{text}` 变量不同，system 与风格保持一致。
        let requests: Vec<_> = chunks
            .iter()
            .map(|piece| prompt::build_translation_request(&style, &vars, &piece.text))
            .collect();

        let options = StreamOptions {
            timeout: plan.timeout,
            cancel: Some(&state.cancel),
        };
        let mut sink = |delta: &str| {
            let _ = app.emit_to(
                surface,
                EVENT_DELTA,
                DeltaPayload {
                    text: delta.to_string(),
                },
            );
        };
        let mut offline = false;
        let mut outcome = run_chunks(
            &state.client,
            candidate_provider,
            candidate_base_url.as_deref(),
            &candidate.model,
            &candidate_key,
            &requests,
            &options,
            &mut sink,
        )
        .await;
        // 长文本同样要能离线回落，否则「短句离线能用、长段离线不能用」——
        // 用户看到的是同一个功能时好时坏。
        if let Err(error) = &outcome {
            if should_fall_back_to_local(error) {
                if let Some(local) = local_candidate(&state.client, &settings).await {
                    if let Some(local_provider) = provider::find_provider(&local.provider_id) {
                        offline = true;
                        outcome = run_chunks(
                            &state.client,
                            local_provider,
                            None,
                            &local.model,
                            "",
                            &requests,
                            &options,
                            &mut sink,
                        )
                        .await;
                    }
                }
            }
        }
        let outcome = outcome?;

        // 收尾与单请求路径同构（写回 → 费用 → 落库 → done）。
        // 两处刻意保持形似：分片路径不处理词卡，所以少了卡片那一段。
        let replaced = if mode.write_back() {
            write_back(app, guard, &outcome.text)?;
            true
        } else {
            false
        };
        let cost_usd = usage::builtin_price(candidate_provider.id, &candidate.model)
            .map(|price| usage::cost_usd(outcome.usage, price));

        crate::history::record(
            app,
            crate::history::Draft {
                source_text: text.to_string(),
                translated_text: outcome.text.clone(),
                source_lang: source.map(str::to_string),
                target_lang: target_name.clone(),
                provider_id: candidate_provider.id.to_string(),
                model: candidate.model.clone(),
                style_id: settings.style_id.clone(),
                scene: mode.as_str().to_string(),
                input_tokens: outcome.usage.input_tokens,
                output_tokens: outcome.usage.output_tokens,
                estimated: outcome.usage.estimated,
                cost_usd,
            },
        );

        emit_done(
            app,
            surface,
            &candidate.model,
            &outcome,
            DoneFacts {
                replaced,
                offline,
                cost_usd,
                warning: budget_warning.clone(),
            },
        );
        return Ok(());
    }

    let mut last_error: Option<CoreError> = None;
    // PRD §7.5：网络不通时改用本机模型，并标注「离线」。**只试一次**——
    // 本机也没有可用模型时不该反复探测。
    let mut offline_attempted = false;
    let mut offline = false;
    // 索引式而不是 `for ... in iter()`：离线回落要把本机候选**追加**进计划，
    // 迭代中改 `plan.candidates` 借用检查过不去。
    let mut index = 0;
    while index < plan.candidates.len() {
        let candidate = plan.candidates[index].clone();
        let attempt = index;
        index += 1;
        // 每个候选各自解析供应商、Key 与地址。
        //
        // **不能沿用循环外那套。** 分场景模型与备用顺序都可能指向另一家供应商，
        // 而 `ModelRef` 里带着 `provider_id`；沿用首选供应商会把 A 家的模型名
        // 发到 B 家的端点，得到一个「模型不存在」的 404——用户完全不知道为什么。
        let Some(candidate_provider) = provider::find_provider(&candidate.provider_id) else {
            continue;
        };
        let candidate_key = match state.secrets.get(candidate_provider.id) {
            Ok(Some(key)) if !key.trim().is_empty() => key,
            // 没配 Key 的候选直接跳过：拿空 Key 去请求只会得到 401，
            // 而它并不是「这次翻译失败」的真正原因。
            _ => continue,
        };
        // 自定义端点没填地址时要跳过这个候选，而不是把空地址发出去。
        let candidate_base_url = match settings.base_url_override(candidate_provider) {
            Ok(url) => url,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };

        let mut sink = |delta: &str| {
            // 词卡模式下模型返回的是 JSON，**不能**把它逐字打到界面上——
            // 用户会看到 `{"word":"hello","senses":[{"part_of_speech"` 这种半截结构。
            // 等整段回来解析成词卡再一次性推给前端。
            if word_mode {
                return;
            }
            let _ = app.emit_to(
                surface,
                EVENT_DELTA,
                DeltaPayload {
                    text: delta.to_string(),
                },
            );
        };

        let outcome = transport::stream_chat(
            &state.client,
            &ChatTarget {
                provider: candidate_provider,
                base_url: candidate_base_url.as_deref(),
                model: &candidate.model,
                api_key: &candidate_key,
                chat: &chat,
            },
            &StreamOptions {
                timeout: plan.timeout,
                cancel: Some(&state.cancel),
            },
            &mut sink,
        )
        .await;

        match outcome {
            Ok(outcome) => {
                // 静默翻译在这里把结果写回原处。**只在这一个分支里写回**——
                // 上面的任何失败路径都不会碰用户的内容，这是 §5.4 「失败时不修改原文」
                // 的落点：不是靠 try/finally，而是靠「只有成功才走到这里」。
                let replaced = if mode.write_back() {
                    write_back(app, guard, &outcome.text)?;
                    true
                } else {
                    false
                };

                let price = usage::builtin_price(candidate_provider.id, &candidate.model);
                let cost_usd = price.map(|p| usage::cost_usd(outcome.usage, p));

                // 词卡：解析成功后发结构化卡片；解析失败**降级为纯文本**（PRD §6.5）。
                // 降级时必须把原文补发一次——词卡模式下我们抑制了流式增量，
                // 否则界面上会是一片空白，用户以为翻译没出结果。
                let history_text = if word_mode {
                    match umuo_core::word_card::parse(&outcome.text) {
                        Ok(card) => {
                            let _ = app.emit_to(
                                surface,
                                EVENT_CARD,
                                CardPayload {
                                    word: card.word.clone(),
                                    phonetic: card.phonetic.clone(),
                                    senses: card
                                        .senses
                                        .iter()
                                        .map(|sense| CardSense {
                                            part_of_speech: sense.part_of_speech.clone(),
                                            definition: sense.definition.clone(),
                                        })
                                        .collect(),
                                    forms: card.forms.clone(),
                                    examples: card
                                        .examples
                                        .iter()
                                        .map(|example| CardExample {
                                            source: example.source.clone(),
                                            target: example.target.clone(),
                                        })
                                        .collect(),
                                },
                            );
                            // 历史里放用户真正读到的那句释义，而不是一整段 JSON。
                            card.senses
                                .first()
                                .map(|sense| sense.definition.clone())
                                .unwrap_or_else(|| card.word.clone())
                        }
                        Err(_) => {
                            let _ = app.emit_to(
                                surface,
                                EVENT_DELTA,
                                DeltaPayload {
                                    text: outcome.text.clone(),
                                },
                            );
                            outcome.text.clone()
                        }
                    }
                } else {
                    outcome.text.clone()
                };

                // 记历史。放在 emit 之前：浮窗显示与落库是同一次成功的两个后果，
                // 而落库失败只打日志、不影响用户看到译文。
                crate::history::record(
                    app,
                    crate::history::Draft {
                        source_text: text.to_string(),
                        translated_text: history_text,
                        source_lang: source.map(str::to_string),
                        target_lang: target_name.clone(),
                        provider_id: candidate_provider.id.to_string(),
                        model: candidate.model.clone(),
                        style_id: settings.style_id.clone(),
                        scene: mode.as_str().to_string(),
                        input_tokens: outcome.usage.input_tokens,
                        output_tokens: outcome.usage.output_tokens,
                        estimated: outcome.usage.estimated,
                        cost_usd,
                    },
                );

                emit_done(
                    app,
                    surface,
                    &candidate.model,
                    &outcome,
                    DoneFacts {
                        replaced,
                        offline,
                        cost_usd,
                        warning: budget_warning.clone(),
                    },
                );
                return Ok(());
            }
            Err(error) => {
                // PRD §7.5：网络断了的话，若本机有可用模型就改用它。
                // 排在路由故障转移**之前**：本地模型比「换个云端模型」更可能管用，
                // 而且后者在网络不通时同样会失败。
                if !offline_attempted && should_fall_back_to_local(&error) {
                    offline_attempted = true;
                    if let Some(local) = local_candidate(&state.client, &settings).await {
                        offline = true;
                        plan.candidates.push(local);
                        continue;
                    }
                }
                // 路由层决定这次失败值不值得换个模型再试（PRD §6.3）。
                if router::next_after_failure(&plan, attempt, &error).is_some() {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
        }
    }

    // 走到这里说明每个候选都失败了，或者全被跳过了（没配 Key、自定义端点没填地址）。
    // `NoEngine` 在两种情况下都不准确：用户明明配了引擎，只是这次没用上。
    Err(last_error.unwrap_or(CoreError::MissingKey))
}

/// 写回前的目标校验。
///
/// 抽成纯函数是为了能测：这是「不要把译文打进别的应用」这条保护的核心判断。
///
/// 三种情形的取舍：
/// - **前后都拿得到标识**：相等才放行。
/// - **之前拿得到、现在拿不到**：按「目标已变」处理。焦点多半跑到了我们观测不到的
///   进程上，宁可少替换一次，也不能替换错地方。
/// - **之前就拿不到**：没有可比对的信息，只能放行。否则在某些受限进程里静默翻译
///   会一律失败——功能直接等于没有。这里明确选择可用性优先，而不是假装风险不存在。
fn target_still_matches(before: Option<&str>, now: Option<String>) -> bool {
    match (before, now) {
        (Some(before), Some(now)) => before == now,
        (Some(_), None) => false,
        (None, _) => true,
    }
}

/// 把译文写回原处（PRD §5.4）。
pub(crate) fn write_back(
    app: &AppHandle,
    target: Option<&str>,
    text: &str,
) -> Result<(), CoreError> {
    let state = app.state::<AppState>();

    // 翻译花了几秒，用户完全可能已经切到别的窗口。这时写回等于把译文打进
    // 另一个应用——宁可不替换，也不能写错地方。
    if !target_still_matches(target, state.selection.frontmost_app_token()) {
        return Err(CoreError::WriteTargetChanged);
    }

    state
        .selection
        .replace_selection(text)
        .map_err(|error| CoreError::WriteBackFailed {
            detail: error.to_string(),
        })
}

fn emit_done(
    app: &AppHandle,
    surface: &'static str,
    model: &str,
    outcome: &transport::StreamOutcome,
    facts: DoneFacts,
) {
    let _ = app.emit_to(
        surface,
        EVENT_DONE,
        DonePayload {
            model: model.to_string(),
            input_tokens: outcome.usage.input_tokens,
            output_tokens: outcome.usage.output_tokens,
            estimated: outcome.usage.estimated,
            cost_usd: facts.cost_usd,
            first_token_ms: outcome.first_token_ms,
            total_ms: outcome.total_ms,
            replaced: facts.replaced,
            offline: facts.offline,
            warning: facts.warning,
        },
    );
}

/// 收尾要用的几个事实。
///
/// 打成一个结构体而不是四个散参数：它们一起产生、一起被消费，
/// 拆开后调用点会变成一串看不出含义的布尔与 Option（`true, false, None, ...`）。
struct DoneFacts {
    replaced: bool,
    offline: bool,
    cost_usd: Option<f64>,
    /// 月度上限的提醒（超限了、换人了）。`None` = 无事发生。
    warning: Option<String>,
}

fn emit_core_error(app: &AppHandle, surface: &'static str, error: &CoreError) {
    let _ = app.emit_to(
        surface,
        EVENT_ERROR,
        ErrorPayload {
            message: error.to_string(),
            actions: error.actions(),
            needs_permission: false,
            permission: None,
        },
    );
}

fn emit_platform_error(app: &AppHandle, error: &PlatformError) {
    let _ = app.emit_to(
        PANEL_LABEL,
        EVENT_ERROR,
        ErrorPayload {
            message: error.to_string(),
            actions: Vec::new(),
            needs_permission: error.is_permission_problem(),
            // 走到这里的一律是取词路径（截图那条另有自己的提示）。
            permission: error.is_permission_problem().then_some("accessibility"),
        },
    );
}

/// 让浮窗显示一条**不来自翻译引擎**的提示（截图失败、识别不到文字、缺权限…）。
///
/// 复用同一个事件与同一个浮窗：用户按了快捷键就该在同一个地方看到结果，
/// 而不是「有的功能弹浮窗、有的功能什么都不显示」。
pub fn emit_notice(app: &AppHandle, message: &str, permission: Option<&'static str>) {
    let _ = app.emit_to(
        PANEL_LABEL,
        EVENT_ERROR,
        ErrorPayload {
            message: message.to_string(),
            actions: Vec::new(),
            needs_permission: permission.is_some(),
            permission,
        },
    );
    show_panel_near_cursor(app);
}

/// 是否应当因为「用户切到了别的应用」而收起浮窗（PRD §7.1：失焦关闭，可钉住）。
///
/// 为什么不用窗口的失焦事件：浮窗是**非激活**窗口，它在创建时就不接受焦点
/// （`focused(false)`），因此没有可靠的 blur 事件可听。而「用户切走了」
/// 才是他真正想收起浮窗的信号——所以用前台应用标识判定。
///
/// 拿不到标识时**不收起**：宁可让浮窗多留一会儿，也不能让用户正在读的东西凭空消失。
pub fn should_auto_hide(pinned: bool, owner: Option<&str>, current: Option<String>) -> bool {
    if pinned {
        return false;
    }
    match (owner, current.as_deref()) {
        (Some(owner), Some(current)) => owner != current,
        _ => false,
    }
}

/// 把浮窗放到鼠标附近。
///
/// 精确地贴在选区旁边需要 `AXBoundsForRange`（目前没做），所以先用鼠标位置——
/// 用户按快捷键时光标就在选区附近，误差在可接受范围内。
/// 「精确锚定到选区」列为后续项。
fn show_panel_near_cursor(app: &AppHandle) {
    show_panel_near_cursor_traced(app, None)
}

/// 同 [`show_panel_near_cursor`]，但可以带一个计时起点（PRD §8 实测用）。
///
/// 把实测与业务分开写成两个函数，是为了让业务路径不被迫接受一个
/// 只有测量才需要的参数——埋点可以删，业务不能因为埋点而变丑。
fn show_panel_near_cursor_traced(app: &AppHandle, wake_started: Option<std::time::Instant>) {
    let Some(panel) = app.get_webview_window(PANEL_LABEL) else {
        return;
    };
    if let Ok(cursor) = app.cursor_position() {
        let _ = panel.set_position(tauri::PhysicalPosition::new(
            cursor.x + 14.0,
            cursor.y + 18.0,
        ));
    }
    let _ = panel.show();

    // 记下「这次翻译属于哪个应用」：看门狗据此判断用户是不是切走了。
    //
    // **放在 show() 之后**：这也是一次 AX 往返（实测十几毫秒），而它只服务于
    // 500ms 一轮的看门狗——排在显示前面就是白白拖慢 PRD §8 的唤起速度。
    {
        let state = app.state::<AppState>();
        *state.panel_owner.lock().expect("浮窗归属锁不应中毒") =
            state.selection.frontmost_app_token();
    }

    if let Some(started) = wake_started {
        // 一行一个数，方便直接 grep 出来做统计。PRD §8 的门槛是 150ms。
        eprintln!(
            "umuo: 唤起耗时 {}ms（按键→浮窗出现，不含取词以外的模型响应）",
            started.elapsed().as_millis()
        );
    }
}

#[cfg(test)]
mod override_tests {
    use super::*;
    use crate::settings::Settings;

    fn provider() -> &'static provider::Provider {
        provider::find_provider("openai").unwrap()
    }

    #[test]
    fn without_overrides_the_settings_win() {
        // 回归保护：浮窗重译引入的三个覆盖，绝不能改掉默认路径的行为。
        let settings = Settings {
            provider_id: "deepseek".to_string(),
            model: "deepseek-chat".to_string(),
            style_id: "academic".to_string(),
            ..Settings::default()
        };
        let request = Request::selection("hello");
        assert_eq!(resolve_provider_id(&settings, &request), "deepseek");
        assert_eq!(
            resolve_model(&settings, provider(), &request),
            "deepseek-chat"
        );
        assert_eq!(resolve_style(&settings, &request).id, "academic");
    }

    #[test]
    fn an_explicit_provider_override_wins() {
        let settings = Settings::default();
        let request = Request::retranslate(
            "hello",
            Mode::Selection,
            Some("anthropic".into()),
            None,
            None,
        );
        assert_eq!(resolve_provider_id(&settings, &request), "anthropic");
    }

    #[test]
    fn an_explicit_model_override_wins_over_the_configured_model() {
        // 这正是「切换模型重译」的意义：临时用别的模型，而设置里仍留着原来的。
        let settings = Settings {
            model: "gpt-4o-mini".to_string(),
            ..Settings::default()
        };
        let request =
            Request::retranslate("hello", Mode::Selection, None, Some("gpt-4o".into()), None);
        assert_eq!(resolve_model(&settings, provider(), &request), "gpt-4o");
        // 设置本身没被改动。
        assert_eq!(settings.model, "gpt-4o-mini");
    }

    #[test]
    fn a_blank_model_override_falls_back_instead_of_sending_an_empty_name() {
        // 空模型名发出去只会 404；这里应当回落，而不是把空串当成「用户的选择」。
        let settings = Settings {
            model: "gpt-4o-mini".to_string(),
            ..Settings::default()
        };
        let request =
            Request::retranslate("hello", Mode::Selection, None, Some("   ".into()), None);
        assert_eq!(
            resolve_model(&settings, provider(), &request),
            "gpt-4o-mini"
        );
    }

    #[test]
    fn an_empty_configured_model_falls_back_to_the_provider_default() {
        let settings = Settings {
            model: String::new(),
            ..Settings::default()
        };
        let request = Request::selection("hello");
        assert_eq!(
            resolve_model(&settings, provider(), &request),
            "gpt-4o-mini"
        );
    }

    #[test]
    fn a_style_override_resolves_against_custom_presets_too() {
        // 自建预设与内置走同一条查找路径（PRD §5.7），覆盖也应如此。
        let settings = Settings::default();
        let request = Request::retranslate(
            "hello",
            Mode::Selection,
            None,
            None,
            Some("academic".into()),
        );
        assert_eq!(resolve_style(&settings, &request).id, "academic");

        let unknown =
            Request::retranslate("hello", Mode::Selection, None, None, Some("nope".into()));
        assert_eq!(
            resolve_style(&settings, &unknown).id,
            umuo_core::prompt::DEFAULT_STYLE_ID,
            "不认识的风格要回落，而不是失败"
        );
    }
}

#[cfg(test)]
mod mode_tests {
    use super::*;

    #[test]
    fn mode_strings_round_trip() {
        // 前端按这个字符串决定展示文案，改了就是破坏性变更。
        for mode in [
            Mode::Selection,
            Mode::SilentReplace,
            Mode::Compose,
            Mode::Ocr,
        ] {
            assert_eq!(Mode::from_id(mode.as_str()), Some(mode));
        }
        assert_eq!(Mode::from_id("nonsense"), None);
    }

    #[test]
    fn retranslate_defaults_to_selection() {
        assert_eq!(retranslate_mode(None).unwrap(), Mode::Selection);
        assert_eq!(retranslate_mode(Some("")).unwrap(), Mode::Selection);
        assert_eq!(retranslate_mode(Some("  ")).unwrap(), Mode::Selection);
    }

    #[test]
    fn retranslate_keeps_the_ocr_mode_so_the_source_stays_editable() {
        // 这条是「可编辑后重译」能**反复**用的前提：重译后模式退回 selection 的话，
        // 原文立刻又变成只读，用户只能改一次。
        assert_eq!(retranslate_mode(Some("ocr")).unwrap(), Mode::Ocr);
    }

    #[test]
    fn retranslate_refuses_modes_that_have_their_own_entry_points() {
        // 撰写窗的结果要去另一个窗口；静默替换会真的改写用户的文档。
        // 浮窗的重译按钮不该有通道触发它们。
        assert!(retranslate_mode(Some("compose")).is_err());
        assert!(retranslate_mode(Some("silentReplace")).is_err());
        assert!(retranslate_mode(Some("nonsense")).is_err());
    }
}

#[cfg(test)]
mod offline_fallback_tests {
    use super::*;

    #[test]
    fn only_network_errors_count_as_being_offline() {
        // 限流、Key 无效、余额不足、上下文超长换成本机模型也解决不了。
        // 把它们也当「离线」，用户会看到「离线」字样却仍然失败——比不标更困惑。
        assert!(should_fall_back_to_local(&CoreError::Network {
            message: "无法连接".to_string()
        }));

        for error in [
            CoreError::ServerError { status: 429 },
            CoreError::ServerError { status: 401 },
            CoreError::MissingKey,
            CoreError::NoEngine,
            CoreError::Cancelled,
            CoreError::ContextTooLong,
            CoreError::WriteTargetChanged,
            CoreError::CustomEndpointMissing,
        ] {
            assert!(
                !should_fall_back_to_local(&error),
                "{error:?} 不该触发离线回落"
            );
        }
    }
}

#[cfg(test)]
mod override_source_tests {
    use super::*;

    #[test]
    fn without_a_pin_the_detected_language_is_used() {
        let request = Request::selection("hello");
        assert_eq!(resolve_source(&request, Some("en")), Some("en"));
        assert_eq!(resolve_source(&request, None), None);
    }

    #[test]
    fn a_pinned_source_language_wins_over_detection() {
        // 自动检测对短句经常猜不准，而用户明确知道自己在翻什么语言。
        let request = Request::with_overrides(
            "hello",
            Mode::Compose,
            Overrides {
                source_lang: Some("ja".to_string()),
                ..Overrides::default()
            },
        );
        assert_eq!(resolve_source(&request, Some("en")), Some("ja"));
    }

    #[test]
    fn a_blank_pin_counts_as_not_pinned() {
        // 界面上的「自动检测」选项会传空串或空值，不该被当成一个语言码。
        let request = Request::with_overrides(
            "hello",
            Mode::Compose,
            Overrides {
                source_lang: Some("   ".to_string()),
                ..Overrides::default()
            },
        );
        assert_eq!(resolve_source(&request, Some("en")), Some("en"));
    }

    #[test]
    fn blank_overrides_are_dropped_instead_of_becoming_empty_values() {
        // 空串传下去会变成「用一个空语言码翻译」或「用一个空风格 id」——
        // 后者会被 `find_style_with` 兜底，前者会让目标语言切换规则失灵。
        let request = Request::with_overrides(
            "hi",
            Mode::Compose,
            Overrides {
                source_lang: Some(String::new()),
                target_lang: Some("  ".to_string()),
                provider_id: Some(String::new()),
                model: Some(String::new()),
                style_id: Some(String::new()),
            },
        );
        assert!(request.source_override.is_none());
        assert!(request.target_override.is_none());
        assert!(request.provider_override.is_none());
        assert!(request.model_override.is_none());
        assert!(request.style_override.is_none());
    }

    #[test]
    fn real_overrides_survive_trimming() {
        let request = Request::with_overrides(
            "hi",
            Mode::Compose,
            Overrides {
                source_lang: Some(" en ".to_string()),
                target_lang: Some("zh-TW".to_string()),
                provider_id: Some("deepseek".to_string()),
                model: Some("deepseek-chat".to_string()),
                style_id: Some("academic".to_string()),
            },
        );
        assert_eq!(request.source_override.as_deref(), Some(" en "));
        assert_eq!(request.target_override.as_deref(), Some("zh-TW"));
        assert_eq!(request.provider_override.as_deref(), Some("deepseek"));
        assert_eq!(request.model_override.as_deref(), Some("deepseek-chat"));
        assert_eq!(request.style_override.as_deref(), Some("academic"));
    }
}

#[cfg(test)]
mod panel_auto_hide_tests {
    use super::*;

    #[test]
    fn switching_to_another_app_hides_the_panel() {
        assert!(should_auto_hide(
            false,
            Some("app-A"),
            Some("app-B".to_string())
        ));
    }

    #[test]
    fn staying_in_the_same_app_keeps_it_open() {
        assert!(!should_auto_hide(
            false,
            Some("app-A"),
            Some("app-A".to_string())
        ));
    }

    #[test]
    fn a_pinned_panel_never_auto_hides() {
        // 「可钉住」的全部含义就在这一条。
        assert!(!should_auto_hide(
            true,
            Some("app-A"),
            Some("app-B".to_string())
        ));
    }

    #[test]
    fn an_unreadable_token_never_hides_the_panel() {
        // 读不到前台应用时宁可多留一会儿，也不能让用户正在读的浮窗凭空消失。
        assert!(!should_auto_hide(false, Some("app-A"), None));
        assert!(!should_auto_hide(false, None, Some("app-B".to_string())));
        assert!(!should_auto_hide(false, None, None));
    }
}

#[cfg(test)]
mod chunk_routing_tests {
    use umuo_core::{chunk, provider};

    /// 一段长文：约 3 万字符的中文（≈3 万 token）。
    fn long_chinese() -> String {
        "这是一段用于测试长文本切分的中文段落。".repeat(1_500)
    }

    #[test]
    fn a_short_text_goes_down_the_single_request_path_for_every_model() {
        // 常见翻译都是短句，绝不该因为切分逻辑而多花请求。
        for model in ["gpt-4o-mini", "claude-sonnet-4-5", "llama3.1:8b"] {
            assert!(
                !chunk::needs_splitting("你好，世界。", provider::context_window_for(model)),
                "{model} 不该为一句短话切分"
            );
        }
    }

    #[test]
    fn the_same_text_splits_or_not_depends_on_the_model_window() {
        // 这正是「按模型上下文决定是否切分」的意义：
        // 同一段文本，128k 的模型一次装得下，8k 的本地模型必须切开。
        let text = long_chinese();
        let big = provider::context_window_for("gpt-4o");
        let small = provider::context_window_for("llama3.1:8b");

        assert!(!chunk::needs_splitting(&text, big), "128k 模型不该切");
        assert!(chunk::needs_splitting(&text, small), "8k 模型必须切");

        // 切出来的每一片都要装得下。
        let budget = chunk::char_budget(small, chunk::cjk_ratio(&text));
        let pieces = chunk::split(&text, budget);
        assert!(pieces.len() > 1);
        for piece in &pieces {
            assert!(
                piece.text.chars().count() <= budget,
                "有分片超过预算：{} > {budget}",
                piece.text.chars().count()
            );
        }
    }

    #[test]
    fn chunk_indices_are_contiguous_from_zero_so_ordered_merge_is_safe() {
        // 并发返回后靠 index 归位；索引若不连续或从 1 开始，合并会错位。
        let text = long_chinese();
        let budget = chunk::char_budget(
            provider::context_window_for("llama3.1:8b"),
            chunk::cjk_ratio(&text),
        );
        let pieces = chunk::split(&text, budget);
        for (expected, piece) in pieces.iter().enumerate() {
            assert_eq!(piece.index, expected);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_back_proceeds_when_the_same_app_is_still_frontmost() {
        assert!(target_still_matches(Some("4711"), Some("4711".to_string())));
    }

    #[test]
    fn write_back_is_refused_when_the_user_switched_apps() {
        // 这条是「不要把译文打进别的应用」保护的核心断言。
        assert!(!target_still_matches(
            Some("4711"),
            Some("9911".to_string())
        ));
    }

    #[test]
    fn write_back_is_refused_when_the_frontmost_app_becomes_unknown() {
        // 之前能看到、之后看不到了，多半是焦点跑到了我们观测不到的进程上——
        // 这种情况必须当成「目标可能已变」，而不是乐观放行。
        assert!(!target_still_matches(Some("4711"), None));
    }

    #[test]
    fn write_back_is_allowed_when_no_token_was_ever_observable() {
        // 两侧都拿不到标识（某些受限进程）：这里选择可用性优先。
        // 若改成拒绝，静默翻译在这些环境下会一律失败——功能等于没有。
        assert!(target_still_matches(None, None));
        assert!(target_still_matches(None, Some("4711".to_string())));
    }

    #[test]
    fn mode_labels_are_the_frontend_contract() {
        // 前端按这些字符串决定展示文案，改了就是破坏性变更。
        assert_eq!(Mode::Selection.as_str(), "selection");
        assert_eq!(Mode::SilentReplace.as_str(), "silentReplace");
        assert_eq!(Mode::Compose.as_str(), "compose");
        assert_eq!(Mode::Ocr.as_str(), "ocr");
    }

    #[test]
    fn only_silent_replace_writes_back() {
        // 写回是破坏性动作，只允许静默翻译做。将来新增模式时这条会拦住
        // 「不小心让它继承了写回行为」。
        assert!(Mode::SilentReplace.write_back());
        for mode in [Mode::Selection, Mode::Compose, Mode::Ocr] {
            assert!(!mode.write_back(), "{mode:?} 不该写回原文");
        }
    }
}
