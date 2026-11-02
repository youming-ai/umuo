import AppKit
import UmuoCore

/// 菜单栏图标：一份模板图，交给系统按浅色 / 深色菜单栏着色。
/// 图标样式选择已退出（第五批精简）；旧配置里的 `trayIconStyle` 原样保留、不再读取。
enum TrayIcon {
    /// 资源包里那份 PNG。
    static var url: URL? {
        ResourceBundle.bundle.url(forResource: "tray", withExtension: "png", subdirectory: "Tray")
    }
}

/// 点菜单栏图标要做什么：左键开快捷面板，右键（或按住 ⌃ 点）出菜单。
enum StatusClick: Equatable {
    case quickPanel
    case menu

    /// 右键与 ⌃ 左键（触控板用户的右键）出菜单，其余开快捷面板。
    static func route(type: NSEvent.EventType?, modifiers: NSEvent.ModifierFlags) -> StatusClick {
        type == .rightMouseUp || type == .rightMouseDown || modifiers.contains(.control) ? .menu : .quickPanel
    }
}

/// 菜单栏图标与菜单。用 `NSStatusItem` 而不是 SwiftUI 的 `MenuBarExtra`：
/// 后者分不出左右键，做不到「左键开快捷面板、右键出菜单」。
///
/// 菜单只列保留的翻译入口与应用操作；标题走字符串表，每次弹出时按当前界面语言重建。
/// **不要**把菜单常挂在 `statusItem.menu` 上：挂着的话左键也弹菜单，按钮的 action 根本不触发；右键时临时挂上、弹完摘掉。
@MainActor
final class StatusBarController: NSObject, NSMenuItemValidation {
    unowned let app: AppModel
    private let item: NSStatusItem

    /// 菜单的项：文案键、对应的动作。nil 是分隔线。
    enum Entry: Equatable {
        case action(HotkeyAction)
        case quick, history, settings, checkUpdates, quit
    }

    /// 「快捷面板」直接弹出、不再要求输入，按 HIG 不带省略号；设置、检查更新会打开窗口，带省略号。
    nonisolated static let entries: [(key: String, entry: Entry)?] = [
        ("menu.selection", .action(.selection)),
        ("menu.silentReplace", .action(.silentReplace)),
        ("menu.compose", .action(.compose)),
        ("menu.ocr", .action(.ocr)),
        nil,
        ("menu.quickPanel", .quick),
        ("menu.history", .history),
        ("menu.settings", .settings),
        ("menu.checkUpdates", .checkUpdates),
        ("menu.quit", .quit),
    ]

    init(app: AppModel) {
        self.app = app
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        super.init()
        if let button = item.button {
            button.target = self
            button.action = #selector(clicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.toolTip = "umuo"
            button.setAccessibilityLabel("umuo")
        }
        let image = TrayIcon.url.flatMap(NSImage.init(contentsOf:))
            ?? NSImage(systemSymbolName: "character.bubble", accessibilityDescription: "umuo")
        image?.accessibilityDescription = "umuo"
        // 40 px 的 PNG 按 @2x 显示，避免 Retina 菜单栏再次缩放。
        image?.size = NSSize(width: 20, height: 20)
        image?.isTemplate = true
        item.button?.image = image
    }

    @objc private func clicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        switch StatusClick.route(type: event?.type, modifiers: event?.modifierFlags ?? []) {
        case .quickPanel:
            app.toggleQuickPanel()
        case .menu:
            app.hideQuickPanel()
            item.menu = makeMenu(t: app.t)
            sender.performClick(nil)
            item.menu = nil
        }
    }

    /// 「快捷面板…」从菜单里打开时也挂在图标下面。
    var anchor: NSView? { item.button }

    func makeMenu(t: Translate) -> NSMenu {
        let menu = NSMenu()
        for (index, entry) in Self.entries.enumerated() {
            guard let entry else {
                menu.addItem(.separator())
                continue
            }
            let menuItem = NSMenuItem(title: t(entry.key), action: #selector(choose(_:)), keyEquivalent: "")
            menuItem.target = self
            menuItem.representedObject = index
            switch entry.entry {
            case .settings: menuItem.keyEquivalent = ","
            case .quit: menuItem.keyEquivalent = "q"
            default: break
            }
            menu.addItem(menuItem)
        }
        return menu
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard let index = menuItem.representedObject as? Int,
              Self.entries[index]?.entry == .checkUpdates else { return true }
        return app.updater.canCheckForUpdates
    }

    @objc private func choose(_ sender: NSMenuItem) {
        guard let index = sender.representedObject as? Int, let entry = Self.entries[index]?.entry else { return }
        switch entry {
        case let .action(action): app.perform(action)
        // 菜单收起之后再弹：菜单还在跟踪鼠标时弹出的面板会被当成「点到外面」立刻收起
        case .quick: DispatchQueue.main.async { self.app.toggleQuickPanel() }
        case .history: app.openHistory()
        case .settings: app.openSettings()
        case .checkUpdates: app.checkForUpdates()
        case .quit: app.quit()
        }
    }
}
