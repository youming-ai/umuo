import SwiftUI
import UmuoCore

/// 翻译历史窗（PRD §5.9）：页头（隐私模式提示、状态行；没有就不占地方）与记录列表。
/// 搜索与「清空」在窗口的系统工具栏里（`HistoryWindowController`）。
/// 状态全在 `HistoryModel` 里；不用 `@State`（只装 CLT 时编不过）。
///
/// 列表是系统 `List`：选中一行后右键出「复制 / 再次编辑 / 删除」，双击复制译文，Delete 键删除；
/// 没有记录时用系统的空状态视图。窗口标题已经写明是历史，内容区不再重复一个标题。
struct HistoryView: View {
    @Bindable var model: HistoryModel

    private var t: Translate { model.t }

    var body: some View {
        VStack(spacing: 0) {
            header
            List(selection: $model.selection) {
                ForEach(model.records, id: \.id) { record in
                    row(record).tag(record.id)
                }
                // 没显示完时说清楚，并给出继续加载的入口（不带 tag：这一行不能被选中、删除）
                if model.hasMore {
                    HStack(spacing: 8) {
                        Text(t("history.shown", ["count": "\(model.records.count)"]))
                            .foregroundStyle(Color.secondary)
                        Button(t("history.loadMore")) { Task { await model.loadMore() } }
                    }
                    .font(.callout)
                    .frame(maxWidth: .infinity)
                }
            }
            .listStyle(.inset(alternatesRowBackgrounds: true))
            .contextMenu(forSelectionType: Int64.self) { ids in
                if let record = record(ids) {
                    Button(t("history.copy")) { Task { await model.copy(record.translatedText) } }
                    Button(t("history.editAgain")) { model.editAgain(record) }
                        .help(t("history.editAgainHint"))
                    Divider()
                    Button(t("history.delete"), role: .destructive) { Task { await model.delete(record.id) } }
                }
            } primaryAction: { ids in
                if let record = record(ids) { Task { await model.copy(record.translatedText) } }
            }
            .onDeleteCommand {
                if let id = model.selection { Task { await model.delete(id) } }
            }
            .overlay {
                if model.records.isEmpty {
                    ContentUnavailableView(HistoryFormat.emptyText(query: model.query, t),
                                           systemImage: model.query.isEmpty ? "clock" : "magnifyingglass")
                }
            }
        }
        .frame(minWidth: 560, minHeight: 420)
    }

    private func record(_ ids: Set<Int64>) -> HistoryRecord? {
        guard let id = ids.first else { return nil }
        return model.records.first { $0.id == id }
    }

    // MARK: - 页头

    @ViewBuilder private var header: some View {
        if model.privacyMode || model.status != nil {
            VStack(alignment: .leading, spacing: 8) {
                if model.privacyMode {
                    NoticeLine(text: t("history.privacyNotice"), systemImage: "eye.slash")
                }
                if let status = model.status {
                    Text(status).font(.callout).foregroundStyle(Color.secondary).textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
    }

    // MARK: - 一行记录：时间、译文、原文、来源与模型

    private func row(_ record: HistoryRecord) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(record.translatedText).font(.body).foregroundStyle(Color.primary)
                .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            Text(record.sourceText).font(.callout).foregroundStyle(Color.secondary).lineLimit(2)
            Text("\(HistoryFormat.timestamp(record.createdAt))  \(HistoryFormat.recordMeta(record, t))")
                .font(.caption).foregroundStyle(Color.secondary)
        }
        .padding(.vertical, 4)
    }
}
