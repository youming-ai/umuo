import { describe, expect, it } from 'vitest'

import { LOCALES, resolveLocale, SOURCE_LOCALE, translate } from './index'
import { MESSAGES, type MessageKey, ZH_CN } from './messages'

describe('界面语言判定（PRD §8）', () => {
  it('明选的语言直接生效', () => {
    expect(resolveLocale('en', ['zh-CN'])).toBe('en')
    expect(resolveLocale('ja', [])).toBe('ja')
    expect(resolveLocale('zh-TW', ['en-US'])).toBe('zh-TW')
  })

  it('跟随系统时按系统语言猜', () => {
    expect(resolveLocale('system', ['ja-JP', 'en-US'])).toBe('ja')
    expect(resolveLocale('system', ['en-GB'])).toBe('en')
  })

  it('把繁体地区认成繁体，而不是简体', () => {
    // 只按 `zh` 前缀判断会让繁体用户看到简体——最常见的错法。
    expect(resolveLocale('system', ['zh-Hant-TW'])).toBe('zh-TW')
    expect(resolveLocale('system', ['zh-TW'])).toBe('zh-TW')
    expect(resolveLocale('system', ['zh-HK'])).toBe('zh-TW')
    expect(resolveLocale('system', ['zh-MO'])).toBe('zh-TW')
    expect(resolveLocale('system', ['zh-Hans-CN'])).toBe('zh-CN')
    expect(resolveLocale('system', ['zh-CN'])).toBe('zh-CN')
  })

  it('认不出来的偏好回落到源语言', () => {
    expect(resolveLocale('system', ['ko-KR', 'th-TH'])).toBe(SOURCE_LOCALE)
    expect(resolveLocale('system', [])).toBe(SOURCE_LOCALE)
  })

  it('设置里写了不认识的值时当作跟随系统，而不是界面变成空白', () => {
    // 手改过的配置文件、或未来版本写进来的值。
    expect(resolveLocale('klingon', ['en-US'])).toBe('en')
    expect(resolveLocale('', ['ja'])).toBe('ja')
  })

  it('选项列表覆盖 PRD 要的四种语言，外加跟随系统', () => {
    const ids = LOCALES.map(([id]) => id)
    for (const wanted of ['zh-CN', 'zh-TW', 'en', 'ja']) {
      expect(ids).toContain(wanted)
    }
    expect(ids).toContain('system')
  })
})

describe('文案表', () => {
  it('四种语言的 key 集合完全一致', () => {
    // 漏翻一条会让用户看到另一种语言的句子——比"没翻译"更明显的破绽。
    const source = Object.keys(ZH_CN).sort()
    for (const [locale, table] of Object.entries(MESSAGES)) {
      expect(Object.keys(table).sort(), `${locale} 的 key 集合与简体中文不一致`).toEqual(source)
    }
  })

  it('没有空文案', () => {
    for (const [locale, table] of Object.entries(MESSAGES)) {
      for (const [key, value] of Object.entries(table)) {
        expect(value.trim(), `${locale} 的 ${key} 是空的`).not.toBe('')
      }
    }
  })

  it('带占位符的文案在各语言里占位符一致', () => {
    // 少一个 {reason} 会让错误信息断在半句话上。
    for (const key of Object.keys(ZH_CN) as MessageKey[]) {
      const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()
      const expected = placeholders(ZH_CN[key])
      for (const [locale, table] of Object.entries(MESSAGES)) {
        expect(placeholders(table[key]), `${locale} 的 ${key} 占位符不一致`).toEqual(expected)
      }
    }
  })
})

describe('取文案', () => {
  it('按语言取到对应的句子', () => {
    expect(translate('zh-CN', 'panel.copy')).toBe('复制')
    expect(translate('en', 'panel.copy')).toBe('Copy')
    expect(translate('ja', 'panel.copy')).toBe('コピー')
  })

  it('替换占位符', () => {
    expect(translate('zh-CN', 'panel.replaceFailed', { reason: '目标已切换' })).toBe(
      '替换失败：目标已切换',
    )
    expect(translate('en', 'panel.switchingModel', { provider: 'DeepSeek' })).toBe(
      'Retranslating with DeepSeek…',
    )
  })

  it('没给参数时保留占位符，而不是渲染出 undefined', () => {
    expect(translate('en', 'panel.replaceFailed')).toContain('{reason}')
  })

  it('整个 key 都不存在时返回 key 本身，让它在界面上一眼可见', () => {
    expect(translate('en', 'nope.missing' as MessageKey)).toBe('nope.missing')
  })
})

/**
 * **已经国际化的窗口清单。** 这份清单就是覆盖率的活文档：
 * 往里加一个文件，就等于承诺它不再有硬编码中文。
 *
 * 所有窗口（含设置窗及其用到的组件）都已在清单里。仍是中文的只剩不在前端的文本：
 * 内核返回的错误与内置风格名、托盘菜单与窗口标题——见 docs/PRD-CONFORMANCE.md §8。
 */
const LOCALIZED_FILES = [
  'apps/desktop/src/panel.tsx',
  'apps/desktop/src/compose.tsx',
  'apps/desktop/src/history.tsx',
  'apps/desktop/src/quick.tsx',
  'apps/desktop/src/compare.tsx',
  'apps/desktop/src/onboarding.tsx',
  'apps/desktop/src/settings.tsx',
  'apps/desktop/src/settings/GeneralPage.tsx',
  'apps/desktop/src/settings/TranslatePage.tsx',
  'apps/desktop/src/settings/EnginePage.tsx',
  'apps/desktop/src/settings/PermissionsPage.tsx',
  'apps/desktop/src/settings/AdvancedPage.tsx',
  'apps/desktop/src/settings/AboutPage.tsx',
  'apps/desktop/src/settings/ui.tsx',
  'apps/desktop/src/settings/icons.tsx',
  'apps/desktop/src/settings/HotkeyRecorder.tsx',
  'apps/desktop/src/components/SceneRouting.tsx',
  'apps/desktop/src/components/ModelRefList.tsx',
  'apps/desktop/src/components/StylePresets.tsx',
  'apps/desktop/src/components/GlossaryManager.tsx',
  'apps/desktop/src/components/LanguageSelect.tsx',
]

/** 逐行找「代码里的中文」——注释不算。 */
function hardcodedChinese(source: string): string[] {
  let inBlockComment = false
  const leftovers: string[] = []
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      return
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    const code = line.replace(/\/\/.*$/, '')
    if (/[\u4e00-\u9fff]/.test(code)) leftovers.push(`${index + 1}: ${trimmed.slice(0, 70)}`)
  })
  return leftovers
}

describe('已国际化的窗口里没有硬编码文案', () => {
  it('清单里的每个文件都不含中文文案', async () => {
    // 这道防线的作用是「以后新增文案不会绕过文案表」——
    // 否则四种语言里会慢慢长出只有中文的句子，而没人发现。
    const { readFileSync } = await import('node:fs')
    const problems: string[] = []
    for (const file of LOCALIZED_FILES) {
      for (const line of hardcodedChinese(readFileSync(file, 'utf8'))) {
        problems.push(`${file} → ${line}`)
      }
    }
    expect(problems, `这些行还有硬编码中文：\n${problems.join('\n')}`).toEqual([])
  })

  it('这条规则本身能抓到问题（否则它只是装饰）', () => {
    expect(hardcodedChinese(`export function A() {\n  return <p>中文</p>\n}`)).toHaveLength(1)
    expect(
      hardcodedChinese('// 注释里的中文不算\n/**\n * 文档里的中文也不算\n */\nconst x = 1'),
    ).toEqual([])
  })
})
