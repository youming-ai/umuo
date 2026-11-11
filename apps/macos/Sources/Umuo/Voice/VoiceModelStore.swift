import CryptoKit
import Foundation
import Observation
import UmuoCore

/// 一次取模型文件的回应：服务器是否按续传（206）回应，以及按顺序到达的数据块。
struct ModelFetchResponse: Sendable {
    let resumed: Bool
    let chunks: AsyncThrowingStream<Data, Error>
}

/// 取模型文件的网络层（正式实现 `URLSessionModelFetcher`；测试换成本地桩，不访问网络）。
protocol ModelFetching: Sendable {
    /// 从 `offset` 起取（`offset > 0` 时带 `Range`）。服务器不支持续传时 `resumed` 为假，数据从头开始。
    func fetch(_ url: URL, from offset: Int64) async throws -> ModelFetchResponse
}

/// 语音模型的下载、校验与就位（PRD §7.4：首次使用语音才下载，显示进度、取消、错误和重试）。
///
/// - 只在用户点「下载」时开始，不进启动路径；清单（地址、大小、SHA-256、路径）来自 Rust 的 `voiceModelInfo`。
/// - 下载写进同目录的 `.partial`：失败或取消都留着，重试从已下载处续传（`Range`）；服务器不认续传就从头来。
/// - 超出期望大小立即失败并删掉 `.partial`；下完先核对大小再算 SHA-256，不一致删掉重来。
/// - 只有校验通过才原子改名到最终路径：**最终文件存在 ⇔ 已校验**，所以启动时只看文件在不在、大小对不对，不再算 562 MB 的哈希。
@MainActor @Observable
final class VoiceModelStore {
    enum Failure: Error, Equatable, Sendable {
        /// 网络或服务器错误（细节给排查用）。
        case network(String)
        /// 下完了但比期望的短（连接中途断开）。`.partial` 留着续传。
        case incomplete
        /// 比期望的大或 SHA-256 不一致：文件不可信，已删除。
        case checksum
        /// 写盘失败（磁盘满、无权限）。
        case disk(String)
    }

    enum State: Equatable, Sendable {
        case missing
        case downloading(received: Int64, total: Int64)
        case verifying
        case ready
        case failed(Failure)
    }

    struct Spec: Equatable, Sendable {
        let url: URL
        let sizeBytes: Int64
        let sha256: String
        let path: URL
        let partialPath: URL

        init(url: URL, sizeBytes: Int64, sha256: String, path: URL, partialPath: URL) {
            self.url = url
            self.sizeBytes = sizeBytes
            self.sha256 = sha256
            self.path = path
            self.partialPath = partialPath
        }

        init?(_ info: VoiceModelInfo) {
            guard let url = URL(string: info.url) else { return nil }
            self.init(url: url, sizeBytes: Int64(info.sizeBytes), sha256: info.sha256,
                      path: URL(fileURLWithPath: info.path), partialPath: URL(fileURLWithPath: info.partialPath))
        }
    }

    /// 进度最多每这么多字节刷新一次界面（562 MB 按块刷会有上万次）。
    nonisolated static let progressStep: Int64 = 1 << 20

    let spec: Spec
    private(set) var state: State
    private let fetcher: ModelFetching
    @ObservationIgnored private var task: Task<Void, Never>?
    /// 哈希在后台分块读取；测试可暂停在校验阶段，不需要真实模型或大文件。
    private let checksum: @Sendable (URL) async throws -> String
    /// 校验通过、模型就位之后调用（预热转写引擎）。
    @ObservationIgnored var onReady: (() -> Void)?

    init(spec: Spec, fetcher: ModelFetching,
         checksum: @escaping @Sendable (URL) async throws -> String = { url in
             let work = Task.detached(priority: .utility) { try VoiceModelStore.sha256(of: url) }
             return try await withTaskCancellationHandler {
                 try await work.value
             } onCancel: { work.cancel() }
         }) {
        self.spec = spec
        self.fetcher = fetcher
        self.checksum = checksum
        state = Self.installed(spec) ? .ready : .missing
    }

    var isReady: Bool {
        // 用户可能在外面删了模型：每次按下都现查一次（一次 stat）
        if state == .ready, !Self.installed(spec) { state = .missing }
        return state == .ready
    }

    var isDownloading: Bool { task != nil }

    /// 已下载、可续传的字节数。
    nonisolated static func partialBytes(_ spec: Spec) -> Int64 {
        let size = (try? FileManager.default.attributesOfItem(atPath: spec.partialPath.path)[.size]) as? NSNumber
        return size?.int64Value ?? 0
    }

    nonisolated static func installed(_ spec: Spec) -> Bool {
        let size = (try? FileManager.default.attributesOfItem(atPath: spec.path.path)[.size]) as? NSNumber
        return size?.int64Value == spec.sizeBytes
    }

    /// 开始（或续传、重试）下载。已就位或正在下载时什么都不做。
    func download() {
        guard task == nil, !isReady else { return }
        task = Task { [weak self] in
            await self?.run()
            self?.task = nil
        }
    }

    /// 取消下载：`.partial` 留着，下次从断点继续。
    func cancel() { task?.cancel() }

    /// 等当前下载结束（测试用）。
    func wait() async { await task?.value }

    private func run() async {
        do {
            try Task.checkCancellation()
            try await fetchToPartial()
            try Task.checkCancellation()
            state = .verifying
            let spec = spec
            let digest = try await checksum(spec.partialPath)
            // detached 哈希不会继承外层取消；检查必须先于删除、改名与预热。
            try Task.checkCancellation()
            guard digest == spec.sha256 else {
                try? FileManager.default.removeItem(at: spec.partialPath)
                throw Failure.checksum
            }
            try? FileManager.default.removeItem(at: spec.path)
            do {
                try FileManager.default.moveItem(at: spec.partialPath, to: spec.path)
            } catch {
                throw Failure.disk("\(error)")
            }
            state = .ready
            onReady?()
        } catch is CancellationError {
            state = .missing
        } catch let error as URLError where error.code == .cancelled {
            state = .missing
        } catch let failure as Failure {
            state = .failed(failure)
        } catch {
            state = .failed(.network("\(error)"))
        }
    }

    /// 把 `.partial` 补到期望大小。
    private func fetchToPartial() async throws {
        let spec = spec
        let manager = FileManager.default
        do {
            try manager.createDirectory(at: spec.partialPath.deletingLastPathComponent(), withIntermediateDirectories: true)
        } catch {
            throw Failure.disk("\(error)")
        }
        var received = Self.partialBytes(spec)
        if received > spec.sizeBytes {
            try? manager.removeItem(at: spec.partialPath)
            received = 0
        }
        state = .downloading(received: received, total: spec.sizeBytes)
        guard received < spec.sizeBytes else { return }

        let response = try await fetcher.fetch(spec.url, from: received)
        if !manager.fileExists(atPath: spec.partialPath.path) {
            manager.createFile(atPath: spec.partialPath.path, contents: nil)
        }
        let handle: FileHandle
        do {
            handle = try FileHandle(forWritingTo: spec.partialPath)
        } catch {
            throw Failure.disk("\(error)")
        }
        defer { try? handle.close() }
        if !response.resumed {
            // 服务器不认 Range、从头发：已有的部分作废
            try handle.truncate(atOffset: 0)
            received = 0
        }
        try handle.seekToEnd()
        var reported = received
        for try await chunk in response.chunks {
            try Task.checkCancellation()
            do {
                try handle.write(contentsOf: chunk)
            } catch {
                throw Failure.disk("\(error)")
            }
            received += Int64(chunk.count)
            if received > spec.sizeBytes {
                try? handle.close()
                try? manager.removeItem(at: spec.partialPath)
                throw Failure.checksum
            }
            if received - reported >= Self.progressStep || received == spec.sizeBytes {
                reported = received
                state = .downloading(received: received, total: spec.sizeBytes)
            }
        }
        try Task.checkCancellation()
        guard received == spec.sizeBytes else { throw Failure.incomplete }
    }

    /// 分块算 SHA-256（小写十六进制），不把 562 MB 读进内存。
    nonisolated static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 4 << 20), !chunk.isEmpty {
            try Task.checkCancellation()
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

/// 正式的取文件实现：URLSession（沿用系统代理设置），数据块经代理回调送进 `AsyncThrowingStream`。
/// 不用 `URLSession.bytes`：那是逐字节的异步序列，562 MB 要迭代五亿多次。
final class URLSessionModelFetcher: ModelFetching {
    func fetch(_ url: URL, from offset: Int64) async throws -> ModelFetchResponse {
        var request = URLRequest(url: url)
        if offset > 0 { request.setValue("bytes=\(offset)-", forHTTPHeaderField: "Range") }
        let delegate = Delegate()
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        let task = session.dataTask(with: request)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                delegate.begin(continuation: continuation) {
                    task.cancel()
                    session.invalidateAndCancel()
                }
                task.resume()
            }
        } onCancel: {
            task.cancel()
            session.invalidateAndCancel()
        }
    }

    /// 一次请求的代理。URLSession 在自己的串行队列上回调；状态加锁只为满足并发检查。
    private final class Delegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private var response: CheckedContinuation<ModelFetchResponse, Error>?
        private var stream: AsyncThrowingStream<Data, Error>.Continuation?
        private var stop: (@Sendable () -> Void)?

        func begin(continuation: CheckedContinuation<ModelFetchResponse, Error>, stop: @escaping @Sendable () -> Void) {
            lock.withLock {
                response = continuation
                self.stop = stop
            }
        }

        func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive response: URLResponse,
                        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void)
        {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 || status == 206 else {
                fail(URLError(.badServerResponse, userInfo: [NSLocalizedDescriptionKey: "HTTP \(status)"]))
                return completionHandler(.cancel)
            }
            let (chunks, continuation) = AsyncThrowingStream<Data, Error>.makeStream()
            let stop = lock.withLock { self.stop }
            continuation.onTermination = { termination in
                if case .cancelled = termination { stop?() }
            }
            let pending = lock.withLock { () -> CheckedContinuation<ModelFetchResponse, Error>? in
                stream = continuation
                defer { self.response = nil }
                return self.response
            }
            pending?.resume(returning: ModelFetchResponse(resumed: status == 206, chunks: chunks))
            completionHandler(.allow)
        }

        func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive data: Data) {
            _ = lock.withLock { stream }?.yield(data)
        }

        func urlSession(_ session: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
            if let error { fail(error) } else { lock.withLock { stream }?.finish() }
            session.finishTasksAndInvalidate()
        }

        private func fail(_ error: Error) {
            let (pending, stream) = lock.withLock { () -> (CheckedContinuation<ModelFetchResponse, Error>?, AsyncThrowingStream<Data, Error>.Continuation?) in
                defer { self.response = nil }
                return (self.response, self.stream)
            }
            pending?.resume(throwing: error)
            stream?.finish(throwing: error)
        }
    }
}
