// swift-tools-version: 6.0
import Foundation
import PackageDescription

/// umuo 的 SwiftUI 客户端。翻译内核是 Rust（crates/umuo-core），经 UniFFI 导出（crates/umuo-ffi）。
/// 先跑 `scripts/build-core.sh` 生成静态库与绑定，再 `swift build`。
let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path

let package = Package(
    name: "Umuo",
    // 源语言：简体中文。文案表见 Sources/Umuo/Resources/Strings/Localizable.xcstrings
    defaultLocalization: "zh-Hans",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0"),
    ],
    targets: [
        .target(name: "umuo_ffiFFI"),
        // 本地语音转写引擎 transcribe.cpp v0.4.1 的官方预编译包（MIT，阶段 B 选定，见
        // docs/research/local-transcription-engines.md）。SwiftPM 按 checksum（即 zip 的 SHA-256）校验下载，
        // 与 scripts/asr-eval.ts 的 ENGINE_ARTIFACT 同一份。里面是动态的 CTranscribe.framework（`import CTranscribe`），
        // 由 scripts/bundle.sh 拷进 Contents/Frameworks，与 Sparkle 一样经 @executable_path/../Frameworks 加载。
        .binaryTarget(
            name: "TranscribeCpp",
            url: "https://github.com/handy-computer/transcribe.cpp/releases/download/v0.4.1/TranscribeCpp.xcframework.zip",
            checksum: "fb5646e564036a6c49659e3efcf72eb567af20da31b8569045c9a08181d35126"
        ),
        .target(
            name: "UmuoCore",
            dependencies: ["umuo_ffiFFI"],
            swiftSettings: [.swiftLanguageMode(.v5)],
            linkerSettings: [
                .unsafeFlags(["-L\(here)/.core/lib"]),
                .linkedLibrary("umuo_ffi"),
                // reqwest 的系统代理与 TLS 根证书用到这几个系统框架
                .linkedFramework("SystemConfiguration"),
                .linkedFramework("Security"),
                .linkedFramework("CoreFoundation"),
            ]
        ),
        .executableTarget(
            name: "Umuo",
            dependencies: ["UmuoCore", "TranscribeCpp", .product(name: "Sparkle", package: "Sparkle")],
            // String Catalog 整个目录原样拷贝、运行时自己读（Models/L10n.swift）：SwiftPM 见到目标里的 .xcstrings
            // 就要调 Xcode 的 xcstringstool（`.process` 编译、连 `.copy` 单个文件也要生成字符串符号），
            // 只装 Command Line Tools 时编不过；拷整个目录不会被扫描，两种工具链下行为也完全一致。
            // 菜单栏图标只有一份 tray.png（模板图），由 scripts/make-icons.ts 生成、原样拷贝
            resources: [.copy("Resources/Strings"), .copy("Resources/Tray")],
            // 全局组合键用 Carbon 的 RegisterEventHotKey（不需要 TCC 权限）
            linkerSettings: [
                .linkedFramework("Carbon"), .linkedFramework("Vision"), .linkedFramework("AVFoundation"),
                .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"]),
            ]
        ),
        // 视图模型与纯规则的验收用例（Swift Testing）。由 scripts/verify.sh 跑 `swift test`，
        // 只装 Command Line Tools 时要给 TestingMacros 插件路径，见那里的注释。
        .testTarget(name: "UmuoTests", dependencies: ["Umuo"]),
    ]
)
