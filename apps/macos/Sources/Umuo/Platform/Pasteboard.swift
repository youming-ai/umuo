import AppKit

/// ⌘C 取词降级要的剪贴板操作。
///
/// 都接一个 `NSPasteboard` 参数（正式路径是 `.general`）：selftest 换成私有命名剪贴板，
/// 整个降级事务都能在不碰用户剪贴板的前提下跑一遍。
enum Pasteboard {
    /// 动剪贴板的操作互斥：⌘C 取词降级（快照 → 清空 → ⌘C → 轮询 → 恢复 → 观察迟到的复制）是一整个事务，
    /// 期间别的线程写剪贴板，要么被它的恢复盖掉，要么被它当成原内容存下来。
    /// 连按两次快捷键时，第二次的快照拿到的会是第一次清空后的空剪贴板，最后用空串盖掉用户的内容。
    /// 进程级的一把锁，与剪贴板是哪一块无关。用 NSLock 而不是 unfair lock：事务里要睡眠，最长约 1 秒。
    static let exclusive = NSLock()

    /// 剪贴板上的纯文本。
    static func string(_ pasteboard: NSPasteboard) -> String? { pasteboard.string(forType: .string) }

    /// 剪贴板上全部内容的快照：每个 item 的每种类型（UTI）与原始字节。
    ///
    /// 只存文本的话，用户刚复制的截图、文件、带格式的文字都会在一次取词之后丢掉。
    struct Snapshot: Equatable {
        struct Entry: Equatable {
            let type: String
            let data: Data
        }

        var items: [[Entry]] = []

        static func take(_ pasteboard: NSPasteboard) -> Snapshot {
            let items = (pasteboard.pasteboardItems ?? []).map { item in
                // 取不到数据的类型（延迟提供、已失效的承诺）跳过，其余照存。
                item.types.compactMap { type in item.data(forType: type).map { Entry(type: type.rawValue, data: $0) } }
            }
            return Snapshot(items: items)
        }

        /// 原样写回。原来是空的就清空——否则这次复制到的选中文本会留在剪贴板上。
        func restore(_ pasteboard: NSPasteboard) {
            pasteboard.clearContents()
            if items.isEmpty { return }
            let objects = items.map { entries in
                let item = NSPasteboardItem()
                for entry in entries { item.setData(entry.data, forType: .init(entry.type)) }
                return item
            }
            pasteboard.writeObjects(objects)
        }
    }
}
