import SwiftUI

/// 应用外壳。菜单栏图标与菜单是 `StatusBarController`（`NSStatusItem`）：SwiftUI 的 `MenuBarExtra` 分不出左右键，
/// 做不到 Tauri 版的「左键开快捷面板、右键出菜单」。窗口全部由 AppKit 控制器管理，这里只留一个不会出现的场景。
struct UmuoApp: App {
    // 不用 @State：只装 Command Line Tools 时 SwiftUI 的宏插件不在，@State 编不过。App 只创建一次。
    private let model: AppModel

    init() {
        model = AppModel()
        model.start()
    }

    var body: some Scene {
        // 不插进菜单栏的空 MenuBarExtra：什么都不显示，也不像 `Settings` 场景那样往主菜单塞一个 ⌘, 「设置…」
        // （历史窗等窗口是 key 时 ⌘, 会打开一个空的 SwiftUI 设置窗）。设置窗是 SettingsWindowController
        MenuBarExtra("umuo", systemImage: "character.bubble", isInserted: .constant(false)) { EmptyView() }
    }
}
