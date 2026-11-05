import Foundation
import os
import UmuoCore

/// 语音后处理的正式实现：调 Rust 的 `Engine.startVoice`（整理或翻译，复用当前文字模型、Key 与取消协议）。
///
/// 与文字翻译同一套约定：在后台同步启动、立即拿到句柄，结果经 sink 在 tokio 工作线程上回来，
/// 这里只 resume 一个 continuation，不 `DispatchQueue.main.sync`。Esc / 新会话顶掉旧会话时状态机发
/// `cancelPostProcess`，这里调句柄的 `cancel()`：传输层最迟 100 ms 内停下，不再计费。
/// 成功且完整的结果由 Rust 按历史规则记一条（场景 `voice`），这里不碰历史。
@MainActor
final class EngineVoicePostProcessor: VoicePostProcessing {
    private let engine: @MainActor () -> Engine?
    /// 内核还没打开时给用户看的那句话（`AppModel.engineStatus`，已按界面语言取好）。
    private let unavailable: @MainActor () -> String
    /// 每个会话正在跑的请求（取消用）。
    private var handles: [UInt64: RequestHandle] = [:]
    /// 已被取消的会话。状态机发 `cancelPostProcess` 时 `run` 可能还排在 Task 里、句柄还没登记，
    /// 取消先记在这里，`run` 一开始就认出来，不再调 `startVoice`（否则请求照发、照计费）。与交付的做法相同。
    private var cancelled: Set<UInt64> = []
    /// 还在等结果的会话（后台登记句柄时用来认出「已经结束了」）。
    private var running: Set<UInt64> = []

    init(engine: @escaping @MainActor () -> Engine?, unavailable: @escaping @MainActor () -> String) {
        self.engine = engine
        self.unavailable = unavailable
    }

    func run(session: UInt64, text: String, task: VoiceTask) async throws -> VoicePostOutcome {
        // 旧请求可能仍在后台等待句柄登记，取消记录必须保留到请求结束。
        // 会话号单调递增：只清理已结束的旧会话。
        cancelled = cancelled.filter { $0 >= session || running.contains($0) }
        // 详情不显示：被取消的结果状态机按迟到忽略
        guard !cancelled.contains(session) else { throw VoiceFault(kind: .postProcess, detail: "") }
        guard let engine = engine() else {
            throw VoiceFault(kind: .postProcess, detail: unavailable())
        }
        let request = VoicePostRequest(transcript: text, task: task, sourceLang: nil, targetLang: nil)
        running.insert(session)
        let result = await withCheckedContinuation { (continuation: CheckedContinuation<VoicePostResult, Never>) in
            let sink = OneShotVoiceSink(continuation)
            // Engine 的同步方法在后台调（ARCHITECTURE §2.3，与浮窗的 translate 一致），句柄回到 MainActor 再登记
            Task.detached {
                let handle = engine.startVoice(session: session, request: request, sink: sink)
                await self.register(handle, session: session)
            }
        }
        running.remove(session)
        handles[session] = nil
        return try Self.outcome(result)
    }

    /// 后台拿到的句柄回来登记。两种迟到要处理：结果先于句柄落地（会话已结束，不再存，免得字典残留）；
    /// 句柄还没登记时取消已经到了（`cancel` 当时没有句柄可取消，这里补上）。
    private func register(_ handle: RequestHandle, session: UInt64) {
        guard running.contains(session) else { return }
        if cancelled.contains(session) {
            handle.cancel()
        } else {
            handles[session] = handle
        }
    }

    func cancel(session: UInt64) {
        cancelled.insert(session)
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
