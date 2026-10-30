import AppKit

/// 官网激活页的深链接 `umuo://activate?key=…`：打开设置的许可证页并填入密钥，由用户按「激活」。
/// 不自动激活：链接谁都能构造，激活（占一个设备名额）要用户自己确认。
enum LicenseDeepLink {
    /// 认得的链接返回密钥；别的 umuo:// 链接返回 nil。
    static func key(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "umuo", url.host?.lowercased() == "activate",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let key = items.first(where: { $0.name == "key" })?.value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !key.isEmpty
        else { return nil }
        return key
    }
}

/// 接系统派来的 `kAEGetURL`（Info.plist 已登记 umuo:// scheme）。SwiftUI 的 `onOpenURL` 要有窗口场景，菜单栏应用用不上。
@MainActor
final class DeepLinkReceiver: NSObject {
    private let onKey: @MainActor (String) -> Void

    init(onKey: @escaping @MainActor (String) -> Void) {
        self.onKey = onKey
        super.init()
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handle(_:withReply:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL)
        )
    }

    @objc private func handle(_ event: NSAppleEventDescriptor, withReply _: NSAppleEventDescriptor) {
        guard let text = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: text), let key = LicenseDeepLink.key(from: url) else { return }
        // 链接里的密钥不打日志
        onKey(key)
    }
}
