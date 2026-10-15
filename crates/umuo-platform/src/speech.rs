//! 发音朗读（PRD §5.1「发音朗读、音标与拼音」）。
//!
//! V1 用系统自带的语音合成，不接云端 TTS：朗读是高频、短时的动作，
//! 每按一次就上传一句文本既慢又贵，而系统语音离线可用、零延迟。
//! 「AI 人声」（更自然的嗓音）是 PRD §5.11 的 P1 项，属于另一条路。

use crate::error::PlatformError;

pub trait Speech: Send + Sync {
    /// 朗读一段文本。`language` 是 BCP-47 短码，用来挑选发音人。
    ///
    /// 实现约定：**先停掉上一段再开始新的**。用户连点两次朗读时，
    /// 两段声音叠在一起比「后一次没生效」更让人烦躁。
    fn speak(&self, text: &str, language: Option<&str>) -> Result<(), PlatformError>;

    /// 停掉当前朗读。没有在朗读时也算成功——「停」这个动作本来就该是幂等的。
    fn stop(&self) -> Result<(), PlatformError>;
}

/// 系统里可用的一个发音人。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Voice {
    pub name: String,
    /// 形如 `zh_CN`、`ja_JP`。
    pub language: String,
}

/// 解析 `say -v '?'` 的输出。
///
/// 真实格式（`#` 之后是该发音人的示例文本）：
///
/// ```text
/// Eddy (Japanese (Japan)) ja_JP    # こんにちは! 私の名前はEddyです。
/// Tingting (Chinese (China mainland)) zh_CN    # 你好！我叫Tingting。
/// ```
///
/// 解析它的理由是**不能猜**：不同机器装的发音人差别很大（本机实测 8 个常见名字里
/// 有 3 个没装），猜错的结果是「按了朗读没反应」，而用户完全不知道原因。
pub fn parse_voices(output: &str) -> Vec<Voice> {
    let mut voices = Vec::new();
    for line in output.lines() {
        // 先砍掉示例文本：它里面也可能出现形如 `xx_YY` 的片段。
        let head = line.split('#').next().unwrap_or(line);
        let Some(paren) = head.find(" (") else {
            continue;
        };
        let name = head[..paren].trim();
        if name.is_empty() {
            continue;
        }
        let Some(language) = head
            .split_whitespace()
            .find(|token| is_language_code(token))
        else {
            continue;
        };
        voices.push(Voice {
            name: name.to_string(),
            language: language.to_string(),
        });
    }
    voices
}

fn is_language_code(token: &str) -> bool {
    let Some((language, region)) = token.split_once('_') else {
        return false;
    };
    (2..=3).contains(&language.len())
        && language.chars().all(|c| c.is_ascii_lowercase())
        && region.len() == 2
        && region.chars().all(|c| c.is_ascii_uppercase())
}

/// macOS 自带的「趣味」发音人。
///
/// 它们**在每个语言下都出现一遍**，而且 `say -v '?'` 是按字母序排列的——
/// 所以「取第一个匹配」的写法会让中文挑到 `Eddy`（本机实测就是这样），
/// 而自然发音人（Kyoko、Daniel 之类）排在后面。这个名单把它们排到最后。
const NOVELTY_VOICES: &[&str] = &[
    "Albert",
    "Bad News",
    "Bahh",
    "Bells",
    "Boing",
    "Bubbles",
    "Cellos",
    "Deranged",
    "Eddy",
    "Flo",
    "Fred",
    "Good News",
    "Grandma",
    "Grandpa",
    "Hysterical",
    "Jester",
    "Junior",
    "Kathy",
    "Organ",
    "Princess",
    "Ralph",
    "Reed",
    "Rocko",
    "Sandy",
    "Shelley",
    "Superstar",
    "Trinoids",
    "Whisper",
    "Wobble",
    "Zarvox",
];

fn is_novelty(name: &str) -> bool {
    NOVELTY_VOICES
        .iter()
        .any(|novelty| novelty.eq_ignore_ascii_case(name))
}

/// 从可用发音人里按语言挑一个。
///
/// 先要精确到地区（`zh-TW` 应该挑 `zh_TW`，而不是 `zh_CN`——繁体用户听到普通话很别扭），
/// 退而求其次才按主语言子标签匹配。挑不到返回 `None`，交给系统默认发音人。
pub fn pick_voice<'a>(voices: &'a [Voice], language: &str) -> Option<&'a str> {
    let normalized = language.trim().replace('-', "_");
    // 只要主语言子标签；地区留给后面的精确匹配。
    let primary = normalized
        .split_once('_')
        .map_or(normalized.as_str(), |(language, _)| language);

    // 优先级从「最合适」到「能用就行」，逐层下探：
    //
    //   1. 地区精确 + 自然音   （zh-TW 文本 → zh_TW 的 Meijia）
    //   2. 同语言 + 自然音     （zh-CN 文本 → zh_TW 的 Meijia）
    //   3. 地区精确 + 趣味音
    //   4. 同语言 + 趣味音     （只有趣味音可用时的兜底）
    //
    // 第 2 层排在第 3 层之前是刻意的：本机实测 zh_CN 下**只有**趣味音，
    // 而 zh_TW 有一个自然发音人 Meijia。让 Meijia 念简体，比让 Eddy 念要好得多——
    // 地区口音的差异远小于机械音的差异。
    let region_match = |voice: &&Voice| voice.language.eq_ignore_ascii_case(&normalized);
    let language_match = |voice: &&Voice| {
        voice
            .language
            .split('_')
            .next()
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(primary))
    };

    let exact: Vec<&Voice> = if normalized.contains('_') {
        voices.iter().filter(region_match).collect()
    } else {
        Vec::new()
    };
    let same_language: Vec<&Voice> = voices.iter().filter(language_match).collect();

    // 用局部 fn 而不是闭包：闭包没法对参数做生命周期泛型，
    // 写出来会变成「返回值的生命周期不知道跟谁绑」。
    fn natural<'p>(pool: &[&'p Voice]) -> Option<&'p str> {
        pool.iter()
            .find(|voice| !is_novelty(&voice.name))
            .map(|voice| voice.name.as_str())
    }

    natural(&exact)
        .or_else(|| natural(&same_language))
        .or_else(|| exact.first().map(|voice| voice.name.as_str()))
        .or_else(|| same_language.first().map(|voice| voice.name.as_str()))
}

/// 把文本收拾成适合朗读的样子。
///
/// 模型给的译文常常带 Markdown 标记与多余空白；直接念出来会是
/// 「星号星号粗体星号星号」。朗读前把这些符号去掉，而不是让用户听标点。
pub fn to_speech_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let trimmed = line.trim();
        // 代码块围栏与纯符号行（分隔线等）不念。
        if trimmed.starts_with("```") || trimmed.chars().all(|c| !c.is_alphanumeric()) {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(trimmed);
    }
    // 标记替换成空格会留下连续空白（`**粗体**` → 两侧各一个空格）。
    // 朗读不在意空白，但连续空白会让输出难以断言，也让「读起来该是什么」变得不确定。
    let flattened = out.replace(['*', '`', '#', '_'], " ");
    flattened.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 本机 `say -v '?'` 的真实片段。
    const VOICE_LIST: &str =
        "\nEddy (Japanese (Japan)) ja_JP    # こんにちは! 私の名前はEddyです。\n\
Tingting (Chinese (China mainland)) zh_CN    # 你好！我叫Tingting。\n\
Meijia (Chinese (Taiwan)) zh_TW    # 你好，我叫Meijia。\n\
Yuna (Korean (South Korea)) ko_KR    # 안녕하세요!\n\
Daniel (English (UK)) en_GB    # Hello!\n";

    #[test]
    fn the_voice_list_is_parsed_from_the_real_output_format() {
        let voices = parse_voices(VOICE_LIST);
        assert_eq!(voices.len(), 5, "实际解析出：{voices:?}");
        assert_eq!(voices[0].name, "Eddy");
        assert_eq!(voices[0].language, "ja_JP");
        assert_eq!(voices[1].name, "Tingting");
    }

    #[test]
    fn the_example_text_after_a_hash_never_becomes_a_language() {
        // `#` 之后的示例文本里可能藏着形如 xx_YY 的片段，不能当成语言码。
        let voices = parse_voices("Some Voice (Xx (Yy)) xx_YY    # 参考 en_US 的念法");
        assert_eq!(voices[0].language, "xx_YY");
    }

    #[test]
    fn novelty_voices_are_avoided_when_a_natural_one_exists() {
        // 趣味音在每个语言下都有一份，且按字母序排在自然发音人前面。
        // 不排掉的话中文会挑到 Eddy（本机实测）。
        let voices = parse_voices(
            "Eddy (Chinese (China mainland)) zh_CN    # 你好\n\
Tingting (Chinese (China mainland)) zh_CN    # 你好\n",
        );
        assert_eq!(pick_voice(&voices, "zh-CN"), Some("Tingting"));
    }

    #[test]
    fn a_natural_voice_of_a_sibling_region_beats_a_novelty_voice_of_the_exact_region() {
        // 本机实测：zh_CN 只有趣味音，zh_TW 有自然音 Meijia。
        // 让 Meijia 念简体，好过让 Eddy 念——口音差异远小于机械音差异。
        let voices = parse_voices(
            "Eddy (Chinese (China mainland)) zh_CN    # 你好\n\
Meijia (Chinese (Taiwan)) zh_TW    # 你好\n",
        );
        assert_eq!(pick_voice(&voices, "zh-CN"), Some("Meijia"));
        assert_eq!(pick_voice(&voices, "zh-TW"), Some("Meijia"));
    }

    #[test]
    fn a_novelty_voice_is_used_when_it_is_the_only_option() {
        // 本机的中文就只有趣味音可用。用它总好过让系统默认发音人用英语腔念中文。
        let voices = parse_voices("Eddy (Chinese (China mainland)) zh_CN    # 你好\n");
        assert_eq!(pick_voice(&voices, "zh-CN"), Some("Eddy"));
    }

    #[test]
    fn a_region_specific_request_prefers_the_exact_region() {
        // 繁体用户不该被念普通话。
        let voices = parse_voices(VOICE_LIST);
        assert_eq!(pick_voice(&voices, "zh-TW"), Some("Meijia"));
        assert_eq!(pick_voice(&voices, "zh-CN"), Some("Tingting"));
    }

    #[test]
    fn a_language_without_region_falls_back_to_any_voice_of_that_language() {
        let voices = parse_voices(VOICE_LIST);
        assert_eq!(pick_voice(&voices, "ja"), Some("Eddy"));
        assert_eq!(pick_voice(&voices, "en"), Some("Daniel"));
    }

    #[test]
    fn a_language_with_no_installed_voice_returns_none_so_the_system_picks() {
        // 本机实测 8 个常见发音人名字里有 3 个没装——猜名字的写法会让朗读直接失败。
        let voices = parse_voices(VOICE_LIST);
        assert_eq!(pick_voice(&voices, "th"), None);
        assert_eq!(pick_voice(&voices, ""), None);
        assert_eq!(pick_voice(&[], "zh-CN"), None);
    }

    #[test]
    fn garbage_input_yields_no_voices_instead_of_panicking() {
        assert!(parse_voices("").is_empty());
        assert!(parse_voices("这不是 say 的输出").is_empty());
    }

    #[test]
    fn markdown_markers_are_removed_before_speaking() {
        // 否则用户听到的是「星号星号粗体星号星号」。
        assert_eq!(to_speech_text("**你好**世界"), "你好 世界".trim());
        assert_eq!(to_speech_text("# 标题"), "标题");
        assert_eq!(to_speech_text("`code` 与 正文"), "code 与 正文".trim());
    }

    #[test]
    fn code_fences_and_symbol_only_lines_are_skipped() {
        let text = "第一段\n\n```rust\nlet x = 1;\n```\n第二段";
        let spoken = to_speech_text(text);
        assert!(!spoken.contains("```"), "代码围栏不该被念出来：{spoken}");
        assert!(spoken.contains("第一段") && spoken.contains("第二段"));
    }

    #[test]
    fn lines_are_joined_into_one_flow_instead_of_pausing_at_every_newline() {
        // 逐行朗读会在每个换行处停顿，长段落听起来一顿一顿的。
        assert_eq!(to_speech_text("第一句\n第二句"), "第一句 第二句");
    }

    #[test]
    fn empty_or_symbol_only_input_yields_an_empty_string() {
        // 空串交给朗读层时应当被调用方拦下，而不是念出一段静默。
        assert_eq!(to_speech_text(""), "");
        assert_eq!(to_speech_text("---\n***"), "");
    }
}
