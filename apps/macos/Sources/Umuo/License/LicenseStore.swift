import Foundation
import SystemConfiguration
import UmuoCore

/// 许可证相关的 Keychain 条目（PRD §6.4：与模型 API Key 分开存储）。
///
/// service 是 `<Bundle ID>.license`，与供应商 Key 的 service（Bundle ID 本身）不同，两边的 account 再怎么重名也不会串。
/// 试用开始时间也放这里而不是配置文件：删掉应用重装不会清 Keychain，试用不会因此重置。
/// 这些值**不进日志、配置文件与历史库**；错误信息里只有状态码。
protocol LicenseSecretStore: Sendable {
    /// 没存过返回 nil；读失败（钥匙串锁着、签名变了要授权）抛出。
    func read(_ account: String) throws -> String?
    func write(_ account: String, _ value: String) throws
    func delete(_ account: String) throws
}

enum LicenseAccount {
    /// 许可证密钥。
    static let licenseKey = "licenseKey"
    /// 本机设备 id：首次生成的随机 UUID，之后一直沿用。
    static let deviceId = "deviceId"
    /// 试用开始时间（Unix 秒）。
    static let trialStartedAt = "trialStartedAt"
    /// 激活记录（`LicenseRecord` 的 JSON）：最近一次成功验证的时间、设备列表。放 Keychain 而不是 UserDefaults，
    /// 免得改一下 `defaults write` 就把离线宽限续上。
    static let record = "licenseRecord"
}

/// 正式实现：系统 Keychain（沿用 `Keychain` 的读写语义：读时不弹框）。
struct KeychainLicenseStore: LicenseSecretStore {
    let keychain = Keychain(service: bundleId() + ".license")

    func read(_ account: String) throws -> String? { try keychain.read(account: account) }
    func write(_ account: String, _ value: String) throws { try keychain.write(account: account, secret: value) }
    func delete(_ account: String) throws { try keychain.delete(account: account) }
}

/// 一台已激活的 Mac（服务端 `devices` 数组的一项）。
struct LicenseDevice: Codable, Equatable, Sendable, Identifiable {
    let deviceId: String
    let deviceName: String
    /// 激活时间。服务端可能给 ISO 8601 字符串，也可能给时间戳；认不出就是 nil，不影响别的字段。
    let activatedAt: Date?

    var id: String { deviceId }

    init(deviceId: String, deviceName: String, activatedAt: Date?) {
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.activatedAt = activatedAt
    }

    private enum CodingKeys: String, CodingKey { case deviceId, deviceName, activatedAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try c.decode(String.self, forKey: .deviceId)
        deviceName = (try? c.decode(String.self, forKey: .deviceName)) ?? ""
        if let seconds = try? c.decode(Double.self, forKey: .activatedAt) {
            // 毫秒时间戳（JS 的 Date.now()）比秒大三个数量级
            activatedAt = Date(timeIntervalSince1970: seconds > 1e12 ? seconds / 1000 : seconds)
        } else if let text = try? c.decode(String.self, forKey: .activatedAt) {
            activatedAt = Self.parseDate(text)
        } else {
            activatedAt = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(deviceId, forKey: .deviceId)
        try c.encode(deviceName, forKey: .deviceName)
        try c.encodeIfPresent(activatedAt?.timeIntervalSince1970, forKey: .activatedAt)
    }

    static func parseDate(_ text: String) -> Date? {
        let full = ISO8601DateFormatter()
        full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = full.date(from: text) { return date }
        return ISO8601DateFormatter().date(from: text)
    }
}

/// 本机的激活记录。
struct LicenseRecord: Codable, Equatable, Sendable {
    /// 服务端最近一次给出的状态。只有 `active` 才算有效；其余三种都是「立即失效」。
    enum Status: String, Codable, Sendable {
        case active, revoked, invalid
        case notActivated = "not_activated"
    }

    var status: Status
    /// 最近一次成功激活或验证的时间：离线宽限从这里起算。
    var lastVerifiedAt: Date
    var devices: [LicenseDevice]
    var maxDevices: Int
}

/// 设备名：系统设置里的「电脑名称」。取不到时退回主机名。
enum DeviceName {
    static func current() -> String {
        if let name = SCDynamicStoreCopyComputerName(nil, nil) as String?, !name.isEmpty { return name }
        return ProcessInfo.processInfo.hostName
    }
}
