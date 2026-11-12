import SwiftUI
import UmuoCore

/// 菜单栏快捷面板（PRD §7.1）：页头（标题 + 暂停开关）、暂停提示、当前模型与「配置」、
/// 最近翻译（点一下复制译文）、提示行。末尾多一行打开窗口的入口（历史、设置）。
///
/// 使用系统分组与列表按钮，模型、最近记录与窗口入口各自分区。
struct QuickView: View {
    @Bindable var model: QuickModel

    private var t: Translate { model.t }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("umuo", systemImage: "character.bubble").font(.headline)
                Spacer(minLength: 0)
                Toggle(t("quick.pause"), isOn: Binding(get: { model.paused }, set: { _ in model.togglePause() }))
                    .toggleStyle(.switch).controlSize(.small)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            divider
            if model.paused {
                NoticeLine(text: t("quick.pausedHint"), systemImage: "pause.circle.fill")
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 8)
                divider
            }
            GroupBox {
                HStack(spacing: 8) {
                    Text(model.modelLine).font(.callout).foregroundStyle(Color.primary)
                        .lineLimit(1).truncationMode(.tail)
                    Spacer(minLength: 0)
                    link(t("quick.configure")) { model.backend.openSettings() }
                }
            } label: {
                Text(t("quick.currentModel")).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(t("quick.recent")).font(.subheadline).foregroundStyle(Color.secondary)
                        .padding(.bottom, 4)
                    if let state = model.state, state.recent.isEmpty {
                        Text(t("quick.noRecent")).font(.callout).foregroundStyle(Color.secondary)
                    }
                    let recent = model.state?.recent ?? []
                    ForEach(recent, id: \.id) { record in
                        Button { Task { await model.copy(record) } } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(record.source).font(.subheadline).foregroundStyle(Color.secondary)
                                Text(record.translation).font(.callout).foregroundStyle(Color.primary)
                            }
                            .lineLimit(1).truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.borderless)
                        .help(t("quick.copyTranslation"))
                        if record.id != recent.last?.id { divider }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16).padding(.vertical, 12)
            }
            .frame(maxHeight: .infinity)
            if let notice = model.notice {
                divider
                Text(notice).font(.callout).foregroundStyle(Color.secondary).lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 4)
            }
            divider
            HStack(spacing: 16) {
                link(t("quick.openHistory")) { model.backend.openHistory() }
                link(t("quick.openSettings")) { model.backend.openSettings() }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
        }
        // 不画底色：NSPopover 自带系统材质（macOS 26 起是 Liquid Glass）
        .frame(width: QuickPanelController.size.width, height: QuickPanelController.size.height)
    }

    private var divider: some View { Divider() }

    /// 打开窗口的入口：无边框文字按钮，与控制中心底部的「…设置」一致。
    private func link(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action).buttonStyle(.borderless).controlSize(.small)
    }
}
