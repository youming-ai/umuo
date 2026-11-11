import AppKit

/// 剪贴板操作要的那几样能力。正式实现就是 `NSPasteboard`（方法同名，直接满足）；
/// 单元测试换成内存里的假剪贴板：测试并行时多个线程同时创建真剪贴板（每次都 XPC 同步等 pboard 回复），
/// 曾让整个 `swift test` 挂死——全部用例 started、一个都没 passed。selftest 仍用私有命名的真剪贴板。
protocol PasteboardAccess: AnyObject {
    var changeCount: Int { get }
    @discardableResult func clearContents() -> Int
    @discardableResult func setString(_ string: String, forType dataType: NSPasteboard.PasteboardType) -> Bool
    func string(forType dataType: NSPasteboard.PasteboardType) -> String?
    /// 每个 item 声明的类型（UTI）。只列类型、不取数据：延迟提供的格式这时还不会被生成。
    func itemTypes() -> [[String]]
    /// 第 `item` 个 item 上 `type` 的原始字节。延迟提供的格式在这一刻才由源应用生成（可能很慢、很大）。
    func data(item: Int, type: String) -> Data?
    /// 清空后按 item 写回（`items` 为空时只清空）。
    func writeItems(_ items: [[Pasteboard.Snapshot.Entry]])
}

extension NSPasteboard: PasteboardAccess {
    func itemTypes() -> [[String]] {
        (pasteboardItems ?? []).map { $0.types.map(\.rawValue) }
    }

    func data(item: Int, type: String) -> Data? {
        guard let items = pasteboardItems, items.indices.contains(item) else { return nil }
        return items[item].data(forType: .init(type))
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

    /// 快照超出预算时给用户看的话（文案键）。
    static let tooLarge = "error.clipboardTooLarge"

    /// 借用之前剪贴板已变化：保留新内容，请用户重试。
    static let changed = "error.clipboardChanged"

    /// 复制文本（浮窗、撰写窗、历史、快捷面板与语音结果的「复制」共用）；失败返回原因（文案键）。
    /// 要拿 `exclusive`：⌘C 取词降级的事务可能正在另一个线程上跑，不互斥的话复制的内容要么被它的恢复盖掉，
    /// 要么被它当成用户原内容存下来。会等锁，不要在主线程上调。
    static func copy(_ text: String, to pasteboard: PasteboardAccess = NSPasteboard.general) -> UserText? {
        exclusive.lock()
        defer { exclusive.unlock() }
        pasteboard.clearContents()
        return pasteboard.setString(text, forType: .string) ? nil : UserText("error.copyFailed")
    }

    /// 剪贴板上的纯文本。
    static func string(_ pasteboard: PasteboardAccess) -> String? { pasteboard.string(forType: .string) }

    /// 剪贴板上全部内容的快照：每个 item 的每种类型（UTI）与原始字节。
    ///
    /// 只存文本的话，用户刚复制的截图、文件、带格式的文字都会在一次取词之后丢掉。
    /// 取不到数据的类型（已失效的承诺）跳过——它本来就还不回去；其余逐字节还原。
    ///
    /// **取快照会逼源应用当场生成每一种延迟提供的格式**（已实测：每种类型都调一次 data provider）。
    /// 在 Excel、Photoshop、Keynote 里复制了大东西，剪贴板上可能挂着几十种格式，全部生成要几秒、上百 MB，
    /// 而这一切发生在持有 `exclusive` 期间。所以有预算（`Budget`）：超了就放弃，调用方在**清空剪贴板之前**
    /// 收手，用户的剪贴板原封不动。绝不带着残缺的快照继续——那等于悄悄丢掉用户的内容。
    struct Snapshot: Equatable {
        struct Entry: Equatable {
            let type: String
            let data: Data
        }

        var items: [[Entry]] = []

        /// 快照的上限。只能在两种类型之间检查：限的是总代价，单独一种格式生成得慢仍然要等它。
        struct Budget: Sendable {
            /// 一张 5K 全屏截图带 TIFF 与 PNG 约 70 MB，留足余量。
            var maxBytes = 256 << 20
            var maxDuration: Duration = .seconds(2)

            static let standard = Budget()
        }

        /// 取快照；超出预算或期间剪贴板变化都返回 nil（这时剪贴板还没动过）。
        static func take(_ pasteboard: PasteboardAccess, budget: Budget = .standard) -> Snapshot? {
            let clock = ContinuousClock()
            let started = clock.now
            let original = pasteboard.changeCount
            // 进程内的锁拦不住其他应用复制；列类型、读取数据都必须属于同一版剪贴板。
            func valid() -> Bool {
                pasteboard.changeCount == original && clock.now - started <= budget.maxDuration
            }
            var bytes = 0
            var items: [[Entry]] = []
            for (index, types) in pasteboard.itemTypes().enumerated() {
                var entries: [Entry] = []
                for type in types {
                    guard valid() else { return nil }
                    let data = pasteboard.data(item: index, type: type)
                    // 读取失败也花了时间：不能让 nil 绕过预算和版本检查。
                    guard valid() else { return nil }
                    guard let data else { continue }
                    bytes += data.count
                    guard bytes <= budget.maxBytes else { return nil }
                    entries.append(Entry(type: type, data: data))
                }
                items.append(entries)
            }
            return valid() ? Snapshot(items: items) : nil
        }

        /// 原样写回。原来是空的就清空——否则这次复制到的选中文本会留在剪贴板上。
        func restore(_ pasteboard: PasteboardAccess) {
            pasteboard.writeItems(items)
        }
    }
}
