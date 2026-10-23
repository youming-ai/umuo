import SwiftUI

/// 原生客户端保留的暗色 / 浅色 / 高对比度主题令牌；旧 CSS 令牌已删除。
///
/// 只搬令牌的**取值**，不搬 CSS 的层叠：每套主题是一张完整的表，高对比度没覆盖的令牌照 CSS 的继承关系
/// 从暗色块取（`html[data-theme="high-contrast"]` 没写的变量落到 `:root`，也就是暗色）。
/// 改色值前看 AGENTS.md「设计令牌的三条硬约束」：按钮前景 / 背景在每套主题下都要达到 WCAG AA，
/// `Tests/UmuoTests/PaletteTests.swift` 按对比度守着。
struct Palette: Equatable, Sendable {
    /// sRGB 颜色，带不透明度。用数值而不是 `Color` 存，才能比较、算对比度。
    struct RGBA: Equatable, Sendable {
        let r: Double, g: Double, b: Double, a: Double

        /// `0xRRGGBB`。
        init(_ hex: UInt32, alpha: Double = 1) {
            r = Double((hex >> 16) & 0xFF) / 255
            g = Double((hex >> 8) & 0xFF) / 255
            b = Double(hex & 0xFF) / 255
            a = alpha
        }

        /// CSS 的 `rgba(r, g, b, a)`。
        init(r: Int, g: Int, b: Int, a: Double) {
            self.r = Double(r) / 255
            self.g = Double(g) / 255
            self.b = Double(b) / 255
            self.a = a
        }

        var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }

        /// WCAG 2 相对亮度（只对不透明色有意义）。
        var luminance: Double {
            func channel(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
            return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
        }

        /// WCAG 2 对比度（1…21）。
        static func contrast(_ a: RGBA, _ b: RGBA) -> Double {
            let (hi, lo) = (max(a.luminance, b.luminance), min(a.luminance, b.luminance))
            return (hi + 0.05) / (lo + 0.05)
        }
    }

    // 文本（--text-*）
    let textPrimary: RGBA
    let textSecondary: RGBA
    let textTertiary: RGBA
    let textMuted: RGBA
    // 背景（--bg-primary / --bg-surface）
    let background: RGBA
    let surface: RGBA
    // 边框（--border-primary / --border-secondary）
    let border: RGBA
    let borderSecondary: RGBA
    // 主色与压在主色上的字（--color-primary / --primary-foreground）
    let primary: RGBA
    let primaryForeground: RGBA
    // 状态（--state-*-text / -surface / -border）
    let success: RGBA
    let warning: RGBA
    let error: RGBA
    let errorSurface: RGBA
    let errorBorder: RGBA
    /// 可按压控件悬停时的底色（`.umuo-pressable:hover` 的 --surface-hover）。
    let hover: RGBA
    /// 卡片阴影（--shadow-lg：`0 20px 40px -24px rgb(0 0 0 / a)`）的不透明度。浅色主题的阴影更淡。
    let shadowOpacity: Double

    /// 圆角与字号，三套主题相同（CSS 里是 rem，1rem = 16pt）。
    enum Metric {
        /// --radius-card（1.5rem）
        static let cardRadius: CGFloat = 24
        /// --radius-control（1rem）
        static let controlRadius: CGFloat = 16
        /// Tailwind 的 text-xs / text-sm / text-base 与浮窗里的 text-[11px]
        static let caption: CGFloat = 11
        static let small: CGFloat = 12
        static let body: CGFloat = 14
        static let title: CGFloat = 16
    }

    /// 按设置的「界面缩放」（`uiScale`）放大后的 `Metric`。Tauri 版是整页 `setZoom`；这里缩放字号、圆角
    /// 与随字号走的控件高度，窗口大小不跟着变（与 WebView 缩放一样）。
    struct Metrics: Equatable {
        var scale: CGFloat = 1
        var cardRadius: CGFloat { Metric.cardRadius * scale }
        var controlRadius: CGFloat { Metric.controlRadius * scale }
        var caption: CGFloat { Metric.caption * scale }
        var small: CGFloat { Metric.small * scale }
        var body: CGFloat { Metric.body * scale }
        var title: CGFloat { Metric.title * scale }
        /// 其余跟着字号走的尺寸（例如 OCR 原文框的高度）。
        func callAsFunction(_ value: CGFloat) -> CGFloat { value * scale }
    }

    static func of(_ theme: ResolvedTheme) -> Palette {
        switch theme {
        case .dark: .dark
        case .light: .light
        case .highContrast: .highContrast
        }
    }

    /// `:root, html[data-theme="dark"]`
    static let dark = Palette(
        textPrimary: RGBA(0xF8FAFC), textSecondary: RGBA(0xCBD5E1), textTertiary: RGBA(0x94A3B8),
        textMuted: RGBA(0x94A3B8),
        background: RGBA(0x0F172A), surface: RGBA(0x1E293B),
        border: RGBA(0x334155), borderSecondary: RGBA(0x475569),
        // 暗色下主色取 brand-500（亮绿）配深色字：唯一满足对比度的组合
        primary: RGBA(0x22C55E), primaryForeground: RGBA(0x0F172A),
        success: RGBA(0x22C55E), warning: RGBA(0xF59E0B), error: RGBA(0xEF4444),
        errorSurface: RGBA(r: 239, g: 68, b: 68, a: 0.22), errorBorder: RGBA(r: 239, g: 68, b: 68, a: 0.5),
        hover: RGBA(r: 148, g: 163, b: 184, a: 0.12),
        shadowOpacity: 0.45
    )

    /// `html[data-theme="light"]`
    static let light = Palette(
        textPrimary: RGBA(0x111827), textSecondary: RGBA(0x374151), textTertiary: RGBA(0x6B7280),
        textMuted: RGBA(0x6B7280),
        background: RGBA(0xFFFFFF), surface: RGBA(0xFFFFFF),
        border: RGBA(0xE5E7EB), borderSecondary: RGBA(0xD1D5DB),
        // 浅色下主色深一档（brand-700）配白字，约 5:1
        primary: RGBA(0x15803D), primaryForeground: RGBA(0xFFFFFF),
        success: RGBA(0x22C55E), warning: RGBA(0xF59E0B), error: RGBA(0xEF4444),
        errorSurface: RGBA(r: 239, g: 68, b: 68, a: 0.1), errorBorder: RGBA(r: 239, g: 68, b: 68, a: 0.3),
        hover: RGBA(r: 15, g: 23, b: 42, a: 0.06),
        shadowOpacity: 0.18
    )

    /// `html[data-theme="high-contrast"]`；错误底色与边框它没覆盖，照 CSS 落到暗色块。
    static let highContrast = Palette(
        textPrimary: RGBA(0xFFFFFF), textSecondary: RGBA(0xE0E0E0), textTertiary: RGBA(0xC0C0C0),
        textMuted: RGBA(0xA0A0A0),
        background: RGBA(0x000000), surface: RGBA(0x1A1A1A),
        border: RGBA(0xFFFFFF), borderSecondary: RGBA(0xFFFFFF),
        primary: RGBA(0x00FF00), primaryForeground: RGBA(0x000000),
        success: RGBA(0x00FF00), warning: RGBA(0xFFFF00), error: RGBA(0xFF0000),
        errorSurface: RGBA(r: 239, g: 68, b: 68, a: 0.22), errorBorder: RGBA(r: 239, g: 68, b: 68, a: 0.5),
        hover: RGBA(r: 255, g: 255, b: 255, a: 0.16),
        shadowOpacity: 0.45
    )
}

extension ResolvedTheme {
    /// 系统控件（菜单、文本框、滚动条）跟着走的外观：高对比度是黑底，按暗色画。
    var colorScheme: ColorScheme { self == .light ? .light : .dark }
}

private struct PaletteMetricsKey: EnvironmentKey {
    static let defaultValue = Palette.Metrics()
}

extension EnvironmentValues {
    /// 当前窗口的缩放后尺寸（不用 `@Entry`：只装 Command Line Tools 时没有 SwiftUI 的宏插件）。
    var metrics: Palette.Metrics {
        get { self[PaletteMetricsKey.self] }
        set { self[PaletteMetricsKey.self] = newValue }
    }
}
