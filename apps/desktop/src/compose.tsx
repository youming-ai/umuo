import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { WordCardView } from './components/WordCard'
import { type ComposeQueue, emptyQueue, onInput, onSettled } from './lib/compose-queue'
import {
  api,
  onComposePrefill,
  onTranslationEvents,
  type ProviderInfo,
  type StyleInfo,
} from './lib/ipc'
import { LANGUAGES } from './lib/languages'
import { initialState, reduce, statusLine } from './lib/panel-state'
import { initUi } from './lib/ui-bootstrap'
import './styles/app.css'
import { useT } from './lib/i18n'

/** 停止输入多久后触发翻译（PRD §5.3：500 ms）。 */
const DEBOUNCE_MS = 500

/**
 * 撰写窗（PRD §5.3）。
 *
 * 上写中文、下出译文。**输入框的内容是这个组件自己的状态**——
 * 它不能由 Rust 推来的 start 事件驱动，否则每翻译一次就会把用户正在打的字重置一遍。
 * 译文区则复用浮窗那套 reducer，两边语义一致。
 */
function Compose() {
  // 共享的 costLine/costLine 之类要走同一套文案，所以这里也要拿一个 t。
  const t = useT()
  const [input, setInput] = useState('')
  const [autoTranslate, setAutoTranslate] = useState(true)
  // 语言 / 模型 / 风格选择（PRD §5.3）。空值 = 用设置里的默认值。
  // 它们是**这一次撰写**的临时选择，不写回设置——用户在撰写窗里试一下别的风格，
  // 不该改掉设置里的默认风格。
  const [sourceLang, setSourceLang] = useState('')
  const [targetLang, setTargetLang] = useState('')
  const [providerId, setProviderId] = useState('')
  const [styleId, setStyleId] = useState('')
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [state, dispatch] = useReducer(reduce, initialState)
  // 回译单独一份状态：它与主译文共用同一套事件，混在一起的话回译结果会覆盖主译文，
  // ⌘Enter 提交出去的就成了原语言（审查 M16）。
  const [back, backDispatch] = useReducer(reduce, initialState)
  const [notice, setNotice] = useState<string | null>(null)

  // 调度状态放在 ref 里：它参与的是时序决策，不需要触发渲染。
  const queueRef = useRef<ComposeQueue>(emptyQueue)

  const send = useCallback(
    (text: string) => {
      void api
        .composeTranslate(text, {
          sourceLang: sourceLang || null,
          targetLang: targetLang || null,
          providerId: providerId || null,
          model: null,
          styleId: styleId || null,
        })
        .catch((error: unknown) => {
          dispatch({
            type: 'error',
            payload: {
              // 命令在登记请求之前就失败了，没有 id：算作当前这次的结果。
              requestId: null,
              message: String(error),
              actions: [],
              needsPermission: false,
              permission: null,
              source: null,
            },
          })
          // 命令直接失败（例如文本为空）时不会收到 done/error 事件，
          // 调度器必须在这里自己收尾，否则会永远停在 streaming 上再也不翻译。
          const decision = onSettled(queueRef.current)
          queueRef.current = decision.queue
        })
    },
    [sourceLang, targetLang, providerId, styleId],
  )
  // 事件回调通过 ref 调最新的 send：订阅只建一次。若把 send 放进订阅的依赖，
  // 每改一次下拉都会退订再重订，间隙里到达的 done 被丢掉，队列就永远卡在 streaming（审查 L22）。
  const sendRef = useRef(send)
  sendRef.current = send

  useEffect(() => {
    const textarea = document.querySelector('textarea')
    textarea?.focus()
    // 能选的语言/模型/风格各读一次；失败不影响撰写本身。
    void api
      .configuredProviders()
      .then(setProviders)
      .catch(() => {})
    void api
      .styleCatalog()
      .then(setStyles)
      .catch(() => {})
    void api
      .getSettings()
      .then((current) => setTargetLang(current.targetLang))
      .catch(() => {})
  }, [])

  useEffect(() => {
    // 浮窗的「在撰写窗打开」：把原文填进输入框。
    // 只填不直接翻译——交给上面那条防抖，避免同一次输入被翻两遍；
    // 用户关掉了自动翻译时也不该被这个入口绕过。
    let dispose: (() => void) | undefined
    let cancelled = false
    void onComposePrefill((payload) => setInput(payload.text)).then((unlisten) => {
      if (cancelled) unlisten()
      else dispose = unlisten
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void onTranslationEvents({
      onStart: (payload) => {
        dispatch({ type: 'start', payload })
        // 主译文换了，旧的回译就不再对应它；比这次更早的回译事件也一并作废。
        backDispatch({ type: 'reset', requestId: payload.requestId })
      },
      onDelta: (requestId, text) => dispatch({ type: 'delta', requestId, text }),
      // 撰写窗里打一个单词也会出词卡——它和划词走的是同一条判定规则。
      onCard: (requestId, payload) => dispatch({ type: 'card', requestId, payload }),
      onDone: (payload) => {
        dispatch({ type: 'done', payload })
        const decision = onSettled(queueRef.current)
        queueRef.current = decision.queue
        if (decision.start) sendRef.current(decision.start)
      },
      onError: (payload) => {
        dispatch({ type: 'error', payload })
        const decision = onSettled(queueRef.current)
        queueRef.current = decision.queue
        if (decision.start) sendRef.current(decision.start)
      },
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else dispose = unlisten
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  // 回译那条道：只更新回译区，不碰主译文，也不推动撰写的调度队列。
  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void onTranslationEvents(
      {
        onStart: (payload) => backDispatch({ type: 'start', payload }),
        onDelta: (requestId, text) => backDispatch({ type: 'delta', requestId, text }),
        onCard: (requestId, payload) => backDispatch({ type: 'card', requestId, payload }),
        onDone: (payload) => backDispatch({ type: 'done', payload }),
        onError: (payload) => backDispatch({ type: 'error', payload }),
      },
      'back',
    ).then((unlisten) => {
      if (cancelled) unlisten()
      else dispose = unlisten
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  // 防抖：停止输入 500ms 后才把文本交给调度器。
  useEffect(() => {
    if (!autoTranslate) return
    const timer = window.setTimeout(() => {
      const decision = onInput(queueRef.current, input)
      queueRef.current = decision.queue
      if (decision.start) send(decision.start)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [input, autoTranslate, send])

  const commit = useCallback(
    async (paste: boolean) => {
      const text = state.translation
      // 流式中途不提交：半截译文被粘进聊天框，撰写窗还随之收起（审查 M18）。
      if (state.status !== 'done' || !text.trim()) return
      try {
        await api.composeCommit(text, paste)
        setNotice(paste ? t('compose.copiedPasted') : t('compose.copied'))
      } catch (error) {
        setNotice(t('compose.submitFailed', { reason: String(error) }))
      }
    },
    // `t` 要在依赖里：它随界面语言变化，提示文案得跟着换。
    [t, state.translation, state.status],
  )

  // ⌘Enter 复制并关闭；⌘⇧Enter 复制并粘贴回上一个 App；Esc 收起。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void api.hideCompose()
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void commit(event.shiftKey)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commit])

  // 只有完成的译文才能提交或回译。回译与主译文同在撰写窗这一个窗口上，
  // 流式中途发起回译会把还没翻完的主译文顶掉。
  const settled = state.status === 'done' && state.translation.trim() !== ''

  const backTranslate = () => {
    void api
      .composeBackTranslate(state.source, state.translation)
      .catch((error: unknown) => setNotice(String(error)))
  }

  return (
    <div className="p-3 h-screen">
      <section className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-background-surface shadow-theme-lg">
        {/* 语言 / 模型 / 风格（PRD §5.3）。放在头部下方而不是塞进头部：
            头部已经有开关与按钮，再挤四个下拉会看不清。 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border-secondary px-3 py-1.5">
          <select
            className="rounded-control border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-secondary"
            value={sourceLang}
            title={t('compose.sourceLangHint')}
            onChange={(event) => setSourceLang(event.target.value)}
          >
            <option value="">{t('compose.autoDetect')}</option>
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-text-muted">→</span>
          <select
            className="rounded-control border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-secondary"
            value={targetLang}
            title={t('compose.targetLangHint')}
            onChange={(event) => setTargetLang(event.target.value)}
          >
            <option value="">{t('compose.bySettings')}</option>
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="rounded-control border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-secondary"
            value={providerId}
            title={t('compose.providerHint')}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="">{t('compose.defaultModel')}</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
          <select
            className="rounded-control border border-border bg-background px-1.5 py-0.5 text-[11px] text-text-secondary"
            value={styleId}
            title={t('compose.styleHint')}
            onChange={(event) => setStyleId(event.target.value)}
          >
            <option value="">{t('compose.defaultStyle')}</option>
            {styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </div>

        <header className="flex items-center justify-between gap-2 border-b border-border-secondary px-3 py-2">
          <span className="truncate text-xs text-text-muted">
            {statusLine(state, t) || t('compose.title')}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={autoTranslate}
                onChange={(event) => setAutoTranslate(event.target.checked)}
              />
              {t('compose.autoTranslate')}
            </label>
            <button
              type="button"
              className="umuo-pressable rounded-control px-2 py-0.5 text-xs text-text-secondary"
              onClick={() => void api.hideCompose()}
            >
              {t('compose.close')}
            </button>
          </div>
        </header>

        <textarea
          className="min-h-28 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm text-text-primary outline-none"
          placeholder={t('compose.placeholder')}
          value={input}
          spellCheck={false}
          onChange={(event) => setInput(event.target.value)}
        />

        <div className="min-h-28 flex-1 overflow-auto border-t border-border-secondary px-3 py-2">
          {state.status === 'streaming' && !state.translation && (
            <p className="text-sm text-text-tertiary">{t('compose.translating')}</p>
          )}
          {state.card ? (
            <WordCardView card={state.card} />
          ) : (
            state.translation && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                {state.translation}
              </p>
            )
          )}
          {state.status === 'error' && (
            <div className="rounded-control border border-error-border bg-error-surface px-2 py-2">
              <p className="text-xs text-error">{state.error}</p>
              <button
                type="button"
                className="umuo-pressable mt-2 rounded-control border border-border px-2 py-0.5 text-xs text-text-primary"
                onClick={() => send(input)}
              >
                {t('compose.retry')}
              </button>
            </div>
          )}
        </div>

        {back.status !== 'idle' && (
          <div className="max-h-24 overflow-auto border-t border-border-secondary px-3 py-2">
            <p className="text-[11px] text-text-muted">{t('compose.backTranslate')}</p>
            {back.status === 'streaming' && !back.translation && (
              <p className="text-xs text-text-tertiary">{t('compose.translating')}</p>
            )}
            {back.translation && (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
                {back.translation}
              </p>
            )}
            {back.status === 'error' && <p className="text-xs text-error">{back.error}</p>}
          </div>
        )}

        <footer className="flex items-center justify-between gap-2 border-t border-border-secondary px-3 py-2">
          <div className="flex gap-1">
            <FooterButton
              label={t('compose.copy')}
              disabled={!settled}
              onClick={() => void commit(false)}
            />
            <FooterButton
              label={t('compose.copyPaste')}
              disabled={!settled}
              onClick={() => void commit(true)}
            />
            <FooterButton
              label={t('compose.backTranslate')}
              disabled={!settled || !state.source}
              onClick={backTranslate}
            />
          </div>
          {notice && <span className="truncate text-xs text-text-muted">{notice}</span>}
        </footer>
      </section>
    </div>
  )
}

function FooterButton({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-xs text-text-primary disabled:opacity-40"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root mount point: compose.html is broken')
// 主题在首屏渲染前定好，避免「先渲染成另一套、再被纠正」的闪一下。
void initUi()
createRoot(container).render(<Compose />)
