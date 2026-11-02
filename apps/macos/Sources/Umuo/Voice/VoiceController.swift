import AppKit
import Observation
import UmuoCore

/// 一次语音环节的失败：状态机的错误类别 + 排查用的细节。录音器、转写器、后处理都抛它。
struct VoiceFault: Error, Equatable {
    let kind: VoiceErrorKind
    let detail: String
}

/// 麦克风录音（正式实现 `SystemVoiceRecorder`，测试换成假录音器）。
@MainActor
protocol VoiceRecording: AnyObject {
    /// 录音中途失败（输入设备被拔掉、音频引擎被系统停掉）时回报，参数是会话号。
    var onFailure: ((UInt64, VoiceFault) -> Void)? { get set }
    /// 申请权限（需要时）、开麦，把 16 kHz 单声道 Float32 采样写进 `output`。返回时已经在录；失败抛 `VoiceFault`。
    func start(session: UInt64, output: FileHandle) async throws
    /// 正常结束：停麦、写完并关闭文件，返回录到的时长（毫秒）。
    func stop(session: UInt64) async throws -> UInt64
    /// 停麦并丢弃。幂等；不是正在录的会话就什么都不做。
    func discard(session: UInt64)
}

/// 本地转写（正式实现 `LocalTranscriber`，测试换成假转写器）。方法可以从任意线程调用。
protocol VoiceTranscribing: AnyObject, Sendable {
    /// 模型与引擎已加载好、可以直接推理。**不阻塞**（加载期间也立即返回 false）：
    /// 首次在一台机器上初始化 Metal 要约 45 秒，浮层据此显示「正在准备语音引擎」。
    var isEngineReady: Bool { get }
    /// 预热：模型没加载就在后台加载（录音一开始就调，让加载与说话重叠）；同时刷新空闲计时。
    func prepare()
    /// 转写一段临时音频。失败抛 `VoiceFault`（`modelUnavailable` / `transcription`）。
    func transcribe(session: UInt64, audio: URL) async throws -> String
    /// 让这一会话的转写中止（引擎的 abort 回调）。幂等；可以早于 `transcribe` 到达。
    func cancel(session: UInt64)
}

/// 一次后处理的结果。`truncated`：输出没说完，可展示、复制、重试，不交付。
struct VoicePostOutcome: Equatable {
    let text: String
    let truncated: Bool
}

/// 后处理（同语言整理 / 翻译到目标语言）。正式实现 `EngineVoicePostProcessor`（任务本身在 Rust 的
/// `Engine.startVoice`），测试换成假的。接上之后 `VoiceController` 才打开状态机的后处理。
@MainActor
protocol VoicePostProcessing: AnyObject {
    /// 失败抛 `VoiceFault`（`detail` 是给用户看的说明）。被取消时也可以抛：状态机按迟到忽略。
    func run(session: UInt64, text: String, task: VoiceTask) async throws -> VoicePostOutcome
    func cancel(session: UInt64)
}

/// 浮层的显示与收起（正式实现 `VoicePanelController`）。
@MainActor
protocol VoiceOverlayPresenting: AnyObject {
    func show()
    func hide()
}

/// 浮层视图读的状态与按钮动作。
@MainActor @Observable
final class VoiceOverlayModel {
    var phase: VoicePhase = .idle
    /// 这一次录音开始的时刻（录音中显示已录多久）。
    var recordingSince: Date?
    /// 刚复制成功（按钮短暂显示「已复制」）。
    var copied = false
    var t = Translate(locale: .zhCN)
    /// 两个语音键的显示名（「⌥⌘V」），提示文案里用。
    var hotkeyLabels: [VoiceTask: String] = [:]
    /// 当前会话做的是整理还是翻译（按下的是哪个键）。
    var task: VoiceTask = .tidy
    /// 引擎还在加载（首次初始化 Metal 约 45 秒）：转写中显示「正在准备语音引擎」。
    var preparingEngine = false
    let models: VoiceModelStore

    /// 当前会话那个键的显示名。
    var hotkeyLabel: String { hotkeyLabels[task] ?? "" }

    @ObservationIgnored var onCancel: (() -> Void)?
    @ObservationIgnored var onRetry: (() -> Void)?
    @ObservationIgnored var onCopy: ((String) -> Void)?
    @ObservationIgnored var onOpenMicSettings: (() -> Void)?

    init(models: VoiceModelStore) {
        self.models = models
    }
}

/// 语音输入的宿主编排：快捷键 → Rust 状态机（`VoiceSession`）→ 按它给的副作用开麦、转写、后处理、清理，
/// 再把结果按会话号喂回去。规则（会话号、迟到结果、Esc 全链路取消、何时清理音频、重试）都在
/// `umuo_app::voice_session`，这里不重写。
@MainActor
final class VoiceController {
    let session = VoiceSession()
    let overlay: VoiceOverlayModel
    let models: VoiceModelStore
    let files: VoiceAudioFiles
    private let recorder: VoiceRecording
    private let transcriber: VoiceTranscribing
    private let maxRecordingMs: UInt64
    private let copyText: (String) async -> String?
    /// 后处理。接上（非 nil）就打开状态机的后处理：转写之后按会话的任务整理或翻译。
    var postProcessor: VoicePostProcessing? {
        didSet { session.setPostProcess(enabled: postProcessor != nil) }
    }
    /// 向录音开始时的输入框交付（阶段 E）。接上就打开状态机的交付：完整结果核验目标后写入，成功即收起浮层。
    var deliverer: VoiceDelivering? {
        didSet { session.setDeliver(enabled: deliverer != nil) }
    }
    var presenter: VoiceOverlayPresenting?
    /// 录音上限的计时（只对当时的会话有效，过期的由状态机忽略）。
    private var limitTask: Task<Void, Never>?

    init(recorder: VoiceRecording, transcriber: VoiceTranscribing, models: VoiceModelStore,
         files: VoiceAudioFiles = .standard, maxRecordingMs: UInt64,
         copyText: @escaping (String) async -> String?)
    {
        self.recorder = recorder
        self.transcriber = transcriber
        self.models = models
        self.files = files
        self.maxRecordingMs = maxRecordingMs
        self.copyText = copyText
        overlay = VoiceOverlayModel(models: models)
        overlay.onCancel = { [weak self] in self?.cancel() }
        overlay.onRetry = { [weak self] in self?.retry() }
        overlay.onCopy = { [weak self] text in self?.copy(text) }
        recorder.onFailure = { [weak self] session, fault in
            self?.feed(.recordingFailed(session: session, kind: fault.kind, detail: fault.detail))
        }
        // 下载完成就预热：首次初始化 Metal 要编译着色器（实测约 45 秒），别留到第一次说完话才做。
        models.onReady = { [weak transcriber] in transcriber?.prepare() }
    }

    // MARK: - 入口（快捷键、Esc、浮层按钮）

    /// 语音键按下。`task`：按的是整理键还是翻译键。
    func press(_ task: VoiceTask = .tidy) { feed(.press(modelReady: models.isReady, task: task)) }
    func release() { feed(.release) }
    /// Esc 或浮层的关闭按钮。
    func cancel() { feed(.cancel) }
    /// 浮层上的「重试」：后处理失败或结果被截断时，用同一段转写、同一个任务再做一次。
    func retry() { feed(.retry) }

    /// 喂一个事件给状态机，执行它要的副作用，再按新状态显示或收起浮层。
    func feed(_ input: VoiceInput) {
        let step = session.handle(input: input)
        overlay.phase = step.phase
        if case .starting = step.phase { overlay.copied = false }
        if case let .press(_, task) = input, step.effects.contains(where: Self.startsRecording) { overlay.task = task }
        switch input {
        case .transcribed, .transcriptionFailed, .cancel, .press: overlay.preparingEngine = false
        default: break
        }
        if case .recordingStarted = input, case .recording = step.phase {
            overlay.recordingSince = Date()
            armLimit(step.session)
        }
        if case .recording = step.phase {} else { limitTask?.cancel() }
        for effect in step.effects { run(effect) }
        if step.visible { presenter?.show() } else { presenter?.hide() }
    }

    // MARK: - 副作用

    /// 副作用里当场就失败（没接上交付、没接上后处理、建不了临时文件）：失败事件**异步**喂回去。
    /// 同步 \`feed\` 会在这一轮 \`for effect in step.effects\` 还没跑完时就推进状态机，
    /// 剩下的旧副作用再按旧的一步执行，浮层也会被旧一步的可见性盖回去。
    private func feedLater(_ input: VoiceInput) {
        Task { self.feed(input) }
    }

    private func run(_ effect: VoiceEffect) {
        switch effect {
        case let .startRecording(session): startRecording(session)
        case let .stopRecording(session): stopRecording(session)
        case let .discardRecording(session): recorder.discard(session: session)
        case let .transcribe(session):
            overlay.preparingEngine = !transcriber.isEngineReady
            transcribe(session)
        case let .cancelTranscription(session): transcriber.cancel(session: session)
        case let .postProcess(session, text, task): postProcess(session, text, task)
        case let .cancelPostProcess(session): postProcessor?.cancel(session: session)
        case let .cleanupAudio(session): files.remove(session)
        case let .deliver(session, text): deliver(session, text)
        case let .cancelDelivery(session): deliverer?.cancel(session: session)
        }
    }

    private func deliver(_ session: UInt64, _ text: String) {
        guard let deliverer else {
            return feedLater(.deliveryRefused(session: session, reason: .unverifiable))
        }
        Task {
            if let reason = await deliverer.deliver(session: session, text: text) {
                feed(.deliveryRefused(session: session, reason: reason))
            } else {
                feed(.delivered(session: session))
            }
        }
    }

    private func startRecording(_ session: UInt64) {
        // 录音一开始就预热模型：加载与说话重叠，松开后只剩推理的时间。
        transcriber.prepare()
        // 交付目标在按下的这一刻记：用户此时正对着要输入的那个框（PRD §5.11）
        deliverer?.capture(session: session)
        let output: FileHandle
        do {
            output = try files.create(session)
        } catch {
            return feedLater(.recordingFailed(session: session, kind: .recording, detail: "\(error)"))
        }
        Task {
            do {
                try await recorder.start(session: session, output: output)
                feed(.recordingStarted(session: session))
            } catch {
                try? output.close()
                let fault = Self.fault(error, default: .recording)
                feed(.recordingFailed(session: session, kind: fault.kind, detail: fault.detail))
            }
        }
    }

    private func stopRecording(_ session: UInt64) {
        Task {
            do {
                let ms = try await recorder.stop(session: session)
                feed(.recorded(session: session, durationMs: ms))
            } catch {
                let fault = Self.fault(error, default: .recording)
                feed(.recordingFailed(session: session, kind: fault.kind, detail: fault.detail))
            }
        }
    }

    private func transcribe(_ session: UInt64) {
        let transcriber = transcriber
        let audio = files.url(for: session)
        Task {
            do {
                let text = try await transcriber.transcribe(session: session, audio: audio)
                feed(.transcribed(session: session, text: text))
            } catch {
                let fault = Self.fault(error, default: .transcription)
                feed(.transcriptionFailed(session: session, kind: fault.kind, detail: fault.detail))
            }
        }
    }

    private func postProcess(_ session: UInt64, _ text: String, _ task: VoiceTask) {
        // 没接上时状态机本来就不会走到后处理；万一走到了只显示通用的失败文案（详情留空）
        guard let postProcessor else { return feedLater(.postProcessFailed(session: session, detail: "")) }
        Task {
            do {
                let result = try await postProcessor.run(session: session, text: text, task: task)
                feed(.postProcessed(session: session, text: result.text, truncated: result.truncated))
            } catch {
                feed(.postProcessFailed(session: session, detail: Self.fault(error, default: .postProcess).detail))
            }
        }
    }

    /// 录音到上限按松开处理（`RecordingLimitReached`）。计时只认开始录的那个会话。
    private func armLimit(_ session: UInt64) {
        limitTask?.cancel()
        let limit = maxRecordingMs
        limitTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(Int64(limit)))
            guard !Task.isCancelled else { return }
            self?.feed(.recordingLimitReached(session: session))
        }
    }

    private func copy(_ text: String) {
        Task {
            let failure = await copyText(text)
            overlay.copied = failure == nil
        }
    }

    private static func startsRecording(_ effect: VoiceEffect) -> Bool {
        if case .startRecording = effect { true } else { false }
    }

    static func fault(_ error: Error, default kind: VoiceErrorKind) -> VoiceFault {
        (error as? VoiceFault) ?? VoiceFault(kind: kind, detail: "\(error)")
    }
}
