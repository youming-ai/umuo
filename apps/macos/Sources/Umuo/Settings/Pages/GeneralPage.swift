import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// 通用：外观、语言、开机启动、引导、菜单栏图标、配置导入导出。
struct GeneralPage: View {
    let model: SettingsModel

    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }
    private var general: GeneralEditor { model.general }

    var body: some View {
        Group {
            PrefGroup {
                PrefRow(title: t("prefs.general.theme"), description: t("prefs.general.themeHint")) {
                    PrefPicker(label: t("prefs.general.theme"), value: s.string("theme", "system"),
                               options: ThemeChoice.allCases.map { ($0.rawValue, t($0.titleKey)) }) {
                        model.commit(["theme": .string($0)])
                    }
                }
            }

            PrefGroup {
                PrefRow(title: t("prefs.general.targetLang"), description: t("prefs.general.targetLangHint")) {
                    LanguagePicker(label: t("prefs.general.targetLang"), value: s.string("targetLang")) {
                        model.commit(["targetLang": .string($0)])
                    }
                }
                PrefRow(title: t("prefs.general.nativeLang"), description: t("prefs.general.nativeLangHint")) {
                    PrefPicker(label: t("prefs.general.nativeLang"), value: s.string("nativeLang"),
                               options: [("", t("prefs.general.nativeLangUnset"))] + Languages.all.map { ($0.code, $0.label) }) {
                        model.commit(["nativeLang": .string($0)])
                    }
                }
                PrefRow(title: t("prefs.general.uiLang"), description: t("prefs.general.uiLangHint")) {
                    // 语言名用该语言自己写（通行做法）；只有「跟随系统」跟着界面语言走。
                    PrefPicker(label: t("prefs.general.uiLang"), value: s.string("locale", "system"),
                               options: Languages.uiLocales.map { ($0.value, $0.value == "system" ? t("prefs.followSystem") : $0.label) }) {
                        model.commit(["locale": .string($0)])
                    }
                }
            }

            PrefGroup {
                PrefRow(title: t("prefs.general.autostart"), description: t("prefs.general.autostartHint"),
                        error: general.autostartError) {
                    Toggle(t("prefs.general.autostart"), isOn: Binding(
                        get: { model.autostart ?? s.bool("launchAtLogin") },
                        set: { enabled in Task { await model.setAutostart(enabled) } }
                    ))
                    .toggleStyle(.switch).labelsHidden()
                }
                PrefRow(title: t("prefs.general.onboarding"), description: t("prefs.general.onboardingHint")) {
                    PrefButton(title: t("prefs.general.onboardingRun")) { model.backend.openOnboarding() }
                }
            }

            PrefGroup(title: t("prefs.general.configTitle")) {
                PrefRow(title: t("prefs.general.export"), description: t("prefs.general.exportHint"),
                        note: general.exportNotice) {
                    if let path = general.exportedPath {
                        PrefButton(title: t("prefs.general.reveal")) {
                            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                        }
                    }
                    PrefButton(title: t("prefs.general.exportAction")) {
                        Task { await general.exportConfig() }
                    }
                }
                PrefRow(title: t("prefs.general.import"), description: t("prefs.general.importHint"),
                        note: general.configNotice) {
                    PrefButton(title: t("prefs.general.importChoose")) { chooseAndImport() }
                }
            }
        }
    }

    /// 选一个导出过的配置文件：系统的打开面板，以表单附在设置窗上；选好后先预览、确认了才导入。
    private func chooseAndImport() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.json]
        let picked: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else { return }
            general.configPath = url.path
            Task { await general.importConfig() }
        }
        if let window = NSApp.keyWindow { panel.beginSheetModal(for: window, completionHandler: picked) } else {
            picked(panel.runModal())
        }
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
