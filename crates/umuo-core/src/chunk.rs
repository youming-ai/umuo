//! 长文本切分（PRD §6.3：超过模型上下文 70% 时按段落切分并发请求，结果按顺序合并）。
//!
//! 切分的难点不在「切开」，而在**切在哪**：切在句子中间会让模型丢掉上下文、
//! 译出半句；切在段落边界最理想，段落太长退到句子，句子还太长才硬切。

/// PRD §6.3 写死的上下文占用比例。留 30% 余量给译文与系统提示——译文本身也占 token。
pub const CONTEXT_USAGE_RATIO: f64 = 0.7;

/// 中日韩文字的「字符 → token」经验值。粗略但方向正确：汉字普遍是 1 字 ≈ 1 token，
/// 拉丁文 ≈ 4 字符 1 token。
const CJK_CHARS_PER_TOKEN: f64 = 1.0;
const LATIN_CHARS_PER_TOKEN: f64 = 4.0;

/// 一段待翻译的文本分片。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextChunk {
    /// 从 0 开始，用于并发返回后按序合并。
    pub index: usize,
    pub text: String,
}

/// 按上下文窗口算出「一次请求最多塞多少字符」。
///
/// `cjk_ratio` 是文本里中日韩字符的占比，用来在 1 与 4 字符/token 之间插值——
/// 同样 1000 token 的预算，中文能放约 1000 字，英文能放约 4000 字符。
pub fn char_budget(context_tokens: usize, cjk_ratio: f64) -> usize {
    let per_token = LATIN_CHARS_PER_TOKEN
        + (CJK_CHARS_PER_TOKEN - LATIN_CHARS_PER_TOKEN) * cjk_ratio.clamp(0.0, 1.0);
    // 至少留 200 字符的窗口，避免上下文极小的模型算出 0 导致死循环。
    ((context_tokens as f64 * CONTEXT_USAGE_RATIO * per_token) as usize).max(200)
}

/// 估一下文本里中日韩字符的占比。
pub fn cjk_ratio(text: &str) -> f64 {
    let mut cjk = 0usize;
    let mut total = 0usize;
    for ch in text.chars() {
        if ch.is_whitespace() {
            continue;
        }
        total += 1;
        let c = ch as u32;
        if matches!(c, 0x3040..=0x30FF | 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xAC00..=0xD7AF) {
            cjk += 1;
        }
    }
    if total == 0 {
        0.0
    } else {
        cjk as f64 / total as f64
    }
}

/// 这次请求需不需要切分（PRD §6.3：超过模型上下文 70% 时切分）。
///
/// 判定与 [`split`] 用**同一个** `char_budget`：分开算的话，判传说「不用切」
/// 而切分算出两片（或反之）这种自相矛盾迟早会出现。
pub fn needs_splitting(text: &str, context_tokens: usize) -> bool {
    text.chars().count() > char_budget(context_tokens, cjk_ratio(text))
}

/// 把文本切成不超过 `max_chars` 的分片。
///
/// 切分优先级：段落 → 行 → 句子 → 硬切。**不丢字符**：所有分片按序拼接后，
/// 去除切分处补的空白应与原文一致（见测试）。
pub fn split(text: &str, max_chars: usize) -> Vec<TextChunk> {
    let max_chars = max_chars.max(1);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut pieces: Vec<String> = Vec::new();
    for paragraph in split_keep(trimmed, "\n\n") {
        if paragraph.chars().count() <= max_chars {
            pieces.push(paragraph);
            continue;
        }
        for line in split_keep(&paragraph, "\n") {
            if line.chars().count() <= max_chars {
                pieces.push(line);
                continue;
            }
            for sentence in split_sentences(&line) {
                if sentence.chars().count() <= max_chars {
                    pieces.push(sentence);
                    continue;
                }
                // 到这一步已经没有自然边界了（比如一整段没有标点的中文），只能硬切。
                for hard in hard_split(&sentence, max_chars) {
                    pieces.push(hard);
                }
            }
        }
    }

    // 再把相邻的小碎片合并回接近 max_chars 的分片：碎片太小会让请求数暴涨。
    let merged = merge_pieces(pieces, max_chars);
    merged
        .into_iter()
        .enumerate()
        .map(|(index, text)| TextChunk { index, text })
        .collect()
}

/// 按分隔符切分，保留分隔符之后的语义边界（返回的片段已 trim）。
fn split_keep(text: &str, separator: &str) -> Vec<String> {
    text.split(separator)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 按句末标点切句。中日韩的全角标点与拉丁标点都要认。
fn split_sentences(line: &str) -> Vec<String> {
    const ENDERS: [char; 10] = ['.', '!', '?', '。', '！', '？', '；', ';', '…', '\n'];
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in line.chars() {
        current.push(ch);
        if ENDERS.contains(&ch) {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
            current.clear();
        }
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        out.push(trimmed.to_string());
    }
    out
}

/// 无自然边界时的硬切：按字符数切，不按字节切（否则会把汉字劈成两半）。
fn hard_split(text: &str, max_chars: usize) -> Vec<String> {
    text.chars()
        .collect::<Vec<char>>()
        .chunks(max_chars)
        .map(|c| c.iter().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 给按序输出的分片补上分隔符。
///
/// `first_index` 是本批第一片在**全文**中的序号（不是批内序号）。
/// 第一片前面不能有换行，其余每片前补一个——否则上一片的末句与下一片的
/// 开头会粘成一句话，而首片会多出一个空行。
///
/// 单独抽出来是因为这里踩过一次：当时用「已推进的游标」判断换行，
/// 结果同一批里的第一片也被加了前导换行（见测试）。
pub fn with_separators(first_index: usize, pieces: Vec<String>) -> Vec<String> {
    pieces
        .into_iter()
        .enumerate()
        .map(|(offset, piece)| {
            if first_index + offset == 0 {
                piece
            } else {
                format!("\n{piece}")
            }
        })
        .collect()
}

/// 并发出结果后，按顺序取出**已经可以输出**的那些分片。
///
/// 分片是并发请求的，完成顺序不确定（第 3 片可能比第 1 片先回来）。
/// 但用户看到的译文必须按原文顺序——所以未完成的分片先存进 `pending`，
/// 只有「从 cursor 开始连续就绪」的那一段才能吐出去。
///
/// 返回本次可以按序输出的文本（可能为空）。
pub fn drain_in_order(pending: &mut [Option<String>], cursor: &mut usize) -> Vec<String> {
    let mut ready = Vec::new();
    while *cursor < pending.len() {
        match pending[*cursor].take() {
            Some(text) => {
                ready.push(text);
                *cursor += 1;
            }
            // 前面还有没回来的，后面的即使早就绪也不能先吐——
            // 否则用户会看到译文顺序错乱。
            None => break,
        }
    }
    ready
}

/// 把相邻碎片合并到不超过 max_chars，减少请求数。
fn merge_pieces(pieces: Vec<String>, max_chars: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for piece in pieces {
        match out.last_mut() {
            Some(last) => {
                let joined_len = last.chars().count() + 1 + piece.chars().count();
                if joined_len <= max_chars {
                    last.push('\n');
                    last.push_str(&piece);
                } else {
                    out.push(piece);
                }
            }
            None => out.push(piece),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_text(chunks: &[TextChunk]) -> String {
        chunks
            .iter()
            .map(|c| c.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn a_short_text_never_needs_splitting() {
        assert!(!needs_splitting("一句话。", 128_000));
        assert!(!needs_splitting("", 8_192));
    }

    #[test]
    fn a_long_text_needs_splitting_against_a_small_context() {
        let long = "word ".repeat(5_000); // 约 25k 字符
        assert!(needs_splitting(&long, 8_192));
        // 同一个文本对 1M 上下文的模型就不用切。
        assert!(!needs_splitting(&long, 1_000_000));
    }

    #[test]
    fn the_splitting_decision_matches_what_split_actually_produces() {
        // 判传说「要切」就必须真的切出不止一片；反之亦然。两者用同一个预算，
        // 不该出现自相矛盾。
        let text = "段落一。\n\n".repeat(400);
        let context = 8_192;
        let budget = char_budget(context, cjk_ratio(&text));
        assert_eq!(
            needs_splitting(&text, context),
            split(&text, budget).len() > 1
        );
    }

    #[test]
    fn out_of_order_completions_are_held_back_until_their_turn() {
        // 第 3 片先回来：不能吐，否则译文顺序错乱。
        let mut pending = vec![None, None, Some("第三片".to_string())];
        let mut cursor = 0;
        assert!(drain_in_order(&mut pending, &mut cursor).is_empty());
        assert_eq!(cursor, 0);

        // 第 1 片回来 → 只有它能吐。
        pending[0] = Some("第一片".to_string());
        assert_eq!(drain_in_order(&mut pending, &mut cursor), vec!["第一片"]);
        assert_eq!(cursor, 1);

        // 第 2 片回来 → 它和第 3 片一起连续吐出。
        pending[1] = Some("第二片".to_string());
        assert_eq!(
            drain_in_order(&mut pending, &mut cursor),
            vec!["第二片", "第三片"]
        );
        assert_eq!(cursor, 3);
    }

    #[test]
    fn a_fully_ordered_arrival_flushes_one_at_a_time() {
        let mut pending = vec![None, None];
        let mut cursor = 0;
        pending[0] = Some("a".into());
        assert_eq!(drain_in_order(&mut pending, &mut cursor), vec!["a"]);
        pending[1] = Some("b".into());
        assert_eq!(drain_in_order(&mut pending, &mut cursor), vec!["b"]);
    }

    #[test]
    fn an_empty_slot_never_yields_text_twice() {
        // take() 取走后该槽位为空，重复调用不该重复输出。
        let mut pending = vec![Some("only".to_string())];
        let mut cursor = 0;
        assert_eq!(drain_in_order(&mut pending, &mut cursor), vec!["only"]);
        assert!(drain_in_order(&mut pending, &mut cursor).is_empty());
    }

    #[test]
    fn the_first_chunk_never_gets_a_leading_newline() {
        // 这里踩过：用推进后的游标判断换行，同一批的第一片也被加了前导换行，
        // 译文开头于是多出一个空行。
        assert_eq!(with_separators(0, vec!["a".into()]), vec!["a"]);
        assert_eq!(
            with_separators(0, vec!["a".into(), "b".into()]),
            vec!["a", "\nb"],
            "第二批（首片之后）应当各自带前导换行"
        );
    }

    #[test]
    fn separators_use_the_global_index_not_the_batch_index() {
        // 一次回来两片、且它们不是开头两片时，两片都要带换行。
        assert_eq!(
            with_separators(2, vec!["c".into(), "d".into()]),
            vec!["\nc", "\nd"]
        );
    }

    #[test]
    fn budget_reflects_script_mix() {
        // 同样 1000 token：中文能放的字数远少于英文能放的字符数。
        let chinese_budget = char_budget(1000, 1.0);
        let latin_budget = char_budget(1000, 0.0);
        assert!(
            chinese_budget < latin_budget,
            "中文 {chinese_budget} 应少于英文 {latin_budget}"
        );
        assert_eq!(chinese_budget, 700);
        assert_eq!(latin_budget, 2800);
    }

    #[test]
    fn tiny_context_never_yields_a_zero_budget() {
        // 预算为 0 会让切分进入死循环或产出无穷空片。
        assert!(char_budget(1, 1.0) >= 200);
    }

    #[test]
    fn short_text_is_a_single_chunk() {
        let chunks = split("Hello world.", 100);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].index, 0);
        assert_eq!(chunks[0].text, "Hello world.");
    }

    #[test]
    fn empty_input_produces_no_chunks() {
        assert!(split("", 100).is_empty());
        assert!(split("   \n\n  ", 100).is_empty());
    }

    #[test]
    fn no_chunk_exceeds_the_budget() {
        let paragraph = "这是一个很长的段落。".repeat(200);
        let chunks = split(&paragraph, 120);
        assert!(chunks.len() > 1);
        for chunk in &chunks {
            assert!(
                chunk.text.chars().count() <= 120,
                "分片超预算：{} 字符",
                chunk.text.chars().count()
            );
        }
    }

    #[test]
    fn splitting_prefers_natural_boundaries_over_hard_cuts() {
        // 三段各 6 字，预算 13：正好能放下两段（6+1+6），第三段另起一片。
        // 关键是**切点落在段落边界上**，而不是切在某句话中间。
        let text = "第一段内容。\n\n第二段内容。\n\n第三段内容。";
        let chunks = split(text, 13);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].text, "第一段内容。\n第二段内容。");
        assert_eq!(chunks[1].text, "第三段内容。");
    }

    #[test]
    fn adjacent_small_pieces_are_merged_to_keep_the_request_count_down() {
        // 每段都远小于预算时不该一段一个请求——那会把 10 次 API 调用变成 100 次。
        let text = "第一段内容。\n\n第二段内容。\n\n第三段内容。";
        assert_eq!(split(text, 100).len(), 1);
    }

    #[test]
    fn chinese_text_without_spaces_is_hard_split_without_losing_characters() {
        let text = "无标点的一长串中文".repeat(50);
        let chunks = split(&text, 60);
        assert!(chunks.len() > 1);
        // 硬切按字符切，不许把汉字劈坏：拼回去必须还原。
        let joined: String = chunks.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(joined, text);
    }

    #[test]
    fn chunks_are_indexed_in_order_so_parallel_results_can_be_merged() {
        let text = "A。\n\nB。\n\nC。";
        let chunks = split(text, 5);
        let indices: Vec<usize> = chunks.iter().map(|c| c.index).collect();
        assert_eq!(indices, (0..chunks.len()).collect::<Vec<_>>());
    }

    #[test]
    fn no_content_is_lost_for_a_mixed_document() {
        // 这是切分最重要的性质：宁可分片难看，也不能吞掉内容。
        let text = "First paragraph.\n\n第二段，含标点。\nShort line\n\n\n最后一段结束。";
        let chunks = split(text, 16);
        let joined = all_text(&chunks);
        for needle in ["First paragraph.", "第二段", "Short line", "最后一段结束。"] {
            assert!(joined.contains(needle), "分片后丢失了：{needle}");
        }
    }

    #[test]
    fn cjk_ratio_is_measured_not_guessed() {
        assert!(cjk_ratio("这是一段中文") > 0.9);
        assert!(cjk_ratio("this is english") < 0.1);
        assert!((cjk_ratio("") - 0.0).abs() < f64::EPSILON);
        // 6 个汉字 + 14 个拉丁字符 → 约 0.3
        let mixed = cjk_ratio("这是中文内容 and English text");
        assert!(mixed > 0.2 && mixed < 0.8, "混排应在中间，实际 {mixed}");
    }
}
