//! 翻译与对比流水线发给界面的事件。
//!
//! 流水线只认这里的事件和 [`TranslateSink`] / [`CompareSink`]，不碰任何窗口系统：
//! Tauri 外壳把它们转成 `translate://*`、`compare://*` 事件发给 webview，
//! SwiftUI 客户端以后经 FFI 收同样的事件。
//!
//! 载荷结构与字段顺序就是前端收到的 JSON 契约（外壳的黄金快照测试逐字节守着）：
//! 改字段名或顺序 = 改前端协议。

use serde::Serialize;
use umuo_core::error::SuggestedAction;

/// 事件发往哪里、属于哪一次请求。
///
/// 每个 translate:// 事件都带上请求 id：前端只认自己正在显示的那一次，
/// 被顶掉的旧请求迟到的增量、错误一律丢掉（审查 H2 / M1）。
#[derive(Clone, Copy, Debug)]
pub struct Route {
    pub surface: &'static str,
    pub request_id: u64,
    /// 撰写窗的回译。前端据此把它放进单独的区域，不覆盖主译文（审查 M16）。
    pub back: bool,
}

/// 发给浮窗 / 撰写窗的翻译事件。序列化为**载荷本身**（untagged），事件名见 [`TranslateEvent::name`]。
#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum TranslateEvent {
    Start(StartPayload),
    Delta(DeltaPayload),
    /// 单词词卡解析成功时发这个（PRD §5.2）。与 delta 互斥：词卡模式下增量被抑制，
    /// 整段 JSON 解析成结构后一次性推给前端。
    Card(CardPayload),
    Done(DonePayload),
    Error(ErrorPayload),
}

impl TranslateEvent {
    /// 前端订阅的事件名。
    pub fn name(&self) -> &'static str {
        match self {
            Self::Start(_) => "translate://start",
            Self::Delta(_) => "translate://delta",
            Self::Card(_) => "translate://card",
            Self::Done(_) => "translate://done",
            Self::Error(_) => "translate://error",
        }
    }
}

/// 收翻译事件的一方。实现必须立即返回（流式增量逐个过来）。
pub trait TranslateSink: Send + Sync {
    fn send(&self, route: Route, event: TranslateEvent);
}

/// 发给对比窗的事件。序列化为载荷本身（untagged），事件名见 [`CompareEvent::name`]。
#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum CompareEvent {
    Start(CompareStartPayload),
    Delta(CompareDeltaPayload),
    Done(CompareDonePayload),
    Error(CompareErrorPayload),
    /// 整窗级的提示（没有卡片时也要显示）。用单独的事件而不是 `index: 0` 的错误——
    /// 后者在没有卡片时会被丢掉，有旧卡片时又会挂到上一轮的第一张上（审查 M17）。
    Notice(CompareNoticePayload),
}

impl CompareEvent {
    pub fn name(&self) -> &'static str {
        match self {
            Self::Start(_) => "compare://start",
            Self::Delta(_) => "compare://delta",
            Self::Done(_) => "compare://done",
            Self::Error(_) => "compare://error",
            Self::Notice(_) => "compare://notice",
        }
    }
}

/// 收对比事件的一方（对比窗只有一个，所以不需要路由）。实现必须立即返回。
pub trait CompareSink: Send + Sync {
    fn send(&self, event: CompareEvent);
}

macro_rules! into_event {
    ($event:ident: $($payload:ident => $variant:ident),* $(,)?) => {
        $(impl From<$payload> for $event {
            fn from(payload: $payload) -> Self {
                Self::$variant(payload)
            }
        })*
    };
}
into_event!(TranslateEvent: StartPayload => Start, DeltaPayload => Delta, CardPayload => Card,
    DonePayload => Done, ErrorPayload => Error);
into_event!(CompareEvent: CompareStartPayload => Start, CompareDeltaPayload => Delta,
    CompareDonePayload => Done, CompareErrorPayload => Error, CompareNoticePayload => Notice);

// ---------------------------------------------------------------- 翻译事件载荷

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
    /// 出错的这次请求要翻的原文。取词失败、黑名单这类还没拿到原文的错误为 `None`。
    ///
    /// 在 start 之前就失败的请求（例如换到一个没配 Key 的模型），前端会清掉上一次的
    /// 内容；带上原文，浮窗才能继续显示「这次翻的是什么」，「重试」也才有东西可翻。
    pub source: Option<String>,
}

// ---------------------------------------------------------------- 对比事件载荷

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareCard {
    pub index: usize,
    /// 供应商**id**：前端要拿它拼「选它」的偏好键，展示名不能用来当键。
    pub provider_id: String,
    pub provider: String,
    pub model: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareStartPayload {
    /// 这一轮对比的 id。前端只认最新一轮的事件，上一轮迟到的增量一律丢掉（审查 M1）。
    pub run_id: u64,
    pub text: String,
    pub target_lang: String,
    pub cards: Vec<CompareCard>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareDeltaPayload {
    pub run_id: u64,
    pub index: usize,
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareDonePayload {
    pub run_id: u64,
    pub index: usize,
    pub model: String,
    /// 端到端耗时。对比场景里这是用户真正在比较的东西之一。
    pub total_ms: u64,
    pub first_token_ms: Option<u64>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub estimated: bool,
    pub cost_usd: Option<f64>,
    /// 译文不完整：输出触到长度上限，或连接在结束信号前断开（审查 M4）。
    /// 卡片照常显示这半段，但要标出来；也不进历史。
    pub truncated: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareErrorPayload {
    pub run_id: u64,
    pub index: usize,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareNoticePayload {
    pub run_id: u64,
    pub message: String,
}
