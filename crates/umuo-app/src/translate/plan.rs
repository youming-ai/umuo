//! 一次翻译的规划：用哪个供应商、模型、源语言，收尾的提醒怎么写。
//!
//! 全是纯函数与数据，不发请求、不碰宿主——流水线（`super`）按这里的结论去执行。

use umuo_core::provider;

use crate::host::FocusSource;
use crate::settings::Settings;

/// 浮窗的窗口标签：划词、静默替换、截图 OCR 的事件都发到这里。
pub const PANEL_SURFACE: &str = "panel";
/// 撰写窗的窗口标签（PRD §5.3）。几个功能共用一套事件协议，靠窗口标签区分收件人。
pub const COMPOSE_SURFACE: &str = "compose";

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

/// 这次请求该用哪个模型：设置里的模型 > 供应商默认模型。只有一个当前模型，不按请求覆盖。
pub fn resolve_model(settings: &Settings, provider: &provider::Provider) -> String {
    if settings.model.trim().is_empty() {
        provider.default_model.to_string()
    } else {
        settings.model.trim().to_string()
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

    /// 事件发到哪个窗口。几个功能共用一套事件协议，靠窗口标签区分。
    pub fn surface(self) -> &'static str {
        match self {
            Mode::Selection | Mode::SilentReplace | Mode::Ocr => PANEL_SURFACE,
            Mode::Compose => COMPOSE_SURFACE,
        }
    }

    /// 成功后是否把译文写回原处。只有静默翻译会。
    pub(crate) fn write_back(self) -> bool {
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
    /// 覆盖目标语言（撰写窗的语言选择）。
    pub target_override: Option<String>,
    /// 钉住源语言（PRD §5.3「支持选择源语言」）。为空则自动检测。
    ///
    /// 自动检测对短句经常猜不准，而用户明确知道自己在翻什么语言。
    pub source_override: Option<String>,
    /// 静默翻译的原文来自选区还是整个输入框——写回时据此替换同样的范围（PRD §5.4）。
    ///
    /// 只有 [`Request::silent_replace`] 会设置它；为空就不写回。
    pub focus_source: Option<FocusSource>,
}

/// 一次请求的临时覆盖。
///
/// 打成一个结构体而不是继续往 `Request` 上加字段：调用点已经有五个可选参数了，
/// 再多几个签名会长到看不出哪个是哪个。
#[derive(Debug, Clone, Default)]
pub struct Overrides {
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

impl Request {
    /// 只带文本与模式的骨架。覆盖字段默认全空——重复写五遍 `None` 迟早漏一个。
    fn base(text: impl Into<String>, mode: Mode) -> Self {
        Self {
            text: text.into(),
            mode,
            target_override: None,
            source_override: None,
            focus_source: None,
        }
    }

    /// 带临时覆盖的请求（撰写窗的语言选择用）。
    pub fn with_overrides(text: impl Into<String>, mode: Mode, overrides: Overrides) -> Self {
        Self {
            target_override: overrides.target_lang.filter(|v| !v.trim().is_empty()),
            source_override: overrides.source_lang.filter(|v| !v.trim().is_empty()),
            ..Self::base(text, mode)
        }
    }

    pub fn selection(text: impl Into<String>) -> Self {
        Self::base(text, Mode::Selection)
    }

    pub fn silent_replace(text: impl Into<String>, source: FocusSource) -> Self {
        Self {
            focus_source: Some(source),
            ..Self::base(text, Mode::SilentReplace)
        }
    }

    /// 截图 OCR 的识别结果：源文本来自屏幕，交给同一条翻译流水线。
    pub fn ocr(text: impl Into<String>) -> Self {
        Self::base(text, Mode::Ocr)
    }
}

/// 结果卡片上的提醒：只有截断提醒（审查 M4）。
pub(crate) fn done_warning(truncated: bool) -> Option<String> {
    truncated.then(|| "译文可能不完整：输出触到了模型的长度上限，或连接中途断开".to_string())
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
pub fn target_still_matches(before: Option<&str>, now: Option<String>) -> bool {
    match (before, now) {
        (Some(before), Some(now)) => before == now,
        (Some(_), None) => false,
        (None, _) => true,
    }
}

#[cfg(test)]
mod model_tests {
    use super::*;
    use crate::settings::Settings;

    fn provider() -> &'static provider::Provider {
        provider::find_provider("openai").unwrap()
    }

    #[test]
    fn the_configured_model_is_used() {
        let settings = Settings {
            model: "gpt-4o".to_string(),
            ..Settings::default()
        };
        assert_eq!(resolve_model(&settings, provider()), "gpt-4o");
    }

    #[test]
    fn an_empty_configured_model_falls_back_to_the_provider_default() {
        let settings = Settings {
            model: "  ".to_string(),
            ..Settings::default()
        };
        assert_eq!(resolve_model(&settings, provider()), "gpt-4o-mini");
    }
}

#[cfg(test)]
mod mode_tests {
    use super::*;

    #[test]
    fn mode_strings_are_pinned() {
        // 前端按这个字符串决定展示文案，改了就是破坏性变更。
        assert_eq!(Mode::Selection.as_str(), "selection");
        assert_eq!(Mode::SilentReplace.as_str(), "silentReplace");
        assert_eq!(Mode::Compose.as_str(), "compose");
        assert_eq!(Mode::Ocr.as_str(), "ocr");
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
        // 空语言码会让目标语言切换规则失灵。
        let request = Request::with_overrides(
            "hi",
            Mode::Compose,
            Overrides {
                source_lang: Some(String::new()),
                target_lang: Some("  ".to_string()),
            },
        );
        assert!(request.source_override.is_none());
        assert!(request.target_override.is_none());
    }

    #[test]
    fn real_overrides_survive_trimming() {
        let request = Request::with_overrides(
            "hi",
            Mode::Compose,
            Overrides {
                source_lang: Some(" en ".to_string()),
                target_lang: Some("zh-TW".to_string()),
            },
        );
        assert_eq!(request.source_override.as_deref(), Some(" en "));
        assert_eq!(request.target_override.as_deref(), Some("zh-TW"));
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
    fn a_long_text_splits_even_for_a_large_window_model() {
        // 审查 M4：3 万字对 128k 窗口装得下，但译文装不进一次请求的输出上限——
        // 不切就会在中途被截断。所以大窗口的模型同样要切。
        let text = long_chinese();
        let big = provider::context_window_for("gpt-4o");
        let small = provider::context_window_for("llama3.1:8b");

        assert!(
            chunk::needs_splitting(&text, big),
            "输出上限装不下，128k 模型也得切"
        );
        assert!(chunk::needs_splitting(&text, small), "8k 模型必须切");

        // 切出来的每一片都要装得下。
        let budget = chunk::char_budget(big, chunk::cjk_ratio(&text));
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

    #[test]
    fn silent_replace_carries_where_the_text_was_read_from() {
        // 读的是整个输入框，写回就必须替换整个输入框——来源丢了，
        // 写回只能退化成「在光标处插入」，原文和译文会叠在一起（审查 H4）。
        for source in [FocusSource::Selection, FocusSource::WholeField] {
            let request = Request::silent_replace("今天下午开会", source);
            assert_eq!(request.focus_source, Some(source));
            assert_eq!(request.text, "今天下午开会");
        }
        // 只显示的请求不带来源，也就不会写回。
        assert_eq!(Request::selection("hello").focus_source, None);
    }
}

#[cfg(test)]
mod truncation_warning_tests {
    use super::*;

    #[test]
    fn a_truncated_result_always_carries_a_warning() {
        // 审查 M4：半截译文照常显示，但卡片上必须说清它不完整。
        assert!(done_warning(true).unwrap().contains("不完整"));
        assert_eq!(done_warning(false), None);
    }
}
