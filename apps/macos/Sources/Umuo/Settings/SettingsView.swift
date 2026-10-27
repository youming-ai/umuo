import AppKit
import Observation
import SwiftUI

/// 设置窗的一个分区：系统的分组表单。分区切换由窗口顶部的偏好设置工具栏负责（`SettingsPaneController`），
/// 与 macOS 自带应用、TablePro 的设置窗同一种样式。状态全在 `SettingsModel` 里。
struct SettingsPane: View {
    @Bindable var model: SettingsModel
    let tab: SettingsTab
    var updater: AppUpdater? = nil

    private var t: Translate { model.t }

    var body: some View {
        Group {
            if model.isLoaded {
                Form {
                    if let error = model.saveError {
                        Section {
                            Label(t("prefs.saveFailed", ["reason": error]), systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                                .textSelection(.enabled)
                        }
                    }
                    switch tab {
                    case .general: GeneralPage(model: model)
                    case .translate: TranslatePage(model: model)
                    case .engine: EnginePage(model: model)
                    case .permissions: PermissionsPage(model: model)
                    case .advanced: AdvancedPage(model: model)
                    case .about: AboutPage(model: model, updater: updater)
                    }
                }
                .formStyle(.grouped)
            } else {
                loading
            }
        }
        .frame(minWidth: SettingsPaneController.paneSize.width, minHeight: SettingsPaneController.paneSize.height)
    }

    private var loading: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = model.loadError {
                Text(t("settings.loadError", ["reason": error])).foregroundStyle(.red).textSelection(.enabled)
                Text(t("settings.loadErrorHint")).font(.callout).foregroundStyle(.secondary)
            } else {
                ProgressView(t("settings.loading")).controlSize(.small)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// 设置窗的分区切换：`NSTabViewController` 的工具栏样式（窗口设成 `.preference` 工具栏）。
/// 选中哪一页与 `SettingsModel.tab` 双向同步：点工具栏改模型，模型里改分区（例如「翻译」页的「管理引擎」）切页。
@MainActor
final class SettingsPaneController: NSTabViewController {
    static let paneSize = NSSize(width: 640, height: 480)

    private let model: SettingsModel
    private let updater: AppUpdater?

    init(model: SettingsModel, updater: AppUpdater?) {
        self.model = model
        self.updater = updater
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) { fatalError("不从 nib 创建") }

    override func viewDidLoad() {
        super.viewDidLoad()
        tabStyle = .toolbar
        for tab in SettingsTab.allCases {
            let host = NSHostingController(rootView: SettingsPane(model: model, tab: tab, updater: updater))
            // 分区不向窗口报尺寸：窗口大小由用户决定，最小值是 `paneSize`
            host.sizingOptions = []
            host.title = model.t(tab.titleKey)
            let item = NSTabViewItem(viewController: host)
            item.label = model.t(tab.titleKey)
            item.image = NSImage(systemSymbolName: tab.symbol, accessibilityDescription: item.label)
            item.identifier = tab.rawValue
            addTabViewItem(item)
        }
        model.onTabChange = { [weak self] tab in self?.show(tab) }
        show(model.tab)
        observeLocale()
    }

    /// AppKit 的标题不参与 SwiftUI 更新；载入、切换语言、保存回滚或外部刷新后都要重新同步。
    private func observeLocale() {
        let t = withObservationTracking {
            model.t
        } onChange: { [weak self] in
            // Observation 在值写入前通知，回到主线程下一轮再读最终值并续订。
            Task { @MainActor [weak self] in self?.observeLocale() }
        }
        for (tab, item) in zip(SettingsTab.allCases, tabViewItems) {
            let label = t(tab.titleKey)
            item.viewController?.title = label
            item.label = label
            item.image = NSImage(systemSymbolName: tab.symbol, accessibilityDescription: label)
        }
        if let item = tabView.selectedTabViewItem { view.window?.title = item.label }
    }

    override func tabView(_ tabView: NSTabView, didSelect item: NSTabViewItem?) {
        super.tabView(tabView, didSelect: item)
        // 还没载入完（tab 为 nil）时添加第一项也会触发选中，那不是用户的选择
        guard model.tab != nil, let id = item?.identifier as? String, let tab = SettingsTab(rawValue: id),
              model.tab != tab else { return }
        model.tab = tab
    }

    private func show(_ tab: SettingsTab?) {
        guard isViewLoaded, let tab, let index = SettingsTab.allCases.firstIndex(of: tab),
              selectedTabViewItemIndex != index else { return }
        selectedTabViewItemIndex = index
    }
}
