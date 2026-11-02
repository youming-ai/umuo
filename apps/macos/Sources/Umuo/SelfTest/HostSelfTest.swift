import AppKit
import ApplicationServices
import Foundation
import UmuoCore

/// `--selftest` 的宿主部分：`SwiftHost` 的四个方法。
///
/// **不碰真实的 Key**：Keychain 往返用独立的测试服务名 `app.umuo.desktop.selftest`，
/// 账号每次随机，结束时删除。写回只用一段不可能匹配的「原文」去试，验证的是拒绝路径，
/// 不会改动当前聚焦的输入框。需要辅助功能权限的项在没授权时（未签名的 swift build、CI）明确打印跳过。
enum HostSelfTest {
    static let testService = "\(bundleId()).selftest"

    @MainActor
    static func run(_ check: (String, Bool, String) -> Void) {
        check("bundleId", bundleId() == "app.umuo.desktop", "Keychain 服务名 = \(bundleId())")

        let frontmost = FrontmostApp()
        frontmost.start()
        let host = SwiftHost(keychainService: testService, frontmost: frontmost)

        keychainRoundTrip(host, check)

        // 名字：无界面会话里可能根本没有前台应用，这时跳过而不是失败
        if let name = host.frontmostAppName() {
            check("frontmostAppName", !name.isEmpty, name)
        } else {
            print("- frontmostAppName: skipped: no frontmost app (no GUI session)")
        }

        pureChecks(check)

        let trusted = AXIsProcessTrusted()
        if trusted {
            // CI 这类无交互会话有辅助功能权限，AX 却查不到聚焦的应用：与上面的名字一样跳过，不算失败
            if let token = host.frontmostAppToken() {
                check("frontmostAppToken", Int32(token).map { $0 > 0 } ?? false, "pid=\(token)（AX 现查）")
            } else {
                print("- frontmostAppToken: skipped: AX reports no focused application (no interactive session)")
            }
            // 原文是随机串，不可能与聚焦元素的内容相同：只能被拒绝，绝不会写进去
            let refused = refusal { try host.writeBack(source: .selection, original: UUID().uuidString, text: "x") }
            // 只能证明「没有写进去」：拒绝也可能来自可写性检查（例如终端里的只读选区），
            // 「原文变了就不写」那道检查由 pureChecks 逐条覆盖
            check("writeBack", refused != nil, "不会写进别处：\(refused ?? "竟然写进去了")")
        } else {
            print("- frontmostAppToken: skipped: needs Accessibility permission")
            print("- writeBack: skipped: needs Accessibility permission")
            // 没有权限时的拒绝本身可以断言：与 Rust 的 PermissionDenied 同一句话
            let refused = refusal { try host.writeBack(source: .wholeField, original: "a", text: "b") }
            check("writeBack.untrusted", refused == "需要系统权限：辅助功能", refused ?? "没有拒绝")
        }
    }

    /// 写 → 读 → 覆盖 → 读 → 删 → 读到 nil → 再删也不报错。读走 `SwiftHost.apiKey`，即正式路径。
    static func keychainRoundTrip(_ host: SwiftHost, _ check: (String, Bool, String) -> Void) {
        let keychain = Keychain(service: testService)
        let account = "selftest-\(UUID().uuidString)"
        defer { try? keychain.delete(account: account) }
        do {
            check("apiKey.missing", try host.apiKey(providerId: account) == nil, "没存过 → nil，不报错")
            try keychain.write(account: account, secret: "sk-一")
            let first = try host.apiKey(providerId: account)
            try keychain.write(account: account, secret: "sk-二")
            let second = try host.apiKey(providerId: account)
            try keychain.delete(account: account)
            let gone = try host.apiKey(providerId: account)
            try keychain.delete(account: account)
            check("Keychain", first == "sk-一" && second == "sk-二" && gone == nil,
                  "\(testService)：写入、覆盖、删除、重复删除")
        } catch let error as Keychain.Failure where error.interactionNotAllowed {
            print("- Keychain: skipped: default keychain locked (no user session)")
        } catch HostFailure.Failed(detail: "凭据存储不可用：需要在设置中授权访问") {
            // 读不弹框：锁着或要授权时 apiKey 给出这一句而不是卡住
            print("- Keychain: skipped: read needs user interaction (locked or not authorized)")
        } catch {
            check("Keychain", false, "\(error)")
        }
    }

    /// 写回的两道检查，与 `selection.rs` 的单测同一张表。
    static func pureChecks(_ check: (String, Bool, String) -> Void) {
        func passes(_ body: () throws -> Void) -> Bool { (try? body()) != nil }
        let writable = passes { try AXWriteBack.checkWritable(.selection, true) }
            && passes { try AXWriteBack.checkWritable(.selection, nil) }
            && !passes { try AXWriteBack.checkWritable(.selection, false) }
            && passes { try AXWriteBack.checkWritable(.wholeField, true) }
            && !passes { try AXWriteBack.checkWritable(.wholeField, nil) }
            && !passes { try AXWriteBack.checkWritable(.wholeField, false) }
        var unchanged = true
        for source in [FocusSource.selection, .wholeField] {
            unchanged = unchanged && passes { try AXWriteBack.checkUnchanged(source, "hello", "hello") }
            for current in ["", "hello world", nil] as [String?] {
                unchanged = unchanged && !passes { try AXWriteBack.checkUnchanged(source, current, "hello") }
            }
        }
        check("AXWriteBack.checks",
              writable && unchanged && AXWriteBack.attribute(.selection) == "AXSelectedText"
                  && AXWriteBack.attribute(.wholeField) == "AXValue",
              "选区问不出来放行、整框必须明确可写；原文变了一律不写")
    }

    static func refusal(_ body: () throws -> Void) -> String? {
        do { try body(); return nil } catch let HostFailure.Failed(detail) { return detail } catch { return "\(error)" }
    }
}
