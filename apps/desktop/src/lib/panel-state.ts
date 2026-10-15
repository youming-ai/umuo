/**
 * 浮窗的状态机。
 *
 * 抽成纯函数是为了能测：浮窗最烦人的 bug 都是「流结束之后还在追加增量」
 * 或者「上一次翻译的增量污染了下一次」这类时序问题，
 * 它们在真实 UI 里很难复现，但在纯 reducer 里是一行断言的事。
 */

import type { Translate } from './i18n'
import type {
  DonePayload,
  ErrorPayload,
  PermissionKind,
  StartPayload,
  SuggestedAction,
  TranslateMode,
  WordCard,
} from './ipc'

// 重新导出：调用方（浮窗、撰写窗）一直是从这里取 Translate 的，不必跟着搬家。
export type { Translate }

export type PanelStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface PanelState {
  status: PanelStatus
  /** 原文（用于对照与小字展示）。 */
  source: string
  /** 已累计的译文。 */
  translation: string
  provider: string
  model: string
  targetLang: string
  wordMode: boolean
  /** 这次翻译的用途：只显示，还是把结果写回原处。 */
  mode: TranslateMode
  /** 译文是否已经写回原处。 */
  replaced: boolean
  /** 离线用本机模型翻的（PRD §7.5）。 */
  offline: boolean
  /** 单词词卡。有值时就该渲染卡片而不是纯文本译文（PRD §5.2）。 */
  card: WordCard | null
  /** 结果之外要说的那句话（超限、换供应商）。翻译是成功的，不是错误。 */
  warning: string | null
  error: string | null
  errorActions: SuggestedAction[]
  /** 缺权限这类错误要显示「去开权限」而不是「重试」。 */
  needsPermission: boolean
  /** 缺的是哪一个权限——浮窗据此把用户送去正确的设置面板。 */
  permission: PermissionKind | null
  metrics: DonePayload | null
}

export const initialState: PanelState = {
  status: 'idle',
  source: '',
  translation: '',
  provider: '',
  model: '',
  targetLang: '',
  wordMode: false,
  mode: 'selection',
  replaced: false,
  offline: false,
  card: null,
  warning: null,
  error: null,
  errorActions: [],
  needsPermission: false,
  permission: null,
  metrics: null,
}

export type PanelAction =
  | { type: 'start'; payload: StartPayload }
  | { type: 'delta'; text: string }
  | { type: 'card'; payload: WordCard }
  | { type: 'done'; payload: DonePayload }
  | { type: 'error'; payload: ErrorPayload }
  | { type: 'reset' }

export function reduce(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'start':
      // 每次 start 都整体重置：上一次翻译的译文绝不能残留进这一次。
      return {
        ...initialState,
        status: 'streaming',
        source: action.payload.text,
        provider: action.payload.provider,
        model: action.payload.model,
        targetLang: action.payload.targetLang,
        wordMode: action.payload.wordMode,
        mode: action.payload.mode,
      }

    case 'delta':
      // 只在 streaming 状态下追加：完成或报错之后迟到的增量必须被丢掉，
      // 否则用户会看到「译文在报错信息后面又冒出来一截」。
      if (state.status !== 'streaming') return state
      return { ...state, translation: state.translation + action.text }

    case 'card':
      // 词卡与增量互斥（后端在词卡模式下抑制了 delta），所以直接覆盖。
      if (state.status !== 'streaming') return state
      return { ...state, card: action.payload }

    case 'done':
      if (state.status !== 'streaming') return state
      return {
        ...state,
        status: 'done',
        // 提醒跟着结果一起到达；下一次 start 会把它清掉。
        warning: action.payload.warning,
        // 故障转移后实际服务的模型可能与 start 时说的不同，以 done 为准。
        model: action.payload.model,
        replaced: action.payload.replaced,
        offline: action.payload.offline,
        metrics: action.payload,
      }

    case 'error':
      return {
        ...state,
        status: 'error',
        error: action.payload.message,
        errorActions: action.payload.actions,
        needsPermission: action.payload.needsPermission,
        permission: action.payload.permission,
      }

    case 'reset':
      return initialState
  }
}

/** 状态行文案：把「谁在翻、翻成什么」用一行说清。 */
export function statusLine(state: PanelState, t: Translate): string {
  // 离线回落时**不能**沿用 start 事件里的供应商名：那是原来那家云端厂商，
  // 而实际服务的是本机模型。显示「OpenAI · llama3.1」比不显示更让人困惑。
  const source = state.offline ? [t('panel.offline')] : [state.provider]
  const parts = [...source, state.model, state.targetLang].filter(Boolean)
  return parts.join(' · ')
}

/** 费用文案。价格表里没有这个模型时**明确说不知道**，不编数字。 */
export function costLine(metrics: DonePayload | null, t: Translate): string | null {
  if (!metrics) return null
  const tokens = t('panel.tokens', {
    input: metrics.inputTokens,
    output: metrics.outputTokens,
    estimated: metrics.estimated ? t('panel.estimated') : '',
  })
  const cost = metrics.costUsd === null ? t('panel.noPrice') : `$${metrics.costUsd.toFixed(4)}`
  const latency =
    metrics.firstTokenMs === null
      ? t('panel.latencyTotal', { total: metrics.totalMs })
      : t('panel.latency', { first: metrics.firstTokenMs, total: metrics.totalMs })
  return `${tokens} · ${cost} · ${latency}`
}

/**
 * 静默翻译要显式告诉用户「原文已经被换掉了」。
 *
 * 不提示的后果不是「少了一句文案」：用户会以为这只是一次预览，
 * 转头再手动粘贴一遍，于是同一段文字被翻译了两次（第二次往往还是译回原文）。
 * 反过来，如果写回被保护逻辑拦下了，也必须说清楚——否则用户会以为替换成功了。
 */
export function replaceNotice(state: PanelState, t: Translate): string | null {
  if (state.mode !== 'silentReplace') return null
  if (state.status === 'streaming') return t('panel.replaceOnDone')
  if (state.status === 'done') return state.replaced ? t('panel.sourceReplaced') : null
  // 出错时不显示「已替换」：写回失败或目标已变都不会改动原文。
  return null
}
