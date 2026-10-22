/// 带卡片下标的东西（对比窗的卡片）。
protocol Indexed {
    var index: UInt32 { get }
}

/// 卡片拖动排序的纯逻辑（PRD §7.1：对比窗「多卡片横排，可拖拽排序」），`reorder.ts` 的移植。
///
/// 排序的边界条件比看上去多：往前拖与往后拖的下标语义不同、越界的拖动、新一次对比带来的新卡片、
/// 以及上一次顺序里已经不存在的卡片。这些在拖动事件里很难复现，在数组上是几行断言。
enum Reorder {
    /// 把 `from` 位置的元素移动到 `to` 位置（「放到那个位置」，不是「跨过几个」）。越界或原地不动时原样返回。
    ///
    /// 先摘出来再插入：摘出后后续下标整体前移，插入位置正好就是 `to`。
    static func move<T>(_ items: [T], from: Int, to: Int) -> [T] {
        guard from != to, items.indices.contains(from), items.indices.contains(to) else { return items }
        var next = items
        let moved = next.remove(at: from)
        next.insert(moved, at: to)
        return next
    }

    /// 按用户拖出来的顺序排列卡片。`order` 里只保留**还存在的**卡片；不在 `order` 里的
    /// （新一次对比带来的新模型）按原始顺序**追加在后面**。重复的下标只算第一次。
    static func apply<T: Indexed>(_ cards: [T], order: [UInt32]) -> [T] {
        guard !order.isEmpty else { return cards }
        var remaining = Dictionary(cards.map { ($0.index, $0) }, uniquingKeysWith: { first, _ in first })
        var ordered: [T] = []
        for index in order {
            if let card = remaining.removeValue(forKey: index) { ordered.append(card) }
        }
        // 剩下的（新的、或上次顺序里没有的）保持原顺序接在后面。
        for card in cards where remaining.removeValue(forKey: card.index) != nil {
            ordered.append(card)
        }
        return ordered
    }
}
