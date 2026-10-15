//! 术语表（PRD §5.8）。
//!
//! 关键设计是**只注入命中的术语**，而不是把整张表塞进每次请求：
//! 一张 500 条的术语表如果全量注入，每次翻译都要多花几千 token，
//! 用户会在账单上看到这笔钱，却不知道为什么。

use serde::{Deserialize, Serialize};

/// 一条术语映射。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GlossaryEntry {
    pub source: String,
    pub target: String,
}

/// 一张术语表。按语言对生效（PRD §5.8）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Glossary {
    pub id: String,
    pub name: String,
    /// 空字符串表示「不限源语言」。
    #[serde(default)]
    pub source_lang: String,
    /// 空字符串表示「不限目标语言」。
    #[serde(default)]
    pub target_lang: String,
    #[serde(default)]
    pub entries: Vec<GlossaryEntry>,
}

/// 这张表是否该用在当前语言对上。
pub fn applies_to(glossary: &Glossary, source_lang: Option<&str>, target_lang: &str) -> bool {
    let lang_ok = |configured: &str, actual: &str| {
        configured.is_empty() || crate::lang::same_language(configured, actual)
    };
    let source_ok = match source_lang {
        Some(source) => lang_ok(&glossary.source_lang, source),
        // 源语言未知时不因此排除这张表——它多半仍然适用。
        None => true,
    };
    source_ok && lang_ok(&glossary.target_lang, target_lang)
}

/// 找出文本里命中的术语。
///
/// 匹配规则：
/// - 大小写不敏感（`Transformer` 与 `transformer` 是同一条）。
/// - **纯 ASCII 术语要求词边界**：否则 `cat` 会命中 `concatenate`，
///   用户会看到完全莫名其妙的强制译法。
/// - 中日韩术语按子串匹配（中文没有词边界这回事）。
pub fn matches<'a>(glossary: &'a Glossary, text: &str) -> Vec<&'a GlossaryEntry> {
    let haystack = text.to_lowercase();
    let mut found: Vec<&GlossaryEntry> = Vec::new();
    for entry in &glossary.entries {
        let needle = entry.source.trim().to_lowercase();
        if needle.is_empty() {
            continue;
        }
        if contains_term(&haystack, &needle) {
            found.push(entry);
        }
    }
    found
}

/// 把命中的术语渲染成注入 Prompt 的块。没有命中时返回 `None`。
pub fn render_block<'a>(entries: impl IntoIterator<Item = &'a GlossaryEntry>) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    for entry in entries {
        let line = format!("- {} → {}", entry.source.trim(), entry.target.trim());
        // 同一张表里可能有重复条目（用户手抖），去重后注入。
        if !lines.contains(&line) {
            lines.push(line);
        }
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

/// 一次「按语言对筛选 + 找命中 + 渲染」的完整流程。没有命中时返回 `None`，
/// 调用方据此跳过注入（也就不会把 `{glossary}` 段写进 Prompt）。
pub fn block_for(
    glossaries: &[Glossary],
    source_lang: Option<&str>,
    target_lang: &str,
    text: &str,
) -> Option<String> {
    let mut hits: Vec<&GlossaryEntry> = Vec::new();
    for glossary in glossaries {
        if applies_to(glossary, source_lang, target_lang) {
            hits.extend(matches(glossary, text));
        }
    }
    render_block(hits)
}

fn contains_term(haystack_lower: &str, needle_lower: &str) -> bool {
    if is_plain_ascii(needle_lower) {
        let mut search_from = 0usize;
        while let Some(offset) = haystack_lower[search_from..].find(needle_lower) {
            let start = search_from + offset;
            let end = start + needle_lower.len();
            let left_ok = haystack_lower[..start]
                .chars()
                .next_back()
                .map(|c| !c.is_alphanumeric())
                .unwrap_or(true);
            let right_ok = haystack_lower[end..]
                .chars()
                .next()
                .map(|c| !c.is_alphanumeric())
                .unwrap_or(true);
            if left_ok && right_ok {
                return true;
            }
            search_from = end;
        }
        false
    } else {
        haystack_lower.contains(needle_lower)
    }
}

fn is_plain_ascii(s: &str) -> bool {
    !s.is_empty() && s.is_ascii()
}

// ---------------------------------------------------------------- CSV / TSV 导入导出（PRD §5.8）

/// 导入时的分隔符。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delimiter {
    /// 逗号。也覆盖 Excel 导出的「带引号逗号」。
    Comma,
    /// 制表符。从 Excel / Numbers 直接复制粘贴出来就是它。
    Tab,
}

impl Delimiter {
    fn byte(self) -> char {
        match self {
            Delimiter::Comma => ',',
            Delimiter::Tab => '\t',
        }
    }

    /// 猜一猜这段文本用的是哪个分隔符。
    ///
    /// 按「第一行里哪个分隔符出现得多」判断。两者都没有时按逗号处理——
    /// 单列文本在两种解析下都会得到同样的错误结果，选哪个都一样。
    pub fn sniff(text: &str) -> Self {
        let first_line = text
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("");
        // 引号里的分隔符不算：`"a,b"\tc` 只有一个制表符。
        let mut commas = 0;
        let mut tabs = 0;
        let mut in_quotes = false;
        for ch in first_line.chars() {
            match ch {
                '"' => in_quotes = !in_quotes,
                ',' if !in_quotes => commas += 1,
                '\t' if !in_quotes => tabs += 1,
                _ => {}
            }
        }
        if tabs > commas {
            Delimiter::Tab
        } else {
            Delimiter::Comma
        }
    }
}

/// 判断这一行是不是表头。
///
/// 只看前两个字段：`原文/译文`、`source/target`、`术语/译法` 这类常见写法。
/// **不做模糊判断**——把用户真正的术语当成表头丢掉，比多留一行表头糟糕得多。
fn looks_like_header(fields: &[String]) -> bool {
    let head = |s: &str| s.trim().trim_matches('"').to_ascii_lowercase();
    let first = fields.first().map(|s| head(s)).unwrap_or_default();
    let second = fields.get(1).map(|s| head(s)).unwrap_or_default();
    let known = [
        ("source", "target"),
        ("原文", "译文"),
        ("术语", "译法"),
        ("原词", "译词"),
        ("term", "translation"),
        ("from", "to"),
    ];
    known.iter().any(|(a, b)| first == *a && second == *b)
}

/// 解析 CSV / TSV 文本。
///
/// **整段扫描，而不是先按行切。** RFC 4180 允许引号字段里含换行，
/// 逐行解析会把这种字段从中间切开、整条术语静默丢失——而导出那边是会正确加引号的，
/// 于是「导出再导入」就丢数据。往返测试当场抓到了这一点。
///
/// 其它容错的地方（都是从 Excel / 记事本里复制粘贴会遇到的情况）：
/// - 首行的 UTF-8 BOM（Excel 存 CSV 必带，不处理的话第一个术语永远匹配不上）
/// - 表头行（按 [`looks_like_header`] 判断）
/// - 空行、`#` 开头的注释行
/// - 只有一列的行（缺少译文）——丢掉，因为空译法注入进去只会让模型困惑
/// - 多余列（第三列以后）忽略；字段两侧空白裁掉
pub fn parse_delimited(text: &str) -> Vec<GlossaryEntry> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let delimiter = Delimiter::sniff(text).byte();

    let mut entries = Vec::new();
    let mut fields: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut first_record = true;

    let mut flush = |fields: &mut Vec<String>, first_record: &mut bool| {
        let record = std::mem::take(fields);
        // 空行（只有一个空字段）。
        if record.iter().all(|f| f.trim().is_empty()) {
            return;
        }
        if *first_record {
            *first_record = false;
            if looks_like_header(&record) {
                return;
            }
        }
        // 注释行：`# ...` 只有一个字段。
        if record.len() == 1 && record[0].trim_start().starts_with('#') {
            return;
        }
        let source = record
            .first()
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let target = record
            .get(1)
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if source.is_empty() || target.is_empty() {
            return;
        }
        entries.push(GlossaryEntry { source, target });
    };

    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            // 字段**开头**的引号才开启引号模式；字段中间的引号按字面处理。
            '"' if in_quotes => {
                if chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            }
            '"' if current.is_empty() => in_quotes = true,
            c if c == delimiter && !in_quotes => fields.push(std::mem::take(&mut current)),
            '\n' if !in_quotes => {
                fields.push(std::mem::take(&mut current));
                flush(&mut fields, &mut first_record);
            }
            // CRLF 里的 CR 丢掉；引号内的 CR 也是内容的一部分，但同样该丢——
            // 它是行结束符而不是术语的一部分。
            '\r' => {}
            c => current.push(c),
        }
    }
    // 最后一条没有换行结尾的记录。
    if !current.is_empty() || !fields.is_empty() {
        fields.push(std::mem::take(&mut current));
        flush(&mut fields, &mut first_record);
    }

    entries
}

/// 导出成 CSV（带表头）。
///
/// 导出用逗号而不是制表符：导出是为了存档与交付，逗号是那个场合的通用格式。
/// 需要制表符时用户自己复制粘贴即可——粘贴进来的解析两种都认。
pub fn to_csv(entries: &[GlossaryEntry]) -> String {
    let quote = |value: &str| -> String {
        if value.contains([',', '"', '\n', '\r']) {
            format!("\"{}\"", value.replace('"', "\"\""))
        } else {
            value.to_string()
        }
    };
    let mut out = String::from("原文,译文\n");
    for entry in entries {
        out.push_str(&quote(&entry.source));
        out.push(',');
        out.push_str(&quote(&entry.target));
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(source: &str, target: &str) -> GlossaryEntry {
        GlossaryEntry {
            source: source.into(),
            target: target.into(),
        }
    }

    fn glossary(entries: Vec<GlossaryEntry>) -> Glossary {
        Glossary {
            id: "g1".into(),
            name: "技术术语".into(),
            source_lang: "en".into(),
            target_lang: "zh-CN".into(),
            entries,
        }
    }

    #[test]
    fn ascii_terms_require_word_boundaries() {
        // 「cat」不该命中「concatenate」——这会让用户看到莫名其妙的强制译法。
        let g = glossary(vec![entry("cat", "猫")]);
        assert!(matches(&g, "the cat sat").len() == 1);
        assert!(
            matches(&g, "concatenate the strings").is_empty(),
            "不该命中 concatenate"
        );
    }

    #[test]
    fn matching_is_case_insensitive() {
        let g = glossary(vec![entry("Transformer", "变换器")]);
        assert_eq!(matches(&g, "A transformer model").len(), 1);
        assert_eq!(matches(&g, "TRANSFORMER").len(), 1);
    }

    #[test]
    fn cjk_terms_match_as_substrings() {
        // 中文没有词边界，子串匹配是唯一可行的做法。
        let g = glossary(vec![entry("神经网络", "neural network")]);
        assert_eq!(matches(&g, "深度神经网络模型").len(), 1);
    }

    #[test]
    fn only_matched_terms_are_injected_to_control_token_cost() {
        let g = glossary(vec![
            entry("transformer", "变换器"),
            entry("gradient descent", "梯度下降"),
            entry("unrelated", "无关词"),
        ]);
        let block = block_for(&[g], Some("en"), "zh-CN", "The transformer is here.").unwrap();
        assert!(block.contains("transformer → 变换器"));
        assert!(
            !block.contains("gradient descent"),
            "没命中的术语不该进 Prompt"
        );
        assert!(!block.contains("unrelated"));
    }

    #[test]
    fn no_hits_yields_none_so_the_prompt_gets_no_empty_glossary_section() {
        let g = glossary(vec![entry("transformer", "变换器")]);
        assert!(block_for(&[g], Some("en"), "zh-CN", "nothing relevant here").is_none());
    }

    #[test]
    fn language_pair_scoping_is_respected() {
        let en_to_zh = glossary(vec![entry("token", "词元")]);
        assert!(applies_to(&en_to_zh, Some("en"), "zh-CN"));
        // 目标语言不同 → 这张表不该生效。
        assert!(!applies_to(&en_to_zh, Some("en"), "ja"));
        // 源语言未知 → 仍然尝试使用，而不是白白丢掉用户配好的术语。
        assert!(applies_to(&en_to_zh, None, "zh-CN"));
    }

    #[test]
    fn wildcard_language_fields_make_a_glossary_universal() {
        let universal = Glossary {
            id: "g".into(),
            name: "通用".into(),
            source_lang: String::new(),
            target_lang: String::new(),
            entries: vec![entry("umuo", "umuo")],
        };
        assert!(applies_to(&universal, Some("ja"), "en"));
        assert!(applies_to(&universal, None, "en"));
    }

    #[test]
    fn duplicate_entries_are_rendered_once() {
        let entries = [entry("token", "词元"), entry("token", "词元")];
        let block = render_block(entries.iter()).unwrap();
        assert_eq!(block.matches("词元").count(), 1);
    }

    #[test]
    fn blank_entries_are_ignored_instead_of_matching_everything() {
        // 空 source 若被当成子串，会命中任意文本并把空译法注入 Prompt。
        let g = glossary(vec![entry("  ", "x")]);
        assert!(matches(&g, "anything at all").is_empty());
    }

    #[test]
    fn regional_variants_of_the_same_language_share_a_glossary() {
        let g = glossary(vec![entry("token", "词元")]);
        assert!(applies_to(&g, Some("en-US"), "zh-TW"), "简繁不该互相排除");
    }

    // ---------------------------------------------------------- CSV / TSV

    #[test]
    fn a_plain_two_column_csv_parses() {
        let entries = parse_delimited("Transformer,变换器\nPrompt,提示词\n");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].source, "Transformer");
        assert_eq!(entries[1].target, "提示词");
    }

    #[test]
    fn tsv_is_detected_automatically() {
        // 从 Excel 里直接复制粘贴出来就是制表符分隔的。
        let entries = parse_delimited("Transformer\t变换器\nPrompt\t提示词\n");
        assert_eq!(entries.len(), 2, "制表符分隔应当被识别：{entries:?}");
        assert_eq!(entries[0].target, "变换器");
    }

    #[test]
    fn a_known_header_row_is_skipped() {
        let entries = parse_delimited("原文,译文\nTransformer,变换器\n");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "Transformer");
        assert_eq!(parse_delimited("source,target\nA,B\n")[0].source, "A");
    }

    #[test]
    fn a_potential_term_is_never_mistaken_for_a_header() {
        // 把用户真正的术语当表头丢掉，比多留一行表头糟糕得多——
        // 所以只认那几个明确的表头写法。
        let entries = parse_delimited("cat,猫\n");
        assert_eq!(entries.len(), 1, "cat/猫 不是表头");
    }

    #[test]
    fn quoted_fields_may_contain_the_delimiter() {
        // 公司名带逗号是常态，不支持引号的话这条会被切成两列。
        let entries = parse_delimited("\"ACME, Inc.\",ACME 公司\n");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "ACME, Inc.");
        assert_eq!(entries[0].target, "ACME 公司");
    }

    #[test]
    fn doubled_quotes_inside_a_field_become_one_quote() {
        let entries = parse_delimited("\"say \"\"hi\"\"\",打招呼\n");
        assert_eq!(entries[0].source, "say \"hi\"");
    }

    #[test]
    fn a_utf8_bom_from_excel_is_ignored() {
        // Excel 存出来的 CSV 必带 BOM；不处理的话第一个术语会多一个不可见字符，
        // 于是它永远匹配不上。
        let entries = parse_delimited("\u{feff}Transformer,变换器\n");
        assert_eq!(entries[0].source, "Transformer");
    }

    #[test]
    fn blank_lines_comments_and_single_column_rows_are_dropped() {
        let entries = parse_delimited("# 这是注释\n\nTransformer,变换器\n只有一列\n");
        assert_eq!(entries.len(), 1, "实际解析出：{entries:?}");
    }

    #[test]
    fn extra_columns_are_ignored_and_whitespace_trimmed() {
        let entries = parse_delimited("  Transformer  ,  变换器  ,备注列\n");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source, "Transformer");
        assert_eq!(entries[0].target, "变换器");
    }

    #[test]
    fn an_empty_input_yields_no_entries() {
        assert!(parse_delimited("").is_empty());
        assert!(parse_delimited("   \n\n").is_empty());
    }

    #[test]
    fn export_quotes_only_when_needed_and_writes_a_header() {
        let csv = to_csv(&[
            entry("Transformer", "变换器"),
            entry("ACME, Inc.", "ACME 公司"),
            entry("say \"hi\"", "打招呼"),
        ]);
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines[0], "原文,译文");
        assert_eq!(lines[1], "Transformer,变换器", "无需引号时不加引号");
        assert_eq!(lines[2], "\"ACME, Inc.\",ACME 公司");
        assert_eq!(lines[3], "\"say \"\"hi\"\"\",打招呼");
    }

    #[test]
    fn export_then_import_round_trips() {
        // 导出是为了存档与交付，绕一圈必须能回来，否则这个功能没有意义。
        let original = vec![
            entry("Transformer", "变换器"),
            entry("ACME, Inc.", "ACME 公司"),
            entry("say \"hi\"", "打招呼"),
            entry("多行\n术语", "多行译法"),
        ];
        let back = parse_delimited(&to_csv(&original));
        assert_eq!(back, original);
    }

    #[test]
    fn the_sniffer_ignores_delimiters_inside_quotes() {
        // 第一行是 `"a,b"\tc`：里面只有一个制表符，逗号在引号里不算。
        assert_eq!(Delimiter::sniff("\"a,b\"\tc\n"), Delimiter::Tab);
        assert_eq!(Delimiter::sniff("a,b\tc\n"), Delimiter::Comma);
        // 两者都没有时按逗号处理。
        assert_eq!(Delimiter::sniff("单列\n"), Delimiter::Comma);
    }
}
