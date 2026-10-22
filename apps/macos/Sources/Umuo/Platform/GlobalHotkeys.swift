import Carbon

/// 系统级组合键，用 Carbon 的 `RegisterEventHotKey`（与 Tauri 版背后的 `global-hotkey` 同一套 API）。
///
/// 不需要任何 TCC 权限：系统只把这一个组合键的按下通知给我们，不是在监听键盘。
/// 回调经应用的事件目标（`GetApplicationEventTarget`）在**主线程**上到达，所以整个类是 `@MainActor`。
/// 只处理按下（`kEventHotKeyPressed`）：Tauri 版也只在 `ShortcutState::Pressed` 时触发。
@MainActor
final class GlobalHotkeys {
    /// 注册失败。`description` 是日志里「：」之后那段原因。
    enum Failure: Error, Equatable, CustomStringConvertible {
        /// 键在 macOS 上没有虚拟键码。
        case unsupportedKey(String)
        /// `RegisterEventHotKey` 返回的错误码。同一进程里重复注册是 `eventHotKeyExistsErr`（-9878）；
        /// 被**别的应用**占用时 macOS 多半静默接受、只是收不到按下——那种冲突这里发现不了。
        case status(OSStatus)

        var description: String {
            switch self {
            case let .unsupportedKey(key): "\(key) 在 macOS 上不能注册为全局快捷键"
            case let .status(status): "RegisterEventHotKey failed (\(status))"
            }
        }
    }

    /// 四字符签名 `umuo`，与别的库在同一进程里注册的热键区分开。
    private static let signature: OSType = "umuo".utf8.reduce(0) { ($0 << 8) | OSType($1) }

    private var registered: [UInt32: (ref: EventHotKeyRef, action: @MainActor () -> Void)] = [:]
    /// 进程内全局递增：浮窗的 Esc 另开了一个实例，两个实例的处理器装在同一个事件目标上，id 不能撞。
    private static var nextId: UInt32 = 1
    /// 只在主线程上写；deinit 里移除，回调就不会拿到已释放的 self。
    nonisolated(unsafe) private var handler: EventHandlerRef?

    var count: Int { registered.count }

    deinit {
        if let handler { RemoveEventHandler(handler) }
    }

    /// 注册一个组合键，按下时在主线程调 `action`。
    func register(_ parsed: HotkeyCombo.Parsed, action: @escaping @MainActor () -> Void) throws(Failure) {
        let combo: HotkeyCombo
        switch parsed {
        case let .combo(value): combo = value
        case let .unsupported(key): throw .unsupportedKey(key)
        }
        installHandlerIfNeeded()
        let id = Self.nextId
        Self.nextId += 1
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(combo.keyCode, combo.modifiers, EventHotKeyID(signature: Self.signature, id: id),
                                         GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let ref else { throw .status(status) }
        registered[id] = (ref, action)
    }

    /// 注销全部。返回注销失败的错误码（有的话），调用方打日志。
    @discardableResult
    func unregisterAll() -> [OSStatus] {
        let failures = registered.values.map { UnregisterEventHotKey($0.ref) }.filter { $0 != noErr }
        registered.removeAll()
        return failures
    }

    private func installHandlerIfNeeded() {
        guard handler == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        // unretained：deinit 里会先移除这个处理器
        let me = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let event, let userData else { return OSStatus(eventNotHandledErr) }
            var hotKeyID = EventHotKeyID()
            let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                           nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
            guard status == noErr, hotKeyID.signature == GlobalHotkeys.signature else {
                return OSStatus(eventNotHandledErr)
            }
            // 不是自己注册的 id 就放行，让同一事件目标上的另一个实例接
            let handled = MainActor.assumeIsolated {
                let hotkeys = Unmanaged<GlobalHotkeys>.fromOpaque(userData).takeUnretainedValue()
                guard let action = hotkeys.registered[hotKeyID.id]?.action else { return false }
                action()
                return true
            }
            return handled ? noErr : OSStatus(eventNotHandledErr)
        }, 1, &spec, me, &handler)
    }
}
