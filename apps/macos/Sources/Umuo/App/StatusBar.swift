import AppKit
import UmuoCore

/// 菜单栏图标的样式（PRD §7.3「菜单栏图标样式」，Tauri 的 `tray_icon_image` / `apply_tray_style`）。
///
/// 三份 PNG 与 Tauri 版是同一套（`Resources/Tray`）；认不出来的样式回落模板——手改配置不该让菜单栏图标消失。
/// 模板图交给系统按浅色 / 深色菜单栏着色；品牌色与黑色两套保持原色，不能标成模板，否则彩色水獭会被重画成单色。
enum TrayIcon {
    /// `settings::normalize_tray_icon_style` 的同一规则。
    static func style(_ raw: String?) -> String {
        switch raw?.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "brand": "brand"
        case "black": "black"
        default: "template"
        }
    }

    /// 资源文件名（不带扩展名）。
    static func resource(_ style: String) -> String {
        switch style {
        case "brand": "tray-brand"
        case "black": "tray-black"
        default: "tray"
        }
    }

    /// 按规范化之后的样式判断：Tauri 用原始值判断，手改成认不出的值时模板图会以非模板显示（深色菜单栏上看不见）。
    static func isTemplate(_ style: String) -> Bool { style == "template" }

    /// 资源包里那份 PNG。
    static func url(_ style: String) -> URL? {
        Bundle.module.url(forResource: resource(style), withExtension: "png", subdirectory: "Tray")
    }

    /// 读设置里的 `trayIconStyle`。
    static func style(settingsJson: String?) -> String {
        style(settingsJson.flatMap(JSONValue.object(json:))?["trayIconStyle"]?.stringValue)
    }
}

/// 点菜单栏图标要做什么（Tauri：`show_menu_on_left_click(false)`，左键开快捷面板，右键出菜单）。
enum StatusClick: Equatable {
    case quickPanel
    case menu

    /// 右键与 ⌃ 左键（触控板用户的右键）出菜单，其余开快捷面板。
    static func route(type: NSEvent.EventType?, modifiers: NSEvent.ModifierFlags) -> StatusClick {
        type == .rightMouseUp || type == .rightMouseDown || modifiers.contains(.control) ? .menu : .quickPanel
    }
}

/// 菜单栏图标与菜单（Tauri 的 `build_tray`）。用 `NSStatusItem` 而不是 SwiftUI 的 `MenuBarExtra`：
/// 后者分不出左右键，做不到「左键开快捷面板、右键出菜单」。
///
/// 菜单项与顺序与 Tauri 版逐条一致（那边的文案是写死的中文、不在文案表里，这里照抄）。
/// **不要**把菜单常挂在 `statusItem.menu` 上：挂着的话左键也弹菜单，按钮的 action 根本不触发；右键时临时挂上、弹完摘掉。
@MainActor
final class StatusBarController: NSObject {
    unowned let app: AppModel
    private let item: NSStatusItem
    private lazy var menu = makeMenu()

    /// Tauri 托盘菜单的项：标题、对应的动作。nil 是分隔线。
    enum Entry: Equatable {
        case action(HotkeyAction)
        case quick, history, settings, checkUpdates, quit
    }

    nonisolated static let entries: [(title: String, entry: Entry)?] = [
        ("翻译选中文本", .action(.selection)),
        ("输入框原地替换", .action(.silentReplace)),
        ("撰写窗", .action(.compose)),
        ("多模型对比", .action(.compare)),
        ("截图翻译", .action(.ocr)),
        ("静默 OCR（只复制原文）", .action(.ocrSilent)),
        nil,
        ("快捷面板…", .quick),
        ("翻译历史", .history),
        ("设置…", .settings),
        // Tauri `updater::IDLE_TEXT`。应用内更新随阶段 5，现在点了说明去官网下载
        ("检查更新…", .checkUpdates),
        ("退出 umuo", .quit),
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
        }
        applyStyle(settingsJson: app.settingsJson)
    }

    /// 按设置换图标（设置里改了样式当场生效，不用重启）。
    func applyStyle(settingsJson: String?) {
        let style = TrayIcon.style(settingsJson: settingsJson)
        let image = TrayIcon.url(style).flatMap(NSImage.init(contentsOf:))
            ?? NSImage(systemSymbolName: "character.bubble", accessibilityDescription: "umuo")
        // 44 px 的 PNG 按 @2x 显示：菜单栏图标 18 pt 见方
        image?.size = NSSize(width: 18, height: 18)
        image?.isTemplate = TrayIcon.isTemplate(style)
        item.button?.image = image
    }

    @objc private func clicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        switch StatusClick.route(type: event?.type, modifiers: event?.modifierFlags ?? []) {
        case .quickPanel:
            app.toggleQuickPanel()
        case .menu:
            app.hideQuickPanel()
            item.menu = menu
            sender.performClick(nil)
            item.menu = nil
        }
    }

    /// 「快捷面板…」从菜单里打开时也挂在图标下面。
    var anchor: NSView? { item.button }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        for entry in Self.entries {
            guard let entry else {
                menu.addItem(.separator())
                continue
            }
            let menuItem = NSMenuItem(title: entry.title, action: #selector(choose(_:)), keyEquivalent: "")
            menuItem.target = self
            menuItem.representedObject = Self.entries.firstIndex { $0?.title == entry.title }
            switch entry.entry {
            case .settings: menuItem.keyEquivalent = ","
            case .quit: menuItem.keyEquivalent = "q"
            default: break
            }
            menu.addItem(menuItem)
        }
        return menu
    }

    @objc private func choose(_ sender: NSMenuItem) {
        guard let index = sender.representedObject as? Int, let entry = Self.entries[index]?.entry else { return }
        switch entry {
        case let .action(action): app.actions.perform(action)
        // 菜单收起之后再弹：菜单还在跟踪鼠标时弹出的面板会被当成「点到外面」立刻收起
        case .quick: DispatchQueue.main.async { self.app.toggleQuickPanel() }
        case .history: app.openHistory()
        case .settings: app.openSettings()
        case .checkUpdates: app.checkForUpdates()
        case .quit: app.quit()
        }
    }
}
