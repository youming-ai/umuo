import Foundation

/// 全局 Esc 的唯一注册者：翻译浮窗与语音浮层都要在可见期间拦 Esc（非激活面板收不到 keyDown），
/// 而同一进程里同一个组合键只能注册一次——各注册各的，后注册的一方会失败，只能点关闭按钮。
///
/// 所以由这里统一注册一次，按「最近一次认领」路由：浮窗开着时语音浮层弹出，Esc 先给语音；
/// 语音收起（交还）之后，Esc 回到仍开着的浮窗。已经认领的一方再次认领只更新处理函数、不抢到最前——
/// 浮窗在流式翻译中反复同步 Esc，不该把后弹出的语音浮层压下去。
/// 没有认领者时注销，不吞别的应用的 Esc。
@MainActor
final class EscapeRouter {
    /// 认领 Esc 的一方。
    enum Owner: String, Sendable {
        case panel, voice
    }

    /// 认领顺序（纯规则，测试直接验）。最后一个是当前接收者。
    struct Claims: Equatable {
        private(set) var order: [Owner] = []

        /// 认领：没认领过就排到最前；已认领的保持原位。
        mutating func claim(_ owner: Owner) {
            if !order.contains(owner) { order.append(owner) }
        }

        mutating func release(_ owner: Owner) {
            order.removeAll { $0 == owner }
        }

        /// Esc 该给谁。
        var top: Owner? { order.last }
    }

    private(set) var claims = Claims()
    private var handlers: [Owner: @MainActor () -> Void] = [:]
    private let key: EscapeKey

    init(key: EscapeKey = CarbonEscapeKey()) {
        self.key = key
    }

    /// 是否已在系统里注册了 Esc。
    var isArmed: Bool { key.isRegistered }

    /// 认领 Esc（可见期间）。重复调用只更新处理函数。
    func claim(_ owner: Owner, _ handler: @escaping @MainActor () -> Void) {
        handlers[owner] = handler
        claims.claim(owner)
        sync()
    }

    /// 交还 Esc（收起、钉住且空闲）。没认领过时是空操作。
    func release(_ owner: Owner) {
        handlers[owner] = nil
        claims.release(owner)
        sync()
    }

    /// 按下 Esc：交给最近认领的一方。
    func dispatch() {
        guard let owner = claims.top else { return }
        handlers[owner]?()
    }

    private func sync() {
        if claims.top == nil {
            key.unregister()
        } else if !key.isRegistered {
            do {
                try key.register { [weak self] in self?.dispatch() }
            } catch {
                // 注册不上（极少见）就退回各窗口自己的 keyDown / 关闭按钮
                print("umuo: 注册全局 Esc 失败：\(error)")
            }
        }
    }
}

/// 系统级 Esc 的注册（正式实现是 Carbon 热键；测试换成假的，不注册真实按键）。
@MainActor
protocol EscapeKey: AnyObject {
    var isRegistered: Bool { get }
    func register(_ action: @escaping @MainActor () -> Void) throws
    func unregister()
}

/// Carbon 热键（`GlobalHotkeys`，无需 TCC 权限）。
@MainActor
final class CarbonEscapeKey: EscapeKey {
    private let hotkeys = GlobalHotkeys()

    var isRegistered: Bool { hotkeys.count > 0 }

    func register(_ action: @escaping @MainActor () -> Void) throws {
        try hotkeys.register(.combo(HotkeyCombo(keyCode: PanelController.escapeKeyCode, modifiers: 0)), action: action)
    }

    func unregister() { hotkeys.unregisterAll() }
}
