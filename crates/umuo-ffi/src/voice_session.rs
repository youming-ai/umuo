//! 语音会话状态机与模型清单的导出（`umuo_app::voice_session`）。只做换型，规则与测试在 `umuo-app`。
//!
//! 状态机是纯的、不回调宿主，所以 Swift 可以在主线程上直接调 [`VoiceSession::handle`]（同连按判定器）。

use std::path::Path;
use std::sync::Mutex;

use umuo_app::voice_session::{self as core, model};

use crate::voice::VoiceTask;

/// 出错的类别，见 `umuo_app::voice_session::ErrorKind`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum VoiceErrorKind {
    MicPermissionDenied,
    NoInputDevice,
    Recording,
    TooShort,
    NoSpeech,
    ModelUnavailable,
    Transcription,
    PostProcess,
}

impl From<core::ErrorKind> for VoiceErrorKind {
    fn from(kind: core::ErrorKind) -> Self {
        match kind {
            core::ErrorKind::MicPermissionDenied => Self::MicPermissionDenied,
            core::ErrorKind::NoInputDevice => Self::NoInputDevice,
            core::ErrorKind::Recording => Self::Recording,
            core::ErrorKind::TooShort => Self::TooShort,
            core::ErrorKind::NoSpeech => Self::NoSpeech,
            core::ErrorKind::ModelUnavailable => Self::ModelUnavailable,
            core::ErrorKind::Transcription => Self::Transcription,
            core::ErrorKind::PostProcess => Self::PostProcess,
        }
    }
}

impl From<VoiceErrorKind> for core::ErrorKind {
    fn from(kind: VoiceErrorKind) -> Self {
        match kind {
            VoiceErrorKind::MicPermissionDenied => Self::MicPermissionDenied,
            VoiceErrorKind::NoInputDevice => Self::NoInputDevice,
            VoiceErrorKind::Recording => Self::Recording,
            VoiceErrorKind::TooShort => Self::TooShort,
            VoiceErrorKind::NoSpeech => Self::NoSpeech,
            VoiceErrorKind::ModelUnavailable => Self::ModelUnavailable,
            VoiceErrorKind::Transcription => Self::Transcription,
            VoiceErrorKind::PostProcess => Self::PostProcess,
        }
    }
}

/// 宿主拒绝交付的原因，见 `umuo_app::voice_session::DeliveryRefusal`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum VoiceDeliveryRefusal {
    AppChanged,
    FocusChanged,
    NotEditable,
    SecureInput,
    TargetGone,
    Unverifiable,
    NoPermission,
    Failed,
}

impl From<core::DeliveryRefusal> for VoiceDeliveryRefusal {
    fn from(reason: core::DeliveryRefusal) -> Self {
        match reason {
            core::DeliveryRefusal::AppChanged => Self::AppChanged,
            core::DeliveryRefusal::FocusChanged => Self::FocusChanged,
            core::DeliveryRefusal::NotEditable => Self::NotEditable,
            core::DeliveryRefusal::SecureInput => Self::SecureInput,
            core::DeliveryRefusal::TargetGone => Self::TargetGone,
            core::DeliveryRefusal::Unverifiable => Self::Unverifiable,
            core::DeliveryRefusal::NoPermission => Self::NoPermission,
            core::DeliveryRefusal::Failed => Self::Failed,
        }
    }
}

impl From<VoiceDeliveryRefusal> for core::DeliveryRefusal {
    fn from(reason: VoiceDeliveryRefusal) -> Self {
        match reason {
            VoiceDeliveryRefusal::AppChanged => Self::AppChanged,
            VoiceDeliveryRefusal::FocusChanged => Self::FocusChanged,
            VoiceDeliveryRefusal::NotEditable => Self::NotEditable,
            VoiceDeliveryRefusal::SecureInput => Self::SecureInput,
            VoiceDeliveryRefusal::TargetGone => Self::TargetGone,
            VoiceDeliveryRefusal::Unverifiable => Self::Unverifiable,
            VoiceDeliveryRefusal::NoPermission => Self::NoPermission,
            VoiceDeliveryRefusal::Failed => Self::Failed,
        }
    }
}

/// 一次失败。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VoiceFailure {
    pub kind: VoiceErrorKind,
    /// 排查用的细节（引擎状态码、系统错误），界面不直接当文案。
    pub detail: String,
}

/// 当前会话处在哪一步，见 `umuo_app::voice_session::Phase`。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum VoicePhase {
    Idle,
    NeedsModel,
    Starting,
    Recording,
    Transcribing,
    PostProcessing {
        transcript: String,
    },
    Done {
        text: String,
        transcript: String,
        /// 后处理输出没说完：可展示、复制、重试，不交付。
        truncated: bool,
    },
    Delivering {
        text: String,
        transcript: String,
    },
    Undelivered {
        text: String,
        transcript: String,
        reason: VoiceDeliveryRefusal,
    },
    Failed {
        failure: VoiceFailure,
        transcript: Option<String>,
    },
    Cancelled,
}

impl From<&core::Phase> for VoicePhase {
    fn from(phase: &core::Phase) -> Self {
        match phase {
            core::Phase::Idle => Self::Idle,
            core::Phase::NeedsModel => Self::NeedsModel,
            core::Phase::Starting => Self::Starting,
            core::Phase::Recording => Self::Recording,
            core::Phase::Transcribing => Self::Transcribing,
            core::Phase::PostProcessing { transcript } => Self::PostProcessing {
                transcript: transcript.clone(),
            },
            core::Phase::Done {
                text,
                transcript,
                truncated,
            } => Self::Done {
                text: text.clone(),
                transcript: transcript.clone(),
                truncated: *truncated,
            },
            core::Phase::Delivering { text, transcript } => Self::Delivering {
                text: text.clone(),
                transcript: transcript.clone(),
            },
            core::Phase::Undelivered {
                text,
                transcript,
                reason,
            } => Self::Undelivered {
                text: text.clone(),
                transcript: transcript.clone(),
                reason: (*reason).into(),
            },
            core::Phase::Failed { error, transcript } => Self::Failed {
                failure: VoiceFailure {
                    kind: error.kind.into(),
                    detail: error.detail.clone(),
                },
                transcript: transcript.clone(),
            },
            core::Phase::Cancelled => Self::Cancelled,
        }
    }
}

/// 喂给状态机的事件，见 `umuo_app::voice_session::Input`。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum VoiceInput {
    Press {
        model_ready: bool,
        task: VoiceTask,
    },
    Release,
    Cancel,
    RecordingStarted {
        session: u64,
    },
    RecordingFailed {
        session: u64,
        kind: VoiceErrorKind,
        detail: String,
    },
    RecordingLimitReached {
        session: u64,
    },
    Recorded {
        session: u64,
        duration_ms: u64,
    },
    Transcribed {
        session: u64,
        text: String,
    },
    TranscriptionFailed {
        session: u64,
        kind: VoiceErrorKind,
        detail: String,
    },
    PostProcessed {
        session: u64,
        text: String,
        truncated: bool,
    },
    PostProcessFailed {
        session: u64,
        detail: String,
    },
    Retry,
    Delivered {
        session: u64,
    },
    DeliveryRefused {
        session: u64,
        reason: VoiceDeliveryRefusal,
    },
}

impl From<VoiceInput> for core::Input {
    fn from(input: VoiceInput) -> Self {
        match input {
            VoiceInput::Press { model_ready, task } => Self::Press {
                model_ready,
                task: task.into(),
            },
            VoiceInput::Release => Self::Release,
            VoiceInput::Cancel => Self::Cancel,
            VoiceInput::RecordingStarted { session } => Self::RecordingStarted { session },
            VoiceInput::RecordingFailed {
                session,
                kind,
                detail,
            } => Self::RecordingFailed {
                session,
                kind: kind.into(),
                detail,
            },
            VoiceInput::RecordingLimitReached { session } => {
                Self::RecordingLimitReached { session }
            }
            VoiceInput::Recorded {
                session,
                duration_ms,
            } => Self::Recorded {
                session,
                duration_ms,
            },
            VoiceInput::Transcribed { session, text } => Self::Transcribed { session, text },
            VoiceInput::TranscriptionFailed {
                session,
                kind,
                detail,
            } => Self::TranscriptionFailed {
                session,
                kind: kind.into(),
                detail,
            },
            VoiceInput::PostProcessed {
                session,
                text,
                truncated,
            } => Self::PostProcessed {
                session,
                text,
                truncated,
            },
            VoiceInput::PostProcessFailed { session, detail } => {
                Self::PostProcessFailed { session, detail }
            }
            VoiceInput::Retry => Self::Retry,
            VoiceInput::Delivered { session } => Self::Delivered { session },
            VoiceInput::DeliveryRefused { session, reason } => Self::DeliveryRefused {
                session,
                reason: reason.into(),
            },
        }
    }
}

/// 要宿主去做的事，见 `umuo_app::voice_session::Effect`。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum VoiceEffect {
    StartRecording {
        session: u64,
    },
    StopRecording {
        session: u64,
    },
    DiscardRecording {
        session: u64,
    },
    Transcribe {
        session: u64,
    },
    CancelTranscription {
        session: u64,
    },
    PostProcess {
        session: u64,
        text: String,
        task: VoiceTask,
    },
    CancelPostProcess {
        session: u64,
    },
    CleanupAudio {
        session: u64,
    },
    Deliver {
        session: u64,
        text: String,
    },
    CancelDelivery {
        session: u64,
    },
}

impl From<core::Effect> for VoiceEffect {
    fn from(effect: core::Effect) -> Self {
        match effect {
            core::Effect::StartRecording { session } => Self::StartRecording { session },
            core::Effect::StopRecording { session } => Self::StopRecording { session },
            core::Effect::DiscardRecording { session } => Self::DiscardRecording { session },
            core::Effect::Transcribe { session } => Self::Transcribe { session },
            core::Effect::CancelTranscription { session } => Self::CancelTranscription { session },
            core::Effect::PostProcess {
                session,
                text,
                task,
            } => Self::PostProcess {
                session,
                text,
                task: task.into(),
            },
            core::Effect::CancelPostProcess { session } => Self::CancelPostProcess { session },
            core::Effect::CleanupAudio { session } => Self::CleanupAudio { session },
            core::Effect::Deliver { session, text } => Self::Deliver { session, text },
            core::Effect::CancelDelivery { session } => Self::CancelDelivery { session },
        }
    }
}

/// 喂一个事件之后：要执行的事 + 新状态。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VoiceStep {
    pub effects: Vec<VoiceEffect>,
    pub phase: VoicePhase,
    /// 当前会话号（0 = 还没开过会话）。
    pub session: u64,
    /// 浮层要不要显示。
    pub visible: bool,
}

/// 语音会话状态机。一个进程一个，宿主在主线程上串行喂事件。
#[derive(uniffi::Object, Default)]
pub struct VoiceSession(Mutex<core::VoiceSession>);

impl VoiceSession {
    fn step(voice: &core::VoiceSession, effects: Vec<core::Effect>) -> VoiceStep {
        VoiceStep {
            effects: effects.into_iter().map(Into::into).collect(),
            phase: voice.phase().into(),
            session: voice.current(),
            visible: voice.phase().is_visible(),
        }
    }
}

#[uniffi::export]
impl VoiceSession {
    #[uniffi::constructor]
    pub fn new() -> Self {
        Self::default()
    }

    /// 喂一个事件，返回要执行的事与新状态。
    pub fn handle(&self, input: VoiceInput) -> VoiceStep {
        let mut voice = self.0.lock().expect("语音会话锁不应中毒");
        let effects = voice.handle(input.into());
        Self::step(&voice, effects)
    }

    /// 当前状态（不改变任何东西）。
    pub fn snapshot(&self) -> VoiceStep {
        let voice = self.0.lock().expect("语音会话锁不应中毒");
        Self::step(&voice, Vec::new())
    }

    /// 完整结果是否交付到录音开始时的输入框（宿主接上交付后打开）。
    pub fn set_deliver(&self, enabled: bool) {
        self.0
            .lock()
            .expect("语音会话锁不应中毒")
            .set_deliver(enabled);
    }

    /// 转写之后是否进入后处理（宿主接上 `Engine::start_voice` 后打开）。
    pub fn set_post_process(&self, enabled: bool) {
        self.0
            .lock()
            .expect("语音会话锁不应中毒")
            .set_post_process(enabled);
    }
}

/// 默认语音模型与资源策略，摊平给 Swift。
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VoiceModelInfo {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub license: String,
    /// 校验通过后的最终路径。
    pub path: String,
    /// 下载中的临时文件（失败时留着续传）。
    pub partial_path: String,
    /// 期望的引擎版本（selftest 与 `transcribe_version()` 对账）。
    pub engine_version: String,
    /// 空闲多久自动卸载（秒）。
    pub idle_unload_secs: u64,
    /// 录音短于它按太短处理（毫秒）。
    pub min_recording_ms: u64,
    /// 单次录音上限（毫秒）。
    pub max_recording_ms: u64,
}

/// 默认语音模型在 `config_dir` 下的清单。
#[uniffi::export]
pub fn voice_model_info(config_dir: String) -> VoiceModelInfo {
    let dir = Path::new(&config_dir);
    let m = model::DEFAULT_MODEL;
    VoiceModelInfo {
        id: m.id.to_owned(),
        url: m.url(),
        file_name: m.file_name.to_owned(),
        size_bytes: m.size_bytes,
        sha256: m.sha256.to_owned(),
        license: m.license.to_owned(),
        path: model::model_path(dir, &m).to_string_lossy().into_owned(),
        partial_path: model::partial_path(dir, &m).to_string_lossy().into_owned(),
        engine_version: model::ENGINE_VERSION.to_owned(),
        idle_unload_secs: model::IDLE_UNLOAD_SECS,
        min_recording_ms: core::MIN_RECORDING_MS,
        max_recording_ms: core::MAX_RECORDING_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_session_round_trips_through_the_export() {
        let voice = VoiceSession::new();
        let step = voice.handle(VoiceInput::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        assert_eq!(step.effects, [VoiceEffect::StartRecording { session: 1 }]);
        assert_eq!(step.phase, VoicePhase::Starting);
        assert!(step.visible);
        voice.handle(VoiceInput::RecordingStarted { session: 1 });
        voice.handle(VoiceInput::Release);
        voice.handle(VoiceInput::Recorded {
            session: 1,
            duration_ms: 1_000,
        });
        let step = voice.handle(VoiceInput::Transcribed {
            session: 1,
            text: "你好".into(),
        });
        assert_eq!(step.effects, [VoiceEffect::CleanupAudio { session: 1 }]);
        assert_eq!(
            step.phase,
            VoicePhase::Done {
                text: "你好".into(),
                transcript: "你好".into(),
                truncated: false,
            }
        );
        let step = voice.handle(VoiceInput::Cancel);
        assert_eq!(step.phase, VoicePhase::Idle);
        assert!(!step.visible);
    }

    #[test]
    fn failures_and_post_processing_keep_their_payloads() {
        let voice = VoiceSession::new();
        voice.set_post_process(true);
        voice.handle(VoiceInput::Press {
            model_ready: true,
            task: VoiceTask::Translate,
        });
        voice.handle(VoiceInput::RecordingStarted { session: 1 });
        voice.handle(VoiceInput::Release);
        voice.handle(VoiceInput::Recorded {
            session: 1,
            duration_ms: 1_000,
        });
        let step = voice.handle(VoiceInput::Transcribed {
            session: 1,
            text: "原文".into(),
        });
        assert_eq!(
            step.effects[1],
            VoiceEffect::PostProcess {
                session: 1,
                text: "原文".into(),
                task: VoiceTask::Translate,
            }
        );
        let step = voice.handle(VoiceInput::PostProcessFailed {
            session: 1,
            detail: "超时".into(),
        });
        assert_eq!(
            step.phase,
            VoicePhase::Failed {
                failure: VoiceFailure {
                    kind: VoiceErrorKind::PostProcess,
                    detail: "超时".into()
                },
                transcript: Some("原文".into())
            }
        );
        let step = voice.handle(VoiceInput::Retry);
        assert_eq!(
            step.effects,
            [VoiceEffect::PostProcess {
                session: 1,
                text: "原文".into(),
                task: VoiceTask::Translate,
            }]
        );
        let step = voice.handle(VoiceInput::PostProcessed {
            session: 1,
            text: "The original".into(),
            truncated: true,
        });
        assert_eq!(
            step.phase,
            VoicePhase::Done {
                text: "The original".into(),
                transcript: "原文".into(),
                truncated: true,
            }
        );
        assert_eq!(voice.snapshot().session, 1);
    }

    #[test]
    fn delivery_round_trips_through_the_export() {
        let voice = VoiceSession::new();
        voice.set_deliver(true);
        voice.handle(VoiceInput::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        voice.handle(VoiceInput::RecordingStarted { session: 1 });
        voice.handle(VoiceInput::Release);
        voice.handle(VoiceInput::Recorded {
            session: 1,
            duration_ms: 1_000,
        });
        let step = voice.handle(VoiceInput::Transcribed {
            session: 1,
            text: "你好".into(),
        });
        assert_eq!(
            step.effects[1],
            VoiceEffect::Deliver {
                session: 1,
                text: "你好".into()
            }
        );
        let step = voice.handle(VoiceInput::DeliveryRefused {
            session: 1,
            reason: VoiceDeliveryRefusal::SecureInput,
        });
        assert_eq!(
            step.phase,
            VoicePhase::Undelivered {
                text: "你好".into(),
                transcript: "你好".into(),
                reason: VoiceDeliveryRefusal::SecureInput
            }
        );
        assert!(step.visible);
        for reason in [
            VoiceDeliveryRefusal::AppChanged,
            VoiceDeliveryRefusal::FocusChanged,
            VoiceDeliveryRefusal::NotEditable,
            VoiceDeliveryRefusal::SecureInput,
            VoiceDeliveryRefusal::TargetGone,
            VoiceDeliveryRefusal::Unverifiable,
            VoiceDeliveryRefusal::NoPermission,
            VoiceDeliveryRefusal::Failed,
        ] {
            assert_eq!(
                VoiceDeliveryRefusal::from(core::DeliveryRefusal::from(reason)),
                reason
            );
        }
    }

    #[test]
    fn model_info_matches_the_app_layer() {
        let info = voice_model_info("/tmp/umuo".into());
        assert_eq!(info.url, model::DEFAULT_MODEL.url());
        assert_eq!(info.size_bytes, model::DEFAULT_MODEL.size_bytes);
        assert_eq!(info.path, "/tmp/umuo/models/Qwen3-ASR-0.6B-Q4_K_M.gguf");
        assert_eq!(
            info.partial_path,
            "/tmp/umuo/models/Qwen3-ASR-0.6B-Q4_K_M.gguf.partial"
        );
        assert_eq!(info.engine_version, "0.4.1");
        for kind in [
            VoiceErrorKind::MicPermissionDenied,
            VoiceErrorKind::NoInputDevice,
            VoiceErrorKind::Recording,
            VoiceErrorKind::TooShort,
            VoiceErrorKind::NoSpeech,
            VoiceErrorKind::ModelUnavailable,
            VoiceErrorKind::Transcription,
            VoiceErrorKind::PostProcess,
        ] {
            assert_eq!(VoiceErrorKind::from(core::ErrorKind::from(kind)), kind);
        }
    }
}
