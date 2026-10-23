import SwiftUI
import UmuoCore

/// 菜单栏快捷面板（PRD §7.1）：页头（暂停 / 恢复）、暂停提示、当前模型与「配置」、
/// 快速输入（⌘↩ 翻译）、最近翻译（点一下复制译文）、提示行。末尾多一行打开窗口的入口（历史、设置）。
struct QuickView: View {
    @Bindable var model: QuickModel

    private var p: Palette { model.palette }
    private var t: Translate { model.t }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("umuo").font(.system(size: 12, weight: .semibold)).foregroundStyle(p.textPrimary.color)
                Spacer(minLength: 0)
                small(model.paused ? t("quick.resume") : t("quick.pause"), color: model.paused ? p.warning : nil) {
                    model.togglePause()
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            divider
            if model.paused {
                Text(t("quick.pausedHint")).font(.system(size: 11)).foregroundStyle(p.warning.color)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 6)
                divider
            }
            section(t("quick.currentModel")) {
                HStack(spacing: 8) {
                    Text(model.modelLine).font(.system(size: 12)).foregroundStyle(p.textSecondary.color)
                        .lineLimit(1).truncationMode(.tail)
                    Spacer(minLength: 0)
                    small(t("quick.configure")) { model.backend.openSettings() }
                }
            }
            divider
            section(t("quick.quickInput")) {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $model.draft).font(.system(size: 12)).scrollContentBackground(.hidden)
                        .autocorrectionDisabled()
                    if model.draft.isEmpty {
                        Text(t("quick.inputPlaceholder")).font(.system(size: 12)).foregroundStyle(p.textMuted.color)
                            .padding(.leading, 5).allowsHitTesting(false)
                    }
                }
                .padding(4).frame(height: 64)
                .background(p.background.color)
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(p.border.color))
                HStack {
                    Text(t("quick.inputHint")).font(.system(size: 10)).foregroundStyle(p.textTertiary.color)
                    Spacer(minLength: 0)
                    Button { model.translate() } label: { Text(t("quick.translate")).font(.system(size: 11)) }
                        .buttonStyle(.borderedProminent).controlSize(.small)
                        .disabled(!model.canTranslate)
                        .keyboardShortcut(.return, modifiers: .command)
                }
            }
            divider
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    Text(t("quick.recent")).font(.system(size: 11)).foregroundStyle(p.textMuted.color)
                    if let state = model.state, state.recent.isEmpty {
                        Text(t("quick.noRecent")).font(.system(size: 11)).foregroundStyle(p.textTertiary.color)
                    }
                    ForEach(model.state?.recent ?? [], id: \.id) { record in
                        Button { Task { await model.copy(record) } } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(record.source).font(.system(size: 11)).foregroundStyle(p.textTertiary.color)
                                Text(record.translation).font(.system(size: 12)).foregroundStyle(p.textPrimary.color)
                            }
                            .lineLimit(1).truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .contentShape(Rectangle())
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(p.border.color))
                        }
                        .buttonStyle(.plain)
                        .help(t("quick.copyTranslation"))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 8)
            }
            .frame(maxHeight: .infinity)
            if let notice = model.notice {
                divider
                Text(notice).font(.system(size: 11)).foregroundStyle(p.textMuted.color).lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 4)
            }
            divider
            HStack(spacing: 8) {
                small(t("quick.openHistory")) { model.backend.openHistory() }
                small(t("quick.openSettings")) { model.backend.openSettings() }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
        }
        .frame(width: QuickPanelController.size.width, height: QuickPanelController.size.height)
        .background(p.background.color)
        .environment(\.colorScheme, model.theme.colorScheme)
    }

    private var divider: some View { Rectangle().fill(p.border.color).frame(height: 1) }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 11)).foregroundStyle(p.textMuted.color)
            content()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func small(_ title: String, color: Palette.RGBA? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 11)).foregroundStyle((color ?? p.textSecondary).color)
        }
        .buttonStyle(.bordered).controlSize(.small)
    }
}
