//! 语音后处理（`umuo_app::voice`）的导出：同语言整理 / 翻译到目标语言。只做换型，规则与测试在 `umuo-app`。
//!
//! 与文字翻译同一套异步约定（见 [`crate::engine`] 文件头）：**同步启动、立即返回句柄**，
//! 结果经 [`VoiceSink`] 推回，取消走 [`RequestHandle::cancel`]。不做成 `async fn`：UniFFI 的 Swift
//! 绑定传不进取消，用户按 Esc 之后请求照跑、照计费。
//!
//! 不登记 `Requests`：语音的会话号与迟到判定在 `voice_session` 状态机里，句柄的 id 就是会话号。

use std::future::Future;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use umuo_app::voice as app;

use crate::engine::{Engine, RequestHandle};

/// 整理还是翻译，见 `umuo_core::voice::VoiceTask`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum VoiceTask {
    /// 同语言整理：去口头语、去重复、补标点、处理明确的自我纠正。
    Tidy,
    /// 翻译至目标语言。
    Translate,
}

impl From<VoiceTask> for app::VoiceTask {
    fn from(task: VoiceTask) -> Self {
        match task {
            VoiceTask::Tidy => Self::Tidy,
            VoiceTask::Translate => Self::Translate,
        }
    }
}

impl From<app::VoiceTask> for VoiceTask {
    fn from(task: app::VoiceTask) -> Self {
        match task {
            app::VoiceTask::Tidy => Self::Tidy,
            app::VoiceTask::Translate => Self::Translate,
        }
    }
}

/// 一次语音后处理的输入，见 `umuo_app::voice::VoiceRequest`。
#[derive(Debug, Clone, uniffi::Record)]
pub struct VoicePostRequest {
    pub transcript: String,
    pub task: VoiceTask,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

impl From<VoicePostRequest> for app::VoiceRequest {
    fn from(request: VoicePostRequest) -> Self {
        let VoicePostRequest {
            transcript,
            task,
            source_lang,
            target_lang,
        } = request;
        Self {
            transcript,
            task: task.into(),
            source_lang,
            target_lang,
        }
    }
}

/// 一次成功的语音后处理，见 `umuo_app::voice::VoiceOutput`。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VoicePostOutput {
    pub task: VoiceTask,
    pub text: String,
    pub transcript: String,
    pub source_lang: Option<String>,
    pub output_lang: Option<String>,
    pub provider: String,
    pub provider_id: String,
    pub model: String,
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
    /// 输出没说完：可展示与复制，不得自动交付。
    pub truncated: bool,
}

impl From<app::VoiceOutput> for VoicePostOutput {
    fn from(output: app::VoiceOutput) -> Self {
        let app::VoiceOutput {
            task,
            text,
            transcript,
            source_lang,
            output_lang,
            provider,
            provider_id,
            model,
            usage: _,
            first_token_ms,
            total_ms,
            truncated,
        } = output;
        Self {
            task: task.into(),
            text,
            transcript,
            source_lang,
            output_lang,
            provider,
            provider_id,
            model,
            first_token_ms,
            total_ms,
            truncated,
        }
    }
}

/// 失败的类别，见 `umuo_app::voice::VoiceFailureKind`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum VoicePostFailureKind {
    EmptyTranscript,
    EmptyResult,
    Untranslated,
    /// 配置、Key、网络、供应商或取消；文案在 `message`。
    Failed,
}

/// 一次失败，见 `umuo_app::voice::VoiceFailure`。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VoicePostFailure {
    pub kind: VoicePostFailureKind,
    /// 给用户看的中文说明（内核错误的 Display）。
    pub message: String,
    /// 原转写，原样保留。
    pub transcript: String,
    /// 用同一段转写再试一次是否可能有用。
    pub retryable: bool,
    /// 用户取消（含被新会话顶掉）。
    pub cancelled: bool,
}

impl From<app::VoiceFailure> for VoicePostFailure {
    fn from(failure: app::VoiceFailure) -> Self {
        let kind = match &failure.kind {
            app::VoiceFailureKind::EmptyTranscript => VoicePostFailureKind::EmptyTranscript,
            app::VoiceFailureKind::EmptyResult => VoicePostFailureKind::EmptyResult,
            app::VoiceFailureKind::Untranslated => VoicePostFailureKind::Untranslated,
            app::VoiceFailureKind::Failed(_) => VoicePostFailureKind::Failed,
        };
        Self {
            kind,
            message: failure.to_string(),
            retryable: failure.retryable(),
            cancelled: failure.is_cancelled(),
            transcript: failure.transcript,
        }
    }
}

/// 后处理的结果。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum VoicePostResult {
    Done { output: VoicePostOutput },
    Failed { failure: VoicePostFailure },
}

/// 收语音后处理结果的一方，由 Swift 实现。
///
/// 在 Rust 的 tokio 工作线程上**同步**调用，每次请求恰好一次：实现只把结果交出去（例如 resume 一个
/// continuation）就返回，不能 `DispatchQueue.main.sync`（同 [`crate::event::TranslateSink`]）。
#[uniffi::export(foreign)]
pub trait VoiceSink: Send + Sync {
    fn on_result(&self, session: u64, result: VoicePostResult);
}

#[uniffi::export]
impl Engine {
    /// 开始一次语音后处理（整理或翻译），立即返回。`session` 是语音会话号，原样带回 sink 与句柄 id。
    ///
    /// 成功且完整的结果按历史规则记一条（场景 `voice`，尊重「关闭记录」与隐私模式），截断与失败不记。
    pub fn start_voice(
        &self,
        session: u64,
        request: VoicePostRequest,
        sink: Arc<dyn VoiceSink>,
    ) -> Arc<RequestHandle> {
        let cancel = Arc::new(AtomicBool::new(false));
        let transcript = request.transcript.clone();
        let future = self.core.post_process_voice(request.into(), cancel.clone());
        self.spawn_voice(session, transcript, future, sink);
        Arc::new(RequestHandle::new(session, cancel))
    }
}

impl Engine {
    /// 跑一次后处理并把结果交给 sink；`work` 没跑完就中止时改交一个失败，Swift 的 continuation 不会悬着。
    pub(crate) fn spawn_voice(
        &self,
        session: u64,
        transcript: String,
        work: impl Future<Output = Result<app::VoiceOutput, app::VoiceFailure>> + Send + 'static,
        sink: Arc<dyn VoiceSink>,
    ) {
        let lost_sink = sink.clone();
        self.spawn_guarded(
            async move {
                let result = match work.await {
                    Ok(output) => VoicePostResult::Done {
                        output: output.into(),
                    },
                    Err(failure) => VoicePostResult::Failed {
                        failure: failure.into(),
                    },
                };
                sink.on_result(session, result);
            },
            move || lost_sink.on_result(session, lost_result(transcript)),
        );
    }
}

/// 任务没跑完就中止（panic）时补交的失败；转写原样带回，可以再试。
fn lost_result(transcript: String) -> VoicePostResult {
    VoicePostResult::Failed {
        failure: VoicePostFailure {
            kind: VoicePostFailureKind::Failed,
            message: crate::event::LOST_MESSAGE.to_owned(),
            transcript,
            retryable: true,
            cancelled: false,
        },
    }
}
