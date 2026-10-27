import AppKit
import Combine
import Observation
import Sparkle

/// 只在已配置更新通道的 .app 中启动；测试与裸开发二进制不会联网或弹更新窗口。
@MainActor @Observable
final class AppUpdater {
    private(set) var canCheckForUpdates = false
    private(set) var isConfigured = false
    @ObservationIgnored private var controller: SPUStandardUpdaterController?
    @ObservationIgnored private var observation: AnyCancellable?

    /// 公钥必须是 Ed25519 的 32 字节，通道必须走 HTTPS，避免把未配置构建当正式版启动。
    nonisolated static func hasConfiguration(bundleIdentifier: String?, info: [String: Any]) -> Bool {
        guard bundleIdentifier == "app.umuo.desktop",
              let feed = info["SUFeedURL"] as? String,
              let url = URL(string: feed), url.scheme == "https", url.host != nil,
              let key = info["SUPublicEDKey"] as? String,
              Data(base64Encoded: key)?.count == 32 else { return false }
        return true
    }

    func start(bundle: Bundle = .main) {
        guard controller == nil,
              Self.hasConfiguration(bundleIdentifier: bundle.bundleIdentifier, info: bundle.infoDictionary ?? [:]) else { return }
        let controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)
        self.controller = controller
        observation = controller.updater.publisher(for: \.canCheckForUpdates)
            .sink { [weak self] enabled in
                // Sparkle 的 updater API 与 KVO 均在主线程使用。
                MainActor.assumeIsolated { self?.canCheckForUpdates = enabled }
            }
        controller.startUpdater()
        isConfigured = true
    }

    func checkForUpdates() {
        guard canCheckForUpdates else { return }
        NSApp.activate(ignoringOtherApps: true)
        controller?.checkForUpdates(nil)
    }
}
