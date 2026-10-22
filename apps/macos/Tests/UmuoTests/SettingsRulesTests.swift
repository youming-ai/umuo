import Foundation
import Testing
import UmuoCore
@testable import Umuo

// settings-tabs.test.ts、hotkey-format.test.ts、style-presets.test.ts、glossary-editor.test.ts 逐条改写，
// 外加 Swift 版自己的规则：嵌套对象里的未知字段在编辑后保留、数字框的坏输入、开机自启的 LaunchAgent。

private let zh = Translate(locale: .zhCN)

@Suite("设置窗的分区")
struct SettingsTabsTests {
    private let ok = SettingsAttentionInput(keyConfigured: true, someProviderOverLimit: false, permissionMissing: false)

    @Test func 六个分区顺序固定且不重复() {
        #expect(SettingsTab.allCases.map(\.rawValue) == ["general", "translate", "engine", "permissions", "advanced", "about"])
        for tab in SettingsTab.allCases { #expect(zh(tab.titleKey) != tab.titleKey) }
    }

    @Test func 没配Key点亮引擎缺权限点亮权限超限点亮高级() {
        var input = ok
        input.keyConfigured = false
        #expect(SettingsTabs.attention(input) == [.engine])
        input = ok
        input.permissionMissing = true
        #expect(SettingsTabs.attention(input) == [.permissions])
        input = ok
        input.someProviderOverLimit = true
        #expect(SettingsTabs.attention(input) == [.advanced])
    }

    @Test func 一切都好或状态还没读出来时不点灯() {
        #expect(SettingsTabs.attention(ok).isEmpty)
        #expect(SettingsTabs.attention(SettingsAttentionInput(keyConfigured: nil, permissionMissing: nil)).isEmpty)
    }

    @Test func 初始分区() {
        #expect(SettingsTabs.initial(SettingsAttentionInput(keyConfigured: false, permissionMissing: true)) == .engine)
        #expect(SettingsTabs.initial(SettingsAttentionInput(keyConfigured: true, permissionMissing: true)) == .permissions)
        #expect(SettingsTabs.initial(ok) == .general)
        #expect(SettingsTabs.initial(SettingsAttentionInput(keyConfigured: nil, permissionMissing: nil)) == .general)
    }

    @Test func 缺权限要确定没授权才算缺() {
        #expect(SettingsTabs.missingPermission(true, false) == true)
        #expect(SettingsTabs.missingPermission(nil, false) == true)
        #expect(SettingsTabs.missingPermission(true, true) == false)
        #expect(SettingsTabs.missingPermission(true, nil) == nil)
    }
}

@Suite("录键：按键 → 快捷键字符串")
struct HotkeyFormatTests {
    private func key(_ code: String, ctrl: Bool = false, alt: Bool = false, shift: Bool = false, cmd: Bool = false)
        -> HotkeyFormat.Key
    {
        HotkeyFormat.Key(code: code, ctrl: ctrl, alt: alt, shift: shift, cmd: cmd)
    }

    @Test func 取物理键位不受组合出的字符影响() {
        #expect(HotkeyFormat.combo(from: key("KeyP", alt: true)) == .combo("Alt+P"))
        // 虚拟键码 0x23 就是 P 键：⌥P 打出来是「π」，录下来仍是 P
        #expect(HotkeyFormat.code(keyCode: 0x23) == "KeyP")
    }

    @Test func 修饰键按固定顺序写在前面() {
        #expect(HotkeyFormat.combo(from: key("Digit1", ctrl: true, alt: true, shift: true, cmd: true))
            == .combo("Ctrl+Alt+Shift+Cmd+1"))
    }

    @Test func 只按了修饰键时继续等主键() {
        #expect(HotkeyFormat.combo(from: key("AltLeft", alt: true)) == .waiting)
        #expect(HotkeyFormat.combo(from: key("MetaRight", cmd: true)) == .waiting)
        #expect(HotkeyFormat.code(keyCode: 0x36) == "MetaRight")
    }

    @Test func 只带Shift或没有修饰键的普通键不算快捷键() {
        #expect(HotkeyFormat.combo(from: key("KeyA")) == .waiting)
        #expect(HotkeyFormat.combo(from: key("KeyA", shift: true)) == .waiting)
    }

    @Test func 功能键可以单独作快捷键() {
        #expect(HotkeyFormat.combo(from: key("F5")) == .combo("F5"))
    }

    @Test func 录不了的键明确说出来() {
        #expect(HotkeyFormat.combo(from: key("NumpadEnter", alt: true)) == .unsupported)
        #expect(HotkeyFormat.combo(from: key("Unidentified", alt: true)) == .unsupported)
    }

    @Test func 录出来的每一种主键都能被全局快捷键解析() {
        // 录得出来却注册不了，等于静默回落到默认键位
        for main in HotkeyFormat.recordableKeys {
            guard case .combo? = HotkeyCombo.parse("Alt+\(main)") else {
                Issue.record("Alt+\(main) 解析不了")
                continue
            }
        }
    }

    @Test func 修饰键画成符号() {
        #expect(HotkeyFormat.parts("Alt+Shift+T") == ["⌥", "⇧", "T"])
        #expect(HotkeyFormat.parts("Ctrl+Cmd+Space") == ["⌃", "⌘", "Space"])
    }

    @Test func 兼容手写配置里的别名与大小写() {
        #expect(HotkeyFormat.parts("option+command+keyo") == ["⌥", "⌘", "O"])
        #expect(HotkeyFormat.parts("Alt+ArrowUp") == ["⌥", "↑"])
    }

    @Test func 连按显示成两个键帽右侧带前缀() {
        #expect(HotkeyFormat.parts("Ctrl Ctrl") == ["⌃", "⌃"])
        #expect(HotkeyFormat.parts("RightCmd RightCmd", rightLabel: "右") == ["右⌘", "右⌘"])
    }
}

@Suite("录键：连按两下修饰键")
struct DoubleTapRecorderTests {
    // 左 ⌃ 0x3B（设备位 0x1）、右 ⌘ 0x36（0x10）、左 ⌥ 0x3A（0x20）
    private func tap(_ recorder: DoubleTapRecorder, _ keyCode: UInt16, bit: UInt64, down: UInt64, up: UInt64) -> String? {
        _ = recorder.modifierChanged(keyCode: keyCode, flags: bit, atMs: down)
        return recorder.modifierChanged(keyCode: keyCode, flags: 0, atMs: up)
    }

    @Test func 左Ctrl快按两下录成CtrlCtrl() {
        let recorder = DoubleTapRecorder()
        #expect(tap(recorder, 0x3B, bit: 0x1, down: 1000, up: 1060) == nil)
        #expect(tap(recorder, 0x3B, bit: 0x1, down: 1200, up: 1260) == "Ctrl Ctrl")
    }

    @Test func 右Cmd录成只认右侧() {
        let recorder = DoubleTapRecorder()
        _ = tap(recorder, 0x36, bit: 0x10, down: 1000, up: 1050)
        #expect(tap(recorder, 0x36, bit: 0x10, down: 1150, up: 1200) == "RightCmd RightCmd")
    }

    @Test func 中间按了别的键或按太久或太慢都不算() {
        let interrupted = DoubleTapRecorder()
        _ = tap(interrupted, 0x3A, bit: 0x20, down: 1000, up: 1050)
        interrupted.other(atMs: 1100)
        #expect(tap(interrupted, 0x3A, bit: 0x20, down: 1150, up: 1200) == nil)

        let held = DoubleTapRecorder()
        _ = tap(held, 0x3A, bit: 0x20, down: 1000, up: 1400)
        #expect(tap(held, 0x3A, bit: 0x20, down: 1450, up: 1500) == nil)

        let slow = DoubleTapRecorder()
        _ = tap(slow, 0x3A, bit: 0x20, down: 1000, up: 1050)
        #expect(tap(slow, 0x3A, bit: 0x20, down: 1800, up: 1850) == nil)
    }

    @Test func 录下来的连按能被解析回同一个连按() {
        for value in ["Ctrl Ctrl", "RightCmd RightCmd", "Alt Alt"] {
            guard case .doubleTap = parseHotkey(value: value) else {
                Issue.record("\(value) 不是连按")
                continue
            }
        }
    }
}

@Suite("自建风格预设")
struct StylePresetsTests {
    private func style(_ id: String, label: String? = nil, instruction: String = "简短。",
                       fewShot: [CustomStyle.Example] = [], explain: Bool = false) -> CustomStyle
    {
        CustomStyle(id: id, label: label ?? id, instruction: instruction, fewShot: fewShot, explain: explain)
    }

    @Test func 新建的id带custom前缀且与时间戳一一对应() {
        #expect(StylePresets.new(now: 1).id.hasPrefix("custom-"))
        #expect(StylePresets.new(now: 1).id == StylePresets.new(now: 1).id)
        #expect(StylePresets.new(now: 1).id != StylePresets.new(now: 2).id)
        // 与 JS 的 `Date.now().toString(36)` 同一写法
        #expect(StylePresets.new(now: 1_700_000_000_000).id == "custom-loyw3v28")
    }

    @Test func 默认温度是温和的0点2() {
        #expect(StylePresets.new(now: 1).temperature == 0.2)
    }

    @Test func 新id追加已有id覆盖() {
        #expect(StylePresets.upsert([style("a")], style("b")).map(\.id) == ["a", "b"])
        let list = StylePresets.upsert([style("a"), style("b")], style("a", label: "改过"))
        #expect(list.count == 2)
        #expect(list[0].label == "改过")
    }

    @Test func 删除按id精确匹配不存在是无操作() {
        #expect(StylePresets.remove([style("a"), style("b")], id: "a").map(\.id) == ["b"])
        #expect(StylePresets.remove([style("a")], id: "nope").count == 1)
    }

    @Test func 摘要显示温度示例数与解释开关() {
        let summary = StylePresets.summary(style("a", fewShot: [.init(source: "a", target: "b")], explain: true), zh)
        #expect(summary.contains("温度 0.2"))
        #expect(summary.contains("1 个示例"))
        #expect(summary.contains("附解释"))
    }

    @Test func 没填风格指令时明确说出来() {
        #expect(StylePresets.summary(style("a", instruction: "  "), zh).contains("未填风格指令"))
    }

    @Test func 没有示例与解释时就不提它们() {
        let summary = StylePresets.summary(style("a"), zh)
        #expect(!summary.contains("示例"))
        #expect(!summary.contains("解释"))
    }

    @Test func 温度解析() {
        #expect(StylePresets.parseTemperature("") == 0.2)
        #expect(StylePresets.parseTemperature("abc") == 0.2)
        #expect(StylePresets.parseTemperature("9") == 2)
        #expect(StylePresets.parseTemperature("-1") == 0)
        #expect(abs(StylePresets.parseTemperature("0.7") - 0.7) < 1e-9)
    }

    @Test func 改一个字段后预设与示例里不认识的字段原样保留() throws {
        let json = #"""
        [{"id":"custom-1","label":"旧","instruction":"x","temperature":0.5,"explain":false,
          "fewShot":[{"source":"a","target":"b","note":"keep"}],"futureFlag":true}]
        """#
        let list = try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
        var styles = StylePresets.decode(list.arrayValue ?? [])
        styles[0].label = "新"
        let encoded = StylePresets.encode(styles).arrayValue?.first?.objectValue
        #expect(encoded?["futureFlag"] == .bool(true))
        #expect(encoded?["label"] == .string("新"))
        #expect(encoded?["fewShot"]?.arrayValue?.first?.objectValue?["note"] == .string("keep"))
    }

    @Test func 例句的行id各不相同_不写进设置也不参与比较() {
        let a = CustomStyle.Example(source: "a", target: "b")
        let b = CustomStyle.Example(source: "a", target: "b")
        #expect(a.id != b.id)
        #expect(a == b)
        #expect(a.json == .object(["source": .string("a"), "target": .string("b")]))
    }

    @Test func 缺字段时取Rust侧的默认值() {
        let style = CustomStyle(json: .object(["id": .string("custom-x"), "label": .string("L")]))
        #expect(style?.temperature == 0.2)
        #expect(style?.instruction == "")
        #expect(style?.fewShot.isEmpty == true)
    }
}

@Suite("术语表编辑器")
struct GlossaryEditorTests {
    private func list(source: String = "en", target: String = "zh-CN", entries: [(String, String)] = []) -> Glossary {
        Glossary(json: .object([
            "id": .string("a"), "name": .string("术语"), "source_lang": .string(source), "target_lang": .string(target),
            "entries": .array(entries.map { .object(["source": .string($0.0), "target": .string($0.1)]) }),
        ]))!
    }

    @Test func 新建的id带glossary前缀默认不限语言对() {
        #expect(GlossaryEditor.new(now: 1).id.hasPrefix("glossary-"))
        #expect(GlossaryEditor.new(now: 1).id == GlossaryEditor.new(now: 1).id)
        #expect(GlossaryEditor.new(now: 1).id != GlossaryEditor.new(now: 2).id)
        #expect(!GlossaryEditor.hasLanguageConstraint(GlossaryEditor.new(now: 1)))
    }

    @Test func 摘要显示语言对与条数留空写成不限() {
        #expect(GlossaryEditor.summary(list(entries: [("a", "b"), ("c", "d")]), zh) == "en → zh-CN · 2 条")
        #expect(GlossaryEditor.summary(list(source: ""), zh).contains("不限 → zh-CN"))
        #expect(GlossaryEditor.summary(list(target: "   "), zh).contains("en → 不限"))
        #expect(GlossaryEditor.summary(list(), zh).contains("0 条"))
    }

    @Test func 任一语言填了就有约束只有空白不算() {
        #expect(GlossaryEditor.hasLanguageConstraint(list(source: "en", target: "")))
        #expect(GlossaryEditor.hasLanguageConstraint(list(source: "", target: "zh-CN")))
        #expect(!GlossaryEditor.hasLanguageConstraint(list(source: "  ", target: "  ")))
    }

    @Test func 编辑框反填成每行原文制表符译文() {
        #expect(GlossaryEditor.editableText(list(entries: [("API", "接口"), ("cache", "缓存")])) == "API\t接口\ncache\t缓存")
    }

    @Test func 只改名称时条目与未知字段原样带回去() {
        var glossary = Glossary(json: .object([
            "id": .string("g"), "name": .string("旧"), "source_lang": .string(""), "target_lang": .string(""),
            "entries": .array([.object(["source": .string("a"), "target": .string("b"), "tag": .string("keep")])]),
            "futureField": .number(3),
        ]))!
        glossary.name = "新"
        let object = glossary.json.objectValue
        #expect(object?["name"] == .string("新"))
        #expect(object?["futureField"] == .number(3))
        #expect(object?["entries"]?.arrayValue?.first?.objectValue?["tag"] == .string("keep"))
        // 编码成 JSON 再解回来也一样（`glossarySaveJson` 收的就是这个）
        let back = GlossaryEditor.decode("[\(GlossaryEditor.encode(glossary))]")
        #expect(back.first?.raw["futureField"] == .number(3))
    }

    @Test func 语言对按Rust的snake_case键读写() {
        var glossary = GlossaryEditor.new(now: 1)
        glossary.sourceLang = "en"
        let object = glossary.json.objectValue
        #expect(object?["source_lang"] == .string("en"))
        #expect(object?["sourceLang"] == nil)
    }

    @Test func 读不出的JSON当作没有表() {
        #expect(GlossaryEditor.decode("not json").isEmpty)
        #expect(GlossaryEditor.decode("{}").isEmpty)
    }

    @Test func 导出文件名() {
        #expect(GlossaryEditor.exportFileName(Glossary(id: "g1", name: "a/b")) == "a-b.csv")
        #expect(GlossaryEditor.exportFileName(Glossary(id: "g1", name: " ")) == "g1.csv")
    }
}

@Suite("设置页的输入规则")
struct SettingsRulesTests {
    @Test func 数字显示与JS一致() {
        #expect(SettingsRules.format(5) == "5")
        #expect(SettingsRules.format(0.85) == "0.85")
        #expect(SettingsRules.format(30) == "30")
    }

    @Test func 认不出的数字是坏输入空串不是() {
        #expect(SettingsRules.isBadNumber("10,5"))
        #expect(SettingsRules.isBadNumber("abc"))
        #expect(!SettingsRules.isBadNumber(""))
        #expect(!SettingsRules.isBadNumber(" 12.5 "))
        #expect(!SettingsRules.isBadNumber("-3"))
        #expect(!SettingsRules.isBadNumber("1e3"))
    }

    @Test func 保留天数负数与认不出的归零() {
        #expect(SettingsRules.retentionDays("30") == 30)
        #expect(SettingsRules.retentionDays("-5") == 0)
        #expect(SettingsRules.retentionDays("") == 0)
        #expect(SettingsRules.retentionDays("7.9") == 7)
    }

    @Test func 黑名单去空白与空行() {
        #expect(SettingsRules.blacklist(" 1Password \n\n  Keychain Access\n ") == ["1Password", "Keychain Access"])
    }

    @Test func 代理选自定义但没存过地址时只展开地址栏() {
        #expect(SettingsRules.proxyChoice("custom", savedMode: "system", savedUrl: "") == .expandCustom)
        #expect(SettingsRules.proxyChoice("custom", savedMode: "system", savedUrl: "socks5://h:1") == .commit("custom"))
        #expect(SettingsRules.proxyChoice("none", savedMode: "system", savedUrl: "") == .commit("none"))
        #expect(SettingsRules.proxyChoice("system", savedMode: "system", savedUrl: "") == .unchanged)
    }

    @Test func 月度上限改一条时那一条里不认识的字段保留() {
        let list: [JSONValue] = [
            .object(["providerId": .string("openai"), "limitUsd": .number(5), "note": .string("keep")]),
            .object(["providerId": .string("deepseek"), "limitUsd": .number(1)]),
        ]
        let next = SettingsRules.setLimit(list, providerId: "openai", to: 8)
        let openai = next.first { $0.objectValue?.string("providerId") == "openai" }?.objectValue
        #expect(openai?["limitUsd"] == .number(8))
        #expect(openai?["note"] == .string("keep"))
        #expect(next.count == 2)
        // 清除 = 去掉那一条，而不是记成 0
        #expect(SettingsRules.setLimit(list, providerId: "openai", to: nil).count == 1)
        #expect(SettingsRules.setLimit(list, providerId: "x", to: -1).last?.objectValue?["limitUsd"] == .number(0))
    }

    @Test func 改一个场景时对比模型与不认识的键原样保留() {
        let scenes: [String: JSONValue] = [
            "selection": .null,
            "compare": .array([JSONValue(ModelRef(providerId: "openai", model: "gpt"))]),
            "futureScene": .string("keep"),
        ]
        let next = SettingsRules.setScene(scenes, .ocr, to: ModelRef(providerId: "deepseek", model: "chat"))
        #expect(next["ocr"]?.modelRef == ModelRef(providerId: "deepseek", model: "chat"))
        #expect(next["compare"] == scenes["compare"])
        #expect(next["futureScene"] == .string("keep"))
        // 只填了一半 = 用默认模型
        #expect(SettingsRules.setScene(scenes, .ocr, to: ModelRef(providerId: "deepseek", model: "")).values.contains(.null))
        #expect(SettingsRules.setScene(scenes, .ocr, to: ModelRef(providerId: "deepseek", model: ""))["ocr"] == .null)
    }

    @Test func 模型引用按Rust的snake_case写读的时候也认camelCase() {
        // `umuo_core::wire::ModelRef` 没有 rename_all：写成 providerId 会被 applySettingsPatch 拒掉
        #expect(JSONValue(ModelRef(providerId: "openai", model: "gpt")) == .object([
            "provider_id": .string("openai"), "model": .string("gpt"),
        ]))
        #expect(JSONValue.object(["providerId": .string("x"), "model": .string("m")]).modelRef
            == ModelRef(providerId: "x", model: "m"))
    }

    @Test func 用量那一行未计价时必须说出来() {
        let usage = UsageSummary(count: 3, inputTokens: 10, outputTokens: 20, costUsd: 0.5, unpriced: 0)
        #expect(SettingsRules.usageLine(usage, zh) == zh("history.usageLine", [
            "count": "3", "input": "10", "output": "20", "cost": "$0.5000",
        ]))
        let unpriced = UsageSummary(count: 3, inputTokens: 10, outputTokens: 20, costUsd: 0.5, unpriced: 2)
        #expect(SettingsRules.usageLine(unpriced, zh) != SettingsRules.usageLine(usage, zh))
        #expect(SettingsRules.usageLine(nil, zh) == zh("history.loadingUsage"))
    }

    @Test func 导入说明单独列出端点与黑名单的变化() {
        let result = ImportResult(
            providerId: "openai", targetLang: "en", customStyleCount: 1, glossaryCount: 2, bundleVersion: 1,
            endpointChanges: [EndpointChange(providerId: "custom", url: ""), EndpointChange(providerId: "azure", url: "https://x")],
            blacklistAdded: ["Slack"], blacklistRemoved: [], settingsJson: "{}", hotkeysChanged: false
        )
        let notice = SettingsRules.importNotice(result, zh)
        #expect(notice.contains("custom → \(zh("prefs.general.importedEndpointDefault"))"))
        #expect(notice.contains("azure → https://x"))
        #expect(notice.contains("Slack"))
        #expect(!notice.contains(zh("prefs.general.importedBlacklistRemoved", ["list": ""])))
    }

    @Test func 错误只显示信息不带枚举名() {
        #expect(SettingsRules.message(EngineError.InvalidSetting(message: "代理地址不合法")) == "代理地址不合法")
    }

    @Test func 界面语言选项与语言表() {
        #expect(Languages.uiLocales.map(\.value) == ["system", "zh-CN", "zh-TW", "en", "ja"])
        #expect(Languages.label("ja") == "日本語")
        #expect(Languages.label("xx") == "xx")
    }
}

@Suite("开机自启（LaunchAgent）")
struct AutostartTests {
    private func home(_ tag: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("umuo-autostart-\(tag)-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test func plist里有launchd真正要的键且不开KeepAlive() {
        let plist = Autostart.plist(program: "/Applications/umuo.app/Contents/MacOS/Umuo")
        #expect(plist.contains("<string>app.umuo.desktop</string>"))
        #expect(plist.contains("<key>RunAtLoad</key>"))
        #expect(plist.contains("<true/>"))
        #expect(!plist.contains("KeepAlive"))
    }

    @Test func 路径里的XML元字符被转义且能原样读回() {
        let program = "/Users/a&b/My <App>/umuo"
        let plist = Autostart.plist(program: program)
        #expect(plist.contains("a&amp;b"))
        #expect(plist.contains("My &lt;App&gt;"))
        #expect(Autostart.program(inPlist: plist) == program)
    }

    @Test func 打开写文件关掉删文件() throws {
        let dir = try home("cycle")
        defer { try? FileManager.default.removeItem(at: dir) }
        let exec = dir.appendingPathComponent("umuo")
        try Data().write(to: exec)
        #expect(!Autostart.isEnabled(home: dir))
        #expect(try Autostart.setEnabled(true, home: dir, program: exec.path))
        #expect(try String(contentsOf: Autostart.plistURL(home: dir), encoding: .utf8).contains(exec.path))
        #expect(try !Autostart.setEnabled(false, home: dir, program: exec.path))
        // 关掉一个本来就关着的不算错
        #expect(try !Autostart.setEnabled(false, home: dir, program: exec.path))
    }

    @Test func 指向已不存在的程序算关() throws {
        let dir = try home("stale")
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = Autostart.plistURL(home: dir)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Autostart.plist(program: dir.appendingPathComponent("gone/umuo").path).write(to: url, atomically: true, encoding: .utf8)
        #expect(!Autostart.isEnabled(home: dir))
    }

    @Test func 临时位置被拒绝且不留文件() throws {
        let dir = try home("translocated")
        defer { try? FileManager.default.removeItem(at: dir) }
        for program in ["/Volumes/umuo/umuo.app/Contents/MacOS/Umuo",
                        "/private/var/folders/x/T/AppTranslocation/ABC/d/umuo.app/Contents/MacOS/Umuo"]
        {
            #expect(Autostart.checkLaunchPath(program) != nil)
            #expect(throws: Autostart.Failure.self) { try Autostart.setEnabled(true, home: dir, program: program) }
            #expect(!FileManager.default.fileExists(atPath: Autostart.plistURL(home: dir).path))
        }
        #expect(Autostart.checkLaunchPath("/Applications/umuo.app/Contents/MacOS/Umuo") == nil)
    }

    @Test func 与Tauri版同一个文件() {
        #expect(Autostart.plistURL(home: URL(fileURLWithPath: "/Users/someone")).path
            == "/Users/someone/Library/LaunchAgents/app.umuo.desktop.plist")
    }
}
