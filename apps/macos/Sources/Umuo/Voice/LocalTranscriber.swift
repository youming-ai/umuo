import CTranscribe
import Foundation
import os

/// 本地转写：`transcribe.cpp` v0.4.1（`TranscribeCpp.xcframework`）+ 默认模型 `Qwen3-ASR-0.6B-Q4_K_M`。
///
/// 阶段 B 定案的资源策略（实测见 `docs/archive/VERIFICATION-LOG-2026-10.md`）：
/// - **宿主进程内加载**、默认 `mmap`：权重映射成文件页，推理峰值 `phys_footprint` 约 333 MB；
/// - **空闲自动卸载**：最后一次使用 `idleUnload` 秒后 `session_free` + `model_free`，实测立即回落约 224 MB；
/// - 引擎的 abort 回调做取消（实测 0.04 ms 返回 `ABORTED`，同会话重试结果一致），空采样 / NaN 安全返回错误码。
///
/// 所有引擎调用都在一个串行队列上：模型与会话指针只在那里读写，加载、推理、卸载天然互斥。
/// 首次在一台机器上初始化 Metal 要编译着色器（实测约 45 秒），之后 40–100 ms；所以下载完与开始录音时都会 `prepare` 预热。
final class LocalTranscriber: VoiceTranscribing, @unchecked Sendable {
    private let modelPath: String
    private let idleUnload: TimeInterval
    private let queue = DispatchQueue(label: "app.umuo.voice.transcriber", qos: .userInitiated)
    /// 以下只在 `queue` 上读写。
    private var model: OpaquePointer?
    private var engine: OpaquePointer?
    private var unloadItem: DispatchWorkItem?
    /// 取消标记：跨线程读写（主线程 `cancel`、推理线程的 abort 回调），所以单独加锁。
    private let abort = AbortFlag()
    /// 引擎已加载（`isEngineReady`）。主线程要读，不能 `queue.sync`：加载可能要 45 秒，会卡住界面。
    private let ready = OSAllocatedUnfairLock(initialState: false)

    /// 进程里只初始化一次后端（注册 Metal / CPU 设备）。
    private static let backends: Void = { _ = transcribe_init_backends_default() }()

    init(modelPath: String, idleUnload: TimeInterval) {
        self.modelPath = modelPath
        self.idleUnload = idleUnload
    }

    deinit {
        // 正式路径里它跟进程同寿；测试或 selftest 里提前释放时把模型还给系统
        if let engine { transcribe_session_free(engine) }
        if let model { transcribe_model_free(model) }
    }

    /// 引擎版本（selftest 与 Rust 的 `engineVersion` 对账）。
    static var engineVersion: String { String(cString: transcribe_version()) }

    /// 状态码的名字（`ABORTED`、`GGUF`……），写进错误细节。
    static func statusName(_ status: transcribe_status) -> String {
        "\(String(cString: transcribe_status_string(Int32(status.rawValue))))(\(status.rawValue))"
    }

    var isEngineReady: Bool { ready.withLock { $0 } }

    func prepare() {
        queue.async {
            _ = try? self.loadIfNeeded()
            self.scheduleUnload()
        }
    }

    func transcribe(session: UInt64, audio: URL) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                continuation.resume(with: Result { try self.run(session: session, audio: audio) })
            }
        }
    }

    func cancel(session: UInt64) { abort.cancel(session) }

    // MARK: - 只在 queue 上

    private func run(session: UInt64, audio: URL) throws -> String {
        defer {
            abort.finish(session)
            scheduleUnload()
        }
        guard abort.begin(session) else {
            throw VoiceFault(kind: .transcription, detail: Self.statusName(TRANSCRIBE_ERR_ABORTED))
        }
        let engine = try loadIfNeeded()
        let samples: [Float]
        do {
            samples = try VoiceAudioFiles.samples(at: audio)
        } catch {
            throw VoiceFault(kind: .transcription, detail: "读临时音频失败：\(error)")
        }
        var params = transcribe_run_params()
        transcribe_run_params_init(&params)
        let status = samples.withUnsafeBufferPointer { buffer in
            transcribe_run(engine, buffer.baseAddress, Int32(buffer.count), &params)
        }
        guard status == TRANSCRIBE_OK else {
            throw VoiceFault(kind: .transcription, detail: Self.statusName(status))
        }
        return String(cString: transcribe_full_text(engine))
    }

    /// 模型与会话没加载就加载。失败按「模型不可用」报：文件缺失、损坏、Metal 起不来都需要用户处理模型。
    private func loadIfNeeded() throws -> OpaquePointer {
        if let engine { return engine }
        _ = Self.backends
        var loadParams = transcribe_model_load_params()
        transcribe_model_load_params_init(&loadParams)
        var loaded: OpaquePointer?
        let status = transcribe_model_load_file(modelPath, &loadParams, &loaded)
        guard status == TRANSCRIBE_OK, let loaded else {
            throw VoiceFault(kind: .modelUnavailable, detail: Self.statusName(status))
        }
        var sessionParams = transcribe_session_params()
        transcribe_session_params_init(&sessionParams)
        var created: OpaquePointer?
        let sessionStatus = transcribe_session_init(loaded, &sessionParams, &created)
        guard sessionStatus == TRANSCRIBE_OK, let created else {
            transcribe_model_free(loaded)
            throw VoiceFault(kind: .modelUnavailable, detail: Self.statusName(sessionStatus))
        }
        transcribe_set_abort_callback(created, abortTrampoline, Unmanaged.passUnretained(abort).toOpaque())
        model = loaded
        engine = created
        ready.withLock { $0 = true }
        return created
    }

    private func scheduleUnload() {
        unloadItem?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.unloadNow() }
        unloadItem = item
        queue.asyncAfter(deadline: .now() + idleUnload, execute: item)
    }

    private func unloadNow() {
        unloadItem?.cancel()
        unloadItem = nil
        if let engine { transcribe_session_free(engine) }
        if let model { transcribe_model_free(model) }
        engine = nil
        model = nil
        ready.withLock { $0 = false }
    }
}

/// 哪个会话在跑、哪些会话被取消了。取消可能早于转写开始（主线程的取消先于后台排到的转写）。
final class AbortFlag: @unchecked Sendable {
    private let state = OSAllocatedUnfairLock(initialState: (running: UInt64(0), cancelled: Set<UInt64>()))

    func cancel(_ session: UInt64) { state.withLock { _ = $0.cancelled.insert(session) } }

    /// 开始跑这一会话；已被取消就返回 false。
    func begin(_ session: UInt64) -> Bool {
        state.withLock {
            guard !$0.cancelled.contains(session) else { return false }
            $0.running = session
            return true
        }
    }

    func finish(_ session: UInt64) {
        state.withLock {
            $0.cancelled.remove(session)
            if $0.running == session { $0.running = 0 }
        }
    }

    /// 引擎在推理间隙问：当前会话要不要中止。
    var shouldAbort: Bool { state.withLock { $0.running != 0 && $0.cancelled.contains($0.running) } }
}

private let abortTrampoline: transcribe_abort_callback = { userData in
    guard let userData else { return false }
    return Unmanaged<AbortFlag>.fromOpaque(userData).takeUnretainedValue().shouldAbort
}
