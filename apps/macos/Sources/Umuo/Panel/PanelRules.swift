import CoreGraphics
import Foundation

/// 浮窗的几何与外观规则。纯函数：坐标、屏幕、系统外观都由调用方读好传进来，才能测。
enum PanelRules {
    /// 初始 420×260，最小 320×150（PRD §5.2「可调整大小」，下限防止被拖成一条缝）。
    static let initialSize = CGSize(width: 420, height: 260)
    static let minSize = CGSize(width: 320, height: 150)
    /// 浮窗左上角相对鼠标的偏移（14, 18），屏幕坐标向下为正。
    static let cursorOffset = CGSize(width: 14, height: 18)

    /// 把浮窗放到鼠标右下方，返回窗口**左上角**（AppKit 屏幕坐标，原点在左下、y 向上）。
    ///
    /// 精确贴在选区旁边要 `AXBoundsForRange`（后续项），先用鼠标位置——用户按快捷键时光标就在选区附近。
    /// 放不下时收回屏幕里（右边贴边；下面放不下就翻到光标上方），免得浮窗一半在屏幕外。
    static func topLeft(mouse: CGPoint, size: CGSize, visible: CGRect) -> CGPoint {
        var x = mouse.x + cursorOffset.width
        var y = mouse.y - cursorOffset.height
        if x + size.width > visible.maxX { x = visible.maxX - size.width }
        x = max(x, visible.minX)
        if y - size.height < visible.minY { y = mouse.y + cursorOffset.height + size.height }
        y = min(y, visible.maxY)
        return CGPoint(x: x, y: y)
    }
}

/// 快捷键触发的先后：取词是阻塞的（⌘C 降级最长约 1 秒），先按的键可能后取完。
///
/// 每次按键 `begin` 拿一个序号；取完时只有仍是最新的那次才显示浮窗、开始翻译。
/// 更新的浮窗内容（截图翻译、引导翻译）或用户按 Esc 时 `invalidate`：还没取完的旧按键一律作废——
/// 否则它会把浮窗挪走、把归属换成此刻的前台应用（「替换原文」就可能写进第三个应用），或把刚收起的浮窗又弹出来。
struct TriggerGate {
    private(set) var latest = 0

    mutating func begin() -> Int {
        latest += 1
        return latest
    }

    mutating func invalidate() { latest += 1 }

    func isCurrent(_ sequence: Int) -> Bool { sequence == latest }
}
