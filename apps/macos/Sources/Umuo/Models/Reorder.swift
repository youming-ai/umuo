/// 列表元素移动的纯规则，由模型备用顺序等共用。
enum Reorder {
    /// 把 from 位置移到 to；越界或原地移动时保持原数组。
    static func move<T>(_ items: [T], from: Int, to: Int) -> [T] {
        guard from != to, items.indices.contains(from), items.indices.contains(to) else { return items }
        var next = items
        let moved = next.remove(at: from)
        next.insert(moved, at: to)
        return next
    }
}
