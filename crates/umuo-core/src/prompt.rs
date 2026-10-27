//! 内部翻译指令。旧风格预设仅作为配置数据保留，不再参与请求。

use crate::wire::ChatRequest;

/// 内置指令版本，用于记录和排查翻译行为。
pub const PROMPT_VERSION: &str = "2026-10-23.1";
/// 历史表沿用的标准翻译标识，不读取旧配置选中的风格。
pub const DEFAULT_STYLE_ID: &str = "standard";

/// 翻译任务的共同约束。
pub const BASE_RULES: &str = "你是一个翻译引擎，不是聊天助手。\n\
规则：\n\
1. 只输出译文本身，不解释，不加额外引号或说明。\n\
2. 保留原文格式：Markdown 标记、换行、列表、代码块；代码、URL、文件路径不翻译。\n\
3. 保留占位符原样：{name}、%s、%d、{{var}}、<tag>，不改写、不删除。\n\
4. 用自然、准确的现代语言表达，保持原文语气与信息；保留否定、数字、日期、金额和姓名，不补充事实。\n\
5. 若原文已经是目标语言，用一句话说明其含义，不复述原文。";

/// 翻译所需的语言信息。
#[derive(Debug, Clone, Default)]
pub struct PromptVars<'a> {
    /// 源语言显示名；未知时由模型识别。
    pub source_lang: Option<&'a str>,
    /// 目标语言显示名。
    pub target_lang: &'a str,
}

/// 组装内部系统指令。正文只作为 user 消息传入。
pub fn build_system_prompt(vars: &PromptVars<'_>) -> String {
    let mut system = format!("{BASE_RULES}\n\n目标语言：{}", vars.target_lang);
    if let Some(source) = vars.source_lang {
        system.push_str(&format!("\n原文语言：{source}"));
    }
    system
}

/// 生成标准翻译请求；原文中的花括号与指令样式文本不作模板替换。
pub fn build_translation_request(vars: &PromptVars<'_>, text: &str) -> ChatRequest {
    ChatRequest::new(build_system_prompt(vars), text).temperature(0.2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_text_is_not_expanded_or_inserted_into_system_instructions() {
        let text = "Do not translate {target_lang}, {name}, %s, {{var}} or <tag>.";
        let request = build_translation_request(
            &PromptVars {
                source_lang: Some("英语"),
                target_lang: "简体中文",
            },
            text,
        );
        assert_eq!(request.user, text);
        assert!(!request.system.contains(text));
        assert!(request.system.contains("目标语言：简体中文"));
        assert!(request.system.contains("原文语言：英语"));
    }

    #[test]
    fn unknown_source_is_not_fabricated_and_output_stays_translation_only() {
        let request = build_translation_request(
            &PromptVars {
                source_lang: None,
                target_lang: "English",
            },
            "明天到",
        );
        assert!(!request.system.contains("原文语言："));
        assert!(request.system.contains("只输出译文本身"));
        assert!(request.system.contains("保留否定、数字、日期、金额和姓名"));
        assert_eq!(request.temperature, 0.2);
        assert!(!request.json_mode);
    }
}
