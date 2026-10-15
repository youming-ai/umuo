/**
 * 卡片拖动排序的纯逻辑（PRD §7.1：对比窗「多卡片横排，可拖拽排序」）。
 *
 * 抽成纯函数是因为排序的边界条件比看上去多：往前拖与往后拖的下标语义不同、
 * 越界的拖动、新一次对比带来的新卡片、以及上一次顺序里已经不存在的卡片。
 * 这些在 DOM 事件里很难复现，在数组上是几行断言。
 */

/**
 * 把 `from` 位置的元素移动到 `to` 位置。
 *
 * **往后拖时要特别注意**：先把元素摘出来会让后续下标整体前移，
 * 所以目标下标要先减一。写错的表现是"往后拖总是差一格"，
 * 而人在界面上很难判断是差了一格还是拖歪了。
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items
  if (from < 0 || from >= items.length) return items
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * 按用户拖出来的顺序排列卡片。
 *
 * `order` 里只保留**还存在的**卡片下标；不在 `order` 里的卡片（比如新一次对比
 * 带来的新模型）按它们的原始顺序**追加在后面**。
 *
 * 这样就不用在「数据变了」时同步一份状态——那是最容易出闪烁与错位的地方。
 */
export function applyOrder<T extends { index: number }>(cards: T[], order: number[]): T[] {
  if (order.length === 0) return cards

  const byIndex = new Map(cards.map((card) => [card.index, card]))
  const ordered: T[] = []
  for (const index of order) {
    const card = byIndex.get(index)
    if (card) {
      ordered.push(card)
      byIndex.delete(index)
    }
  }
  // 剩下的（新的、或上次顺序里没有的）保持原顺序接在后面。
  for (const card of cards) {
    if (byIndex.has(card.index)) ordered.push(card)
  }
  return ordered
}
