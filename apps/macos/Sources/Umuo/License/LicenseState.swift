import Foundation

/// 授权的此刻状态（给设置页与门控看）。由 `LicensePolicy.evaluate` 从 Keychain 里的几样东西 + 当前时间算出来，纯函数。
enum LicenseState: Equatable, Sendable {
    /// 钥匙串读不出来（锁着、签名变了要授权）：不知道试用从哪天开始。此时**不限制使用**，只记日志——
    /// 每次重新编译换签名就把用户锁死，或者趁机把试用重置，都不对。
    case unavailable
    /// 没有许可证，试用中。`daysLeft` 向上取整（还剩 1 小时也算 1 天）。
    case trial(daysLeft: Int)
    /// 没有许可证，试用已到期。
    case trialExpired
    /// 已激活，且最近一次成功验证在离线宽限内。
    case active(lastVerifiedAt: Date)
    /// 已激活，但超过离线宽限没能验证：要联网验证一次才恢复。
    case needsVerification(lastVerifiedAt: Date)
    /// 服务端说许可证已失效（退款 / 撤销、密钥无效、本机已被解绑），立即失效。
    case invalid(LicenseRecord.Status)
}

/// 一次评估的结果：状态，以及翻译入口能不能用。
struct LicenseSnapshot: Equatable, Sendable {
    var state: LicenseState
    /// 四个翻译 / OCR 入口能否执行。许可证失效但试用还没到期时仍可用。
    var entitled: Bool
}

/// 授权规则（商业参数已定案：7 天试用、每 24 小时验证一次、离线宽限 14 天）。
enum LicensePolicy {
    static let trialDuration: TimeInterval = 7 * 86400
    static let verifyInterval: TimeInterval = 86400
    static let offlineGrace: TimeInterval = 14 * 86400
    static let maxDevices = 3

    /// - Parameters:
    ///   - trialStart: 试用开始时间；nil = 钥匙串读不出来（`unavailable`）。
    ///   - hasLicense: Keychain 里有没有许可证密钥。
    ///   - record: 激活记录；有密钥却没有记录（写到一半崩了）按「需要验证」处理。
    static func evaluate(trialStart: Date?, hasLicense: Bool, record: LicenseRecord?, now: Date) -> LicenseSnapshot {
        let trial = trialStart.map { trialDaysLeft(start: $0, now: now) }
        let trialRunning = trial.map { $0 > 0 } ?? true
        if hasLicense {
            guard let record else {
                return LicenseSnapshot(state: .needsVerification(lastVerifiedAt: .distantPast), entitled: trialRunning)
            }
            guard record.status == .active else {
                return LicenseSnapshot(state: .invalid(record.status), entitled: trialRunning)
            }
            // 时钟被往回拨（上次验证在「未来」）不算超期：宽限只防长期离线，不防改时钟
            if now.timeIntervalSince(record.lastVerifiedAt) <= offlineGrace {
                return LicenseSnapshot(state: .active(lastVerifiedAt: record.lastVerifiedAt), entitled: true)
            }
            return LicenseSnapshot(state: .needsVerification(lastVerifiedAt: record.lastVerifiedAt), entitled: trialRunning)
        }
        guard let trial else { return LicenseSnapshot(state: .unavailable, entitled: true) }
        return trial > 0
            ? LicenseSnapshot(state: .trial(daysLeft: trial), entitled: true)
            : LicenseSnapshot(state: .trialExpired, entitled: false)
    }

    /// 试用还剩几天：向上取整，到期为 0；时钟往回拨也不超过 7 天。
    static func trialDaysLeft(start: Date, now: Date) -> Int {
        let remaining = start.addingTimeInterval(trialDuration).timeIntervalSince(now)
        guard remaining > 0 else { return 0 }
        return min(Int((remaining / 86400).rounded(.up)), Int(trialDuration / 86400))
    }

    /// 该不该发一次后台验证：有效的激活记录、距上次成功验证满 24 小时。
    static func verifyDue(record: LicenseRecord?, now: Date) -> Bool {
        guard let record, record.status == .active else { return false }
        return now.timeIntervalSince(record.lastVerifiedAt) >= verifyInterval
    }
}
