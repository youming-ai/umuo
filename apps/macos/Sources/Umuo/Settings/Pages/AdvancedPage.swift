import SwiftUI

/// 高级：网络代理、用量与月度上限、历史与隐私（`AdvancedPage.tsx`）。
struct AdvancedPage: View {
    let model: SettingsModel

    private var p: Palette { model.palette }
    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }
    private var advanced: AdvancedEditor { model.advanced }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            PrefGroup(title: t("prefs.advanced.network"), palette: p) {
                PrefRow(title: t("prefs.advanced.proxy"), description: t("prefs.advanced.proxyHint"), palette: p) {
                    PrefPicker(label: t("prefs.advanced.proxy"), value: advanced.proxyMode, options: [
                        ("system", t("prefs.followSystem")),
                        ("none", t("prefs.advanced.proxyNone")),
                        ("custom", t("prefs.advanced.proxyCustom")),
                    ]) { advanced.selectProxy($0) }
                }
                if advanced.proxyMode == "custom" {
                    PrefRow(title: t("prefs.advanced.proxyUrl"), description: t("prefs.advanced.proxyUrlHint"),
                            error: advanced.proxyError, palette: p) {
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

            PrefGroup(title: t("prefs.advanced.usage"), palette: p) {
                PrefRow(title: t("prefs.advanced.usageThisMonth"), description: SettingsRules.usageLine(model.usage, t),
                        palette: p)
                PrefRow(title: t("prefs.advanced.limitAction"), description: t("prefs.advanced.limitActionHint"), palette: p) {
                    PrefPicker(label: t("prefs.advanced.limitAction"), value: s.string("limitAction", "warn"), options: [
                        ("warn", t("prefs.advanced.limitWarn")), ("failover", t("prefs.advanced.limitFailover")),
                    ]) { model.commit(["limitAction": .string($0)]) }
                }
                PrefBlock(title: t("prefs.advanced.limits"), description: t("prefs.advanced.limitsHint"),
                          error: advanced.limitError, palette: p) {
                    limits
                }
            }

            PrefGroup(title: t("prefs.advanced.history"), palette: p) {
                PrefRow(title: t("prefs.advanced.historyEnabled"), description: t("prefs.advanced.historyEnabledHint"),
                        palette: p) {
                    toggle("historyEnabled", t("prefs.advanced.historyEnabled"), fallback: true)
                }
                PrefRow(title: t("prefs.advanced.privacy"), description: t("prefs.advanced.privacyHint"), palette: p) {
                    toggle("privacyMode", t("prefs.advanced.privacy"), fallback: false)
                }
                PrefRow(title: t("prefs.advanced.retention"), description: t("prefs.advanced.retentionHint"),
                        error: advanced.retentionError, palette: p) {
                    DraftField(value: SettingsRules.format(s.number("historyRetentionDays")), width: 72) {
                        advanced.commitRetention($0)
                    }
                }
                PrefRow(title: t("prefs.advanced.openHistory"), palette: p) {
                    LinkRowButton(label: t("prefs.advanced.openHistory"), palette: p) { model.backend.openHistory() }
                }
            }
        }
    }

    private func toggle(_ key: String, _ label: String, fallback: Bool) -> some View {
        Toggle(label, isOn: Binding(get: { s.bool(key, fallback) }, set: { model.commit([key: .bool($0)]) }))
            .toggleStyle(.switch).labelsHidden()
    }

    private var limits: some View {
        let list = SettingsRules.limits(s.array("monthlyLimits"))
        let spends = model.spend.map { (providerId: $0.providerId, costUsd: $0.costUsd) }
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(model.providers, id: \.id) { provider in
                let limit = Limits.limit(list, for: provider.id)
                let spent = Limits.spend(spends, for: provider.id)
                let over = limit.map { spent >= $0 } ?? false
                HStack(spacing: 8) {
                    Text(provider.label).font(.system(size: 12)).foregroundStyle(p.textPrimary.color)
                        .frame(width: 112, alignment: .leading).lineLimit(1)
                    Text(Limits.summary(limit: limit, spentUsd: spent, t)).font(.system(size: 11))
                        .foregroundStyle((over ? p.warning : p.textTertiary).color)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    DraftField(value: limit.map(SettingsRules.format) ?? "", placeholder: t("prefs.advanced.unlimited"),
                               width: 96, label: t("prefs.advanced.limitFor", ["name": provider.label])) {
                        advanced.commitLimit(provider.id, $0)
                    }
                }
            }
        }
    }
}
