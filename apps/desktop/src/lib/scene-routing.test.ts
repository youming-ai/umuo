import { describe, expect, it } from 'vitest'

import { tFor } from './i18n'
import type { ModelRef, SceneModels } from './ipc'
import {
  addFallback,
  isComplete,
  modelLabel,
  moveFallback,
  removeFallback,
  SCENE_ROWS,
  setSceneModel,
} from './scene-routing'

/** 断言的是简体中文文案，与源语言一致。 */
const t = tFor('zh-CN')

const ref = (providerId: string, model: string): ModelRef => ({ providerId, model })

const empty: SceneModels = {
  selection: null,
  compose: null,
  silentReplace: null,
  ocr: null,
  compare: [],
  wordCard: null,
}

describe('场景清单', () => {
  it('覆盖 PRD §6.3 点名的场景，且不含对比', () => {
    // 对比要的是「一组」模型，在对比那一段单独配。
    const keys = SCENE_ROWS.map((r) => r.key)
    expect(keys).toEqual(['selection', 'compose', 'silentReplace', 'ocr', 'wordCard'])
    expect(keys).not.toContain('compare')
  })
})

describe('完整性与标签', () => {
  it('供应商与模型都填了才算配好', () => {
    expect(isComplete(ref('openai', 'gpt-4o'))).toBe(true)
    expect(isComplete(ref('openai', ''))).toBe(false)
    expect(isComplete(ref('', 'gpt-4o'))).toBe(false)
    expect(isComplete(ref('openai', '   '))).toBe(false)
    expect(isComplete(null)).toBe(false)
  })

  it('没配时显示「用默认模型」而不是空白', () => {
    expect(modelLabel(null, t)).toBe('用默认模型')
    expect(modelLabel(ref('', ''), t)).toBe('用默认模型')
    expect(modelLabel(ref('openai', 'gpt-4o'), t)).toBe('openai · gpt-4o')
    // 文案随界面语言走（审查 L24）
    expect(modelLabel(null, tFor('en'))).toBe('Use the default model')
  })
})

describe('设置场景模型', () => {
  it('配好的会写进去，其它场景不动', () => {
    const next = setSceneModel(empty, 'silentReplace', ref('deepseek', 'deepseek-chat'))
    expect(next.silentReplace).toEqual(ref('deepseek', 'deepseek-chat'))
    expect(next.selection).toBeNull()
  })

  it('只填供应商不算配好，会退回默认', () => {
    // 配置里出现一个没有模型的供应商只能被忽略，用户却以为配上了。
    const next = setSceneModel(empty, 'ocr', ref('openai', ''))
    expect(next.ocr).toBeNull()
  })

  it('清空即恢复默认', () => {
    const configured = setSceneModel(empty, 'compose', ref('anthropic', 'claude-sonnet-4-5'))
    expect(setSceneModel(configured, 'compose', null).compose).toBeNull()
  })

  it('不修改原对象', () => {
    setSceneModel(empty, 'selection', ref('openai', 'gpt-4o'))
    expect(empty.selection).toBeNull()
  })
})

describe('备用顺序', () => {
  it('按加入顺序排列——那就是重试顺序', () => {
    let list: ModelRef[] = []
    list = addFallback(list, ref('deepseek', 'deepseek-chat'))
    list = addFallback(list, ref('anthropic', 'claude-sonnet-4-5'))
    expect(list.map((r) => r.providerId)).toEqual(['deepseek', 'anthropic'])
  })

  it('重复的一对不会被加两次', () => {
    // 排两次只会在失败时白等一轮。
    let list: ModelRef[] = []
    list = addFallback(list, ref('deepseek', 'deepseek-chat'))
    list = addFallback(list, ref('deepseek', 'deepseek-chat'))
    expect(list).toHaveLength(1)
  })

  it('同一个供应商的不同模型算两条', () => {
    let list: ModelRef[] = []
    list = addFallback(list, ref('openai', 'gpt-4o'))
    list = addFallback(list, ref('openai', 'gpt-4o-mini'))
    expect(list).toHaveLength(2)
  })

  it('没填完的不进列表', () => {
    expect(addFallback([], ref('openai', ''))).toEqual([])
  })

  it('删除按下标', () => {
    const list = [ref('a', '1'), ref('b', '2')]
    expect(removeFallback(list, 0).map((r) => r.providerId)).toEqual(['b'])
  })

  it('可以上下移动（顺序即重试顺序）', () => {
    const list = [ref('a', '1'), ref('b', '2'), ref('c', '3')]
    expect(moveFallback(list, 2, -1).map((r) => r.providerId)).toEqual(['a', 'c', 'b'])
    expect(moveFallback(list, 0, 1).map((r) => r.providerId)).toEqual(['b', 'a', 'c'])
  })

  it('越界的移动是无操作，不报错也不丢元素', () => {
    const list = [ref('a', '1'), ref('b', '2')]
    expect(moveFallback(list, 0, -1)).toEqual(list)
    expect(moveFallback(list, 1, 1)).toEqual(list)
    expect(moveFallback(list, 9, 1)).toEqual(list)
  })

  it('移动不修改原数组', () => {
    const list = [ref('a', '1'), ref('b', '2')]
    moveFallback(list, 0, 1)
    expect(list.map((r) => r.providerId)).toEqual(['a', 'b'])
  })
})
