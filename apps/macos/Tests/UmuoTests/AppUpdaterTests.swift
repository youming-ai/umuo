import Foundation
import Testing
@testable import Umuo

@Suite("原生应用更新")
struct AppUpdaterTests {
    private let publicKey = Data(repeating: 1, count: 32).base64EncodedString()

    @Test func 更新仅对已配置HTTPS与公钥的正式应用启用() {
        let info: [String: Any] = ["SUFeedURL": "https://github.com/youming-ai/umuo/releases/latest/download/appcast.xml", "SUPublicEDKey": publicKey]
        #expect(AppUpdater.hasConfiguration(bundleIdentifier: "app.umuo.desktop", info: info))
        #expect(!AppUpdater.hasConfiguration(bundleIdentifier: nil, info: info))
        #expect(!AppUpdater.hasConfiguration(bundleIdentifier: "app.umuo.desktop", info: [:]))
        for feed in ["http://umuo.app/appcast.xml", "file:///tmp/appcast.xml", "非地址"] {
            #expect(!AppUpdater.hasConfiguration(bundleIdentifier: "app.umuo.desktop", info: ["SUFeedURL": feed, "SUPublicEDKey": publicKey]))
        }
        #expect(!AppUpdater.hasConfiguration(bundleIdentifier: "app.umuo.desktop", info: ["SUFeedURL": "https://umuo.app/appcast.xml", "SUPublicEDKey": "@未配置@"]))
    }

    @Test @MainActor func 开发构建不启动更新会话() {
        let updater = AppUpdater()
        updater.start()
        #expect(!updater.isConfigured)
        #expect(!updater.canCheckForUpdates)
        updater.checkForUpdates()
    }
}
