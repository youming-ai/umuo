import Foundation
import Observation

/// 买断许可证与 7 天试用（PRD §5.12）：读写 Keychain、调许可证 API、算出此刻的授权状态。
///
/// - 试用：首次启动把开始时间写进 Keychain（重装应用不重置），7 天。
/// - 激活：输入密钥 → `activate`；设备满了（409 device_limit）就把已激活的设备列出来，用户解绑一台后自动重试。
/// - 验证：已激活时每 24 小时后台 `verify` 一次；网络失败不改状态，离线宽限 14 天（从最近一次成功验证算起），
///   超过才需要联网验证；收到 revoked / invalid / not_activated 立即失效。
///
/// 所有 I/O 都要显式调用（`bootstrap`、`startBackgroundVerify` 由 `AppModel.start()` 调）：
/// 测试进程会构造 `AppModel` 但不 `start()`，不能因此去碰真实 Keychain 或网络。
/// Keychain 读写是同步的小调用（读不弹框），直接在 MainActor 上做；网络请求 `await` 出去。
@MainActor @Observable
final class LicenseManager {
    /// 试用到期后「购买」打开的页面。官网路由不带语言前缀（site `pagePath`），按访客语言自己切换。
    static let purchaseURL = "https://umuo.app/pricing"

    /// 设置页上的一次性提示（操作结果 / 错误）。
    enum Notice: Equatable {
        case activated
        case deactivated
        case verified
        case invalidLicense
        case revoked
        /// 设备已满：下面列出设备让用户解绑一台。
        case deviceLimit(maxDevices: Int)
        case network(String)
        case keychain(String)
    }

    /// device_limit 时待重试的激活：密钥还没存进 Keychain（没激活成功就不存）。
    struct PendingActivation: Equatable {
        let licenseKey: String
        var devices: [LicenseDevice]
        let maxDevices: Int
    }

    @ObservationIgnored private let store: LicenseSecretStore
    @ObservationIgnored private let client: LicenseClient
    @ObservationIgnored private let deviceName: () -> String
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var verifyLoop: Task<Void, Never>?

    private(set) var snapshot = LicenseSnapshot(state: .unavailable, entitled: true)
    /// 本机设备 id。钥匙串读写不了时用一个只在本次运行有效的 id（不写入）。
    private(set) var deviceId = ""
    private(set) var trialStart: Date?
    private(set) var record: LicenseRecord?
    /// 已存的许可证密钥的掩码（末 4 位）；界面不回显明文。
    private(set) var maskedKey: String?
    private(set) var pending: PendingActivation?
    private(set) var notice: Notice?
    private(set) var busy = false
    /// 输入框里的密钥草稿。激活成功或关窗后清空。
    var keyDraft = ""

    @ObservationIgnored private var licenseKey: String?
    @ObservationIgnored private var verifying = false

    init(store: LicenseSecretStore, client: LicenseClient, deviceName: @escaping () -> String = DeviceName.current,
         now: @escaping () -> Date = Date.init)
    {
        self.store = store
        self.client = client
        self.deviceName = deviceName
        self.now = now
    }

    /// 正式实例：系统 Keychain + umuo.app。只构造，不做 I/O。
    static func live() -> LicenseManager {
        LicenseManager(store: KeychainLicenseStore(), client: LicenseClient(transport: URLSessionLicenseTransport()))
    }

    var isEntitled: Bool { snapshot.entitled }
    var state: LicenseState { snapshot.state }
    var hasLicense: Bool { licenseKey != nil }
    var devices: [LicenseDevice] { record?.devices ?? [] }
    var maxDevices: Int { record?.maxDevices ?? LicensePolicy.maxDevices }

    // MARK: - 启动

    /// 读出 Keychain 里的东西；首次启动写下试用开始时间与设备 id。读失败（不是「没存过」）时什么都不写。
    func bootstrap() {
        do {
            if let raw = try store.read(LicenseAccount.trialStartedAt), let seconds = TimeInterval(raw) {
                trialStart = Date(timeIntervalSince1970: seconds)
            } else {
                let started = now()
                try store.write(LicenseAccount.trialStartedAt, String(started.timeIntervalSince1970))
                trialStart = started
            }
        } catch {
            trialStart = nil
            print("umuo: 读不出试用开始时间，暂不限制使用：\(Self.reason(error))")
        }

        do {
            if let id = try store.read(LicenseAccount.deviceId), !id.isEmpty {
                deviceId = id
            } else {
                let id = UUID().uuidString
                try store.write(LicenseAccount.deviceId, id)
                deviceId = id
            }
        } catch {
            if deviceId.isEmpty { deviceId = UUID().uuidString }
            print("umuo: 读写设备 id 失败：\(Self.reason(error))")
        }

        do {
            licenseKey = try store.read(LicenseAccount.licenseKey).flatMap { $0.isEmpty ? nil : $0 }
            record = try store.read(LicenseAccount.record).flatMap { raw in
                try? JSONDecoder().decode(LicenseRecord.self, from: Data(raw.utf8))
            }
        } catch {
            print("umuo: 读不出许可证：\(Self.reason(error))")
        }
        refresh()
    }

    /// 按当前时间重算状态（试用天数、宽限会随时间变化）。
    func refresh() {
        maskedKey = licenseKey.map(Self.mask)
        snapshot = LicensePolicy.evaluate(trialStart: trialStart, hasLicense: licenseKey != nil, record: record, now: now())
    }

    /// 后台每小时看一眼：到了 24 小时就验证，顺带刷新试用天数。网络失败的下一小时再试。
    func startBackgroundVerify(every interval: Duration = .seconds(3600)) {
        verifyLoop?.cancel()
        verifyLoop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.verifyIfDue()
                self.refresh()
                try? await Task.sleep(for: interval)
            }
        }
    }

    // MARK: - 激活与解绑

    /// 用输入框里的密钥激活本机。
    func activate() async {
        let key = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        await activate(key: key)
    }

    /// 用已存的密钥再激活一次（本机被别处解绑后、或想刷新设备列表时）。
    func reactivate() async {
        guard let licenseKey else { return }
        await activate(key: licenseKey)
    }

    private func activate(key: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        notice = nil
        let outcome: ActivateOutcome
        do {
            outcome = try await client.activate(licenseKey: key, deviceId: deviceId, deviceName: deviceName())
        } catch {
            notice = .network(Self.reason(error))
            return
        }
        switch outcome {
        case let .active(devices, maxDevices):
            let fresh = LicenseRecord(status: .active, lastVerifiedAt: now(), devices: devices, maxDevices: maxDevices)
            do {
                try store.write(LicenseAccount.licenseKey, key)
                try save(fresh)
            } catch {
                notice = .keychain(Self.reason(error))
                return
            }
            licenseKey = key
            record = fresh
            pending = nil
            keyDraft = ""
            notice = .activated
        case let .deviceLimit(devices, maxDevices):
            pending = PendingActivation(licenseKey: key, devices: devices, maxDevices: maxDevices)
            notice = .deviceLimit(maxDevices: maxDevices)
        case .invalidLicense:
            pending = nil
            notice = .invalidLicense
        case .revoked:
            pending = nil
            notice = .revoked
        }
        refresh()
    }

    /// 解绑一台设备。
    /// - 设备已满时（`pending`）：解绑选中的那台，成功后自动重试激活本机。
    /// - 已激活时解绑别的 Mac：更新设备列表。
    /// - 解绑本机：清掉本机的许可证，回到试用 / 到期状态，名额留给别的 Mac。
    func deactivate(_ target: String) async {
        guard !busy, let key = pending?.licenseKey ?? licenseKey else { return }
        busy = true
        let remaining: [LicenseDevice]
        do {
            remaining = try await client.deactivate(licenseKey: key, deviceId: target)
        } catch {
            busy = false
            notice = Self.notice(for: error)
            return
        }
        busy = false

        if let pending {
            self.pending?.devices = remaining
            await activate(key: pending.licenseKey)
            return
        }
        if target == deviceId {
            do {
                try store.delete(LicenseAccount.licenseKey)
                try store.delete(LicenseAccount.record)
            } catch {
                notice = .keychain(Self.reason(error))
                return
            }
            licenseKey = nil
            record = nil
            notice = .deactivated
        } else if var updated = record {
            updated.devices = remaining
            try? save(updated)
            record = updated
        }
        refresh()
    }

    /// 放弃这次 device_limit 的激活（不解绑任何设备）。
    func cancelPending() {
        pending = nil
        notice = nil
    }

    /// 从本机移除已失效的许可证（不调服务端：失效的密钥解绑也没有意义）。
    func removeLicense() {
        do {
            try store.delete(LicenseAccount.licenseKey)
            try store.delete(LicenseAccount.record)
        } catch {
            notice = .keychain(Self.reason(error))
            return
        }
        licenseKey = nil
        record = nil
        notice = nil
        refresh()
    }

    // MARK: - 验证

    /// 距上次成功验证满 24 小时才验证（`force` = 设置页的「立即验证」）。
    /// 网络失败不改任何状态：宽限从最近一次**成功**算起，到期由 `evaluate` 判定。
    func verifyIfDue(force: Bool = false) async {
        guard let licenseKey, !verifying else { return }
        // 有密钥却没有记录（写到一半失败、旧格式解不出来）：当作很久没验证过，验证成功就把记录补回来
        let current = record ?? LicenseRecord(status: .active, lastVerifiedAt: .distantPast, devices: [],
                                              maxDevices: LicensePolicy.maxDevices)
        guard force ? current.status == .active : LicensePolicy.verifyDue(record: current, now: now()) else { return }
        verifying = true
        defer { verifying = false }
        if force { notice = nil }
        let result: VerifyStatus
        do {
            result = try await client.verify(licenseKey: licenseKey, deviceId: deviceId)
        } catch {
            if force { notice = .network(Self.reason(error)) }
            print("umuo: 许可证验证失败（离线宽限内仍可用）：\(Self.reason(error))")
            return
        }
        var updated = current
        switch result {
        case .active:
            updated.lastVerifiedAt = now()
            if force { notice = .verified }
        case .revoked: updated.status = .revoked
        case .invalid: updated.status = .invalid
        case .notActivated: updated.status = .notActivated
        }
        // 写不进 Keychain 也以内存里的为准：失效必须当场生效，成功验证至少在本次运行里算数
        try? save(updated)
        record = updated
        refresh()
    }

    // MARK: - 小工具

    private func save(_ record: LicenseRecord) throws {
        let data = try JSONEncoder().encode(record)
        try store.write(LicenseAccount.record, String(decoding: data, as: UTF8.self))
    }

    /// 只露末 4 位。
    nonisolated static func mask(_ key: String) -> String {
        let tail = key.suffix(4)
        return key.count > 4 ? "••••\(tail)" : "••••"
    }

    nonisolated static func reason(_ error: Error) -> String {
        if let error = error as? URLError { return error.localizedDescription }
        return String(describing: error)
    }

    private static func notice(for error: Error) -> Notice {
        switch error as? LicenseAPIError {
        case .invalidLicense: .invalidLicense
        case .revoked: .revoked
        default: .network(reason(error))
        }
    }
}
