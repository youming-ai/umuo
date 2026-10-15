import { describe, expect, it } from 'vitest'

import { createSettingsQueue } from './settings-queue'

interface S {
  theme: string
  proxy: string
  scale: number
  remembered: string
}

const base: S = { theme: 'system', proxy: '', scale: 1, remembered: '' }

/** 一个假的后端：保存时把改动叠在「此刻的值」上，模拟 save_settings 的现读现写。 */
function backend(initial: S, validate: (s: S) => void = () => {}) {
  let stored = initial
  return {
    write: (patch: Partial<S>) => {
      stored = { ...stored, ...patch }
    },
    save: async (patch: Partial<S>) => {
      const next = { ...stored, ...patch }
      validate(next)
      stored = next
      return stored
    },
    stored: () => stored,
  }
}

describe('设置的改了就存队列', () => {
  it('逐个保存，后一次叠在前一次之上', async () => {
    const server = backend(base)
    const queue = createSettingsQueue(base, server.save, () => {})
    await Promise.all([queue.commit({ theme: 'dark' }), queue.commit({ scale: 1.25 })])
    expect(server.stored()).toEqual({ ...base, theme: 'dark', scale: 1.25 })
  })

  it('一个字段存失败只退回它自己，不拖累后面的改动', async () => {
    const server = backend(base, (s) => {
      if (s.proxy === 'bad') throw new Error('代理地址不合法')
    })
    const shown: S[] = []
    const queue = createSettingsQueue(base, server.save, (s) => shown.push(s))
    const failed = queue.commit({ proxy: 'bad' })
    const ok = queue.commit({ theme: 'dark' })
    await expect(failed).rejects.toThrow('代理地址不合法')
    await ok
    expect(queue.current()).toEqual({ ...base, theme: 'dark' })
    expect(server.stored().proxy).toBe('')
    // 界面确实被通知过回滚（而不只是内部状态对了）
    expect(shown.some((s) => s.proxy === 'bad')).toBe(true)
    expect(shown.at(-1)?.proxy).toBe('')
  })

  it('失败的旧提交不会冲掉同一字段后来的新值', async () => {
    const server = backend(base, (s) => {
      if (s.proxy === 'bad') throw new Error('代理地址不合法')
    })
    const shown: S[] = []
    const queue = createSettingsQueue(base, server.save, (s) => shown.push(s))
    const failed = queue.commit({ proxy: 'bad' })
    const newer = queue.commit({ proxy: 'socks5://ok' })
    await expect(failed).rejects.toThrow()
    // 失败那一刻界面上应仍是新值，不能闪回旧值
    expect(shown.every((s, i) => i < 2 || s.proxy === 'socks5://ok')).toBe(true)
    await newer
    expect(queue.current().proxy).toBe('socks5://ok')
  })

  it('不会用窗口里的旧快照抹掉别处刚写进来的值', async () => {
    // 设置窗开着时，浮窗记住了 Slack 的目标语言；随后在设置窗里拨一个开关。
    const server = backend(base)
    const queue = createSettingsQueue(base, server.save, () => {})
    server.write({ remembered: 'Slack→en' })
    await queue.commit({ theme: 'dark' })
    expect(server.stored().remembered).toBe('Slack→en')
    expect(queue.current().remembered).toBe('Slack→en')
  })

  it('空闲时刷新跟上后端；有保存在路上时不刷新', async () => {
    const server = backend(base)
    const queue = createSettingsQueue(base, server.save, () => {})
    queue.refresh({ ...base, remembered: 'Slack→en' })
    expect(queue.current().remembered).toBe('Slack→en')

    const inFlight = queue.commit({ theme: 'dark' })
    queue.refresh(base)
    expect(queue.current().theme).toBe('dark')
    await inFlight
  })

  it('落定后以后端规范化过的值为准', async () => {
    const queue = createSettingsQueue(
      base,
      async (patch) => ({ ...base, ...patch, scale: Math.round(patch.scale ?? 1) }),
      () => {},
    )
    await queue.commit({ scale: 2.4 })
    expect(queue.current().scale).toBe(2)
  })
})
