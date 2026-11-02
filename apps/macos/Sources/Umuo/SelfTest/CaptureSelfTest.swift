import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// `--selftest` 的截图 OCR 部分：`OcrResult` 规则、PNG 解码、临时文件处理、编排分支、Vision 识别。
///
/// **不截屏、不碰剪贴板**：框选换成往临时路径写一张内存里生成的图（或什么都不写＝取消），
/// Vision 识别的是内存里画出来的已知文字（不需要 TCC）。真正的 `screencapture -i` 要人来框选，
/// 一律不跑；没有屏幕录制权限时打印跳过。
enum CaptureSelfTest {
    static func run(_ check: (String, Bool, String) -> Void) {
        resultRules(check)
        decoding(check)
        tempHandling(check)
        orchestration(check)
        vision(check)
        if ScreenCapture.hasPermission() {
            print("- captureInteractively: skipped: needs a person to select a region")
        } else {
            print("- captureInteractively: skipped: needs Screen Recording permission")
        }
    }

    /// 识别结果的固定回归夹具。
    static func resultRules(_ check: (String, Bool, String) -> Void) {
        func line(_ text: String, _ confidence: Float) -> OcrLine { OcrLine(text: text, confidence: confidence) }
        let joined = OcrResult(lines: [line("Hello", 0.9), line("world", 0.8)])
        let blanks = OcrResult(lines: [line("Hello", 0.9), line("   ", 0.5), line("world", 0.8)])
        let trimmed = OcrResult(lines: [line("  Hello  ", 0.9)])
        let empty = OcrResult(lines: [])
        let confidence = OcrResult(lines: [line("low", 0.31), line("high", 0.99)])
        let ok = joined.text == "Hello\nworld" && joined.lines.count == 2
            && blanks.text == "Hello\nworld" && blanks.lines.count == 2
            && trimmed.text == "Hello"
            && empty.isEmpty && empty.text.isEmpty && empty.lines.isEmpty
            && confidence.lines.map(\.confidence) == [0.31, 0.99]
        check("OcrResult", ok, "按行 \\n 拼接、丢空行、逐行 trim、空结果不是错误、置信度逐行保留")
        let messages = CaptureError.permissionDenied.text.key == "error.screenRecordingRequired"
        check("CaptureError", messages, "缺权限有自己的文案键，界面按语言取")
    }

    /// RGBA、RGB（没有 alpha 的 PNG）都要解得开；不是 PNG 是带说明的错误。
    static func decoding(_ check: (String, Bool, String) -> Void) {
        do {
            let rgba = try ScreenCapture.decode(png(sample(alpha: true)))
            let rgb = try ScreenCapture.decode(png(sample(alpha: false)))
            let ok = rgba.width == 3 && rgba.height == 2 && pixel(rgba, x: 2, y: 1) == [50, 20, 30, 255]
                && rgb.width == 3 && rgb.height == 2 && pixel(rgb, x: 2, y: 1) == [50, 20, 30, 255]
            check("decode", ok, "RGBA 与 RGB 的 PNG 像素逐个还原")
        } catch {
            check("decode", false, error.description)
        }
        let garbage = Result { () throws(CaptureError) in try ScreenCapture.decode(Data("not a png".utf8)) }
        check("decode.garbage", failure(garbage) == .other(UserText("ocr.invalidImage")), "不是 PNG → 带说明的错误")
    }

    /// 取消（没写文件）→ nil；写了图 → 解出来；无论哪种，临时目录都整个删掉且只有本用户可读写。
    static func tempHandling(_ check: (String, Bool, String) -> Void) {
        var seen: [URL] = []
        var privateDir = true
        func shoot(_ data: Data?) -> Result<CGImage?, CaptureError> {
            Result { () throws(CaptureError) in
                try ScreenCapture.captureInteractively { path throws(CaptureError) in
                    seen.append(path)
                    let mode = try? FileManager.default.attributesOfItem(
                        atPath: path.deletingLastPathComponent().path
                    )[.posixPermissions] as? Int
                    privateDir = privateDir && mode == 0o700
                    if let data { try? data.write(to: path) }
                }
            }
        }
        let cancelled = shoot(nil)
        let captured = shoot(png(sample(alpha: true)))
        let broken = shoot(Data("garbage".utf8))
        let gone = seen.allSatisfy { !FileManager.default.fileExists(atPath: $0.deletingLastPathComponent().path) }
        let ok = (try? cancelled.get()) == .some(nil)
            && (try? captured.get())??.width == 3
            && failure(broken) == .other(UserText("ocr.invalidImage"))
            && Set(seen).count == 3 && gone && privateDir
        check("captureInteractively.temp", ok, "取消 → nil、截到 → 解码、坏文件 → 报错；每次新目录（0700），结束即删")
    }

    /// 编排的每个分支与文案键。
    static func orchestration(_ check: (String, Bool, String) -> Void) {
        let image = (try? ScreenCapture.decode(png(sample(alpha: true))))!
        var captured = false
        let denied = ScreenOCR.run(hasPermission: { false }, capture: { () throws(CaptureError) in
            captured = true
            return image
        })
        check("ScreenOCR.permission", denied == .notice(ScreenOCR.permissionNotice, permission: "screenRecording") && !captured,
              "没有权限 → 引导到系统设置，不启动框选")

        func outcome(_ capture: @escaping () throws(CaptureError) -> CGImage?,
                     _ recognize: @escaping (CGImage) throws(CaptureError) -> OcrResult = { _ in OcrResult(lines: []) })
            -> ScreenOCR.Outcome
        {
            ScreenOCR.run(hasPermission: { true }, capture: capture, recognize: recognize)
        }
        let ok = outcome { nil } == .cancelled
            && outcome { () throws(CaptureError) in throw .permissionDenied }
            == .notice(UserText("ocr.captureFailed", ["reason": CaptureError.permissionDenied.description]), permission: nil)
            && outcome { image } == .notice(ScreenOCR.emptyNotice, permission: nil)
            && outcome({ image }, { _ throws(CaptureError) in throw .other(UserText("ocr.visionFailed", ["reason": "x"])) })
            == .notice(UserText("ocr.recognizeFailed", ["reason": "Vision 识别失败：x"]), permission: nil)
            && outcome({ image }, { _ in OcrResult(lines: [OcrLine(text: " 你好 ", confidence: 1)]) })
            == .recognized("你好")
        check("ScreenOCR.outcomes", ok, "取消不提示；截图失败 / 识别失败 / 没识别到文字各一句；识别到的文本原样交出")
    }

    /// 在内存里画两行已知文字交给 Vision：验语言提示下的识别、行序与拼接。不需要任何权限。
    static func vision(_ check: (String, Bool, String) -> Void) {
        guard let image = render(["Hello World", "今天天气很好"]) else {
            check("OCR.recognize", false, "画不出测试图")
            return
        }
        do {
            let result = try OCR.recognize(image)
            let ok = result.text == "Hello World\n今天天气很好" && result.lines.allSatisfy { (0...1).contains($0.confidence) }
            check("OCR.recognize", ok, "\(result.text.replacingOccurrences(of: "\n", with: " ⏎ "))")
            let blank = try OCR.recognize(render([])!)
            check("OCR.blank", blank.isEmpty, "纯白图 → 空结果，不报错")
        } catch {
            check("OCR.recognize", false, error.description)
        }
    }

    static func failure<T>(_ result: Result<T, CaptureError>) -> CaptureError? {
        if case let .failure(error) = result { error } else { nil }
    }

    // MARK: - 夹具

    /// 3×2 的图，第 i 个像素是 (i*10, 20, 30)。
    static func sample(alpha: Bool) -> CGImage {
        let channels = alpha ? 4 : 3
        var bytes = [UInt8]()
        for i in 0..<6 { bytes += [UInt8(i * 10), 20, 30] + (alpha ? [255] : []) }
        let provider = CGDataProvider(data: Data(bytes) as CFData)!
        return CGImage(
            width: 3, height: 2, bitsPerComponent: 8, bitsPerPixel: 8 * channels, bytesPerRow: 3 * channels,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGBitmapInfo(rawValue: (alpha ? CGImageAlphaInfo.last : .none).rawValue),
            provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
        )!
    }

    static func png(_ image: CGImage) -> Data {
        let data = NSMutableData()
        let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
        return data as Data
    }

    /// 把任意 CGImage 重绘成 RGBA8 读回一个像素，与源格式无关。
    static func pixel(_ image: CGImage, x: Int, y: Int) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: image.width * image.height * 4)
        out.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        let start = (y * image.width + x) * 4
        return Array(out[start..<start + 4])
    }

    /// 白底黑字，一行一行往下画。
    static func render(_ lines: [String]) -> CGImage? {
        let (width, lineHeight) = (900, 110)
        let height = max(lines.count, 1) * lineHeight + 40
        guard let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 64), .foregroundColor: NSColor.black,
        ]
        for (index, line) in lines.enumerated() {
            // CG 的原点在左下：第一行画在最上面
            let y = height - 20 - (index + 1) * lineHeight + 20
            NSAttributedString(string: line, attributes: attributes).draw(at: CGPoint(x: 40, y: y))
        }
        NSGraphicsContext.restoreGraphicsState()
        return context.makeImage()
    }
}
