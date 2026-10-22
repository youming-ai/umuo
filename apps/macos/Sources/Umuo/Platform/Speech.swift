import AVFoundation

/// 系统里可用的一个发音人。对应 `umuo_platform::speech::Voice`，多一个 `identifier`：
/// AVSpeech 下同一个名字（Eddy、Flo…）在每个语言下各有一份，只有 identifier 能唯一指到一个。
struct Voice: Equatable {
    let name: String
    /// 形如 `zh-CN` 或 `zh_CN`，比较前统一成 `_`。
    let language: String
    let identifier: String
    /// AVSpeech 自己标了 `isNoveltyVoice`（Wobble、Superstar 这些名字与 `say` 下的不同）。名单之外的补充判据。
    var flaggedNovelty = false
}

/// 发音朗读的纯规则，对应 `crates/umuo-platform/src/speech.rs`：按语言挑发音人、把译文收拾成可念的文本。
enum SpeechRules {
    /// macOS 自带的「趣味」发音人，与 Rust 的 `NOVELTY_VOICES` 同一份名单。
    ///
    /// 它们**在每个语言下都出现一遍**，且按字母序排在自然发音人前面——「取第一个匹配」会让中文挑到 Eddy。
    /// AVSpeech 的 `voiceTraits.isNoveltyVoice` 只标了其中一部分（Eddy、Flo、Grandma 这批 eloquence 音实测都没标），
    /// 所以名单仍是主判据，trait 只是补充。
    static let noveltyVoices: Set<String> = [
        "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged", "eddy", "flo", "fred",
        "good news", "grandma", "grandpa", "hysterical", "jester", "junior", "kathy", "organ", "princess", "ralph",
        "reed", "rocko", "sandy", "shelley", "superstar", "trinoids", "whisper", "wobble", "zarvox",
    ]

    /// 名字可能带「 (Chinese (China mainland))」这样的后缀（`say -v '?'` 的格式），只比前面的名字。
    static func isNovelty(_ name: String) -> Bool {
        let bare = name.range(of: " (").map { String(name[..<$0.lowerBound]) } ?? name
        return noveltyVoices.contains(bare.trimmingCharacters(in: .whitespaces).lowercased())
    }

    /// 从可用发音人里按语言挑一个，返回它的 identifier。挑不到返回 nil，交给系统默认发音人。
    ///
    /// 四层优先级与 Rust 的 `pick_voice` 一致：
    ///
    ///   1. 地区精确 + 自然音   （zh-TW 文本 → zh_TW 的 Meijia）
    ///   2. 同语言 + 自然音     （zh-CN 文本 → zh_TW 的 Meijia）
    ///   3. 地区精确 + 趣味音
    ///   4. 同语言 + 趣味音     （只有趣味音可用时的兜底）
    ///
    /// 第 2 层排在第 3 层之前是刻意的：地区口音的差异远小于机械音的差异。
    static func pickVoice(_ voices: [Voice], _ language: String) -> String? {
        let normalized = language.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "-", with: "_")
        let primary = normalized.split(separator: "_", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        func code(_ voice: Voice) -> String { voice.language.replacingOccurrences(of: "-", with: "_") }

        let exact = normalized.contains("_")
            ? voices.filter { code($0).caseInsensitiveCompare(normalized) == .orderedSame } : []
        let sameLanguage = voices.filter { voice in
            let candidate = code(voice).split(separator: "_", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
            return String(candidate).caseInsensitiveCompare(primary) == .orderedSame
        }
        func natural(_ pool: [Voice]) -> Voice? { pool.first { !$0.flaggedNovelty && !isNovelty($0.name) } }

        return (natural(exact) ?? natural(sameLanguage) ?? exact.first ?? sameLanguage.first)?.identifier
    }

    /// 把文本收拾成适合朗读的样子，与 Rust 的 `to_speech_text` 同一规则：
    /// 逐行 trim，代码块围栏与纯符号行（含空行）不念，行与行用一个空格连成一段（逐行念会一顿一顿），
    /// 再把 `* ` # _` 换成空格、压掉连续空白——否则用户听到的是「星号星号粗体星号星号」。
    static func toSpeechText(_ text: String) -> String {
        var kept: [String] = []
        // Rust 的 `lines()`：按 \n 切，行尾的 \r 一并去掉（trim 已覆盖）。
        // 必须按 Unicode 标量切：Swift 的 Character 里 "\r\n" 是一个字形簇，不等于 "\n"，
        // 按 Character 切的话 CRLF 文本整段只算一行，围栏与纯符号行都跳不掉。
        // 单独的 \r、U+2028 不切，与 `lines()` 一致。
        for scalars in text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = String(String.UnicodeScalarView(scalars)).trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("```") || !trimmed.contains(where: { $0.isLetter || $0.isNumber }) { continue }
            kept.append(trimmed)
        }
        let flattened = kept.joined(separator: " ").map { "*`#_".contains($0) ? " " : String($0) }.joined()
        return flattened.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// 要念的那一句。文本经 `AVSpeechUtterance(string:)` 作为**数据**交给合成器：
    /// 不像 `say` 那样走命令行参数，以 `-` 开头的译文（「- 第一点」「-o/路径」）不会被当成选项（M11 那一类问题不存在）。
    static func utterance(_ spoken: String, voiceIdentifier: String?) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: spoken)
        // identifier 失效（发音人被卸载）时构造出 nil，等同 Rust 的「挑不到 → 系统默认发音人」
        utterance.voice = voiceIdentifier.flatMap { AVSpeechSynthesisVoice(identifier: $0) }
        return utterance
    }
}

/// macOS 发音朗读，对应 `crates/umuo-platform-macos/src/speech.rs`（Tauri 版用 `/usr/bin/say` 子进程）。
///
/// Swift 版用进程内的 `AVSpeechSynthesizer`：Rust 不用它，是因为它要一个 run loop 才开口，而 Tauri 命令跑在哪个线程
/// 不由我们决定。这里整个类钉在 MainActor 上，主线程的 run loop 由 SwiftUI 应用持有，那个顾虑不存在。
///
/// 「停上一段 → 起新的一段 → 存起来」在同一个 MainActor 方法里同步做完，相当于 Rust 那把锁（L16）：
/// 两次朗读不会叠音，也不会留下停不掉的一段。每次朗读换一个新的合成器，旧的立即停掉——
/// 与 Rust 每次起一个新的 `say` 进程同构，也避开「同一个合成器刚 stop 就 speak，新句子偶尔被吞」。
///
/// 用 AVSpeech 时 `speak` 没有失败路径（不起进程、不解析参数），所以不抛错；
/// 挑不到发音人或 identifier 失效都落到系统默认发音人，与 Rust 的 `None` 一致。
@MainActor
final class Speech {
    /// 当前正在朗读的合成器。nil = 没在朗读。
    private(set) var current: AVSpeechSynthesizer?
    /// 系统装了哪些发音人。查一次就缓存——一台机器上基本不变。
    private lazy var voices: [Voice] = Speech.installedVoices()

    /// `voices` 只给 selftest 换成夹具用，正式代码查系统。
    init(voices: [Voice]? = nil) {
        if let voices { self.voices = voices }
    }

    /// 朗读一段文本。`language` 是 BCP-47 短码，用来挑选发音人。
    func speak(_ text: String, language: String?) {
        let spoken = SpeechRules.toSpeechText(text)
        // 只念空白的输入没有意义，但也不是错误——调用方可能只是选中了符号。也不打断正在念的上一段。
        if spoken.isEmpty { return }

        // 先停掉上一段：两段声音叠在一起比「后一次没生效」更让人烦躁。
        stop()
        let identifier = language.flatMap { SpeechRules.pickVoice(voices, $0) }
        let synthesizer = AVSpeechSynthesizer()
        synthesizer.speak(SpeechRules.utterance(spoken, voiceIdentifier: identifier))
        current = synthesizer
    }

    /// 停掉当前朗读。没在朗读时也算成功——用户可能连点两次停止。
    func stop() {
        current?.stopSpeaking(at: .immediate)
        current = nil
    }

    /// 按系统**实际装了**的发音人来挑，而不是按一张硬编码的名字表——猜错的结果是「按了没反应」。
    ///
    /// 排除两类念不出来的：Siri 音（会列在表里，但 Apple 不保证第三方 App 能用，念不出来时用户无从得知）与个人声音（要另行授权）。
    /// 再按名字排序：`speechVoices()` 的顺序不固定，而 `say -v '?'` 是字母序；排完以后「第一个匹配」与 Rust 版挑得一样。
    /// 同名的按质量从高到低（compact 先于 super-compact）。
    static func installedVoices() -> [Voice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { !$0.identifier.hasPrefix("com.apple.siri.") && !$0.voiceTraits.contains(.isPersonalVoice) }
            .sorted { a, b in
                if a.name != b.name { return a.name < b.name }
                if a.quality != b.quality { return a.quality.rawValue > b.quality.rawValue }
                return a.identifier < b.identifier
            }
            .map { voice in
                Voice(name: voice.name, language: voice.language, identifier: voice.identifier,
                      flaggedNovelty: voice.voiceTraits.contains(.isNoveltyVoice))
            }
    }
}
