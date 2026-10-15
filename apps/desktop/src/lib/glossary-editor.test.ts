import { describe, expect, it } from 'vitest'

import { glossarySummary, hasLanguageConstraint, newGlossary } from './glossary-editor'
import { translate } from './i18n'
import type { Glossary } from './ipc'

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
  translate('zh-CN', key, params)

const list = (over: Partial<Glossary> = {}): Glossary => ({
  id: 'a',
  name: '术语',
  sourceLang: 'en',
  targetLang: 'zh-CN',
  entries: [],
  ...over,
})

describe('新建术语表', () => {
  it('id 带 glossary- 前缀', () => {
    expect(newGlossary(1).id).toMatch(/^glossary-/)
  })

  it('同一时间戳生成同一个 id，不同时间戳不同', () => {
    expect(newGlossary(1).id).toBe(newGlossary(1).id)
    expect(newGlossary(1).id).not.toBe(newGlossary(2).id)
  })

  it('默认不限语言对——对刚建好的空表来说这是最不容易出错的选择', () => {
    const fresh = newGlossary(1)
    expect(fresh.sourceLang).toBe('')
    expect(fresh.targetLang).toBe('')
    expect(hasLanguageConstraint(fresh)).toBe(false)
  })
})

describe('摘要', () => {
  it('显示语言对与条数', () => {
    const summary = glossarySummary(
      list({
        entries: [
          { source: 'a', target: 'b' },
          { source: 'c', target: 'd' },
        ],
      }),
      t,
    )
    expect(summary).toBe('en → zh-CN · 2 条')
  })

  it('留空的语言写成「不限」而不是显示成空', () => {
    // 显示 " → zh-CN" 会让人以为配置坏了。
    expect(glossarySummary(list({ sourceLang: '' }), t)).toContain('不限 → zh-CN')
    expect(glossarySummary(list({ targetLang: '   ' }), t)).toContain('en → 不限')
  })

  it('空表显示 0 条', () => {
    expect(glossarySummary(list(), t)).toContain('0 条')
  })
})

describe('语言对约束', () => {
  it('任一语言填了就认为有约束', () => {
    expect(hasLanguageConstraint(list({ sourceLang: 'en', targetLang: '' }))).toBe(true)
    expect(hasLanguageConstraint(list({ sourceLang: '', targetLang: 'zh-CN' }))).toBe(true)
    expect(hasLanguageConstraint(list({ sourceLang: '', targetLang: '' }))).toBe(false)
  })

  it('只有空白也算没有约束', () => {
    expect(hasLanguageConstraint(list({ sourceLang: '  ', targetLang: '  ' }))).toBe(false)
  })
})
