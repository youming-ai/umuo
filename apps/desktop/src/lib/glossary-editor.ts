/**
 * 术语表编辑器的纯逻辑。
 *
 * 解析（逗号/制表符、引号、BOM、表头）全在 Rust 侧
 * （`umuo_core::glossary::parse_delimited`），这里**不重复实现**——
 * 两处各写一遍，迟早会出现「粘贴进去 10 条、只导入 8 条却没人知道为什么」。
 */

import type { Translate } from './i18n'
import type { Glossary } from './ipc'

/**
 * 新建一张空表。
 *
 * id 用时间戳而不是从名称派生：名称随时会改，而 id 是身份——
 * 用户重命名一张表不该让它变成另一张。
 */
export function newGlossary(now: number = Date.now()): Glossary {
  return {
    id: `glossary-${now.toString(36)}`,
    name: '',
    sourceLang: '',
    targetLang: '',
    entries: [],
  }
}

/** 列表里那一行摘要：语言对 + 条数。 */
export function glossarySummary(glossary: Glossary, t: Translate): string {
  const pair = [glossary.sourceLang.trim(), glossary.targetLang.trim()]
    .map((lang) => (lang === '' ? t('prefs.glossary.anyLang') : lang))
    .join(' → ')
  return t('prefs.glossary.summary', { pair, count: glossary.entries.length })
}

/**
 * 语言对是否与某段翻译相关（仅用于界面提示）。
 *
 * 真正的判定在 Rust 侧（`glossary::applies_to`，含 `en-US` / `en` 这类
 * 同语言不同地区的比较）。这里只做空值判断，**不重复那套规则**。
 */
export function hasLanguageConstraint(glossary: Glossary): boolean {
  return glossary.sourceLang.trim() !== '' || glossary.targetLang.trim() !== ''
}
