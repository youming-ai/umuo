import AppKit
import Observation
import SwiftUI

/// 设置详情：系统分组表单与固定标题，导航由左侧边栏负责。状态全在 `SettingsModel` 里。
struct SettingsPane: View {
    @Bindable var model: SettingsModel
    let tab: SettingsTab
    var updater: AppUpdater? = nil

    private var t: Translate { model.t }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(t(tab.titleKey)).font(.title2.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, 24).padding(.top, 22).padding(.bottom, 4)
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
        .frame(minWidth: SettingsPaneController.detailMinSize.width, minHeight: SettingsPaneController.detailMinSize.height)
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

/// 原生分栏设置窗：侧栏始终可见，右侧复用各分区视图，避免切页丢掉正在编辑的草稿。
@MainActor
final class SettingsPaneController: NSSplitViewController {
    static let detailMinSize = NSSize(width: 560, height: 480)
    static let paneSize = NSSize(width: 760, height: 480)

    private let model: SettingsModel
    private let updater: AppUpdater?
    private let pages = NSTabViewController()
    var tabViewItems: [NSTabViewItem] { pages.tabViewItems }
    var selectedTabViewItemIndex: Int { pages.selectedTabViewItemIndex }

    init(model: SettingsModel, updater: AppUpdater?) {
        self.model = model
        self.updater = updater
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) { fatalError("不从 nib 创建") }

    override func viewDidLoad() {
        super.viewDidLoad()
        pages.tabStyle = .unspecified
        for tab in SettingsTab.allCases {
            let host = NSHostingController(rootView: SettingsPane(model: model, tab: tab, updater: updater))
            host.sizingOptions = []
            let item = NSTabViewItem(viewController: host)
            item.identifier = tab.rawValue
            pages.addTabViewItem(item)
        }
        let sidebar = NSHostingController(rootView: SettingsSidebar(model: model))
        sidebar.sizingOptions = []
        let navigation = NSSplitViewItem(sidebarWithViewController: sidebar)
        navigation.minimumThickness = 180
        navigation.maximumThickness = 220
        navigation.canCollapse = false
        addSplitViewItem(navigation)
        let detail = NSSplitViewItem(viewController: pages)
        detail.minimumThickness = Self.detailMinSize.width
        addSplitViewItem(detail)
        model.onTabChange = { [weak self] tab in self?.show(tab) }
        show(model.tab)
        observeLocale()
    }

    /// AppKit 的窗口与分区标题不参与 SwiftUI 更新，语言变化后重新同步。
    private func observeLocale() {
        let t = withObservationTracking {
            model.t
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.observeLocale() }
        }
        for (tab, item) in zip(SettingsTab.allCases, tabViewItems) {
            let label = t(tab.titleKey)
            item.viewController?.title = label
            item.label = label
            item.image = NSImage(systemSymbolName: tab.symbol, accessibilityDescription: label)
        }
        updateTitle()
    }

    private func show(_ tab: SettingsTab?) {
        guard isViewLoaded, let tab, let index = SettingsTab.allCases.firstIndex(of: tab) else { return }
        pages.selectedTabViewItemIndex = index
        updateTitle()
    }

    private func updateTitle() {
        guard let tab = model.tab else { return }
        title = model.t(tab.titleKey)
        view.window?.title = title ?? "umuo"
    }
}

/// 系统侧栏列表保留原生选中、方向键导航与 VoiceOver 行语义。
private struct SettingsSidebar: View {
    @Bindable var model: SettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("umuo", systemImage: "character.bubble")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 18).padding(.top, 22)
            List(selection: Binding(get: { model.tab }, set: { if let tab = $0 { model.tab = tab } })) {
                ForEach(SettingsTab.allCases, id: \.self) { tab in
                    Label(model.t(tab.titleKey), systemImage: tab.symbol)
                        .padding(.vertical, 5)
                        .tag(tab)
                }
            }
            .listStyle(.sidebar)
        }
    }
}
