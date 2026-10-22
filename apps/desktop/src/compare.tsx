import { useEffect, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  type CardState,
  cardMetrics,
  initialCompareState,
  reduceCompare,
} from './lib/compare-state'
import { hotkeyParts } from './lib/hotkey-format'
import { api, onCompareEvents, type Pick } from './lib/ipc'
import { initUi } from './lib/ui-bootstrap'
import './styles/app.css'
import { useT } from './lib/i18n'
import { applyOrder, moveItem } from './lib/reorder'

/**
 * 多模型对比窗（PRD §5.6）。
 *
 * 同一段文本并发发给最多 4 个模型，卡片横排。每张卡自己流式输出——
 * 谁先返回就先看到，这正是对比要回答的问题（不只是「谁译得好」，还有「谁快」）。
 */
function Compare() {
  const t = useT()
  // 拖出来的顺序（卡片下标数组）。空 = 用后端给的顺序。
  const [order, setOrder] = useState<number[]>([])
  // **拖拽源用 ref 而不是 state**：`drop` 处理器必须拿到"拖的是哪一张"，
  // 而 state 的更新要等下一次渲染提交——拖得快一点就会读到旧值（甚至 null），
  // 表现为"拖了没反应"。ref 是同步的，不依赖时序。
  const dragFrom = useRef<number | null>(null)
  // 只用来做拖拽中的视觉反馈，不参与判断。
  const [dragVisual, setDragVisual] = useState<number | null>(null)
  const [state, dispatch] = useReducer(reduceCompare, initialCompareState)
  const [picks, setPicks] = useState<Pick[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  // 空状态提示里的对比快捷键：读当前设置（窗口常驻，每次被唤出都重读——用户可能刚改过）。
  const [compareKeys, setCompareKeys] = useState<string | null>(null)
  useEffect(() => {
    const load = () =>
      void api
        .getSettings()
        .then((settings) => setCompareKeys(hotkeyParts(settings.compareHotkey).join('')))
        .catch(() => {})
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [])

  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void onCompareEvents({
      onStart: (payload) => {
        setPicked(null)
        dispatch({ type: 'start', payload })
      },
      onDelta: (payload) =>
        dispatch({
          type: 'delta',
          runId: payload.runId,
          index: payload.index,
          text: payload.text,
        }),
      onDone: (payload) => dispatch({ type: 'done', payload }),
      onError: (payload) => dispatch({ type: 'error', payload }),
      onNotice: (payload) => {
        setPicked(null)
        dispatch({ type: 'notice', payload })
      },
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else dispose = unlisten
    })
    void api.comparePicks().then(setPicks)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // 先取消再收起：对比窗背后是最多 4 路并发的真实计费请求，
        // 只把窗口藏起来的话，用户会继续为一个自己看不见的结果付费。
        // 取消只作用于对比窗自己这一轮：4 路一起停，浮窗与撰写窗的翻译不受影响。
        void api.cancelTranslation()
        void api.hideCompare()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelled = true
      dispose?.()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const pick = async (card: CardState) => {
    const updated = await api.recordComparePick(card.providerId, card.model)
    setPicks(updated)
    setPicked(`${card.providerId}:${card.model}`)
  }

  return (
    <div className="flex h-screen flex-col bg-background text-text-primary">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs text-text-muted">
            {state.cards.length > 0
              ? t('compare.summary', { count: state.cards.length, lang: state.targetLang })
              : t('compare.title')}
          </p>
          <p className="truncate text-sm text-text-secondary">
            {state.source || t('compare.waitingSelection')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {state.cards.length > 1 && (
            <span className="text-xs text-text-tertiary">
              {t('compare.reorderHint')}
              {t('compare.reorderKeyboard')}
            </span>
          )}
          {picks.length > 0 && (
            <span className="text-xs text-text-muted">
              {t('compare.topPick', {
                provider: picks[0].providerId,
                model: picks[0].model,
                count: picks[0].count,
              })}
            </span>
          )}
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-xs text-text-secondary"
            onClick={() => void api.hideCompare()}
          >
            {t('compare.close')}
          </button>
        </div>
      </header>

      {state.cards.length === 0 ? (
        <main className="flex flex-1 items-center justify-center px-6">
          <p className="max-w-md text-center text-sm text-text-tertiary">
            {compareKeys && (
              <>
                {t('compare.emptyHint', { keys: compareKeys })}
                <br />
              </>
            )}
            {state.notice ?? t('compare.needTwoKeys')}
          </p>
        </main>
      ) : (
        <main className="flex flex-1 overflow-x-auto p-3">
          {/* 用真的 <ul>/<li>，而不是给 div 挂 role：语义标签本身就带角色，
              而且无障碍工具对它的处理更可靠。 */}
          <ul className="flex flex-1 list-none gap-3 p-0">
            {applyOrder(state.cards, order).map((card, position) => (
              // 拖拽包装在卡片外层：`Card` 只关心怎么显示一张卡片，
              // 「卡片能被拖动」是这一排的编排。
              <li
                key={card.index}
                draggable
                className={[
                  'flex min-w-0 flex-1 cursor-grab active:cursor-grabbing',
                  dragVisual === position ? 'opacity-60' : '',
                ].join(' ')}
                onDragStart={() => {
                  dragFrom.current = position
                  setDragVisual(position)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  const from = dragFrom.current
                  dragFrom.current = null
                  setDragVisual(null)
                  if (from === null || from === position) return
                  // 用**当前显示顺序**做基准：用户看到的顺序才是他拖动时的预期。
                  const current = applyOrder(state.cards, order).map((item) => item.index)
                  setOrder(moveItem(current, from, position))
                }}
                onDragEnd={() => {
                  dragFrom.current = null
                  setDragVisual(null)
                }}
              >
                <Card
                  card={card}
                  picked={picked === `${card.providerId}:${card.model}`}
                  onPick={() => void pick(card)}
                  onMove={(direction) => {
                    const current = applyOrder(state.cards, order).map((item) => item.index)
                    const to = direction === 'left' ? position - 1 : position + 1
                    const moved = moveItem(current, position, to)
                    if (moved !== current) setOrder(moved)
                  }}
                />
              </li>
            ))}
          </ul>
        </main>
      )}
    </div>
  )
}

function Card({
  card,
  picked,
  onPick,
  onMove,
}: {
  card: CardState
  picked: boolean
  onPick: () => void
  onMove: (direction: 'left' | 'right') => void
}) {
  const t = useT()
  const metrics = cardMetrics(card, t)
  return (
    <section className="flex min-w-[240px] flex-1 flex-col overflow-hidden rounded-card border border-border bg-background-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border-secondary px-3 py-2">
        <span className="truncate text-xs font-medium text-text-primary" title={card.model}>
          {card.provider}
          <span className="ml-1 text-text-muted">{card.model}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {/* 显式的移动按钮：比隐藏的键盘快捷键更好——可发现、Tab 可达。
              拖拽仍是主要方式，这两个按钮是键盘与不愿拖拽者的通道。 */}
          <button
            type="button"
            aria-label={t('compare.moveLeft')}
            className="umuo-pressable rounded-control border border-border px-1.5 py-0.5 text-[11px] text-text-secondary"
            onClick={() => onMove('left')}
          >
            ◀
          </button>
          <button
            type="button"
            aria-label={t('compare.moveRight')}
            className="umuo-pressable rounded-control border border-border px-1.5 py-0.5 text-[11px] text-text-secondary"
            onClick={() => onMove('right')}
          >
            ▶
          </button>
          <button
            type="button"
            className={[
              'shrink-0 rounded-control border px-2 py-0.5 text-[11px]',
              picked ? 'border-success-border text-success' : 'border-border text-text-secondary',
            ].join(' ')}
            onClick={onPick}
          >
            {picked ? t('compare.picked') : t('compare.pick')}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-3 py-2">
        {card.status === 'waiting' && (
          <p className="text-sm text-text-tertiary">{t('compare.waiting')}</p>
        )}
        {card.text && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
            {card.text}
          </p>
        )}
        {card.status === 'streaming' && !card.text && (
          <p className="text-sm text-text-tertiary">{t('compare.translating')}</p>
        )}
        {card.metrics?.truncated && (
          <p className="mt-2 text-xs text-warning">{t('compare.truncated')}</p>
        )}
        {card.error && (
          <div className="mt-2 rounded-control border border-error-border bg-error-surface px-2 py-1.5">
            <p className="text-xs text-error">{card.error}</p>
          </div>
        )}
      </div>

      {metrics && (
        <footer className="border-t border-border-secondary px-3 py-1.5 text-[11px] text-text-muted">
          {metrics}
        </footer>
      )}

      {card.text && (
        <footer className="border-t border-border-secondary px-3 py-1.5">
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
            onClick={() => void api.copyText(card.text)}
          >
            {t('compare.copyThis')}
          </button>
        </footer>
      )}
    </section>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root mount point: compare.html is broken')
// 主题在首屏渲染前定好，避免「先渲染成另一套、再被纠正」的闪一下。
void initUi()
createRoot(container).render(<Compare />)
