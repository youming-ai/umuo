import AppKit
import SwiftUI

/// 通用：主题、语言、缩放、开机启动、引导、菜单栏图标、配置导入导出（`GeneralPage.tsx`）。
struct GeneralPage: View {
    let model: SettingsModel

    private var p: Palette { model.palette }
    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }
    private var general: GeneralEditor { model.general }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            PrefGroup(palette: p) {
                PrefRow(title: t("prefs.general.theme"), description: t("prefs.general.themeHint"), palette: p) {
                    PrefPicker(label: t("prefs.general.theme"), value: s.string("theme", "system"),
                               options: ThemeChoice.allCases.map { ($0.rawValue, t($0.titleKey)) }) {
                        model.commit(["theme": .string($0)])
                    }
                }
            }

            PrefGroup(palette: p) {
                PrefRow(title: t("prefs.general.targetLang"), description: t("prefs.general.targetLangHint"), palette: p) {
                    LanguagePicker(label: t("prefs.general.targetLang"), value: s.string("targetLang")) {
                        model.commit(["targetLang": .string($0)])
                    }
                }
                PrefRow(title: t("prefs.general.nativeLang"), description: t("prefs.general.nativeLangHint"), palette: p) {
                    PrefPicker(label: t("prefs.general.nativeLang"), value: s.string("nativeLang"),
                               options: [("", t("prefs.general.nativeLangUnset"))] + Languages.all.map { ($0.code, $0.label) }) {
                        model.commit(["nativeLang": .string($0)])
                    }
                }
                PrefRow(title: t("prefs.general.uiLang"), description: t("prefs.general.uiLangHint"), palette: p) {
                    // 语言名用该语言自己写（通行做法）；只有「跟随系统」跟着界面语言走。
                    PrefPicker(label: t("prefs.general.uiLang"), value: s.string("locale", "system"),
                               options: Languages.uiLocales.map { ($0.value, $0.value == "system" ? t("prefs.followSystem") : $0.label) }) {
                        model.commit(["locale": .string($0)])
                    }
                }
                PrefRow(title: t("prefs.general.scale"), description: t("prefs.general.scaleHint"), palette: p) {
                    PrefPicker(label: t("prefs.general.scale"), value: s.number("uiScale", 1),
                               options: [0.85, 1, 1.25, 1.5].map { ($0, "\(Int(($0 * 100).rounded()))%") }) {
                        model.commit(["uiScale": .number($0)])
                    }
                }
            }

            PrefGroup(palette: p) {
                PrefRow(title: t("prefs.general.autostart"), description: t("prefs.general.autostartHint"),
                        error: general.autostartError, palette: p) {
                    Toggle(t("prefs.general.autostart"), isOn: Binding(
                        get: { model.autostart ?? s.bool("launchAtLogin") },
                        set: { enabled in Task { await model.setAutostart(enabled) } }
                    ))
                    .toggleStyle(.switch).labelsHidden()
                }
                PrefRow(title: t("prefs.general.onboarding"), description: t("prefs.general.onboardingHint"), palette: p) {
                    LinkRowButton(label: t("prefs.general.onboarding"), palette: p) { model.backend.openOnboarding() }
                }
                PrefRow(title: t("prefs.general.trayIcon"), description: t("prefs.general.trayIconHint"), palette: p) {
                    PrefPicker(label: t("prefs.general.trayIcon"), value: s.string("trayIconStyle", "template"), options: [
                        ("template", t("prefs.general.trayTemplate")),
                        ("brand", t("prefs.general.trayBrand")),
                        ("black", t("prefs.general.trayBlack")),
                    ]) { model.commit(["trayIconStyle": .string($0)]) }
                }
            }

            PrefGroup(title: t("prefs.general.configTitle"), palette: p) {
                PrefRow(title: t("prefs.general.export"), description: t("prefs.general.exportHint"), palette: p) {
                    PrefButton(title: t("prefs.general.exportAction"), palette: p) {
                        Task { await general.exportConfig() }
                    }
                }
                PrefRow(title: t("prefs.general.import"), description: general.configNotice ?? t("prefs.general.importHint"),
                        palette: p) {
                    TextField(t("prefs.general.importPath"), text: Binding(get: { general.configPath },
                                                                          set: { general.configPath = $0 }))
                        .textFieldStyle(.roundedBorder).frame(width: 180)
                        .accessibilityLabel(t("prefs.general.importPath"))
                    PrefButton(title: t("prefs.general.importChoose"), palette: p) { chooseFile() }
                    PrefButton(title: t("prefs.general.importAction"), disabled: !general.canImport, palette: p) {
                        Task { await general.importConfig() }
                    }
                }
            }
        }
    }

    /// 选一个导出过的配置文件（Tauri 版只有路径输入框；这里多一个选择按钮，路径照样能手填）。
    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { general.configPath = url.path }
    }
}

/// 语言下拉（设置页与首次引导共用同一份语言表，见 `Languages`）。
struct LanguagePicker: View {
    let label: String
    let value: String
    let onChange: (String) -> Void

    var body: some View {
        PrefPicker(label: label, value: value, options: Languages.all.map { ($0.code, $0.label) }, onChange: onChange)
    }
}
