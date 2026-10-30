import SwiftUI

/// 设置 · 许可证：授权状态（试用剩余天数 / 已激活 / 已失效）、输入密钥激活、已激活设备与解绑、购买链接。
/// 密钥只显示末 4 位（与 API Key 一样不从界面读回明文）。
struct LicensePage: View {
    let model: SettingsModel
    @Bindable var license: LicenseManager

    private var t: Translate { model.t }

    var body: some View {
        Group {
            PrefGroup(title: t("prefs.license.status")) {
                PrefRow(title: statusTitle, description: statusDescription, note: license.maskedKey) {
                    if license.busy { ProgressView().controlSize(.small) }
                    statusActions
                }
                if let notice = license.notice { noticeRow(notice) }
            }

            if let pending = license.pending {
                PrefGroup(title: t("prefs.license.devices", ["count": "\(pending.devices.count)",
                                                           "max": "\(pending.maxDevices)"])) {
                    ForEach(pending.devices) { device in deviceRow(device, isThisMac: false) }
                    HStack {
                        Spacer(minLength: 0)
                        PrefButton(title: t("common.cancel"), disabled: license.busy) { license.cancelPending() }
                    }
                }
            } else if showsDevices {
                PrefGroup(title: t("prefs.license.devices", ["count": "\(license.devices.count)",
                                                           "max": "\(license.maxDevices)"])) {
                    ForEach(license.devices) { device in deviceRow(device, isThisMac: device.deviceId == license.deviceId) }
                }
            }

            if needsKeyEntry {
                PrefGroup(title: t("prefs.license.enter")) {
                    PrefRow(title: t("prefs.license.key")) {
                        TextField(t("prefs.license.key"), text: $license.keyDraft,
                                  prompt: Text(t("prefs.license.keyPlaceholder")))
                            .labelsHidden()
                            .frame(width: 240)
                            .onSubmit { Task { await license.activate() } }
                        PrefButton(title: t("prefs.license.activate"), prominent: true,
                                   disabled: license.busy || license.keyDraft.trimmingCharacters(in: .whitespaces).isEmpty) {
                            Task { await license.activate() }
                        }
                    }
                }
            }

            if !isActive {
                PrefGroup(title: t("prefs.license.purchase")) {
                    PrefRow(title: t("prefs.license.buy"), description: t("prefs.license.buyHint")) {
                        Button("umuo.app/pricing") { model.backend.openURL(LicenseManager.purchaseURL) }
                            .buttonStyle(.link)
                    }
                }
            }
        }
    }

    // MARK: - 状态

    private var isActive: Bool {
        if case .active = license.state { true } else { false }
    }

    /// 有许可证（含需要验证、已失效）时就不再要求输入；失效了可以输入一个新的。
    private var needsKeyEntry: Bool {
        guard license.pending == nil else { return false }
        switch license.state {
        case .active, .needsVerification: return false
        default: return true
        }
    }

    private var showsDevices: Bool {
        switch license.state {
        case .active, .needsVerification: !license.devices.isEmpty
        default: false
        }
    }

    private var statusTitle: String {
        switch license.state {
        case .unavailable: t("prefs.license.unavailable")
        case let .trial(days): t("prefs.license.trial", ["days": "\(days)"])
        case .trialExpired: t("prefs.license.trialExpired")
        case .active: t("prefs.license.active")
        case .needsVerification: t("prefs.license.needsVerify")
        case .invalid(.revoked): t("prefs.license.revoked")
        case .invalid(.notActivated): t("prefs.license.notActivated")
        case .invalid: t("prefs.license.invalid")
        }
    }

    private var statusDescription: String? {
        switch license.state {
        case .trial, .trialExpired, .unavailable: t("prefs.license.trialHint")
        case let .active(date): t("prefs.license.lastVerified", ["date": format(date)])
        case .needsVerification: t("prefs.license.needsVerifyHint")
        case .invalid: t("prefs.license.invalidHint")
        }
    }

    @ViewBuilder private var statusActions: some View {
        switch license.state {
        case .active:
            PrefButton(title: t("prefs.license.verifyNow"), disabled: license.busy) {
                Task { await license.verifyIfDue(force: true) }
            }
        case .needsVerification:
            PrefButton(title: t("prefs.license.verifyNow"), prominent: true, disabled: license.busy) {
                Task { await license.verifyIfDue(force: true) }
            }
        case .invalid:
            PrefButton(title: t("prefs.license.reactivate"), disabled: license.busy) {
                Task { await license.reactivate() }
            }
            PrefButton(title: t("prefs.license.remove"), danger: true, disabled: license.busy) { license.removeLicense() }
        default:
            EmptyView()
        }
    }

    private func noticeRow(_ notice: LicenseManager.Notice) -> some View {
        let (text, failed): (String, Bool) = switch notice {
        case .activated: (t("prefs.license.activated"), false)
        case .deactivated: (t("prefs.license.deactivated"), false)
        case .verified: (t("prefs.license.verified"), false)
        case .invalidLicense: (t("prefs.license.errorInvalid"), true)
        case .revoked: (t("prefs.license.errorRevoked"), true)
        case let .deviceLimit(max): (t("prefs.license.deviceLimit", ["max": "\(max)"]), true)
        case let .network(reason): (t("prefs.license.errorNetwork", ["reason": reason]), true)
        case let .keychain(reason): (t("prefs.license.errorKeychain", ["reason": reason]), true)
        }
        return Label(text, systemImage: failed ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
            .foregroundStyle(failed ? Color.red : Color.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    // MARK: - 设备

    private func deviceRow(_ device: LicenseDevice, isThisMac: Bool) -> some View {
        let name = device.deviceName.isEmpty ? device.deviceId : device.deviceName
        return PrefRow(title: isThisMac ? t("prefs.license.thisMac", ["name": name]) : name,
                       note: device.activatedAt.map { t("prefs.license.activatedAt", ["date": format($0)]) }) {
            PrefButton(title: t(isThisMac ? "prefs.license.unbindThis" : "prefs.license.unbind"),
                       danger: isThisMac, disabled: license.busy) {
                Task {
                    let question = isThisMac ? t("prefs.license.unbindThisConfirm")
                        : t("prefs.license.unbindConfirm", ["name": name])
                    guard await PrefConfirm.ask(question, confirm: t("prefs.license.unbind"),
                                                cancel: t("common.cancel")) else { return }
                    await license.deactivate(device.deviceId)
                }
            }
        }
    }

    private func format(_ date: Date) -> String {
        date.formatted(.dateTime.year().month().day().locale(Locale(identifier: t.locale.rawValue)))
    }
}
