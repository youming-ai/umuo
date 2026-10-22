/**
 * 把 Tauri 客户端的界面文案（`apps/desktop/src/lib/i18n/{messages,prefs-messages}.ts`）
 * 导出成 SwiftUI 客户端的 String Catalog：`apps/macos/Sources/Umuo/Resources/Strings/Localizable.xcstrings`。
 *
 * 一次性脚本：Tauri 客户端已冻结，文案以后在 xcstrings 里改；只有冻结期间那边因修复改了文案时才重跑。
 *
 * 换算规则：
 * - 语言：zh-CN → zh-Hans（源语言）、zh-TW → zh-Hant、en、ja。
 * - 占位符：`{name}` → `%N$@`。N 按**简体中文**里第一次出现的顺序编号，其它语言按名字对到同一个 N
 *   （英文、日文的语序可以不同）。名字表写进每条的 `comment`（`placeholders: a, b`），
 *   Swift 端按它把具名参数放到位置上（`L10n.swift`）。
 * - 文案里本来的 `%` 写成 `%%`，免得被当成格式说明符。
 *
 * 用法：`bun run scripts/export-xcstrings.ts`
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MESSAGES } from '../apps/desktop/src/lib/i18n/messages'

const LANGUAGES = [
  ['zh-CN', 'zh-Hans'],
  ['zh-TW', 'zh-Hant'],
  ['en', 'en'],
  ['ja', 'ja'],
] as const

const OUTPUT = join(
  import.meta.dir,
  '..',
  'apps/macos/Sources/Umuo/Resources/Strings/Localizable.xcstrings',
)

const PLACEHOLDER = /\{(\w+)\}/g

/** 一条文案里的占位符名字，按第一次出现的顺序、去重。 */
function placeholderNames(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!names.includes(match[1])) names.push(match[1])
  }
  return names
}

function toFormat(text: string, names: string[], where: string): string {
  return text.replaceAll('%', '%%').replace(PLACEHOLDER, (_whole, name: string) => {
    const index = names.indexOf(name)
    if (index < 0) throw new Error(`${where}：占位符 {${name}} 在简体中文里没有`)
    return `%${index + 1}$@`
  })
}

interface Entry {
  comment?: string
  extractionState: 'manual'
  localizations: Record<string, { stringUnit: { state: 'translated'; value: string } }>
}

const source = MESSAGES['zh-CN']
const strings: Record<string, Entry> = {}
for (const key of Object.keys(source).sort() as Array<keyof typeof source>) {
  const names = placeholderNames(source[key])
  const entry: Entry = { extractionState: 'manual', localizations: {} }
  if (names.length > 0) entry.comment = `placeholders: ${names.join(', ')}`
  for (const [from, to] of LANGUAGES) {
    const value = MESSAGES[from][key]
    if (value === undefined) throw new Error(`${from} 缺少 ${key}`)
    entry.localizations[to] = {
      stringUnit: { state: 'translated', value: toFormat(value, names, `${from} 的 ${key}`) },
    }
  }
  strings[key] = entry
}

const catalog = { sourceLanguage: 'zh-Hans', strings, version: '1.0' }
writeFileSync(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`${Object.keys(strings).length} 条文案 → ${OUTPUT}`)
