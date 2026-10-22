/**
 * 对比窗的状态机。
 *
 * 与浮窗那套的区别：这里是 **N 路并发**的流式输出，每条增量都带卡片下标。
 * 抽成纯函数同样是为了测那些在 UI 里几乎无法复现的时序问题：
 * 某张卡已经报错了、它的增量却还在路上；或者一轮对比结束后又来了一批旧增量。
 */

import type { Translate } from './i18n'
import type { CompareCard, CompareDone, CompareError, CompareNotice, CompareStart } from './ipc'

export type CardStatus = 'waiting' | 'streaming' | 'done' | 'error'

export interface CardState extends CompareCard {
  text: string
  status: CardStatus
  error: string | null
  metrics: CompareDone | null
}

export interface CompareState {
  /** `idle` = 还没发起过；`running` = 还有卡片没落定。 */
  status: 'idle' | 'running' | 'done'
  /** 正在显示的那一轮。0 = 还没有过（后端的 id 从 1 起）。别的轮次的事件一律丢掉。 */
  runId: number
  /** 整窗级的提示（没有可用模型、取词失败）。新一轮 start 时清掉。 */
  notice: string | null
  source: string
  targetLang: string
  cards: CardState[]
}

export const initialCompareState: CompareState = {
  status: 'idle',
  runId: 0,
  notice: null,
  source: '',
  targetLang: '',
  cards: [],
}

export type CompareAction =
  | { type: 'start'; payload: CompareStart }
  | { type: 'delta'; runId: number; index: number; text: string }
  | { type: 'done'; payload: CompareDone }
  | { type: 'error'; payload: CompareError }
  | { type: 'notice'; payload: CompareNotice }
  | { type: 'reset' }

export function reduceCompare(state: CompareState, action: CompareAction): CompareState {
  switch (action.type) {
    case 'start':
      // 比当前还旧的一轮：它在发出 start 前就已经被新一轮顶掉了。
      if (action.payload.runId < state.runId) return state
      // 每次 start 整体重建：上一轮的译文绝不能残留在这一轮的卡片里。
      return {
        status: 'running',
        runId: action.payload.runId,
        notice: null,
        source: action.payload.text,
        targetLang: action.payload.targetLang,
        cards: action.payload.cards.map((card) => ({
          ...card,
          text: '',
          status: 'waiting',
          error: null,
          metrics: null,
        })),
      }

    case 'delta': {
      // 上一轮迟到的增量：同一个下标在新一轮里是另一张卡片，写进去就串了。
      if (action.runId !== state.runId) return state
      const cards = state.cards.map((card) => {
        if (card.index !== action.index) return card
        // 已经落定的卡片不再接受增量：迟到的分片如果还写进去，
        // 用户会看到译文在「完成」之后又长出一截。
        if (card.status === 'done' || card.status === 'error') return card
        return { ...card, status: 'streaming' as CardStatus, text: card.text + action.text }
      })
      return { ...state, cards, status: settleStatus(cards) }
    }

    case 'done': {
      if (action.payload.runId !== state.runId) return state
      const cards = state.cards.map((card) =>
        card.index === action.payload.index
          ? { ...card, status: 'done' as CardStatus, metrics: action.payload }
          : card,
      )
      return { ...state, cards, status: settleStatus(cards) }
    }

    case 'error': {
      if (action.payload.runId !== state.runId) return state
      const cards = state.cards.map((card) =>
        card.index === action.payload.index
          ? {
              ...card,
              // 已经出过译文的卡片只在下面补一条错误说明，不要把译文清掉——
              // 半段译文对用户仍有价值，抹掉它等于把已经拿到的信息扔了。
              status: 'error' as CardStatus,
              error: action.payload.message,
            }
          : card,
      )
      return { ...state, cards, status: settleStatus(cards) }
    }

    case 'notice':
      if (action.payload.runId < state.runId) return state
      // 新一轮在出卡片之前就失败了：上一轮的卡片不能留着，否则看起来像是这一轮的结果。
      return { ...initialCompareState, runId: action.payload.runId, notice: action.payload.message }

    case 'reset':
      return { ...initialCompareState, runId: state.runId }
  }
}

/** 全部卡片都落定（done 或 error）时，整轮才算结束。 */
function settleStatus(cards: CardState[]): CompareState['status'] {
  if (cards.length === 0) return 'idle'
  return cards.every((card) => card.status === 'done' || card.status === 'error')
    ? 'done'
    : 'running'
}

/**
 * 卡片标题行的计量文案。价格未知时明确说「无价格信息」，不编数字。
 * 文案复用浮窗那几条（审查 L24）：两处说的是同一组指标，措辞不该分叉。
 */
export function cardMetrics(card: CardState, t: Translate): string | null {
  const metrics = card.metrics
  if (!metrics) return null
  const cost = metrics.costUsd === null ? t('panel.noPrice') : `$${metrics.costUsd.toFixed(4)}`
  const tokens = t('panel.tokens', {
    input: metrics.inputTokens,
    output: metrics.outputTokens,
    estimated: metrics.estimated ? t('panel.estimated') : '',
  })
  const latency =
    metrics.firstTokenMs === null
      ? t('panel.latencyTotal', { total: metrics.totalMs })
      : t('panel.latency', { first: metrics.firstTokenMs, total: metrics.totalMs })
  return `${latency} · ${tokens} · ${cost}`
}
