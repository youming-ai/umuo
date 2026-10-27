import AppKit

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

import SwiftUI

extension View {
    /// 浮动窗口（划词浮窗、输入翻译窗、菜单栏面板）的底板：macOS 26 起用系统的 Liquid Glass，
    /// 更早的系统用标准材质。形状与圆角跟着系统窗口走，不另定义设计令牌。
    @ViewBuilder
    func floatingSurface(cornerRadius: CGFloat = 16) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(macOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.regularMaterial, in: shape).clipShape(shape)
        }
    }
}
