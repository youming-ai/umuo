import AppKit

/// 剪贴板操作要的那几样能力。正式实现就是 `NSPasteboard`（方法同名，直接满足）；
/// 单元测试换成内存里的假剪贴板：测试并行时多个线程同时创建真剪贴板（每次都 XPC 同步等 pboard 回复），
/// 曾让整个 `swift test` 挂死——全部用例 started、一个都没 passed。selftest 仍用私有命名的真剪贴板。
protocol PasteboardAccess: AnyObject {
    var changeCount: Int { get }
    @discardableResult func clearContents() -> Int
    func setString(_ string: String, forType dataType: NSPasteboard.PasteboardType) -> Bool
    func string(forType dataType: NSPasteboard.PasteboardType) -> String?
    /// 每个 item 的每种类型（UTI）与原始字节。
    func snapshotItems() -> [[Pasteboard.Snapshot.Entry]]
    /// 清空后按 item 写回（`items` 为空时只清空）。
    func writeItems(_ items: [[Pasteboard.Snapshot.Entry]])
}

extension NSPasteboard: PasteboardAccess {
    func snapshotItems() -> [[Pasteboard.Snapshot.Entry]] {
        (pasteboardItems ?? []).map { item in
            // 取不到数据的类型（延迟提供、已失效的承诺）跳过，其余照存。
            item.types.compactMap { type in item.data(forType: type).map { .init(type: type.rawValue, data: $0) } }
        }
    }

    func writeItems(_ items: [[Pasteboard.Snapshot.Entry]]) {
        clearContents()
        if items.isEmpty { return }
        writeObjects(items.map { entries in
            let item = NSPasteboardItem()
            for entry in entries { item.setData(entry.data, forType: .init(entry.type)) }
            return item
        })
    }
}

/// ⌘C 取词降级、受控粘贴与复制要的剪贴板操作。
///
/// 都接一个剪贴板参数（正式路径是 `NSPasteboard.general`）：selftest 换成私有命名剪贴板、单元测试换成假剪贴板，
/// 整个事务都能在不碰用户剪贴板的前提下跑一遍。
enum Pasteboard {
    /// 动剪贴板的操作互斥：⌘C 取词降级（快照 → 清空 → ⌘C → 轮询 → 恢复 → 观察迟到的复制）是一整个事务，
    /// 期间别的线程写剪贴板，要么被它的恢复盖掉，要么被它当成原内容存下来。
    /// 连按两次快捷键时，第二次的快照拿到的会是第一次清空后的空剪贴板，最后用空串盖掉用户的内容。
    /// 进程级的一把锁，与剪贴板是哪一块无关。用 NSLock 而不是 unfair lock：事务里要睡眠，最长约 1 秒。
    static let exclusive = NSLock()

    /// 复制文本（浮窗、撰写窗、历史、快捷面板与语音结果的「复制」共用）；失败返回原因。
    /// 要拿 `exclusive`：⌘C 取词降级的事务可能正在另一个线程上跑，不互斥的话复制的内容要么被它的恢复盖掉，
    /// 要么被它当成用户原内容存下来。会等锁，不要在主线程上调。
    static func copy(_ text: String, to pasteboard: PasteboardAccess = NSPasteboard.general) -> String? {
        exclusive.lock()
        defer { exclusive.unlock() }
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string) ? nil : "复制失败：剪贴板不可用：写入失败"
    }

    /// 剪贴板上的纯文本。
    static func string(_ pasteboard: PasteboardAccess) -> String? { pasteboard.string(forType: .string) }

    /// 剪贴板上全部内容的快照：每个 item 的每种类型（UTI）与原始字节。
    ///
    /// 只存文本的话，用户刚复制的截图、文件、带格式的文字都会在一次取词之后丢掉。
    struct Snapshot: Equatable {
        struct Entry: Equatable {
            let type: String
            let data: Data
        }

        var items: [[Entry]] = []

        static func take(_ pasteboard: PasteboardAccess) -> Snapshot {
            Snapshot(items: pasteboard.snapshotItems())
        }

        /// 原样写回。原来是空的就清空——否则这次复制到的选中文本会留在剪贴板上。
        func restore(_ pasteboard: PasteboardAccess) {
            pasteboard.writeItems(items)
        }
    }
}
