import SwiftUI
import UmuoCore

/// 首次启动引导（PRD §7.4，五步）：页头（标题、进度、五个步骤格）、
/// 当前步骤、页脚（没有引擎时的后果说明、提示、上一步 / 跳过 / 下一步或开始使用）。状态全在 `OnboardingModel` 里。
struct OnboardingView: View {
    @Bindable var model: OnboardingModel

    private var t: Translate { model.t }

    var body: some View {
        Group {
            if model.isLoaded {
                VStack(spacing: 0) {
                    header
                    ScrollView {
                        content.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 24).padding(.vertical, 20)
                    }
                    footer
                }
            } else {
                Text(model.notice ?? t("onboarding.readingSettings")).font(.body)
                    .foregroundStyle(Color.secondary).padding(32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .frame(minWidth: 520, minHeight: 420)
    }

    // MARK: - 页头与页脚

    private var header: some View {
        let state = model.state
        let progress = state.progress
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text(t("onboarding.title")).font(.headline).foregroundStyle(Color.primary)
                Text(t("onboarding.progress", ["step": "\(model.step.index + 1)", "total": "\(progress.total)",
                                               "done": "\(progress.done)"]))
                    .font(.callout).foregroundStyle(Color.secondary)
            }
            HStack(spacing: 8) {
                ForEach(OnboardingStep.allCases, id: \.self) { step in
                    let current = step == model.step
                    let satisfied = step.isSatisfied(state)
                    Label(t(step.titleKey), systemImage: satisfied ? "checkmark.circle.fill" : "circle")
                        .font(current ? .subheadline.weight(.semibold) : .subheadline)
                        .foregroundStyle(current ? Color.primary : Color.secondary)
                        .frame(maxWidth: .infinity)
                        .accessibilityAddTraits(current ? .isSelected : [])
                }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 16)
        .overlay(alignment: .bottom) { Divider() }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.state.hasUsableEngine, model.step == .practice {
                caption(t("onboarding.noEngineWarning"), Color.orange)
            }
            if let notice = model.notice { caption(notice, Color.secondary) }
            HStack(spacing: 8) {
                // 第一页没有「上一步」——那里本来就没有可回退的。其余步骤一律不拦（ARCHITECTURE §4.11）。
                PrefButton(title: t("onboarding.prev"), disabled: model.step.previous == nil) { model.previous() }
                Spacer(minLength: 0)
                PrefButton(title: t("onboarding.skip")) { Task { await model.finish() } }
                if model.step.next != nil {
                    PrefButton(title: t("onboarding.next"), prominent: true) { model.next() }
                } else {
                    PrefButton(title: t("onboarding.finish"), prominent: true) { Task { await model.finish() } }
                }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 16)
        .overlay(alignment: .top) { Divider() }
    }

    // MARK: - 五步

    @ViewBuilder private var content: some View {
        switch model.step {
        case .welcome: welcome
        case .languages: languages
        case .model: engine
        case .permissions: permissions
        case .practice: practice
        }
    }

    /// 键帽文字（`Alt+Cmd+O` → `⌥⌘O`）；同一格放两个功能时用「 / 」隔开。
    /// 引导里提到的键位一律读当前设置：默认键位换过一次，老用户的设置里仍是旧键位。
    private func keys(_ fields: String...) -> String {
        fields.map { HotkeyFormat.parts(model.values.string($0)).joined() }.joined(separator: " / ")
    }

    private var welcome: some View {
        let items: [(String, String, String)] = [
            (t("onboarding.read"), keys("selectionHotkey"), t("onboarding.readDesc")),
            (t("onboarding.write"), keys("composeHotkey", "silentReplaceHotkey"), t("onboarding.writeDesc")),
            (t("onboarding.see"), keys("ocrHotkey"), t("onboarding.seeDesc")),
        ]
        return VStack(alignment: .leading, spacing: 16) {
            lead(t("onboarding.intro"))
            VStack(alignment: .leading, spacing: 8) {
                ForEach(items, id: \.0) { kind, keys, description in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(kind).font(.callout).foregroundStyle(Color.secondary).frame(width: 24, alignment: .leading)
                        Keycap(text: keys)
                        Text(description).font(.body).foregroundStyle(Color.secondary)
                    }
                }
            }
            caption(t("onboarding.walkthrough"), Color.secondary)
        }
    }

    private var languages: some View {
        let options = Languages.all.map { ($0.code, $0.label) }
        return VStack(alignment: .leading, spacing: 16) {
            lead(t("onboarding.languagesLead"))
            labeled(t("onboarding.primaryTarget")) {
                PrefPicker(label: t("onboarding.primaryTarget"), value: model.values.string("targetLang"), options: options,
                           width: 220) { model.commit(["targetLang": .string($0)]) }
            }
            labeled(t("onboarding.secondaryTarget")) {
                PrefPicker(label: t("onboarding.secondaryTarget"), value: model.values.string("secondaryTargetLang"),
                           options: options, width: 220) { model.commit(["secondaryTargetLang": .string($0)]) }
            }
            caption(t("onboarding.languagesNote"), Color.secondary)
        }
    }

    private var engine: some View {
        VStack(alignment: .leading, spacing: 16) {
            lead(t("onboarding.modelLead"))
            HStack(alignment: .bottom, spacing: 8) {
                labeled(t("onboarding.provider")) {
                    PrefPicker(label: t("onboarding.provider"), value: model.draftProvider,
                               options: model.providers.map { ($0.id, $0.label) }, width: 180) { model.draftProvider = $0 }
                }
                labeled(t("onboarding.apiKey")) {
                    SecureField(model.keyConfigured ? t("onboarding.keyPlaceholderConfigured")
                        : t("onboarding.keyPlaceholderEmpty"), text: $model.draftKey)
                        .textFieldStyle(.roundedBorder).font(.body)
                        .onSubmit { Task { await model.saveKey() } }
                }
                PrefButton(title: t("onboarding.save"), prominent: true,
                           disabled: model.draftKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                    Task { await model.saveKey() }
                }
            }
            if let detail = model.draftDetail, !detail.keysUrl.isEmpty {
                Button(t("onboarding.getKey", ["provider": detail.label])) { model.backend.openURL(detail.keysUrl) }
                    .buttonStyle(.link).font(.callout)
            }
            Divider()
            caption(t("onboarding.noKeyLead"), Color.secondary)
            HStack(spacing: 8) {
                PrefButton(title: t("onboarding.detectLocal"), disabled: model.detecting) {
                    Task { await model.detectLocal() }
                }
                if model.detecting { ProgressView().controlSize(.small) }
                if let found = model.localModel {
                    caption(t("onboarding.detectedModel", ["model": model.detectedLabel(found)]), Color.green)
                }
            }
            caption(t("onboarding.stepSkippable"), Color.secondary)
        }
    }

    private var permissions: some View {
        let ocrKeys = keys("ocrHotkey")
        return VStack(alignment: .leading, spacing: 16) {
            lead(t("onboarding.permissionsLead"))
            card(t("onboarding.accessibility"), granted: model.permissions.accessibility, grantedColor: Color.orange,
                 description: t("onboarding.accessibilityDesc")) {
                PrefButton(title: t("onboarding.openSystemSettings")) {
                    model.backend.openSystemSettings(.accessibility)
                }
                PrefButton(title: t("onboarding.recheck")) { Task { await model.recheckPermissions() } }
            }
            card(t("onboarding.screenRecording"), granted: model.permissions.screenRecording, grantedColor: Color.secondary,
                 description: t("onboarding.screenRecordingDesc", ["keys": ocrKeys])) {
                PrefButton(title: t("onboarding.requestPermission")) {
                    Task { await model.requestScreenRecording() }
                }
                PrefButton(title: t("onboarding.openSystemSettings")) {
                    model.backend.openSystemSettings(.screenRecording)
                }
            } footnote: {
                caption(t("onboarding.systemDialogOnce"), Color.secondary)
            }
        }
    }

    private var practice: some View {
        VStack(alignment: .leading, spacing: 16) {
            lead(t("onboarding.practiceLead"))
            GroupBox {
                Text(OnboardingModel.sampleText).font(.body.monospaced())
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(8)
            }
            PrefButton(title: t("onboarding.practiceButton"), prominent: true) { model.practice() }
            if model.practiced { caption(t("onboarding.practiceSeen"), Color.green) }
            caption(t("onboarding.practiceHint"), Color.secondary)
        }
    }

    // MARK: - 积木

    private func lead(_ text: String) -> some View {
        Text(text).font(.body).foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
    }

    private func caption(_ text: String, _ color: Color) -> some View {
        Text(text).font(.callout).foregroundStyle(color).fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    private func labeled<Control: View>(_ title: String, @ViewBuilder _ control: () -> Control) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout).foregroundStyle(Color.secondary)
            control()
        }
    }

    /// 一项权限：标题、此刻状态（未授权时辅助功能用警告色——它是唯一必需的一项；屏幕录制用弱色）、说明与按钮。
    private func card<Actions: View, Footnote: View>(_ title: String, granted: Bool?, grantedColor missing: Color,
                                                     description: String, @ViewBuilder actions: () -> Actions,
                                                     @ViewBuilder footnote: () -> Footnote = { EmptyView() }) -> some View
    {
        let status: (String, Color) = switch granted {
        case nil: (t("onboarding.reading"), Color.secondary)
        case true?: (t("onboarding.granted"), Color.green)
        case false?: (t("onboarding.notGranted"), missing)
        }
        return GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(title).font(.headline)
                    Text(status.0).font(.callout).foregroundStyle(status.1)
                }
                caption(description, Color.secondary)
                HStack(spacing: 8, content: actions)
                footnote()
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
