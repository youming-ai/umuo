import AppKit
import SwiftUI

/// 外观（PRD §7.3：浅色 / 深色 / 跟随系统）。颜色、字号、材质全部交给系统：不维护自己的设计令牌，
/// 高对比度走系统的「增强对比度」，所以这里只决定整个应用用哪种 `NSAppearance`。
///
/// 主题存在设置文件里（`settings.json` 的 `theme`），所有窗口看到的是同一套。旧版的 `highContrast` 与认不出的值按「跟随系统」处理。
enum ThemeChoice: String, CaseIterable, Sendable {
    case system, light, dark

    /// 设置页的选项名。
    var titleKey: String { "prefs.theme.\(rawValue)" }

    /// 设置值 → 应用外观；nil = 跟随系统。
    static func appearanceName(_ choice: String?) -> NSAppearance.Name? {
        switch ThemeChoice(rawValue: choice ?? "") {
        case .light: .aqua
        case .dark: .darkAqua
        case .system, nil: nil
        }
    }

    /// 按设置切换整个应用的外观。设置载入与每次保存后调用；各窗口不再单独指定配色。
    @MainActor
    static func apply(settingsJson: String?) {
        let choice = settingsJson.flatMap(JSONValue.object(json:))?["theme"]?.stringValue
        NSApp.appearance = appearanceName(choice).flatMap(NSAppearance.init(named:))
    }
}

extension View {
    /// 浮动面板的底板：macOS 26 使用 Liquid Glass，更早系统由 `FloatingPanelChrome` 提供材质。
    /// 内容铺满窗口，圆角与裁切交给系统窗口外壳，避免再叠一套不匹配的圆角。
    @ViewBuilder
    func floatingSurface() -> some View {
        if #available(macOS 26.0, *) {
            glassEffect(.regular, in: Rectangle())
        } else {
            self
        }
    }
}
