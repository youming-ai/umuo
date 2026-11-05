import CoreGraphics
import Testing
@testable import Umuo

// ⌘C / ⌘V 的键码按当前布局找：应用按布局把键码翻成字符再匹配快捷键，
// Dvorak 下 ANSI 的 8 / 9 号键按住 ⌘ 打出的是 j / k（布局数据实测）。表是假的，只验查找规则。

private func layout(_ table: [CGKeyCode: String]) -> (CGKeyCode) -> String? { { table[$0] } }

struct KeyEventLayoutTests {
    @Test func QWERTY_就是ANSI位置() {
        let qwerty = layout([7: "x", 8: "c", 9: "v", 40: "k"])
        #expect(KeyEvent.commandKeyCode(for: "c", fallback: KeyEvent.keyC, translate: qwerty) == 8)
        #expect(KeyEvent.commandKeyCode(for: "v", fallback: KeyEvent.keyV, translate: qwerty) == 9)
    }

    @Test func Dvorak_改用打出c与v的那两个键() {
        let dvorak = layout([8: "j", 9: "k", 34: "c", 47: "v"])
        #expect(KeyEvent.commandKeyCode(for: "c", fallback: KeyEvent.keyC, translate: dvorak) == 34)
        #expect(KeyEvent.commandKeyCode(for: "v", fallback: KeyEvent.keyV, translate: dvorak) == 47)
    }

    @Test func 布局里没有就退回ANSI位置() {
        let none = layout([:])
        #expect(KeyEvent.commandKeyCode(for: "c", fallback: KeyEvent.keyC, translate: none) == 8)
        #expect(KeyEvent.commandKeyCode(for: "v", fallback: KeyEvent.keyV, translate: none) == 9)
    }
}

// 后台合成按键只读缓存，TIS 只在主线程读：这里验缓存与组装规则，不碰 TIS。
struct KeyEventCacheTests {
    @Test func 主线程还没读过布局时缓存给ANSI位置() {
        #expect(CommandKeyCache().current == CommandKeys(copy: 8, paste: 9))
    }

    @Test func 写入后读到新键码() {
        let cache = CommandKeyCache()
        cache.store(CommandKeys.resolve(translate: layout([8: "j", 9: "k", 34: "c", 47: "v"])))
        #expect(cache.current == CommandKeys(copy: 34, paste: 47))
    }

    @Test func 拿不到布局整组退回ANSI() {
        #expect(CommandKeys.resolve(translate: nil) == .ansi)
    }
}
