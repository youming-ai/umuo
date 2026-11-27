import SwiftUI
import UmuoCore

/// 首次启动引导（PRD §7.4，五步）：页头（进度、五个步骤格）、当前步骤（系统的分组表单）、
/// 页脚（没有引擎时的后果说明、提示、上一步 / 跳过 / 下一步或开始使用）。状态全在 `OnboardingModel` 里。
struct OnboardingView: View {
    @Bindable var model: OnboardingModel

    private var t: Translate { model.t }

    var body: some View {
        Group {
            if model.isLoaded {
                VStack(spacing: 0) {
                    header
                    // 分组表单自己会滚动，不再套一层 ScrollView
                    Form { content }.formStyle(.grouped)
                    footer
                }
            } else {
                Text(model.notice ?? t("onboarding.readingSettings")).font(.body)
                    .foregroundStyle(Color.secondary).padding(32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .frame(width: OnboardingWindowController.size.width, height: OnboardingWindowController.size.height)
    }

    // MARK: - 页头与页脚

    /// 进度与五个步骤；窗口标题已经写着「欢迎使用 umuo」，这里不再重复。
    private var header: some View {
        let state = model.state
        let progress = state.progress
        return VStack(alignment: .leading, spacing: 10) {
            Text(t("onboarding.progress", ["step": "\(model.step.index + 1)", "total": "\(progress.total)",
                                           "done": "\(progress.done)"]))
                .font(.callout).foregroundStyle(Color.secondary)
            HStack(spacing: 8) {
                ForEach(OnboardingStep.allCases, id: \.self) { step in
                    let current = step == model.step
                    let satisfied = step.isSatisfied(state)
                    Label(t(step.titleKey), systemImage: satisfied ? "checkmark.circle.fill" : "circle")
                        .font(current ? .subheadline.weight(.semibold) : .subheadline)
                        .foregroundStyle(current ? Color.primary : Color.secondary)
                        .frame(maxWidth: .infinity)
                        // 完成与否只靠图标区分，读屏读不出来
                        .accessibilityValue(satisfied ? t("onboarding.stepDone") : "")
                        .accessibilityAddTraits(current ? .isSelected : [])
                }
            }
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 4)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.state.hasUsableEngine, model.step == .practice {
                NoticeLine(text: t("onboarding.noEngineWarning"), systemImage: "exclamationmark.triangle.fill")
            }
            if let notice = model.notice { NoticeLine(text: notice, systemImage: nil) }
            HStack(spacing: 8) {
                // 第一页没有「上一步」——那里本来就没有可回退的。其余步骤一律不拦（ARCHITECTURE §4.11）。
                PrefButton(title: t("onboarding.prev"), disabled: model.step.previous == nil) { model.previous() }
                Spacer(minLength: 0)
                PrefButton(title: t("onboarding.skip")) { Task { await model.finish() } }
                if model.step.next != nil {
                    PrefButton(title: t("onboarding.next"), prominent: true) { model.next() }
                        .keyboardShortcut(.defaultAction)
                } else {
                    PrefButton(title: t("onboarding.finish"), prominent: true) { Task { await model.finish() } }
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .overlay(alignment: .top) { Divider() }
    }

    // MARK: - 五步：每一步是分组表单里的几组，引导语写在组头，补充说明写在组尾

    @ViewBuilder private var content: some View {
        switch model.step {
        case .welcome: welcome
        case .languages: languages
        case .model: engine
        case .permissions: permissions
        case .practice: practice
        }
    }

    /// 快捷键文字（`Alt+Cmd+O` → `⌥⌘O`）；同一格放两个功能时用「 / 」隔开。
    /// 引导里提到的键位一律读当前设置：默认键位换过一次，老用户的设置里仍是旧键位。
    /// 清空了的键在原位写「未设置」：撰写一格放撰写与原地替换两个键，只清空一个时仍看得出是哪个；
    /// 全部清空时只写一个「未设置」（引导可以从设置的通用页重新打开，那时用户可能已经清空过）。
    private func keys(_ fields: String...) -> String {
        let values = fields.map { model.values.string($0) }
        if values.allSatisfy({ HotkeyCenter.isCleared($0) }) { return t("prefs.hotkey.unset") }
        return values.map {
            HotkeyCenter.isCleared($0) ? t("prefs.hotkey.unset")
                : HotkeyFormat.parts($0, rightLabel: t("prefs.hotkey.right")).joined()
        }
            .joined(separator: " / ")
    }

    private var welcome: some View {
        let items: [(String, String, String)] = [
            (t("onboarding.read"), keys("selectionHotkey"), t("onboarding.readDesc")),
            (t("onboarding.write"), keys("composeHotkey", "silentReplaceHotkey"), t("onboarding.writeDesc")),
            (t("onboarding.see"), keys("ocrHotkey"), t("onboarding.seeDesc")),
            (t("onboarding.speak"), keys(HotkeyCenter.voiceField, HotkeyCenter.voiceTranslateField),
             t("onboarding.speakDesc")),
        ]
        return Section {
            ForEach(items, id: \.0) { kind, keys, description in
                LabeledContent {
                    Text(keys).monospaced().foregroundStyle(Color.secondary)
                } label: {
                    Text(kind)
                    Text(description)
                }
            }
        } header: {
            lead(t("onboarding.intro"))
        } footer: {
            note(t("onboarding.walkthrough"))
        }
    }

    /// 两行的标题、说明与设置里同名的两行一致（目标语言在通用页，第二目标语言在翻译页）。
    private var languages: some View {
        Section {
            PrefRow(title: t("prefs.general.targetLang"), description: t("prefs.general.targetLangHint")) {
                LanguagePicker(label: t("prefs.general.targetLang"), value: model.values.string("targetLang")) {
                    model.commit(["targetLang": .string($0)])
                }
            }
            PrefRow(title: t("prefs.translate.secondaryLang"), description: t("prefs.translate.secondaryLangHint")) {
                LanguagePicker(label: t("prefs.translate.secondaryLang"),
                               value: model.values.string("secondaryTargetLang")) {
                    model.commit(["secondaryTargetLang": .string($0)])
                }
            }
        } header: {
            lead(t("onboarding.languagesLead"))
        } footer: {
            note(t("onboarding.languagesNote"))
        }
    }

    @ViewBuilder private var engine: some View {
        let local = model.draftDetail.map { !$0.requiresKey } ?? false
        Section {
            // 本机供应商只是草稿：真正改首选要靠下面的「检测本机模型」，它会挑一个装好的模型
            PrefRow(title: t("prefs.engine.provider"), description: local ? t("onboarding.localProviderHint") : nil) {
                PrefPicker(label: t("prefs.engine.provider"), value: model.draftProvider, options: model.providers.map {
                    ($0.id, $0.local ? t("prefs.engine.localLabel", ["name": $0.label]) : $0.label)
                }) { model.draftProvider = $0 }
            }
            // Azure 与自定义端点：先填地址与模型，Key 才有地方用（与设置的引擎页同一组文案与设置键）
            if model.needsEndpoint {
                let azure = model.draftProvider == "azure"
                let endpointTitle = t(azure ? "prefs.engine.azureEndpoint" : "prefs.engine.customBaseUrl")
                PrefRow(title: endpointTitle,
                        description: t(azure ? "prefs.engine.azureEndpointHint" : "prefs.engine.customBaseUrlHint")) {
                    DraftField(value: model.draftEndpoint,
                               placeholder: azure ? "https://<name>.openai.azure.com" : "https://gateway.internal/v1",
                               width: 280, label: endpointTitle) { model.saveEndpoint($0) }
                }
                PrefRow(title: t("prefs.engine.model"),
                        description: t(azure ? "prefs.engine.modelAzureHint" : "prefs.engine.modelHint")) {
                    TextField(t("prefs.engine.model"), text: $model.draftModel,
                              prompt: Text(model.draftDetail?.defaultModel ?? ""))
                        .textFieldStyle(.roundedBorder).labelsHidden().frame(width: 280)
                }
            }
            if !local {
                PrefRow(title: t("prefs.engine.apiKey"),
                        note: model.keyConfigured ? t("prefs.engine.keyConfigured") : t("prefs.engine.keyMissing")) {
                    SecureField(t("prefs.engine.apiKey"), text: $model.draftKey,
                                prompt: Text(model.keyConfigured ? t("prefs.engine.keyKeep") : t("prefs.engine.keyPaste")))
                        .textFieldStyle(.roundedBorder).labelsHidden().frame(width: 240)
                        .onSubmit { Task { await model.saveKey() } }
                    PrefButton(title: t("prefs.engine.keySave"),
                               disabled: model.draftKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                        Task { await model.saveKey() }
                    }
                } extra: {
                    if let detail = model.draftDetail, !detail.keysUrl.isEmpty {
                        Button(t("prefs.engine.getKey", ["name": detail.label])) { model.backend.openURL(detail.keysUrl) }
                            .buttonStyle(.link).font(.callout)
                    }
                }
            }
        } header: {
            lead(t("onboarding.modelLead"))
        }
        Section {
            LabeledContent {
                HStack(spacing: 8) {
                    if model.detecting { ProgressView().controlSize(.small) }
                    PrefButton(title: t("onboarding.detectLocal"), disabled: model.detecting) {
                        Task { await model.detectLocal() }
                    }
                }
            } label: {
                Text(t("onboarding.noKeyLead"))
                if let found = model.localModel {
                    Label(t("onboarding.detectedModel", ["model": model.detectedLabel(found)]),
                          systemImage: "checkmark.circle.fill").symbolRenderingMode(.multicolor)
                }
            }
        } footer: {
            note(t("onboarding.stepSkippable"))
        }
    }

    private var permissions: some View {
        Section {
            PermissionRow(t: t, title: t("prefs.permissions.accessibility"),
                          description: t("prefs.permissions.accessibilityHint"),
                          granted: model.permissions.accessibility) {
                PrefButton(title: t("prefs.permissions.openSettings")) {
                    model.backend.openSystemSettings(.accessibility)
                }
            }
            if model.permissions.needsInputMonitoring {
                PermissionRow(t: t, title: t("prefs.permissions.inputMonitoring"),
                              description: t("prefs.permissions.inputMonitoringHint"),
                              granted: model.permissions.inputMonitoring) {
                    PrefButton(title: t("prefs.permissions.openSettings")) {
                        model.backend.openSystemSettings(.inputMonitoring)
                    }
                }
            }
            PermissionRow(t: t, title: t("prefs.permissions.screen"),
                          description: t("onboarding.screenRecordingDesc", ["keys": keys("ocrHotkey")]),
                          granted: model.permissions.screenRecording) {
                PrefButton(title: t("prefs.permissions.request")) {
                    Task { await model.requestScreenRecording() }
                }
                PrefButton(title: t("prefs.permissions.openSettings")) {
                    model.backend.openSystemSettings(.screenRecording)
                }
            }
        } header: {
            lead(t("onboarding.permissionsLead"))
        } footer: {
            HStack(alignment: .firstTextBaseline) {
                note(t("onboarding.systemDialogOnce"))
                Spacer(minLength: 8)
                PrefButton(title: t("prefs.permissions.recheck")) { Task { await model.recheckPermissions() } }
            }
        }
    }

    private var practice: some View {
        Section {
            Text(OnboardingModel.sampleText).font(.body.monospaced()).textSelection(.enabled)
            HStack(spacing: 8) {
                PrefButton(title: t("onboarding.practiceButton")) { model.practice() }
                if model.practiced {
                    Label(t("onboarding.practiceSeen"), systemImage: "checkmark.circle.fill")
                        .symbolRenderingMode(.multicolor).foregroundStyle(Color.secondary)
                }
            }
        } header: {
            lead(t("onboarding.practiceLead"))
        } footer: {
            note(t("onboarding.practiceHint"))
        }
    }

    // MARK: - 积木

    /// 组头的引导语：正文字号、主色，不用组头默认的小号粗体。
    private func lead(_ text: String) -> some View {
        Text(text).font(.body).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
            .textCase(nil)
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.callout).foregroundStyle(Color.secondary).fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }
}
