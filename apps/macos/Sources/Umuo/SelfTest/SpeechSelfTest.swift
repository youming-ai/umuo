import AVFoundation

/// `--selftest` 的朗读部分：挑发音人与文本清理用 Rust 测试的同一批夹具，再在本机真实发音人上挑几种语言。
///
/// **不出声**：不对真实合成器调 `speak`（空文本那一条在任何合成器创建之前就返回）。不涉及 TCC 权限。
enum SpeechSelfTest {
    @MainActor
    static func run(_ check: (String, Bool, String) -> Void) {
        voiceRules(check)
        textRules(check)
        utterance(check)
        installed(check)
        controller(check)
        print("- Speech.speak: skipped: would make sound")
    }

    static func voice(_ name: String, _ language: String) -> Voice {
        Voice(name: name, language: language, identifier: "\(language).\(name)")
    }

    /// 发音人选择的回归夹具同时覆盖 xx_YY 与 xx-YY 语言标记。
    static func voiceRules(_ check: (String, Bool, String) -> Void) {
        let list = [voice("Eddy", "ja_JP"), voice("Tingting", "zh-CN"), voice("Meijia", "zh_TW"),
                    voice("Yuna", "ko-KR"), voice("Daniel", "en_GB")]
        let pick = { (voices: [Voice], language: String) in SpeechRules.pickVoice(voices, language) }
        let exact = pick(list, "zh-TW") == "zh_TW.Meijia" && pick(list, "zh-CN") == "zh-CN.Tingting"
        let byLanguage = pick(list, "ja") == "ja_JP.Eddy" && pick(list, "en") == "en_GB.Daniel"
        let none = pick(list, "th") == nil && pick(list, "") == nil && pick([], "zh-CN") == nil
        check("pickVoice.region", exact && byLanguage && none,
              "zh-TW → Meijia、zh-CN → Tingting；ja / en 退到同语言；th、空串、空表 → nil（交给系统默认）")

        let avoid = pick([voice("Eddy", "zh-CN"), voice("Tingting", "zh-CN")], "zh-CN") == "zh-CN.Tingting"
        let sibling = [voice("Eddy", "zh-CN"), voice("Meijia", "zh-TW")]
        let siblingWins = pick(sibling, "zh-CN") == "zh-TW.Meijia" && pick(sibling, "zh-TW") == "zh-TW.Meijia"
        let onlyNovelty = pick([voice("Eddy", "zh-CN")], "zh-CN") == "zh-CN.Eddy"
        var flagged = voice("Wobble2", "en-US")
        flagged.flaggedNovelty = true
        let trait = pick([flagged, voice("Samantha", "en-US")], "en-US") == "en-US.Samantha"
        let suffix = SpeechRules.isNovelty("Eddy (Chinese (China mainland))") && SpeechRules.isNovelty("bad news")
            && !SpeechRules.isNovelty("Kyoko")
        check("pickVoice.novelty", avoid && siblingWins && onlyNovelty && trait && suffix,
              "有自然音就不挑趣味音；同语言的自然音胜过地区精确的趣味音；只有趣味音时用它；名单与 isNoveltyVoice 都认")
    }

    static func textRules(_ check: (String, Bool, String) -> Void) {
        let t = SpeechRules.toSpeechText
        let fence = t("第一段\n\n```rust\nlet x = 1;\n```\n第二段")
        let ok = t("**你好**世界") == "你好 世界" && t("# 标题") == "标题" && t("`code` 与 正文") == "code 与 正文"
            && !fence.contains("```") && fence.contains("第一段") && fence.contains("第二段")
            && t("第一句\n第二句") == "第一句 第二句" && t("第一句\r\n第二句") == "第一句 第二句"
            && t("a\r\n---\r\nb") == "a b"
            && t("第一段\r\n```rust\r\nlet x = 1;\r\n```\r\n第二段") == "第一段 let x = 1; 第二段"
            && t("") == "" && t("---\n***") == "" && t("   \n  ") == ""
        check("toSpeechText", ok, "去 Markdown 标记、跳过代码围栏与纯符号行、多行连成一段、空 / 纯符号 → 空串")
    }

    /// M11 的那类问题：文本作为数据交给合成器，以 `-` 开头也原样念，不会变成选项。
    static func utterance(_ check: (String, Bool, String) -> Void) {
        let dash = SpeechRules.utterance("-o/tmp/x", voiceIdentifier: nil)
        let missing = "com.umuo.selftest.no-such-voice"
        let list = SpeechRules.utterance("- 第一点", voiceIdentifier: missing)
        // 「系统默认发音人」在不同系统版本上可能表现为 nil 或一个默认 voice：只断言没有用上那个失效的 identifier
        let ok = dash.speechString == "-o/tmp/x" && list.speechString == "- 第一点"
            && list.voice?.identifier != missing
        check("Speech.utterance", ok, "「-o/tmp/x」「- 第一点」原样作为文本；失效的 identifier → 系统默认发音人")
    }

    /// 本机真实装了什么因机而异（Rust 那条是 #[ignore]），所以只要求英语一定挑得到，其它语言打印出来。
    @MainActor
    static func installed(_ check: (String, Bool, String) -> Void) {
        let voices = Speech.installedVoices()
        var picks: [String] = []
        var englishOK = false
        for code in ["zh-CN", "zh-TW", "ja", "en", "ko"] {
            let id = SpeechRules.pickVoice(voices, code)
            let resolved = id.flatMap { AVSpeechSynthesisVoice(identifier: $0) }
            if code == "en" { englishOK = resolved != nil }
            let name = resolved.map { "\($0.name) (\($0.language))" } ?? "系统默认"
            picks.append("\(code) → \(name)")
        }
        let natural = voices.filter { !$0.flaggedNovelty && !SpeechRules.isNovelty($0.name) }
        let novelPicked = picks.contains { pick in SpeechRules.noveltyVoices.contains { pick.lowercased().contains("→ \($0) (") } }
        check("Speech.installedVoices", englishOK && !voices.isEmpty,
              "\(voices.count) 个（自然音 \(natural.count)）；\(picks.joined(separator: "，"))\(novelPicked ? "（有语言只剩趣味音）" : "")")
    }

    /// 空文本不起合成器、不打断上一段；停是幂等的。都不出声。
    @MainActor
    static func controller(_ check: (String, Bool, String) -> Void) {
        let speech = Speech(voices: [])
        speech.stop()
        speech.stop()
        speech.speak("   \n  ", language: "zh-CN")
        speech.speak("---\n***", language: nil)
        check("Speech.stop", speech.current == nil, "没在朗读时连停两次不出错；只有空白 / 符号的文本不起合成器")
    }
}
