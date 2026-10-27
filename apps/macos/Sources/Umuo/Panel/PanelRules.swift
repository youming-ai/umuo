import CoreGraphics
import Foundation

/// 浮窗的几何与外观规则。纯函数：坐标、屏幕、系统外观都由调用方读好传进来，才能测。
enum PanelRules {
    /// 与 Tauri 版 `build_panel` 相同：初始 420×260，最小 320×150（PRD §5.2「可调整大小」，下限防止被拖成一条缝）。
    static let initialSize = CGSize(width: 420, height: 260)
    static let minSize = CGSize(width: 320, height: 150)
    /// 浮窗左上角相对鼠标的偏移（Tauri：`cursor + (14, 18)`，屏幕坐标向下为正）。
    static let cursorOffset = CGSize(width: 14, height: 18)

    /// 把浮窗放到鼠标右下方，返回窗口**左上角**（AppKit 屏幕坐标，原点在左下、y 向上）。
    ///
    /// 精确贴在选区旁边要 `AXBoundsForRange`（后续项），先用鼠标位置——用户按快捷键时光标就在选区附近。
    /// 比 Tauri 版多一步：放不下时收回屏幕里（右边贴边；下面放不下就翻到光标上方），免得浮窗一半在屏幕外。
    static func topLeft(mouse: CGPoint, size: CGSize, visible: CGRect) -> CGPoint {
        var x = mouse.x + cursorOffset.width
        var y = mouse.y - cursorOffset.height
        if x + size.width > visible.maxX { x = visible.maxX - size.width }
        x = max(x, visible.minX)
        if y - size.height < visible.minY { y = mouse.y + cursorOffset.height + size.height }
        y = min(y, visible.maxY)
        return CGPoint(x: x, y: y)
    }

    struct Appearance: Equatable {
        var locale: AppLocale
    }

    /// 设置里的界面语言 → 浮窗用哪套文案。读不到设置（Engine 还没开好）就按系统语言。
    /// 配色与外观由 `ThemeChoice.apply` 统一设到整个应用上，这里不管。
    static func appearance(settingsJson: String?, systemLanguages: [String] = Locale.preferredLanguages) -> Appearance {
        let settings = settingsJson.flatMap(JSONValue.object(json:))
        return Appearance(locale: AppLocale.resolve(setting: settings?["locale"]?.stringValue ?? "system",
                                                    systemLanguages: systemLanguages))
    }
}
