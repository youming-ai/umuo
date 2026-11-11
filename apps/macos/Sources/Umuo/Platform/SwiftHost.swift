import UmuoCore

/// `HostBridge` 的正式实现：流水线中途向宿主要的四样东西（`docs/ARCHITECTURE.md` §2.1 的 Host 表）。
///
/// 四个方法都在 Rust 的 tokio 工作线程上同步调用（§2.3），所以不碰 MainActor、不等主线程：
/// Keychain 与 AX 都是线程安全的 C API，前台应用名读加锁缓存。
final class SwiftHost: HostBridge {
    private let keychain: Keychain
    private let frontmost: FrontmostApp
    /// 当前界面语言（工作线程上读，加锁的值，不碰 MainActor）：交给 Rust 的失败说明按它取文案。
    private let locale: @Sendable () -> AppLocale

    /// `keychainService` 只给 selftest 换成独立的测试服务名用，正式代码用默认值（Bundle ID）。
    init(keychainService: String = bundleId(), frontmost: FrontmostApp,
         locale: @escaping @Sendable () -> AppLocale = { .source })
    {
        keychain = Keychain(service: keychainService)
        self.frontmost = frontmost
        self.locale = locale
    }

    private var t: Translate { Translate(locale: locale()) }

    func apiKey(providerId: String) throws -> String? {
        do { return try keychain.read(account: providerId) } catch {
            // 要用户操作才肯给（锁着、ACL 不信任这个签名）：`read` 不弹框，也没有单独的授权入口；
            // 在设置里重新保存一次 Key，条目就由当前这个程序写入、以后读得到。
            if error.interactionNotAllowed { throw HostFailure.Failed(detail: t("keychain.resaveKey")) }
            throw HostFailure.Failed(detail: t("keychain.unavailable", ["reason": t(error.text)]))
        }
    }

    func frontmostAppName() -> String? { frontmost.currentName() }

    /// 写回守卫的依据：每次现查，不读缓存。
    func frontmostAppToken() -> String? { FrontmostApp.focusToken(AX.focusedElement()) }

    func writeBack(source: FocusSource, original: String, text: String) throws {
        do { try AXWriteBack.replace(source, original: original, text: text) } catch {
            throw HostFailure.Failed(detail: t(error.text))
        }
    }
}
