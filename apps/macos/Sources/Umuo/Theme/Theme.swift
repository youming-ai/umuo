import Foundation

/// 客户端主题（PRD §7.3：浅色 / 深色 / 跟随系统，外加 §8 可访问性要的高对比度），`theme.ts` 的移植。
///
/// 主题存在**设置文件**里（`settings.json` 的 `theme`），所有窗口看到的是同一套；这里只有「选择 → 真正用哪套」这条规则。
enum ThemeChoice: String, CaseIterable, Sendable {
    case system, light, dark, highContrast

    /// 设置页的选项名（文案键与 Tauri 版 GeneralPage 的 `THEME_KEYS` 一致）。
    var titleKey: String { "prefs.theme.\(rawValue)" }
}

/// 真正要应用的主题。
enum ResolvedTheme: String, Equatable, Sendable {
    case light, dark
    case highContrast = "high-contrast"
}

extension ThemeChoice {
    /// 把设置里的值解析成真正要应用的主题。纯函数：`prefersDark` 由调用方从系统读，「跟随系统」才能测。
    /// 认不出来的值一律回落「跟随系统」——手改过的设置文件不该让界面变白。
    static func resolve(_ choice: String?, prefersDark: Bool) -> ResolvedTheme {
        switch ThemeChoice(rawValue: choice ?? "") {
        case .light: .light
        case .dark: .dark
        case .highContrast: .highContrast
        case .system, nil: prefersDark ? .dark : .light
        }
    }

    /// 系统换外观时要不要重算：只在「跟随系统」（含认不出来的值）时要，否则会把用户明选的主题顶掉。
    static func followsSystem(_ choice: String?) -> Bool {
        let parsed = ThemeChoice(rawValue: choice ?? "")
        return parsed == nil || parsed == .system
    }
}
