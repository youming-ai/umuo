/**
 * 自建风格预设的纯逻辑（PRD §5.7）。
 *
 * 增删改都做成不可变的新数组：设置页把整份 `Settings` 交给 `saveSettings`，
 * 原地改动会让 React 看不到变化，也会把「取消编辑」变成一件做不到的事。
 */

import type { Translate } from './i18n'
import type { CustomStyle } from './ipc'

/** 温度上限与 Rust 侧 `TEMPERATURE_RANGE` 保持一致（OpenAI 的上限）。 */
export const MAX_TEMPERATURE = 2

/**
 * 新建一个空预设。
 *
 * id 用时间戳生成而不是从标签派生：标签随时会改，而 id 是**身份**——
 * 历史记录按 id 关联「这句话是用哪套规则翻的」，改标签不该让它变成另一条记录。
 * 前缀 `custom-` 保证不会撞上内置 id（内置的都是 standard / academic 这类词）。
 */
export function newCustomStyle(now: number = Date.now()): CustomStyle {
  return {
    id: `custom-${now.toString(36)}`,
    label: '',
    instruction: '',
    temperature: 0.2,
    fewShot: [],
    explain: false,
  }
}

/** 预览里那一行摘要。让用户不必展开就能看出这条预设的倾向。 */
export function presetSummary(style: CustomStyle, t: Translate): string {
  const parts = [t('prefs.presets.summaryTemperature', { value: style.temperature.toFixed(1) })]
  if (style.fewShot.length > 0)
    parts.push(t('prefs.presets.summaryExamples', { count: style.fewShot.length }))
  if (style.explain) parts.push(t('prefs.presets.summaryExplain'))
  if (style.instruction.trim() === '') parts.push(t('prefs.presets.summaryNoInstruction'))
  return parts.join(t('prefs.listSeparator'))
}

/** 按 id 覆盖或追加。用于「保存」——不区分新建与编辑，少一条分支就少一处不一致。 */
export function upsertStyle(list: CustomStyle[], style: CustomStyle): CustomStyle[] {
  const index = list.findIndex((item) => item.id === style.id)
  if (index === -1) return [...list, style]
  return list.map((item) => (item.id === style.id ? style : item))
}

export function removeStyle(list: CustomStyle[], id: string): CustomStyle[] {
  return list.filter((item) => item.id !== id)
}

/**
 * 温度输入的解析。
 *
 * 空串、非数字、越界都要有一个确定的结果——`Number('')` 是 0，直接用它会让
 * 用户清空输入框时温度悄悄变成 0（最保守的值），而不是他想要的「还没填」。
 */
export function parseTemperature(input: string): number {
  const parsed = Number.parseFloat(input)
  if (!Number.isFinite(parsed)) return 0.2
  return Math.min(MAX_TEMPERATURE, Math.max(0, parsed))
}
