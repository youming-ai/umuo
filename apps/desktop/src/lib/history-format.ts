/**
 * 历史窗的展示逻辑。
 *
 * 抽出来是为了能测：这些函数里有几处「不能含糊」的取舍——
 * 价格未知时必须说「未计价」而不是显示 $0，来源应用拿不到时必须留空而不是编一个。
 */

import type { Translate } from './i18n'
import type { DayUsage, Favorite, HistoryRecord, Usage } from './ipc'

/** 场景标签。存的是英文键，展示给用户的是中文。 */
export function sceneLabel(scene: string, t: Translate): string {
  switch (scene) {
    case 'selection':
      return t('history.sceneSelection')
    case 'silentReplace':
      return t('history.sceneSilentReplace')
    case 'compose':
      return t('history.sceneCompose')
    case 'compare':
      return t('history.sceneCompare')
    default:
      // 未知场景原样显示：以后加了新场景时，历史里显示一个英文键
      // 也比显示「未知」更能说明问题。
      return scene
  }
}

/** 本地时间 `YYYY-MM-DD HH:mm`。历史列表里按这个排序阅读最省事。 */
export function formatTimestamp(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 一行的元信息：谁译的、什么风格、用了多少、花了多少。 */
export function recordMeta(record: HistoryRecord, t: Translate): string {
  const parts = [`${record.providerId} · ${record.model}`, sceneLabel(record.scene, t)]
  if (record.styleId) parts.push(record.styleId)
  parts.push(`${record.inputTokens} → ${record.outputTokens} tokens`)
  if (record.estimated) parts.push(t('history.estimated'))
  // 价格未知时说「未计价」，而不是显示 $0.0000——那会让人以为它是免费的。
  parts.push(record.costUsd === null ? t('history.unpriced') : `$${record.costUsd.toFixed(4)}`)
  // 来源应用拿不到就整个略过，不显示空括号。
  if (record.sourceApp) parts.push(record.sourceApp)
  return parts.join(' · ')
}

/**
 * 本月用量文案。
 *
 * `unpriced` 必须显示出来：只报一个总额会让人以为「这个月就花了这么点」，
 * 而实际有一部分根本没进这个总额。
 */
export function usageLine(usage: Usage | null, t: Translate): string {
  if (!usage) return t('history.loadingUsage')
  const params = {
    count: usage.count,
    input: usage.inputTokens,
    output: usage.outputTokens,
    cost: `$${usage.costUsd.toFixed(4)}`,
  }
  return usage.unpriced > 0
    ? t('history.usageLineUnpriced', { ...params, unpriced: usage.unpriced })
    : t('history.usageLine', params)
}

/** 按日柱状图里的一根柱子。 */
export interface DayBar {
  day: string
  /** 只取 `MM-DD` 用于横轴标签——完整的年份在这一屏里是噪音。 */
  label: string
  count: number
  costUsd: number
  unpriced: number
  /** 相对窗口内最大值的比例（0..1）。全为 0 时是 0，不会除零。 */
  ratio: number
}

/**
 * 把按日用量整理成柱状图数据。
 *
 * `days` 来自存储层，**只包含有记录的那些天**——这里不补零，
 * 而是按给定的日期升序排列已有数据。要不要显示「什么都没有的那天」是展示决定，
 * 而补零会让「一周里只有两天有记录」看起来像有七天数据。
 */
export function dailyBars(days: DayUsage[], limit = 14): DayBar[] {
  const recent = [...days].sort((a, b) => a.day.localeCompare(b.day)).slice(-limit)
  const max = recent.reduce((peak, day) => Math.max(peak, day.count), 0)
  return recent.map((day) => ({
    day: day.day,
    label: day.day.slice(5),
    count: day.count,
    costUsd: day.costUsd,
    unpriced: day.unpriced,
    ratio: max > 0 ? day.count / max : 0,
  }))
}

/** 单根柱子的悬浮说明。 */
export function dayBarTitle(bar: DayBar, t: Translate): string {
  const params = { day: bar.day, count: bar.count, cost: `$${bar.costUsd.toFixed(4)}` }
  return bar.unpriced > 0
    ? t('history.dayBarTitleUnpriced', { ...params, unpriced: bar.unpriced })
    : t('history.dayBarTitle', params)
}

/** 收藏列表里那一行的副标题。 */
export function favoriteMeta(favorite: Favorite, t: Translate): string {
  const kind = favorite.kind === 'word' ? t('history.favoriteWord') : t('history.favoriteSentence')
  const parts = [kind]
  if (favorite.targetLang) parts.push(favorite.targetLang)
  return parts.join(' · ')
}
