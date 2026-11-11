import CoreGraphics
import Foundation

/// ⌘C 降级期间的用户操作。监听与轮询在同一个后台线程的 run loop 上，不等待主线程。
protocol ClipboardCopyWatching: AnyObject {
    func wasInterrupted() -> Bool
    func stop()
}

/// 只读、短时事件监听：用户又按键或点击鼠标后，不再把剪贴板变化认成自己的复制结果。
/// 合成的 ⌘C 带专用标记，不算用户干预；监听失效也按干预处理，保护当前剪贴板。
final class ClipboardCopyGuard: ClipboardCopyWatching {
    private final class State { var interrupted = false }
    private let state = State()
    private let port: CFMachPort
    private let source: CFRunLoopSource
    private let loop = CFRunLoopGetCurrent()

    init?() {
        let mask = [CGEventType.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
            .reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        guard let port = CGEvent.tapCreate(
            tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask,
            callback: { _, type, event, pointer in
                if let pointer,
                   type == .tapDisabledByTimeout || type == .tapDisabledByUserInput
                       || event.getIntegerValueField(.eventSourceUserData) != KeyEvent.ownEventTag {
                    Unmanaged<State>.fromOpaque(pointer).takeUnretainedValue().interrupted = true
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(state).toOpaque()
        ) else { return nil }
        guard let source = CFMachPortCreateRunLoopSource(nil, port, 0) else {
            CFMachPortInvalidate(port)
            return nil
        }
        self.port = port
        self.source = source
        CFRunLoopAddSource(loop, source, .defaultMode)
        CGEvent.tapEnable(tap: port, enable: true)
    }

    func wasInterrupted() -> Bool {
        while CFRunLoopRunInMode(.defaultMode, 0, true) == .handledSource {}
        return state.interrupted
    }

    func stop() {
        CFMachPortInvalidate(port)
        CFRunLoopRemoveSource(loop, source, .defaultMode)
    }

    deinit { stop() }
}
