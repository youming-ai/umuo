//! 语言判断与「源语言 = 目标语言」时的目标切换（PRD §5.2）。
//!
//! 这里刻意**不做**统计式的语言识别：客户端只判断「这段文字属于哪个书写系统」，
//! 够用于两个真实决策——
//!
//! 1. 源语言与目标语言撞车时，自动改用第二目标语言（中文用户划了一段中文，
//!    该出英文而不是把中文「翻译」成中文）。
//! 2. 给 Prompt 填 `{source_lang}`，让模型知道自己在处理什么。
//!
//! 拉丁字母是例外：一个书写系统对应多种语言，所以再用变音字母与高频虚词粗分
//! 几种常见欧洲语言，见 [`latin_language`]。
//!
//! 判不出具体语言时返回 `None`，让调用方把源语言交给模型自己判断——
//! 猜错语言比不猜更糟。

/// 按书写系统嗅探语言。返回 BCP-47 短码。
///
/// 只覆盖产品明确承诺的语言（PRD §8「翻译语言 ≥ 30 种」由模型侧兜底，
/// 这里只需要识别出「该翻成什么」）。
///
/// 拉丁字母是例外：一个书写系统对应多种语言，只看字母判不出法文还是英文。
/// 这里用变音字母与高频虚词粗分几种常见欧洲语言（[`latin_language`]），
/// 没有任何线索时仍按英文处理（审查 M8）。
pub fn detect(text: &str) -> Option<&'static str> {
    let mut han = 0usize;
    let mut kana = 0usize;
    let mut hangul = 0usize;
    let mut cyrillic = 0usize;
    let mut arabic = 0usize;
    let mut greek = 0usize;
    let mut hebrew = 0usize;
    let mut thai = 0usize;
    let mut devanagari = 0usize;
    let mut latin = 0usize;
    // 其它字母（格鲁吉亚文、亚美尼亚文……）：认得出是文字，但不知道是哪种语言。
    let mut other = 0usize;
    let mut meaningful = 0usize;

    for ch in text.chars() {
        if ch.is_whitespace() || ch.is_ascii_punctuation() {
            continue;
        }
        meaningful += 1;
        let c = ch as u32;
        match c {
            // 平假名 + 片假名
            0x3040..=0x30FF => kana += 1,
            // 谚文音节 + 字母
            0xAC00..=0xD7AF | 0x1100..=0x11FF => hangul += 1,
            // CJK 统一表意文字（含扩展 A）
            0x4E00..=0x9FFF | 0x3400..=0x4DBF => han += 1,
            0x0400..=0x04FF => cyrillic += 1,
            0x0600..=0x06FF => arabic += 1,
            0x0370..=0x03FF => greek += 1,
            0x0590..=0x05FF => hebrew += 1,
            0x0E00..=0x0E7F => thai += 1,
            0x0900..=0x097F => devanagari += 1,
            // ASCII 字母、拉丁补充与扩展（含越南文用的 1E00 区）。
            _ if ch.is_ascii_alphabetic() => latin += 1,
            0x00C0..=0x024F | 0x1E00..=0x1EFF if ch.is_alphabetic() => latin += 1,
            _ if ch.is_alphabetic() => other += 1,
            _ => {}
        }
    }

    if meaningful == 0 {
        return None;
    }

    // 顺序即优先级，其中「假名 > 汉字」是关键：日文里混着大量汉字，
    // 只要出现假名就必须判成日文，否则一段日文会被翻成中文。
    if kana > 0 {
        return Some("ja");
    }
    if hangul > 0 {
        return Some("ko");
    }
    if han > 0 {
        return Some("zh");
    }
    // 西里尔与阿拉伯文沿用「出现即判」（审查前的行为）。后加的几种文字要求占多数：
    // 希腊字母常作数学符号混在英文里（「The α value is 0.5」「Δt」），出现一个就判成
    // 希腊文会让英文目标的用户拿到英译英、TTS 换成希腊语音。
    if cyrillic > 0 {
        return Some("ru");
    }
    if arabic > 0 {
        return Some("ar");
    }
    let scripts = [
        (greek, "el"),
        (hebrew, "he"),
        (thai, "th"),
        (devanagari, "hi"),
    ];
    if let Some((_, code)) = scripts
        .iter()
        .filter(|(count, _)| *count > latin)
        .max_by_key(|(count, _)| *count)
    {
        return Some(code);
    }
    // 拉丁字母为主时才去细分；混着认不出的文字时，猜一个只会把 {source_lang} 填错。
    let minority_script = greek + hebrew + thai + devanagari;
    if latin > 0 && latin >= other + minority_script {
        return Some(latin_language(text));
    }
    None
}

/// 只出现在某一种常见欧洲语言里的字母（变音字母）。
///
/// 法文只收 ç œ ù：è ê â û î ï 在英文借词里太常见（crème brûlée、naïve），
/// è 还是意大利文的「是」。
const LATIN_MARKERS: &[(&str, &str)] = &[
    ("de", "ßäöü"),
    ("fr", "çœù"),
    ("es", "ñ¿¡"),
    ("pt", "ãõ"),
    ("it", "ìò"),
    ("tr", "ışğ"),
    ("pl", "ąęłńśźż"),
    ("vi", "ăơưđ"),
];

/// 各语言的高频虚词。只收几乎不会出现在别的语言里的词——
/// `que`（法/西/葡）、`con` `del`（西/意）、`do`（英/葡）、`i`（英/意）这类有歧义的一律不收。
const LATIN_STOPWORDS: &[(&str, &[&str])] = &[
    (
        "en",
        &[
            "the", "and", "is", "are", "of", "to", "this", "that", "with", "you", "it", "was",
            "for", "not", "have",
        ],
    ),
    (
        "fr",
        &[
            "le", "les", "des", "est", "et", "une", "du", "pas", "je", "vous", "nous", "avec",
            "pour", "dans", "ce", "qui", "suis", "sont",
        ],
    ),
    (
        "de",
        &[
            "der", "die", "das", "und", "ist", "nicht", "ein", "eine", "ich", "zu", "mit", "sie",
            "auf", "dem", "wir", "sind",
        ],
    ),
    (
        "es",
        &[
            "el", "los", "las", "y", "una", "como", "pero", "muy", "está", "esto", "estoy",
        ],
    ),
    (
        "it",
        &[
            "gli", "che", "di", "non", "per", "sono", "della", "ma", "è", "un", "anche", "questo",
        ],
    ),
    (
        "pt",
        &[
            "os", "não", "uma", "com", "é", "em", "mas", "você", "são", "isso", "muito", "eu",
        ],
    ),
];

/// 拉丁字母文本属于哪种语言。英文是强默认值（审查 M8 复审）。
///
/// 每个含变音字母的词、每个虚词各算一条线索。别的语言要胜出，
/// 线索至少 2 条，并且比英文虚词至少多 2 条——借词、专名、缩写只能提供一条线索
/// （São Paulo、José、Müller、per month），不该把一句英文改判成别的语言。
/// 全大写的词（EU、EST、OS、DES）多是缩写，不算其它语言的虚词。
///
/// 没有任何线索（只有一个词，或只有通用的 é/á 之类）时按英文处理——
/// 返回 `None` 会让上层把母语当源语言，中文母语的用户划一句带 café 的英文，
/// 就会被「撞车换第二目标语言」改成英译英，比把法文当英文更糟。
fn latin_language(text: &str) -> &'static str {
    const MIN_SIGNALS: usize = 2;
    const MARGIN_OVER_ENGLISH: usize = 2;

    let words: Vec<&str> = text
        .split(|ch: char| !ch.is_alphabetic())
        .filter(|w| !w.is_empty())
        .collect();
    let lower: Vec<String> = words.iter().map(|w| w.to_lowercase()).collect();
    let is_acronym = |w: &str| w.chars().count() >= 2 && !w.chars().any(char::is_lowercase);
    let stopword_hits = |list: &[&str], skip_acronyms: bool| {
        words
            .iter()
            .zip(&lower)
            .filter(|(orig, low)| {
                !(skip_acronyms && is_acronym(orig)) && list.contains(&low.as_str())
            })
            .count()
    };
    let list_for = |code: &str| {
        LATIN_STOPWORDS
            .iter()
            .find(|(c, _)| *c == code)
            .map(|(_, list)| *list)
            .unwrap_or(&[])
    };

    let english = stopword_hits(list_for("en"), false);
    // ¿ ¡ 不是字母，不在分词结果里，单独数。
    let lower_text = text.to_lowercase();

    let mut best: Option<(&'static str, usize)> = None;
    let candidates = LATIN_STOPWORDS
        .iter()
        .map(|(code, _)| *code)
        .chain(LATIN_MARKERS.iter().map(|(code, _)| *code))
        .filter(|code| *code != "en");
    let mut seen: Vec<&str> = Vec::new();
    for code in candidates {
        if seen.contains(&code) {
            continue;
        }
        seen.push(code);
        let markers = LATIN_MARKERS
            .iter()
            .find(|(c, _)| *c == code)
            .map(|(_, m)| {
                let letters: Vec<char> = m.chars().filter(|c| c.is_alphabetic()).collect();
                let punctuation = m
                    .chars()
                    .filter(|c| !c.is_alphabetic())
                    .map(|p| lower_text.matches(p).count())
                    .sum::<usize>();
                lower
                    .iter()
                    .filter(|w| w.chars().any(|c| letters.contains(&c)))
                    .count()
                    + punctuation
            })
            .unwrap_or(0);
        let score = markers + stopword_hits(list_for(code), true);
        // 严格大于：平分时保留先出现的。
        if score > best.map_or(0, |(_, s)| s) {
            best = Some((code, score));
        }
    }
    match best {
        Some((code, score)) if score >= MIN_SIGNALS && score >= english + MARGIN_OVER_ENGLISH => {
            code
        }
        _ => "en",
    }
}

/// 两个语言码是否指向同一种语言。`zh-CN` 与 `zh` 视为同一语言。
///
/// 只比主语言子标签是刻意的：`zh-CN` 与 `zh-TW` 在「要不要改翻另一种语言」
/// 这个问题上应该被当作同一种语言处理，否则中文用户会看到简繁互翻。
pub fn same_language(a: &str, b: &str) -> bool {
    primary(a).eq_ignore_ascii_case(primary(b))
}

fn primary(code: &str) -> &str {
    code.split(['-', '_']).next().unwrap_or(code)
}

/// 按 PRD §5.2 的规则挑目标语言：
/// 源语言与第一目标语言相同就改用第二目标语言；第二目标语言缺失或也撞车时，
/// 保留第一目标语言（宁可翻成同语言，也不要在没有依据时乱换）。
/// 这次该翻成哪种语言（PRD §5.4 的目标语言规则）。
///
/// 优先级：
/// 1. **显式指定**（撰写窗/浮窗上手动选的语言）；
/// 2. **按 App 记忆**（仅当用户开了这个模式，并且这个 App 记过一种语言）——
///    这时**不做**「源语言撞车就换第二目标语言」的调整：用户为这个 App
///    明确选过语言，再自作聪明地改掉它，比"翻译成同语言"更让人意外；
/// 3. 常规规则（`pick_target`）。
///
/// `explicit` 与 `remembered` 都是语言码或名称；本函数不校验它们是否合法——
/// 来源要么是用户输入过的设置值，要么是我们自己写进去的。
/// 决定"这次的源语言是什么"：检测得出来就用检测结果；
/// 检测不出来（比如只有两三个字、或一堆 emoji）时，用**母语**作为假设。
///
/// 为什么母语有真实的逻辑作用：目标语言的"撞车就换第二语言"规则需要知道源语言。
/// 中文母语的用户划了一个孤立词，检测不出——没有母语假设时只能按第一目标语言翻
/// （往往就是中文，于是"中翻中"）；有了"我的母语是中文"这个假设，
/// 规则就能正确地换用第二目标语言（英文）。
pub fn assume_source(detected: Option<&str>, native_lang: &str) -> Option<String> {
    if detected.is_some() {
        return detected.map(str::to_string);
    }
    let native = native_lang.trim();
    if native.is_empty() {
        return None;
    }
    Some(native.to_string())
}

pub fn resolve_target(
    explicit: Option<&str>,
    remembered: Option<&str>,
    source: Option<&str>,
    primary_target: &str,
    secondary_target: Option<&str>,
) -> String {
    if let Some(value) = explicit.map(str::trim).filter(|v| !v.is_empty()) {
        return value.to_string();
    }
    if let Some(value) = remembered.map(str::trim).filter(|v| !v.is_empty()) {
        return value.to_string();
    }
    pick_target(source, primary_target, secondary_target)
}

pub fn pick_target(
    source: Option<&str>,
    primary_target: &str,
    secondary_target: Option<&str>,
) -> String {
    let Some(source) = source else {
        return primary_target.to_string();
    };

    if !same_language(source, primary_target) {
        return primary_target.to_string();
    }

    match secondary_target {
        Some(secondary) if !same_language(source, secondary) => secondary.to_string(),
        _ => primary_target.to_string(),
    }
}

/// 语言的展示名，用于写进 Prompt。
///
/// 与 [`detect`] 的返回码不同：那个是给程序判断用的短码，这个是给模型读的名字。
/// 未知语言回落到短码本身——把 `xx-YY` 直接写进 Prompt 虽然不好看，
/// 但总比编一个错误的名字强（模型至少能从码里看出大意）。
pub fn display_name(code: &str) -> String {
    let name = match primary(code).to_ascii_lowercase().as_str() {
        "zh" => "中文",
        "en" => "English",
        "ja" => "日本語",
        "ko" => "한국어",
        "fr" => "Français",
        "de" => "Deutsch",
        "es" => "Español",
        "ru" => "Русский",
        "pt" => "Português",
        "it" => "Italiano",
        "ar" => "العربية",
        "th" => "ไทย",
        "vi" => "Tiếng Việt",
        "id" => "Bahasa Indonesia",
        "tr" => "Türkçe",
        "hi" => "हिन्दी",
        "el" => "Ελληνικά",
        "he" => "עברית",
        "pl" => "Polski",
        _ => return code.to_string(),
    };
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn japanese_wins_over_han_because_kana_is_the_giveaway() {
        // 一段典型的日文：汉字很多，但只要出现假名就是日文。
        assert_eq!(detect("日本語を勉強しています"), Some("ja"));
        assert_eq!(detect("これはテスト"), Some("ja"));
    }

    #[test]
    fn chinese_without_kana_is_chinese() {
        assert_eq!(detect("这是一段中文测试"), Some("zh"));
        assert_eq!(detect("繁體中文也可以"), Some("zh"));
    }

    #[test]
    fn korean_and_cyrillic_and_latin_are_recognised() {
        assert_eq!(detect("안녕하세요"), Some("ko"));
        assert_eq!(detect("Привет мир"), Some("ru"));
        assert_eq!(detect("hello world"), Some("en"));
        assert_eq!(detect("مرحبا"), Some("ar"));
    }

    #[test]
    fn common_european_languages_are_not_all_english() {
        // 审查 M8：以前所有拉丁字母都判成 en，法文会被当成「与英文目标撞车」。
        assert_eq!(detect("Bonjour, je suis très content"), Some("fr"));
        assert_eq!(detect("Ça va, et vous ?"), Some("fr"));
        assert_eq!(detect("Der Hund ist groß"), Some("de"));
        assert_eq!(detect("¿Dónde está la estación?"), Some("es"));
        assert_eq!(detect("Questo è un libro"), Some("it"));
        assert_eq!(detect("Eu não sei"), Some("pt"));
    }

    #[test]
    fn english_with_a_loanword_stays_english() {
        // 借词与专名里的变音字母不能把英文推成「未知」：未知会退回母语假设，
        // 中文用户就会拿到英译英。
        assert_eq!(detect("I love this café"), Some("en"));
        assert_eq!(detect("café"), Some("en"));
        assert_eq!(detect("hello"), Some("en"));
    }

    #[test]
    fn loanwords_names_and_acronyms_do_not_push_english_elsewhere() {
        // 审查 M8 复审：一个借词、专名或缩写只是一条线索，不足以推翻英文。
        for text in [
            "The naïve approach",
            "Our office in São Paulo is great",
            "I met José Muñoz at the conference",
            "$5 per month",
            "EU AI Act",
            "Meeting at 3pm EST",
            "Plants die without water",
            "die",
            "The crème brûlée was great",
            "Müller's plan",
        ] {
            assert_eq!(detect(text), Some("en"), "{text}");
        }
    }

    #[test]
    fn italian_e_accent_is_not_french() {
        // è 是意大利文的「是」，不能当法文标记。
        assert_eq!(detect("Non è vero"), Some("it"));
    }

    #[test]
    fn a_stray_greek_letter_in_english_stays_english() {
        // 审查：希腊字母常作数学符号，出现一个就判成希腊文会让英文用户拿到英译英。
        assert_eq!(detect("The α value is 0.5"), Some("en"));
        assert_eq!(detect("β-blocker"), Some("en"));
        assert_eq!(detect("Δt"), Some("en"));
    }

    #[test]
    fn other_scripts_get_their_own_language_or_none() {
        assert_eq!(detect("สวัสดีครับ"), Some("th"));
        assert_eq!(detect("नमस्ते दुनिया"), Some("hi"));
        assert_eq!(detect("Καλημέρα"), Some("el"));
        assert_eq!(detect("שלום"), Some("he"));
        // 认不出的文字不再兜底成英文。
        assert_eq!(detect("გამარჯობა"), None);
    }

    #[test]
    fn undetectable_input_returns_none_instead_of_guessing() {
        // 纯数字/符号/空白没有语言信息，猜一个只会把 {source_lang} 填错。
        assert_eq!(detect("12345"), None);
        assert_eq!(detect("   \n\t"), None);
        assert_eq!(detect("—— ……"), None);
    }

    #[test]
    fn same_language_ignores_the_region_subtag() {
        assert!(same_language("zh-CN", "zh-TW"));
        assert!(same_language("zh", "zh-CN"));
        assert!(same_language("en-US", "en"));
        assert!(!same_language("zh", "ja"));
    }

    #[test]
    fn the_native_language_is_only_a_fallback_when_detection_fails() {
        // 检测得出来时，母语不参与。
        assert_eq!(assume_source(Some("en"), "zh-CN").as_deref(), Some("en"));
    }

    #[test]
    fn detection_failure_falls_back_to_the_native_language() {
        assert_eq!(assume_source(None, "zh-CN").as_deref(), Some("zh-CN"));
    }

    #[test]
    fn no_native_language_configured_means_no_assumption() {
        // 母语留空 = 用户没告诉我们，那就维持"不知道"。
        assert_eq!(assume_source(None, ""), None);
        assert_eq!(assume_source(None, "   "), None);
    }

    #[test]
    fn an_explicit_choice_always_wins() {
        // 用户在界面上亲手选的语言，压过一切推断。
        assert_eq!(
            resolve_target(Some("ja"), Some("en"), Some("ja"), "zh-CN", Some("en")),
            "ja"
        );
    }

    #[test]
    fn a_remembered_language_wins_over_the_standard_rule() {
        // 这就是「Slack 那个频道永远输出英文」：为这个 App 记过 en，
        // 即使原文是中文、常规规则会说「撞车了改用第二目标语言」。
        assert_eq!(
            resolve_target(None, Some("en"), Some("en"), "zh-CN", Some("en")),
            "en"
        );
    }

    #[test]
    fn without_memory_the_standard_rule_applies() {
        assert_eq!(
            resolve_target(None, None, Some("en"), "zh-CN", Some("en")),
            "zh-CN"
        );
        assert_eq!(
            resolve_target(None, None, Some("zh"), "zh-CN", Some("en")),
            "en",
            "源语言与第一目标语言撞车时仍然换第二个"
        );
    }

    #[test]
    fn blank_values_are_ignored_rather_than_becoming_the_target_language() {
        // 空串当目标语言会让 Prompt 里出现一句空话，并且历史里记成空。
        assert_eq!(
            resolve_target(Some("   "), Some(""), Some("en"), "zh-CN", Some("en")),
            "zh-CN"
        );
    }

    #[test]
    fn target_switches_to_the_second_language_when_they_collide() {
        // 中文用户的默认设置是「翻成中文」；他划了一段中文时应该出英文。
        assert_eq!(pick_target(Some("zh"), "zh-CN", Some("en")), "en");
        assert_eq!(pick_target(Some("en"), "zh-CN", Some("en")), "zh-CN");
    }

    #[test]
    fn target_stays_put_when_there_is_no_usable_second_language() {
        // 没有第二目标语言、或第二目标语言也撞车时不乱换。
        assert_eq!(pick_target(Some("zh"), "zh-CN", None), "zh-CN");
        assert_eq!(pick_target(Some("zh"), "zh-CN", Some("zh-TW")), "zh-CN");
    }

    #[test]
    fn unknown_source_keeps_the_primary_target() {
        assert_eq!(pick_target(None, "zh-CN", Some("en")), "zh-CN");
    }

    #[test]
    fn display_names_ignore_region_subtags() {
        assert_eq!(display_name("zh-CN"), "中文");
        assert_eq!(display_name("zh-TW"), "中文");
        assert_eq!(display_name("en-US"), "English");
        assert_eq!(display_name("ja"), "日本語");
    }

    #[test]
    fn unknown_language_codes_fall_back_to_the_code_itself() {
        // 编一个名字比原样输出更糟：模型会被错误的名字带偏。
        assert_eq!(display_name("xx-YY"), "xx-YY");
    }
}
