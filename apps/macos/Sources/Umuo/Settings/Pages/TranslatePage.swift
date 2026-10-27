import SwiftUI
import UmuoCore

/// 翻译入口的快捷键、引擎与语言规则。
struct TranslatePage: View {
    let model: SettingsModel

    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }

    var body: some View {
        Group {
            // 四个入口的快捷键放在同一组：一眼看全、冲突也好查（同 TablePro 的键盘设置页）
            PrefGroup(title: t("prefs.translate.hotkey")) {
                HotkeyRow(model: model, field: "selectionHotkey", description: t("prefs.translate.selectionHint"),
                          title: t("prefs.translate.selection"))
                HotkeyRow(model: model, field: "silentReplaceHotkey", description: t("prefs.translate.silentHint"),
                          title: t("prefs.translate.silent"))
                HotkeyRow(model: model, field: "composeHotkey", description: t("prefs.translate.composeHint"),
                          title: t("prefs.translate.compose"))
                HotkeyRow(model: model, field: "ocrHotkey", description: t("prefs.translate.ocrHint"),
                          title: t("prefs.translate.ocr"))
            }

            PrefGroup(title: t("prefs.translate.engine")) {
                PrefRow(title: t("prefs.translate.engine"), note: engineLine) {
                    Button(t("prefs.translate.engineManage")) { model.tab = .engine }
                }
                PrefRow(title: t("prefs.translate.ocrEngine"), note: t("prefs.translate.ocrEngineHint"))
            }

            LanguageRules(model: model)
        }
    }

    private var engineLine: String {
        guard let provider = model.provider else { return t("prefs.translate.engineUnset") }
        let modelName = s.string("model")
        return "\(provider.label) · \(modelName.isEmpty ? provider.defaultModel : modelName)"
    }
}

/// 一行快捷键：录键器 + 行下的错误 / 注册失败 / 冲突提醒（`HotkeyRow`）。
struct HotkeyRow: View {
    let model: SettingsModel
    let field: String
    let description: String
    var title: String?

    var body: some View {
        let t = model.t
        PrefRow(title: title ?? t("prefs.translate.hotkey"), description: description,
                error: model.hotkeys.message(field)) {
            HotkeyRecorderButton(model: model, editor: model.hotkeys, field: field)
        }
    }
}

/// 录快捷键：点一下进入录制，按下新的组合就保存（`HotkeyRecorder.tsx`）。按键事件由设置窗的本地监听交给
/// `HotkeyEditor`（`SettingsWindowController`），这里只画状态。
struct HotkeyRecorderButton: View {
    let model: SettingsModel
    let editor: HotkeyEditor
    let field: String

    var body: some View {
        let t = model.t
        let recording = editor.recording == field
        let parts = HotkeyFormat.parts(model.values.string(field), rightLabel: t("prefs.hotkey.right"))
        let label = recording ? t("prefs.hotkey.recording") : parts.isEmpty ? t("prefs.hotkey.unset") : parts.joined(separator: " ")
        VStack(alignment: .trailing, spacing: 4) {
            let button = Button { editor.toggle(field) } label: {
                Text(label).monospacedDigit().lineLimit(1).frame(width: 120)
            }
            // 固定宽度的录键框；录制中用强调样式，与系统录键控件一致
            Group {
                if recording { button.buttonStyle(.borderedProminent) } else { button.buttonStyle(.bordered) }
            }
            .accessibilityAddTraits(recording ? .isSelected : [])
            if recording, let notice = editor.notice {
                Text(notice).font(.caption).foregroundStyle(.orange)
            }
        }
    }
}

/// 语言规则：目标语言模式（按 App 记住）、第二目标语言、取词黑名单。
struct LanguageRules: View {
    let model: SettingsModel

    var body: some View {
        let t = model.t
        let s = model.values
        let remembered = s.object("appTargetLangs").sorted { $0.key < $1.key }
        PrefGroup(title: t("prefs.translate.rules")) {
            PrefRow(title: t("prefs.translate.targetMode"), description: t("prefs.translate.targetModeHint")) {
                PrefPicker(label: t("prefs.translate.targetMode"), value: s.string("targetLangMode", "fixed"), options: [
                    ("fixed", t("prefs.translate.targetFixed")), ("perApp", t("prefs.translate.targetPerApp")),
                ]) { model.commit(["targetLangMode": .string($0)]) }
            } extra: {
                if s.string("targetLangMode") == "perApp" {
                    if remembered.isEmpty {
                        Text(t("prefs.translate.rememberedEmpty")).font(.callout).foregroundStyle(Color.secondary)
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(remembered, id: \.key) { app, code in
                                HStack {
                                    Text("\(app) → \(Languages.label(code.stringValue ?? ""))").font(.callout)
                                        .foregroundStyle(Color.secondary).lineLimit(1).truncationMode(.tail)
                                    Spacer(minLength: 0)
                                    PrefButton(title: t("prefs.translate.forget")) {
                                        var next = s.object("appTargetLangs")
                                        next[app] = nil
                                        model.commit(["appTargetLangs": .object(next)])
                                    }
                                }
                            }
                        }
                    }
                }
            }
            PrefRow(title: t("prefs.translate.secondaryLang"), description: t("prefs.translate.secondaryLangHint")) {
                LanguagePicker(label: t("prefs.translate.secondaryLang"), value: s.string("secondaryTargetLang")) {
                    model.commit(["secondaryTargetLang": .string($0)])
                }
            }
            PrefBlock(title: t("prefs.translate.blacklist"), description: t("prefs.translate.blacklistHint"),
                      error: model.rowErrors["selectionBlacklist"]) {
                DraftField(value: s.strings("selectionBlacklist").joined(separator: "\n"), multiline: true,
                           label: t("prefs.translate.blacklist")) { text in
                    model.commitRow("selectionBlacklist",
                                    ["selectionBlacklist": .array(SettingsRules.blacklist(text).map(JSONValue.string))])
                }
            }
        }
    }
}
