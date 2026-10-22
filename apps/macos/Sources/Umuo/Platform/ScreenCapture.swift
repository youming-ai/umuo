import CoreGraphics
import Foundation
import ImageIO

/// 截图失败。`description` 与 Rust 的 `PlatformError` Display 逐字一致，两个客户端的提示不分叉。
enum CaptureError: Error, Equatable, CustomStringConvertible {
    /// 没有屏幕录制权限。单独一个分支：UI 要据此把用户引到系统设置（PRD §5.5）。
    case permissionDenied
    case other(String)

    var description: String {
        switch self {
        case .permissionDenied: "需要系统权限：屏幕录制"
        case let .other(message): message
        }
    }
}

/// 屏幕捕获，对应 `crates/umuo-platform-macos/src/capture.rs` 的权限两件套与 `capture_interactively`。
///
/// ## 权限
///
/// macOS 10.15 起截屏要「屏幕录制」权限。两条 API 分工要分清：
/// - `CGPreflightScreenCaptureAccess()` **只查询、不弹窗**，每次按快捷键前用它；
/// - `CGRequestScreenCaptureAccess()` 会弹系统对话框，而且**一个进程只弹一次**，用户拒绝后再调也不会再弹。
///   所以只在用户明确点了「去授权」时调用，不要每次按快捷键都调。
///
/// ## 为什么是 `screencapture -i` 而不是 ScreenCaptureKit
///
/// 系统框选自带十字光标、放大镜与多显示器支持，并由系统自己完成「选区 → 像素」的映射；
/// 自绘浮层要对齐窗口坐标与屏幕全局坐标（两套原点约定不同），弄错就截到别处，
/// 而这类错误没有真人盯着屏幕几乎验证不了。ScreenCaptureKit 只负责取像素、不提供框选 UI，
/// 换它就得连浮层一起自绘，与 Tauri 版的行为也不再一致。
enum ScreenCapture {
    /// 当前是否已授权。**不弹窗**。
    static func hasPermission() -> Bool { CGPreflightScreenCaptureAccess() }

    /// 主动请求授权（会弹系统对话框，每个进程只弹一次）。只有用户明确点了「授权」时才调。
    @discardableResult
    static func requestPermission() -> Bool { CGRequestScreenCaptureAccess() }

    /// 交给系统框选 UI 选一块区域，返回它的像素。`nil` 表示**用户取消了**（按 Esc）——
    /// 取消是正常操作，必须与出错分开，不该弹错误提示。
    ///
    /// **同步阻塞到用户松开鼠标或按 Esc，绝不能放在主线程上。**
    static func captureInteractively() throws(CaptureError) -> CGImage? {
        try captureInteractively { path throws(CaptureError) in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            // -i 交互式框选；-x 不播放快门声；-o 不附带窗口阴影
            process.arguments = ["-i", "-x", "-o", path.path]
            do { try process.run() } catch { throw .other("无法启动 screencapture：\(error.localizedDescription)") }
            process.waitUntilExit()
            // 退出码不看：用户按 Esc 取消时进程照样返回 0，是否截到只看文件在不在
        }
    }

    /// 拆出「谁来写这个文件」，selftest 能不碰屏幕地验证取消、解码与清理。
    ///
    /// 临时文件放在一个**每次新建、仅本用户可读写**的目录里：
    /// 固定文件名（Rust 版用 pid）既可能残留上一轮的旧图、把「取消」误判成「截到了旧图」，
    /// 又让别人能抢先放一个同名文件或链接。目录无论成败都整个删掉——里面是用户的屏幕内容。
    static func captureInteractively(
        _ shoot: (URL) throws(CaptureError) -> Void
    ) throws(CaptureError) -> CGImage? {
        let dir: URL
        do {
            dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("umuo-ocr-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(
                at: dir, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]
            )
        } catch {
            throw .other("无法创建截图临时目录：\(error.localizedDescription)")
        }
        defer { try? FileManager.default.removeItem(at: dir) }

        let path = dir.appendingPathComponent("capture.png")
        try shoot(path)
        guard let data = try? Data(contentsOf: path) else {
            // 用户按 Esc 取消：没有写出文件。这是正常路径。
            if FileManager.default.fileExists(atPath: path.path) { throw .other("读不到截图文件") }
            return nil
        }
        return try decode(data)
    }

    /// 把截图文件解成 CGImage。
    ///
    /// Rust 版要自己解 PNG、把 RGB 补成 RGBA、按紧密行距重排，才能交给 Vision；
    /// 这里 ImageIO 直接给出 CGImage，Vision 自己认像素格式，那几个坑在这条路上不存在。
    static func decode(_ data: Data) throws(CaptureError) -> CGImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { throw .other("截图不是合法 PNG") }
        guard image.width > 0, image.height > 0 else { throw .other("截图尺寸为 0") }
        return image
    }
}
