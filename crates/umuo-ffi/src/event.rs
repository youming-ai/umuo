//! 翻译事件的 FFI 镜像，以及把事件推给 Swift 的 sink。
//!
//! 结构与 `umuo_app::event` 一一对应，只做 FFI 需要的换型：`&'static str` 变 `String`、
//! `usize` 变 `u32`。`From` 一律用**不带 `..` 的解构**：umuo-app 的载荷加了字段，这里当场编译失败，
//! 而不是悄悄漏掉一个字段（迁移计划 §4「镜像类型的取舍」）。

use std::sync::Arc;

use umuo_app::event as app;
use umuo_core::error::SuggestedAction as CoreAction;

/// 事件发往哪个窗口、属于哪一次请求。Swift 端按 `request_id` 丢弃被顶掉的旧请求的迟到事件。
#[derive(Debug, Clone, uniffi::Record)]
pub struct Route {
    pub surface: String,
    pub request_id: u64,
}

/// 发给浮窗 / 撰写窗的翻译事件。
#[derive(Debug, Clone, uniffi::Enum)]
pub enum TranslateEvent {
    Start {
        text: String,
        provider: String,
        model: String,
        target_lang: String,
        word_mode: bool,
        /// `selection` / `silentReplace` / `compose` / `ocr`。
        mode: String,
    },
    Delta {
        text: String,
    },
    /// 单词词卡（与 Delta 互斥：词卡模式下增量被抑制）。
    Card {
        word: String,
        phonetic: Option<String>,
        senses: Vec<CardSense>,
    },
    Done {
        warning: Option<String>,
        model: String,
        input_tokens: u32,
        output_tokens: u32,
        estimated: bool,
        first_token_ms: Option<u64>,
        total_ms: u64,
        replaced: bool,
    },
    Error {
        message: String,
        actions: Vec<SuggestedAction>,
        needs_permission: bool,
        /// `accessibility` 或 `screenRecording`。
        permission: Option<String>,
        source: Option<String>,
    },
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct CardSense {
    pub part_of_speech: String,
    pub definition: String,
}

/// 错误卡片上建议的下一步。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SuggestedAction {
    Retry,
    SwitchModel,
    OpenModelSettings,
    CheckNetwork,
    UseLocalModel,
}

/// 收翻译事件的一方，由 Swift 实现。
///
/// 在 Rust 的 tokio 工作线程上**同步**调用：实现只能把事件塞进队列（`AsyncStream` 的 `yield`）就返回，
/// 不能 `DispatchQueue.main.sync`——主线程可能正等着 Engine 的同步方法，两边就互相卡住了。
#[uniffi::export(foreign)]
pub trait TranslateSink: Send + Sync {
    fn on_event(&self, route: Route, event: TranslateEvent);
}

/// 把 umuo-app 的事件换型后转给 Swift 的 sink。
pub(crate) struct ForwardTranslate(pub Arc<dyn TranslateSink>);

impl app::TranslateSink for ForwardTranslate {
    fn send(&self, route: app::Route, event: app::TranslateEvent) {
        self.0.on_event(route.into(), event.into());
    }
}

impl From<app::Route> for Route {
    fn from(route: app::Route) -> Self {
        let app::Route {
            surface,
            request_id,
        } = route;
        Self {
            surface: surface.to_string(),
            request_id,
        }
    }
}

impl From<CoreAction> for SuggestedAction {
    fn from(action: CoreAction) -> Self {
        match action {
            CoreAction::Retry => Self::Retry,
            CoreAction::SwitchModel => Self::SwitchModel,
            CoreAction::OpenModelSettings => Self::OpenModelSettings,
            CoreAction::CheckNetwork => Self::CheckNetwork,
            CoreAction::UseLocalModel => Self::UseLocalModel,
        }
    }
}

impl From<app::TranslateEvent> for TranslateEvent {
    fn from(event: app::TranslateEvent) -> Self {
        match event {
            app::TranslateEvent::Start(app::StartPayload {
                text,
                provider,
                model,
                target_lang,
                word_mode,
                mode,
            }) => Self::Start {
                text,
                provider,
                model,
                target_lang,
                word_mode,
                mode: mode.to_string(),
            },
            app::TranslateEvent::Delta(app::DeltaPayload { text }) => Self::Delta { text },
            app::TranslateEvent::Card(app::CardPayload {
                word,
                phonetic,
                senses,
            }) => Self::Card {
                word,
                phonetic,
                senses: senses
                    .into_iter()
                    .map(
                        |app::CardSense {
                             part_of_speech,
                             definition,
                         }| CardSense {
                            part_of_speech,
                            definition,
                        },
                    )
                    .collect(),
            },
            app::TranslateEvent::Done(app::DonePayload {
                warning,
                model,
                input_tokens,
                output_tokens,
                estimated,
                first_token_ms,
                total_ms,
                replaced,
            }) => Self::Done {
                warning,
                model,
                input_tokens,
                output_tokens,
                estimated,
                first_token_ms,
                total_ms,
                replaced,
            },
            app::TranslateEvent::Error(app::ErrorPayload {
                message,
                actions,
                needs_permission,
                permission,
                source,
            }) => Self::Error {
                message,
                actions: actions.into_iter().map(Into::into).collect(),
                needs_permission,
                permission: permission.map(str::to_string),
                source,
            },
        }
    }
}
