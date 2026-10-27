import Foundation
import UmuoCore

/// `--selftest` 的 Engine 部分：在临时配置目录里打开 Engine，验证设置往返不丢未知字段，
/// 用假宿主 + 本地 SSE 桩（Rust 端的 `selftestSseStub`）跑一次翻译（Start → Delta → Done）与一次取消。
///
/// 事件在 Rust 的工作线程上到达，这里只加锁记下，主线程轮询等待——与正式代码的线程约定一致：
/// sink 里不做 `DispatchQueue.main.sync`。
enum EngineSelfTest {
    /// 假宿主：只有 OpenAI 的 Key，不写回。
    final class FakeHost: HostBridge {
        func apiKey(providerId: String) throws -> String? { providerId == "openai" ? "sk-selftest" : nil }
        func frontmostAppName() -> String? { "SelfTest" }
        func frontmostAppToken() -> String? { "pid-selftest" }
        func writeBack(source: FocusSource, original: String, text: String) throws {
            throw HostFailure.Failed(detail: "selftest 不写回")
        }
    }

    /// 记下收到的翻译事件。回调来自 Rust 的工作线程，所以加锁。
    final class Recorder: TranslateSink, @unchecked Sendable {
        private let lock = NSLock()
        private var events: [TranslateEvent] = []
        func onEvent(route: Route, event: TranslateEvent) { lock.withLock { events.append(event) } }
        var snapshot: [TranslateEvent] { lock.withLock { events } }
        var kinds: [String] {
            snapshot.map {
                switch $0 {
                case .start: "start"
                case .delta: "delta"
                case .card: "card"
                case .done: "done"
                case .error: "error"
                }
            }
        }
    }

    /// 超过三个词：三个词以内走词卡，增量会被抑制。
    static let sentence = "This is a whole sentence here."

    static func run(_ check: (String, Bool, String) -> Void) {
        let defaultDir = defaultConfigDir() ?? ""
        check("defaultConfigDir", defaultDir.hasSuffix("/Library/Application Support/app.umuo.desktop"),
              "与 Tauri 版同一个目录：\(defaultDir)")

        // 两路桩：一路一次发完，一路段间隔远大于传输层 100 ms 的取消轮询
        guard let fast = selftestSseStub(deltas: ["你好", "世界"], delayMs: 0, gapMs: 0),
              let slow = selftestSseStub(deltas: ["一", "二", "三"], delayMs: 0, gapMs: 500)
        else {
            check("selftestSseStub", false, "本地桩起不来")
            return
        }

        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("umuo-selftest-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let engine: Engine
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            // 只有测试夹具直接写这个文件（正式代码只经 Engine 读写）。代理在打开时就定了：
            // 先写 proxyMode=none，免得系统代理接管 127.0.0.1。
            let fixture = #"{"proxyMode":"none","futureField":{"x":[1,2]}}"#
            try fixture.write(to: dir.appendingPathComponent("settings.json"), atomically: true, encoding: .utf8)
            engine = try Engine.open(configDir: dir.path, host: FakeHost())
            check("Engine.open", true, dir.lastPathComponent)
        } catch {
            check("Engine.open", false, "\(error)")
            return
        }

        // 设置往返：只交改动的键，未知字段原样保留（内存与文件）
        do {
            let patch = #"{"theme":"dark","providerId":"openai","model":"gpt-4o-mini","providerBaseUrls":{"openai":"\#(fast)"}}"#
            let update = try engine.applySettingsPatch(patchJson: patch)
            let saved = json(update.settingsJson)
            let onDisk = json((try? String(contentsOf: dir.appendingPathComponent("settings.json"), encoding: .utf8)) ?? "")
            let kept = (saved["futureField"] as? [String: Any])?["x"] as? [Int] == [1, 2]
                && (onDisk["futureField"] as? [String: Any])?["x"] as? [Int] == [1, 2]
            check("applySettingsPatch", saved["theme"] as? String == "dark" && kept
                  && json(engine.settingsJson())["theme"] as? String == "dark",
                  "theme=dark，futureField 保留：\(kept)")
        } catch {
            check("applySettingsPatch", false, "\(error)")
            return
        }

        // 一次完整的翻译
        let recorder = Recorder()
        let handle = engine.translate(request: request(sentence), guardToken: nil, sink: recorder)
        wait { ["done", "error"].contains(recorder.kinds.last ?? "") }
        let text = recorder.snapshot.compactMap { if case let .delta(text) = $0 { text } else { nil } }.joined()
        check("translate", recorder.kinds == ["start", "delta", "delta", "done"] && text == "你好世界",
              "#\(handle.id()) \(recorder.kinds.joined(separator: " → ")) → \(text)")

        // 取消：第一个增量到了就取消，之后不再有增量，也没有完成
        do {
            _ = try engine.applySettingsPatch(patchJson: #"{"providerBaseUrls":{"openai":"\#(slow)"}}"#)
        } catch {
            check("RequestHandle.cancel", false, "换到慢桩失败：\(error)")
            return
        }
        let cancelled = Recorder()
        let running = engine.translate(request: request(sentence), guardToken: nil, sink: cancelled)
        wait { cancelled.kinds.contains("delta") || cancelled.kinds.contains("error") }
        running.cancel()
        let deltasAtCancel = cancelled.kinds.filter { $0 == "delta" }.count
        Thread.sleep(forTimeInterval: 1.5)
        let after = cancelled.kinds
        check("RequestHandle.cancel",
              running.isCancelled() && deltasAtCancel == 1
                  && after.filter { $0 == "delta" }.count == 1 && !after.contains("done"),
              after.joined(separator: " → "))

        opsChecks(engine, check)
        DataSelfTest.run(engine, check)
        SettingsSelfTest.run(engine, check)
    }

    /// 阶段 3 的窗口要的 ops 导出：历史（上面那次翻译记了一条）、
    /// 宿主自己发提示时登记的请求 id。都在临时配置目录里，不碰用户的历史库。
    static func opsChecks(_ engine: Engine, _ check: (String, Bool, String) -> Void) {
        var records: [HistoryRecord] = []
        wait { records = (try? engine.historyQuery(filter: nil, limit: 10, offset: 0)) ?? []; return !records.isEmpty }
        check("historyQuery", records.first?.translatedText == "你好世界" && records.first?.model == "gpt-4o-mini",
              "\(records.count) 条")

        let first = engine.beginRequest(surface: "panel")
        let second = engine.beginRequest(surface: "panel")
        check("beginRequest", second > first, "#\(first) → #\(second)")

        // 取词黑名单（默认名单里有 1Password）：读取之前拦下，文案点名应用
        let blocked = engine.selectionBlockNotice(appName: "1Password")
        check("selectionBlockNotice",
              blocked == "「1Password」在取词黑名单里，没有读取选中的内容。可在设置里调整。"
                  && engine.selectionBlockNotice(appName: "Safari") == nil,
              blocked ?? "nil")
    }

    static func request(_ text: String) -> TranslateRequest {
        TranslateRequest(text: text, mode: .selection, targetOverride: nil, sourceOverride: nil, focusSource: nil)
    }

    static func json(_ raw: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] ?? [:]
    }

    /// 轮询等待，最多 10 秒。
    static func wait(until condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(10)
        while !condition(), Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
    }
}
