import Foundation
import Security

/// API Key 的 Keychain 读写：service 是 Bundle ID（`app.umuo.desktop`），account = 供应商 id。
///
/// **必须读到已发布版本（v0.2.x）写的同一个条目**：它们都存在旧的文件 Keychain（用户的默认 Keychain）。这里用
/// `SecItem*` 查 `kSecClassGenericPassword`，**不设 `kSecUseDataProtectionKeychain`**：设了就只查
/// Data Protection Keychain，已安装用户的 Key 全部「消失」。也不设访问组，理由相同。
/// 自签名 / ad-hoc 包没有 Team ID，也拿不到 Data Protection Keychain 需要的权利；
/// 换 Developer ID 时如何迁移见 `docs/SWIFTUI-MIGRATION.md`「换签名身份时的 Key 迁移」。
///
/// 写入与删除由设置窗（`EngineSettingsBackend`）在后台调；`SwiftHost.apiKey` 只读，且**不弹框**（见 `read`）。
/// Key 不进日志：错误信息里只有状态码与系统的描述，没有 Key 本身。
struct Keychain {
    enum Failure: UserFacingError {
        enum Operation { case read, write, delete }

        case status(OSStatus, Operation)
        case notUtf8

        var text: UserText {
            switch self {
            case let .status(code, operation):
                let key = switch operation {
                case .read: "keychain.readFailed"
                case .write: "keychain.writeFailed"
                case .delete: "keychain.deleteFailed"
                }
                return UserText(key, ["code": String(code), "reason": Keychain.message(code)])
            case .notUtf8: return UserText("keychain.notUtf8")
            }
        }

        /// 系统要用户操作才肯给（默认 Keychain 锁着要解锁、条目的 ACL 不信任本程序要授权），
        /// 而 `read` 不许弹框，于是拿到这两个状态。无界面的 CI 也是这样；selftest 据此跳过而不是失败。
        var interactionNotAllowed: Bool {
            if case let .status(code, _) = self { code == errSecInteractionNotAllowed || code == errSecAuthFailed } else { false }
        }
    }

    let service: String

    /// 写与删用到的 SecItem 调用。默认是系统的；测试换成假的，不碰真 Keychain。
    struct Calls: Sendable {
        var add: @Sendable (CFDictionary) -> OSStatus = { SecItemAdd($0, nil) }
        var update: @Sendable (CFDictionary, CFDictionary) -> OSStatus = { SecItemUpdate($0, $1) }
        var delete: @Sendable (CFDictionary) -> OSStatus = { SecItemDelete($0) }
    }

    var calls = Calls()

    private func query(_ account: String) -> [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    }

    /// 读一条。「没存过」是正常状态（首次启动就是这样），返回 nil 而不是报错——与 Rust 的 `NoEntry → None` 一致。
    ///
    /// **不弹框**：它在 tokio 工作线程上被同步调用（`HostBridge` 约定不许等用户操作）。已有条目的
    /// 默认 ACL 只信任写它的那个程序，签名对不上的构建（未签名 / ad-hoc 的 `swift build`、别的签名者）
    /// 去读会弹「想要使用机密信息」，默认 Keychain 锁着会弹解锁框，都会把这次请求卡到用户点完为止。
    /// 所以读的期间关掉 Keychain 的用户交互，要交互时直接返回 `errSecInteractionNotAllowed` /
    /// `errSecAuthFailed`（`Failure.interactionNotAllowed`），宿主据此提示用户在设置里重新保存 Key。
    func read(account: String) throws(Failure) -> String? {
        var item: CFTypeRef?
        var q = query(account)
        q[kSecReturnData] = true
        q[kSecMatchLimit] = kSecMatchLimitOne
        let status = Self.withoutUserInteraction { SecItemCopyMatching(q as CFDictionary, &item) }
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw .status(status, .read) }
        guard let data = item as? Data, let text = String(data: data, encoding: .utf8) else { throw .notUtf8 }
        return text
    }

    /// 写一条：没有就新建，有就**删掉重建**（对外语义同 `keyring` 的 `set_password`：覆盖）。
    ///
    /// 为什么不 `SecItemUpdate`：旧文件 Keychain 的条目 ACL 只信任写它的那个程序，自签名构建按 cdhash 认，
    /// 每发一版 cdhash 就变，新版读旧条目拿到 `errSecAuthFailed`，提示用户「重新保存 Key」。而 update 只换数据、
    /// 不动 ACL（`encrypt` 授权对谁都开），保存成功了照样读不到。删掉重建，新条目由当前程序创建，ACL 才信任它。
    /// 删不掉（极少见）时退回 update，至少数据是新的。
    ///
    /// 与 `read` 取同一把锁（只互斥，不关交互）：否则正好碰上读的那一刻，进程级的交互开关是关着的，
    /// 本该弹授权框的写入直接拿到 `errSecInteractionNotAllowed`。可能等锁、可能弹框，**不要在主线程上调**。
    func write(account: String, secret: String) throws(Failure) {
        let data = Data(secret.utf8)
        var add = query(account)
        add[kSecValueData] = data
        let status = Self.exclusive {
            let first = calls.add(add as CFDictionary)
            guard first == errSecDuplicateItem else { return first }
            if calls.delete(query(account) as CFDictionary) == errSecSuccess { return calls.add(add as CFDictionary) }
            return calls.update(query(account) as CFDictionary, [kSecValueData: data] as CFDictionary)
        }
        guard status == errSecSuccess else { throw .status(status, .write) }
    }

    /// 删一条。删一个本来就不存在的条目算成功，否则「清空全部 Key」会中途报错（与 Rust 一致）。
    /// 锁与线程的要求同 `write`。
    func delete(account: String) throws(Failure) {
        let status = Self.exclusive { calls.delete(query(account) as CFDictionary) }
        guard status == errSecSuccess || status == errSecItemNotFound else { throw .status(status, .delete) }
    }

    /// 交互开关是进程级的（旧文件 Keychain 只认这个；`kSecUseAuthenticationUI` / `LAContext` 管不到
    /// 旧 Keychain 的 ACL 授权框），所以加锁串行，用完恢复原值，不影响别处有意的交互式调用。
    ///
    /// `SecKeychainSetUserInteractionAllowed` 自 macOS 10.10 起标为弃用（编译有警告），目前仍是关掉旧文件 Keychain
    /// 授权框的唯一办法。**待真机实测**：macOS 14 与 26 上读 ad-hoc 签名构建写不进 ACL 的条目时，
    /// 确实返回 `errSecInteractionNotAllowed` / `errSecAuthFailed` 而不弹框、不卡住工作线程。
    ///
    /// 写 / 删也取这把锁（`exclusive`，不碰交互开关）。持锁期间都不等主线程，读在 tokio 工作线程、写删在
    /// `Task.detached`，不会互相卡死；代价是写入弹授权框期间，同时到来的读会等到用户点完。
    static let interactionLock = NSLock()

    private static func exclusive(_ body: () -> OSStatus) -> OSStatus {
        interactionLock.lock()
        defer { interactionLock.unlock() }
        return body()
    }

    private static func withoutUserInteraction(_ body: () -> OSStatus) -> OSStatus {
        interactionLock.lock()
        defer { interactionLock.unlock() }
        var previous: DarwinBoolean = true
        let got = SecKeychainGetUserInteractionAllowed(&previous)
        SecKeychainSetUserInteractionAllowed(false)
        defer { SecKeychainSetUserInteractionAllowed(got == errSecSuccess ? previous.boolValue : true) }
        return body()
    }

    static func message(_ status: OSStatus) -> String {
        (SecCopyErrorMessageString(status, nil) as String?) ?? "OSStatus \(status)"
    }
}
