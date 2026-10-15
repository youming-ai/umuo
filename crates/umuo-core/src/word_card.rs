//! 单词模式与词卡（PRD §5.2：选中单个词（≤ 3 个词）时返回结构化词卡）。
//!
//! 「什么时候该出词卡」是个纯判定，值得单独测：判宽了，用户划一整句会拿到一张
//! 莫名其妙的词卡；判窄了，划一个词却只得到一句平铺直叙的译文。

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::prompt::PromptVars;
use crate::wire::ChatRequest;

/// 超过这个词数就不再是「查词」，而是「翻译句子」。
pub const WORD_MODE_MAX_WORDS: usize = 3;
/// 再长也不像单个词条了（防止一段没有空格的日语被当成一个「词」）。
pub const WORD_MODE_MAX_CHARS: usize = 40;

/// 判断一段选区是否该走词卡模式。
pub fn is_word_mode(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > WORD_MODE_MAX_CHARS {
        return false;
    }
    // 含句末标点说明用户选的是一句话，不是词。
    if trimmed
        .chars()
        .any(|c| matches!(c, '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';'))
    {
        return false;
    }
    word_count(trimmed) <= WORD_MODE_MAX_WORDS
}

/// 数词。中日韩按「连续的表意文字块算一个词」，其余按空白分词。
fn word_count(text: &str) -> usize {
    let mut count = 0usize;
    let mut in_cjk_run = false;
    for ch in text.chars() {
        let c = ch as u32;
        let is_cjk = matches!(c, 0x3040..=0x30FF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF);
        if is_cjk {
            if !in_cjk_run {
                count += 1;
                in_cjk_run = true;
            }
        } else {
            in_cjk_run = false;
        }
    }
    let latin_words = text
        .split_whitespace()
        .filter(|w| w.chars().any(|c| c.is_alphanumeric() && !is_cjk_char(c)))
        .count();
    count + latin_words
}

fn is_cjk_char(ch: char) -> bool {
    matches!(ch as u32, 0x3040..=0x30FF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF)
}

/// 词卡里的一条释义。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WordSense {
    #[serde(default, alias = "pos", alias = "partOfSpeech")]
    pub part_of_speech: String,
    #[serde(
        default,
        alias = "meaning",
        alias = "translation",
        alias = "definition"
    )]
    pub definition: String,
}

/// 例句。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WordExample {
    #[serde(default, alias = "text", alias = "sentence")]
    pub source: String,
    #[serde(default, alias = "translation", alias = "target")]
    pub target: String,
}

/// 一张词卡。字段全部允许缺失——模型少给一项不该让整张卡失败。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WordCard {
    #[serde(alias = "text", alias = "term")]
    pub word: String,
    #[serde(default, alias = "ipa", alias = "pronunciation")]
    pub phonetic: Option<String>,
    #[serde(default, alias = "meanings", alias = "definitions")]
    pub senses: Vec<WordSense>,
    #[serde(default, alias = "inflections", alias = "word_forms")]
    pub forms: Vec<String>,
    #[serde(default, alias = "sentences")]
    pub examples: Vec<WordExample>,
}

/// 词卡请求。用 JSON 模式，并在 Prompt 里写死字段名——Anthropic 没有
/// `response_format`，只能靠 Prompt 约束（PRD §6.5）。
pub fn build_request(word: &str, vars: &PromptVars<'_>) -> ChatRequest {
    let system = format!(
        "你是一部{}词典。用户给你一个词或短语，你返回结构化词卡。\n\
只输出 JSON，不要 markdown 代码围栏，不要任何解释。字段：\n\
{{\n\
  \"word\": \"原词\",\n\
  \"phonetic\": \"发音标注：英文等用国际音标，中文用拼音（带声调），日文用罗马字；没有则空串\",\n\
  \"senses\": [{{\"part_of_speech\": \"词性\", \"definition\": \"用{target}写的释义\"}}],\n\
  \"forms\": [\"词形变化，如时态/复数\"],\n\
  \"examples\": [{{\"source\": \"例句原文\", \"target\": \"该例句的{target}译文\"}}]\n\
}}\n\
释义按常用度排序，最多 4 条；例句给 2 条，要能体现该词的典型用法。",
        vars.source_lang.unwrap_or("多语言"),
        target = vars.target_lang,
    );
    ChatRequest::new(system, word.to_string())
        .json()
        .temperature(0.3)
}

/// 解析词卡 JSON。
///
/// 容错策略与 PRD §6.5 一致：模型输出不是合法 JSON 时，调用方仍应把**原始文本**
/// 展示出来（降级为纯文本），所以这里的错误只需要能区分「解析失败」。
pub fn parse(text: &str) -> Result<WordCard, CoreError> {
    let cleaned = strip_fence(text);
    let mut card: WordCard =
        serde_json::from_str(&cleaned).map_err(|e| CoreError::BadResponse {
            detail: format!("词卡 JSON 解析失败：{e}"),
        })?;
    // 模型偶尔只给 phonetic 不给 senses；把空的 definition 过滤掉，
    // 免得 UI 上出现一排空白行。
    card.senses.retain(|s| !s.definition.trim().is_empty());
    card.examples
        .retain(|e| !e.source.trim().is_empty() || !e.target.trim().is_empty());
    if card.word.trim().is_empty() {
        return Err(CoreError::BadResponse {
            detail: "词卡缺少 word 字段".to_string(),
        });
    }
    Ok(card)
}

/// 去掉 markdown 代码围栏并截取最外层 JSON 对象。
///
/// 模型（尤其非 JSON 模式的模型）经常回 ```json … ``` 或者前后带一句话，
/// 这一步不成功也不报错，交给 `serde_json` 去判定。
pub fn strip_fence(s: &str) -> String {
    let trimmed = s.trim();
    let mut body = trimmed;
    if let Some(rest) = body.strip_prefix("```json") {
        body = rest;
    } else if let Some(rest) = body.strip_prefix("```") {
        body = rest;
    }
    if let Some(rest) = body.strip_suffix("```") {
        body = rest;
    }
    let body = body.trim();
    match (body.find('{'), body.rfind('}')) {
        (Some(start), Some(end)) if end > start => body[start..=end].to_string(),
        _ => body.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars<'a>(target: &'a str) -> PromptVars<'a> {
        PromptVars {
            source_lang: Some("English"),
            target_lang: target,
            glossary: None,
            app_name: None,
        }
    }

    #[test]
    fn single_words_and_short_phrases_are_word_mode() {
        assert!(is_word_mode("hello"));
        assert!(is_word_mode("hello world"));
        assert!(is_word_mode("give up on"));
        assert!(is_word_mode("翻译"));
        assert!(is_word_mode("机器学习"));
    }

    #[test]
    fn sentences_are_not_word_mode() {
        assert!(!is_word_mode("This is a full sentence."));
        assert!(!is_word_mode("这是一整句话。"));
        assert!(!is_word_mode(""));
        assert!(!is_word_mode("   "));
    }

    #[test]
    fn four_words_is_already_a_sentence_not_a_card() {
        // PRD 写的是「≤ 3 个词」。
        assert!(is_word_mode("one two three"));
        assert!(!is_word_mode("one two three four"));
    }

    #[test]
    fn a_long_unbroken_cjk_run_is_not_a_single_word() {
        // 没有空格的长句（日语常见）不该被当成一个词。
        let long = "日本語の文章がそのまま長く続いている場合のテスト".repeat(2);
        assert!(!is_word_mode(&long));
    }

    #[test]
    fn word_card_prompt_pins_the_json_shape_and_the_target_language() {
        let request = build_request("hello", &vars("简体中文"));
        assert!(request.json_mode, "词卡必须走 JSON 模式");
        assert!(request.system.contains("简体中文"));
        // 字段名写进 Prompt 是给没有 response_format 的 Anthropic 兜底的。
        for field in ["word", "phonetic", "senses", "forms", "examples"] {
            assert!(request.system.contains(field), "Prompt 缺字段 {field}");
        }
        assert_eq!(request.user, "hello");
    }

    #[test]
    fn the_prompt_asks_for_pinyin_when_the_source_is_chinese() {
        // PRD §5.1 把「音标与拼音」列为同一项能力：中文的发音标注就是拼音，
        // 不能只写「国际音标」——那会让模型对中文返回空串。
        let request = build_request("你好", &vars("English"));
        assert!(request.system.contains("拼音"), "词卡 Prompt 必须覆盖拼音");
        assert!(request.system.contains("罗马字"), "日文用罗马字");
    }

    #[test]
    fn parsing_accepts_a_plain_json_object() {
        let card = parse(
            r#"{"word":"hello","phonetic":"/həˈloʊ/","senses":[{"part_of_speech":"int.","definition":"你好"}],"forms":[],"examples":[{"source":"Hello there","target":"你好"}]}"#,
        )
        .unwrap();
        assert_eq!(card.word, "hello");
        assert_eq!(card.senses.len(), 1);
        assert_eq!(card.senses[0].definition, "你好");
        assert_eq!(card.examples[0].target, "你好");
    }

    #[test]
    fn parsing_survives_markdown_fences_and_surrounding_prose() {
        // 这是最常见的失败形态：JSON 模式没生效，模型自顾自加了围栏。
        let raw = "好的，这是词卡：\n```json\n{\"word\":\"hello\",\"senses\":[{\"definition\":\"你好\"}]}\n```\n希望有帮助！";
        let card = parse(raw).unwrap();
        assert_eq!(card.word, "hello");
    }

    #[test]
    fn partial_cards_are_accepted_with_alternative_field_names() {
        let card =
            parse(r#"{"term":"hi","pos":"int.","meanings":[{"pos":"int.","meaning":"嗨"}]}"#);
        // word 用别名 term；senses 用别名 meanings，释义用 meaning。
        let card = card.unwrap();
        assert_eq!(card.word, "hi");
        assert_eq!(card.senses[0].definition, "嗨");
    }

    #[test]
    fn empty_senses_are_pruned_so_the_ui_has_no_blank_rows() {
        let card = parse(r#"{"word":"x","senses":[{"definition":"  "},{"definition":"真释义"}]}"#)
            .unwrap();
        assert_eq!(card.senses.len(), 1);
        assert_eq!(card.senses[0].definition, "真释义");
    }

    #[test]
    fn malformed_output_is_an_error_so_the_caller_can_fall_back_to_plain_text() {
        let err = parse("抱歉，我无法回答这个问题。").unwrap_err();
        assert!(matches!(err, CoreError::BadResponse { .. }));
    }

    #[test]
    fn a_card_without_the_word_field_is_rejected() {
        let err = parse(r#"{"phonetic":"/x/"}"#).unwrap_err();
        assert!(matches!(err, CoreError::BadResponse { .. }));
    }

    #[test]
    fn strip_fence_leaves_plain_json_untouched() {
        assert_eq!(strip_fence(r#"{"a":1}"#), r#"{"a":1}"#);
        assert_eq!(strip_fence("```\n{\"a\":1}\n```"), r#"{"a":1}"#);
    }
}
