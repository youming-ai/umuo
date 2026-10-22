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
        var theme: ResolvedTheme
        var locale: AppLocale
        /// 界面缩放（设置的 `uiScale`）。
        var scale: Double
    }

    /// 界面缩放的上下限：设置窗的四档（`UI_SCALES`）是 0.85–1.5。
    static let scaleRange = 0.85 ... 1.5

    /// 设置里的主题、界面语言与界面缩放 + 系统外观 → 浮窗用哪套。读不到设置（Engine 还没开好）就按系统来、不缩放。
    ///
    /// 缩放与 Tauri 的 `applyScale(settings.uiScale)` 一样取原值（不吸附到档位）；缺失、非数字、非有限或 ≤ 0 时按 1，
    /// 手改配置写进来的越界值收进档位的范围，免得浮窗被放大到不能用。
    static func appearance(settingsJson: String?, prefersDark: Bool,
                           systemLanguages: [String] = Locale.preferredLanguages) -> Appearance
    {
        let settings = settingsJson.flatMap(JSONValue.object(json:))
        let theme = ThemeChoice.resolve(settings?["theme"]?.stringValue, prefersDark: prefersDark)
        let locale = AppLocale.resolve(setting: settings?["locale"]?.stringValue ?? "system",
                                       systemLanguages: systemLanguages)
        var scale = 1.0
        if let raw = settings?["uiScale"]?.numberValue, raw.isFinite, raw > 0 {
            scale = min(max(raw, scaleRange.lowerBound), scaleRange.upperBound)
        }
        return Appearance(theme: theme, locale: locale, scale: scale)
    }
}
