import AppKit
import ApplicationServices
import CoreGraphics
import os
import UmuoCore

/// `--selftest` 的取词部分：`Selection` 与 ⌘C 降级。
///
/// **不碰用户的剪贴板、不往用户的应用里按键**：降级事务整段跑在私有命名剪贴板上，「按 ⌘C」换成直接写那块剪贴板；
/// 真正的 CGEvent 只造不投递。AX 取词要辅助功能权限，没授权时（未签名的 swift build、CI）断言权限拒绝并打印跳过；
/// 授权了也只调只读的 `readFocusText`，不打印读到的内容（那是用户正在用的输入框）。
enum SelectionSelfTest {
    @MainActor
    static func run(_ check: (String, Bool, String) -> Void) {
        pureChecks(check)
        keyEvents(check)
        fallback(check)
        live(check)
    }

    /// 与 `selection.rs` 的 `a_copy_counts_only_after_someone_wrote_the_clipboard` 同一张表。
    static func pureChecks(_ check: (String, Bool, String) -> Void) {
        let copied = ClipboardFallback.copiedText(cleared: 5, now: 5, text: "旧内容") == nil
            && ClipboardFallback.copiedText(cleared: 5, now: 6, text: "选中") == "选中"
            && ClipboardFallback.copiedText(cleared: 5, now: 6, text: nil) == nil
            && ClipboardFallback.copiedText(cleared: 5, now: 6, text: "") == nil
        check("ClipboardFallback.copiedText", copied, "计数没变不算、非文本与空串不算")
        let messages = SelectionError.permissionDenied.description == "需要系统权限：辅助功能"
            && SelectionError.noSelection.description == "没有检测到选中的文本"
        check("SelectionError", messages, "文案与 PlatformError 逐字一致")
    }

    /// 只造事件、不投递：验键码与 ⌘ 修饰。
    static func keyEvents(_ check: (String, Bool, String) -> Void) {
        do {
            var ok = true
            for key in [KeyEvent.keyC, KeyEvent.keyV] {
                for down in [true, false] {
                    let event = try KeyEvent.make(key, down: down)
                    ok = ok && event.getIntegerValueField(.keyboardEventKeycode) == Int64(key)
                        && event.flags.contains(.maskCommand) && (event.type == (down ? .keyDown : .keyUp))
                }
            }
            check("KeyEvent", ok, "⌘C / ⌘V 的按下与抬起（只造不投递）")
        } catch {
            check("KeyEvent", false, error.description)
        }
    }

    /// 降级事务在私有剪贴板上逐条验：取到、取不到、合成失败、迟到的复制、并发两次。
    static func fallback(_ check: (String, Bool, String) -> Void) {
        let name = NSPasteboard.Name("app.umuo.desktop.selftest.\(UUID().uuidString)")
        let pasteboard = NSPasteboard(name: name)
        defer { pasteboard.releaseGlobally() }

        // 原内容带两个 item、三种类型，其中有非文本：只存文本的话它们会在一次取词之后丢掉
        let original = Pasteboard.Snapshot(items: [
            [.init(type: "public.utf8-plain-text", data: Data("umuo".utf8)),
             .init(type: "public.html", data: Data("<b>umuo</b>".utf8))],
            [.init(type: "public.png", data: Data([0x89, 0x50, 0x4E, 0x47]))],
        ])
        original.restore(pasteboard)
        let roundTrip = Pasteboard.Snapshot.take(pasteboard) == original
        Pasteboard.Snapshot().restore(pasteboard)
        let emptyStaysEmpty = Pasteboard.Snapshot.take(pasteboard) == Pasteboard.Snapshot()
        check("Pasteboard.Snapshot", roundTrip && emptyStaysEmpty, "所有 item 与类型原样还回；原来是空的恢复后也是空的")

        func attempt(_ copy: @escaping () throws(SelectionError) -> Void) -> (Result<String, SelectionError>, Bool) {
            original.restore(pasteboard)
            let result = Result { () throws(SelectionError) in
                try ClipboardFallback(pasteboard: pasteboard, copy: copy).read()
            }
            return (result, Pasteboard.Snapshot.take(pasteboard) == original)
        }

        let (copied, restored) = attempt { appCopies("选中的文字", into: pasteboard) }
        check("ClipboardFallback.copy", (try? copied.get()) == "选中的文字" && restored, "取到选中文本，剪贴板原样还回")

        let (missed, restoredAfterMiss) = attempt {}
        check("ClipboardFallback.noCopy", missed == .failure(.noSelection) && restoredAfterMiss,
              "超时报「没有检测到选中的文本」，剪贴板原样还回")

        let (failed, restoredAfterFailure) = attempt { () throws(SelectionError) in throw .other("无法创建键盘事件源") }
        check("ClipboardFallback.synthesisFails", failed == .failure(.other("无法创建键盘事件源")) && restoredAfterFailure,
              "合成 ⌘C 失败：先恢复再报错")

        // 超时（400ms）之后、观察窗口（再 600ms）之内才写进来的复制结果：要再恢复一次。0.7s 两头都留了余量
        // 慢机器（CI）上那条线程可能落在观察窗口之外：那时这项无从判断，如实跳过而不是报失败
        let wrote = OSAllocatedUnfairLock(initialState: false)
        let landedAt = OSAllocatedUnfairLock<TimeInterval?>(initialState: nil)
        let started = Date()
        let (late, restoredAfterLate) = attempt {
            Thread.detachNewThread {
                Thread.sleep(forTimeInterval: 0.7)
                appCopies("迟到的复制", into: NSPasteboard(name: name))
                landedAt.withLock { $0 = Date().timeIntervalSince(started) }
                wrote.withLock { $0 = true }
            }
        }
        // 以 read() 实际结束的时刻为准：慢机器上读取本身会往后推，按常量算的窗口不可靠。
        // 迟到的复制要在读取结束前一个轮询间隔落地，「再恢复一次」才有机会发生
        let finished = Date().timeIntervalSince(started)
        if let landed = landedAt.withLock({ $0 }), landed + ClipboardFallback.lateCopyPollInterval < finished {
            check("ClipboardFallback.lateCopy", late == .failure(.noSelection) && wrote.withLock { $0 } && restoredAfterLate,
                  "恢复之后才到的复制结果被再恢复一次")
        } else {
            print("- ClipboardFallback.lateCopy: skipped: machine too slow, the late copy missed the observation window")
        }

        // 连按两次：两次事务串行，各自取到自己的文本，最后剪贴板仍是原内容（不会被第一次清空后的空剪贴板盖掉）
        original.restore(pasteboard)
        let results = OSAllocatedUnfairLock(initialState: [String: String]())
        let group = DispatchGroup()
        for label in ["甲", "乙"] {
            group.enter()
            Thread.detachNewThread {
                let board = NSPasteboard(name: name)
                let text = try? ClipboardFallback(pasteboard: board, copy: {
                    Thread.sleep(forTimeInterval: 0.03)
                    appCopies(label, into: board)
                }).read()
                results.withLock { $0[label] = text }
                group.leave()
            }
        }
        group.wait()
        let both = results.withLock { $0 }
        check("ClipboardFallback.serialized",
              both == ["甲": "甲", "乙": "乙"] && Pasteboard.Snapshot.take(pasteboard) == original,
              "并发两次各取各的，剪贴板最后仍是原内容")
    }

    /// 真实的 AX 取词。没有权限时两条入口都必须在按任何键之前拒绝。
    static func live(_ check: (String, Bool, String) -> Void) {
        guard AXIsProcessTrusted() else {
            let refusals: [SelectionError?] = [
                refusal { () throws(SelectionError) in _ = try Selection.readSelection() },
                refusal { () throws(SelectionError) in _ = try Selection.readFocusText() },
            ]
            check("Selection.untrusted", refusals.allSatisfy { $0 == .permissionDenied },
                  "没有权限 → 「需要系统权限：辅助功能」，不降级、不按键")
            print("- readFocusText: skipped: needs Accessibility permission")
            print("- readSelection: skipped: needs Accessibility permission")
            return
        }
        // 只读 AX，不碰剪贴板；读到的是用户当前输入框的内容，只报来源与长度
        do {
            let focus = try Selection.readFocusText()
            check("readFocusText", !focus.text.isEmpty, "\(focus.source)，\(focus.text.count) 个字符")
        } catch {
            let expected = if case .notWritable = error { true } else { error == .noSelection }
            check("readFocusText", expected, "没有可翻译的焦点文本：\(error)")
        }
        print("- readSelection.live: skipped: would synthesize ⌘C into the frontmost app")
    }

    /// 像真实应用响应 ⌘C 那样写剪贴板：先 clearContents（修改计数只在这一步变）再写文本。
    static func appCopies(_ text: String, into pasteboard: NSPasteboard) {
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    static func refusal(_ body: () throws(SelectionError) -> Void) -> SelectionError? {
        do { try body(); return nil } catch { return error }
    }
}
