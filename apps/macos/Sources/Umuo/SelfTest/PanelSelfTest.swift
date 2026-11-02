import AppKit
import ApplicationServices
import UmuoCore

/// `--selftest` 的浮窗部分：「替换原文」的 ⌘V 兜底与权限拒绝、浮窗的纯规则导出。
///
/// **不碰用户的剪贴板、不往用户的应用里按键**：兜底整段跑在私有命名剪贴板上，「按 ⌘V」换成假的；
/// 真正的写回要辅助功能权限，没授权时断言权限拒绝，授权了也不在用户正聚焦的输入框里试写，打印跳过。
/// 窗口本身（NSPanel 的显示、拖动、缩放、看门狗）不在这里跑：要真机看。
enum PanelSelfTest {
    @MainActor
    static func run(_ check: (String, Bool, String) -> Void) {
        pasteFallback(check)
        replacePermission(check)
        rules(check)
    }

    static func pasteFallback(_ check: (String, Bool, String) -> Void) {
        let name = NSPasteboard.Name("app.umuo.desktop.selftest.\(UUID().uuidString)")
        let pasteboard = NSPasteboard(name: name)
        defer { pasteboard.releaseGlobally() }
        pasteboard.clearContents()
        pasteboard.setString("用户原来的内容", forType: .string)

        // 粘贴的那一刻：剪贴板上已是译文，且互斥锁还拿在手里（取词降级插不进来）
        var seen: String?
        var lockedDuringPaste = false
        do {
            try ReplaceSelection.pasteFallback("译文", paster: ControlledPaste(pasteboard: pasteboard, paste: {
                seen = Pasteboard.string(pasteboard)
                lockedDuringPaste = !Pasteboard.exclusive.try()
                if !lockedDuringPaste { Pasteboard.exclusive.unlock() }
            }, restoreDelay: 0))
        } catch {
            check("ReplaceSelection.pasteFallback", false, error.description)
            return
        }
        // 粘完恢复用户原来的剪贴板（期间没人动过）
        let kept = Pasteboard.string(pasteboard) == "用户原来的内容"
        let released = Pasteboard.exclusive.try()
        if released { Pasteboard.exclusive.unlock() }
        check("ReplaceSelection.pasteFallback", seen == "译文" && lockedDuringPaste && kept && released,
              "写入与 ⌘V 在同一次独占里、结束后释放并恢复原内容（私有剪贴板，假的 ⌘V）")

        var failure = ""
        do {
            try ReplaceSelection.pasteFallback("译文", paster: ControlledPaste(pasteboard: pasteboard, paste: {
                () throws(SelectionError) in throw .other(UserText("error.keyEventFailed"))
            }, restoreDelay: 0))
        } catch { failure = error.text.key }
        check("ReplaceSelection.pasteFallback.error", failure == "error.keyEventFailed", "合成按键失败如实上报：\(failure)")
    }

    static func replacePermission(_ check: (String, Bool, String) -> Void) {
        guard !AXIsProcessTrusted() else {
            print("- ReplaceSelection.replace: skipped: has Accessibility permission, would write into the focused app")
            return
        }
        var detail = ""
        do { try ReplaceSelection.replace("译文") } catch { detail = error.text.key }
        check("ReplaceSelection.replace", detail == "error.accessibilityRequired", "没有辅助功能权限时拒绝：\(detail)")
        // 不知道源应用（没权限时 pid 也取不到）：直接拒绝，不碰写入
        let refused = PanelController.replaceSource("译文", owner: nil, t: Translate(locale: .zhCN))
        check("PanelController.replaceSource", refused == Translate(locale: .zhCN)("panel.replaceUnknownSource"),
              refused ?? "nil")
    }

    static func rules(_ check: (String, Bool, String) -> Void) {
        let own = PanelController.ownToken
        let hide = shouldAutoHide(pinned: false, owner: "1", current: "2", own: own)
            && !shouldAutoHide(pinned: true, owner: "1", current: "2", own: own)
            && !shouldAutoHide(pinned: false, owner: "1", current: own, own: own)
            && !shouldAutoHide(pinned: false, owner: "1", current: nil, own: own)
        check("shouldAutoHide", hide, "切走才收起；钉住、前台是自己、读不到标识都不收起")
        let plan = planReplace(owner: own, current: "1", own: own) == .noSource
            && planReplace(owner: "1", current: own, own: own) == .refocus
            && planReplace(owner: "1", current: "1", own: own) == .write
            && planReplace(owner: nil, current: "1", own: own) == .unknownSource
            && replaceTargetError(owner: "1", current: "2") == "目标应用已切换，已放弃替换原文"
        check("planReplace", plan, "没有源应用 / 不知道源应用 / 先切回源应用 / 交给守卫")
    }
}
