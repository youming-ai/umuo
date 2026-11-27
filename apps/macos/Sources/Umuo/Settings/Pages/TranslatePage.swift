import SwiftUI
import UmuoCore

/// 翻译入口的快捷键、引擎与语言规则。
struct TranslatePage: View {
    let model: SettingsModel

    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }

    var body: some View {
        Group {
            // 四个入口的快捷键放在同一组：一眼看全、冲突也好查（同 TablePro 的键盘设置页）；语音键紧随其后，一起查冲突
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

            // 语音的两个「按住说话」键：整理与翻译各一个，按下时就定了这一句做什么（PRD §5.11）
            PrefGroup(title: t("prefs.voice.group")) {
                HotkeyRow(model: model, field: HotkeyCenter.voiceField, description: t("prefs.voice.tidyHint"),
                          title: t("prefs.voice.tidy"))
                HotkeyRow(model: model, field: HotkeyCenter.voiceTranslateField,
                          description: t("prefs.voice.translateHint"), title: t("prefs.voice.translate"))
                PrefRow(title: t("prefs.voice.microphone"), description: t("prefs.voice.microphoneHint")) {
                    PrefPicker(label: t("prefs.voice.microphone"), value: s.string("voiceInputDevice"),
                               options: microphoneOptions) {
                        model.commit(["voiceInputDevice": .string($0)])
                    }
                }
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

    /// 「跟随系统」+ 当前连着的麦克风；选过但现在没连的那个也列出来，免得选择框显示空白。
    // shortcut: 列表在页面渲染时读一次，插拔耳机后要重开设置页才刷新；需要时再监听设备变更通知。
    private var microphoneOptions: [(String, String)] {
        let devices = Microphones.list()
        let saved = s.string("voiceInputDevice")
        var options = [("", t("prefs.followSystem"))] + devices.map { ($0.uid, $0.name) }
        if !saved.isEmpty, !devices.contains(where: { $0.uid == saved }) {
            options.append((saved, t("prefs.voice.microphoneMissing")))
        }
        return options
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
        let title = title ?? t("prefs.translate.hotkey")
        PrefRow(title: title, description: description, error: model.hotkeys.message(field)) {
            HotkeyRecorderButton(model: model, editor: model.hotkeys, field: field, title: title)
        }
    }
}

/// 录快捷键：点一下进入录制，按下新的组合就保存。按键事件由设置窗的本地监听交给
/// `HotkeyEditor`（`SettingsWindowController`），这里只画状态。
struct HotkeyRecorderButton: View {
    let model: SettingsModel
    let editor: HotkeyEditor
    let field: String
    /// 行名：清空按钮的提示与 VoiceOver 标签带上它，各行的清空按钮才分得清
    let title: String

    var body: some View {
        let t = model.t
        let recording = editor.recording == field
        let value = model.values.string(field)
        let parts = HotkeyFormat.parts(value, rightLabel: t("prefs.hotkey.right"))
        let label = recording ? t("prefs.hotkey.recordingShort") : parts.isEmpty ? t("prefs.hotkey.unset") : parts.joined(separator: " ")
        VStack(alignment: .trailing, spacing: 4) {
            HStack(spacing: 6) {
                let button = Button {
                    editor.toggle(field)
                    // 开始录制时收走文字焦点：否则停在文本框里的焦点会让第一个按键就结束录制（`yieldsToText`）
                    if editor.recording == field { NSApp.keyWindow?.makeFirstResponder(nil) }
                } label: {
                    Text(label).monospacedDigit().lineLimit(1).frame(width: 120)
                }
                // 固定宽度的录键框；录制中用强调样式，与系统录键控件一致
                Group {
                    if recording { button.buttonStyle(.borderedProminent) } else { button.buttonStyle(.bordered) }
                }
                // 只读键位的话六行分不清是哪个功能：名字是行名，值是键位
                .accessibilityLabel(title)
                .accessibilityValue(label)
                .accessibilityAddTraits(recording ? .isSelected : [])
                // 清空：有值且不在录这一行时才出现。不出现时仍占着位置（`hidden` 不响应点击、也不给 VoiceOver 读），
                // 各行的录键框才对得齐
                let clear = Button { editor.clear(field) } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .help(t("prefs.hotkey.clear", ["name": title]))
                .accessibilityLabel(t("prefs.hotkey.clear", ["name": title]))
                if recording || HotkeyCenter.isCleared(value) { clear.hidden() } else { clear }
            }
            // 录制中的完整说明放在按钮下：120pt 的按钮放不下整句（四种语言都会被截断）。
            // 冲突提示用多色警告符号表达状态，文字保持次要色，浅色模式下橙色小字对比度不够
            if recording {
                Group {
                    if let notice = editor.notice {
                        Label(notice, systemImage: "exclamationmark.triangle.fill").symbolRenderingMode(.multicolor)
                    } else {
                        Text(t("prefs.hotkey.recording"))
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 260, alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// 语言规则：目标语言模式（按 App 记住）、第二目标语言、取词黑名单。
/// 记住的应用单独成组，一个应用一行，右边是「忘记」。
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
        if s.string("targetLangMode") == "perApp" {
            PrefGroup(title: t("prefs.translate.targetPerApp")) {
                if remembered.isEmpty {
                    Text(t("prefs.translate.rememberedEmpty")).foregroundStyle(Color.secondary)
                }
                ForEach(remembered, id: \.key) { app, code in
                    LabeledContent(app) {
                        HStack(spacing: 8) {
                            Text(Languages.label(code.stringValue ?? ""))
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
}
