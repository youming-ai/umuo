import SwiftUI
import UmuoCore

/// 翻译历史窗（PRD §5.9）：页头（标题、清空、搜索、隐私模式提示、状态行）与记录列表。
/// 状态全在 `HistoryModel` 里；不用 `@State`（只装 CLT 时编不过）。控件、颜色、分隔线都用系统的。
struct HistoryView: View {
    @Bindable var model: HistoryModel

    private var t: Translate { model.t }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    historyList
                }
            }
        }
        .frame(minWidth: 520, minHeight: 380)
    }

    // MARK: - 页头

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(t("history.title")).font(.headline).foregroundStyle(Color.primary)
                Spacer(minLength: 0)
                small(t("history.clear")) { Task { await model.clearAll() } }
            }
            TextField(t("history.searchPlaceholder"), text: $model.query)
                .textFieldStyle(.roundedBorder).font(.body).autocorrectionDisabled()
            if model.privacyMode {
                Text(t("history.privacyNotice")).font(.callout).foregroundStyle(Color.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let status = model.status {
                Text(status).font(.callout).foregroundStyle(Color.secondary).textSelection(.enabled)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Divider() }
    }

    private func small(_ title: String, help: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).frame(minWidth: 56) }
            .buttonStyle(.bordered).controlSize(.small)
            .help(help ?? "")
    }

    // MARK: - 列表

    @ViewBuilder private var historyList: some View {
        if model.records.isEmpty {
            empty(HistoryFormat.emptyText(query: model.query, t))
        } else {
            ForEach(model.records, id: \.id) { record in
                row {
                    Text(HistoryFormat.timestamp(record.createdAt)).font(.callout).foregroundStyle(Color.secondary)
                    Text(record.translatedText).font(.body).foregroundStyle(Color.primary)
                        .textSelection(.enabled).padding(.top, 2)
                    Text(record.sourceText).font(.callout).foregroundStyle(Color.secondary).lineLimit(2)
                        .padding(.top, 2)
                    Text(HistoryFormat.recordMeta(record, t)).font(.subheadline).foregroundStyle(Color.secondary)
                        .padding(.top, 2)
                } actions: {
                    small(t("history.copy")) { Task { await model.copy(record.translatedText) } }
                    small(t("history.editAgain"), help: t("history.editAgainHint")) { model.editAgain(record) }
                    small(t("history.delete")) { Task { await model.delete(record.id) } }
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
        .overlay(alignment: .bottom) { Divider() }
    }

    private func empty(_ text: String) -> some View {
        Text(text).font(.body).foregroundStyle(Color.secondary)
            .padding(.horizontal, 16).padding(.vertical, 24)
    }
}
