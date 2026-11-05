//! 翻译流水线发给界面的事件。
//!
//! 流水线只认这里的事件和 [`TranslateSink`]，不碰任何窗口系统：
//! SwiftUI 客户端经 FFI 接收类型化事件。
//!
//! SwiftUI 不走 JSON，也不按事件名订阅；这里的 `Serialize` 与 [`TranslateEvent::name`]
//! 只剩 `tests/event_wire.rs` 在用——它把旧更新通道时代的 JSON 契约作为黄金快照逐字节守着，
//! 当作字段语义的回归证据。

use serde::Serialize;
use umuo_core::error::SuggestedAction;

/// 事件发往哪里、属于哪一次请求。
///
/// 每个事件都带上请求 id：界面只认自己正在显示的那一次，
/// 被顶掉的旧请求迟到的增量、错误一律丢掉（审查 H2 / M1）。
#[derive(Clone, Copy, Debug)]
pub struct Route {
    pub surface: &'static str,
    pub request_id: u64,
}

/// 发给浮窗 / 撰写窗的翻译事件。快照测试里序列化为**载荷本身**（untagged），事件名见 [`TranslateEvent::name`]。
#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum TranslateEvent {
    Start(StartPayload),
    Delta(DeltaPayload),
    /// 单词词卡解析成功时发这个（PRD §5.2）。与 delta 互斥：词卡模式下增量被抑制，
    /// 整段 JSON 解析成结构后一次性推给界面。
    Card(CardPayload),
    Done(DonePayload),
    Error(ErrorPayload),
}

impl TranslateEvent {
    /// 旧更新通道时代的事件名。现在只有 `tests/event_wire.rs` 的快照用它，SwiftUI 经 FFI 按变体区分。
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
    /// 结果之外要说的一句话（目前只有「译文可能不完整」）。
    ///
    /// 单独一个字段而不是复用错误事件：翻译**成功了**，
    /// 把它渲染成错误块会让用户以为没翻出来。
    pub warning: Option<String>,
    /// 这次请求实际使用的模型。
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// 用量是本地估算的（厂商没回 usage）。
    pub estimated: bool,
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
    /// 译文是否已经写回原处。静默翻译成功时为 true——UI 据此告诉用户
    /// 「原文已经被换掉了」，而不是让他以为这只是个预览。
    pub replaced: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSense {
    pub part_of_speech: String,
    pub definition: String,
}

/// 单词词卡。字段与 `umuo_core::word_card::WordCard` 一一对应，
/// 但刻意分成两个类型：核心的领域类型与 IPC 契约各自演进，加字段时不会互相牵制。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardPayload {
    pub word: String,
    pub phonetic: Option<String>,
    pub senses: Vec<CardSense>,
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
