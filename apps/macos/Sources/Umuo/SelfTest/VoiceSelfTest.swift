import Foundation
import MachO
import UmuoCore

/// `--selftest` 的语音部分（阶段 C）：引擎框架装得上、版本与 Rust 清单一致，模型清单、会话状态机经 FFI 调得通，
/// 临时音频的读写与清理。
///
/// **不开麦、不下载、不加载模型**：麦克风会弹 TCC 授权框；模型 562 MB；初始化 Metal 后端在一台机器上第一次要编译着色器
/// （实测约 45 秒），不放进门禁。真机的录音、转写与卸载另记证据。
enum VoiceSelfTest {
    @MainActor
    static func run(_ check: (String, Bool, String) -> Void) {
        let info = voiceModelInfo(configDir: "/tmp/umuo-selftest")

        let version = LocalTranscriber.engineVersion
        check("voice.engine", version == info.engineVersion, "transcribe.cpp \(version)（期望 \(info.engineVersion)）")

        // 打包后必须从 .app 自己的 Contents/Frameworks 加载，不能借用构建目录里那一份
        let loaded = loadedImage(containing: "CTranscribe.framework") ?? "未加载"
        let packaged = Bundle.main.bundleURL.pathExtension == "app"
        let frameworks = Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks")
            .resolvingSymlinksInPath().path + "/"
        let fromApp = URL(fileURLWithPath: loaded).resolvingSymlinksInPath().path.hasPrefix(frameworks)
        check("voice.framework", loaded != "未加载" && (!packaged || fromApp), loaded)

        let manifest = info.url.hasPrefix("https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/resolve/7e7c69a5")
            && info.fileName == "Qwen3-ASR-0.6B-Q4_K_M.gguf" && info.sizeBytes == 589_560_480 && info.sha256.count == 64
            && info.path == "/tmp/umuo-selftest/models/Qwen3-ASR-0.6B-Q4_K_M.gguf"
        check("voice.model", manifest, "\(info.fileName)，\(info.sizeBytes) 字节，固定 revision + SHA-256")

        let session = VoiceSession()
        let first = session.handle(input: .press(modelReady: true, task: .tidy))
        _ = session.handle(input: .recordingStarted(session: 1))
        _ = session.handle(input: .release)
        _ = session.handle(input: .recorded(session: 1, durationMs: 1000))
        let next = session.handle(input: .press(modelReady: true, task: .tidy))
        let late = session.handle(input: .transcribed(session: 1, text: "迟到"))
        let flow = first.effects == [.startRecording(session: 1)]
            && next.effects == [.cancelTranscription(session: 1), .cleanupAudio(session: 1), .startRecording(session: 2)]
            && late.effects == [.cleanupAudio(session: 1)] && late.phase == .starting && late.session == 2
        check("voice.session", flow, "按下开会话、转写中再按下取消旧会话、旧会话迟到结果只清音频")

        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("umuo-voice-selftest-\(getpid())")
        let files = VoiceAudioFiles(directory: dir)
        var audioOK = false
        if let handle = try? files.create(7) {
            let samples: [Float] = [0, 0.25, -0.5]
            try? samples.withUnsafeBufferPointer { try VoiceAudioFiles.append($0, to: handle) }
            try? handle.close()
            let back = (try? VoiceAudioFiles.samples(at: files.url(for: 7))) ?? []
            files.remove(7)
            audioOK = back == samples && files.leftovers() == 0
        }
        try? FileManager.default.removeItem(at: dir)
        check("voice.audio", audioOK, "临时音频 16 kHz Float32 写入、读回、删除")

        print("- Microphone: skipped: would prompt TCC（状态：\(MicrophoneAccess.status)）")
        print("- Transcribe: skipped: needs the 562 MB model and first-run Metal init")
    }

    /// 进程里已加载的、路径包含 `needle` 的镜像。
    static func loadedImage(containing needle: String) -> String? {
        for index in 0 ..< _dyld_image_count() {
            guard let name = _dyld_get_image_name(index) else { continue }
            let path = String(cString: name)
            if path.contains(needle) { return path }
        }
        return nil
    }
}
