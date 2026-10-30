import Foundation

/// 许可证服务的传输层：POST 一段 JSON，拿回状态码与正文。正式实现走 URLSession，测试换成假的，不访问真实网络。
protocol LicenseTransport: Sendable {
    func post(_ path: String, json: Data) async throws -> (status: Int, body: Data)
}

/// 正式实现。基地址可注入（默认 https://umuo.app）；只发许可证密钥、设备 id 与设备名，不发模型 Key 或翻译内容（PRD §5.12）。
struct URLSessionLicenseTransport: LicenseTransport {
    static let defaultBaseURL = URL(string: "https://umuo.app")!

    var baseURL = Self.defaultBaseURL
    var session = URLSession.shared

    func post(_ path: String, json: Data) async throws -> (status: Int, body: Data) {
        var request = URLRequest(url: baseURL.appending(path: path), timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = json
        let (data, response) = try await session.data(for: request)
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }
}

/// 服务端返回了契约以外的东西。
enum LicenseAPIError: Error, Equatable, CustomStringConvertible {
    /// 契约里没有的 HTTP 状态码：400 invalid_request（客户端的错）、429 限流、503 服务端收费未配置、其它 5xx。
    /// 一律按网络失败处理（验证时走离线宽限），**不能**当成许可证失效。
    case http(Int)
    /// 正文不是约定的 JSON。
    case malformed
    /// 404 invalid_license。
    case invalidLicense
    /// 403 revoked。
    case revoked

    var description: String {
        switch self {
        case let .http(code): "HTTP \(code)"
        case .malformed: "响应格式不对"
        case .invalidLicense: "invalid_license"
        case .revoked: "revoked"
        }
    }
}

/// 激活的结果（契约里的四种回应）。
enum ActivateOutcome: Equatable, Sendable {
    case active(devices: [LicenseDevice], maxDevices: Int)
    /// 409：设备数满了，列出已激活的设备让用户解绑一台。
    case deviceLimit(devices: [LicenseDevice], maxDevices: Int)
    case invalidLicense
    case revoked
}

/// verify 的四种状态。
enum VerifyStatus: String, Equatable, Sendable {
    case active, revoked, invalid
    case notActivated = "not_activated"
}

/// 许可证 API（`/api/license/*`）的客户端：编码请求、按契约解读响应。不碰 Keychain、不改状态。
struct LicenseClient: Sendable {
    let transport: LicenseTransport

    private struct DevicesBody: Decodable {
        let status: String?
        let error: String?
        let devices: [LicenseDevice]?
        let maxDevices: Int?
    }

    private struct StatusBody: Decodable { let status: String }

    func activate(licenseKey: String, deviceId: String, deviceName: String) async throws -> ActivateOutcome {
        let body = try JSONEncoder().encode(["licenseKey": licenseKey, "deviceId": deviceId, "deviceName": deviceName])
        let (status, data) = try await transport.post("api/license/activate", json: body)
        switch status {
        case 200:
            guard let parsed = try? JSONDecoder().decode(DevicesBody.self, from: data), parsed.status == "active"
            else { throw LicenseAPIError.malformed }
            return .active(devices: parsed.devices ?? [], maxDevices: parsed.maxDevices ?? 3)
        case 409:
            guard let parsed = try? JSONDecoder().decode(DevicesBody.self, from: data) else {
                throw LicenseAPIError.malformed
            }
            return .deviceLimit(devices: parsed.devices ?? [], maxDevices: parsed.maxDevices ?? 3)
        case 404: return .invalidLicense
        case 403: return .revoked
        default: throw LicenseAPIError.http(status)
        }
    }

    func verify(licenseKey: String, deviceId: String) async throws -> VerifyStatus {
        let body = try JSONEncoder().encode(["licenseKey": licenseKey, "deviceId": deviceId])
        let (status, data) = try await transport.post("api/license/verify", json: body)
        guard status == 200 else { throw LicenseAPIError.http(status) }
        guard let parsed = try? JSONDecoder().decode(StatusBody.self, from: data),
              let result = VerifyStatus(rawValue: parsed.status)
        else { throw LicenseAPIError.malformed }
        return result
    }

    /// 解绑一台设备（可以是本机，也可以是别的 Mac）。返回解绑后剩下的设备。
    func deactivate(licenseKey: String, deviceId: String) async throws -> [LicenseDevice] {
        let body = try JSONEncoder().encode(["licenseKey": licenseKey, "deviceId": deviceId])
        let (status, data) = try await transport.post("api/license/deactivate", json: body)
        switch status {
        case 200:
            guard let parsed = try? JSONDecoder().decode(DevicesBody.self, from: data) else {
                throw LicenseAPIError.malformed
            }
            return parsed.devices ?? []
        case 404: throw LicenseAPIError.invalidLicense
        case 403: throw LicenseAPIError.revoked
        default: throw LicenseAPIError.http(status)
        }
    }
}
