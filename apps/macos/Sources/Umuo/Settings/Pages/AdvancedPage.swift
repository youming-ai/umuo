import SwiftUI

/// 高级：网络代理、历史与隐私。
struct AdvancedPage: View {
    let model: SettingsModel

    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }
    private var advanced: AdvancedEditor { model.advanced }

    var body: some View {
        Group {
            PrefGroup(title: t("prefs.advanced.network")) {
                PrefRow(title: t("prefs.advanced.proxy"), description: t("prefs.advanced.proxyHint")) {
                    PrefPicker(label: t("prefs.advanced.proxy"), value: advanced.proxyMode, options: [
                        ("system", t("prefs.followSystem")),
                        ("none", t("prefs.advanced.proxyNone")),
                        ("custom", t("prefs.advanced.proxyCustom")),
                    ]) { advanced.selectProxy($0) }
                }
                if advanced.proxyMode == "custom" {
                    PrefRow(title: t("prefs.advanced.proxyUrl"), description: t("prefs.advanced.proxyUrlHint"),
                            error: advanced.proxyError) {
                        DraftField(value: s.string("proxyUrl"), placeholder: "socks5://127.0.0.1:1080", width: 220) { url in
                            advanced.proxyError = nil
                            let pending = advanced.commitProxyUrl(url)
                            return Task {
                                do { try await pending.value } catch {
                                    advanced.proxyError = SettingsRules.message(error)
                                    throw error
                                }
                            }
                        }
                    }
                }
            }

            PrefGroup(title: t("prefs.advanced.history")) {
                PrefRow(title: t("prefs.advanced.historyEnabled"), description: t("prefs.advanced.historyEnabledHint")) {
                    toggle("historyEnabled", t("prefs.advanced.historyEnabled"), fallback: true)
                }
                PrefRow(title: t("prefs.advanced.privacy"), description: t("prefs.advanced.privacyHint")) {
                    toggle("privacyMode", t("prefs.advanced.privacy"), fallback: false)
                }
                PrefRow(title: t("prefs.advanced.retention"), description: t("prefs.advanced.retentionHint"),
                        error: advanced.retentionError) {
                    DraftField(value: SettingsRules.format(s.number("historyRetentionDays")), width: 72) {
                        advanced.commitRetention($0)
                    }
                }
                PrefRow(title: t("prefs.advanced.openHistory")) {
                    LinkRowButton(label: t("prefs.advanced.openHistory")) { model.backend.openHistory() }
                }
            }
        }
    }

    private func toggle(_ key: String, _ label: String, fallback: Bool) -> some View {
        Toggle(label, isOn: Binding(get: { s.bool(key, fallback) }, set: { model.commit([key: .bool($0)]) }))
            .toggleStyle(.switch).labelsHidden()
    }
}
