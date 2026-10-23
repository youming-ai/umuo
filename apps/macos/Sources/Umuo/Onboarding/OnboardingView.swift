import SwiftUI
import UmuoCore

/// 首次启动引导（PRD §7.4，五步）：页头（标题、进度、五个步骤格）、
/// 当前步骤、页脚（没有引擎时的后果说明、提示、上一步 / 跳过 / 下一步或开始使用）。状态全在 `OnboardingModel` 里。
struct OnboardingView: View {
    @Bindable var model: OnboardingModel

    private var p: Palette { model.palette }
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
                Text(model.notice ?? t("onboarding.readingSettings")).font(.system(size: 13))
                    .foregroundStyle(p.textTertiary.color).padding(32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .frame(minWidth: 520, minHeight: 420)
        .background(p.background.color)
        .environment(\.colorScheme, model.theme.colorScheme)
    }

    // MARK: - 页头与页脚

    private var header: some View {
        let state = model.state
        let progress = state.progress
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text(t("onboarding.title")).font(.system(size: 13, weight: .semibold)).foregroundStyle(p.textPrimary.color)
                Text(t("onboarding.progress", ["step": "\(model.step.index + 1)", "total": "\(progress.total)",
                                               "done": "\(progress.done)"]))
                    .font(.system(size: 12)).foregroundStyle(p.textMuted.color)
            }
            HStack(spacing: 8) {
                ForEach(OnboardingStep.allCases, id: \.self) { step in
                    let current = step == model.step
                    let satisfied = step.isSatisfied(state)
                    Text(t(step.titleKey) + (satisfied ? " ✓" : ""))
                        .font(.system(size: 11))
                        .foregroundStyle((current ? p.textPrimary : satisfied ? p.textSecondary : p.textMuted).color)
                        .frame(maxWidth: .infinity).padding(.vertical, 4)
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder((current ? p.primary : p.border).color))
                }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 16)
        .overlay(alignment: .bottom) { Rectangle().fill(p.border.color).frame(height: 1) }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.state.hasUsableEngine, model.step == .practice {
                caption(t("onboarding.noEngineWarning"), p.warning)
            }
            if let notice = model.notice { caption(notice, p.textSecondary) }
            HStack(spacing: 8) {
                // 第一页没有「上一步」——那里本来就没有可回退的。其余步骤一律不拦（ARCHITECTURE §4.11）。
                PrefButton(title: t("onboarding.prev"), disabled: model.step.previous == nil, palette: p) { model.previous() }
                Spacer(minLength: 0)
                PrefButton(title: t("onboarding.skip"), palette: p) { Task { await model.finish() } }
                if model.step.next != nil {
                    PrefButton(title: t("onboarding.next"), prominent: true, palette: p) { model.next() }
                } else {
                    PrefButton(title: t("onboarding.finish"), prominent: true, palette: p) { Task { await model.finish() } }
                }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 16)
        .overlay(alignment: .top) { Rectangle().fill(p.border.color).frame(height: 1) }
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
            (t("onboarding.see"), keys("ocrHotkey", "ocrSilentHotkey"), t("onboarding.seeDesc")),
        ]
        return VStack(alignment: .leading, spacing: 16) {
            lead(t("onboarding.intro"))
            VStack(alignment: .leading, spacing: 8) {
                ForEach(items, id: \.0) { kind, keys, description in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(kind).font(.system(size: 12)).foregroundStyle(p.textTertiary.color).frame(width: 24, alignment: .leading)
                        Keycap(text: keys, palette: p)
                        Text(description).font(.system(size: 13)).foregroundStyle(p.textSecondary.color)
                    }
                }
            }
            caption(t("onboarding.walkthrough"), p.textMuted)
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
            caption(t("onboarding.languagesNote"), p.textMuted)
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
                        .textFieldStyle(.roundedBorder).font(.system(size: 13))
                        .onSubmit { Task { await model.saveKey() } }
                }
                PrefButton(title: t("onboarding.save"), prominent: true,
                           disabled: model.draftKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, palette: p) {
                    Task { await model.saveKey() }
                }
            }
            if let detail = model.draftDetail, !detail.keysUrl.isEmpty {
                Button(t("onboarding.getKey", ["provider": detail.label])) { model.backend.openURL(detail.keysUrl) }
                    .buttonStyle(.link).font(.system(size: 12))
            }
            Rectangle().fill(p.borderSecondary.color).frame(height: 1)
            caption(t("onboarding.noKeyLead"), p.textMuted)
            HStack(spacing: 8) {
                PrefButton(title: t("onboarding.detectLocal"), disabled: model.detecting, palette: p) {
                    Task { await model.detectLocal() }
                }
                if model.detecting { ProgressView().controlSize(.small) }
                if let found = model.localModel {
                    caption(t("onboarding.detectedModel", ["model": model.detectedLabel(found)]), p.success)
                }
            }
            caption(t("onboarding.stepSkippable"), p.textMuted)
        }
    }

    private var permissions: some View {
        let ocrKeys = keys("ocrHotkey", "ocrSilentHotkey")
        return VStack(alignment: .leading, spacing: 16) {
            lead(t("onboarding.permissionsLead"))
            card(t("onboarding.accessibility"), granted: model.permissions.accessibility, grantedColor: p.warning,
                 description: t("onboarding.accessibilityDesc")) {
                PrefButton(title: t("onboarding.openSystemSettings"), palette: p) {
                    model.backend.openSystemSettings(.accessibility)
                }
                PrefButton(title: t("onboarding.recheck"), palette: p) { Task { await model.recheckPermissions() } }
            }
            card(t("onboarding.screenRecording"), granted: model.permissions.screenRecording, grantedColor: p.textMuted,
                 description: t("onboarding.screenRecordingDesc", ["keys": ocrKeys])) {
                PrefButton(title: t("onboarding.requestPermission"), palette: p) {
                    Task { await model.requestScreenRecording() }
                }
                PrefButton(title: t("onboarding.openSystemSettings"), palette: p) {
                    model.backend.openSystemSettings(.screenRecording)
                }
            } footnote: {
                caption(t("onboarding.systemDialogOnce"), p.textMuted)
            }
        }
    }

    private var practice: some View {
        VStack(alignment: .leading, spacing: 16) {
            lead(t("onboarding.practiceLead"))
            Text(OnboardingModel.sampleText).font(.system(size: 13, design: .monospaced)).foregroundStyle(p.textPrimary.color)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                .background(p.surface.color)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(p.border.color))
            PrefButton(title: t("onboarding.practiceButton"), prominent: true, palette: p) { model.practice() }
            if model.practiced { caption(t("onboarding.practiceSeen"), p.success) }
            caption(t("onboarding.practiceHint"), p.textMuted)
        }
    }

    // MARK: - 积木

    private func lead(_ text: String) -> some View {
        Text(text).font(.system(size: 14)).foregroundStyle(p.textPrimary.color).fixedSize(horizontal: false, vertical: true)
    }

    private func caption(_ text: String, _ color: Palette.RGBA) -> some View {
        Text(text).font(.system(size: 12)).foregroundStyle(color.color).fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    private func labeled<Control: View>(_ title: String, @ViewBuilder _ control: () -> Control) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
            control()
        }
    }

    /// 一项权限：标题、此刻状态（未授权时辅助功能用警告色——它是唯一必需的一项；屏幕录制用弱色）、说明与按钮。
    private func card<Actions: View, Footnote: View>(_ title: String, granted: Bool?, grantedColor missing: Palette.RGBA,
                                                     description: String, @ViewBuilder actions: () -> Actions,
                                                     @ViewBuilder footnote: () -> Footnote = { EmptyView() }) -> some View
    {
        let status: (String, Palette.RGBA) = switch granted {
        case nil: (t("onboarding.reading"), p.textMuted)
        case true?: (t("onboarding.granted"), p.success)
        case false?: (t("onboarding.notGranted"), missing)
        }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(p.textPrimary.color)
                Text(status.0).font(.system(size: 12)).foregroundStyle(status.1.color)
            }
            caption(description, p.textSecondary)
            HStack(spacing: 8, content: actions)
            footnote()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.surface.color)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(p.border.color))
    }
}
