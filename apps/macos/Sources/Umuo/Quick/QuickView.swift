import SwiftUI
import UmuoCore

/// 菜单栏快捷面板（PRD §7.1）：页头（暂停 / 恢复）、暂停提示、当前模型与「配置」、
/// 最近翻译（点一下复制译文）、提示行。末尾多一行打开窗口的入口（历史、设置）。
struct QuickView: View {
    @Bindable var model: QuickModel

    private var t: Translate { model.t }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("umuo").font(.callout.weight(.semibold)).foregroundStyle(Color.primary)
                Spacer(minLength: 0)
                small(model.paused ? t("quick.resume") : t("quick.pause"), tint: model.paused ? .orange : nil) {
                    model.togglePause()
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            divider
            if model.paused {
                Text(t("quick.pausedHint")).font(.subheadline).foregroundStyle(Color.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 6)
                divider
            }
            section(t("quick.currentModel")) {
                HStack(spacing: 8) {
                    Text(model.modelLine).font(.callout).foregroundStyle(Color.secondary)
                        .lineLimit(1).truncationMode(.tail)
                    Spacer(minLength: 0)
                    small(t("quick.configure")) { model.backend.openSettings() }
                }
            }
            divider
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    Text(t("quick.recent")).font(.subheadline).foregroundStyle(Color.secondary)
                    if let state = model.state, state.recent.isEmpty {
                        Text(t("quick.noRecent")).font(.subheadline).foregroundStyle(Color.secondary)
                    }
                    ForEach(model.state?.recent ?? [], id: \.id) { record in
                        Button { Task { await model.copy(record) } } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(record.source).font(.subheadline).foregroundStyle(Color.secondary)
                                Text(record.translation).font(.callout).foregroundStyle(Color.primary)
                            }
                            .lineLimit(1).truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .contentShape(Rectangle())
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color(nsColor: .separatorColor)))
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
                Text(notice).font(.subheadline).foregroundStyle(Color.secondary).lineLimit(2)
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
        // 不画底色：NSPopover 自带系统材质（macOS 26 起是 Liquid Glass）
        .frame(width: QuickPanelController.size.width, height: QuickPanelController.size.height)
    }

    private var divider: some View { Divider() }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline).foregroundStyle(Color.secondary)
            content()
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    private func small(_ title: String, tint: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(title, action: action).buttonStyle(.bordered).controlSize(.small).tint(tint)
    }
}
