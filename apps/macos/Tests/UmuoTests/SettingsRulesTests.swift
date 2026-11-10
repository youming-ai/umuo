import AppKit
import Foundation
import os
import Security
import Testing
import UmuoCore
@testable import Umuo

// 设置页与快捷键等保留能力的规则回归，
// 外加 Swift 版自己的规则：嵌套对象里的未知字段在编辑后保留、数字框的坏输入、开机自启的 LaunchAgent。

private let zh = Translate(locale: .zhCN)

@Suite("设置窗的分区")
struct SettingsTabsTests {
    private let ok = SettingsAttentionInput(keyConfigured: true, permissionMissing: false)

    @Test func 六个分区顺序固定且不重复() {
        #expect(SettingsTab.allCases.map(\.rawValue) == ["general", "translate", "engine", "permissions", "advanced", "about"])
        for tab in SettingsTab.allCases { #expect(zh(tab.titleKey) != tab.titleKey) }
    }

    @Test func 没配Key点亮引擎缺权限点亮权限() {
        var input = ok
        input.keyConfigured = false
        #expect(SettingsTabs.attention(input) == [.engine])
        input = ok
        input.permissionMissing = true
        #expect(SettingsTabs.attention(input) == [.permissions])
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

    @Test @MainActor func 录键时焦点在可编辑文字里_按键让给文字() {
        // 录着键点进文本框按 ⌘V：不能被录成全局快捷键（会劫持系统粘贴）
        #expect(SettingsWindowController.yieldsToText(NSTextView()))
        let readOnly = NSTextView()
        readOnly.isEditable = false
        #expect(!SettingsWindowController.yieldsToText(readOnly))
        #expect(!SettingsWindowController.yieldsToText(NSView()))
        #expect(!SettingsWindowController.yieldsToText(nil))
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

    @Test func 保留天数与数字框同一口径_指数不被截成开头的整数() {
        #expect(SettingsRules.retentionDays("1e3") == 1000, "取开头的 1 会把历史清到只剩一天")
        #expect(SettingsRules.retentionDays("+30") == 30)
        #expect(SettingsRules.retentionDays("7.") == 7)
        #expect(SettingsRules.retentionDays(".5") == 0)
        #expect(SettingsRules.retentionDays("1e300") == 36500, "超出 Int 的范围不能崩")
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
        #expect(notice.contains(zh("prefs.general.importedStyles", ["count": "1"])))
        #expect(notice.contains(zh("prefs.general.importedGlossaries", ["count": "2"])))
    }

    @Test func 导入说明里旧风格与术语表为零时不提() {
        let result = ImportResult(
            providerId: "openai", targetLang: "en", customStyleCount: 0, glossaryCount: 0, bundleVersion: 2,
            endpointChanges: [], blacklistAdded: [], blacklistRemoved: [], settingsJson: "{}", hotkeysChanged: false
        )
        #expect(SettingsRules.importNotice(result, zh) == zh("prefs.general.imported", ["version": "2"]))
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

    @Test func 与旧版客户端同一个文件() {
        #expect(Autostart.plistURL(home: URL(fileURLWithPath: "/Users/someone")).path
            == "/Users/someone/Library/LaunchAgents/app.umuo.desktop.plist")
    }
}

@Suite("Keychain 写入与删除")
struct KeychainLockTests {
    @Test func 写与删和读取共用同一把锁_且不关掉用户交互() throws {
        // 读 Key 时进程级关掉 Keychain 交互（见 Keychain.read）。写 / 删若不取同一把锁，并发时本该弹授权框的写入
        // 会直接失败（-25308 errSecInteractionNotAllowed）。这里在每个 SecItem 调用里看：锁是不是被占着、交互是不是开着。
        let seen = OSAllocatedUnfairLock<[String]>(initialState: [])
        let probe: @Sendable (String) -> Void = { name in
            let free = Keychain.interactionLock.try()
            if free { Keychain.interactionLock.unlock() }
            var allowed: DarwinBoolean = false
            _ = SecKeychainGetUserInteractionAllowed(&allowed)
            let interactive = allowed.boolValue
            seen.withLock { $0.append("\(name):\(free ? "未加锁" : "已加锁"):\(interactive ? "可交互" : "不可交互")") }
        }
        var keychain = Keychain(service: "app.umuo.tests")
        keychain.calls.add = { _ in probe("add"); return errSecDuplicateItem }
        keychain.calls.update = { _, _ in probe("update"); return errSecSuccess }
        keychain.calls.delete = { _ in probe("delete"); return errSecItemNotFound }
        try keychain.write(account: "openai", secret: "sk-test")
        try keychain.delete(account: "openai")
        #expect(seen.withLock { $0 }
            == ["add:已加锁:可交互", "delete:已加锁:可交互", "update:已加锁:可交互", "delete:已加锁:可交互"])
    }

    @Test func 已有条目时删掉重建_不原地更新() throws {
        // 原地 update 不动 ACL：旧版写的条目只信任旧版的 cdhash，重新保存后新版照样读不到（errSecAuthFailed）。
        let calls = OSAllocatedUnfairLock<[String]>(initialState: [])
        var keychain = Keychain(service: "app.umuo.tests")
        keychain.calls.add = { _ in
            calls.withLock { $0.append("add") }
            return calls.withLock { $0.contains("delete") } ? errSecSuccess : errSecDuplicateItem
        }
        keychain.calls.update = { _, _ in calls.withLock { $0.append("update") }; return errSecSuccess }
        keychain.calls.delete = { _ in calls.withLock { $0.append("delete") }; return errSecSuccess }
        try keychain.write(account: "deepseek", secret: "sk-new")
        #expect(calls.withLock { $0 } == ["add", "delete", "add"])
    }

    @Test func 删不掉时退回原地更新() throws {
        let calls = OSAllocatedUnfairLock<[String]>(initialState: [])
        var keychain = Keychain(service: "app.umuo.tests")
        keychain.calls.add = { _ in calls.withLock { $0.append("add") }; return errSecDuplicateItem }
        keychain.calls.update = { _, _ in calls.withLock { $0.append("update") }; return errSecSuccess }
        keychain.calls.delete = { _ in calls.withLock { $0.append("delete") }; return errSecAuthFailed }
        try keychain.write(account: "deepseek", secret: "sk-new")
        #expect(calls.withLock { $0 } == ["add", "delete", "update"])
    }
}
