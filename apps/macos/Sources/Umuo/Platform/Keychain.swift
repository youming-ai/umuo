import Foundation
import Security

/// API Key 的 Keychain 读写：service 是 Bundle ID（`app.umuo.desktop`），account = 供应商 id。
///
/// **必须读到 Tauri 版写的同一个条目**。Tauri 用 `keyring` 3（apple-native），它走的是旧的文件 Keychain
/// （`SecKeychainAddGenericPassword` / `find_generic_password`，用户的默认 Keychain）。这里用
/// `SecItem*` 查 `kSecClassGenericPassword`，**不设 `kSecUseDataProtectionKeychain`**：设了就只查
/// Data Protection Keychain，老用户的 Key 全部「消失」。也不设访问组，理由相同。
///
/// 写入与删除留给以后的设置窗口；`SwiftHost.apiKey` 只读，且**不弹框**（见 `read`）。
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

    private func query(_ account: String) -> [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    }

    /// 读一条。「没存过」是正常状态（首次启动就是这样），返回 nil 而不是报错——与 Rust 的 `NoEntry → None` 一致。
    ///
    /// **不弹框**：它在 tokio 工作线程上被同步调用（`HostBridge` 约定不许等用户操作）。Tauri 版写的条目
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

    /// 写一条：没有就新建，有就覆盖（`keyring` 的 `set_password` 也是这个语义）。
    func write(account: String, secret: String) throws(Failure) {
        let data = Data(secret.utf8)
        var add = query(account)
        add[kSecValueData] = data
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecSuccess { return }
        guard status == errSecDuplicateItem else { throw .status(status, .write) }
        let updated = SecItemUpdate(query(account) as CFDictionary, [kSecValueData: data] as CFDictionary)
        guard updated == errSecSuccess else { throw .status(updated, .write) }
    }

    /// 删一条。删一个本来就不存在的条目算成功，否则「清空全部 Key」会中途报错（与 Rust 一致）。
    func delete(account: String) throws(Failure) {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw .status(status, .delete) }
    }

    /// 交互开关是进程级的（旧文件 Keychain 只认这个；`kSecUseAuthenticationUI` / `LAContext` 管不到
    /// 旧 Keychain 的 ACL 授权框），所以加锁串行，用完恢复原值，不影响别处有意的交互式调用。
    ///
    /// `SecKeychainSetUserInteractionAllowed` 自 macOS 10.10 起标为弃用（编译有警告），目前仍是关掉旧文件 Keychain
    /// 授权框的唯一办法。**待真机实测**：macOS 14 与 26 上读 ad-hoc 签名构建写不进 ACL 的条目时，
    /// 确实返回 `errSecInteractionNotAllowed` / `errSecAuthFailed` 而不弹框、不卡住工作线程。
    private static let interactionLock = NSLock()

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
