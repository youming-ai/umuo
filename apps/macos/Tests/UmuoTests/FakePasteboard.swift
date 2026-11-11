import AppKit
@testable import Umuo

/// 内存里的假剪贴板（`PasteboardAccess`）：单元测试不创建任何真的 `NSPasteboard`。
///
/// 真剪贴板每次创建都要 XPC 同步等 pboard 回复；测试并行时十几个线程同时创建，曾让整个 `swift test`
/// 挂死（全部 started、没有一个 passed）。真剪贴板上的快照与恢复由 `--selftest` 在私有命名剪贴板上单线程验证。
final class FakePasteboard: PasteboardAccess, @unchecked Sendable {
    typealias Entry = Umuo.Pasteboard.Snapshot.Entry

    private let lock = NSLock()
    private var items: [[Entry]] = []
    private var count = 0

    init(_ text: String? = nil) {
        if let text { _ = setString(text, forType: .string) }
    }

    var changeCount: Int { lock.withLock { count } }

    @discardableResult func clearContents() -> Int {
        lock.withLock {
            items = []
            count += 1
            return count
        }
    }

    @discardableResult func setString(_ string: String, forType dataType: NSPasteboard.PasteboardType) -> Bool {
        lock.withLock {
            items = [[.init(type: dataType.rawValue, data: Data(string.utf8))]]
            count += 1
            return true
        }
    }

    func string(forType dataType: NSPasteboard.PasteboardType) -> String? {
        lock.withLock {
            items.first?.first { $0.type == dataType.rawValue }.flatMap { String(data: $0.data, encoding: .utf8) }
        }
    }

    /// 每取一种类型的数据前调一次（模拟源应用当场生成延迟提供的格式）。
    var onData: (@Sendable () -> Void)?
    /// 取过多少次数据。
    private(set) var dataReads = 0

    func itemTypes() -> [[String]] { lock.withLock { items.map { $0.map(\.type) } } }

    func data(item: Int, type: String) -> Data? {
        onData?()
        return lock.withLock {
            dataReads += 1
            guard items.indices.contains(item) else { return nil }
            return items[item].first { $0.type == type }?.data
        }
    }

    func writeItems(_ new: [[Entry]]) {
        lock.withLock {
            items = new
            count += 1
        }
    }

    var isEmpty: Bool { lock.withLock { items.isEmpty } }
}
