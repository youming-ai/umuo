import Foundation
import SwiftUI
import Testing
import UmuoCore
@testable import Umuo

// 买断许可证与 7 天试用：内存 Keychain + 假网络 + 可拨的时钟，不碰真实 Keychain、不访问 umuo.app。

private let day: TimeInterval = 86400

/// 内存里的 Keychain。`failReads` 模拟钥匙串锁着 / 签名变了要授权。
private final class MemoryStore: LicenseSecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: String] = [:]
    var failReads = false

    struct Locked: Error {}

    subscript(account: String) -> String? {
        lock.withLock { items[account] }
    }

    func read(_ account: String) throws -> String? {
        try lock.withLock {
            if failReads { throw Locked() }
            return items[account]
        }
    }

    func write(_ account: String, _ value: String) throws { lock.withLock { items[account] = value } }
    func delete(_ account: String) throws { lock.withLock { items[account] = nil } }
}

/// 假的许可证服务：按路径排队回应，记下每次请求的正文。
private final class FakeTransport: LicenseTransport, @unchecked Sendable {
    struct Offline: Error {}

    private let lock = NSLock()
    private var queued: [String: [Result<(Int, String), Error>]] = [:]
    private(set) var requests: [(path: String, body: [String: String])] = []

    func reply(_ path: String, _ status: Int, _ body: String) {
        lock.withLock { queued[path, default: []].append(.success((status, body))) }
    }

    func fail(_ path: String) {
        lock.withLock { queued[path, default: []].append(.failure(Offline())) }
    }

    func count(_ path: String) -> Int { lock.withLock { requests.filter { $0.path == path }.count } }

    func post(_ path: String, json: Data) async throws -> (status: Int, body: Data) {
        let next: Result<(Int, String), Error> = try lock.withLock {
            let body = (try? JSONSerialization.jsonObject(with: json)) as? [String: String] ?? [:]
            requests.append((path, body))
            guard var list = queued[path], !list.isEmpty else { throw Offline() }
            let first = list.removeFirst()
            queued[path] = list
            return first
        }
        let (status, body) = try next.get()
        return (status, Data(body.utf8))
    }
}

/// 可拨的时钟。
private final class Clock: @unchecked Sendable {
    var now = Date(timeIntervalSince1970: 1_800_000_000)
    func advance(days: Double) { now = now.addingTimeInterval(days * day) }
}

private let activePath = "api/license/activate"
private let verifyPath = "api/license/verify"
private let deactivatePath = "api/license/deactivate"

private func devicesJSON(_ ids: [String]) -> String {
    ids.map { #"{"deviceId":"\#($0)","deviceName":"Mac \#($0)","activatedAt":"2026-10-01T00:00:00Z"}"# }
        .joined(separator: ",")
}

@MainActor
private struct Harness {
    let store = MemoryStore()
    let net = FakeTransport()
    let clock = Clock()

    func manager() -> LicenseManager {
        let clock = clock
        return LicenseManager(store: store, client: LicenseClient(transport: net), deviceName: { "测试机" },
                              now: { clock.now })
    }

    /// 已激活的管理器（激活一次成功）。
    func activated(devices: [String] = ["me"]) async -> LicenseManager {
        store.write_(LicenseAccount.deviceId, "me")
        let license = manager()
        license.bootstrap()
        net.reply(activePath, 200, #"{"status":"active","devices":[\#(devicesJSON(devices))],"maxDevices":3}"#)
        license.keyDraft = "UMUO-AAAA-BBBB"
        await license.activate()
        return license
    }
}

private extension MemoryStore {
    func write_(_ account: String, _ value: String) { try? write(account, value) }
}

@Suite("许可证：试用")
@MainActor
struct LicenseTrialTests {
    @Test func 首次启动写下试用开始时间与设备id() {
        let h = Harness()
        let license = h.manager()
        license.bootstrap()
        #expect(h.store[LicenseAccount.trialStartedAt] == String(h.clock.now.timeIntervalSince1970))
        #expect(UUID(uuidString: h.store[LicenseAccount.deviceId] ?? "") != nil)
        #expect(license.state == .trial(daysLeft: 7))
        #expect(license.isEntitled)
    }

    @Test func 重新启动不会重置试用与设备id() {
        let h = Harness()
        h.manager().bootstrap()
        let deviceId = h.store[LicenseAccount.deviceId]
        h.clock.advance(days: 3.5)
        let again = h.manager()
        again.bootstrap()
        #expect(again.state == .trial(daysLeft: 4))
        #expect(again.deviceId == deviceId)
    }

    @Test func 剩余天数向上取整且到期后拦截() {
        let start = Date(timeIntervalSince1970: 0)
        #expect(LicensePolicy.trialDaysLeft(start: start, now: start.addingTimeInterval(1)) == 7)
        #expect(LicensePolicy.trialDaysLeft(start: start, now: start.addingTimeInterval(6 * day + 1)) == 1)
        #expect(LicensePolicy.trialDaysLeft(start: start, now: start.addingTimeInterval(7 * day)) == 0)
        // 时钟往回拨不会多出天数
        #expect(LicensePolicy.trialDaysLeft(start: start, now: start.addingTimeInterval(-30 * day)) == 7)

        let h = Harness()
        let license = h.manager()
        license.bootstrap()
        h.clock.advance(days: 7)
        license.refresh()
        #expect(license.state == .trialExpired)
        #expect(!license.isEntitled)
    }

    @Test func 钥匙串读不出来时不写入也不限制使用() {
        let h = Harness()
        h.store.failReads = true
        let license = h.manager()
        license.bootstrap()
        #expect(h.store[LicenseAccount.trialStartedAt] == nil)
        #expect(license.state == .unavailable)
        #expect(license.isEntitled)
    }
}

@Suite("许可证：激活与解绑")
@MainActor
struct LicenseActivationTests {
    @Test func 激活成功后存进Keychain并清空草稿() async {
        let h = Harness()
        let license = await h.activated(devices: ["me", "other"])
        #expect(license.state == .active(lastVerifiedAt: h.clock.now))
        #expect(license.isEntitled)
        #expect(license.notice == .activated)
        #expect(license.keyDraft.isEmpty)
        #expect(license.maskedKey == "••••BBBB")
        #expect(license.devices.map(\.deviceId) == ["me", "other"])
        #expect(license.devices.first?.activatedAt != nil)
        #expect(h.store[LicenseAccount.licenseKey] == "UMUO-AAAA-BBBB")
        // 与模型 API Key 分开：只用许可证自己的几个 account
        #expect(h.net.requests.first?.body == ["licenseKey": "UMUO-AAAA-BBBB", "deviceId": "me", "deviceName": "测试机"])
    }

    @Test func 试用到期后激活即恢复可用() async {
        let h = Harness()
        let license = h.manager()
        license.bootstrap()
        h.clock.advance(days: 10)
        license.refresh()
        #expect(!license.isEntitled)
        h.net.reply(activePath, 200, #"{"status":"active","devices":[],"maxDevices":3}"#)
        license.keyDraft = "  KEY-1  "
        await license.activate()
        #expect(license.isEntitled)
        #expect(h.store[LicenseAccount.licenseKey] == "KEY-1")
    }

    @Test func 密钥无效时不存密钥() async {
        let h = Harness()
        let license = h.manager()
        license.bootstrap()
        h.net.reply(activePath, 404, #"{"error":"invalid_license"}"#)
        license.keyDraft = "WRONG"
        await license.activate()
        #expect(license.notice == .invalidLicense)
        #expect(h.store[LicenseAccount.licenseKey] == nil)
        #expect(license.state == .trial(daysLeft: 7))
        #expect(license.keyDraft == "WRONG")
    }

    @Test func 已撤销的许可证不能激活() async {
        let h = Harness()
        let license = h.manager()
        license.bootstrap()
        h.net.reply(activePath, 403, #"{"error":"revoked"}"#)
        license.keyDraft = "REFUNDED"
        await license.activate()
        #expect(license.notice == .revoked)
        #expect(!license.hasLicense)
    }

    @Test func 网络失败时说明原因() async {
        let h = Harness()
        let license = h.manager()
        license.bootstrap()
        h.net.fail(activePath)
        license.keyDraft = "KEY"
        await license.activate()
        if case .network = license.notice {} else { Issue.record("应提示网络错误：\(String(describing: license.notice))") }
        #expect(!license.hasLicense)
    }

    @Test func 设备满了列出设备_解绑一台后自动重试() async {
        let h = Harness()
        h.store.write_(LicenseAccount.deviceId, "me")
        let license = h.manager()
        license.bootstrap()
        h.net.reply(activePath, 409, #"{"error":"device_limit","devices":[\#(devicesJSON(["a", "b", "c"]))],"maxDevices":3}"#)
        license.keyDraft = "KEY"
        await license.activate()
        #expect(license.notice == .deviceLimit(maxDevices: 3))
        #expect(license.pending?.devices.map(\.deviceId) == ["a", "b", "c"])
        #expect(h.store[LicenseAccount.licenseKey] == nil)

        h.net.reply(deactivatePath, 200, #"{"devices":[\#(devicesJSON(["a", "c"]))]}"#)
        h.net.reply(activePath, 200, #"{"status":"active","devices":[\#(devicesJSON(["a", "c", "me"]))],"maxDevices":3}"#)
        await license.deactivate("b")
        #expect(h.net.requests.last(where: { $0.path == deactivatePath })?.body == ["licenseKey": "KEY", "deviceId": "b"])
        #expect(h.net.count(activePath) == 2)
        #expect(license.pending == nil)
        #expect(license.isEntitled)
        #expect(license.devices.map(\.deviceId) == ["a", "c", "me"])
    }

    @Test func 解绑别的Mac只更新设备列表() async {
        let h = Harness()
        let license = await h.activated(devices: ["me", "old"])
        h.net.reply(deactivatePath, 200, #"{"devices":[\#(devicesJSON(["me"]))]}"#)
        await license.deactivate("old")
        #expect(license.devices.map(\.deviceId) == ["me"])
        #expect(license.hasLicense)
        // 重启后读出同一份设备列表
        let again = h.manager()
        again.bootstrap()
        #expect(again.devices.map(\.deviceId) == ["me"])
    }

    @Test func 解绑本机后清掉本机的许可证() async {
        let h = Harness()
        let license = await h.activated()
        h.clock.advance(days: 8)
        h.net.reply(deactivatePath, 200, #"{"devices":[]}"#)
        await license.deactivate("me")
        #expect(license.notice == .deactivated)
        #expect(!license.hasLicense)
        #expect(h.store[LicenseAccount.licenseKey] == nil)
        #expect(h.store[LicenseAccount.record] == nil)
        // 试用早就过了：回到到期状态
        #expect(license.state == .trialExpired)
    }
}

@Suite("许可证：后台验证与离线宽限")
@MainActor
struct LicenseVerifyTests {
    @Test func 未满24小时不验证_满了才验证并更新时间() async {
        let h = Harness()
        let license = await h.activated()
        h.clock.advance(days: 0.5)
        await license.verifyIfDue()
        #expect(h.net.count(verifyPath) == 0)

        h.clock.advance(days: 0.6)
        h.net.reply(verifyPath, 200, #"{"status":"active"}"#)
        await license.verifyIfDue()
        #expect(h.net.requests.last?.body == ["licenseKey": "UMUO-AAAA-BBBB", "deviceId": "me"])
        #expect(license.state == .active(lastVerifiedAt: h.clock.now))
        // 写回 Keychain：重启后宽限从这次算起
        let again = h.manager()
        again.bootstrap()
        #expect(again.record?.lastVerifiedAt == h.clock.now)
    }

    @Test func 离线宽限内仍有效_超出后需要联网验证() async {
        let h = Harness()
        let license = await h.activated()
        let activatedAt = h.clock.now
        h.clock.advance(days: 13)
        h.net.fail(verifyPath)
        await license.verifyIfDue()
        license.refresh()
        #expect(license.state == .active(lastVerifiedAt: activatedAt))
        #expect(license.isEntitled)

        h.clock.advance(days: 1.5)
        h.net.fail(verifyPath)
        await license.verifyIfDue()
        license.refresh()
        #expect(license.state == .needsVerification(lastVerifiedAt: activatedAt))
        #expect(!license.isEntitled)

        // 联网后验证成功即恢复
        h.net.reply(verifyPath, 200, #"{"status":"active"}"#)
        await license.verifyIfDue(force: true)
        #expect(license.isEntitled)
        #expect(license.notice == .verified)
    }

    @Test(arguments: [("revoked", LicenseRecord.Status.revoked), ("invalid", .invalid), ("not_activated", .notActivated)])
    func 服务端说失效就立即失效(raw: String, status: LicenseRecord.Status) async {
        let h = Harness()
        let license = await h.activated()
        h.clock.advance(days: 9)
        h.net.reply(verifyPath, 200, #"{"status":"\#(raw)"}"#)
        await license.verifyIfDue()
        #expect(license.state == .invalid(status))
        #expect(!license.isEntitled)
        // 失效状态写回 Keychain，重启后仍失效，也不再后台验证
        let again = h.manager()
        again.bootstrap()
        #expect(again.state == .invalid(status))
        h.clock.advance(days: 2)
        await again.verifyIfDue()
        #expect(h.net.count(verifyPath) == 1)
    }

    @Test func 请求错误限流与服务不可用不判为失效() async {
        let h = Harness()
        let license = await h.activated()
        for code in [400, 429, 503] {
            h.clock.advance(days: 2)
            h.net.reply(verifyPath, code, #"{"ok":false,"error":"x"}"#)
            await license.verifyIfDue()
            license.refresh()
            if case .active = license.state {} else { Issue.record("\(code) 不该让许可证失效：\(license.state)") }
        }
        #expect(h.net.count(verifyPath) == 3)
    }

    @Test func 有密钥但记录丢了时验证一次补回记录() async {
        let h = Harness()
        h.store.write_(LicenseAccount.deviceId, "me")
        h.store.write_(LicenseAccount.licenseKey, "KEY")
        let license = h.manager()
        license.bootstrap()
        if case .needsVerification = license.state {} else { Issue.record("应需要验证：\(license.state)") }
        h.net.reply(verifyPath, 200, #"{"status":"active"}"#)
        await license.verifyIfDue()
        #expect(h.net.count(verifyPath) == 1)
        #expect(license.state == .active(lastVerifiedAt: h.clock.now))
        #expect(h.store[LicenseAccount.record] != nil)
    }

    @Test func 试用期内许可证失效仍可用到试用结束() {
        let start = Date(timeIntervalSince1970: 0)
        let record = LicenseRecord(status: .revoked, lastVerifiedAt: start, devices: [], maxDevices: 3)
        let early = LicensePolicy.evaluate(trialStart: start, hasLicense: true, record: record, now: start.addingTimeInterval(day))
        #expect(early == LicenseSnapshot(state: .invalid(.revoked), entitled: true))
        let late = LicensePolicy.evaluate(trialStart: start, hasLicense: true, record: record, now: start.addingTimeInterval(8 * day))
        #expect(!late.entitled)
    }

    @Test func 移除失效的许可证() async {
        let h = Harness()
        let license = await h.activated()
        h.clock.advance(days: 9)
        h.net.reply(verifyPath, 200, #"{"status":"revoked"}"#)
        await license.verifyIfDue()
        license.removeLicense()
        #expect(!license.hasLicense)
        #expect(license.state == .trialExpired)
    }
}

@Suite("许可证：门控")
@MainActor
struct LicenseGateTests {
    @Test func 试用到期时四个翻译入口被拦下并提示() {
        let h = Harness()
        let license = h.manager()
        license.bootstrap()
        h.clock.advance(days: 8)
        let router = ActionRouter()
        var ran: [HotkeyAction] = []
        var prompts: [LicenseState] = []
        for action in HotkeyAction.allCases { router.handle(action) { ran.append(action) } }
        router.gate = LicenseGate.gate(license) { prompts.append($0) }
        for action in HotkeyAction.allCases { #expect(router.perform(action)) }
        #expect(ran.isEmpty)
        #expect(prompts == Array(repeating: .trialExpired, count: HotkeyAction.allCases.count))
        #expect(LicenseGate.messageKey(.trialExpired) == "license.blocked.trialExpired")
    }

    @Test func 试用期内与已激活时放行() async {
        let h = Harness()
        let license = await h.activated()
        h.clock.advance(days: 30)
        h.net.reply(verifyPath, 200, #"{"status":"active"}"#)
        await license.verifyIfDue()
        let router = ActionRouter()
        var ran: [HotkeyAction] = []
        for action in HotkeyAction.allCases { router.handle(action) { ran.append(action) } }
        router.gate = LicenseGate.gate(license) { _ in Issue.record("不该提示") }
        for action in HotkeyAction.allCases { router.perform(action) }
        #expect(ran == HotkeyAction.allCases)
    }

    @Test func 设置历史与退出不经过门控() {
        // 门控只装在 ActionRouter 上；菜单里只有四个翻译入口走它，其余项直接打开窗口或退出
        let gated = StatusBarController.entries.compactMap { $0?.entry }.filter {
            if case .action = $0 { true } else { false }
        }
        #expect(gated == HotkeyAction.allCases.map { .action($0) })
        for entry in [StatusBarController.Entry.settings, .history, .quit, .quick, .checkUpdates] {
            #expect(!gated.contains(entry))
        }
    }

    @Test func 到期时设置里的许可证页照常可用() async {
        let h = Harness()
        let license = h.manager()
        license.bootstrap()
        h.clock.advance(days: 8)
        license.refresh()
        let model = SettingsModel(backend: StubSettingsBackend(), license: license)
        model.preferredTab = .license
        await model.load()
        #expect(model.isLoaded)
        #expect(model.tab == .license)
        #expect(model.preferredTab == nil)
        let view = SettingsPane(model: model, tab: .license).frame(width: 680, height: 560)
        #expect(ImageRenderer(content: view).nsImage != nil)
        // 激活在设置里完成，不受门控影响
        h.net.reply(activePath, 200, #"{"status":"active","devices":[\#(devicesJSON(["x"]))],"maxDevices":3}"#)
        license.keyDraft = "KEY"
        await license.activate()
        #expect(license.isEntitled)
        #expect(ImageRenderer(content: SettingsPane(model: model, tab: .license).frame(width: 680, height: 560)).nsImage != nil)
    }
}

/// 只够许可证页载入的设置后端。
@MainActor
private final class StubSettingsBackend: SettingsBackend {
    func loadSettings() async throws -> SettingsValues { ["providerId": .string("ollama"), "locale": .string("zh-CN")] }
    func applyPatch(_ patch: SettingsValues) async throws -> SettingsValues { patch }
    func providers() async -> [ProviderDetail] { [] }
    func keyStatus(_: String) async throws -> Bool { true }
    func saveApiKey(_: String, _: String) async throws {}
    func deleteApiKey(_: String) async throws {}
    func listModels(_: String) async throws -> [String] { [] }
    func permissions() async -> PermissionStatus { PermissionStatus(accessibility: true, screenRecording: true) }
    func requestScreenRecording() async {}
    func openSystemSettings(_: PermissionKind) {}
    func openURL(_: String) {}
    func autostartStatus() async -> Bool? { nil }
    func setAutostart(_ enabled: Bool) async throws -> Bool { enabled }
    func hotkeyFailures() -> [String] { [] }
    func setHotkeyRecording(_: Bool) {}
    func exportConfig() async throws -> String { "" }
    func importConfig(_: String) async throws -> ImportResult { throw FakeTransport.Offline() }
    func openHistory() {}
    func openOnboarding() {}
    var appVersion: String? { nil }
}

@Suite("许可证：API 解码")
struct LicenseAPITests {
    @Test func 激活时间认得ISO与时间戳() throws {
        let json = #"[{"deviceId":"a","deviceName":"A","activatedAt":"2026-10-01T00:00:00.123Z"},{"deviceId":"b","deviceName":"B","activatedAt":1790000000000},{"deviceId":"c","deviceName":"C"}]"#
        let devices = try JSONDecoder().decode([LicenseDevice].self, from: Data(json.utf8))
        #expect(devices[0].activatedAt != nil)
        #expect(devices[1].activatedAt == Date(timeIntervalSince1970: 1_790_000_000))
        #expect(devices[2].activatedAt == nil)
    }

    @Test func 契约外的状态码当作网络失败() async {
        let net = FakeTransport()
        net.reply(verifyPath, 502, "bad gateway")
        let client = LicenseClient(transport: net)
        await #expect(throws: LicenseAPIError.http(502)) { try await client.verify(licenseKey: "k", deviceId: "d") }
    }

    @Test func 深链接取出密钥() {
        #expect(LicenseDeepLink.key(from: URL(string: "umuo://activate?key=UMUO-1234")!) == "UMUO-1234")
        #expect(LicenseDeepLink.key(from: URL(string: "umuo://activate?key=%20A%2BB%20")!) == "A+B")
        #expect(LicenseDeepLink.key(from: URL(string: "umuo://activate")!) == nil)
        #expect(LicenseDeepLink.key(from: URL(string: "umuo://settings?key=x")!) == nil)
        #expect(LicenseDeepLink.key(from: URL(string: "https://activate?key=x")!) == nil)
    }

    @Test func 掩码只露末4位() {
        #expect(LicenseManager.mask("UMUO-1234-ABCD") == "••••ABCD")
        #expect(LicenseManager.mask("abc") == "••••")
    }
}
