import Foundation
import os
import UmuoCore

/// 语音后处理的正式实现：调 Rust 的 `Engine.startVoice`（整理或翻译，复用当前文字模型、Key 与取消协议）。
///
/// 与文字翻译同一套约定：同步启动、立即拿到句柄，结果经 sink 在 tokio 工作线程上回来，
/// 这里只 resume 一个 continuation，不 `DispatchQueue.main.sync`。Esc / 新会话顶掉旧会话时状态机发
/// `cancelPostProcess`，这里调句柄的 `cancel()`：传输层最迟 100 ms 内停下，不再计费。
/// 成功且完整的结果由 Rust 按历史规则记一条（场景 `voice`），这里不碰历史。
@MainActor
final class EngineVoicePostProcessor: VoicePostProcessing {
    private let engine: @MainActor () -> Engine?
    /// 每个会话正在跑的请求（取消用）。
    private var handles: [UInt64: RequestHandle] = [:]

    init(engine: @escaping @MainActor () -> Engine?) {
        self.engine = engine
    }

    func run(session: UInt64, text: String, task: VoiceTask) async throws -> VoicePostOutcome {
        guard let engine = engine() else {
            throw VoiceFault(kind: .postProcess, detail: "内核还没有启动")
        }
        let request = VoicePostRequest(transcript: text, task: task, sourceLang: nil, targetLang: nil)
        let result = await withCheckedContinuation { (continuation: CheckedContinuation<VoicePostResult, Never>) in
            handles[session] = engine.startVoice(session: session, request: request,
                                                 sink: OneShotVoiceSink(continuation))
        }
        handles[session] = nil
        return try Self.outcome(result)
    }

    func cancel(session: UInt64) {
        handles[session]?.cancel()
    }

    /// Rust 的结果 → 状态机要的结果；失败带上给用户看的说明。
    nonisolated static func outcome(_ result: VoicePostResult) throws -> VoicePostOutcome {
        switch result {
        case let .done(output):
            return VoicePostOutcome(text: output.text, truncated: output.truncated)
        case let .failed(failure):
            throw VoiceFault(kind: .postProcess, detail: failure.message)
        }
    }
}

/// 只 resume 一次的 sink：Rust 每次请求恰好回调一次，这里再防一手重复调用。
final class OneShotVoiceSink: VoiceSink, @unchecked Sendable {
    private let continuation = OSAllocatedUnfairLock<CheckedContinuation<VoicePostResult, Never>?>(initialState: nil)

    init(_ continuation: CheckedContinuation<VoicePostResult, Never>) {
        self.continuation.withLock { $0 = continuation }
    }

    func onResult(session _: UInt64, result: VoicePostResult) {
        let pending = continuation.withLock { value -> CheckedContinuation<VoicePostResult, Never>? in
            defer { value = nil }
            return value
        }
        pending?.resume(returning: result)
    }
}
