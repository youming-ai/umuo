import UmuoCore

/// `HostBridge` 的正式实现：流水线中途向宿主要的四样东西（`docs/ARCHITECTURE.md` §2.1 的 Host 表）。
///
/// 四个方法都在 Rust 的 tokio 工作线程上同步调用（§2.3），所以不碰 MainActor、不等主线程：
/// Keychain 与 AX 都是线程安全的 C API，前台应用名读加锁缓存。
final class SwiftHost: HostBridge {
    private let keychain: Keychain
    private let frontmost: FrontmostApp

    /// `keychainService` 只给 selftest 换成独立的测试服务名用，正式代码用默认值（Bundle ID）。
    init(keychainService: String = bundleId(), frontmost: FrontmostApp) {
        keychain = Keychain(service: keychainService)
        self.frontmost = frontmost
    }

    func apiKey(providerId: String) throws -> String? {
        do { return try keychain.read(account: providerId) } catch {
            // 与 Tauri 版（`PlatformError::SecretStore`）同一个前缀。
            // 要用户授权 / 解锁的情况单独一句：`read` 不弹框，得让用户知道去设置里授权。
            if error.interactionNotAllowed { throw HostFailure.Failed(detail: "凭据存储不可用：需要在设置中授权访问") }
            throw HostFailure.Failed(detail: "凭据存储不可用：\(error)")
        }
    }

    func frontmostAppName() -> String? { frontmost.currentName() }

    /// 写回守卫的依据：每次现查，不读缓存。
    func frontmostAppToken() -> String? { FrontmostApp.liveToken() }

    func writeBack(source: FocusSource, original: String, text: String) throws {
        do { try AXWriteBack.replace(source, original: original, text: text) } catch {
            throw HostFailure.Failed(detail: error.detail)
        }
    }
}
