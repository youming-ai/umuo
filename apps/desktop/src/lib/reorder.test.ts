import { describe, expect, it } from 'vitest'

import { applyOrder, moveItem } from './reorder'

const card = (index: number) => ({ index, label: `卡片${index}` })

describe('移动一项', () => {
  it('往前拖：目标下标就是它该在的位置', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('往后拖也是"放到那个位置"，不是"跨过几个"', () => {
    // 这里最容易写错：先摘出来会让后续下标整体前移。
    // 把 a 拖到下标 2，结果应当是 b c a d —— 而不是 b a c d。
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('拖到原位等于没动', () => {
    const items = ['a', 'b', 'c']
    expect(moveItem(items, 1, 1)).toBe(items)
  })

  it('越界的下标不改动任何东西——而不是抛错或产生空洞', () => {
    const items = ['a', 'b', 'c']
    expect(moveItem(items, -1, 1)).toEqual(items)
    expect(moveItem(items, 3, 1)).toEqual(items)
    expect(moveItem(items, 0, 3)).toEqual(items)
  })

  it('移动不会丢项也不会重复', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    for (let from = 0; from < items.length; from += 1) {
      for (let to = 0; to < items.length; to += 1) {
        const moved = moveItem(items, from, to)
        expect([...moved].sort()).toEqual([...items].sort())
      }
    }
  })
})

describe('按用户顺序排列卡片', () => {
  it('没有顺序偏好时保持原样', () => {
    const cards = [card(0), card(1), card(2)]
    expect(applyOrder(cards, [])).toEqual(cards)
  })

  it('按给定的下标重排', () => {
    const cards = [card(0), card(1), card(2)]
    expect(applyOrder(cards, [2, 0, 1]).map((c) => c.index)).toEqual([2, 0, 1])
  })

  it('顺序里已经不存在的卡片被忽略', () => {
    // 上一次对比有 3 张卡，这一次只有 2 张。
    const cards = [card(0), card(1)]
    expect(applyOrder(cards, [2, 0, 1]).map((c) => c.index)).toEqual([0, 1])
  })

  it('新出现的卡片追加在后面，而不是消失', () => {
    // 新一次对比带了新模型：它在用户的顺序里当然没有位置。
    const cards = [card(0), card(1), card(2)]
    expect(applyOrder(cards, [1, 0]).map((c) => c.index)).toEqual([1, 0, 2])
  })

  it('顺序可以只覆盖一部分，其余按原顺序补齐', () => {
    const cards = [card(0), card(1), card(2), card(3)]
    expect(applyOrder(cards, [3, 1]).map((c) => c.index)).toEqual([3, 1, 0, 2])
  })

  it('不会丢卡也不会重复', () => {
    const cards = [card(0), card(1), card(2), card(3)]
    const ordered = applyOrder(cards, [9, 3, 3, 1])
    expect(ordered.map((c) => c.index)).toEqual([3, 1, 0, 2])
  })
})
