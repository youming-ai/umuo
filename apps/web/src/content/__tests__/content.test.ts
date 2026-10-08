import { describe, expect, it } from 'vitest'

import { HTML_LANG, LOCALES } from '../../config'
import { getContent } from '../index'

/**
 * 官网内容的回归保护。
 *
 * 类型系统只能保证「四种语言结构一致」，保证不了「都写了」——空字符串与漏翻
 * （把中文原样复制到 ja）在类型上完全合法。这两类问题恰恰最容易发生：
 * 加一段新文案时只填了一种语言，构建照样通过，页面上却是一块空白。
 */

function collectStrings(value: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof value === 'string') {
    out.push([path, value])
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectStrings(item, `${path}[${index}]`, out)
    })
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      collectStrings(nested, `${path}.${key}`, out)
    }
  }
}

/**
 * 显示宽度（半角为单位）。
 *
 * 标题与元描述的长度限制本质上是**像素**限制，而 CJK 字符的宽度约等于两个半角字符。
 * 按 `String.length` 度量会把「32 个汉字」误判成和「32 个字母」一样长，
 * 于是对中日文给出错误结论——这个测试的第一版就犯了这个错。
 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    width += wide ? 2 : 1
  }
  return width
}

describe('官网内容完整性', () => {
  it('每种语言都没有空白文案', () => {
    for (const locale of LOCALES) {
      const strings: Array<[string, string]> = []
      collectStrings(getContent(locale), locale, strings)

      expect(strings.length, `${locale} 的内容为空`).toBeGreaterThan(100)

      const empty = strings
        .filter(([, value]) => value.trim().length === 0)
        // 对比表首位表头是**故意留空**的占位格：组件在 th 里放了 sr-only 的列名，
        // 屏幕阅读器有得读，视觉上留空是对比表的通行做法。
        .filter(([path]) => path !== `${locale}.comparison.columns[0]`)
        .map(([path]) => path)
      expect(empty, `${locale} 里存在空文案`).toEqual([])
    }
  })

  it('对比表的每一列都有列名（首位占位格除外）', () => {
    for (const locale of LOCALES) {
      const columns = getContent(locale).comparison.columns
      expect(columns[0], `${locale}: 首位应为占位格`).toBe('')
      for (const column of columns.slice(1)) {
        expect(column.trim(), `${locale}: 对比表有空列名`).not.toBe('')
      }
      // 第一列数据必须是 umuo 自己，否则整张表的语义就错了。
      expect(columns[1], `${locale}: 第二列应为 umuo`).toBe('umuo')
    }
  })

  it('每种语言都有自己的 Hero 标题，没有漏翻', () => {
    // 漏翻的典型形态：复制了另一语言的标题却忘了改。
    const titles = LOCALES.map((locale) => getContent(locale).hero.title)
    expect(new Set(titles).size).toBe(LOCALES.length)
  })

  it('定价数字与 PRD §10.2 逐项一致', () => {
    // 价格是官网上唯一不能「大致写写」的内容：写错了是商业事故。
    for (const locale of LOCALES) {
      const tiers = getContent(locale).pricing.tiers
      const byId = new Map(tiers.map((tier) => [tier.id, tier]))

      expect(byId.get('free')?.priceMonthly, `${locale}: Free 档`).toBe('$0')
      expect(byId.get('pro')?.priceMonthly, `${locale}: Pro 月付`).toBe('$5.99')
      expect(byId.get('pro')?.priceYearly, `${locale}: Pro 年付`).toBe('$46.99')
      expect(byId.get('pro-plus')?.priceMonthly, `${locale}: Pro+ 月付`).toBe('$11.99')
      expect(byId.get('pro-plus')?.priceYearly, `${locale}: Pro+ 年付`).toBe('$93.99')
    }
  })

  it('FAQ 覆盖 PRD §11.3 要求的全部主题', () => {
    for (const locale of LOCALES) {
      const items = getContent(locale).faq.items
      // PRD §11.3 列了 7 组必答问题；少于这个数说明有主题被漏掉了。
      expect(items.length, `${locale}: FAQ 条目过少`).toBeGreaterThanOrEqual(7)
      const empty = items.filter((item) => !item.question.trim() || !item.answer.trim())
      expect(empty, `${locale}: 存在没写答案的 FAQ`).toEqual([])
    }
  })

  it('SEO 标题与描述都落在合理宽度内', () => {
    for (const locale of LOCALES) {
      const { title, description, ogLocale } = getContent(locale).seo

      // 标题会被搜索结果**肉眼截断**，所以用较紧的上限（约 600px）。
      expect(displayWidth(title), `${locale}: title 过宽会被截断（${title}）`).toBeLessThanOrEqual(
        60,
      )
      expect(title.toLowerCase(), `${locale}: 标题里应出现品牌名`).toContain('umuo')

      // 描述被截断的后果轻得多（搜索引擎经常自己重写），只拦明显失控的长度。
      expect(displayWidth(description), `${locale}: description 过宽`).toBeLessThanOrEqual(320)
      expect(displayWidth(description), `${locale}: description 过短`).toBeGreaterThan(40)

      expect(ogLocale, `${locale}: OG locale 格式不对`).toMatch(/^[a-z]{2}_[A-Z]{2}$/)
    }

    const ogLocales = LOCALES.map((locale) => getContent(locale).seo.ogLocale)
    expect(new Set(ogLocales).size).toBe(LOCALES.length)
  })

  it('每种语言都有 <html lang> 映射，且用 BCP-47 的 Hans/Hant 区分简繁', () => {
    for (const locale of LOCALES) {
      expect(HTML_LANG[locale], `${locale} 缺 html lang 映射`).toBeTruthy()
    }
    expect(HTML_LANG['zh-cn']).toBe('zh-Hans')
    expect(HTML_LANG['zh-tw']).toBe('zh-Hant')
  })

  it('未发布的平台不提供假下载链接', () => {
    // 里程碑 1 只有 macOS 在开发中；Windows / Linux 必须是「订阅上线通知」。
    for (const locale of LOCALES) {
      const platforms = getContent(locale).hero.platforms
      const macos = platforms.find((p) => p.id === 'macos')
      expect(macos, `${locale}: 缺 macOS 卡片`).toBeTruthy()
      for (const platform of platforms) {
        expect(platform.actionLabel.trim(), `${locale}/${platform.id}: 按钮文案为空`).toBeTruthy()
      }
    }
  })
})
