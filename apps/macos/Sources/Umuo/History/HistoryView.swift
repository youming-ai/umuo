import SwiftUI
import UmuoCore

/// 翻译历史窗（PRD §5.9 / §5.10），`apps/desktop/src/history.tsx` 的移植：页头（本月用量、两周柱状图、分页、清空、
/// 搜索与两个筛选、隐私模式提示、状态行）与两个列表。状态全在 `HistoryModel` 里；不用 `@State`（只装 CLT 时编不过）。
struct HistoryView: View {
    @Bindable var model: HistoryModel

    private var p: Palette { model.palette }
    private var t: Translate { model.t }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if model.tab == .history { historyList } else { favoritesList }
                }
            }
        }
        .frame(minWidth: 520, minHeight: 380)
        .background(p.background.color)
        .environment(\.colorScheme, model.theme.colorScheme)
    }

    // MARK: - 页头

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Text(t("history.title")).font(.system(size: 13, weight: .semibold)).foregroundStyle(p.textPrimary.color)
                Text(model.usageLine).font(.system(size: 12)).foregroundStyle(p.textMuted.color).lineLimit(1)
            }
            let bars = model.bars
            if !bars.isEmpty { chart(bars) }
            HStack(spacing: 8) {
                tabButton(t("history.tabHistory"), .history)
                tabButton(HistoryFormat.favoritesTab(count: model.favorites.count, t), .favorites)
                Spacer(minLength: 0)
                if model.tab == .history {
                    small(t("history.clear")) { Task { await model.clearAll() } }
                }
            }
            if model.tab == .history {
                HStack(spacing: 8) {
                    TextField(t("history.searchPlaceholder"), text: $model.query)
                        .textFieldStyle(.roundedBorder).font(.system(size: 13)).autocorrectionDisabled()
                    // 候选值来自历史里真正出现过的值——给他一堆选了没结果的选项更烦。
                    filter($model.appFilter, all: t("history.allSources"), options: model.facets.apps)
                    filter($model.modelFilter, all: t("history.allModels"), options: model.facets.models)
                }
                if model.privacyMode {
                    Text(t("history.privacyNotice")).font(.system(size: 12)).foregroundStyle(p.warning.color)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let status = model.status {
                Text(status).font(.system(size: 12)).foregroundStyle(p.textMuted.color).textSelection(.enabled)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(p.border.color).frame(height: 1) }
    }

    private func chart(_ bars: [HistoryFormat.DayBar]) -> some View {
        HStack(alignment: .bottom, spacing: 4) {
            ForEach(bars, id: \.day) { bar in
                VStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2).fill(p.primary.color)
                        .frame(width: 12, height: HistoryFormat.barHeight(bar.ratio))
                    Text(bar.label).font(.system(size: 9)).foregroundStyle(p.textMuted.color)
                }
                .help(HistoryFormat.dayBarTitle(bar, t))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(HistoryFormat.dayBarTitle(bar, t))
            }
        }
        .help(t("history.chartTitle"))
    }

    private func tabButton(_ label: String, _ tab: HistoryModel.Tab) -> some View {
        Button { model.tab = tab } label: {
            Text(label).font(.system(size: 12))
                .foregroundStyle((model.tab == tab ? p.textPrimary : p.textSecondary).color)
                .padding(.horizontal, 12).padding(.vertical, 4)
                .background(model.tab == tab ? p.hover.color : .clear)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }

    private func filter(_ selection: Binding<String>, all: String, options: [String]) -> some View {
        Picker(all, selection: selection) {
            Text(all).tag("")
            ForEach(options, id: \.self) { Text($0).tag($0) }
        }
        .labelsHidden().font(.system(size: 12)).frame(width: 140)
    }

    private func small(_ title: String, color: Palette.RGBA? = nil, help: String? = nil,
                       action: @escaping () -> Void) -> some View
    {
        Button(action: action) {
            Text(title).font(.system(size: 11)).foregroundStyle((color ?? p.textSecondary).color)
                .frame(minWidth: 56)
        }
        .buttonStyle(.bordered).controlSize(.small)
        .help(help ?? "")
    }

    // MARK: - 列表

    @ViewBuilder private var historyList: some View {
        if model.records.isEmpty {
            empty(HistoryFormat.emptyText(query: model.query, t))
        } else {
            ForEach(Array(model.records.enumerated()), id: \.element.id) { index, record in
                let starred = index < model.favorited.count && model.favorited[index]
                row {
                    Text(HistoryFormat.timestamp(record.createdAt)).font(.system(size: 12)).foregroundStyle(p.textMuted.color)
                    Text(record.translatedText).font(.system(size: 13)).foregroundStyle(p.textPrimary.color)
                        .textSelection(.enabled).padding(.top, 2)
                    Text(record.sourceText).font(.system(size: 12)).foregroundStyle(p.textTertiary.color).lineLimit(2)
                        .padding(.top, 2)
                    Text(HistoryFormat.recordMeta(record, t)).font(.system(size: 11)).foregroundStyle(p.textMuted.color)
                        .padding(.top, 2)
                } actions: {
                    small(starred ? t("history.starOn") : t("history.starOff"), color: starred ? p.success : nil) {
                        Task { await model.toggleFavorite(record) }
                    }
                    small(t("history.copy")) { Task { await model.copy(record.translatedText) } }
                    small(t("history.editAgain"), help: t("history.editAgainHint")) { model.editAgain(record) }
                    small(t("history.delete")) { Task { await model.delete(record.id) } }
                }
            }
        }
    }

    @ViewBuilder private var favoritesList: some View {
        if model.favorites.isEmpty {
            empty(t("history.emptyNoFavorites"))
        } else {
            ForEach(model.favorites, id: \.id) { favorite in
                row {
                    Text(favorite.text).font(.system(size: 13)).foregroundStyle(p.textPrimary.color).textSelection(.enabled)
                    if let translation = favorite.translation, !translation.isEmpty {
                        Text(translation).font(.system(size: 13)).foregroundStyle(p.textSecondary.color)
                            .textSelection(.enabled).padding(.top, 2)
                    }
                    Text(HistoryFormat.favoriteMeta(favorite, t)).font(.system(size: 11)).foregroundStyle(p.textMuted.color)
                        .padding(.top, 2)
                } actions: {
                    small(t("history.copy")) { Task { await model.copyFavorite(favorite) } }
                    small(t("history.remove")) { Task { await model.removeFavorite(favorite.id) } }
                }
            }
        }
    }

    private func row<Content: View, Actions: View>(@ViewBuilder _ content: () -> Content,
                                                   @ViewBuilder actions: () -> Actions) -> some View
    {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 0, content: content).frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 4, content: actions)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(p.borderSecondary.color).frame(height: 1) }
    }

    private func empty(_ text: String) -> some View {
        Text(text).font(.system(size: 13)).foregroundStyle(p.textTertiary.color)
            .padding(.horizontal, 16).padding(.vertical, 24)
    }
}
