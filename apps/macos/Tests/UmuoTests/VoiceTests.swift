import CryptoKit
import Foundation
import Testing
import UmuoCore
@testable import Umuo

// 语音输入（阶段 C）的宿主编排与模型下载。
// 录音器、转写器、浮层、取文件全部换成假实现：不碰真实麦克风、不加载模型、不访问网络。
// 会话规则本身（迟到结果、Esc 全链路取消、何时清理）在 Rust 的 voice_session 里测；这里验 Swift 是否照着执行。

/// 假录音器：开麦即成功，往临时文件写一段假音频；可以设成开麦失败或卡在权限框。
@MainActor
private final class FakeRecorder: VoiceRecording {
    var onFailure: ((UInt64, VoiceFault) -> Void)?
    var startFailure: VoiceFault?
    /// 设了就在 start 里等它（模拟停在系统权限框上）。
    var gate: CheckedContinuation<Void, Never>?
    var holdStart = false
    var durationMs: UInt64 = 1500
    private(set) var recording: UInt64?
    var waitingAtGate: Bool { gate != nil }
    private(set) var discarded: [UInt64] = []
    private var outputs: [UInt64: FileHandle] = [:]

    func start(session: UInt64, output: FileHandle) async throws {
        if holdStart { await withCheckedContinuation { gate = $0 } }
        if let startFailure { throw startFailure }
        let samples = [Float](repeating: 0.1, count: 1600)
        try samples.withUnsafeBufferPointer { try VoiceAudioFiles.append($0, to: output) }
        outputs[session] = output
        recording = session
    }

    func stop(session: UInt64) async throws -> UInt64 {
        guard recording == session else { throw VoiceFault(kind: .recording, detail: "没有进行中的录音") }
        try? outputs.removeValue(forKey: session)?.close()
        recording = nil
        return durationMs
    }

    func discard(session: UInt64) {
        discarded.append(session)
        try? outputs.removeValue(forKey: session)?.close()
        if recording == session { recording = nil }
    }

    func releaseGate() {
        gate?.resume()
        gate = nil
    }
}

/// 假转写器：按会话号返回预设文本；`hold` 时挂起，直到测试放行（模拟推理中）。
private final class FakeTranscriber: VoiceTranscribing, @unchecked Sendable {
    private let lock = NSLock()
    private var waiting: [UInt64: CheckedContinuation<String, Error>] = [:]
    private var _cancelled: [UInt64] = []
    private var _prepared = 0
    private var _audioSeen: [UInt64: Bool] = [:]
    var hold = false
    var result: Result<String, VoiceFault> = .success("今天下午三点开会")

    var cancelled: [UInt64] { lock.withLock { _cancelled } }
    var prepared: Int { lock.withLock { _prepared } }
    func audioSeen(_ session: UInt64) -> Bool? { lock.withLock { _audioSeen[session] } }
    func called(_ session: UInt64) -> Bool { audioSeen(session) != nil && (!hold || isWaiting(session)) }
    func isWaiting(_ session: UInt64) -> Bool { lock.withLock { waiting[session] != nil } }
    var pending: Int { lock.withLock { waiting.count } }

    var engineReady = true
    var isEngineReady: Bool { lock.withLock { engineReady } }

    func prepare() { lock.withLock { _prepared += 1 } }

    func transcribe(session: UInt64, audio: URL) async throws -> String {
        lock.withLock { _audioSeen[session] = FileManager.default.fileExists(atPath: audio.path) }
        if hold {
            return try await withCheckedThrowingContinuation { continuation in
                lock.withLock { waiting[session] = continuation }
            }
        }
        return try result.get()
    }

    func cancel(session: UInt64) { lock.withLock { _cancelled.append(session) } }

    /// 放行一个挂起的转写（迟到的结果）。
    func finish(_ session: UInt64, with text: String) {
        let continuation = lock.withLock { waiting.removeValue(forKey: session) }
        continuation?.resume(returning: text)
    }
}

/// 假后处理：按任务返回预设结果；`hold` 时挂起，直到测试放行（模拟请求中）。
@MainActor
private final class FakePostProcessor: VoicePostProcessing {
    var hold = false
    var result: Result<VoicePostOutcome, VoiceFault> = .success(VoicePostOutcome(text: "今天下午三点开会。", truncated: false))
    private(set) var calls: [(session: UInt64, text: String, task: VoiceTask)] = []
    private(set) var cancelled: [UInt64] = []
    private var waiting: [UInt64: CheckedContinuation<VoicePostOutcome, Error>] = [:]

    var pending: Int { waiting.count }

    func run(session: UInt64, text: String, task: VoiceTask) async throws -> VoicePostOutcome {
        calls.append((session, text, task))
        if hold {
            return try await withCheckedThrowingContinuation { waiting[session] = $0 }
        }
        return try result.get()
    }

    func cancel(session: UInt64) { cancelled.append(session) }

    /// 放行一个挂起的请求（可能是迟到的结果）。
    func finish(_ session: UInt64, with outcome: VoicePostOutcome) {
        waiting.removeValue(forKey: session)?.resume(returning: outcome)
    }
}

/// 假交付：记下记目标与交付的会话；按设定返回成功或拒绝；`hold` 时挂起直到放行。
@MainActor
private final class FakeDeliverer: VoiceDelivering {
    var refusal: VoiceDeliveryRefusal?
    var hold = false
    private(set) var captured: [UInt64] = []
    private(set) var delivered: [(session: UInt64, text: String)] = []
    private(set) var cancelled: [UInt64] = []
    private var waiting: [UInt64: CheckedContinuation<VoiceDeliveryRefusal?, Never>] = [:]

    func capture(session: UInt64) { captured.append(session) }

    func deliver(session: UInt64, text: String) async -> VoiceDeliveryRefusal? {
        delivered.append((session, text))
        if hold { return await withCheckedContinuation { waiting[session] = $0 } }
        return refusal
    }

    func cancel(session: UInt64) { cancelled.append(session) }

    func finish(_ session: UInt64, _ refusal: VoiceDeliveryRefusal?) {
        waiting.removeValue(forKey: session)?.resume(returning: refusal)
    }
}

@MainActor
private final class FakePresenter: VoiceOverlayPresenting {
    var visible = false
    var shows = 0
    func show() {
        visible = true
        shows += 1
    }

    func hide() { visible = false }
}

/// 本地桩：按 Range 从内存里的字节回应；可以在某个位置断开、不认续传或回错误。
private final class StubFetcher: ModelFetching, @unchecked Sendable {
    private let lock = NSLock()
    let payload: Data
    var chunkSize = 7
    /// 第一次请求只发这么多就断开（模拟网络中断），之后正常。
    var dropAfter: Int?
    var ignoresRange = false
    var failWith: Error?
    private(set) var offsets: [Int64] = []

    init(payload: Data) { self.payload = payload }

    func fetch(_: URL, from offset: Int64) async throws -> ModelFetchResponse {
        let (drop, ignore, failure) = lock.withLock { () -> (Int?, Bool, Error?) in
            offsets.append(offset)
            defer { dropAfter = nil }
            return (dropAfter, ignoresRange, failWith)
        }
        if let failure { throw failure }
        let start = ignore ? 0 : Int(offset)
        let body = payload.subdata(in: start ..< payload.count)
        let size = chunkSize
        let chunks = AsyncThrowingStream<Data, Error> { continuation in
            var sent = 0
            while sent < body.count {
                if let drop, sent >= drop {
                    continuation.finish(throwing: URLError(.networkConnectionLost))
                    return
                }
                let end = min(sent + size, body.count)
                continuation.yield(body.subdata(in: sent ..< end))
                sent = end
            }
            continuation.finish()
        }
        return ModelFetchResponse(resumed: !ignore && offset > 0, chunks: chunks)
    }
}

private func scratch(_ name: String) -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("umuo-voice-tests-\(name)-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func makeSpec(in dir: URL, payload: Data, sha: String? = nil) -> VoiceModelStore.Spec {
    VoiceModelStore.Spec(url: URL(string: "https://example.invalid/model.gguf")!, sizeBytes: Int64(payload.count),
                         sha256: sha ?? sha256(payload), path: dir.appendingPathComponent("models/model.gguf"),
                         partialPath: dir.appendingPathComponent("models/model.gguf.partial"))
}

/// 等控制器里起的 Task 把事件喂回来。测试并行跑，固定让出几次不够稳，按条件等（最多 10 秒：CI runner 慢，2 秒曾不够）。
@MainActor
private func until(_ condition: @MainActor () -> Bool) async {
    for _ in 0 ..< 2000 {
        if condition() { return }
        try? await Task.sleep(for: .milliseconds(5))
    }
}

/// 只让出几次：用来确认「什么都不该发生」。
private func settle() async {
    for _ in 0 ..< 30 { await Task.yield() }
}

@MainActor
private struct Rig {
    let controller: VoiceController
    let recorder: FakeRecorder
    let transcriber: FakeTranscriber
    let presenter: FakePresenter
    let files: VoiceAudioFiles
    let models: VoiceModelStore

    init(modelReady: Bool = true, maxRecordingMs: UInt64 = 120_000) {
        let dir = scratch("rig")
        let payload = Data("fake-model".utf8)
        let spec = makeSpec(in: dir, payload: payload)
        if modelReady {
            try? FileManager.default.createDirectory(at: spec.path.deletingLastPathComponent(),
                                                     withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: spec.path.path, contents: payload)
        }
        recorder = FakeRecorder()
        transcriber = FakeTranscriber()
        presenter = FakePresenter()
        files = VoiceAudioFiles(directory: dir.appendingPathComponent("audio"))
        models = VoiceModelStore(spec: spec, fetcher: StubFetcher(payload: payload))
        controller = VoiceController(recorder: recorder, transcriber: transcriber, models: models, files: files,
                                     maxRecordingMs: maxRecordingMs, copyText: { _ in nil })
        controller.presenter = presenter
    }

    var phase: VoicePhase { controller.overlay.phase }
    var session: UInt64 { controller.session.snapshot().session }

    /// 这一句还没走完。交付（`.delivering`）也算：交付在单独的 Task 里写回目标框，
    /// 漏掉它时 `until { !busy }` 会在交付前返回，交付相关的断言随调度时机偶发失败。
    var busy: Bool {
        switch phase {
        case .starting, .recording, .transcribing, .postProcessing, .delivering: true
        default: false
        }
    }

    var failure: VoiceErrorKind? {
        if case let .failed(failure, _) = phase { failure.kind } else { nil }
    }

    /// 按下 → 开麦 → 松开。转写器挂起时停在「已开始转写」，否则等到这一句结束。
    /// 后处理或交付被测试挂起时传 `toEnd: false`：这一句不会自己结束，由调用方按自己的条件等，
    /// 否则 `until { !busy }` 只能空等到超时。
    func speak(toEnd: Bool = true) async {
        controller.press()
        await until { phase == .recording }
        let session = session
        controller.release()
        await until { transcriber.called(session) || !busy }
        if toEnd, !transcriber.hold { await until { !busy } }
    }
}

@MainActor
struct VoiceControllerTests {
    @Test func 按住说话松开后转写并显示结果_音频随即删除() async {
        let rig = Rig()
        rig.controller.press()
        #expect(rig.presenter.visible)
        #expect(rig.transcriber.prepared >= 1, "开始录音就预热模型")
        await until { rig.phase == .recording }
        #expect(rig.recorder.recording == 1)
        #expect(rig.files.leftovers() == 1)
        rig.controller.release()
        await until { !rig.busy }
        #expect(rig.transcriber.audioSeen(1) == true, "转写时音频还在")
        #expect(rig.phase == .done(text: "今天下午三点开会", transcript: "今天下午三点开会", truncated: false))
        #expect(rig.files.leftovers() == 0, "转写完临时音频就删")
        #expect(rig.presenter.visible)
        // Esc 收起浮层
        rig.controller.cancel()
        #expect(rig.phase == .idle)
        #expect(!rig.presenter.visible)
    }

    @Test func 首次使用没有模型_只显示下载入口不开麦() async {
        let rig = Rig(modelReady: false)
        rig.controller.press()
        await settle()
        #expect(rig.phase == .needsModel)
        #expect(rig.recorder.recording == nil)
        #expect(rig.presenter.visible)
        rig.controller.release()
        #expect(rig.phase == .needsModel)
        rig.controller.cancel()
        #expect(!rig.presenter.visible)
    }

    @Test func 录音中Esc_停麦并删除音频() async {
        let rig = Rig()
        rig.controller.press()
        await until { rig.phase == .recording }
        rig.controller.cancel()
        #expect(rig.phase == .cancelled)
        #expect(rig.recorder.recording == nil)
        #expect(rig.recorder.discarded == [1])
        #expect(rig.files.leftovers() == 0)
        #expect(!rig.presenter.visible)
        // 取消后的松开什么都不做
        rig.controller.release()
        await settle()
        #expect(rig.phase == .cancelled)
    }

    @Test func 转写中Esc_中止引擎_迟到的结果不显示() async {
        let rig = Rig()
        rig.transcriber.hold = true
        await rig.speak()
        #expect(rig.phase == .transcribing)
        rig.controller.cancel()
        #expect(rig.transcriber.cancelled == [1])
        #expect(rig.files.leftovers() == 0)
        rig.transcriber.finish(1, with: "迟到的结果")
        await until { rig.transcriber.pending == 0 }
        await settle()
        #expect(rig.phase == .cancelled)
        #expect(!rig.presenter.visible)
    }

    @Test func 转写中再按下_开新会话_旧会话的结果不覆盖新会话() async {
        let rig = Rig()
        rig.transcriber.hold = true
        await rig.speak()
        rig.controller.press()
        await until { rig.recorder.recording == 2 }
        #expect(rig.transcriber.cancelled == [1])
        rig.transcriber.finish(1, with: "上一句")
        await until { rig.transcriber.pending == 0 }
        await settle()
        #expect(rig.phase == .recording, "旧会话的迟到结果不能把新会话改成完成")
        rig.controller.release()
        await until { rig.transcriber.called(2) }
        rig.transcriber.finish(2, with: "这一句")
        await until { !rig.busy }
        #expect(rig.phase == .done(text: "这一句", transcript: "这一句", truncated: false))
        #expect(rig.files.leftovers() == 0)
    }

    @Test func 按住期间重复按下_不开新会话() async {
        let rig = Rig()
        rig.controller.press()
        await until { rig.phase == .recording }
        rig.controller.press()
        rig.controller.press()
        await settle()
        #expect(rig.session == 1)
        #expect(rig.recorder.recording == 1)
    }

    @Test func 停在权限框时松开_之后开麦也会被立即关掉() async {
        let rig = Rig()
        rig.recorder.holdStart = true
        rig.controller.press()
        await until { rig.recorder.waitingAtGate }
        rig.controller.release()
        #expect(rig.phase == .cancelled)
        rig.recorder.releaseGate()
        await until { rig.recorder.discarded.count >= 2 }
        #expect(rig.recorder.recording == nil, "迟到的开麦必须关掉")
        #expect(rig.files.leftovers() == 0)
    }

    @Test func 麦克风权限被拒_显示错误并清理() async {
        let rig = Rig()
        rig.recorder.startFailure = VoiceFault(kind: .micPermissionDenied, detail: "denied")
        rig.controller.press()
        await until { !rig.busy }
        #expect(rig.failure == .micPermissionDenied)
        if case let .failed(_, transcript) = rig.phase { #expect(transcript == nil) }
        #expect(rig.files.leftovers() == 0)
        #expect(rig.presenter.visible)
    }

    @Test func 录音中途设备断开_按失败处理() async {
        let rig = Rig()
        rig.controller.press()
        await until { rig.phase == .recording }
        rig.recorder.onFailure?(1, VoiceFault(kind: .noInputDevice, detail: "设备已断开"))
        #expect(rig.failure == .noInputDevice)
        #expect(rig.files.leftovers() == 0)
    }

    @Test func 按得太短_不转写() async {
        let rig = Rig()
        rig.recorder.durationMs = 120
        await rig.speak()
        #expect(rig.failure == .tooShort)
        #expect(!rig.transcriber.called(1), "太短的录音不送去转写")
        #expect(rig.files.leftovers() == 0)
    }

    @Test func 转写失败_报模型不可用并清理() async {
        let rig = Rig()
        rig.transcriber.result = .failure(VoiceFault(kind: .modelUnavailable, detail: "GGUF(4)"))
        await rig.speak()
        #expect(rig.failure == .modelUnavailable)
        #expect(rig.files.leftovers() == 0)
    }

    @Test func 录音到上限按松开处理() async {
        let rig = Rig(maxRecordingMs: 30)
        rig.controller.press()
        await until { rig.phase == .recording }
        await until { !rig.busy }
        #expect(rig.phase == .done(text: "今天下午三点开会", transcript: "今天下午三点开会", truncated: false))
    }

    @Test func 没接后处理时如实报失败并保留转写() async {
        let rig = Rig()
        await rig.speak()
        #expect(rig.phase == .done(text: "今天下午三点开会", transcript: "今天下午三点开会", truncated: false))
        // 打开后处理开关但没接实现：如实报失败、保留转写原文，不当作结果
        rig.controller.session.setPostProcess(enabled: true)
        await rig.speak()
        #expect(rig.failure == .postProcess)
        if case let .failed(_, transcript) = rig.phase { #expect(transcript == "今天下午三点开会") }
    }

    @Test func 接上后处理_整理键整理_翻译键翻译() async {
        let rig = Rig()
        let post = FakePostProcessor()
        rig.controller.postProcessor = post
        #expect(rig.controller.session.snapshot().phase == .idle)
        await rig.speak()
        await until { !rig.busy }
        #expect(post.calls.map(\.task) == [.tidy])
        #expect(post.calls.first?.text == "今天下午三点开会")
        #expect(rig.phase == .done(text: "今天下午三点开会。", transcript: "今天下午三点开会", truncated: false))

        post.result = .success(VoicePostOutcome(text: "Meeting at 3 pm today.", truncated: false))
        rig.controller.press(.translate)
        #expect(rig.controller.overlay.task == .translate)
        await until { rig.phase == .recording }
        rig.controller.release()
        await until { !rig.busy }
        #expect(post.calls.map(\.task) == [.tidy, .translate])
        #expect(rig.phase == .done(text: "Meeting at 3 pm today.", transcript: "今天下午三点开会", truncated: false))
    }

    @Test func 截断的结果标出来_可重试_重试沿用同一任务() async {
        let rig = Rig()
        let post = FakePostProcessor()
        post.result = .success(VoicePostOutcome(text: "Meeting at", truncated: true))
        rig.controller.postProcessor = post
        rig.controller.press(.translate)
        await until { rig.phase == .recording }
        rig.controller.release()
        await until { !rig.busy }
        #expect(rig.phase == .done(text: "Meeting at", transcript: "今天下午三点开会", truncated: true))
        #expect(rig.presenter.visible)
        post.result = .success(VoicePostOutcome(text: "Meeting at 3 pm today.", truncated: false))
        rig.controller.retry()
        await until { !rig.busy }
        #expect(post.calls.map(\.task) == [.translate, .translate])
        #expect(post.calls.map(\.session) == [1, 1], "重试不开新会话")
        #expect(rig.phase == .done(text: "Meeting at 3 pm today.", transcript: "今天下午三点开会", truncated: false))
    }

    @Test func 后处理失败_保留转写和原因_可重试() async {
        let rig = Rig()
        let post = FakePostProcessor()
        post.result = .failure(VoiceFault(kind: .postProcess, detail: "请先配置 API Key"))
        rig.controller.postProcessor = post
        await rig.speak()
        await until { !rig.busy }
        #expect(rig.phase == .failed(failure: VoiceFailure(kind: .postProcess, detail: "请先配置 API Key"),
                                     transcript: "今天下午三点开会"))
        post.result = .success(VoicePostOutcome(text: "今天下午三点开会。", truncated: false))
        rig.controller.retry()
        await until { !rig.busy }
        #expect(rig.phase == .done(text: "今天下午三点开会。", transcript: "今天下午三点开会", truncated: false))
    }

    @Test func 后处理中Esc_取消请求_迟到的结果不显示() async {
        let rig = Rig()
        let post = FakePostProcessor()
        post.hold = true
        rig.controller.postProcessor = post
        await rig.speak(toEnd: false)
        await until { post.pending == 1 }
        #expect(rig.phase == .postProcessing(transcript: "今天下午三点开会"))
        rig.controller.cancel()
        #expect(post.cancelled == [1])
        #expect(rig.phase == .cancelled)
        post.finish(1, with: VoicePostOutcome(text: "迟到的结果", truncated: false))
        await settle()
        #expect(rig.phase == .cancelled)
        #expect(!rig.presenter.visible)
    }

    @Test func 引擎还没加载好时转写中显示正在准备() async {
        let rig = Rig()
        rig.transcriber.engineReady = false
        rig.transcriber.hold = true
        await rig.speak()
        #expect(rig.phase == .transcribing)
        #expect(rig.controller.overlay.preparingEngine)
        rig.transcriber.finish(1, with: "好")
        await until { !rig.busy }
        #expect(!rig.controller.overlay.preparingEngine)
        // 已加载时不提示
        rig.transcriber.engineReady = true
        rig.transcriber.hold = true
        await rig.speak()
        #expect(!rig.controller.overlay.preparingEngine)
    }

    @Test func 完整结果交付到录音开始时的目标_成功后收起浮层() async {
        let rig = Rig()
        let post = FakePostProcessor()
        let delivery = FakeDeliverer()
        rig.controller.postProcessor = post
        rig.controller.deliverer = delivery
        await rig.speak()
        await until { !rig.busy }
        #expect(delivery.captured == [1], "按下开麦时就记目标")
        #expect(delivery.delivered.map(\.text) == ["今天下午三点开会。"])
        #expect(rig.phase == .idle)
        #expect(!rig.presenter.visible, "交付成功即收起")
    }

    @Test func 交付被拒_保留结果与原因_不收起() async {
        let rig = Rig()
        let delivery = FakeDeliverer()
        delivery.refusal = .focusChanged
        rig.controller.postProcessor = FakePostProcessor()
        rig.controller.deliverer = delivery
        await rig.speak()
        await until { !rig.busy }
        #expect(rig.phase == .undelivered(text: "今天下午三点开会。", transcript: "今天下午三点开会", reason: .focusChanged))
        #expect(rig.presenter.visible)
    }

    @Test func 截断与失败的结果不交付() async {
        let rig = Rig()
        let post = FakePostProcessor()
        let delivery = FakeDeliverer()
        rig.controller.postProcessor = post
        rig.controller.deliverer = delivery
        post.result = .success(VoicePostOutcome(text: "今天下午", truncated: true))
        await rig.speak()
        await until { !rig.busy }
        #expect(rig.phase == .done(text: "今天下午", transcript: "今天下午三点开会", truncated: true))
        post.result = .failure(VoiceFault(kind: .postProcess, detail: "超时"))
        await rig.speak()
        await until { !rig.busy }
        #expect(rig.failure == .postProcess)
        #expect(delivery.delivered.isEmpty)
    }

    @Test func 取消或新会话之后迟到的结果不交付() async {
        let rig = Rig()
        let post = FakePostProcessor()
        post.hold = true
        let delivery = FakeDeliverer()
        rig.controller.postProcessor = post
        rig.controller.deliverer = delivery
        await rig.speak(toEnd: false)
        await until { post.pending == 1 }
        rig.controller.cancel()
        post.finish(1, with: VoicePostOutcome(text: "迟到的结果", truncated: false))
        await settle()
        #expect(delivery.delivered.isEmpty)

        // 交付中按 Esc：通知放弃，之后的「已交付」不改状态
        post.hold = false
        delivery.hold = true
        await rig.speak(toEnd: false)
        await until { delivery.delivered.count == 1 }
        rig.controller.cancel()
        #expect(delivery.cancelled == [2])
        delivery.finish(2, nil)
        await settle()
        #expect(rig.phase == .cancelled)
    }

    @Test func 下载完成后预热引擎() async {
        let rig = Rig(modelReady: false)
        let before = rig.transcriber.prepared
        rig.models.download()
        await rig.models.wait()
        #expect(rig.models.state == .ready)
        #expect(rig.transcriber.prepared == before + 1)
        rig.controller.press()
        await until { rig.phase == .recording }
        #expect(rig.phase == .recording)
    }
}

@MainActor
struct VoiceModelStoreTests {
    let payload = Data((0 ..< 1000).map { UInt8($0 % 251) })

    @Test func 下载校验通过后才出现在最终路径() async {
        let dir = scratch("ok")
        let spec = makeSpec(in: dir, payload: payload)
        let store = VoiceModelStore(spec: spec, fetcher: StubFetcher(payload: payload))
        #expect(store.state == .missing)
        store.download()
        await store.wait()
        #expect(store.state == .ready)
        #expect(store.isReady)
        #expect(FileManager.default.contents(atPath: spec.path.path) == payload)
        #expect(!FileManager.default.fileExists(atPath: spec.partialPath.path))
        // 重新打开只看文件在不在、大小对不对
        #expect(VoiceModelStore(spec: spec, fetcher: StubFetcher(payload: payload)).state == .ready)
    }

    @Test func 中途断网_保留已下载部分_重试从断点续传() async {
        let dir = scratch("resume")
        let spec = makeSpec(in: dir, payload: payload)
        let fetcher = StubFetcher(payload: payload)
        fetcher.dropAfter = 420
        let store = VoiceModelStore(spec: spec, fetcher: fetcher)
        store.download()
        await store.wait()
        guard case .failed(.network) = store.state else {
            Issue.record("应当是网络失败：\(store.state)")
            return
        }
        let kept = VoiceModelStore.partialBytes(spec)
        #expect(kept >= 420 && kept < Int64(payload.count))
        store.download()
        await store.wait()
        #expect(store.state == .ready)
        #expect(fetcher.offsets == [0, kept], "重试带 Range 从已下载处继续")
        #expect(FileManager.default.contents(atPath: spec.path.path) == payload)
    }

    @Test func 服务器不认续传_从头重下() async {
        let dir = scratch("norange")
        let spec = makeSpec(in: dir, payload: payload)
        try? FileManager.default.createDirectory(at: spec.partialPath.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: spec.partialPath.path, contents: Data(repeating: 0xFF, count: 300))
        let fetcher = StubFetcher(payload: payload)
        fetcher.ignoresRange = true
        let store = VoiceModelStore(spec: spec, fetcher: fetcher)
        store.download()
        await store.wait()
        #expect(store.state == .ready)
        #expect(FileManager.default.contents(atPath: spec.path.path) == payload, "不能把旧的半截拼在前面")
    }

    @Test func 哈希不一致_删除文件并报校验失败() async {
        let dir = scratch("checksum")
        let spec = makeSpec(in: dir, payload: payload, sha: String(repeating: "0", count: 64))
        let store = VoiceModelStore(spec: spec, fetcher: StubFetcher(payload: payload))
        store.download()
        await store.wait()
        #expect(store.state == .failed(.checksum))
        #expect(!FileManager.default.fileExists(atPath: spec.partialPath.path))
        #expect(!FileManager.default.fileExists(atPath: spec.path.path))
        #expect(!store.isReady)
    }

    @Test func 比期望的大_立即失败并删除() async {
        let dir = scratch("toolarge")
        let bigger = payload + Data(repeating: 1, count: 50)
        let spec = makeSpec(in: dir, payload: payload)
        let store = VoiceModelStore(spec: spec, fetcher: StubFetcher(payload: bigger))
        store.download()
        await store.wait()
        #expect(store.state == .failed(.checksum))
        #expect(!FileManager.default.fileExists(atPath: spec.partialPath.path))
    }

    @Test func 服务器报错_可重试() async {
        let dir = scratch("error")
        let spec = makeSpec(in: dir, payload: payload)
        let fetcher = StubFetcher(payload: payload)
        fetcher.failWith = URLError(.badServerResponse)
        let store = VoiceModelStore(spec: spec, fetcher: fetcher)
        store.download()
        await store.wait()
        guard case .failed(.network) = store.state else {
            Issue.record("应当是网络失败：\(store.state)")
            return
        }
        fetcher.failWith = nil
        store.download()
        await store.wait()
        #expect(store.state == .ready)
    }

    @Test func 取消下载_回到未下载_保留断点() async {
        let dir = scratch("cancel")
        let spec = makeSpec(in: dir, payload: payload)
        let fetcher = StubFetcher(payload: payload)
        let store = VoiceModelStore(spec: spec, fetcher: fetcher)
        store.download()
        store.cancel()
        await store.wait()
        #expect(store.state == .missing)
        #expect(!store.isDownloading)
        store.download()
        await store.wait()
        #expect(store.state == .ready)
    }

    @Test func 模型在外面被删掉_按下时现查() {
        let dir = scratch("deleted")
        let spec = makeSpec(in: dir, payload: payload)
        try? FileManager.default.createDirectory(at: spec.path.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: spec.path.path, contents: payload)
        let store = VoiceModelStore(spec: spec, fetcher: StubFetcher(payload: payload))
        #expect(store.isReady)
        try? FileManager.default.removeItem(at: spec.path)
        #expect(!store.isReady)
        #expect(store.state == .missing)
    }

    @Test func 分块哈希与一次性哈希一致() throws {
        let dir = scratch("hash")
        let url = dir.appendingPathComponent("blob")
        let big = Data((0 ..< (5 << 20)).map { UInt8($0 & 0xFF) })
        try big.write(to: url)
        #expect(try VoiceModelStore.sha256(of: url) == sha256(big))
    }
}

struct VoiceRulesTests {
    @Test func 临时音频_写入读回与启动清扫() throws {
        let files = VoiceAudioFiles(directory: scratch("audio"))
        for session in [UInt64(1), 2, 3] {
            let handle = try files.create(session)
            let samples: [Float] = [0.5, -0.25]
            try samples.withUnsafeBufferPointer { try VoiceAudioFiles.append($0, to: handle) }
            try handle.close()
        }
        #expect(try VoiceAudioFiles.samples(at: files.url(for: 2)) == [0.5, -0.25])
        let mode = try FileManager.default.attributesOfItem(atPath: files.url(for: 1).path)[.posixPermissions] as? Int
        #expect(mode == 0o600, "录音只给自己读写")
        files.remove(1)
        files.remove(1)
        #expect(files.leftovers() == 2)
        files.sweep()
        #expect(files.leftovers() == 0)
        #expect(VoiceAudioFiles.durationMs(samples: 16000) == 1000)
    }

    @Test func 取消可以早于转写开始() {
        let flag = AbortFlag()
        flag.cancel(3)
        #expect(!flag.begin(3), "先到的取消让转写直接放弃")
        flag.finish(3)
        #expect(flag.begin(4))
        #expect(!flag.shouldAbort)
        flag.cancel(4)
        #expect(flag.shouldAbort, "推理中收到取消")
        flag.finish(4)
        #expect(!flag.shouldAbort)
    }

    @Test func 语音键默认值合法且不与现有默认键位冲突() {
        let defaults = HotkeyCenter.table.map { (label: $0.field, value: $0.fallback) }
            + [("selection", "Ctrl Ctrl"), ("silentReplace", "Alt Alt"),
               ("compare", "Alt+P"), ("ocrSilent", "Alt+Shift+O"), ("speak", "Alt+R")]
        for row in HotkeyCenter.voiceTable {
            guard case .combo = HotkeyCombo.parse(row.fallback) else {
                Issue.record("\(row.fallback) 解析不出组合键")
                continue
            }
            let others = defaults + HotkeyCenter.voiceTable.filter { $0.field != row.field }
                .map { (label: $0.field, value: $0.fallback) }
            #expect(HotkeyConflict.check(row.fallback, others: others) == nil, "\(row.field)")
        }
        #expect(HotkeyFormat.parts(HotkeyCenter.voiceCombo).joined() == "⌥⌘V")
        #expect(HotkeyFormat.parts(HotkeyCenter.voiceTranslateCombo).joined() == "⌃⌘V")
        #expect(HotkeyCenter.voiceTable.map(\.task) == [.tidy, .translate])
    }

    @Test func 语音键_读设置_连按不注册_非法值回落() {
        let values = HotkeyCenter.values(settingsJson: #"{"voiceHotkey":"Ctrl+Alt+Space","voiceTranslateHotkey":"Ctrl Ctrl","theme":"dark"}"#)
        #expect(values[HotkeyCenter.voiceField] == "Ctrl+Alt+Space")
        #expect(values["theme"] == nil)
        #expect(HotkeyCenter.voicePlan("Ctrl Ctrl", fallback: HotkeyCenter.voiceTranslateCombo) == nil, "按住说话不能用连按")
        #expect(HotkeyCenter.voicePlan("Ctrl+Foo", fallback: HotkeyCenter.voiceCombo)
            == HotkeyCombo.parse(HotkeyCenter.voiceCombo))
        #expect(HotkeyCenter.voicePlan("", fallback: HotkeyCenter.voiceCombo) == HotkeyCombo.parse(HotkeyCenter.voiceCombo))
        let labels = HotkeyCenter.voiceLabels(values)
        #expect(labels[.tidy] == "⌃⌥Space" || labels[.tidy]?.hasPrefix("⌃⌥") == true)
        #expect(HotkeyCenter.voiceLabels([:])[.translate] == "⌃⌘V")
        #expect(HotkeyCenter.voiceLabels([HotkeyCenter.voiceField: "Ctrl+Foo"])[.tidy] == "⌥⌘V", "非法值显示实际注册的默认键")
    }

    @Test func 后处理结果换型_失败带说明() throws {
        let output = VoicePostOutput(task: .translate, text: "Hi", transcript: "你好", sourceLang: "zh-CN",
                                     outputLang: "en", provider: "OpenAI", providerId: "openai", model: "m",
                                     firstTokenMs: nil, totalMs: 1, truncated: true)
        #expect(try EngineVoicePostProcessor.outcome(.done(output: output)) == VoicePostOutcome(text: "Hi", truncated: true))
        let failure = VoicePostFailure(kind: .failed, message: "网络不可用", transcript: "你好", retryable: true,
                                       cancelled: false)
        #expect(throws: VoiceFault(kind: .postProcess, detail: "网络不可用")) {
            try EngineVoicePostProcessor.outcome(.failed(failure: failure))
        }
    }

    @Test @MainActor func 后处理在登记句柄之前被取消_不再发请求() async {
        // 状态机发 cancelPostProcess 时，run 可能还排在 Task 里没开始：那时没有句柄可取消。
        // 取消要先记下，run 一开始就认出来，不去调 Engine.startVoice（否则请求照发、照计费）。
        var asked = 0
        let processor = EngineVoicePostProcessor(engine: {
            asked += 1
            return nil
        }, unavailable: { "内核还没有启动" })
        processor.cancel(session: 3)
        await #expect(throws: VoiceFault.self) {
            _ = try await processor.run(session: 3, text: "你好", task: .tidy)
        }
        #expect(asked == 0, "已取消的会话不该再去拿 Engine 发请求")
        // 别的会话不受影响
        await #expect(throws: VoiceFault(kind: .postProcess, detail: "内核还没有启动")) {
            _ = try await processor.run(session: 4, text: "你好", task: .tidy)
        }
        #expect(asked == 1)
    }

    @Test func 每种错误与下载失败都有四语言文案() {
        let catalog = StringCatalog.main
        let kinds: [VoiceErrorKind] = [.micPermissionDenied, .noInputDevice, .recording, .tooShort, .noSpeech,
                                       .modelUnavailable, .transcription, .postProcess]
        for kind in kinds {
            #expect(catalog.entries[VoiceOverlayView.messageKey(kind)]?.values.count == 4, "\(kind)")
        }
        #expect(catalog.entries["voice.micUsage"]?.values.count == 4)
        for key in ["voice.retry", "voice.truncated", "voice.preparingEngine", "voice.translating",
                    "prefs.voice.tidy", "prefs.voice.translate", "prefs.hotkey.comboOnly", "history.sceneVoice"] {
            #expect(catalog.entries[key]?.values.count == 4, "\(key)")
        }
        #expect(VoiceOverlayView.elapsed(from: Date(timeIntervalSince1970: 0), to: Date(timeIntervalSince1970: 75))
            == "1:15")
    }
}
