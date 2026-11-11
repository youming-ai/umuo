import AppKit
import ApplicationServices
import os

/// 前台应用：名字读缓存，标识（pid）现查。
///
/// - 名字只用来标注历史的「来源应用」与按 App 记忆，每记一条历史都要取一次，所以读
///   NSWorkspace 激活通知维护的加锁缓存，晚一拍无害。
/// - 标识是写回守卫的唯一依据，**每次调用现查** AX 系统级 `AXFocusedApplication` 的 pid
///   。激活通知经主线程 run loop 晚到，用户刚切走时
///   缓存还是旧应用，读缓存的话守卫会放行、把译文写进刚切过去的应用。
final class FrontmostApp: Sendable {
    private let name = OSAllocatedUnfairLock<String?>(initialState: nil)

    /// 用当前前台应用填好缓存并开始监听激活通知。在主线程调用一次（NSWorkspace 属于主线程）。
    @MainActor
    func start() {
        let workspace = NSWorkspace.shared
        let initial = workspace.frontmostApplication?.localizedName
        name.withLock { $0 = initial }
        // 必须挂在 NSWorkspace 自己的通知中心上：挂到 NotificationCenter.default 不报错，只是永远收不到
        workspace.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: nil
        ) { [name] notification in
            let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            let latest = app?.localizedName
            name.withLock { $0 = latest }
        }
    }

    /// 缓存里的前台应用名。只取锁，可以在任何线程上调。
    func currentName() -> String? { name.withLock { $0 } }

    /// 静默翻译写回守卫用的控件身份：同一个 AX 元素（`CFEqual`）始终换到同一个不透明令牌，不同元素的令牌不同，
    /// 所以同一应用里换了输入框也会被拒绝。
    ///
    /// 用登记表而不是只记「上一个元素」：只记一个时，取词之后只要有人对别的元素取过令牌，
    /// 用户回到原来的输入框也会换成新令牌，写回被误拒（ABA）。表按最近使用排序，只留 `focusIdentityCapacity` 个；
    /// 被挤出去的元素再来会拿到新令牌——只会多拒，不会误放。
    // AX 引用可跨线程使用，表由下方的锁保护。
    private struct FocusIdentities: @unchecked Sendable {
        var entries: [(element: AXUIElement, token: String)] = []
    }
    static let focusIdentityCapacity = 32
    private static let focusIdentities = OSAllocatedUnfairLock(initialState: FocusIdentities())

    static func focusToken(_ element: AXUIElement?) -> String? {
        guard let element else { return nil }
        return focusIdentities.withLockUnchecked { state in
            if let index = state.entries.firstIndex(where: { CFEqual($0.element, element) }) {
                let entry = state.entries.remove(at: index)
                state.entries.append(entry)
                return entry.token
            }
            let token = UUID().uuidString
            state.entries.append((element, token))
            if state.entries.count > focusIdentityCapacity { state.entries.removeFirst() }
            return token
        }
    }

    /// 现查前台应用的 pid（十进制字符串，与 `PanelController.ownToken` 同一口径）。
    /// 拿不到（没有辅助功能权限、没有前台应用）时为 nil。AX 是线程安全的 C API，工作线程上直接调。
    static func liveToken() -> String? {
        let system = AXUIElementCreateSystemWide()
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedApplicationAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        var pid: pid_t = 0
        guard AXUIElementGetPid(value as! AXUIElement, &pid) == .success, pid > 0 else { return nil }
        return String(pid)
    }
}
