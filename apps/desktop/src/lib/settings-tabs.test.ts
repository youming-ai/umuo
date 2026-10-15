import { describe, expect, it } from 'vitest'

import { type AttentionInput, initialTab, TABS, tabAttention } from './settings-tabs'

const ok: AttentionInput = {
  keyConfigured: true,
  someProviderOverLimit: false,
  permissionMissing: false,
}

describe('分区', () => {
  it('六个分区，顺序固定且不重复', () => {
    expect(TABS).toEqual(['general', 'translate', 'engine', 'permissions', 'advanced', 'about'])
    expect(new Set(TABS).size).toBe(TABS.length)
  })
})

describe('提醒点', () => {
  it('没配 Key 点亮「引擎」，缺权限点亮「权限」，超限点亮「高级」', () => {
    expect(tabAttention({ ...ok, keyConfigured: false })).toEqual({ engine: true })
    expect(tabAttention({ ...ok, permissionMissing: true })).toEqual({ permissions: true })
    expect(tabAttention({ ...ok, someProviderOverLimit: true })).toEqual({ advanced: true })
  })

  it('一切都好、或状态还没读出来时不点灯', () => {
    expect(tabAttention(ok)).toEqual({})
    expect(tabAttention({ ...ok, keyConfigured: null, permissionMissing: null })).toEqual({})
  })
})

describe('初始分区', () => {
  it('没配 Key 先去「引擎」，哪怕也缺权限', () => {
    expect(initialTab({ ...ok, keyConfigured: false, permissionMissing: true })).toBe('engine')
  })

  it('缺权限去「权限」', () => {
    expect(initialTab({ ...ok, permissionMissing: true })).toBe('permissions')
  })

  it('其余从「通用」开始', () => {
    expect(initialTab(ok)).toBe('general')
    expect(initialTab({ ...ok, keyConfigured: null, permissionMissing: null })).toBe('general')
  })
})
