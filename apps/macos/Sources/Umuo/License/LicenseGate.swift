import AppKit

/// 翻译入口的授权门控：试用到期、且没有有效许可证时，四个翻译 / OCR 入口（`HotkeyAction`）不执行，
/// 改为弹出说明并提供「购买」「输入许可证」。设置、激活、历史、退出不走 `ActionRouter`，不受影响。
@MainActor
enum LicenseGate {
    /// 被拦下时让用户选什么。
    enum Choice: Equatable { case purchase, enterLicense, cancel }

    /// 拦下时说明的文案键：按此刻为什么不能用来选。
    static func messageKey(_ state: LicenseState) -> String {
        switch state {
        case .needsVerification: "license.blocked.needsVerify"
        case .invalid: "license.blocked.invalid"
        default: "license.blocked.trialExpired"
        }
    }

    /// 装到 `ActionRouter.gate` 上的判定：可用就放行；不可用就交给 `prompt`，返回 false。
    static func gate(_ license: LicenseManager, prompt: @escaping @MainActor (LicenseState) -> Void)
        -> @MainActor (HotkeyAction) -> Bool
    {
        { _ in
            license.refresh()
            guard !license.isEntitled else { return true }
            prompt(license.state)
            return false
        }
    }

    /// 系统警告框。菜单栏应用（`.accessory`）要先激活自己，否则警告框落在前台应用后面。
    static func ask(_ state: LicenseState, t: Translate) -> Choice {
        let alert = NSAlert()
        alert.messageText = t("license.blocked.title")
        alert.informativeText = t(messageKey(state))
        alert.alertStyle = .informational
        alert.addButton(withTitle: t("license.blocked.purchase"))
        alert.addButton(withTitle: t("license.blocked.enterLicense"))
        alert.addButton(withTitle: t("common.cancel")).keyEquivalent = "\u{1b}"
        NSApp.activate(ignoringOtherApps: true)
        switch alert.runModal() {
        case .alertFirstButtonReturn: return .purchase
        case .alertSecondButtonReturn: return .enterLicense
        default: return .cancel
        }
    }
}
