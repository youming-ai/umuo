import Testing
@testable import Umuo

// 设计令牌的移植（packages/tokens/app.css）。AGENTS.md「设计令牌的三条硬约束」第 1 条：
// 按钮的前景 / 背景在每套主题下都要达到 WCAG AA——这里按对比度算，而不是只抄色号。

@Suite("设计令牌")
struct PaletteTests {
    private let themes: [ResolvedTheme] = [.light, .dark, .highContrast]

    @Test func 主色按钮在每套主题下都达到AA() {
        for theme in themes {
            let p = Palette.of(theme)
            let ratio = Palette.RGBA.contrast(p.primary, p.primaryForeground)
            #expect(ratio >= 4.5, "\(theme)：主色按钮对比度 \(ratio)")
        }
    }

    @Test func 正文与小字在卡片底色上都够读() {
        for theme in themes {
            let p = Palette.of(theme)
            for (name, text) in [("primary", p.textPrimary), ("secondary", p.textSecondary), ("muted", p.textMuted)] {
                let ratio = Palette.RGBA.contrast(text, p.surface)
                #expect(ratio >= 4.5, "\(theme) 的 text-\(name) 对卡片底 \(ratio)")
            }
        }
    }

    @Test func 色值与令牌文件一致() {
        // 抽几处最容易抄错的：暗色主色是 brand-500、浅色主色是 brand-700、高对比度是纯黑底
        #expect(Palette.dark.primary == .init(0x22C55E))
        #expect(Palette.light.primary == .init(0x15803D))
        #expect(Palette.highContrast.background == .init(0x000000))
        #expect(Palette.highContrast.border == .init(0xFFFFFF))
        #expect(Palette.light.textMuted == .init(0x6B7280))
    }

    @Test func 三套主题各不相同且系统控件按明暗走() {
        #expect(Palette.of(.light) != Palette.of(.dark))
        #expect(Palette.of(.dark) != Palette.of(.highContrast))
        #expect(ResolvedTheme.light.colorScheme == .light)
        #expect(ResolvedTheme.highContrast.colorScheme == .dark)
    }

    @Test func 对比度公式() {
        // 黑白是 21:1，同色是 1:1
        #expect(abs(Palette.RGBA.contrast(.init(0x000000), .init(0xFFFFFF)) - 21) < 0.01)
        #expect(Palette.RGBA.contrast(.init(0x777777), .init(0x777777)) == 1)
    }
}
