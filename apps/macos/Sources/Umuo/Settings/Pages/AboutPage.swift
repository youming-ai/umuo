import AppKit
import SwiftUI

/// 关于：版本、Sparkle 更新与外链。
struct AboutPage: View {
    let model: SettingsModel
    let updater: AppUpdater?

    static let siteURL = "https://umuo.app"
    static let feedbackURL = "mailto:hello@umuo.app"

    var body: some View {
        let t = model.t
        Group {
            Section {
                VStack(spacing: 4) {
                    Image(nsImage: NSApplication.shared.applicationIconImage).resizable().frame(width: 64, height: 64)
                        .accessibilityHidden(true)
                    Text("umuo").font(.title3.weight(.semibold)).foregroundStyle(Color.primary)
                    Text(t("prefs.about.version", ["version": model.backend.appVersion ?? t("prefs.about.versionUnknown")]))
                        .font(.callout).foregroundStyle(Color.secondary).textSelection(.enabled)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }

            PrefGroup(title: t("prefs.about.updates")) {
                PrefRow(
                    title: t("prefs.about.checkUpdates"),
                    description: t("prefs.about.checkUpdatesHint"),
                    note: updater?.isConfigured == true ? nil : t("prefs.about.checkUpdatesUnavailable")
                ) {
                    Button(t("prefs.about.checkUpdates")) { updater?.checkForUpdates() }
                        .disabled(updater?.canCheckForUpdates != true)
                }
            }

            PrefGroup(title: t("prefs.about.links")) {
                PrefRow(title: t("prefs.about.feedback"), description: t("prefs.about.feedbackHint")) {
                    LinkRowButton(label: t("prefs.about.feedback"), external: true) {
                        model.backend.openURL(Self.feedbackURL)
                    }
                }
                PrefRow(title: t("prefs.about.website")) {
                    LinkRowButton(label: t("prefs.about.website"), external: true) {
                        model.backend.openURL(Self.siteURL)
                    }
                }
            }

            PrefGroup(title: t("prefs.about.data")) {
                PrefRow(title: t("prefs.about.dataLocal"), note: t("prefs.about.dataLocalHint"))
            }
        }
    }
}
