//! 翻译风格 / Prompt 预设引擎（PRD §5.7、§6.5）。
//!
//! 设计要点：
//!
//! - **内置规则与风格分离**。基础规则（只输出译文、保留格式与占位符）是所有风格共享的
//!   底线；风格只负责追加「语气与取舍」那一段。这样新增一个风格不会不小心丢掉底线规则。
//! - **单遍替换**。变量渲染只扫描模板一次，用户文本是作为**值**插入的，不会被二次展开。
//!   否则一段包含 `{target_lang}` 的原文会把 Prompt 结构撑坏——这是 Prompt 注入的
//!   最基本形态，见 `text_containing_placeholders_is_never_re_expanded`。
//! - **模板里的 `{name}` / `%s` 是模型要保留的东西**，与我们的变量语法共用花括号。
//!   所以基础规则显式要求模型原样保留它们。

use serde::{Deserialize, Serialize};

use crate::wire::ChatRequest;

/// 内置 Prompt 版本（PRD §6.5「内置 Prompt 版本化」）。
///
/// 用户自定义的 Prompt 不受版本升级影响；这个常量用于在历史记录里区分
/// 「这句话是用哪一版内置规则翻的」。
pub const PROMPT_VERSION: &str = "2026-10-06.1";

/// 所有风格共享的基础规则。
pub const BASE_RULES: &str = "你是一个翻译引擎，不是聊天助手。\n\
规则：\n\
1. 只输出译文本身。不要解释、不要加引号、不要写「以下是翻译」之类的话。\n\
2. 保留原文格式：Markdown 标记、换行、列表、代码块原样保留；代码、URL、文件路径不翻译。\n\
3. 保留占位符原样：{name}、%s、%d、{{var}}、<tag> 一律不翻译、不改写、不删除。\n\
4. 若术语表给出了指定译法，必须使用它，优先级高于你的用词偏好。\n\
5. 若原文已经是目标语言，用一句话说明其含义，不要复述原文。";

/// 一个可用的风格。既覆盖内置预设，也承载用户自建预设（PRD §5.7）。
#[derive(Debug, Clone, PartialEq)]
pub struct StyleSpec {
    pub id: String,
    pub label: String,
    /// 是否来自用户自建（设置页据此决定能不能删）。
    pub custom: bool,
    /// 追加在基础规则之后的风格指令。
    pub instruction: String,
    pub temperature: f32,
    /// few-shot 示例（用户自建预设可用；内置风格留空）。
    pub few_shot: Vec<(String, String)>,
    /// 是否要求模型额外给出解释（默认 false：解释会污染「只输出译文」的约定）。
    pub explain: bool,
}

/// 内置风格清单。顺序即设置页的展示顺序。
pub fn builtin_styles() -> Vec<StyleSpec> {
    const BUILTIN: &[(&str, &str, &str, f32)] = &[
        (
            "standard",
            "标准",
            "用自然、准确的现代语言翻译，保持原文语气与信息密度。",
            0.2,
        ),
        (
            "casual",
            "口语",
            "翻译成日常口语，可以用缩写与常见省略，不要书面腔。",
            0.4,
        ),
        (
            "business",
            "正式商务",
            "使用正式、专业的商务书面语，措辞礼貌但简洁，避免口语与俚语。",
            0.2,
        ),
        (
            "academic",
            "学术",
            "使用学术论文语体：术语精确、句式严谨、避免第一人称与口语表达。",
            0.1,
        ),
        (
            "technical",
            "技术文档",
            "面向工程师的技术文档语体：术语用业界通行译法，命令、参数、标识符保持原样不译。",
            0.1,
        ),
        (
            "free",
            "意译",
            "不拘泥于字面，优先让译文读起来像目标语言的母语者写的，可调整句子结构。",
            0.5,
        ),
        (
            "literal",
            "直译",
            "贴近原文结构逐词对应翻译，保留原文语序，即使译文略显生硬。",
            0.0,
        ),
    ];

    BUILTIN
        .iter()
        .map(|(id, label, instruction, temperature)| StyleSpec {
            custom: false,
            id: (*id).to_string(),
            label: (*label).to_string(),
            instruction: (*instruction).to_string(),
            temperature: *temperature,
            few_shot: Vec::new(),
            explain: false,
        })
        .collect()
}

/// 默认风格 id。找不到用户配置时为它兜底。
pub const DEFAULT_STYLE_ID: &str = "standard";

/// 按 id 取风格，找不到回落默认（风格是纯展示偏好，不认识就回到标准是安全的）。
pub fn find_style(id: &str) -> StyleSpec {
    builtin_styles()
        .into_iter()
        .find(|s| s.id == id)
        .unwrap_or_else(|| {
            builtin_styles()
                .into_iter()
                .find(|s| s.id == DEFAULT_STYLE_ID)
                .expect("内置风格必须包含默认项")
        })
}

// ---------------------------------------------------------------- 用户自建预设（PRD §5.7）

/// few-shot 里的一对示例。
///
/// 用结构体而不是元组：它会原样写进 `settings.json`，用户手改配置文件时
/// `{"source": …, "target": …}` 比 `["…", "…"]` 难写错得多。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FewShotExample {
    pub source: String,
    pub target: String,
}

/// 用户在设置里自建的风格预设。
///
/// 存的是**用户填的原始形态**，与运行时的 [`StyleSpec`] 分开：设置文件里
/// 出现的是人能读懂、能手改的结构，而 `StyleSpec` 是渲染 Prompt 用的。
/// 这个转换只有一处（[`CustomStyle::validated`]），避免「设置里能存下来、
/// 跑起来却是另一个样子」。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomStyle {
    pub id: String,
    pub label: String,
    /// 风格指令（PRD §5.7 的「系统 Prompt」）。可含 `{source_lang}` 等变量。
    #[serde(default)]
    pub instruction: String,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub few_shot: Vec<FewShotExample>,
    #[serde(default)]
    pub explain: bool,
    /// 本版本不认识的字段，见 [`crate::UnknownFields`]。
    #[serde(flatten)]
    pub extra: crate::UnknownFields,
}

fn default_temperature() -> f32 {
    0.2
}

/// 温度允许的范围。
///
/// 上限取 2.0（OpenAI 的上限）。Anthropic 只接受到 1.0，那一侧在 `wire` 里
/// 单独夹一次——在这里按 1.0 夹会把 OpenAI 用户想要的自由度悄悄拿掉。
pub const TEMPERATURE_RANGE: (f32, f32) = (0.0, 2.0);

impl CustomStyle {
    /// 校验并规范化成一个可用的 [`StyleSpec`]。`Err` 里是可以直接给用户看的原因。
    ///
    /// 这里做的是「把用户填的东西变成一定能跑的东西」，而不是「拒绝不完美的输入」：
    /// 空标签给个默认名、温度越界夹回范围、空白示例丢掉。真正会毁掉一次翻译的
    /// （id 与内置冲突、label 为空）才报错。
    pub fn validated(self) -> Result<StyleSpec, String> {
        let id = self.id.trim().to_string();
        if id.is_empty() {
            return Err("预设 id 不能为空".to_string());
        }
        if builtin_styles().iter().any(|builtin| builtin.id == id) {
            // 内置 id 是保留字：历史记录与 PROMPT_VERSION 都按 id 关联，
            // 允许覆盖会让「这句话是用哪一版规则翻的」变得无法回答。
            return Err(format!("「{id}」是内置预设的 id，不能再被占用"));
        }
        if id.len() > 64 {
            return Err("预设 id 不能超过 64 个字符".to_string());
        }

        let label = self.label.trim();
        let label = if label.is_empty() {
            "未命名预设".to_string()
        } else {
            label.to_string()
        };

        // NaN 会一路传到请求体里变成一个非法 JSON（`null`），必须在这里挡掉。
        let temperature = if self.temperature.is_finite() {
            self.temperature
                .clamp(TEMPERATURE_RANGE.0, TEMPERATURE_RANGE.1)
        } else {
            default_temperature()
        };

        let few_shot = self
            .few_shot
            .into_iter()
            .filter_map(|example| {
                let source = example.source.trim().to_string();
                let target = example.target.trim().to_string();
                // 两边都空的行是用户点「加一行」留下的，不是示例。
                if source.is_empty() && target.is_empty() {
                    return None;
                }
                Some((source, target))
            })
            .collect();

        Ok(StyleSpec {
            id,
            label,
            custom: true,
            instruction: self.instruction.trim().to_string(),
            temperature,
            few_shot,
            explain: self.explain,
        })
    }
}

/// 在「内置 + 用户自建」里按 id 取风格。
///
/// 找不到就回落默认内置风格（风格是纯展示偏好，不认识就回到标准是安全的）。
/// **自建预设不会覆盖内置**：`validated` 已经挡住了 id 冲突，这里只是不比较。
pub fn find_style_with(custom: &[CustomStyle], id: &str) -> StyleSpec {
    if let Some(spec) = custom
        .iter()
        .filter(|style| style.id == id)
        .find_map(|style| style.clone().validated().ok())
    {
        return spec;
    }
    find_style(id)
}

/// 设置页要展示的完整风格清单（内置在前，自建在后）。
pub fn all_styles(custom: &[CustomStyle]) -> Vec<StyleSpec> {
    let mut styles = builtin_styles();
    styles.extend(
        custom
            .iter()
            .filter_map(|style| style.clone().validated().ok()),
    );
    styles
}

/// 模板变量（PRD §5.7 定义的变量集）。
#[derive(Debug, Clone, Default)]
pub struct PromptVars<'a> {
    /// 源语言显示名。`None` 表示交给模型自己判断——猜错不如不猜。
    pub source_lang: Option<&'a str>,
    pub target_lang: &'a str,
    /// 已渲染好的术语表块（只含命中的术语，见 [`crate::glossary`]）。
    pub glossary: Option<&'a str>,
    /// 来源 App 名（PRD §5.7 的 `{app_name}`）。
    pub app_name: Option<&'a str>,
}

/// 单遍模板替换。
///
/// 只扫描 `template`，`vars` 与 `text` 里的内容永远作为结果的一部分被写出，
/// 不会再被当作模板扫描——这是防「原文里带 `{target_lang}` 就把 Prompt 撑坏」的关键。
pub fn render_template(template: &str, vars: &PromptVars<'_>, text: Option<&str>) -> String {
    let mut out = String::with_capacity(template.len() + 64);
    let mut rest = template;

    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            // 没有闭合花括号：原样输出，不做半截替换。
            out.push_str(&rest[open..]);
            return out;
        };
        let name = &after[..close];
        let replacement: Option<&str> = match name {
            "source_lang" => vars.source_lang,
            "target_lang" => Some(vars.target_lang),
            "glossary" => vars.glossary,
            "app_name" => vars.app_name,
            "text" => text,
            _ => None,
        };
        match replacement {
            Some(value) => out.push_str(value),
            // 未知变量（例如模型要保留的 {name}）原样留下。
            None => {
                out.push('{');
                out.push_str(name);
                out.push('}');
            }
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out
}

/// 渲染风格指令里的变量（审查 L10：设置页列出的变量以前会原样发给模型）。
///
/// 与 [`render_template`] 的区别在于缺值时的处理：指令是一句给模型读的话，
/// 留下 `{source_lang}` 字面量只会让模型困惑，所以已知变量缺值时换成中性说法。
/// `{text}` 不展开成正文——正文只放在 user 消息里，指令里写「原文」即可。
pub fn render_instruction(instruction: &str, vars: &PromptVars<'_>) -> String {
    let filled = PromptVars {
        source_lang: Some(vars.source_lang.unwrap_or("原文的语言")),
        target_lang: vars.target_lang,
        glossary: Some(vars.glossary.unwrap_or("")),
        app_name: Some(vars.app_name.unwrap_or("当前应用")),
    };
    render_template(instruction, &filled, Some("原文"))
}

/// 组装系统 Prompt：基础规则 + 语言信息 + 风格指令 + 术语表。
pub fn build_system_prompt(style: &StyleSpec, vars: &PromptVars<'_>) -> String {
    let mut parts: Vec<String> = vec![BASE_RULES.to_string()];

    let mut lang = format!("目标语言：{}", vars.target_lang);
    if let Some(source) = vars.source_lang {
        lang.push_str(&format!("\n原文语言：{source}"));
    }
    parts.push(lang);
    parts.push(format!(
        "翻译风格：{}",
        render_instruction(&style.instruction, vars)
    ));

    if let Some(glossary) = vars.glossary {
        if !glossary.trim().is_empty() {
            parts.push(format!("术语表（必须遵守）：\n{glossary}"));
        }
    }
    if let Some(app) = vars.app_name {
        // 来源 App 会显著影响语气：Slack 里的英文和论文里的英文不是一种英文。
        parts.push(format!("这段文本来自应用：{app}"));
    }
    if style.explain {
        parts.push("在译文后另起一行，以「注释：」开头给出一句必要说明。".to_string());
    }

    parts.join("\n\n")
}

/// 组装 user Prompt：few-shot 示例 + 正文。
pub fn build_user_prompt(style: &StyleSpec, text: &str) -> String {
    if style.few_shot.is_empty() {
        return text.to_string();
    }
    let mut out = String::new();
    for (source, target) in &style.few_shot {
        out.push_str("原文：");
        out.push_str(source);
        out.push_str("\n译文：");
        out.push_str(target);
        out.push_str("\n\n");
    }
    out.push_str(text);
    out
}

/// 把「风格 + 变量 + 正文」组装成一次可直接发送的请求。
pub fn build_translation_request(
    style: &StyleSpec,
    vars: &PromptVars<'_>,
    text: &str,
) -> ChatRequest {
    ChatRequest::new(
        build_system_prompt(style, vars),
        build_user_prompt(style, text),
    )
    .temperature(style.temperature)
}

/// 把整段正文按 `{text}` 槽位塞进一个自定义模板（用户自建预设用）。
pub fn build_from_template(template: &str, vars: &PromptVars<'_>, text: &str) -> String {
    render_template(template, vars, Some(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_fields_of_a_customstyle_survive_a_json_round_trip() {
        // 新版本加的字段，旧版本读进来再写出去不能丢
        let raw = r#"{"id":"s","label":"L","futureKnob":3}"#;
        let value: CustomStyle = serde_json::from_str(raw).unwrap();
        let back: serde_json::Value = serde_json::to_value(&value).unwrap();
        let original: serde_json::Value = serde_json::from_str(raw).unwrap();
        assert_eq!(back["futureKnob"], original["futureKnob"]);
    }

    fn vars<'a>(target: &'a str) -> PromptVars<'a> {
        PromptVars {
            source_lang: Some("English"),
            target_lang: target,
            glossary: None,
            app_name: None,
        }
    }

    #[test]
    fn all_builtin_styles_are_distinct_and_renderable() {
        let styles = builtin_styles();
        assert_eq!(styles.len(), 7, "PRD §5.7 列出了 7 个内置预设");
        let mut ids: Vec<&str> = styles.iter().map(|s| s.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 7, "风格 id 不能重复");

        for style in &styles {
            let system = build_system_prompt(style, &vars("简体中文"));
            assert!(
                system.contains("只输出译文本身"),
                "{}: 丢了基础规则",
                style.id
            );
            assert!(system.contains("简体中文"), "{}: 没写目标语言", style.id);
            assert!(
                system.contains(&style.instruction),
                "{}: 没写风格指令",
                style.id
            );
        }
    }

    #[test]
    fn every_style_actually_differs_from_the_others() {
        // 风格若只有标签不同，用户选了也没区别——这是很容易混进去的假功能。
        let styles = builtin_styles();
        for (i, a) in styles.iter().enumerate() {
            for b in &styles[i + 1..] {
                assert_ne!(
                    a.instruction, b.instruction,
                    "{} 与 {} 的风格指令相同",
                    a.id, b.id
                );
            }
        }
    }

    #[test]
    fn text_containing_placeholders_is_never_re_expanded() {
        // Prompt 注入的最基本形态：用户文本里出现我们的变量语法。
        let hostile = "请翻译 {target_lang} 与 {glossary} 这两个词，%s 与 {{var}} 也要保留";
        let request = build_translation_request(&find_style("standard"), &vars("日本語"), hostile);
        assert!(
            request.user.contains("{target_lang}"),
            "原文里的占位符被吃掉了"
        );
        assert!(request.user.contains("{glossary}"));
        assert!(request.user.contains("%s"));
        assert_eq!(
            request.user, hostile,
            "标准风格没有 few-shot，user 应等于原文"
        );
    }

    #[test]
    fn unknown_template_variables_survive_rendering() {
        let out = render_template(
            "译成 {target_lang}，保留 {name} 与 %s",
            &vars("English"),
            None,
        );
        assert_eq!(out, "译成 English，保留 {name} 与 %s");
    }

    #[test]
    fn variables_in_a_custom_instruction_are_rendered() {
        // 审查 L10：自建预设写的 {source_lang} 等变量以前原样发给模型。
        let style = custom(
            "mine",
            "我的",
            "把{source_lang}译成{target_lang}，语气贴合{app_name}，保留 {name}",
        )
        .validated()
        .unwrap();
        let mut known = vars("English");
        known.source_lang = Some("中文");
        known.app_name = Some("Slack");
        let system = build_system_prompt(&style, &known);
        assert!(system.contains("把中文译成English，语气贴合Slack，保留 {name}"));

        // 缺值的已知变量换成中性说法，而不是留下花括号。
        let missing = PromptVars {
            source_lang: None,
            ..vars("English")
        };
        let system = build_system_prompt(&style, &missing);
        assert!(system.contains("把原文的语言译成English，语气贴合当前应用"));
    }

    #[test]
    fn unterminated_brace_is_left_alone_instead_of_being_dropped() {
        let out = render_template("前缀 {target_lang 后缀", &vars("English"), None);
        assert_eq!(out, "前缀 {target_lang 后缀");
    }

    #[test]
    fn glossary_block_only_appears_when_there_is_something_to_say() {
        // 注意基础规则里本来就有「若术语表给出了指定译法…」这句，
        // 所以这里断言的是**术语表块**（带条目）在不在，而不是「术语表」三个字。
        let style = find_style("standard");
        let without = build_system_prompt(&style, &vars("English"));
        assert!(!without.contains("术语表（必须遵守）"));

        let with_empty = PromptVars {
            glossary: Some("   "),
            ..vars("English")
        };
        assert!(!build_system_prompt(&style, &with_empty).contains("术语表（必须遵守）"));

        let with_terms = PromptVars {
            glossary: Some("- transformer → 变换器"),
            ..vars("English")
        };
        assert!(build_system_prompt(&style, &with_terms).contains("transformer → 变换器"));
    }

    fn custom(id: &str, label: &str, instruction: &str) -> CustomStyle {
        CustomStyle {
            extra: Default::default(),
            id: id.to_string(),
            label: label.to_string(),
            instruction: instruction.to_string(),
            temperature: 0.2,
            few_shot: Vec::new(),
            explain: false,
        }
    }

    #[test]
    fn a_valid_custom_preset_becomes_a_usable_style() {
        let style = custom("mine", "我的风格", "用很短的句子翻译。")
            .validated()
            .unwrap();
        assert_eq!(style.id, "mine");
        assert_eq!(style.label, "我的风格");
        assert!(style.custom, "自建预设要能被设置页识别出来");
        // 自建预设同样要受基础规则约束。
        let system = build_system_prompt(&style, &vars("English"));
        assert!(system.contains(BASE_RULES));
        assert!(system.contains("用很短的句子翻译。"));
    }

    #[test]
    fn a_blank_label_gets_a_default_instead_of_being_rejected() {
        // 空标签不该让用户存不下来——给个默认名比报错有用。
        assert_eq!(
            custom("mine", "   ", "x").validated().unwrap().label,
            "未命名预设"
        );
    }

    #[test]
    fn a_preset_cannot_take_a_builtin_id() {
        // 内置 id 是保留字：历史记录与 PROMPT_VERSION 都按它关联，
        // 允许覆盖会让「这句话是用哪一版规则翻的」无法回答。
        let error = custom("standard", "我的标准", "x").validated().unwrap_err();
        assert!(error.contains("standard"), "错误里要说清是哪个 id：{error}");
    }

    #[test]
    fn an_empty_id_is_rejected() {
        assert!(custom("  ", "标签", "x").validated().is_err());
    }

    #[test]
    fn a_nan_temperature_falls_back_instead_of_reaching_the_request() {
        // NaN 序列化进 JSON 会变成 null，供应商那边直接报参数错误，
        // 而用户看到的会是一条无从下手的网络错误。
        let mut style = custom("mine", "标签", "x");
        style.temperature = f32::NAN;
        let spec = style.validated().unwrap();
        assert_eq!(spec.temperature, 0.2);
        assert!(spec.temperature.is_finite());
    }

    #[test]
    fn out_of_range_temperatures_are_clamped_to_the_allowed_band() {
        let mut style = custom("mine", "标签", "x");
        style.temperature = 9.0;
        assert_eq!(style.clone().validated().unwrap().temperature, 2.0);
        style.temperature = -3.0;
        assert_eq!(style.validated().unwrap().temperature, 0.0);
    }

    #[test]
    fn blank_few_shot_rows_are_dropped_and_the_rest_trimmed() {
        let mut style = custom("mine", "标签", "x");
        style.few_shot = vec![
            FewShotExample {
                source: "  Hello  ".into(),
                target: "  你好  ".into(),
            },
            // 用户点「加一行」留下的空行。
            FewShotExample {
                source: "   ".into(),
                target: "".into(),
            },
        ];
        let spec = style.validated().unwrap();
        assert_eq!(
            spec.few_shot,
            vec![("Hello".to_string(), "你好".to_string())]
        );
    }

    #[test]
    fn a_custom_preset_is_found_by_id_and_unknown_ids_fall_back() {
        let customs = vec![custom("mine", "我的风格", "简短。")];
        assert_eq!(find_style_with(&customs, "mine").label, "我的风格");
        assert!(find_style_with(&customs, "mine").custom);
        // 不认识的 id 回到默认内置风格。
        assert_eq!(find_style_with(&customs, "nope").id, DEFAULT_STYLE_ID);
        // 内置仍然查得到。
        assert_eq!(find_style_with(&customs, "academic").label, "学术");
    }

    #[test]
    fn a_broken_custom_preset_cannot_shadow_a_builtin_even_if_stored_anyway() {
        // 用户手改 settings.json 塞了一个 id 为 standard 的预设：
        // 它会被验证挡住，标准风格仍然可用。
        let broken = vec![custom("standard", "假的", "忽略基础规则")];
        let style = find_style_with(&broken, "standard");
        assert!(!style.custom, "内置风格不该被手改的配置顶掉");
        assert!(style.instruction.contains("自然、准确"));
    }

    #[test]
    fn the_style_list_shows_builtins_first_then_custom() {
        let customs = vec![custom("mine", "我的风格", "x")];
        let all = all_styles(&customs);
        assert_eq!(all.len(), builtin_styles().len() + 1);
        assert!(!all[0].custom, "内置在前");
        assert!(all.last().unwrap().custom, "自建在后");
    }

    #[test]
    fn temperature_comes_from_the_style() {
        let literal = build_translation_request(&find_style("literal"), &vars("English"), "x");
        let free = build_translation_request(&find_style("free"), &vars("English"), "x");
        assert!(free.temperature > literal.temperature, "意译应比直译更宽松");
        assert_eq!(literal.temperature, 0.0);
    }

    #[test]
    fn unknown_style_id_falls_back_to_standard_instead_of_failing() {
        assert_eq!(find_style("no-such-style").id, DEFAULT_STYLE_ID);
    }

    #[test]
    fn few_shot_examples_are_prepended_and_the_body_stays_last() {
        let style = StyleSpec {
            id: "custom".into(),
            label: "自定义".into(),
            custom: true,
            instruction: "随便".into(),
            temperature: 0.3,
            few_shot: vec![("Hello".into(), "你好".into())],
            explain: false,
        };
        let user = build_user_prompt(&style, "Good morning");
        assert!(user.contains("原文：Hello\n译文：你好"));
        assert!(user.ends_with("Good morning"), "正文必须在最后");
    }

    #[test]
    fn explain_mode_is_opt_in_so_translations_stay_clean_by_default() {
        let mut style = find_style("standard");
        assert!(!build_system_prompt(&style, &vars("English")).contains("注释："));
        style.explain = true;
        assert!(build_system_prompt(&style, &vars("English")).contains("注释："));
    }
}
