import Foundation
import Sparkle
import UmuoCore

/// 第 0 阶段验证：基本绑定形态（字符串、布尔、列表）都能从 Swift 调通 Rust 内核，回调由 Engine 的翻译事件覆盖；
/// 阶段 1 起再加上 Engine：打开配置目录、设置往返、经本地 SSE 桩跑一次翻译与取消（见 `EngineSelfTest`）；
/// 阶段 2 起加上正式宿主 `SwiftHost`：Keychain 往返（独立的测试服务名）、前台应用、写回的拒绝路径（见 `HostSelfTest`）。
/// 取词：AX 取词的权限拒绝，⌘C 降级整段事务在私有剪贴板上跑（见 `SelectionSelfTest`）。
/// 快捷键：解析与分流、Carbon 注册与失败上报（只用没人用的组合）、暂停与录键、修饰键对账与连按判定（见 `HotkeySelfTest`）。
/// 截图 OCR：OcrResult 规则、PNG 解码、临时目录、编排文案，Vision 识别内存里画出的已知文字；框选本身不跑（见 `CaptureSelfTest`）。
/// 浮窗：替换原文的 ⌘V 兜底（私有剪贴板、假的 ⌘V）与权限拒绝、看门狗与替换计划的 Rust 规则（见 `PanelSelfTest`）。
/// 历史窗 / 快捷面板 / 首次引导：带筛选的查询、柱状图与用量一行、快捷面板状态、引导写的 patch、删除与清空（见 `DataSelfTest`）。
/// 设置窗：交给 Rust 的 patch 形状过得了校验，嵌套对象里的未知字段留得住（见 `SettingsSelfTest`）。
/// 打包：资源包（文案表、菜单栏图标）从哪里读到；scripts/bundle.sh 在 .app 里跑这一项，断言读的是 Contents/Resources。
/// 语音：引擎框架与版本、模型清单、会话状态机、临时音频；不开麦、不下载、不加载模型（见 `VoiceSelfTest`）。
/// 朗读：挑发音人（四层优先级、避开趣味音）与文本清理同 Rust 的夹具，本机发音人按语言挑一遍；不出声（见 `SpeechSelfTest`）。
enum SelfTest {
    @MainActor
    static func run() -> Bool {
        var ok = true
        func check(_ name: String, _ passed: Bool, _ detail: String) {
            print("\(passed ? "✓" : "✗") \(name): \(detail)")
            ok = ok && passed
        }

        // 资源包从 ResourceBundle 取：在 .app 里应当来自 Contents/Resources，bundle.sh 据此核对不是退回到构建目录
        check("resources", !StringCatalog.main.entries.isEmpty && TrayIcon.url != nil,
              "\(ResourceBundle.bundle.bundlePath)（\(Bundle.main.bundleIdentifier ?? "裸二进制，无 Bundle ID")）")

        // 必须加载包内 Sparkle，不能碰巧借用了发版机 .build 里的框架。
        let sparkle = Bundle(for: SPUUpdater.self)
        let packaged = Bundle.main.bundleURL.pathExtension == "app"
        // /tmp 与 /private/tmp 等别名先解析，避免同一包内框架被路径字符串误判。
        let frameworks = Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks")
            .resolvingSymlinksInPath().path + "/"
        let loadedFramework = sparkle.bundleURL.resolvingSymlinksInPath().path
        check("sparkle", !packaged || loadedFramework.hasPrefix(frameworks), sparkle.bundlePath)

        let lang = detectLanguage(text: "今天天气很好")
        check("detectLanguage", lang == "zh", "今天天气很好 → \(lang ?? "nil")")

        check("isWordMode", isWordMode(text: "serendipity") && !isWordMode(text: "This is a whole sentence here."),
              "单词 → true，整句 → false")

        let providers = providerCatalog()
        check("providerCatalog", providers.count == 12 && providers.first?.id == "openai",
              "\(providers.count) 家：\(providers.map(\.id).joined(separator: ", "))")

        EngineSelfTest.run(check)
        HostSelfTest.run(check)
        SelectionSelfTest.run(check)
        HotkeySelfTest.run(check)
        CaptureSelfTest.run(check)
        SpeechSelfTest.run(check)
        PanelSelfTest.run(check)
        VoiceSelfTest.run(check)
        return ok
    }
}
