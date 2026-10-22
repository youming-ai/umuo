//! 翻译与对比事件的 FFI 镜像，以及把它们推给 Swift 的两个 sink。
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
    /// 撰写窗的回译：结果放进单独的区域，不覆盖主译文。
    pub back: bool,
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
        forms: Vec<String>,
        examples: Vec<CardExample>,
    },
    Done {
        warning: Option<String>,
        model: String,
        input_tokens: u32,
        output_tokens: u32,
        estimated: bool,
        cost_usd: Option<f64>,
        first_token_ms: Option<u64>,
        total_ms: u64,
        replaced: bool,
        offline: bool,
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

#[derive(Debug, Clone, uniffi::Record)]
pub struct CardExample {
    pub source: String,
    pub target: String,
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

/// 发给对比窗的事件。
#[derive(Debug, Clone, uniffi::Enum)]
pub enum CompareEvent {
    Start {
        run_id: u64,
        text: String,
        target_lang: String,
        cards: Vec<CompareCard>,
    },
    Delta {
        run_id: u64,
        index: u32,
        text: String,
    },
    Done {
        run_id: u64,
        index: u32,
        model: String,
        total_ms: u64,
        first_token_ms: Option<u64>,
        input_tokens: u32,
        output_tokens: u32,
        estimated: bool,
        cost_usd: Option<f64>,
        truncated: bool,
    },
    Error {
        run_id: u64,
        index: u32,
        message: String,
    },
    /// 整窗级的提示（没有卡片时也要显示）。
    Notice { run_id: u64, message: String },
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct CompareCard {
    pub index: u32,
    pub provider_id: String,
    pub provider: String,
    pub model: String,
}

/// 收翻译事件的一方，由 Swift 实现。
///
/// 在 Rust 的 tokio 工作线程上**同步**调用：实现只能把事件塞进队列（`AsyncStream` 的 `yield`）就返回，
/// 不能 `DispatchQueue.main.sync`——主线程可能正等着 Engine 的同步方法，两边就互相卡住了。
#[uniffi::export(foreign)]
pub trait TranslateSink: Send + Sync {
    fn on_event(&self, route: Route, event: TranslateEvent);
}

/// 收对比事件的一方，由 Swift 实现。线程约定同 [`TranslateSink`]。
#[uniffi::export(foreign)]
pub trait CompareSink: Send + Sync {
    fn on_event(&self, event: CompareEvent);
}

/// 把 umuo-app 的事件换型后转给 Swift 的 sink。
pub(crate) struct ForwardTranslate(pub Arc<dyn TranslateSink>);

impl app::TranslateSink for ForwardTranslate {
    fn send(&self, route: app::Route, event: app::TranslateEvent) {
        self.0.on_event(route.into(), event.into());
    }
}

pub(crate) struct ForwardCompare(pub Arc<dyn CompareSink>);

impl app::CompareSink for ForwardCompare {
    fn send(&self, event: app::CompareEvent) {
        self.0.on_event(event.into());
    }
}

/// 下标是卡片序号（最多几张），装进 u32 绰绰有余；真溢出了说明上游出了大错，饱和比回绕安全。
fn index(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

impl From<app::Route> for Route {
    fn from(route: app::Route) -> Self {
        let app::Route {
            surface,
            request_id,
            back,
        } = route;
        Self {
            surface: surface.to_string(),
            request_id,
            back,
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
                forms,
                examples,
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
                forms,
                examples: examples
                    .into_iter()
                    .map(|app::CardExample { source, target }| CardExample { source, target })
                    .collect(),
            },
            app::TranslateEvent::Done(app::DonePayload {
                warning,
                model,
                input_tokens,
                output_tokens,
                estimated,
                cost_usd,
                first_token_ms,
                total_ms,
                replaced,
                offline,
            }) => Self::Done {
                warning,
                model,
                input_tokens,
                output_tokens,
                estimated,
                cost_usd,
                first_token_ms,
                total_ms,
                replaced,
                offline,
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

impl From<app::CompareEvent> for CompareEvent {
    fn from(event: app::CompareEvent) -> Self {
        match event {
            app::CompareEvent::Start(app::CompareStartPayload {
                run_id,
                text,
                target_lang,
                cards,
            }) => Self::Start {
                run_id,
                text,
                target_lang,
                cards: cards
                    .into_iter()
                    .map(
                        |app::CompareCard {
                             index: i,
                             provider_id,
                             provider,
                             model,
                         }| CompareCard {
                            index: index(i),
                            provider_id,
                            provider,
                            model,
                        },
                    )
                    .collect(),
            },
            app::CompareEvent::Delta(app::CompareDeltaPayload {
                run_id,
                index: i,
                text,
            }) => Self::Delta {
                run_id,
                index: index(i),
                text,
            },
            app::CompareEvent::Done(app::CompareDonePayload {
                run_id,
                index: i,
                model,
                total_ms,
                first_token_ms,
                input_tokens,
                output_tokens,
                estimated,
                cost_usd,
                truncated,
            }) => Self::Done {
                run_id,
                index: index(i),
                model,
                total_ms,
                first_token_ms,
                input_tokens,
                output_tokens,
                estimated,
                cost_usd,
                truncated,
            },
            app::CompareEvent::Error(app::CompareErrorPayload {
                run_id,
                index: i,
                message,
            }) => Self::Error {
                run_id,
                index: index(i),
                message,
            },
            app::CompareEvent::Notice(app::CompareNoticePayload { run_id, message }) => {
                Self::Notice { run_id, message }
            }
        }
    }
}
