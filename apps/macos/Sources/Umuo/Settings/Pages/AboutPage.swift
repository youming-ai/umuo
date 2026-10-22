import AppKit
import SwiftUI

/// 关于：版本、更新、外链（`AboutPage.tsx`）。
///
/// 应用内更新要到阶段 5（打包与分发）才有：这里先放一个占位行，如实说「还没接上、去官网下」，
/// 而不是照搬 Tauri 版那句「菜单栏图标里会出现重启以更新」——SwiftUI 版的菜单栏里还没有它。
struct AboutPage: View {
    let model: SettingsModel

    static let siteURL = "https://umuo.app"
    static let feedbackURL = "mailto:hello@umuo.app"

    var body: some View {
        let p = model.palette
        let t = model.t
        VStack(alignment: .leading, spacing: 24) {
            VStack(spacing: 4) {
                Image(nsImage: NSApplication.shared.applicationIconImage).resizable().frame(width: 64, height: 64)
                    .accessibilityHidden(true)
                Text("umuo").font(.system(size: 16, weight: .semibold)).foregroundStyle(p.textPrimary.color)
                Text(t("prefs.about.version", ["version": model.backend.appVersion ?? t("prefs.about.versionUnknown")]))
                    .font(.system(size: 12)).foregroundStyle(p.textTertiary.color).textSelection(.enabled)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)

            PrefGroup(title: t("prefs.about.updates"), palette: p) {
                PrefRow(title: t("prefs.about.checkUpdates"), description: t("prefs.about.checkUpdatesPending"), palette: p) {
                    LinkRowButton(label: t("prefs.about.website"), external: true, palette: p) {
                        model.backend.openURL(Self.siteURL)
                    }
                }
            }

            PrefGroup(title: t("prefs.about.links"), palette: p) {
                PrefRow(title: t("prefs.about.feedback"), description: t("prefs.about.feedbackHint"), palette: p) {
                    LinkRowButton(label: t("prefs.about.feedback"), external: true, palette: p) {
                        model.backend.openURL(Self.feedbackURL)
                    }
                }
                PrefRow(title: t("prefs.about.website"), palette: p) {
                    LinkRowButton(label: t("prefs.about.website"), external: true, palette: p) {
                        model.backend.openURL(Self.siteURL)
                    }
                }
            }

            PrefGroup(title: t("prefs.about.data"), palette: p) {
                PrefRow(title: t("prefs.about.dataLocal"), description: t("prefs.about.dataLocalHint"), palette: p)
            }
        }
    }
}
