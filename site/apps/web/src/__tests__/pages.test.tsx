// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { localeFromPath } from '../lib/router'

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  window.history.replaceState(null, '', '/')
  document.documentElement.dataset.locale = 'zh-cn'
  // biome-ignore lint/suspicious/noDocumentCookie: 清掉上一个用例留下的语言 cookie
  document.cookie = 'umuo-lang=; max-age=0; path=/'
  window.localStorage.clear()
  document.documentElement.dataset.theme = 'dark'
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<App />))
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function click(selector: string) {
  const link = host.querySelector<HTMLElement>(selector)
  if (!link) throw new Error(`找不到 ${selector}`)
  act(() => link.click())
}

describe('首页一屏', () => {
  it('地址永远是 /：只从旧的语言前缀地址里认出语言', () => {
    expect(localeFromPath('/en/')).toBe('en')
    expect(localeFromPath('/zh-cn/pricing')).toBe('zh-cn')
    expect(localeFromPath('/pricing')).toBeNull()
    expect(localeFromPath('/')).toBeNull()
  })

  it('页脚只有版权行与语言切换（外加主题切换），不放条款、隐私、源码与联系邮箱', () => {
    const footer = host.querySelector('footer')
    expect(footer?.querySelector('p')?.textContent).toBe('© 2026 umuo')
    expect(footer?.querySelector('button[aria-expanded]')?.textContent).toContain('简体中文')
    // 语言菜单收起时页脚里没有任何链接
    expect(footer?.querySelectorAll('a')).toHaveLength(0)
    expect(footer?.querySelector('a[href^="mailto:"]')).toBeNull()
    for (const word of ['服务条款', '隐私政策', '源码', '联系邮箱'])
      expect(footer?.textContent).not.toContain(word)
  })

  it('页眉左边 logo、右边 GitHub，没有「免费与开源」链接与下载按钮', () => {
    const links = [...(host.querySelector('header')?.querySelectorAll('a') ?? [])]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      'https://github.com/youming-ai/umuo',
    ])
    expect(links[1]?.getAttribute('aria-label')).toBe('GitHub')
    expect(links[1]?.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(host.querySelector('header a[href*="pricing"]')).toBeNull()
    expect(host.querySelector('header')?.textContent).not.toContain('免费与开源')
    expect(host.querySelector('header button')).toBeNull()
  })

  it('演示可以点击切换，也可以直接按快捷键', () => {
    const pressed = () => host.querySelector('.demo-tabs [aria-selected="true"]')?.textContent
    // 默认停在第一项划词翻译
    expect(pressed()).toContain('划词翻译')
    // 标准选项卡：只有当前一项可以 Tab 进入，提示随模式变化
    expect(host.querySelectorAll('.demo-tabs [tabindex="0"]')).toHaveLength(1)
    expect(host.querySelector('.demo-hint')?.textContent).toContain('⌃')
    click('.demo-tabs [role="tab"]:nth-child(2)')
    expect(pressed()).toContain('闪电替换')
    expect(host.querySelector('.demo-hint')?.textContent).toContain('⌥')
    expect(host.querySelector('.demo-field-replace')?.textContent).toContain('明天下午三点')
    // ←/→ 在选项卡之间循环切换
    const arrow = (k: string) =>
      act(() =>
        host
          .querySelector('.demo-tabs [aria-selected="true"]')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })),
      )
    arrow('ArrowLeft')
    expect(pressed()).toContain('划词翻译')
    arrow('ArrowLeft')
    expect(pressed()).toContain('语音输入')
    arrow('Home')
    expect(pressed()).toContain('划词翻译')
    click('.demo-tabs [role="tab"]:nth-child(3)')
    expect(pressed()).toContain('截图翻译')
    expect(host.querySelector('.demo-shot')?.textContent).toContain('Platform 2')
    click('.demo-tabs [role="tab"]:nth-child(2)')
    const key = (type: string, init: KeyboardEventInit) =>
      act(() => window.dispatchEvent(new KeyboardEvent(type, init)))
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const tap = (code: string, flag: 'ctrlKey' | 'altKey') => {
      key('keydown', { code, [flag]: true })
      now += 60
      key('keyup', { code })
      now += 100
    }
    tap('ControlLeft', 'ctrlKey')
    tap('ControlLeft', 'ctrlKey')
    expect(pressed()).toContain('划词翻译')
    tap('AltLeft', 'altKey')
    tap('AltLeft', 'altKey')
    expect(pressed()).toContain('闪电替换')
    // 左 ⌃ 接右 ⌃、中间按了别的键，都不算连按
    tap('ControlLeft', 'ctrlKey')
    tap('ControlRight', 'ctrlKey')
    tap('ControlLeft', 'ctrlKey')
    key('keydown', { code: 'KeyC' })
    tap('ControlLeft', 'ctrlKey')
    expect(pressed()).toContain('闪电替换')
    // 按住修饰键不切换模式：语音（⌃⌘V）与截图一样只能点选项卡
    key('keydown', { code: 'AltRight', altKey: true })
    now += 400
    key('keyup', { code: 'AltRight' })
    expect(pressed()).toContain('闪电替换')
  })

  it('Footer 向上展开五种语言，切换后关闭菜单', () => {
    expect(host.querySelector('footer ul')).toBeNull()
    click('footer button[aria-expanded]')
    const options = host.querySelectorAll('footer ul a')
    expect([...options].map((option) => option.textContent)).toEqual([
      'English',
      '简体中文',
      '繁體中文',
      '日本語',
      '한국어',
    ])
    expect(host.querySelector('footer ul')?.className).toContain('bottom-full')
    click('footer a[href="/ko/"]')
    // 就地切换：地址不变，语言记进 cookie 给 Worker 下次用
    expect(window.location.pathname).toBe('/')
    expect(document.documentElement.dataset.locale).toBe('ko')
    expect(document.cookie).toContain('umuo-lang=ko')
    expect(host.querySelector('h1')?.textContent).toContain('번역')
    expect(host.querySelector('footer ul')).toBeNull()
    expect(host.querySelector('footer button[aria-expanded]')?.textContent).toContain('한국어')
  })

  it('语言菜单支持 Escape 和点外部关闭', () => {
    click('footer button[aria-expanded]')
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host.querySelector('footer ul')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('footer button[aria-expanded]'))
    click('footer button[aria-expanded]')
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(host.querySelector('footer ul')).toBeNull()
  })

  it('主题切换只在 Footer；挂载时不写存储（保持跟随系统），亲手切换后才保存', () => {
    expect(host.querySelector('header button[aria-label="主题"]')).toBeNull()
    expect(window.localStorage.getItem('umuo-theme')).toBeNull()
    click('footer button[aria-label="主题"]')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('umuo-theme')).toBe('light')
    expect(host.querySelector('footer button[aria-label="主题"]')?.getAttribute('title')).toBe(
      '切换到深色主题',
    )
    click('footer button[aria-label="主题"]')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('umuo-theme')).toBe('dark')
  })

  it('点了下载后，按钮的 aria-describedby 不再指向已移除的系统要求', () => {
    const download = host.querySelector<HTMLAnchorElement>('#download a.btn-solid')
    const describedBy = download?.getAttribute('aria-describedby')
    expect(describedBy && document.getElementById(describedBy)?.textContent).toContain('macOS 14')
    // 不让 happy-dom 真的跟着链接走；React 的 onClick 照常触发
    document.addEventListener('click', (event) => event.preventDefault(), { once: true })
    act(() => download?.click())
    expect(host.querySelector('.download-next')?.textContent).toContain('接下来')
    expect(host.querySelector('.download-requirement')).toBeNull()
    expect(download?.hasAttribute('aria-describedby')).toBe(false)
  })

  it('下载按钮指向 Worker 给出的最新安装包，带预览版标签与放行说明', () => {
    const download = host.querySelector<HTMLAnchorElement>('#download a.btn-solid')
    expect(download?.getAttribute('href')).toBe('/download/macos')
    expect(download?.textContent).toContain('预览版')
    expect(host.querySelector('#download')?.textContent).toContain('仍要打开')
    expect(host.querySelector('form')).toBeNull()
    // 下载按钮旁不再放说明句；源码链接只在页眉右侧
    expect(host.querySelector('#download a[href*="github.com"]')).toBeNull()
    expect(host.querySelector('footer a[href="https://github.com/youming-ai/umuo"]')).toBeNull()
    expect(host.querySelector('a[href*="pricing"]')).toBeNull()
  })
})

describe('手机端只留文字与一个按钮', () => {
  // happy-dom 不计算媒体查询：桌面与手机共用同一份 DOM，手机上的隐藏只能从样式表里断言
  const css = readFileSync(join(import.meta.dirname, '../styles/app.css'), 'utf8')
  const touch = '@media (hover: none) and (pointer: coarse) {'
  const touchBlocks = css
    .split(touch)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf('\n  }\n')))

  it('触屏条件下隐藏演示与字符网格，且只在这一条件下隐藏', () => {
    expect(
      touchBlocks.some((block) =>
        /\.hero-demo,\s*\.language-grid\s*\{\s*display: none;/.test(block),
      ),
    ).toBe(true)
    // 按视口高度给手机分档的规则已经删掉
    expect(css).not.toMatch(/max-height/)
    expect(css).not.toContain(':has(.download-next)')
  })

  it('复制网址是普通描边按钮，不用厚底按压', () => {
    const rule = css.match(/\n {2}\.btn-secondary \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('border: 1.5px solid var(--accent-strong)')
    expect(rule).not.toContain('--press-depth')
    expect(css).not.toMatch(/\.btn-secondary[^{]*:active[^{]*\{[^}]*translateY/)
  })

  it('复制网址：成功显示「已复制」，失败说出来并给出网址', async () => {
    const button = () => host.querySelector<HTMLButtonElement>('.download-touch button')
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('x'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await act(async () => button()?.click())
    expect(writeText).toHaveBeenCalledWith('https://umuo.app')
    expect(button()?.textContent).toBe('已复制')
    await act(async () => button()?.click())
    expect(host.querySelector('.download-touch [role="status"]')?.textContent).toBe(
      '没能复制，请手动记下 umuo.app',
    )
  })
})

describe('已删除的页面', () => {
  it('页面上没有条款、隐私与激活页的链接（旧地址由 Worker 回 404）', () => {
    expect(
      host.querySelector('a[href="/terms"], a[href="/privacy"], a[href="/activate"]'),
    ).toBeNull()
  })
})
