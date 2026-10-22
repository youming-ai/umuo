import AppKit
import CoreGraphics
import Vision

/// 识别出的一行文字。对应 `umuo_platform::ocr::OcrLine`。
struct OcrLine: Equatable {
    let text: String
    /// 0..1，Vision 给的就是这个量级。
    let confidence: Float
}

/// 一次识别的结果。对应 `umuo_platform::ocr::OcrResult`。
struct OcrResult: Equatable {
    /// 按行拼好的整段文本——直接拿去翻译的就是它。
    let text: String
    let lines: [OcrLine]

    /// 空行丢掉（在翻译 prompt 里只会变成噪声），每行去掉首尾空白，按 Vision 给的顺序用 `\n` 拼接。
    /// 与 Rust 的 `from_lines` 同一规则；`lines` 里保留的是未 trim 的原文与各自的置信度。
    init(lines: [OcrLine]) {
        let kept = lines.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        self.lines = kept
        text = kept.map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: "\n")
    }

    /// 什么都没识别出来。截到图片、纯色区域时很常见，要与「识别失败」分开处理。
    var isEmpty: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

/// 本机文字识别（Apple Vision，不联网、免费），对应 `crates/umuo-platform-macos/src/ocr.rs`。
///
/// 不把截图发给多模态大模型：截图 OCR 是高频动作，每次上传一张图既慢又贵，
/// 而且用户截的往往是自己屏幕上的东西——能不出本机就不出本机。
/// 不需要任何 TCC 权限；同步执行，不要在主线程上调。
enum OCR {
    /// 中英日覆盖本产品的主要用户，Vision 随系统内置这些语种的模型。顺序有意义：按这个优先级挑最像的语种。
    static let recognitionLanguages = ["zh-Hans", "en-US", "ja-JP"]

    /// 识别不出文字是**正常结果**（空的 `OcrResult`），只有引擎本身不可用才抛错。
    static func recognize(_ image: CGImage) throws(CaptureError) -> OcrResult {
        guard image.width > 0, image.height > 0 else { return OcrResult(lines: []) }

        let request = VNRecognizeTextRequest()
        // Accurate 比 Fast 慢一点，但截图 OCR 是「看清楚这一小块」，认错字的代价远高于多等一两百毫秒
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = recognitionLanguages

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do { try handler.perform([request]) } catch {
            throw .other("Vision 识别失败：\(error.localizedDescription)")
        }

        // 每行只取置信度最高的候选——多个候选是给「选字」交互用的，这里没有那个交互
        let lines = (request.results ?? []).compactMap { observation -> OcrLine? in
            guard let best = observation.topCandidates(1).first else { return nil }
            return OcrLine(text: best.string, confidence: best.confidence)
        }
        return OcrResult(lines: lines)
    }
}

/// 截图 OCR 的编排，对应 `apps/desktop/src-tauri/src/screenshot.rs`：权限检查 → 系统框选 → 本机识别。
///
/// 只决定「接下来该怎么办」，不碰窗口与剪贴板：弹提示、开浮窗、写剪贴板是调用方（菜单栏应用）的事，
/// 这样文案与分支能在 selftest 里逐条验，而不用真的截屏。
enum ScreenOCR {
    enum Outcome: Equatable {
        /// 用户取消了框选：什么都不做，也不提示。
        case cancelled
        /// 给用户看的一句话；`permission` 非空时 UI 要附上「去授权」入口（值与 Tauri 的 `screenRecording` 一致）。
        case notice(String, permission: String?)
        /// 识别到的文本：⌥S 交给翻译流水线（先开浮窗），静默 OCR 只复制到剪贴板。
        case recognized(String)
    }

    static let permissionNotice = "需要「屏幕录制」权限才能截图翻译：系统设置 → 隐私与安全性 → 屏幕录制"
    static let emptyNotice = "没有识别到文字，换一块区域再试"

    /// 同步阻塞到用户框选完成，**不要在主线程上调**。
    static func run(
        hasPermission: () -> Bool = ScreenCapture.hasPermission,
        capture: () throws(CaptureError) -> CGImage? = { () throws(CaptureError) in
            try ScreenCapture.captureInteractively()
        },
        recognize: (CGImage) throws(CaptureError) -> OcrResult = { image throws(CaptureError) in
            try OCR.recognize(image)
        }
    ) -> Outcome {
        // 只查询不弹窗：按一次快捷键弹一次系统对话框是骚扰
        guard hasPermission() else { return .notice(permissionNotice, permission: "screenRecording") }
        let image: CGImage
        do {
            guard let captured = try capture() else { return .cancelled }
            image = captured
        } catch {
            return .notice("截图失败：\(error)", permission: nil)
        }
        do {
            let result = try recognize(image)
            // 截到图片、纯色区域时很常见。要说清楚，否则用户以为快捷键没生效
            return result.isEmpty ? .notice(emptyNotice, permission: nil) : .recognized(result.text)
        } catch {
            return .notice("文字识别失败：\(error)", permission: nil)
        }
    }

    /// 静默 OCR 的收尾：只把原文复制到剪贴板，成功时什么都不显示；复制失败才说话。
    /// 要拿 `Pasteboard.exclusive`：⌘C 取词降级的事务可能正在另一个线程上跑，
    /// 不互斥的话 OCR 文本要么被它的恢复盖掉，要么被它当成用户原内容存下来。
    static func copy(_ text: String, to pasteboard: NSPasteboard = .general) -> String? {
        Pasteboard.exclusive.lock()
        defer { Pasteboard.exclusive.unlock() }
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string) ? nil : "复制失败：剪贴板不可用：写入失败"
    }
}
