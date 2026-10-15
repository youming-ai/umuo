/**
 * 界面里可选的语言。
 *
 * 抽成独立模块是因为它现在有两处用户：设置页的语言下拉，与首次引导的第二步。
 * 两处各写一份列表，迟早会出现「引导里选得到的语言，设置页里没有」。
 */

export const LANGUAGES: Array<[string, string]> = [
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['ru', 'Русский'],
]

/** 语言代码 → 显示名。认不出来就原样返回——总比显示空白强。 */
export function languageLabel(code: string): string {
  return LANGUAGES.find(([value]) => value === code)?.[1] ?? code
}
