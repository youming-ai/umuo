import Foundation
import UmuoCore

// `--selftest`：不开界面，逐项调用 Rust 内核并校验结果，用于 CI 与第 0 阶段验证。
if CommandLine.arguments.contains("--selftest") {
    exit(SelfTest.run() ? 0 : 1)
}
if CommandLine.arguments.contains("--selftest-panel-layout") {
    PanelLayoutSelfTest.main()
    exit(0)
}
UmuoApp.main()
