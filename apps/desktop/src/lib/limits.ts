/**
 * 月度上限的编辑逻辑（PRD §5.10）。
 *
 * 上限清单是「稀疏」的：只有用户设过的供应商才有条目。
 * 把「没设」与「设成 0」分开是这一块的核心——0 表示「这个供应商一分钱也不许花」，
 * 是一个有效的用法（临时停用某个供应商，但保留它的 Key）。
 */

import type { Translate } from './i18n'
import type { ProviderLimit, ProviderUsage } from './ipc'

/** 取某个供应商的上限。没设过返回 `null`（而不是 0）。 */
export function limitFor(limits: ProviderLimit[], providerId: string): number | null {
  const found = limits.find((limit) => limit.providerId === providerId)
  return found ? found.limitUsd : null
}

/**
 * 设置或清除某个供应商的上限。
 *
 * `null` = 清除（从清单里删掉），而不是记成 0——
 * 记成 0 会把「取消上限」变成「禁止花钱」，两个完全相反的意思。
 */
export function setLimit(
  limits: ProviderLimit[],
  providerId: string,
  value: number | null,
): ProviderLimit[] {
  const rest = limits.filter((limit) => limit.providerId !== providerId)
  if (value === null || !Number.isFinite(value)) return rest
  return [...rest, { providerId, limitUsd: Math.max(0, value) }]
}

/**
 * 解析上限输入框。
 *
 * 空串 = 清除上限，所以这里返回 `null` 而不是数字。
 * `Number('')` 是 0，直接用它会让「清空输入框」变成「禁止花钱」。
 */
export function parseLimit(input: string): number | null {
  if (input.trim() === '') return null
  const parsed = Number.parseFloat(input)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null
}

/** 某个供应商本月的花费。没有记录就是 0。 */
export function spendFor(spends: ProviderUsage[], providerId: string): number {
  return spends.find((row) => row.providerId === providerId)?.costUsd ?? 0
}

/**
 * 一行上限的摘要。
 *
 * 超限时必须明确写出来，而不是只显示两个数字让人自己比大小。
 */
export function limitSummary(limit: number | null, spentUsd: number, t: Translate): string {
  // 货币符号放进值里而不是文案模板里：「$」紧挨「{spent}」会被当成模板字符串的笔误。
  const spent = `$${spentUsd.toFixed(4)}`
  if (limit === null) return t('prefs.advanced.spentUnlimited', { spent })
  // 正好花到上限也算超限，与 Rust 侧 `>=` 的口径一致。
  const key = spentUsd >= limit ? 'prefs.advanced.spentOver' : 'prefs.advanced.spentOf'
  return t(key, { spent, limit: `$${limit.toFixed(2)}` })
}
