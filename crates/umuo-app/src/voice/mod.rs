//! 语音后处理：转写文本 → 同语言整理 / 目标语言翻译（PRD §5.7、§5.11）。
//!
//! 这一层只做「组装」：指令在 `umuo_core::voice`，供应商、Key、端点、模型与传输
//! 全部沿用文字翻译的那一套（单一当前模型，不新增语音专用的供应商覆盖）。
//!
//! 刻意**不**碰的东西：请求登记（`Requests`）、窗口事件与写回。语音会话的状态机
//! 与 session id 由会话层负责，它决定结果去哪；[`run`] 只回答一个问题——
//! 「这段转写处理成了什么，或者为什么没处理成」。历史只在宿主入口
//! [`AppCore::post_process_voice`] 里按 [`record_history`] 的规则写一条。
//!
//! 几条确定行为：
//!
//! - **失败与空结果分开**：模型只回空白是 [`VoiceFailureKind::EmptyResult`]，
//!   不是成功，也不和网络/Key 这类 [`VoiceFailureKind::Failed`] 混在一起。
//! - **任何失败都带回原转写**（[`VoiceFailure::transcript`]），供界面展示与重试；
//!   但转写**永远不会**出现在 [`VoiceOutput::text`] 里冒充译文。
//! - **取消有两个检查点**：发请求前、拿到完整结果后。传输进行中的取消由传输层竞争处理；
//!   流刚好跑完时才到的取消同样按取消处理，迟到的结果直接丢弃。

#[cfg(test)]
mod tests;

use std::fmt;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use umuo_core::error::CoreError;
use umuo_core::transport::{self, ChatTarget, StreamOptions};
use umuo_core::wire::TokenUsage;
use umuo_core::{lang, prompt, provider, voice};

pub use umuo_core::voice::VoiceTask;

use crate::settings::Settings;
use crate::translate::resolve_model;
use crate::AppCore;

/// 一次语音后处理的输入。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceRequest {
    /// 转写引擎给出的原文。
    pub transcript: String,
    /// 整理还是翻译。
    pub task: VoiceTask,
    /// 用户钉住的源语言码；None 或空白时自动检测（检测不出用母语假设）。
    pub source_lang: Option<String>,
    /// 显式指定的目标语言码，只对 [`VoiceTask::Translate`] 有意义；
    /// None 或空白时按设置的第一/第二目标语言规则选（源 == 第一目标时改用第二目标）。
    pub target_lang: Option<String>,
}

impl VoiceRequest {
    /// 同语言整理。
    pub fn tidy(transcript: impl Into<String>) -> Self {
        Self {
            transcript: transcript.into(),
            task: VoiceTask::Tidy,
            source_lang: None,
            target_lang: None,
        }
    }

    /// 翻译至设置里的目标语言。
    pub fn translate(transcript: impl Into<String>) -> Self {
        Self {
            transcript: transcript.into(),
            task: VoiceTask::Translate,
            source_lang: None,
            target_lang: None,
        }
    }
}

/// 一次成功的语音后处理。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceOutput {
    /// 做的是哪个任务。
    pub task: VoiceTask,
    /// 处理后的文本（已去掉首尾空白，非空）。
    pub text: String,
    /// 原转写，供界面并排展示或重做。
    pub transcript: String,
    /// 这次采用的源语言码；检测不出且没有母语假设时为 None。
    pub source_lang: Option<String>,
    /// 输出语言码：整理时等于源语言（可能为 None），翻译时总是 Some。
    pub output_lang: Option<String>,
    /// 供应商显示名。
    pub provider: String,
    /// 供应商 id（历史里按它记，与文字翻译一致）。
    pub provider_id: String,
    /// 实际使用的模型。
    pub model: String,
    /// Token 用量（缺失时由传输层估算并标记）。
    pub usage: TokenUsage,
    /// 首字延迟（毫秒）。
    pub first_token_ms: Option<u64>,
    /// 总耗时（毫秒）。
    pub total_ms: u64,
    /// 输出没说完（触到输出上限或连接提前断开）。
    ///
    /// 文本仍可展示与复制，但调用方**不得**把它当作完整结果自动交付到输入框。
    pub truncated: bool,
}

/// 语音后处理没有得到可用结果的原因。
#[derive(Debug, Clone, PartialEq)]
pub enum VoiceFailureKind {
    /// 转写本身为空（静音、只录到空白），没有发出任何请求。
    EmptyTranscript,
    /// 请求成功，但模型只返回了空白。
    EmptyResult,
    /// 翻译任务的输出与原转写完全相同：没有翻译，不能当作译文交付。
    Untranslated,
    /// 配置、Key、网络、供应商或取消等失败，原样带出内核错误。
    Failed(CoreError),
}

/// 失败结果：原因 + 原转写。转写始终保留，界面据此展示并提供重试。
#[derive(Debug, Clone, PartialEq)]
pub struct VoiceFailure {
    /// 失败原因。
    pub kind: VoiceFailureKind,
    /// 原转写，原样保留（未做任何修改）。
    pub transcript: String,
}

impl VoiceFailure {
    fn new(kind: VoiceFailureKind, transcript: &str) -> Self {
        Self {
            kind,
            transcript: transcript.to_string(),
        }
    }

    /// 是否为用户取消（含被新会话顶掉）。取消不弹错误，也不给重试按钮。
    pub fn is_cancelled(&self) -> bool {
        matches!(self.kind, VoiceFailureKind::Failed(CoreError::Cancelled))
    }

    /// 用同一段转写再试一次是否可能有用。
    ///
    /// 空转写重试没有意义（要重新录音）；取消是用户的意图；其余按内核错误的建议动作判断。
    pub fn retryable(&self) -> bool {
        match &self.kind {
            VoiceFailureKind::EmptyTranscript => false,
            VoiceFailureKind::EmptyResult | VoiceFailureKind::Untranslated => true,
            VoiceFailureKind::Failed(error) => error
                .actions()
                .contains(&umuo_core::error::SuggestedAction::Retry),
        }
    }
}

impl fmt::Display for VoiceFailureKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VoiceFailureKind::EmptyTranscript => f.write_str("没有识别到语音内容"),
            VoiceFailureKind::EmptyResult => f.write_str("模型没有返回内容"),
            VoiceFailureKind::Untranslated => f.write_str("模型没有翻译，返回的仍是原文"),
            VoiceFailureKind::Failed(error) => error.fmt(f),
        }
    }
}

impl fmt::Display for VoiceFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.kind.fmt(f)
    }
}

impl std::error::Error for VoiceFailure {}

impl AppCore {
    /// [`run`] 的自有参数版本：返回的 future 是 `Send + 'static`，宿主可直接放到自己的运行时上跑。
    ///
    /// `cancel` 由调用方持有（会话层按 Esc 或新会话顶掉旧会话时置位），语义同 [`run`]。
    pub fn start_voice(
        self: &Arc<Self>,
        request: VoiceRequest,
        cancel: Arc<AtomicBool>,
    ) -> impl Future<Output = Result<VoiceOutput, VoiceFailure>> + Send + 'static {
        let core = self.clone();
        async move { run(&core, &request, &cancel).await }
    }

    /// 宿主（语音会话）用的入口：[`Self::start_voice`] + 成功后按 [`record_history`] 记一条历史。
    ///
    /// 历史在返回结果之前写：与文字翻译「显示与落库是同一次成功的两个后果」一致，落库失败只打日志。
    pub fn post_process_voice(
        self: &Arc<Self>,
        request: VoiceRequest,
        cancel: Arc<AtomicBool>,
    ) -> impl Future<Output = Result<VoiceOutput, VoiceFailure>> + Send + 'static {
        let core = self.clone();
        async move {
            let result = run(&core, &request, &cancel).await;
            if let Ok(output) = &result {
                record_history(&core, output);
            }
            result
        }
    }
}

/// 历史里语音记录的场景标识（与 selection / silentReplace / compose / ocr 并列）。
pub const HISTORY_SCENE: &str = "voice";

/// 把一次语音后处理写进本地历史（PRD §5.9）：原文是转写，结果是整理或译文，场景 [`HISTORY_SCENE`]。
///
/// 规则与文字翻译相同：「关闭记录」与隐私模式下一条都不写（[`crate::history::record`] 负责）；
/// **截断的不写**——历史里的结果会被当成完整结果复制、再利用。不保存音频。
pub fn record_history(core: &AppCore, output: &VoiceOutput) {
    if output.truncated {
        return;
    }
    let source = output.transcript.trim();
    crate::history::record(
        core,
        crate::history::Draft {
            source_text: source.to_string(),
            translated_text: output.text.clone(),
            source_lang: output.source_lang.clone(),
            // 与文字翻译一致存显示名；整理且检测不出语言时留空。
            target_lang: output
                .output_lang
                .as_deref()
                .map(lang::display_name)
                .unwrap_or_default(),
            provider_id: output.provider_id.clone(),
            model: output.model.clone(),
            style_id: prompt::DEFAULT_STYLE_ID.to_string(),
            scene: HISTORY_SCENE.to_string(),
            input_tokens: output.usage.input_tokens,
            output_tokens: output.usage.output_tokens,
            estimated: output.usage.estimated,
        },
    );
}

/// 对一段转写做整理或翻译。
///
/// `cancel` 是轮询式取消标志（与文字翻译的 `Ticket::cancel` 同一协议）：
/// 置位后，未发出的请求不再发出，进行中的请求立刻停下，已经跑完但尚未返回的结果被丢弃，
/// 三种情况都返回 [`CoreError::Cancelled`]。
///
/// 不发事件、不写历史、不写回：结果怎么交付由调用方（语音会话层）决定。
pub async fn run(
    core: &AppCore,
    request: &VoiceRequest,
    cancel: &AtomicBool,
) -> Result<VoiceOutput, VoiceFailure> {
    let transcript = request.transcript.as_str();
    process(core, request, cancel, &mut |_| {})
        .await
        .map_err(|kind| VoiceFailure::new(kind, transcript))
}

/// `on_delta` 只给测试用：在流的中途精确地按下取消。对外的 [`run`] 不逐字推送。
async fn process(
    core: &AppCore,
    request: &VoiceRequest,
    cancel: &AtomicBool,
    on_delta: &mut (dyn FnMut(&str) + Send),
) -> Result<VoiceOutput, VoiceFailureKind> {
    let failed = VoiceFailureKind::Failed;
    let transcript = request.transcript.trim();
    if transcript.is_empty() {
        return Err(VoiceFailureKind::EmptyTranscript);
    }
    if cancel.load(Ordering::Relaxed) {
        return Err(failed(CoreError::Cancelled));
    }

    // 锁只在这个语句里存活：MutexGuard 不能跨 await，否则 future 不是 Send。
    let settings: Settings = core.settings.lock().expect("设置锁不应中毒").clone();

    let provider = provider::find_provider(&settings.provider_id)
        .ok_or_else(|| failed(CoreError::NoEngine))?;
    let api_key = core
        .host
        .api_key(provider.id)
        .map_err(|e| {
            failed(CoreError::BadResponse {
                detail: format!("读取 Keychain 失败：{e}"),
            })
        })?
        .unwrap_or_default();
    if provider.requires_key() && api_key.trim().is_empty() {
        return Err(failed(CoreError::MissingKey));
    }
    let base_url = settings.base_url_override(provider).map_err(failed)?;
    let model = resolve_model(&settings, provider);

    let (source, output) = resolve_languages(request, transcript, &settings);
    let source_name = source.as_deref().map(lang::display_name);
    let output_name = output
        .as_deref()
        .map(lang::display_name)
        .unwrap_or_default();
    let vars = prompt::PromptVars {
        source_lang: source_name.as_deref(),
        target_lang: &output_name,
    };
    let chat = voice::build_request(request.task, &vars, transcript);

    // 第一个检查点：Keychain 读取期间按下的 Esc 也要生效，不发出请求。
    if cancel.load(Ordering::Relaxed) {
        return Err(failed(CoreError::Cancelled));
    }

    let options = StreamOptions {
        timeout: transport::DEFAULT_TIMEOUT,
        cancel: Some(cancel),
    };
    // 不切分：语音转写远小于任何当前模型的上下文。不逐字推送：结果要整段核验后才算数。
    let outcome = transport::stream_chat(
        &core.client,
        &ChatTarget {
            provider,
            base_url: base_url.as_deref(),
            model: &model,
            api_key: &api_key,
            chat: &chat,
        },
        &options,
        on_delta,
    )
    .await
    .map_err(failed)?;

    // 第二个检查点：流跑完的同一刻按下的取消，结果算迟到，丢弃。
    if cancel.load(Ordering::Relaxed) {
        return Err(failed(CoreError::Cancelled));
    }

    let text = voice::normalize_output(&outcome.text).ok_or(VoiceFailureKind::EmptyResult)?;
    if request.task == VoiceTask::Translate
        && echoes_source(text, transcript, source.as_deref(), output.as_deref())
    {
        return Err(VoiceFailureKind::Untranslated);
    }

    Ok(VoiceOutput {
        task: request.task,
        text: text.to_string(),
        transcript: request.transcript.clone(),
        source_lang: source,
        output_lang: output,
        provider: provider.label.to_string(),
        provider_id: provider.id.to_string(),
        model,
        usage: outcome.usage,
        first_token_ms: outcome.first_token_ms,
        total_ms: outcome.total_ms,
        truncated: outcome.truncated,
    })
}

/// 源语言与输出语言码。
///
/// 源语言：钉住的 > 自动检测 > 母语假设。输出语言：整理时等于源语言；
/// 翻译时显式指定 > 设置的目标语言规则（与文字翻译同一份 [`lang::resolve_target`]，
/// 源 == 第一目标时改用第二目标，免得「中译中」把原文原样交回来）。
fn resolve_languages(
    request: &VoiceRequest,
    transcript: &str,
    settings: &Settings,
) -> (Option<String>, Option<String>) {
    let pinned = request
        .source_lang
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());
    let source = match pinned {
        Some(code) => Some(code.to_string()),
        None => lang::assume_source(lang::detect(transcript), &settings.native_lang),
    };
    let output = match request.task {
        VoiceTask::Tidy => source.clone(),
        VoiceTask::Translate => Some(lang::resolve_target(
            request.target_lang.as_deref(),
            None,
            source.as_deref(),
            &settings.target_lang,
            Some(&settings.secondary_target_lang),
        )),
    };
    (source, output)
}

/// 翻译结果是不是原样交回的转写。
///
/// 只认「去掉首尾空白后完全相同」：这是最确定的「没翻译」信号，不会误伤正常译文。
/// 源语言与目标语言本就相同时（用户显式这么选），相同输出是合理的，不拦。
fn echoes_source(text: &str, transcript: &str, source: Option<&str>, output: Option<&str>) -> bool {
    if let (Some(source), Some(output)) = (source, output) {
        if lang::same_language(source, output) {
            return false;
        }
    }
    text == transcript
}
