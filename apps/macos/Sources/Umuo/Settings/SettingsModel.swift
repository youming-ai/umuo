import Foundation
import Observation
import UmuoCore

/// 设置窗的视图模型。
///
/// **改了就存**，没有「保存」按钮：顺序与失败回滚交给 `SettingsQueue`（逐个保存、只交自己改的键、
/// 失败只退回这几个字段）；API Key 是唯一例外（要明确按「保存」，见 `EngineEditor`）。
/// 下拉框、开关这类控件没有自己的错误位置，保存失败时原因显示在页面顶部（`saveError`），否则它们会「悄悄弹回去」。
///
/// 各页自己的一次性状态（草稿、行内错误、编辑中的预设）在下面几个子模型里，都只在 MainActor 上改。
@MainActor @Observable
final class SettingsModel {
    let backend: SettingsBackend

    private(set) var queue: SettingsQueue<JSONValue>?
    private(set) var loadError: String?
    private(set) var providers: [ProviderDetail] = []
    private(set) var styles: [StyleInfo] = []
    /// 当前供应商是否已配 Key。nil = 还没读出来 / 读不到。本机模型（不需要 Key）算已配。
    private(set) var keyConfigured: Bool?
    private(set) var permissions = PermissionStatus()
    /// 开机启动以磁盘上的 LaunchAgent 为准；nil = 还没读出来。
    private(set) var autostart: Bool?
    private(set) var hotkeyFailures: [String] = []
    private(set) var picks: [ComparePick] = []
    private(set) var usage: UsageSummary?
    private(set) var spend: [ProviderUsage] = []
    /// 换分区就结束录键：Tauri 版换页会卸掉录键器、顺带停录；这里录键器不随页面消失，不停的话
    /// 在别的页上按的键（比如在 Key 输入框里按 ⌘V）会被当成快捷键录进去，全局快捷键也一直停着。
    var tab: SettingsTab? {
        didSet { if tab != oldValue { hotkeys.stop() } }
    }
    var saveError: String?
    /// 文本框一行的保存错误（行名 → 原因），显示在那一行下面。
    var rowErrors: [String: String] = [:]

    /// 各页的子模型。
    @ObservationIgnored private(set) lazy var engine = EngineEditor(self)
    @ObservationIgnored private(set) lazy var hotkeys = HotkeyEditor(self)
    @ObservationIgnored private(set) lazy var presets = StylePresetsEditor(self)
    @ObservationIgnored private(set) lazy var glossaries = GlossaryManager(self)
    @ObservationIgnored private(set) lazy var general = GeneralEditor(self)
    @ObservationIgnored private(set) lazy var advanced = AdvancedEditor(self)
    @ObservationIgnored private(set) lazy var routing = RoutingEditor(self)

    /// 最近一次查 Key 状态的序号：结果回来时供应商可能又换了，只认最后一次。
    private var keyCheck = 0
    private var keyCheckedProvider: String?

    init(backend: SettingsBackend) {
        self.backend = backend
    }

    /// 界面上此刻的设置（含尚在保存中的改动）。
    var values: SettingsValues { queue?.current ?? [:] }
    var isLoaded: Bool { queue != nil && tab != nil }

    var t: Translate { Translate(locale: AppLocale.resolve(setting: values.string("locale", "system"))) }
    /// 系统此刻是不是深色外观（窗口在系统换外观时更新它）；主题选「跟随系统」时按它取。
    var prefersDark = false
    var theme: ResolvedTheme { ThemeChoice.resolve(values["theme"]?.stringValue, prefersDark: prefersDark) }
    var palette: Palette { .of(theme) }
    var providerId: String { values.string("providerId") }
    var provider: ProviderDetail? { providers.first { $0.id == providerId } }

    var attention: Set<SettingsTab> {
        let limits = SettingsRules.limits(values.array("monthlyLimits"))
        let spends = spend.map { (providerId: $0.providerId, costUsd: $0.costUsd) }
        return SettingsTabs.attention(SettingsAttentionInput(
            keyConfigured: keyConfigured,
            someProviderOverLimit: limits.contains { Limits.spend(spends, for: $0.providerId) >= $0.limitUsd },
            permissionMissing: SettingsTabs.missingPermission(permissions.accessibility, permissions.screenRecording)
        ))
    }

    // MARK: - 载入与刷新

    /// 打开窗口时载入。这一段失败时页面会永远停在「载入中」，所以把原因显示出来。
    func load() async {
        loadError = nil
        let current: SettingsValues
        do { current = try await backend.loadSettings() } catch {
            loadError = SettingsRules.message(error)
            return
        }
        providers = await backend.providers()
        styles = await backend.styles()
        // 重新打开时队列已在：用 `refresh` 叠上最新值（有保存在路上时它会等落定），不另起一条队列打乱保存顺序。
        if let queue {
            queue.refresh(current)
            routing.reset()
        } else {
            adopt(current)
        }

        let key = try? await backend.keyStatus(current.string("providerId"))
        let perms = await backend.permissions()
        permissions = perms
        let needsKey = providers.first { $0.id == current.string("providerId") }?.requiresKey ?? true
        keyConfigured = needsKey ? key : true
        keyCheckedProvider = current.string("providerId")
        tab = SettingsTabs.initial(SettingsAttentionInput(
            keyConfigured: keyConfigured, someProviderOverLimit: false,
            permissionMissing: SettingsTabs.missingPermission(perms.accessibility, perms.screenRecording)
        ))

        // 下面这些都是参考信息：读不到不该拖垮设置窗。
        hotkeyFailures = backend.hotkeyFailures()
        autostart = await backend.autostartStatus()
        picks = await backend.comparePicks()
        usage = await backend.usageSummary()
        spend = await backend.monthlySpend()
    }

    private func adopt(_ loaded: SettingsValues) {
        // 每次保存都叠在后端此刻的值上（`applyPatch` 即 `applySettingsPatch`）：设置窗开着时浮窗也会写设置
        // （按 App 记住的目标语言等），拿窗口里的旧快照整份写回会把它们抹掉。
        queue = SettingsQueue(initial: loaded) { [backend] patch in try await backend.applyPatch(patch) }
        routing.reset()
    }

    /// 关掉后再打开：Tauri 版每次新建 WebView、全量重读，各页的草稿与行内状态都从头开始。
    /// 这里窗口与模型复用，所以先把各页的一次性状态清掉，再整份重新载入（用量、花费、开机启动、初始分区……）。
    func reopen() async {
        resetDrafts()
        await load()
    }

    /// 窗口关闭：结束录键，并丢掉没保存的 Key 草稿——明文不该在关掉的窗口里留到下次打开。
    func windowClosed() {
        hotkeys.stop()
        engine.apiKey = ""
    }

    private func resetDrafts() {
        saveError = nil
        rowErrors = [:]
        engine.reset()
        hotkeys.reset()
        presets.reset()
        glossaries.reset()
        general.reset()
        advanced.reset()
    }

    /// 窗口重新成为 key 时：用户多半是去系统设置授完权、或在浮窗里改了点什么再切回来——权限与设置都再读一次。
    func windowFocused() async {
        guard queue != nil else { return }
        await recheckPermissions()
        if let latest = try? await backend.loadSettings() {
            queue?.refresh(latest)
            await providerMaybeChanged()
        }
    }

    func recheckPermissions() async {
        permissions = await backend.permissions()
    }

    /// 快捷键重注册完成之后（`HotkeyCenter.onRegistered`）重读失败清单。
    func hotkeysRegistered() {
        hotkeyFailures = backend.hotkeyFailures()
    }

    func reloadStyles() async {
        styles = await backend.styles()
    }

    // MARK: - 保存

    /// 提交一次改动。失败时除了交给调用方（文本框把原因写在自己那一行），也显示在页面顶部。
    /// 返回的任务在保存落定时结束；不关心结果的调用方直接丢掉它，不会变成未处理的错误。
    @discardableResult
    func commit(_ patch: SettingsValues) -> Task<Void, Error> {
        guard let queue else { return Task {} }
        saveError = nil
        let pending = queue.commit(patch)
        return Task {
            do { try await pending.value } catch {
                saveError = SettingsRules.message(error)
                throw error
            }
            // 供应商一变就重查 Key 状态，不管是从哪里改的：引擎页的下拉、翻译页的「常用组合」……
            if patch["providerId"] != nil { await providerMaybeChanged() }
        }
    }

    /// 文本框那种「这一行自己显示错误」的提交：先清掉这一行的旧错误，失败时把原因记在这一行。
    @discardableResult
    func commitRow(_ row: String, _ patch: SettingsValues) -> Task<Void, Error> {
        rowErrors[row] = nil
        let pending = commit(patch)
        return Task {
            do { try await pending.value } catch {
                rowErrors[row] = SettingsRules.message(error)
                throw error
            }
        }
    }

    /// 当前供应商变了（保存、聚焦刷新）就重查 Key 状态。查不到时置为「不知道」，而不是留着上一个供应商的结论。
    func providerMaybeChanged() async {
        let id = providerId
        guard id != keyCheckedProvider else { return }
        await refreshKeyStatus()
    }

    func refreshKeyStatus() async {
        let id = providerId
        keyCheckedProvider = id
        keyCheck += 1
        let mine = keyCheck
        // 本机模型不需要 Key：与首次载入时同一条规则。
        if !(providers.first { $0.id == id }?.requiresKey ?? true) {
            keyConfigured = true
            return
        }
        let configured = try? await backend.keyStatus(id)
        guard mine == keyCheck else { return }
        keyConfigured = configured
    }

    /// 存 / 删 Key 之后，由引擎页告诉外层（不必再查一遍）。
    func keyConfigured(_ configured: Bool, for providerId: String) {
        guard providerId == self.providerId else { return }
        let needsKey = providers.first { $0.id == providerId }?.requiresKey ?? true
        keyConfigured = needsKey ? configured : true
    }

    /// 开机启动：磁盘写得成不成功只有实现知道，以它返回的状态为准；被拒绝时把原因摆出来，不能只是开关弹回去。
    func setAutostart(_ enabled: Bool) async {
        general.autostartError = nil
        let actual: Bool
        do { actual = try await backend.setAutostart(enabled) } catch {
            general.autostartError = SettingsRules.message(error)
            return
        }
        autostart = actual
        _ = try? await commit(["launchAtLogin": .bool(actual)]).value
    }

    /// 导入配置之后整页重读：设置、风格目录（导入可能带来新的自建风格）。
    func imported(_ result: ImportResult) async {
        if let latest = JSONValue.object(json: result.settingsJson) {
            if let queue { queue.refresh(latest) } else { adopt(latest) }
            routing.reset()
        }
        await reloadStyles()
        await providerMaybeChanged()
    }
}

// MARK: - 引擎页：Key、模型、端点

/// 引擎页的状态（`EnginePage.tsx`）。**Key 只出不进**：输入框永远不回填明文，只显示「已配置」；
/// Key 也不走改了就存——它是密钥，必须由用户明确按下「保存」才写进 Keychain。
@MainActor @Observable
final class EngineEditor {
    @ObservationIgnored private unowned let model: SettingsModel
    var apiKey = ""
    var keyError: String?
    var models: [String] = []
    var modelNotice: String?

    init(_ model: SettingsModel) { self.model = model }

    func reset() {
        apiKey = ""
        keyError = nil
        models = []
        modelNotice = nil
    }

    /// 换供应商：没保存的 Key 草稿属于上一个供应商，不清掉的话按「保存」会把它存到新供应商名下。模型换成新供应商的默认模型。
    func switchProvider(_ providerId: String) {
        let next = model.providers.first { $0.id == providerId }
        apiKey = ""
        keyError = nil
        models = []
        modelNotice = nil
        model.commit(["providerId": .string(providerId), "model": .string(next?.defaultModel ?? "")])
    }

    /// 用用户自己的 Key 拉一次模型列表（同时也就校验了 Key）。结果回来时供应商换了就不作数。
    func fetchModels() async {
        let requested = model.providerId
        modelNotice = nil
        do {
            let list = try await model.backend.listModels(requested)
            guard model.providerId == requested else { return }
            models = list
            modelNotice = list.isEmpty ? model.t("prefs.engine.noModels")
                : model.t("prefs.engine.gotModels", ["count": String(list.count)])
        } catch {
            guard model.providerId == requested else { return }
            modelNotice = model.t("prefs.engine.fetchModelsFailed", ["reason": SettingsRules.message(error)])
        }
    }

    var canSaveKey: Bool { !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    func saveKey() async {
        let providerId = model.providerId
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        keyError = nil
        do {
            try await model.backend.saveApiKey(providerId, key)
            guard model.providerId == providerId else { return }
            apiKey = ""
            model.keyConfigured(true, for: providerId)
        } catch {
            keyError = SettingsRules.message(error)
        }
    }

    func clearKey() async {
        let providerId = model.providerId
        do {
            try await model.backend.deleteApiKey(providerId)
            model.keyConfigured(false, for: providerId)
        } catch {
            keyError = SettingsRules.message(error)
        }
    }
}

// MARK: - 快捷键：每行的冲突检查与录键

/// 七行快捷键（翻译页）。录键期间暂停所有全局快捷键——否则录 ⌥D 的那一下会顺手触发一次划词翻译；
/// 同一时刻只有一行在录（`recording`），开始录另一行就先停掉这一行。
@MainActor @Observable
final class HotkeyEditor {
    /// 设置字段名 → 文案键（功能名）。顺序即冲突检查里「别的功能」的顺序。
    static let names: [(field: String, key: String)] = [
        ("selectionHotkey", "prefs.translate.selection"),
        ("silentReplaceHotkey", "prefs.translate.silent"),
        ("composeHotkey", "prefs.translate.compose"),
        ("ocrHotkey", "prefs.translate.ocr"),
        ("ocrSilentHotkey", "prefs.translate.ocrSilent"),
        ("compareHotkey", "prefs.translate.compare"),
        ("speakHotkey", "prefs.translate.speak"),
    ]

    /// 录键最多等这么久就自动放弃（`HotkeyCenter` 的暂停截止是 30 秒，这里留出余量）。
    nonisolated static let recordTimeout: Duration = .seconds(25)

    @ObservationIgnored private unowned let model: SettingsModel
    /// 正在录的那一行（字段名）。
    private(set) var recording: String?
    /// 录键时的提示（按了录不了的键）。
    private(set) var notice: String?
    /// 行内错误（保存失败、与别的功能撞键）。
    var errors: [String: String] = [:]
    @ObservationIgnored private var taps = DoubleTapRecorder()
    @ObservationIgnored private var timeout: Task<Void, Never>?

    init(_ model: SettingsModel) { self.model = model }

    func reset() {
        stop()
        notice = nil
        errors = [:]
    }

    private func others(_ field: String) -> [(label: String, value: String)] {
        Self.names.filter { $0.field != field }.map { (model.t($0.key), model.values.string($0.field)) }
    }

    /// 这一行下面要显示的话：行内错误优先，其次是注册失败，最后是静态冲突检查的提醒。
    func message(_ field: String) -> String? {
        let t = model.t
        if let error = errors[field] { return error }
        let value = model.values.string(field)
        if model.hotkeyFailures.contains(field) {
            if case .doubleTap = parseHotkey(value: value) { return t("prefs.hotkey.tapFailed") }
            return t("prefs.hotkey.registerFailed")
        }
        return Self.warning(HotkeyConflict.check(value, others: others(field)), t)
    }

    static func warning(_ conflict: HotkeyConflict.Conflict?, _ t: Translate) -> String? {
        guard let conflict else { return nil }
        switch conflict.kind {
        case .noModifier: return t("prefs.hotkey.noModifier")
        case .duplicate: return t("prefs.hotkey.duplicate", ["name": conflict.subject ?? ""])
        case .system: return t("prefs.hotkey.system", ["name": conflict.subject ?? ""])
        }
    }

    /// 点一下键帽：没在录就开始录（别的行在录的话先停掉），在录就停。
    func toggle(_ field: String) {
        notice = nil
        if recording == field { return stop() }
        if recording != nil { stop() }
        recording = field
        taps = DoubleTapRecorder()
        model.backend.setHotkeyRecording(true)
        timeout = Task { [weak self] in
            try? await Task.sleep(for: Self.recordTimeout)
            guard !Task.isCancelled else { return }
            self?.stop()
        }
    }

    /// 结束录制并恢复全局快捷键。Esc、窗口失焦、超时、窗口关闭、开始录另一行都走这里；没在录时是空操作。
    func stop() {
        guard recording != nil else { return }
        recording = nil
        timeout?.cancel()
        timeout = nil
        model.backend.setHotkeyRecording(false)
    }

    /// 录键时的一次按下（keyDown）。返回 true = 这个事件被录键器吃掉了（不再交给窗口）。
    @discardableResult
    func keyDown(_ key: HotkeyFormat.Key, atMs: UInt64) -> Bool {
        guard recording != nil else { return false }
        if key.code == "Escape" {
            stop()
            return true
        }
        // 两下之间按了别的键：打断连按
        taps.other(atMs: atMs)
        switch HotkeyFormat.combo(from: key) {
        case .waiting: break
        case .unsupported: notice = model.t("prefs.hotkey.unsupported")
        case let .combo(value): save(value)
        }
        return true
    }

    /// 录键时的一次修饰键变化（flagsChanged）。连按两下修饰键只能从按下 / 松开的节奏里认出来。
    @discardableResult
    func modifiersChanged(keyCode: UInt16, flags: UInt64, atMs: UInt64) -> Bool {
        guard recording != nil else { return false }
        if let value = taps.modifierChanged(keyCode: keyCode, flags: flags, atMs: atMs) { save(value) }
        return true
    }

    /// 录键时点了鼠标：打断连按（与 Rust 侧判定同一规则）。
    func pointer(atMs: UInt64) {
        guard recording != nil else { return }
        taps.other(atMs: atMs)
    }

    private func save(_ value: String) {
        guard let field = recording else { return }
        stop()
        guard value != model.values.string(field) else { return }
        commit(field, value)
    }

    /// 保存一行。与别的功能撞键就不存：两个功能抢同一个键，其中一个注册时会静默失败。
    @discardableResult
    func commit(_ field: String, _ value: String) -> Task<Void, Error>? {
        errors[field] = nil
        if let clash = HotkeyConflict.check(value, others: others(field)), clash.kind == .duplicate {
            errors[field] = model.t("prefs.hotkey.duplicate", ["name": clash.subject ?? ""])
            return nil
        }
        let pending = model.commit([field: .string(value)])
        return Task {
            do { try await pending.value } catch {
                errors[field] = SettingsRules.message(error)
                throw error
            }
        }
    }
}

// MARK: - 自建风格预设

/// 预设编辑器（`StylePresets.tsx`）：改动只落在 `editing` 上，按「保存」才写回设置——否则每次敲键盘都落盘一次，
/// 而中间状态（比如标签被清空）在 Rust 侧会被校验拦下。
@MainActor @Observable
final class StylePresetsEditor {
    @ObservationIgnored private unowned let model: SettingsModel
    var editing: CustomStyle?
    /// 温度输入框的草稿（解析在保存时做，空串不会被当场改成默认值）。
    var temperatureText = ""
    var error: String?

    init(_ model: SettingsModel) { self.model = model }

    func reset() {
        editing = nil
        temperatureText = ""
        error = nil
    }

    var list: [CustomStyle] { StylePresets.decode(model.values.array("customStyles")) }

    func startNew(now: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        edit(StylePresets.new(now: now))
    }

    func edit(_ style: CustomStyle) {
        error = nil
        editing = style
        temperatureText = SettingsRules.format(style.temperature)
    }

    func cancel() { editing = nil }

    /// 保存。Rust 侧的校验失败（比如 id 撞上内置风格）要说出来，否则用户按了保存、编辑器也关了，却什么都没存上。
    func save() async {
        guard var style = editing else { return }
        style.temperature = StylePresets.parseTemperature(temperatureText)
        await store(StylePresets.upsert(list, style)) { self.editing = nil }
    }

    func remove(_ id: String) async {
        await store(StylePresets.remove(list, id: id)) {}
    }

    private func store(_ next: [CustomStyle], then done: () -> Void) async {
        do {
            try await model.commit(["customStyles": StylePresets.encode(next)]).value
            done()
            error = nil
            // 目录里也要带上新预设，否则风格下拉框要等重开窗口才更新。
            await model.reloadStyles()
        } catch {
            self.error = SettingsRules.message(error)
        }
    }
}

// MARK: - 术语表

/// 术语表管理（`GlossaryManager.tsx`，PRD §5.8）。刻意**用「粘贴 CSV」而不是逐行表格编辑器**：
/// 用户真正的术语来源是 Excel / Numbers / 厂商给的术语表，都是复制粘贴或存成 CSV 的。
/// 除了 Tauri 版的粘贴与「复制 CSV」，这里还能从文件读入、导出成文件（文件的读写在视图层，内容同样交给 Rust 解析）。
@MainActor @Observable
final class GlossaryManager {
    @ObservationIgnored private unowned let model: SettingsModel
    private(set) var lists: [Glossary] = []
    var editing: Glossary?
    var text = ""
    var status: String?

    init(_ model: SettingsModel) { self.model = model }

    func reset() {
        editing = nil
        text = ""
        status = nil
    }

    func reload() async {
        do {
            let next = try await model.backend.glossaries()
            lists = next
            // 编辑框跟上存好的那一份；还没存过的新表不在列表里，留着
            if let current = editing { editing = next.first { $0.id == current.id } ?? current }
        } catch {
            status = model.t("prefs.glossary.loadFailed", ["reason": SettingsRules.message(error)])
        }
    }

    func startNew(now: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        status = nil
        editing = GlossaryEditor.new(now: now)
        text = ""
    }

    /// 打开编辑框时把该表现有条目反填成 TSV，用户可以就地改。
    func edit(_ glossary: Glossary) {
        status = nil
        editing = glossary
        text = GlossaryEditor.editableText(glossary)
    }

    func cancel() { editing = nil }

    /// 保存。`withEntries` 为假时只存名称与语言对、不动条目。先存表本身、再导入条目——两步分开是因为
    /// 导入失败时用户不该连表名都丢掉。
    func save(withEntries: Bool) async {
        guard let list = editing else { return }
        do {
            try await model.backend.saveGlossary(list)
            if withEntries {
                let count = try await model.backend.importGlossary(id: list.id, text: text)
                status = model.t("prefs.glossary.savedWithCount", ["name": list.name, "count": String(count)])
            } else {
                status = model.t("prefs.glossary.saved", ["name": list.name])
            }
            editing = nil
            await reload()
        } catch {
            status = SettingsRules.message(error)
        }
    }

    /// 删除（确认对话框由视图先问过）。
    func remove(_ list: Glossary) async {
        do {
            lists = try await model.backend.removeGlossary(id: list.id)
            if editing?.id == list.id { editing = nil }
            status = model.t("prefs.glossary.deleted", ["name": list.name])
        } catch {
            status = SettingsRules.message(error)
        }
    }

    /// 导出成 CSV 再放进剪贴板：用户可以直接存成文件交给同事。
    func copyCsv(_ list: Glossary) async {
        do {
            let csv = try await model.backend.exportGlossary(id: list.id)
            status = await model.backend.copyText(csv) ?? model.t("prefs.glossary.copied")
        } catch {
            status = SettingsRules.message(error)
        }
    }

    /// 导出成文件要的 CSV 文本（写文件由视图层的保存面板做）。失败时状态行写原因、返回 nil。
    func exportText(_ list: Glossary) async -> String? {
        do { return try await model.backend.exportGlossary(id: list.id) } catch {
            status = SettingsRules.message(error)
            return nil
        }
    }

    func exported(to path: String) {
        status = model.t("prefs.glossary.exportedFile", ["path": path])
    }

    /// 从文件读入的内容放进编辑框（还没保存：用户看一眼再按「保存并导入」）。没在编辑时新建一张表，表名取文件名。
    func loadFile(name: String, contents: String) {
        status = nil
        if editing == nil {
            var fresh = GlossaryEditor.new()
            fresh.name = name
            editing = fresh
        }
        text = contents
    }

    func fileFailed(_ reason: String) {
        status = model.t("prefs.glossary.fileFailed", ["reason": reason])
    }
}

// MARK: - 通用页：开机启动、配置导入导出

@MainActor @Observable
final class GeneralEditor {
    @ObservationIgnored private unowned let model: SettingsModel
    /// 导入路径不是设置项，不走「失焦才提交」：按钮要随着输入立刻可点。
    var configPath = ""
    var configNotice: String?
    var autostartError: String?

    init(_ model: SettingsModel) { self.model = model }

    func reset() {
        configPath = ""
        configNotice = nil
        autostartError = nil
    }

    func exportConfig() async {
        do {
            let path = try await model.backend.exportConfig()
            configPath = path
            configNotice = model.t("prefs.general.exported", ["path": path])
        } catch {
            configNotice = SettingsRules.message(error)
        }
    }

    var canImport: Bool { !configPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    func importConfig() async {
        let path = configPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return }
        do {
            let result = try await model.backend.importConfig(path)
            await model.imported(result)
            configNotice = SettingsRules.importNotice(result, model.t)
        } catch {
            configNotice = SettingsRules.message(error)
        }
    }
}

// MARK: - 高级页：代理、上限、历史

@MainActor @Observable
final class AdvancedEditor {
    @ObservationIgnored private unowned let model: SettingsModel
    /// 选了「自定义」但还没存过地址：只在本地展开地址栏（见 `SettingsRules.proxyChoice`）。
    var pendingCustom = false
    var proxyError: String?
    var retentionError: String?
    var limitError: String?

    init(_ model: SettingsModel) { self.model = model }

    func reset() {
        pendingCustom = false
        proxyError = nil
        retentionError = nil
        limitError = nil
    }

    var proxyMode: String { pendingCustom ? "custom" : model.values.string("proxyMode", "system") }

    func selectProxy(_ next: String) {
        proxyError = nil
        switch SettingsRules.proxyChoice(next, savedMode: model.values.string("proxyMode", "system"),
                                         savedUrl: model.values.string("proxyUrl")) {
        case .expandCustom:
            pendingCustom = true
        case .unchanged:
            pendingCustom = false
        case let .commit(mode):
            pendingCustom = false
            let pending = model.commit(["proxyMode": .string(mode)])
            Task { do { try await pending.value } catch { proxyError = SettingsRules.message(error) } }
        }
    }

    func commitProxyUrl(_ url: String) -> Task<Void, Error> {
        let pending = model.commit(["proxyMode": .string("custom"), "proxyUrl": .string(url)])
        return Task {
            try await pending.value
            pendingCustom = false
        }
    }

    /// 一个供应商的月度上限输入框。认不出的数字（「10,5」）拒绝提交并说明，草稿留着让用户改。
    func commitLimit(_ providerId: String, _ text: String) -> Task<Void, Error>? {
        if SettingsRules.isBadNumber(text) {
            limitError = model.t("prefs.invalidNumber")
            return nil
        }
        limitError = nil
        let next = SettingsRules.setLimit(model.values.array("monthlyLimits"), providerId: providerId, to: Limits.parse(text))
        return model.commit(["monthlyLimits": .array(next)])
    }

    func commitRetention(_ text: String) -> Task<Void, Error>? {
        if SettingsRules.isBadNumber(text) {
            retentionError = model.t("prefs.invalidNumber")
            return nil
        }
        retentionError = nil
        return model.commit(["historyRetentionDays": .number(Double(SettingsRules.retentionDays(text)))])
    }
}

// MARK: - 分场景模型、对比模型、备用顺序

/// 分场景模型的草稿（`SceneRouting.tsx`）：**本地草稿 + 失焦提交**。配置里不允许出现「选了供应商但模型名为空」的中间态
/// （`SceneRouting.set` 会把它当成未配置丢弃），边打字边存会让输入框刚敲进去的内容立刻被清掉。
@MainActor @Observable
final class RoutingEditor {
    @ObservationIgnored private unowned let model: SettingsModel
    var drafts: [SceneKey: ModelRef] = [:]
    /// 两个「加一条」行各自的草稿。
    var fallbackDraft = ModelRef(providerId: "", model: "")
    var compareDraft = ModelRef(providerId: "", model: "")

    init(_ model: SettingsModel) { self.model = model }

    var scenes: [String: JSONValue] { model.values.object("sceneModels") }

    /// 设置（重新）载入后，草稿跟上存好的值。
    func reset() {
        let scenes = model.values.object("sceneModels")
        drafts = Dictionary(uniqueKeysWithValues: SceneKey.allCases.map { key in
            (key, scenes[key.rawValue]?.modelRef ?? ModelRef(providerId: "", model: ""))
        })
    }

    func saved(_ key: SceneKey) -> ModelRef? { scenes[key.rawValue]?.modelRef }

    func commitScene(_ key: SceneKey) {
        let draft = drafts[key] ?? ModelRef(providerId: "", model: "")
        let next = SettingsRules.setScene(scenes, key, to: draft)
        guard next != scenes else { return }
        model.commit(["sceneModels": .object(next)])
    }

    var fallbacks: [ModelRef] { SettingsRules.modelRefs(model.values.array("fallbackModels")) }
    var compareModels: [ModelRef] { SettingsRules.modelRefs(scenes["compare"]?.arrayValue ?? []) }

    func setFallbacks(_ list: [ModelRef]) {
        model.commit(["fallbackModels": .array(list.map(JSONValue.init))])
    }

    /// 对比模型在 `sceneModels.compare` 里：只换这一个键，场景模型与未知字段原样带上。
    func setCompare(_ list: [ModelRef]) {
        var next = scenes
        next["compare"] = .array(list.map(JSONValue.init))
        model.commit(["sceneModels": .object(next)])
    }

    /// 加一条。重复项会被忽略；不管加没加上都清空输入，否则用户会以为没生效而反复点。
    func addFallback() {
        setFallbacks(SceneRouting.addFallback(fallbacks, fallbackDraft))
        fallbackDraft = ModelRef(providerId: "", model: "")
    }

    func addCompare() {
        setCompare(SceneRouting.addFallback(compareModels, compareDraft))
        compareDraft = ModelRef(providerId: "", model: "")
    }
}
