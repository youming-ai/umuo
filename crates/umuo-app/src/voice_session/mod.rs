//! 语音输入的会话规则（阶段 C，PRD §5.11 / §7.5）：按住录音 → 松开转写 → 后处理 → 完成 / 取消 / 错误。
//!
//! 这里是**纯状态机**：输入是按键与宿主回报的结果（[`Input`]），输出是要宿主去做的事（[`Effect`]）。
//! 麦克风、转写引擎、临时文件、浮层都在 Swift 宿主里；规则只写一次、在这里测。
//! 与 Handy 的 `TranscriptionCoordinator` 同一思路：决策与副作用分开。
//!
//! 三条硬规则：
//!
//! 1. **每次按下开一个新会话**，[`SessionId`] 单调递增、不复用。宿主回报的结果都带会话号，
//!    不是当前会话的一律不改状态——旧会话的迟到结果不能覆盖新会话（§7.5）。
//! 2. **Esc 全链路取消**：录音中丢弃录音，转写中让引擎中止，后处理中取消请求；之后到达的结果按迟到处理。
//! 3. **临时音频必清**：任何一条把会话带离「录音 / 转写」的路径都发 [`Effect::CleanupAudio`]；
//!    迟到的「录好了 / 转写完了」也再发一次（幂等），宁可多删一次，不留一份音频在磁盘上。
//!
//! 后处理（同语言整理 / 翻译到目标语言）的接入点是 [`Effect::PostProcess`] 与
//! [`Input::PostProcessed`] / [`Input::PostProcessFailed`]：任务本身在 [`crate::voice`]，
//! 宿主执行 `PostProcess` 时调用它，再把结果按会话号喂回来。没开后处理时转写完直接完成。
//! 做哪种任务（整理 / 翻译）由按下的是哪个语音键决定（[`Input::Press::task`]），整个会话不变，重试也沿用。
//!
//! 交付（阶段 E）的接入点是 [`Effect::Deliver`] 与 [`Input::Delivered`] / [`Input::DeliveryRefused`]：
//! 只有**当前会话**的**完整**结果才会交付；截断、失败、取消、被新会话顶掉的结果一律不交付。
//! 交付前核验目标（同一应用、同一输入框、可写、非安全输入）与真正的写入都在宿主；
//! 宿主拒绝时浮层保留结果供复制并说明原因（[`Phase::Undelivered`]），成功则收起。任何模式都不自动发送。

pub mod model;

pub use crate::voice::VoiceTask;

/// 会话号。从 1 开始单调递增，0 表示「还没有会话」。
pub type SessionId = u64;

/// 录音短于它按「太短」处理：多半是误触，转写也只会得到空串或幻觉。
pub const MIN_RECORDING_MS: u64 = 300;

/// 单次录音的上限。到点由宿主回报 [`Input::RecordingLimitReached`]，按松开处理。
/// 短句优先（Handy 研究「建议首版」）；更长的口述要按引擎的单次输入上限分段，不在首版范围。
pub const MAX_RECORDING_MS: u64 = 120_000;

/// 出错的是哪一类，界面按它选文案与操作（例如权限被拒给「打开系统设置」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// 麦克风权限被拒或受限。
    MicPermissionDenied,
    /// 没有可用的输入设备，或设备在录音中途消失。
    NoInputDevice,
    /// 录音本身失败（音频引擎起不来、写临时文件失败）。
    Recording,
    /// 按得太短（< [`MIN_RECORDING_MS`]）。
    TooShort,
    /// 转写成功但没有听到内容。
    NoSpeech,
    /// 模型文件缺失、损坏或加载失败。
    ModelUnavailable,
    /// 推理失败。
    Transcription,
    /// 后处理（整理 / 翻译）失败；转写结果保留在 [`Phase::Failed::transcript`]。
    PostProcess,
}

/// 宿主拒绝交付的原因。结果都保留在浮层里供复制，界面按它说明为什么没有输入。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryRefusal {
    /// 前台已经换成别的应用。
    AppChanged,
    /// 同一应用里焦点换到了别的输入框或窗口。
    FocusChanged,
    /// 目标只读或不可编辑。
    NotEditable,
    /// 安全输入（密码框，或有应用开启了安全键盘输入）。
    SecureInput,
    /// 录音时的应用已经退出。
    TargetGone,
    /// 无法核验目标（录音开始时没有聚焦的输入对象，或问不出来）。
    Unverifiable,
    /// 没有辅助功能权限。
    NoPermission,
    /// 核验通过但写入失败（应用拒绝写入、粘贴失败）。
    Failed,
}

/// 一次失败：类别 + 给排查用的细节（引擎状态码、系统错误）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceError {
    pub kind: ErrorKind,
    pub detail: String,
}

/// 当前会话处在哪一步。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Phase {
    /// 没有会话，浮层不显示。
    Idle,
    /// 首次使用：模型还没装好。浮层展示下载入口；下载本身由宿主管理，装好后用户再按一次。
    NeedsModel,
    /// 已请求开麦，等宿主确认录音真的开始了（第一次会弹麦克风权限框）。
    Starting,
    /// 录音中。
    Recording,
    /// 已松开，正在收尾录音并转写。
    Transcribing,
    /// 转写完成，正在整理或翻译。`transcript` 是转写原文：浮层可先展示，失败时保留。
    PostProcessing { transcript: String },
    /// 完成：文本展示在浮层里供复制。`transcript` 是转写原文（没开后处理时与 `text` 相同），重试用。
    ///
    /// `truncated`：后处理的输出没说完（触到输出上限或连接提前断开）。仍可展示、复制、重试，
    /// 但**不是**完整结果，不得自动交付到输入框。
    Done {
        text: String,
        transcript: String,
        truncated: bool,
    },
    /// 正在向录音开始时的输入框交付完整结果（宿主核验目标后写入）。
    Delivering { text: String, transcript: String },
    /// 宿主拒绝交付：结果保留在浮层里供复制，并说明原因。不重试、不改投别处。
    Undelivered {
        text: String,
        transcript: String,
        reason: DeliveryRefusal,
    },
    /// 出错。后处理失败时保留转写结果，供复制或重试，不把源语言悄悄当成结果。
    Failed {
        error: VoiceError,
        transcript: Option<String>,
    },
    /// 用户取消。浮层收起。
    Cancelled,
}

impl Phase {
    /// 浮层要不要显示。
    pub fn is_visible(&self) -> bool {
        !matches!(self, Self::Idle | Self::Cancelled)
    }

    /// 是否有工作在进行（录音、转写、后处理）。
    pub fn is_busy(&self) -> bool {
        matches!(
            self,
            Self::Starting
                | Self::Recording
                | Self::Transcribing
                | Self::PostProcessing { .. }
                | Self::Delivering { .. }
        )
    }
}

/// 喂给状态机的事件：用户的按键，或宿主执行完某个 [`Effect`] 的回报。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Input {
    /// 语音快捷键按下。`model_ready`：模型文件已就位（宿主查文件，不在这里碰磁盘）；
    /// `task`：按的是整理键还是翻译键，决定这一会话的后处理任务。
    Press { model_ready: bool, task: VoiceTask },
    /// 语音快捷键松开。
    Release,
    /// Esc 或浮层上的关闭按钮：取消正在进行的工作，或收起已结束的浮层。
    Cancel,
    /// 麦克风已开、开始写音频。
    RecordingStarted { session: SessionId },
    /// 开麦或录音中途失败。
    RecordingFailed {
        session: SessionId,
        kind: ErrorKind,
        detail: String,
    },
    /// 录音到达上限（[`MAX_RECORDING_MS`]），按松开处理。
    RecordingLimitReached { session: SessionId },
    /// 录音已收尾、临时音频已写完。
    Recorded {
        session: SessionId,
        duration_ms: u64,
    },
    /// 转写完成（可能是空串：没听到内容）。
    Transcribed { session: SessionId, text: String },
    /// 转写失败。`kind` 是 [`ErrorKind::ModelUnavailable`] 或 [`ErrorKind::Transcription`]。
    TranscriptionFailed {
        session: SessionId,
        kind: ErrorKind,
        detail: String,
    },
    /// 后处理完成。`truncated`：输出没说完（见 [`Phase::Done::truncated`]）。
    PostProcessed {
        session: SessionId,
        text: String,
        truncated: bool,
    },
    /// 后处理失败。
    PostProcessFailed { session: SessionId, detail: String },
    /// 浮层上的「重试」：用同一段转写、同一个任务再做一次后处理。
    /// 只对后处理失败或结果被截断的当前会话有效，其余状态下忽略。
    Retry,
    /// 已写进录音开始时的输入框。
    Delivered { session: SessionId },
    /// 宿主拒绝交付（核验没通过或写入失败），没有写任何东西。
    DeliveryRefused {
        session: SessionId,
        reason: DeliveryRefusal,
    },
}

/// 要宿主去做的事。宿主按顺序执行；每个都带会话号，执行完按同一个会话号回报。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// 申请权限（需要时）、开麦、开始把音频写进这一会话的临时文件。
    StartRecording { session: SessionId },
    /// 正常结束录音，收尾临时文件后回报 [`Input::Recorded`]。
    StopRecording { session: SessionId },
    /// 停止录音并丢弃（取消、开麦前就松开、迟到的「已开麦」）。幂等。
    DiscardRecording { session: SessionId },
    /// 用这一会话的临时音频转写，完成后回报 [`Input::Transcribed`] / [`Input::TranscriptionFailed`]。
    Transcribe { session: SessionId },
    /// 让正在跑的转写中止（引擎的 abort 回调）。幂等。
    CancelTranscription { session: SessionId },
    /// 后处理：按 `task` 整理或翻译 `text`，完成后回报 [`Input::PostProcessed`]。
    PostProcess {
        session: SessionId,
        text: String,
        task: VoiceTask,
    },
    /// 取消后处理请求。幂等。
    CancelPostProcess { session: SessionId },
    /// 删除这一会话的临时音频。幂等；默认不保存音频（PRD §5.11）。
    CleanupAudio { session: SessionId },
    /// 核验录音开始时记下的目标，通过就把 `text` 写进去（不发送、不按回车），
    /// 回报 [`Input::Delivered`] / [`Input::DeliveryRefused`]。
    Deliver { session: SessionId, text: String },
    /// 放弃交付：还没写的不再写。幂等；已经写进去的无法撤回。
    CancelDelivery { session: SessionId },
}

/// 语音会话状态机。一个进程一个；宿主在主线程上串行喂事件。
#[derive(Debug)]
pub struct VoiceSession {
    phase: Phase,
    /// 当前会话号；0 = 还没开过会话。
    current: SessionId,
    /// 转写之后要不要走后处理（宿主接上后处理之前为 false）。
    post_process: bool,
    /// 当前会话的后处理任务（按下时定下）。
    task: VoiceTask,
    /// 完整结果是否交付到录音开始时的输入框（宿主接上交付之前为 false）。
    deliver: bool,
}

impl Default for VoiceSession {
    fn default() -> Self {
        Self::new()
    }
}

impl VoiceSession {
    pub fn new() -> Self {
        Self {
            phase: Phase::Idle,
            current: 0,
            post_process: false,
            task: VoiceTask::Tidy,
            deliver: false,
        }
    }

    /// 当前状态。
    pub fn phase(&self) -> &Phase {
        &self.phase
    }

    /// 当前会话号（0 = 还没开过会话）。
    pub fn current(&self) -> SessionId {
        self.current
    }

    /// 转写之后是否进入后处理。只影响之后才转写完的会话。
    pub fn set_post_process(&mut self, enabled: bool) {
        self.post_process = enabled;
    }

    pub fn post_process(&self) -> bool {
        self.post_process
    }

    /// 当前会话的后处理任务。
    pub fn task(&self) -> VoiceTask {
        self.task
    }

    /// 完整结果是否交付到输入框。只影响之后才完成的会话。
    pub fn set_deliver(&mut self, enabled: bool) {
        self.deliver = enabled;
    }

    pub fn deliver(&self) -> bool {
        self.deliver
    }

    /// 喂一个事件，返回要宿主执行的事（按顺序）。
    pub fn handle(&mut self, input: Input) -> Vec<Effect> {
        match input {
            Input::Press { model_ready, task } => self.press(model_ready, task),
            Input::Release => self.finish_recording(None),
            Input::RecordingLimitReached { session } => self.finish_recording(Some(session)),
            Input::Cancel => self.cancel(),
            Input::RecordingStarted { session } => self.recording_started(session),
            Input::RecordingFailed {
                session,
                kind,
                detail,
            } => self.recording_failed(session, kind, detail),
            Input::Recorded {
                session,
                duration_ms,
            } => self.recorded(session, duration_ms),
            Input::Transcribed { session, text } => self.transcribed(session, text),
            Input::TranscriptionFailed {
                session,
                kind,
                detail,
            } => self.transcription_failed(session, kind, detail),
            Input::PostProcessed {
                session,
                text,
                truncated,
            } => self.post_processed(session, text, truncated),
            Input::PostProcessFailed { session, detail } => {
                self.post_process_failed(session, detail)
            }
            Input::Retry => self.retry(),
            Input::Delivered { session } => self.delivered(session),
            Input::DeliveryRefused { session, reason } => self.delivery_refused(session, reason),
        }
    }

    fn is_current(&self, session: SessionId) -> bool {
        session != 0 && session == self.current
    }

    /// 停掉当前会话正在做的事（换新会话或取消时），返回对应的副作用。
    fn abort_current(&self) -> Vec<Effect> {
        let session = self.current;
        match self.phase {
            Phase::Starting | Phase::Recording => vec![
                Effect::DiscardRecording { session },
                Effect::CleanupAudio { session },
            ],
            Phase::Transcribing => vec![
                Effect::CancelTranscription { session },
                Effect::CleanupAudio { session },
            ],
            Phase::PostProcessing { .. } => vec![Effect::CancelPostProcess { session }],
            Phase::Delivering { .. } => vec![Effect::CancelDelivery { session }],
            _ => Vec::new(),
        }
    }

    fn press(&mut self, model_ready: bool, task: VoiceTask) -> Vec<Effect> {
        // 按住期间的重复按下（键盘自动重复、两个入口同时触发）：同一次按住，不开新会话。
        if matches!(self.phase, Phase::Starting | Phase::Recording) {
            return Vec::new();
        }
        // 转写 / 后处理还在跑时又按下：用户要说下一句。旧会话就地取消，它的结果之后按迟到丢弃。
        let mut effects = self.abort_current();
        if !model_ready {
            self.phase = Phase::NeedsModel;
            return effects;
        }
        self.current += 1;
        self.task = task;
        self.phase = Phase::Starting;
        effects.push(Effect::StartRecording {
            session: self.current,
        });
        effects
    }

    /// 松开或到达录音上限。`session` 为空表示松开（只作用于当前会话）。
    fn finish_recording(&mut self, session: Option<SessionId>) -> Vec<Effect> {
        if session.is_some_and(|session| !self.is_current(session)) {
            return Vec::new();
        }
        let session = self.current;
        match self.phase {
            // 麦克风还没开好就松开了（快速误触，或刚刚在权限框上停留）：没有可转写的音频，直接收起。
            Phase::Starting => {
                self.phase = Phase::Cancelled;
                vec![
                    Effect::DiscardRecording { session },
                    Effect::CleanupAudio { session },
                ]
            }
            Phase::Recording => {
                self.phase = Phase::Transcribing;
                vec![Effect::StopRecording { session }]
            }
            _ => Vec::new(),
        }
    }

    fn cancel(&mut self) -> Vec<Effect> {
        if self.phase.is_busy() {
            let effects = self.abort_current();
            self.phase = Phase::Cancelled;
            return effects;
        }
        // 已结束的浮层（完成、出错、待下载）：收起。
        if self.phase.is_visible() {
            self.phase = Phase::Idle;
        }
        Vec::new()
    }

    fn recording_started(&mut self, session: SessionId) -> Vec<Effect> {
        if self.is_current(session) && self.phase == Phase::Starting {
            self.phase = Phase::Recording;
            return Vec::new();
        }
        // 迟到的「已开麦」：会话已经取消或被新会话顶掉。麦克风不能就这么开着，必须关掉。
        vec![
            Effect::DiscardRecording { session },
            Effect::CleanupAudio { session },
        ]
    }

    fn recording_failed(
        &mut self,
        session: SessionId,
        kind: ErrorKind,
        detail: String,
    ) -> Vec<Effect> {
        let effects = vec![
            Effect::DiscardRecording { session },
            Effect::CleanupAudio { session },
        ];
        // 已松开（Transcribing）时收尾失败也算这一会话失败：没有音频可转。
        if self.is_current(session)
            && matches!(
                self.phase,
                Phase::Starting | Phase::Recording | Phase::Transcribing
            )
        {
            self.phase = Phase::Failed {
                error: VoiceError { kind, detail },
                transcript: None,
            };
        }
        effects
    }

    fn recorded(&mut self, session: SessionId, duration_ms: u64) -> Vec<Effect> {
        if !self.is_current(session) || self.phase != Phase::Transcribing {
            // 迟到的录音：不转写，音频立即删掉。
            return vec![Effect::CleanupAudio { session }];
        }
        if duration_ms < MIN_RECORDING_MS {
            self.phase = Phase::Failed {
                error: VoiceError {
                    kind: ErrorKind::TooShort,
                    detail: format!("{duration_ms} ms"),
                },
                transcript: None,
            };
            return vec![Effect::CleanupAudio { session }];
        }
        vec![Effect::Transcribe { session }]
    }

    fn transcribed(&mut self, session: SessionId, text: String) -> Vec<Effect> {
        // 不论是不是当前会话，转写一结束这份音频就没用了。
        let mut effects = vec![Effect::CleanupAudio { session }];
        if !self.is_current(session) || self.phase != Phase::Transcribing {
            return effects;
        }
        let text = text.trim().to_owned();
        if text.is_empty() {
            self.phase = Phase::Failed {
                error: VoiceError {
                    kind: ErrorKind::NoSpeech,
                    detail: String::new(),
                },
                transcript: None,
            };
        } else if self.post_process {
            effects.push(self.begin_post_process(text));
        } else {
            effects.extend(self.finish(text.clone(), text, false));
        }
        effects
    }

    fn transcription_failed(
        &mut self,
        session: SessionId,
        kind: ErrorKind,
        detail: String,
    ) -> Vec<Effect> {
        if self.is_current(session) && self.phase == Phase::Transcribing {
            self.phase = Phase::Failed {
                error: VoiceError { kind, detail },
                transcript: None,
            };
        }
        vec![Effect::CleanupAudio { session }]
    }

    /// 进入后处理：状态改为 `PostProcessing`，返回要宿主执行的那一步。
    fn begin_post_process(&mut self, transcript: String) -> Effect {
        self.phase = Phase::PostProcessing {
            transcript: transcript.clone(),
        };
        Effect::PostProcess {
            session: self.current,
            text: transcript,
            task: self.task,
        }
    }

    fn post_processed(&mut self, session: SessionId, text: String, truncated: bool) -> Vec<Effect> {
        if !self.is_current(session) {
            return Vec::new();
        }
        let Phase::PostProcessing { transcript } = &self.phase else {
            return Vec::new();
        };
        let text = text.trim().to_owned();
        if text.is_empty() {
            // 空结果不是结果：与失败同样处理，保留转写（阶段 D 已拦一次，这里兜底）。
            return self.post_process_failed(session, "模型没有返回内容".into());
        }
        let transcript = transcript.clone();
        self.finish(text, transcript, truncated)
    }

    /// 当前会话得到结果：完整且开了交付就去交付，否则停在完成态供复制。
    /// 截断的结果**永远不交付**（PRD §5.4 / §5.11）。
    fn finish(&mut self, text: String, transcript: String, truncated: bool) -> Vec<Effect> {
        if self.deliver && !truncated {
            self.phase = Phase::Delivering {
                text: text.clone(),
                transcript,
            };
            return vec![Effect::Deliver {
                session: self.current,
                text,
            }];
        }
        self.phase = Phase::Done {
            text,
            transcript,
            truncated,
        };
        Vec::new()
    }

    fn delivered(&mut self, session: SessionId) -> Vec<Effect> {
        if self.is_current(session) && matches!(self.phase, Phase::Delivering { .. }) {
            // 写进去了：浮层收起（PRD §5.11），结果已在输入框里。
            self.phase = Phase::Idle;
        }
        Vec::new()
    }

    fn delivery_refused(&mut self, session: SessionId, reason: DeliveryRefusal) -> Vec<Effect> {
        if !self.is_current(session) {
            return Vec::new();
        }
        if let Phase::Delivering { text, transcript } = &self.phase {
            self.phase = Phase::Undelivered {
                text: text.clone(),
                transcript: transcript.clone(),
                reason,
            };
        }
        Vec::new()
    }

    fn retry(&mut self) -> Vec<Effect> {
        if !self.post_process {
            return Vec::new();
        }
        let transcript = match &self.phase {
            Phase::Failed {
                error,
                transcript: Some(transcript),
            } if error.kind == ErrorKind::PostProcess => transcript.clone(),
            Phase::Done {
                transcript,
                truncated: true,
                ..
            } => transcript.clone(),
            _ => return Vec::new(),
        };
        vec![self.begin_post_process(transcript)]
    }

    fn post_process_failed(&mut self, session: SessionId, detail: String) -> Vec<Effect> {
        if !self.is_current(session) {
            return Vec::new();
        }
        if let Phase::PostProcessing { transcript } = &self.phase {
            // 不保留转写原文的话用户什么都拿不到；保留但标成失败，不当作结果交付（翻译失败不交源语言）。
            self.phase = Phase::Failed {
                error: VoiceError {
                    kind: ErrorKind::PostProcess,
                    detail,
                },
                transcript: Some(transcript.clone()),
            };
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn started() -> VoiceSession {
        let mut voice = VoiceSession::new();
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            [Effect::StartRecording { session: 1 }]
        );
        assert_eq!(voice.handle(Input::RecordingStarted { session: 1 }), []);
        assert_eq!(voice.phase(), &Phase::Recording);
        voice
    }

    fn transcribing() -> VoiceSession {
        let mut voice = started();
        assert_eq!(
            voice.handle(Input::Release),
            [Effect::StopRecording { session: 1 }]
        );
        assert_eq!(
            voice.handle(Input::Recorded {
                session: 1,
                duration_ms: 1_500
            }),
            [Effect::Transcribe { session: 1 }]
        );
        assert_eq!(voice.phase(), &Phase::Transcribing);
        voice
    }

    /// 没有后处理（或后处理得到同样文本）时的完成态。
    fn done(text: &str) -> Phase {
        Phase::Done {
            text: text.into(),
            transcript: text.into(),
            truncated: false,
        }
    }

    fn failed_kind(voice: &VoiceSession) -> Option<ErrorKind> {
        match voice.phase() {
            Phase::Failed { error, .. } => Some(error.kind),
            _ => None,
        }
    }

    #[test]
    fn press_record_release_transcribe_done() {
        let mut voice = transcribing();
        assert_eq!(
            voice.handle(Input::Transcribed {
                session: 1,
                text: "  今天下午三点开会  ".into()
            }),
            [Effect::CleanupAudio { session: 1 }]
        );
        assert_eq!(voice.phase(), &done("今天下午三点开会"));
        assert!(voice.phase().is_visible());
        // 完成后 Esc（或关闭按钮）收起浮层。
        assert_eq!(voice.handle(Input::Cancel), []);
        assert_eq!(voice.phase(), &Phase::Idle);
        assert!(!voice.phase().is_visible());
    }

    #[test]
    fn session_ids_are_monotonic_and_never_reused() {
        let mut voice = transcribing();
        voice.handle(Input::Cancel);
        voice.handle(Input::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        assert_eq!(voice.current(), 2);
        voice.handle(Input::Release);
        voice.handle(Input::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        assert_eq!(voice.current(), 3);
    }

    #[test]
    fn first_use_without_a_model_asks_for_the_download_and_opens_no_session() {
        let mut voice = VoiceSession::new();
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: false,
                task: VoiceTask::Tidy
            }),
            []
        );
        assert_eq!(voice.phase(), &Phase::NeedsModel);
        assert_eq!(voice.current(), 0);
        assert!(voice.phase().is_visible());
        // 没开麦，松开什么都不做。
        assert_eq!(voice.handle(Input::Release), []);
        assert_eq!(voice.phase(), &Phase::NeedsModel);
        assert_eq!(voice.handle(Input::Cancel), []);
        assert_eq!(voice.phase(), &Phase::Idle);
        // 下载好之后再按：正常开会话。
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            [Effect::StartRecording { session: 1 }]
        );
    }

    #[test]
    fn repeated_presses_while_holding_are_one_session() {
        let mut voice = started();
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            []
        );
        assert_eq!(voice.current(), 1);
        assert_eq!(voice.phase(), &Phase::Recording);

        // 开麦确认前的重复按下也一样。
        let mut voice = VoiceSession::new();
        voice.handle(Input::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            []
        );
        assert_eq!(voice.current(), 1);
    }

    #[test]
    fn release_without_a_recording_is_ignored() {
        let mut voice = VoiceSession::new();
        assert_eq!(voice.handle(Input::Release), []);
        assert_eq!(voice.phase(), &Phase::Idle);
        let mut voice = transcribing();
        assert_eq!(voice.handle(Input::Release), []);
        assert_eq!(voice.phase(), &Phase::Transcribing);
    }

    #[test]
    fn releasing_before_the_microphone_opens_cancels_and_a_late_start_is_shut_down() {
        let mut voice = VoiceSession::new();
        voice.handle(Input::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        assert_eq!(
            voice.handle(Input::Release),
            [
                Effect::DiscardRecording { session: 1 },
                Effect::CleanupAudio { session: 1 }
            ]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);
        assert!(!voice.phase().is_visible());
        // 权限框关掉之后录音器才回报「已开麦」：不能让麦克风开着。
        assert_eq!(
            voice.handle(Input::RecordingStarted { session: 1 }),
            [
                Effect::DiscardRecording { session: 1 },
                Effect::CleanupAudio { session: 1 }
            ]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);
    }

    #[test]
    fn escape_cancels_every_busy_stage() {
        let mut voice = VoiceSession::new();
        voice.handle(Input::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        assert_eq!(
            voice.handle(Input::Cancel),
            [
                Effect::DiscardRecording { session: 1 },
                Effect::CleanupAudio { session: 1 }
            ]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);

        let mut voice = started();
        assert_eq!(
            voice.handle(Input::Cancel),
            [
                Effect::DiscardRecording { session: 1 },
                Effect::CleanupAudio { session: 1 }
            ]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);
        // 取消后的松开不再收尾录音。
        assert_eq!(voice.handle(Input::Release), []);

        let mut voice = transcribing();
        assert_eq!(
            voice.handle(Input::Cancel),
            [
                Effect::CancelTranscription { session: 1 },
                Effect::CleanupAudio { session: 1 }
            ]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);
        // 引擎中止前已经算完的结果：迟到，不改状态，只再删一次音频。
        assert_eq!(
            voice.handle(Input::Transcribed {
                session: 1,
                text: "迟到".into()
            }),
            [Effect::CleanupAudio { session: 1 }]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);

        let mut voice = transcribing();
        voice.set_post_process(true);
        voice.handle(Input::Transcribed {
            session: 1,
            text: "原文".into(),
        });
        assert_eq!(
            voice.handle(Input::Cancel),
            [Effect::CancelPostProcess { session: 1 }]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);
        assert_eq!(
            voice.handle(Input::PostProcessed {
                session: 1,
                text: "迟到".into(),
                truncated: false,
            }),
            []
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);
    }

    #[test]
    fn escape_between_release_and_recorded_drops_the_audio() {
        let mut voice = started();
        voice.handle(Input::Release);
        voice.handle(Input::Cancel);
        assert_eq!(
            voice.handle(Input::Recorded {
                session: 1,
                duration_ms: 2_000
            }),
            [Effect::CleanupAudio { session: 1 }]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);
    }

    #[test]
    fn pressing_again_while_transcribing_starts_a_new_session_and_drops_the_old_result() {
        let mut voice = transcribing();
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            [
                Effect::CancelTranscription { session: 1 },
                Effect::CleanupAudio { session: 1 },
                Effect::StartRecording { session: 2 },
            ]
        );
        assert_eq!(voice.current(), 2);
        voice.handle(Input::RecordingStarted { session: 2 });
        // 旧会话的迟到结果不能覆盖新会话（PRD §7.5）。
        voice.handle(Input::Transcribed {
            session: 1,
            text: "上一句".into(),
        });
        voice.handle(Input::TranscriptionFailed {
            session: 1,
            kind: ErrorKind::Transcription,
            detail: "ABORTED(13)".into(),
        });
        voice.handle(Input::RecordingLimitReached { session: 1 });
        assert_eq!(voice.phase(), &Phase::Recording);
        voice.handle(Input::Release);
        voice.handle(Input::Recorded {
            session: 2,
            duration_ms: 800,
        });
        voice.handle(Input::Transcribed {
            session: 2,
            text: "这一句".into(),
        });
        assert_eq!(voice.phase(), &done("这一句"));
        // 更晚到的旧结果也不能把完成态改掉。
        voice.handle(Input::Recorded {
            session: 1,
            duration_ms: 900,
        });
        voice.handle(Input::RecordingFailed {
            session: 1,
            kind: ErrorKind::Recording,
            detail: "旧的".into(),
        });
        assert_eq!(voice.phase(), &done("这一句"));
    }

    #[test]
    fn pressing_again_while_post_processing_cancels_the_request() {
        let mut voice = transcribing();
        voice.set_post_process(true);
        voice.handle(Input::Transcribed {
            session: 1,
            text: "嗯 那个 明天见".into(),
        });
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            [
                Effect::CancelPostProcess { session: 1 },
                Effect::StartRecording { session: 2 }
            ]
        );
        voice.handle(Input::PostProcessFailed {
            session: 1,
            detail: "已取消".into(),
        });
        assert_eq!(voice.phase(), &Phase::Starting);
    }

    #[test]
    fn a_new_press_after_a_finished_session_opens_the_next_one() {
        let mut voice = transcribing();
        voice.handle(Input::Transcribed {
            session: 1,
            text: "好".into(),
        });
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            [Effect::StartRecording { session: 2 }]
        );
    }

    #[test]
    fn hitting_the_recording_limit_behaves_like_releasing() {
        let mut voice = started();
        assert_eq!(
            voice.handle(Input::RecordingLimitReached { session: 7 }),
            []
        );
        assert_eq!(voice.phase(), &Phase::Recording);
        assert_eq!(
            voice.handle(Input::RecordingLimitReached { session: 1 }),
            [Effect::StopRecording { session: 1 }]
        );
        assert_eq!(voice.phase(), &Phase::Transcribing);
        // 用户之后才松开：已经在转写了，什么都不做。
        assert_eq!(voice.handle(Input::Release), []);
    }

    #[test]
    fn a_too_short_press_is_reported_and_not_transcribed() {
        let mut voice = started();
        voice.handle(Input::Release);
        assert_eq!(
            voice.handle(Input::Recorded {
                session: 1,
                duration_ms: MIN_RECORDING_MS - 1
            }),
            [Effect::CleanupAudio { session: 1 }]
        );
        assert_eq!(failed_kind(&voice), Some(ErrorKind::TooShort));
    }

    #[test]
    fn silence_is_no_speech_rather_than_an_empty_result() {
        let mut voice = transcribing();
        voice.handle(Input::Transcribed {
            session: 1,
            text: " \n ".into(),
        });
        assert_eq!(failed_kind(&voice), Some(ErrorKind::NoSpeech));
    }

    #[test]
    fn recording_and_transcription_failures_are_reported_with_their_kind() {
        let mut voice = VoiceSession::new();
        voice.handle(Input::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        assert_eq!(
            voice.handle(Input::RecordingFailed {
                session: 1,
                kind: ErrorKind::MicPermissionDenied,
                detail: "denied".into()
            }),
            [
                Effect::DiscardRecording { session: 1 },
                Effect::CleanupAudio { session: 1 }
            ]
        );
        assert_eq!(failed_kind(&voice), Some(ErrorKind::MicPermissionDenied));

        let mut voice = started();
        voice.handle(Input::RecordingFailed {
            session: 1,
            kind: ErrorKind::NoInputDevice,
            detail: "设备已断开".into(),
        });
        assert_eq!(failed_kind(&voice), Some(ErrorKind::NoInputDevice));

        let mut voice = transcribing();
        assert_eq!(
            voice.handle(Input::TranscriptionFailed {
                session: 1,
                kind: ErrorKind::ModelUnavailable,
                detail: "GGUF(4)".into()
            }),
            [Effect::CleanupAudio { session: 1 }]
        );
        assert_eq!(failed_kind(&voice), Some(ErrorKind::ModelUnavailable));
        // 出错后可以直接再按，开下一个会话。
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            [Effect::StartRecording { session: 2 }]
        );
    }

    #[test]
    fn post_processing_is_the_hook_for_stage_d() {
        let mut voice = transcribing();
        voice.set_post_process(true);
        assert_eq!(
            voice.handle(Input::Transcribed {
                session: 1,
                text: "嗯 明天 不对 后天见".into()
            }),
            [
                Effect::CleanupAudio { session: 1 },
                Effect::PostProcess {
                    session: 1,
                    text: "嗯 明天 不对 后天见".into(),
                    task: VoiceTask::Tidy,
                }
            ]
        );
        assert_eq!(
            voice.phase(),
            &Phase::PostProcessing {
                transcript: "嗯 明天 不对 后天见".into()
            }
        );
        voice.handle(Input::PostProcessed {
            session: 1,
            text: "后天见。".into(),
            truncated: false,
        });
        assert_eq!(
            voice.phase(),
            &Phase::Done {
                text: "后天见。".into(),
                transcript: "嗯 明天 不对 后天见".into(),
                truncated: false,
            }
        );
        // 完整结果不需要重试。
        assert_eq!(voice.handle(Input::Retry), []);
    }

    /// 停在后处理中的会话，任务由按下的那个键决定。
    fn post_processing(task: VoiceTask, transcript: &str) -> VoiceSession {
        let mut voice = VoiceSession::new();
        voice.set_post_process(true);
        voice.handle(Input::Press {
            model_ready: true,
            task,
        });
        voice.handle(Input::RecordingStarted { session: 1 });
        voice.handle(Input::Release);
        voice.handle(Input::Recorded {
            session: 1,
            duration_ms: 1_000,
        });
        let effects = voice.handle(Input::Transcribed {
            session: 1,
            text: transcript.into(),
        });
        assert_eq!(
            effects.last(),
            Some(&Effect::PostProcess {
                session: 1,
                text: transcript.into(),
                task,
            })
        );
        voice
    }

    #[test]
    fn the_key_that_was_pressed_decides_the_task_for_the_whole_session() {
        let mut voice = post_processing(VoiceTask::Translate, "明天见");
        assert_eq!(voice.task(), VoiceTask::Translate);
        // 下一次按的是整理键：新会话换任务，旧会话的结果照旧按迟到丢弃。
        voice.handle(Input::Press {
            model_ready: true,
            task: VoiceTask::Tidy,
        });
        assert_eq!(voice.task(), VoiceTask::Tidy);
        voice.handle(Input::PostProcessed {
            session: 1,
            text: "See you tomorrow.".into(),
            truncated: false,
        });
        assert_eq!(voice.phase(), &Phase::Starting);
    }

    #[test]
    fn a_truncated_result_is_shown_flagged_and_can_be_retried() {
        let mut voice = post_processing(VoiceTask::Translate, "我们明天不去");
        voice.handle(Input::PostProcessed {
            session: 1,
            text: " We are not ".into(),
            truncated: true,
        });
        assert_eq!(
            voice.phase(),
            &Phase::Done {
                text: "We are not".into(),
                transcript: "我们明天不去".into(),
                truncated: true,
            }
        );
        assert!(voice.phase().is_visible());
        assert_eq!(
            voice.handle(Input::Retry),
            [Effect::PostProcess {
                session: 1,
                text: "我们明天不去".into(),
                task: VoiceTask::Translate,
            }]
        );
        assert_eq!(
            voice.phase(),
            &Phase::PostProcessing {
                transcript: "我们明天不去".into()
            }
        );
        // 重试中再按重试：已经在跑，不重复发请求。
        assert_eq!(voice.handle(Input::Retry), []);
    }

    #[test]
    fn a_failed_post_process_can_be_retried_with_the_same_task() {
        let mut voice = post_processing(VoiceTask::Translate, "我们明天不去");
        voice.handle(Input::PostProcessFailed {
            session: 1,
            detail: "超时".into(),
        });
        assert_eq!(
            voice.handle(Input::Retry),
            [Effect::PostProcess {
                session: 1,
                text: "我们明天不去".into(),
                task: VoiceTask::Translate,
            }]
        );
        voice.handle(Input::PostProcessed {
            session: 1,
            text: "We are not going tomorrow.".into(),
            truncated: false,
        });
        assert!(matches!(
            voice.phase(),
            Phase::Done {
                truncated: false,
                ..
            }
        ));
    }

    #[test]
    fn an_empty_post_process_result_is_a_failure_that_keeps_the_transcript() {
        let mut voice = post_processing(VoiceTask::Tidy, "嗯");
        voice.handle(Input::PostProcessed {
            session: 1,
            text: "  ".into(),
            truncated: false,
        });
        assert_eq!(failed_kind(&voice), Some(ErrorKind::PostProcess));
    }

    #[test]
    fn retry_is_ignored_where_there_is_nothing_to_retry() {
        // 录音、转写阶段的失败：要重新录，不是重试后处理。
        let mut voice = transcribing();
        voice.set_post_process(true);
        voice.handle(Input::TranscriptionFailed {
            session: 1,
            kind: ErrorKind::Transcription,
            detail: "BACKEND(8)".into(),
        });
        assert_eq!(voice.handle(Input::Retry), []);
        assert_eq!(failed_kind(&voice), Some(ErrorKind::Transcription));
        // 取消之后、空闲时也一样。
        voice.handle(Input::Cancel);
        assert_eq!(voice.handle(Input::Retry), []);
        assert_eq!(voice.phase(), &Phase::Idle);
    }

    #[test]
    fn a_failed_post_process_keeps_the_transcript_but_is_not_a_result() {
        let mut voice = transcribing();
        voice.set_post_process(true);
        voice.handle(Input::Transcribed {
            session: 1,
            text: "我们明天不去".into(),
        });
        voice.handle(Input::PostProcessFailed {
            session: 1,
            detail: "超时".into(),
        });
        assert_eq!(
            voice.phase(),
            &Phase::Failed {
                error: VoiceError {
                    kind: ErrorKind::PostProcess,
                    detail: "超时".into()
                },
                transcript: Some("我们明天不去".into()),
            }
        );
    }

    /// 开了后处理与交付、停在后处理中的会话。
    fn delivering_setup(task: VoiceTask) -> VoiceSession {
        let mut voice = post_processing(task, "嗯 明天 不对 后天见");
        voice.set_deliver(true);
        assert!(voice.deliver());
        voice
    }

    #[test]
    fn a_complete_result_is_delivered_and_the_overlay_hides_on_success() {
        let mut voice = delivering_setup(VoiceTask::Tidy);
        assert_eq!(
            voice.handle(Input::PostProcessed {
                session: 1,
                text: "后天见。".into(),
                truncated: false,
            }),
            [Effect::Deliver {
                session: 1,
                text: "后天见。".into()
            }]
        );
        assert_eq!(
            voice.phase(),
            &Phase::Delivering {
                text: "后天见。".into(),
                transcript: "嗯 明天 不对 后天见".into()
            }
        );
        assert!(voice.phase().is_busy());
        assert!(voice.phase().is_visible());
        assert_eq!(voice.handle(Input::Delivered { session: 1 }), []);
        assert_eq!(voice.phase(), &Phase::Idle);
        assert!(!voice.phase().is_visible(), "交付成功后浮层收起");
    }

    #[test]
    fn a_refused_delivery_keeps_the_result_with_the_reason_and_stays_visible() {
        let mut voice = delivering_setup(VoiceTask::Translate);
        voice.handle(Input::PostProcessed {
            session: 1,
            text: "See you the day after tomorrow.".into(),
            truncated: false,
        });
        assert_eq!(
            voice.handle(Input::DeliveryRefused {
                session: 1,
                reason: DeliveryRefusal::FocusChanged
            }),
            []
        );
        assert_eq!(
            voice.phase(),
            &Phase::Undelivered {
                text: "See you the day after tomorrow.".into(),
                transcript: "嗯 明天 不对 后天见".into(),
                reason: DeliveryRefusal::FocusChanged
            }
        );
        assert!(voice.phase().is_visible(), "失败不收起");
        // 之后迟到的「已交付」不能把它改成成功。
        voice.handle(Input::Delivered { session: 1 });
        assert!(matches!(voice.phase(), Phase::Undelivered { .. }));
        // 不重试交付，也不重做后处理。
        assert_eq!(voice.handle(Input::Retry), []);
        assert_eq!(voice.handle(Input::Cancel), []);
        assert_eq!(voice.phase(), &Phase::Idle);
    }

    #[test]
    fn a_truncated_result_is_never_delivered() {
        let mut voice = delivering_setup(VoiceTask::Translate);
        assert_eq!(
            voice.handle(Input::PostProcessed {
                session: 1,
                text: "See you the".into(),
                truncated: true,
            }),
            []
        );
        assert!(matches!(
            voice.phase(),
            Phase::Done {
                truncated: true,
                ..
            }
        ));
        // 重试得到完整结果之后才交付。
        voice.handle(Input::Retry);
        assert_eq!(
            voice.handle(Input::PostProcessed {
                session: 1,
                text: "See you the day after tomorrow.".into(),
                truncated: false,
            }),
            [Effect::Deliver {
                session: 1,
                text: "See you the day after tomorrow.".into()
            }]
        );
    }

    #[test]
    fn failures_are_never_delivered() {
        let mut voice = delivering_setup(VoiceTask::Translate);
        assert_eq!(
            voice.handle(Input::PostProcessFailed {
                session: 1,
                detail: "超时".into()
            }),
            [],
            "翻译失败不把源语言交付出去"
        );
        assert_eq!(failed_kind(&voice), Some(ErrorKind::PostProcess));
    }

    #[test]
    fn a_cancelled_or_superseded_session_is_never_delivered() {
        // 后处理中 Esc：迟到的结果不交付。
        let mut voice = delivering_setup(VoiceTask::Tidy);
        voice.handle(Input::Cancel);
        assert_eq!(
            voice.handle(Input::PostProcessed {
                session: 1,
                text: "迟到".into(),
                truncated: false,
            }),
            []
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);

        // 交付中 Esc：通知宿主放弃，之后的回报不改状态。
        let mut voice = delivering_setup(VoiceTask::Tidy);
        voice.handle(Input::PostProcessed {
            session: 1,
            text: "后天见。".into(),
            truncated: false,
        });
        assert_eq!(
            voice.handle(Input::Cancel),
            [Effect::CancelDelivery { session: 1 }]
        );
        assert_eq!(voice.phase(), &Phase::Cancelled);
        voice.handle(Input::Delivered { session: 1 });
        assert_eq!(voice.phase(), &Phase::Cancelled);

        // 交付中又按下：旧会话放弃交付，新会话照常开始。
        let mut voice = delivering_setup(VoiceTask::Tidy);
        voice.handle(Input::PostProcessed {
            session: 1,
            text: "后天见。".into(),
            truncated: false,
        });
        assert_eq!(
            voice.handle(Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy
            }),
            [
                Effect::CancelDelivery { session: 1 },
                Effect::StartRecording { session: 2 }
            ]
        );
        voice.handle(Input::DeliveryRefused {
            session: 1,
            reason: DeliveryRefusal::AppChanged,
        });
        assert_eq!(voice.phase(), &Phase::Starting);
    }

    #[test]
    fn without_post_processing_the_transcript_itself_is_delivered() {
        let mut voice = transcribing();
        voice.set_deliver(true);
        assert_eq!(
            voice.handle(Input::Transcribed {
                session: 1,
                text: " 好的 ".into()
            }),
            [
                Effect::CleanupAudio { session: 1 },
                Effect::Deliver {
                    session: 1,
                    text: "好的".into()
                }
            ]
        );
    }

    /// 假宿主：按副作用开关「麦克风」、在临时目录里写假音频、删文件。
    /// 用来证明任何路径走完之后麦克风是关的、临时目录是空的。
    struct FakeHost {
        dir: std::path::PathBuf,
        mic: Option<SessionId>,
        transcribing: Option<SessionId>,
        post_processing: Option<SessionId>,
    }

    impl FakeHost {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir()
                .join(format!("umuo-voice-session-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self {
                dir,
                mic: None,
                transcribing: None,
                post_processing: None,
            }
        }

        fn audio(&self, session: SessionId) -> std::path::PathBuf {
            self.dir.join(format!("session-{session}.f32"))
        }

        fn apply(&mut self, effects: Vec<Effect>) {
            for effect in effects {
                match effect {
                    Effect::StartRecording { session } => {
                        self.mic = Some(session);
                        // 假音频：一段静音帧。
                        std::fs::write(self.audio(session), [0u8; 64]).unwrap();
                    }
                    Effect::StopRecording { session } | Effect::DiscardRecording { session } => {
                        if self.mic == Some(session) {
                            self.mic = None;
                        }
                    }
                    Effect::Transcribe { session } => {
                        assert!(self.audio(session).exists(), "转写时音频必须还在");
                        self.transcribing = Some(session);
                    }
                    Effect::CancelTranscription { session } => {
                        if self.transcribing == Some(session) {
                            self.transcribing = None;
                        }
                    }
                    Effect::PostProcess { session, .. } => self.post_processing = Some(session),
                    Effect::CancelPostProcess { session } => {
                        if self.post_processing == Some(session) {
                            self.post_processing = None;
                        }
                    }
                    Effect::CleanupAudio { session } => {
                        let _ = std::fs::remove_file(self.audio(session));
                    }
                    Effect::Deliver { .. } | Effect::CancelDelivery { .. } => {}
                }
            }
        }

        fn assert_clean(&self) {
            assert_eq!(self.mic, None, "麦克风没关");
            let left: Vec<_> = std::fs::read_dir(&self.dir).unwrap().flatten().collect();
            assert!(left.is_empty(), "临时音频没清：{left:?}");
        }

        fn feed(&mut self, voice: &mut VoiceSession, input: Input) {
            let effects = voice.handle(input);
            self.apply(effects);
        }

        /// 一次按住 → 开麦 → 松开 → 录好，停在转写中。
        fn record(&mut self, voice: &mut VoiceSession, duration_ms: u64) -> SessionId {
            self.feed(
                voice,
                Input::Press {
                    model_ready: true,
                    task: VoiceTask::Tidy,
                },
            );
            let session = voice.current();
            self.feed(voice, Input::RecordingStarted { session });
            self.feed(voice, Input::Release);
            self.feed(
                voice,
                Input::Recorded {
                    session,
                    duration_ms,
                },
            );
            session
        }
    }

    impl Drop for FakeHost {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn temporary_audio_is_removed_on_every_path() {
        let mut voice = VoiceSession::new();
        let mut host = FakeHost::new("paths");

        // 完成
        let session = host.record(&mut voice, 1_000);
        host.feed(
            &mut voice,
            Input::Transcribed {
                session,
                text: "好的".into(),
            },
        );
        host.assert_clean();

        // 录音中取消
        host.feed(
            &mut voice,
            Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy,
            },
        );
        let session = voice.current();
        host.feed(&mut voice, Input::RecordingStarted { session });
        host.feed(&mut voice, Input::Cancel);
        host.assert_clean();

        // 转写中取消
        host.record(&mut voice, 1_000);
        host.feed(&mut voice, Input::Cancel);
        host.assert_clean();

        // 太短
        host.record(&mut voice, 100);
        host.assert_clean();

        // 转写失败
        let session = host.record(&mut voice, 1_000);
        host.feed(
            &mut voice,
            Input::TranscriptionFailed {
                session,
                kind: ErrorKind::Transcription,
                detail: "BACKEND(8)".into(),
            },
        );
        host.assert_clean();

        // 开麦确认前就松开，录音器在丢弃之后才真正开起来并回报
        host.feed(
            &mut voice,
            Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy,
            },
        );
        let session = voice.current();
        host.feed(&mut voice, Input::Release);
        host.mic = Some(session);
        std::fs::write(host.audio(session), [0u8; 8]).unwrap();
        host.feed(&mut voice, Input::RecordingStarted { session });
        host.assert_clean();

        // 转写中又按下：旧会话迟到的结果
        let old = host.record(&mut voice, 1_000);
        host.feed(
            &mut voice,
            Input::Press {
                model_ready: true,
                task: VoiceTask::Tidy,
            },
        );
        let session = voice.current();
        host.feed(&mut voice, Input::RecordingStarted { session });
        host.feed(
            &mut voice,
            Input::Transcribed {
                session: old,
                text: "迟到".into(),
            },
        );
        host.feed(&mut voice, Input::Cancel);
        host.assert_clean();
        assert_eq!(voice.phase(), &Phase::Cancelled);
        assert_eq!(host.transcribing, None, "旧会话的转写应已中止");
    }
}
