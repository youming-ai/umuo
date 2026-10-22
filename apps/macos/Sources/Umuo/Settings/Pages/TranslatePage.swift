import SwiftUI
import UmuoCore

/// 翻译：各功能的快捷键与行为、语言规则、自建风格、术语表（`TranslatePage.tsx`）。
struct TranslatePage: View {
    let model: SettingsModel

    private var p: Palette { model.palette }
    private var t: Translate { model.t }
    private var s: SettingsValues { model.values }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text(t("prefs.translate.intro")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
                .padding(.horizontal, 4)

            PrefGroup(title: t("prefs.translate.selection"), palette: p) {
                HotkeyRow(model: model, field: "selectionHotkey", description: t("prefs.translate.selectionHint"))
                PrefRow(title: t("prefs.translate.engine"), description: engineLine, palette: p) {
                    LinkRowButton(label: t("prefs.translate.engineManage"), palette: p) { model.tab = .engine }
                }
                PrefRow(title: t("prefs.translate.style"), description: t("prefs.translate.styleHint"), palette: p) {
                    PrefPicker(label: t("prefs.translate.style"), value: s.string("styleId"), options: model.styles.map {
                        ($0.id, $0.custom ? t("prefs.translate.customStyleLabel", ["name": $0.label]) : $0.label)
                    }) { model.commit(["styleId": .string($0)]) }
                }
            }

            PrefGroup(title: t("prefs.translate.silent"), palette: p) {
                HotkeyRow(model: model, field: "silentReplaceHotkey", description: t("prefs.translate.silentHint"))
            }

            PrefGroup(title: t("prefs.translate.compose"), palette: p) {
                HotkeyRow(model: model, field: "composeHotkey", description: t("prefs.translate.composeHint"))
            }

            compareGroup

            PrefGroup(title: t("prefs.translate.ocr"), palette: p) {
                HotkeyRow(model: model, field: "ocrHotkey", description: t("prefs.translate.ocrHint"))
                HotkeyRow(model: model, field: "ocrSilentHotkey", description: t("prefs.translate.ocrSilentHint"),
                          title: t("prefs.translate.ocrSilent"))
                PrefRow(title: t("prefs.translate.ocrEngine"), description: t("prefs.translate.ocrEngineHint"), palette: p)
            }

            PrefGroup(title: t("prefs.translate.speak"), palette: p) {
                HotkeyRow(model: model, field: "speakHotkey", description: t("prefs.translate.speakHint"))
            }

            LanguageRules(model: model)

            PrefGroup(palette: p) {
                PrefBlock(title: t("prefs.translate.customStyles"), description: t("prefs.translate.customStylesHint"),
                        palette: p) {
                    StylePresetsView(model: model, editor: model.presets)
                }
            }

            PrefGroup(palette: p) {
                PrefBlock(title: t("prefs.translate.glossary"), description: t("prefs.translate.glossaryHint"), palette: p) {
                    GlossaryManagerView(model: model, manager: model.glossaries)
                }
            }
        }
    }

    private var engineLine: String {
        guard let provider = model.provider else { return t("prefs.translate.engineUnset") }
        let modelName = s.string("model")
        return "\(provider.label) · \(modelName.isEmpty ? provider.defaultModel : modelName)"
    }

    /// 对比只会调用存了 Key 的供应商，本机模型选进来也不会跑——干脆不让选。
    private var keyedProviders: [ProviderDetail] { model.providers.filter(\.requiresKey) }

    private var compareGroup: some View {
        PrefGroup(title: t("prefs.translate.compare"), palette: p) {
            HotkeyRow(model: model, field: "compareHotkey", description: t("prefs.translate.compareHint"))
            PrefBlock(title: t("prefs.translate.compareModels"), description: t("prefs.translate.compareModelsHint"),
                    palette: p) {
                ModelRefListView(
                    model: model, value: model.routing.compareModels, providers: keyedProviders, ordered: false,
                    emptyHint: t("prefs.translate.compareEmpty"), addLabel: t("prefs.translate.compareAdd"),
                    draft: Binding(get: { model.routing.compareDraft }, set: { model.routing.compareDraft = $0 }),
                    onChange: { model.routing.setCompare($0) }, onAdd: { model.routing.addCompare() }
                )
            }
            PrefBlock(title: t("prefs.translate.compareProviders"), description: t("prefs.translate.compareProvidersHint"),
                    palette: p) {
                let chosen = s.strings("compareProviders")
                FlowChecks(items: keyedProviders.map { ($0.id, $0.label) }, chosen: chosen, palette: p) { id, on in
                    model.commit(["compareProviders": .array((on ? chosen + [id] : chosen.filter { $0 != id }).map(JSONValue.string))])
                }
            }
            if !model.picks.isEmpty {
                PrefBlock(title: t("prefs.translate.picks"), description: t("prefs.translate.picksHint"), palette: p) {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(model.picks.prefix(3).enumerated()), id: \.offset) { _, pick in
                            HStack(spacing: 8) {
                                Text(t("prefs.translate.pickLine", [
                                    "count": String(pick.count), "provider": pick.providerId, "model": pick.model,
                                ])).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
                                Spacer(minLength: 0)
                                PrefButton(title: t("prefs.translate.pickUse"), palette: p) {
                                    model.commit(["providerId": .string(pick.providerId), "model": .string(pick.model)])
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// 一组勾选框（对比要用的供应商）。
struct FlowChecks: View {
    let items: [(id: String, label: String)]
    let chosen: [String]
    let palette: Palette
    let onToggle: (String, Bool) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(items, id: \.id) { item in
                Toggle(item.label, isOn: Binding(get: { chosen.contains(item.id) }, set: { onToggle(item.id, $0) }))
                    .toggleStyle(.checkbox).font(.system(size: 12))
            }
        }
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
                error: model.hotkeys.message(field), palette: model.palette) {
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
        let p = model.palette
        let t = model.t
        let recording = editor.recording == field
        let parts = HotkeyFormat.parts(model.values.string(field), rightLabel: t("prefs.hotkey.right"))
        VStack(alignment: .trailing, spacing: 4) {
            Button { editor.toggle(field) } label: {
                HStack(spacing: 3) {
                    if recording {
                        Text(t("prefs.hotkey.recording")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
                    } else if parts.isEmpty {
                        Text(t("prefs.hotkey.unset")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
                    } else {
                        ForEach(Array(parts.enumerated()), id: \.offset) { _, part in Keycap(text: part, palette: p) }
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .frame(minWidth: 96)
                .background(recording ? p.hover.color : p.surface.color)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(recording ? p.primary.color : p.border.color))
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(recording ? .isSelected : [])
            if recording, let notice = editor.notice {
                Text(notice).font(.system(size: 11)).foregroundStyle(p.warning.color)
            }
        }
    }
}

/// 语言规则：目标语言模式（按 App 记住）、第二目标语言、取词黑名单。
struct LanguageRules: View {
    let model: SettingsModel

    var body: some View {
        let p = model.palette
        let t = model.t
        let s = model.values
        let remembered = s.object("appTargetLangs").sorted { $0.key < $1.key }
        PrefGroup(title: t("prefs.translate.rules"), palette: p) {
            PrefRow(title: t("prefs.translate.targetMode"), description: t("prefs.translate.targetModeHint"), palette: p) {
                PrefPicker(label: t("prefs.translate.targetMode"), value: s.string("targetLangMode", "fixed"), options: [
                    ("fixed", t("prefs.translate.targetFixed")), ("perApp", t("prefs.translate.targetPerApp")),
                ]) { model.commit(["targetLangMode": .string($0)]) }
            } extra: {
                if s.string("targetLangMode") == "perApp" {
                    if remembered.isEmpty {
                        Text(t("prefs.translate.rememberedEmpty")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(remembered, id: \.key) { app, code in
                                HStack {
                                    Text("\(app) → \(Languages.label(code.stringValue ?? ""))").font(.system(size: 12))
                                        .foregroundStyle(p.textSecondary.color).lineLimit(1).truncationMode(.tail)
                                    Spacer(minLength: 0)
                                    PrefButton(title: t("prefs.translate.forget"), palette: p) {
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
            PrefRow(title: t("prefs.translate.secondaryLang"), description: t("prefs.translate.secondaryLangHint"),
                    palette: p) {
                LanguagePicker(label: t("prefs.translate.secondaryLang"), value: s.string("secondaryTargetLang")) {
                    model.commit(["secondaryTargetLang": .string($0)])
                }
            }
            PrefBlock(title: t("prefs.translate.blacklist"), description: t("prefs.translate.blacklistHint"),
                      error: model.rowErrors["selectionBlacklist"], palette: p) {
                DraftField(value: s.strings("selectionBlacklist").joined(separator: "\n"), multiline: true,
                           label: t("prefs.translate.blacklist")) { text in
                    model.commitRow("selectionBlacklist",
                                    ["selectionBlacklist": .array(SettingsRules.blacklist(text).map(JSONValue.string))])
                }
            }
        }
    }
}
