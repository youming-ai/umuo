import SwiftUI

/// 设置窗：左侧分区、右侧分组的行（`settings.tsx` 的 `SettingsApp`）。状态全在 `SettingsModel` 里。
struct SettingsView: View {
    @Bindable var model: SettingsModel

    private var p: Palette { model.palette }
    private var t: Translate { model.t }

    var body: some View {
        Group {
            if model.isLoaded, let tab = model.tab {
                HStack(spacing: 0) {
                    sidebar(tab)
                    Rectangle().fill(p.border.color).frame(width: 1)
                    pane(tab)
                }
            } else {
                loading
            }
        }
        .frame(minWidth: 640, minHeight: 460)
        .background(p.background.color)
        .environment(\.colorScheme, model.theme.colorScheme)
    }

    private var loading: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = model.loadError {
                Text(t("settings.loadError", ["reason": error])).foregroundStyle(p.error.color).textSelection(.enabled)
                Text(t("settings.loadErrorHint")).font(.system(size: 12)).foregroundStyle(p.textTertiary.color)
            } else {
                Text(t("settings.loading")).foregroundStyle(p.textTertiary.color)
            }
        }
        .font(.system(size: 13))
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func sidebar(_ current: SettingsTab) -> some View {
        let attention = model.attention
        return VStack(alignment: .leading, spacing: 2) {
            ForEach(SettingsTab.allCases, id: \.self) { tab in
                Button {
                    model.tab = tab
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: tab.symbol).frame(width: 16).foregroundStyle(p.textSecondary.color)
                        Text(t(tab.titleKey)).font(.system(size: 13, weight: tab == current ? .medium : .regular))
                            .foregroundStyle(p.textPrimary.color)
                        Spacer(minLength: 0)
                        if attention.contains(tab) {
                            Circle().fill(p.warning.color).frame(width: 6, height: 6).help(t("prefs.attention"))
                                .accessibilityLabel(t("prefs.attention"))
                        }
                    }
                    .padding(.horizontal, 8).padding(.vertical, 6)
                    .background(tab == current ? p.hover.color : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(tab == current ? .isSelected : [])
            }
            Spacer()
        }
        .padding(12).padding(.top, 8)
        .frame(width: 192)
        .background(p.surface.color.opacity(0.6))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t("prefs.sidebar"))
    }

    private func pane(_ tab: SettingsTab) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = model.saveError {
                    Text(t("prefs.saveFailed", ["reason": error]))
                        .font(.system(size: 12)).foregroundStyle(p.error.color)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(p.errorSurface.color)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(p.errorBorder.color))
                        .textSelection(.enabled)
                }
                switch tab {
                case .general: GeneralPage(model: model)
                case .translate: TranslatePage(model: model)
                case .engine: EnginePage(model: model)
                case .permissions: PermissionsPage(model: model)
                case .advanced: AdvancedPage(model: model)
                case .about: AboutPage(model: model)
                }
            }
            .frame(maxWidth: 600, alignment: .leading)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
    }
}
