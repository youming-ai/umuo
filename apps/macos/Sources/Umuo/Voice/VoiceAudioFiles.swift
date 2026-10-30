import Foundation

/// 语音会话的临时音频（PRD §5.11：默认只用于当前会话，结束或取消后清理，不随历史保存）。
///
/// 格式是裸的 16 kHz 单声道 Float32 小端采样（`.f32`），正好是转写引擎要的输入，不用再解码。
/// 一个会话一个文件，名字带会话号：状态机的 `CleanupAudio` 按会话号删，迟到的清理也删得准。
/// 目录在系统临时目录下、权限 0700，文件 0600；启动时 `sweep` 掉上次崩溃或强退留下的文件。
struct VoiceAudioFiles: Sendable {
    /// 16 kHz：Qwen3-ASR 的原生采样率（`transcribe_capabilities.native_sample_rate`）。
    static let sampleRate: Double = 16000

    let directory: URL

    static let standard = VoiceAudioFiles(
        directory: FileManager.default.temporaryDirectory.appendingPathComponent("umuo-voice", isDirectory: true)
    )

    func url(for session: UInt64) -> URL {
        directory.appendingPathComponent("session-\(session).f32")
    }

    /// 建好空文件并返回写句柄。目录只给自己读写：录音内容不该被同机其他用户读到。
    func create(_ session: UInt64) throws -> FileHandle {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let url = url(for: session)
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
        else { throw CocoaError(.fileWriteUnknown) }
        return try FileHandle(forWritingTo: url)
    }

    /// 删掉这一会话的音频。幂等：不存在也不报错。
    func remove(_ session: UInt64) {
        try? FileManager.default.removeItem(at: url(for: session))
    }

    /// 启动时清掉目录里所有遗留音频（上次崩溃、强退、断电）。
    func sweep() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for name in names where name.hasSuffix(".f32") {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    /// 目录里还剩几个音频文件（测试与 selftest 用）。
    func leftovers() -> Int {
        ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [])
            .filter { $0.hasSuffix(".f32") }.count
    }

    /// 读回采样。文件长度不是 4 的倍数时丢掉不完整的最后一个采样。
    static func samples(at url: URL) throws -> [Float] {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        let count = data.count / MemoryLayout<Float>.size
        var samples = [Float](repeating: 0, count: count)
        _ = samples.withUnsafeMutableBytes { data.copyBytes(to: $0, count: count * MemoryLayout<Float>.size) }
        return samples
    }

    /// 写入一段采样（录音线程上调用）。
    static func append(_ samples: UnsafeBufferPointer<Float>, to handle: FileHandle) throws {
        guard let base = samples.baseAddress, !samples.isEmpty else { return }
        try handle.write(contentsOf: Data(bytes: base, count: samples.count * MemoryLayout<Float>.size))
    }

    /// 采样数 → 毫秒。
    static func durationMs(samples: Int) -> UInt64 {
        UInt64((Double(samples) / sampleRate * 1000).rounded())
    }
}
