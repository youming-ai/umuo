import AppKit
import SwiftUI
import UmuoCore

/// 一串「供应商 + 模型」的编辑器（`ModelRefList.tsx`）：**对比模型**与**备用顺序**是同一个形态，差别只有一处——
/// 备用顺序的**顺序有意义**（它就是重试顺序），所以那边多一对 ↑↓。增删改的规则复用 `SceneRouting` 的纯函数。
struct ModelRefListView: View {
    let model: SettingsModel
    let value: [ModelRef]
    let providers: [ProviderDetail]
    var ordered = false
    let emptyHint: String
    var addLabel: String?
    @Binding var draft: ModelRef
    let onChange: ([ModelRef]) -> Void
    let onAdd: () -> Void

    var body: some View {
        let p = model.palette
        let t = model.t
        VStack(alignment: .leading, spacing: 6) {
            if value.isEmpty {
                Text(emptyHint).font(.system(size: 11)).foregroundStyle(p.textTertiary.color)
            }
            ForEach(Array(value.enumerated()), id: \.offset) { index, ref in
                HStack(spacing: 8) {
                    if ordered { Text("\(index + 1).").font(.system(size: 11)).foregroundStyle(p.textMuted.color) }
                    Text(SceneRouting.label(ref, t)).font(.system(size: 12)).foregroundStyle(p.textPrimary.color)
                    Spacer(minLength: 0)
                    if ordered {
                        PrefButton(title: "↑", palette: p) { onChange(SceneRouting.moveFallback(value, at: index, by: -1)) }
                        PrefButton(title: "↓", palette: p) { onChange(SceneRouting.moveFallback(value, at: index, by: 1)) }
                    }
                    PrefButton(title: t("prefs.modelList.remove"), palette: p) {
                        onChange(SceneRouting.removeFallback(value, at: index))
                    }
                }
            }
            HStack(spacing: 8) {
                PrefPicker(label: t("prefs.modelList.pickProvider"), value: draft.providerId,
                           options: [("", t("prefs.modelList.pickProvider"))] + providers.map { ($0.id, $0.label) },
                           width: 160) { draft.providerId = $0 }
                TextField(t("prefs.modelList.model"), text: $draft.model).textFieldStyle(.roundedBorder)
                PrefButton(title: addLabel ?? t("prefs.modelList.add"), disabled: !draft.isComplete, palette: p, action: onAdd)
            }
        }
    }
}

/// 分场景模型与备用顺序（`SceneRouting.tsx`，PRD §6.3）。草稿与「失焦提交」的理由见 `RoutingEditor`。
struct SceneRoutingView: View {
    let model: SettingsModel
    let routing: RoutingEditor

    private static let text: [SceneKey: (label: String, hint: String)] = [
        .selection: ("prefs.scene.selection", "prefs.scene.selectionHint"),
        .compose: ("prefs.scene.compose", "prefs.scene.composeHint"),
        .silentReplace: ("prefs.scene.silentReplace", "prefs.scene.silentReplaceHint"),
        .ocr: ("prefs.scene.ocr", "prefs.scene.ocrHint"),
        .wordCard: ("prefs.scene.wordCard", "prefs.scene.wordCardHint"),
    ]

    var body: some View {
        let p = model.palette
        let t = model.t
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(SceneRouting.rows, id: \.self) { key in
                    let names = Self.text[key]!
                    let scene = t(names.label)
                    let draft = routing.drafts[key] ?? ModelRef(providerId: "", model: "")
                    HStack(spacing: 8) {
                        Text(scene).font(.system(size: 12)).foregroundStyle(p.textPrimary.color)
                            .frame(width: 112, alignment: .leading).lineLimit(1).help(t(names.hint))
                        // 下拉框没有「失焦」：选了就提交（模型名没填时 `SceneRouting.set` 当作未配置）
                        PrefPicker(label: t("prefs.scene.provider", ["scene": scene]), value: draft.providerId,
                                   options: [("", t("prefs.scene.default"))] + model.providers.map { ($0.id, $0.label) },
                                   width: 140) { id in
                            routing.drafts[key] = ModelRef(providerId: id, model: draft.model)
                            routing.commitScene(key)
                        }
                        DraftField(value: draft.model, placeholder: t("prefs.scene.modelPlaceholder"), width: 180,
                                   label: t("prefs.scene.model", ["scene": scene])) { text in
                            routing.drafts[key] = ModelRef(providerId: routing.drafts[key]?.providerId ?? "", model: text)
                            routing.commitScene(key)
                            return nil
                        }
                        Text(routing.saved(key)?.isComplete == true ? "●" : " ")
                            .font(.system(size: 11)).foregroundStyle(p.success.color).frame(width: 12)
                            .help(t("prefs.scene.custom"))
                            .accessibilityLabel(routing.saved(key)?.isComplete == true ? t("prefs.scene.custom") : "")
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(t("prefs.scene.fallback")).font(.system(size: 13, weight: .medium)).foregroundStyle(p.textPrimary.color)
                Text(t("prefs.scene.fallbackHint")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
                ModelRefListView(
                    model: model, value: routing.fallbacks, providers: model.providers, ordered: true,
                    emptyHint: t("prefs.scene.fallbackEmpty"),
                    draft: Binding(get: { routing.fallbackDraft }, set: { routing.fallbackDraft = $0 }),
                    onChange: { routing.setFallbacks($0) }, onAdd: { routing.addFallback() }
                )
            }
        }
    }
}

/// 自建风格预设（`StylePresets.tsx`）。
struct StylePresetsView: View {
    let model: SettingsModel
    @Bindable var editor: StylePresetsEditor

    var body: some View {
        let p = model.palette
        let t = model.t
        let list = editor.list
        let selected = model.values.string("styleId")
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(t("prefs.presets.intro")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
                Spacer(minLength: 8)
                PrefButton(title: t("prefs.presets.new"), palette: p) { editor.startNew() }
            }
            if let error = editor.error {
                Text(error).font(.system(size: 12)).foregroundStyle(p.error.color).textSelection(.enabled)
            }
            if list.isEmpty, editor.editing == nil {
                Text(t("prefs.presets.empty")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
            }
            ForEach(list) { style in
                HStack(spacing: 8) {
                    Text(style.label.isEmpty ? t("prefs.presets.untitled") : style.label)
                        .font(.system(size: 12)).foregroundStyle(p.textPrimary.color)
                    if style.id == selected {
                        Text(t("prefs.presets.inUse")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
                    }
                    Text(StylePresets.summary(style, t)).font(.system(size: 11)).foregroundStyle(p.textMuted.color)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    PrefButton(title: t("prefs.presets.edit"), palette: p) { editor.edit(style) }
                    PrefButton(title: t("prefs.presets.delete"), palette: p) {
                        guard PrefConfirm.ask(t("prefs.presets.confirmDelete"), confirm: t("prefs.presets.delete"),
                                              cancel: t("prefs.presets.cancel")) else { return }
                        Task { await editor.remove(style.id) }
                    }
                }
            }
            if editor.editing != nil { form(p, t) }
        }
    }

    /// 一条例句的一个输入框，按例句的 `id` 找行：行已被删掉时读出空串、写入直接丢弃，不会越界。
    private func exampleField(_ id: CustomStyle.Example.ID,
                              _ field: WritableKeyPath<CustomStyle.Example, String>) -> Binding<String>
    {
        Binding(
            get: { editor.editing?.fewShot.first { $0.id == id }?[keyPath: field] ?? "" },
            set: { value in
                guard let index = editor.editing?.fewShot.firstIndex(where: { $0.id == id }) else { return }
                editor.editing?.fewShot[index][keyPath: field] = value
            }
        )
    }

    private func form(_ p: Palette, _ t: Translate) -> some View {
        let style = Binding(get: { editor.editing ?? CustomStyle(id: "") }, set: { editor.editing = $0 })
        return VStack(alignment: .leading, spacing: 8) {
            Text(t("prefs.presets.name")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
            TextField(t("prefs.presets.namePlaceholder"), text: style.label).textFieldStyle(.roundedBorder)
            Text(t("prefs.presets.instruction")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
            PlainTextEditor(text: style.wrappedValue.instruction, height: 72, label: t("prefs.presets.instruction")) {
                editor.editing?.instruction = $0
            }
            Text("\(t("prefs.presets.variables")) {source_lang} {target_lang} {glossary} {app_name}")
                .font(.system(size: 11)).foregroundStyle(p.textMuted.color).textSelection(.enabled)
            HStack(spacing: 16) {
                HStack(spacing: 6) {
                    Text(t("prefs.presets.temperature")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
                    TextField("0.2", text: $editor.temperatureText).textFieldStyle(.roundedBorder).frame(width: 64)
                }
                Toggle(t("prefs.presets.explain"), isOn: style.explain).toggleStyle(.checkbox).font(.system(size: 12))
            }
            Text(t("prefs.presets.examples")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
            ForEach(style.wrappedValue.fewShot) { example in
                HStack(spacing: 4) {
                    TextField(t("prefs.presets.exampleSource"), text: exampleField(example.id, \.source))
                        .textFieldStyle(.roundedBorder)
                    TextField(t("prefs.presets.exampleTarget"), text: exampleField(example.id, \.target))
                        .textFieldStyle(.roundedBorder)
                    PrefButton(title: t("prefs.presets.removeExample"), palette: p) {
                        // 先让正在编辑的输入框交出内容（写回仍在的那一行），再删；否则失焦时的写回会落到已删掉的行上
                        NSApp.keyWindow?.makeFirstResponder(nil)
                        editor.editing?.fewShot.removeAll { $0.id == example.id }
                    }
                }
            }
            PrefButton(title: t("prefs.presets.addExample"), palette: p) {
                editor.editing?.fewShot.append(CustomStyle.Example(source: "", target: ""))
            }
            HStack(spacing: 8) {
                PrefButton(title: t("prefs.presets.save"), prominent: true, palette: p) { Task { await editor.save() } }
                PrefButton(title: t("prefs.presets.cancel"), palette: p) { editor.cancel() }
            }
            .padding(.top, 4)
        }
        .padding(12)
        .background(p.background.color)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(p.border.color))
    }
}

/// 术语表管理（`GlossaryManager.tsx`）。文件的读写（选文件、存文件）在这里做，内容交给 `GlossaryManager` → Rust 解析。
struct GlossaryManagerView: View {
    let model: SettingsModel
    @Bindable var manager: GlossaryManager

    var body: some View {
        let p = model.palette
        let t = model.t
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Text(t("prefs.glossary.intro")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                PrefButton(title: t("prefs.glossary.importFile"), palette: p) { chooseFile() }
                PrefButton(title: t("prefs.glossary.new"), palette: p) { manager.startNew() }
            }
            if let status = manager.status {
                Text(status).font(.system(size: 12)).foregroundStyle(p.textSecondary.color).textSelection(.enabled)
            }
            if manager.lists.isEmpty, manager.editing == nil {
                Text(t("prefs.glossary.empty")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
            }
            ForEach(manager.lists) { list in
                HStack(spacing: 8) {
                    Text(list.name).font(.system(size: 12)).foregroundStyle(p.textPrimary.color)
                    Text(GlossaryEditor.summary(list, t)).font(.system(size: 11)).foregroundStyle(p.textMuted.color)
                    Spacer(minLength: 0)
                    PrefButton(title: t("prefs.glossary.edit"), palette: p) { manager.edit(list) }
                    PrefButton(title: t("prefs.glossary.copyCsv"), palette: p) { Task { await manager.copyCsv(list) } }
                    PrefButton(title: t("prefs.glossary.exportFile"), palette: p) { Task { await export(list) } }
                    PrefButton(title: t("prefs.glossary.delete"), palette: p) {
                        guard PrefConfirm.ask(t("prefs.glossary.confirmDelete", ["name": list.name]),
                                              confirm: t("prefs.glossary.delete"), cancel: t("prefs.glossary.cancel"))
                        else { return }
                        Task { await manager.remove(list) }
                    }
                }
            }
            if manager.editing != nil { form(p, t) }
        }
        .task { await manager.reload() }
    }

    private func form(_ p: Palette, _ t: Translate) -> some View {
        let list = Binding(get: { manager.editing ?? Glossary(id: "") }, set: { manager.editing = $0 })
        return VStack(alignment: .leading, spacing: 8) {
            Text(t("prefs.glossary.name")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
            TextField(t("prefs.glossary.namePlaceholder"), text: list.name).textFieldStyle(.roundedBorder)
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("prefs.glossary.sourceLang")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
                    TextField(t("prefs.glossary.sourcePlaceholder"), text: list.sourceLang).textFieldStyle(.roundedBorder)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(t("prefs.glossary.targetLang")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
                    TextField(t("prefs.glossary.targetPlaceholder"), text: list.targetLang).textFieldStyle(.roundedBorder)
                }
            }
            Text(t("prefs.glossary.entries")).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
            PlainTextEditor(text: manager.text, height: 160, monospaced: true, label: t("prefs.glossary.entries")) {
                manager.text = $0
            }
            Text(t("prefs.glossary.entriesHint")).font(.system(size: 11)).foregroundStyle(p.textMuted.color)
            HStack(spacing: 8) {
                PrefButton(title: t("prefs.glossary.saveImport"), prominent: true, palette: p) {
                    Task { await manager.save(withEntries: true) }
                }
                // 只存名称与语言对，不动条目
                PrefButton(title: t("prefs.glossary.saveMeta"), palette: p) { Task { await manager.save(withEntries: false) } }
                PrefButton(title: t("prefs.glossary.cancel"), palette: p) { manager.cancel() }
            }
            .padding(.top, 4)
        }
        .padding(12)
        .background(p.background.color)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(p.border.color))
    }

    /// 从 CSV / TSV 文件读入：内容放进编辑框，用户看一眼再按「保存并导入」（解析仍在 Rust）。
    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let data = try Data(contentsOf: url)
            // Excel 存的 CSV 常常不是 UTF-8：先按 UTF-8，不行再按 UTF-16（带 BOM 的「Unicode 文本」）
            guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) else {
                return manager.fileFailed(model.t("prefs.glossary.notText"))
            }
            manager.loadFile(name: url.deletingPathExtension().lastPathComponent, contents: text)
        } catch {
            manager.fileFailed(error.localizedDescription)
        }
    }

    private func export(_ list: Glossary) async {
        guard let csv = await manager.exportText(list) else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = GlossaryEditor.exportFileName(list)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try csv.write(to: url, atomically: true, encoding: .utf8)
            manager.exported(to: url.path)
        } catch {
            manager.fileFailed(error.localizedDescription)
        }
    }
}
