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
  /**
   * 正在显示的是哪一次请求。0 = 还没有过请求（后端的 id 从 1 起）。
   *
   * 增量、词卡、完成只认这个 id；被顶掉的旧请求迟到的事件一律丢掉——
   * 否则换模型重译时两路译文会交错拼在一起（审查 M1）。
   */
  requestId: number
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
  requestId: 0,
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
  | { type: 'delta'; requestId: number; text: string }
  | { type: 'card'; requestId: number; payload: WordCard }
  | { type: 'done'; payload: DonePayload }
  | { type: 'error'; payload: ErrorPayload }
  /**
   * 清空回初始状态。`requestId` 是新的下限：id 不大于它的事件都算过期。
   * 不给就沿用当前的——清空不该让已经被顶掉的旧请求重新「复活」。
   */
  | { type: 'reset'; requestId?: number }

export function reduce(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'start':
      // 比当前还旧的 start：那次请求在发出 start 之前就已经被新请求顶掉了。
      if (action.payload.requestId < state.requestId) return state
      // 每次 start 都整体重置：上一次翻译的译文绝不能残留进这一次。
      return {
        ...initialState,
        requestId: action.payload.requestId,
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
      if (action.requestId !== state.requestId || state.status !== 'streaming') return state
      return { ...state, translation: state.translation + action.text }

    case 'card':
      // 词卡与增量互斥（后端在词卡模式下抑制了 delta），所以直接覆盖。
      if (action.requestId !== state.requestId || state.status !== 'streaming') return state
      return { ...state, card: action.payload }

    case 'done':
      if (action.payload.requestId !== state.requestId || state.status !== 'streaming') return state
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

    case 'error': {
      const requestId = action.payload.requestId ?? state.requestId
      // 被顶掉的旧请求报的错（典型是「已取消」）：用户已经在看新的那次了。
      if (requestId < state.requestId) return state
      // 当前这次出错：保留已经流出来的半段译文，它对用户仍有价值。
      // 更新的请求在 start 之前就失败了（取词失败、黑名单、缺 Key…）：先清空，
      // 否则上一次的原文和译文还挂在下面，「替换原文」会把旧译文写进新的应用（审查 M15）。
      // 原文换成出错的这次请求自己的（有的话），「重试」才有东西可翻。
      const base =
        requestId === state.requestId
          ? state
          : { ...initialState, requestId, source: action.payload.source ?? '' }
      return {
        ...base,
        status: 'error',
        error: action.payload.message,
        errorActions: action.payload.actions,
        needsPermission: action.payload.needsPermission,
        permission: action.payload.permission,
      }
    }

    case 'reset':
      // 下限只升不降：一个迟到的旧 start 触发的 reset 不能把已经作废的请求放回来。
      return { ...initialState, requestId: Math.max(state.requestId, action.requestId ?? 0) }
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

/**
 * 重试 / 换模型 / 换风格要带上的模式。
 *
 * 只有 ocr 需要保住：OCR 结果窗的原文可编辑（PRD §5.5），丢了模式就退回 selection，
 * 原文立刻变回只读（审查 L21）。其余模式交给后端默认值（selection）——
 * 静默替换、撰写都有自己的入口，不该从浮窗重放。
 */
export function retranslateMode(state: PanelState): 'ocr' | null {
  return state.mode === 'ocr' ? 'ocr' : null
}

/**
 * 收藏时要存的译文。流式中途不让收藏（半截译文），词卡模式没有纯文本译文——
 * 两种情况都存 null，而不是存空串或半截（审查 L23）：历史窗「复制」会把空串原样写进剪贴板。
 */
export function favoriteTranslation(state: PanelState): string | null {
  if (state.status === 'streaming') return null
  return state.translation || null
}
