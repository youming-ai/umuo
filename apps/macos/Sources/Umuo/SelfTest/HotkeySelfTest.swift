import ApplicationServices
import Carbon
import CoreGraphics
import UmuoCore

/// `--selftest` 的快捷键部分：解析与分流、Carbon 注册与失败上报、暂停 / 录键、修饰键对账与连按判定。
///
/// **不按任何键、不碰默认键位**：真注册只用 ⌃⌥⇧⌘ + F13…F19 这类没人用的组合，测完全部注销——
/// 默认键位可能正被另一个 umuo 实例（如正式安装版）占着，拿它测会得到假失败，还会抢走用户的快捷键。
/// 修饰键监听要「输入监控」权限：没授权时打印跳过，**不调用** `tapCreate`（它本身可能弹授权提示）；
/// 授权了也只建出来再立刻作废，不进 run loop、不收事件。连按判定直接往 Rust 的判定器里喂事件序列。
enum HotkeySelfTest {
    @MainActor
    static func run(_ check: (String, Bool, String) -> Void) {
        parse(check)
        combos(check)
        plan(check)
        reconcile(check)
        detector(check)
        carbon(check)
        center(check)
        tap(check)
    }

    /// 与 `hotkey.rs` 的 `parses_double_taps_and_leaves_everything_else_as_combos` 同一张表。
    static func parse(_ check: (String, Bool, String) -> Void) {
        let taps = parseHotkey(value: "Ctrl Ctrl") == .doubleTap(tap: DoubleTap(kind: .ctrl, side: nil))
            && parseHotkey(value: "rightcmd RightCmd") == .doubleTap(tap: DoubleTap(kind: .cmd, side: .right))
            && parseHotkey(value: " option  Option ") == .doubleTap(tap: DoubleTap(kind: .alt, side: nil))
        let notTaps = ["Alt+D", "Ctrl Alt", "Ctrl", "A A", "Ctrl Ctrl Ctrl", ""].allSatisfy {
            if case .combo = parseHotkey(value: $0) { true } else { false }
        }
        let any = DoubleTap(kind: .ctrl, side: nil), right = DoubleTap(kind: .ctrl, side: .right)
        let lctrl = ModKey(kind: .ctrl, side: .left), rctrl = ModKey(kind: .ctrl, side: .right)
        let sides = doubleTapMatches(tap: any, key: lctrl) && doubleTapMatches(tap: any, key: rctrl)
            && doubleTapMatches(tap: right, key: rctrl) && !doubleTapMatches(tap: right, key: lctrl)
            && !doubleTapMatches(tap: any, key: ModKey(kind: .cmd, side: .right))
        check("parseHotkey", taps && notTaps && sides, "⌃⌃ / 右⌘⌘ / ⌥⌥ 分流成连按，其余都是组合键；带侧的只认那一侧")
    }

    /// 录键器能产出的每个键（`HotkeyFormat`）都要解析得出键码；再对几条 `global-hotkey` 的边界。
    static func combos(_ check: (String, Bool, String) -> Void) {
        var keys = (UnicodeScalar("A").value...UnicodeScalar("Z").value).map { String(UnicodeScalar($0)!) }
        keys += (0...9).map(String.init) + (1...12).map { "F\($0)" }
        keys += ["Space", "Enter", "Tab", "Comma", "Period", "Slash", "Semicolon", "Quote", "BracketLeft",
                 "BracketRight", "Backslash", "Minus", "Equal", "Backquote", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]
        let unparsable = keys.flatMap { ["Alt+\($0)", "Ctrl+Alt+Shift+Cmd+\($0)"] }.filter {
            if case .combo = HotkeyCombo.parse($0) { false } else { true }
        }
        check("HotkeyCombo.recordable", unparsable.isEmpty,
              unparsable.isEmpty ? "\(keys.count) 个录键器按键 × 2 种修饰全部解析" : "解析不了：\(unparsable.joined(separator: ", "))")

        let option = UInt32(optionKey), cmd = UInt32(cmdKey), shift = UInt32(shiftKey), control = UInt32(controlKey)
        let cases: [(String, HotkeyCombo.Parsed?)] = [
            ("Alt+D", .combo(.init(keyCode: 0x02, modifiers: option))),
            ("alt + cmd + a", .combo(.init(keyCode: 0x00, modifiers: option | cmd))),
            ("CommandOrControl+Shift+KeyT", .combo(.init(keyCode: 0x11, modifiers: cmd | shift))),
            ("Control+Option+Digit1", .combo(.init(keyCode: 0x12, modifiers: control | option))),
            ("Super+Esc", .combo(.init(keyCode: 0x35, modifiers: cmd))),
            ("F5", .combo(.init(keyCode: 0x60, modifiers: 0))),
            ("Alt+F24", .unsupported("F24")),
            ("Alt+Pause", .unsupported("Pause")),
            ("Ctrl+", nil), ("Ctrl++D", nil), ("Ctrl+C+A", nil), ("Ctrl+C+Shift", nil), ("Alt", nil), ("Alt+Foo", nil), ("", nil),
        ]
        let wrong = cases.filter { HotkeyCombo.parse($0.0) != $0.1 }.map(\.0)
        check("HotkeyCombo.parse", wrong.isEmpty,
              wrong.isEmpty ? "别名、大小写、空白与 global-hotkey 一致；空 token、多个主键、只有修饰键都不合法" : "不一致：\(wrong)")
    }

    /// 回落只给「既不是连按、又解析不了」的值；连按不回落；缺字段等于空串，也回落。
    static func plan(_ check: (String, Bool, String) -> Void) {
        let values = HotkeyCenter.values(settingsJson: #"""
        {"selectionHotkey":"Ctrl Ctrl","silentReplaceHotkey":"Alt Alt","composeHotkey":"Ctrl+Foo",
         "compareHotkey":"Alt+P","ocrHotkey":"Alt+Cmd+O","ocrSilentHotkey":"Alt+Shift+O","theme":"dark"}
        """#)
        let plan = HotkeyCenter.plan(values)
        let option = UInt32(optionKey)
        let ok = values.count == 4 && values["theme"] == nil
            && plan.map(\.field) == HotkeyCenter.table.map(\.field)
            && plan[0].plan == .doubleTap(DoubleTap(kind: .ctrl, side: nil))
            && plan[1].plan == .doubleTap(DoubleTap(kind: .alt, side: nil))
            && plan[2].plan == .combo(.combo(.init(keyCode: 0x00, modifiers: option | UInt32(cmdKey))))
            && plan[3].plan == .combo(.combo(.init(keyCode: 0x1F, modifiers: option | UInt32(cmdKey))))
            && values["compareHotkey"] == nil && values["ocrSilentHotkey"] == nil && values["speakHotkey"] == nil
        check("HotkeyCenter.plan", ok, "只读四个活跃字段；退役键位不注册；⌃⌃ / ⌥⌥ 分流，非法值回落到 ⌥⌘A")
    }

    /// 修饰键按下 / 松开的四组典型输入。
    static func reconcile(_ check: (String, Bool, String) -> Void) {
        let lctrl = ModKey(kind: .ctrl, side: .left), lcmd = ModKey(kind: .cmd, side: .left)
        let rcmd = ModKey(kind: .cmd, side: .right)
        let sides = ModifierTap.modifierEvent(keycode: 0x36, flags: 0x0010_0010) == .down(key: rcmd)
            // 左 ⌘ 还按着、右 ⌘ 松开：通用 ⌘ 位仍在，但右 ⌘ 的设备位没了
            && ModifierTap.modifierEvent(keycode: 0x36, flags: 0x0010_0008) == .up(key: rcmd)
        // ⌃⌘Q 锁屏丢了 ⌘ 的松开：解锁后按左 ⌃，先补「左 ⌘ 松开」
        let lost = ModifierTap.reconcile(previous: [lcmd], keycode: 0x3B, flags: 0x0004_0001)
        // 左 ⌃ 的松开丢了，再按左 ⌃：先补松开再报按下
        let again = ModifierTap.reconcile(previous: [lctrl], keycode: 0x3B, flags: 0x0004_0001)
        let down = ModifierTap.reconcile(previous: [], keycode: 0x3B, flags: 0x0004_0001)
        let up = ModifierTap.reconcile(previous: down.held, keycode: 0x3B, flags: 0)
        let ok = sides
            && lost.events == [.up(key: lcmd), .down(key: lctrl)] && lost.held == [lctrl]
            && again.events == [.up(key: lctrl), .down(key: lctrl)]
            && down.events == [.down(key: lctrl)] && down.held == [lctrl]
            && up.events == [.up(key: lctrl)] && up.held.isEmpty
            && [0x3F, 0x39].allSatisfy { ModifierTap.modifierEvent(keycode: $0, flags: 0) == nil }
        check("ModifierTap.reconcile", ok, "左右按设备位分；丢失的松开按完整 flags 补发；fn / Caps Lock 不参与")
    }

    /// 经 FFI 喂 Rust 的判定器（`hotkey.rs` 的序列），再经 `DoubleTapRouter` 找绑定。
    static func detector(_ check: (String, Bool, String) -> Void) {
        let lctrl = ModKey(kind: .ctrl, side: .left), rctrl = ModKey(kind: .ctrl, side: .right)
        let lalt = ModKey(kind: .alt, side: .left)
        func tap(_ key: ModKey, _ at: UInt64) -> [(TapInput, UInt64)] { [(.down(key: key), at), (.up(key: key), at + 60)] }
        func run(_ events: [(TapInput, UInt64)]) -> [ModKey] {
            let detector = DoubleTapDetector()
            return events.compactMap { detector.feed(input: $0.0, nowMs: $0.1) }
        }
        let ok = run(tap(lctrl, 0) + tap(lctrl, 200)) == [lctrl]
            && run(tap(lctrl, 0) + tap(lctrl, 150) + tap(lctrl, 300)) == [lctrl]
            && run([(.down(key: lctrl), 0), (.up(key: lctrl), 400)] + tap(lctrl, 500)).isEmpty
            && run(tap(lctrl, 0) + [(.other, 100)] + tap(lctrl, 150)).isEmpty
            && run(tap(lctrl, 0) + tap(lctrl, 600)).isEmpty
            && run([(.down(key: lalt), 0), (.down(key: lctrl), 20), (.up(key: lctrl), 60), (.up(key: lalt), 80)] + tap(lctrl, 150)).isEmpty
            && run(tap(lctrl, 0) + tap(rctrl, 150)).isEmpty
        check("DoubleTapDetector", ok, "两下触发、三下只触发一次；按太久、中间有别的键、太慢、组合、左接右都不算")

        let router = DoubleTapRouter()
        router.replaceBindings([
            .init(tap: DoubleTap(kind: .ctrl, side: .right), field: "selectionHotkey", action: .selection),
            .init(tap: DoubleTap(kind: .alt, side: nil), field: "silentReplaceHotkey", action: .silentReplace),
        ])
        var routed: [HotkeyAction] = []
        for (input, at) in tap(lctrl, 0) + tap(lctrl, 200) + tap(lalt, 1000) + tap(lalt, 1200) + tap(rctrl, 2000) + tap(rctrl, 2200) {
            if let action = router.route(input, nowMs: at) { routed.append(action) }
        }
        check("DoubleTapRouter", routed == [.silentReplace, .selection] && !router.started,
              "左 ⌃⌃ 不触发「右⌃⌃」绑定；⌥⌥ 与右 ⌃⌃ 各自命中；没启动监听")
    }

    /// 真的向 Carbon 注册与注销（不需要权限）。只用没人用的组合。
    @MainActor
    static func carbon(_ check: (String, Bool, String) -> Void) {
        let hotkeys = GlobalHotkeys()
        let combo = HotkeyCombo.parse("Ctrl+Alt+Shift+Cmd+F19")!
        var first: GlobalHotkeys.Failure?, second: GlobalHotkeys.Failure?, unsupported: GlobalHotkeys.Failure?
        do { try hotkeys.register(combo) {} } catch { first = error }
        do { try hotkeys.register(combo) {} } catch { second = error }
        do { try hotkeys.register(.unsupported("F24")) {} } catch { unsupported = error }
        let count = hotkeys.count
        let leftovers = hotkeys.unregisterAll()
        check("GlobalHotkeys", first == nil && second == .status(OSStatus(eventHotKeyExistsErr))
              && unsupported == .unsupportedKey("F24") && count == 1 && leftovers.isEmpty && hotkeys.count == 0,
              "⌃⌥⇧⌘F19 注册成功；同一组合再注册报 \(second.map(\.description) ?? "nil")；没有键码的键报失败；全部注销")
    }

    /// `HotkeyCenter` 整体：失败按字段名上报、暂停与录键挡住触发、录键期间注销、结束后重注册、只有组合键时不启动监听。
    @MainActor
    static func center(_ check: (String, Bool, String) -> Void) {
        let values = [
            "selectionHotkey": "Ctrl+Alt+Shift+Cmd+F13", "silentReplaceHotkey": "Ctrl+Alt+Shift+Cmd+F14",
            "composeHotkey": "Ctrl+Alt+Shift+Cmd+F13", "ocrHotkey": "Alt+F24",
            "compareHotkey": "Ctrl+Alt+Shift+Cmd+F16", "ocrSilentHotkey": "Ctrl+Alt+Shift+Cmd+F17",
            "speakHotkey": "Alt+R",
        ]
        let center = HotkeyCenter { _ in }
        var notified = 0
        center.onRegistered = { notified += 1 }
        center.register(values)
        let registered = center.registeredCombos == 2
            && center.failures == ["composeHotkey", "ocrHotkey"] && !center.doubleTapListening
        check("HotkeyCenter.register", registered,
              "2 个注册成功；与上一行重复的、没有键码的按字段名记失败：\(center.failures)；没有连按就不开监听")

        center.paused = true
        let pausedBlocks = center.suspended
        center.paused = false
        center.setRecording(true)
        // 录键期间设置变了（导入配置、另一行改了快捷键）：只记下新设置，不把组合键注册回来抢录键器的按键
        center.reregister(values)
        let recording = center.suspended && center.registeredCombos == 0 && notified == 0
        center.setRecording(false)
        let restored = !center.suspended && center.registeredCombos == 2 && notified == 1
        center.reregister(values)
        let reregistered = center.registeredCombos == 2 && center.failures.count == 2 && notified == 2
        // 收尾：注销全部，不留任何全局快捷键
        center.unregisterAll()
        let clean = center.registeredCombos == 0
        check("HotkeyCenter.suspend", pausedBlocks && recording && restored && reregistered && clean,
              "暂停与录键期间不响应；录键时注销全部组合键、期间的重注册只记设置，结束后按设置重注册并通知；重注册不累积失败")
    }

    /// 修饰键监听：没有「输入监控」权限就跳过，不去建监听（建监听本身可能弹授权）。
    static func tap(_ check: (String, Bool, String) -> Void) {
        guard CGPreflightListenEventAccess() || AXIsProcessTrusted() else {
            print("- ModifierTap: skipped: needs Input Monitoring permission")
            return
        }
        // 建出来立刻作废：不启用、不进 run loop，收不到任何事件
        let port = ModifierTap.makeTap(userInfo: nil)
        if let port { CFMachPortInvalidate(port) }
        check("ModifierTap.create", port != nil, "已授权：只读监听建得出来（建完即作废）")
    }
}
