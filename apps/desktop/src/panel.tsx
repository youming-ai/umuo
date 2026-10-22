import { useEffect, useReducer, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { WordCardView } from './components/WordCard'
import { useT } from './lib/i18n'
import { api, onTranslationEvents, type ProviderInfo, type StyleInfo } from './lib/ipc'
import {
  costLine,
  favoriteTranslation,
  initialState,
  reduce,
  replaceNotice,
  retranslateMode,
  statusLine,
} from './lib/panel-state'
import { initUi } from './lib/ui-bootstrap'
import './styles/app.css'

/**
 * 划词翻译浮窗。
 *
 * 它不做任何决策——语言、模型、费用都来自 Rust 侧推过来的事件，
 * 这里只负责把状态渲染出来，以及把「用户想干什么」变成一次命令调用。
 */
export function Panel() {
  const t = useT()
  const [state, dispatch] = useReducer(reduce, initialState)
  // 钉住是**运行时窗口状态**（Rust 侧的 AtomicBool），不是设置项：
  // 它描述的是「这一个浮窗现在要不要赖着不走」，重启后回到默认。
  const [pinned, setPinned] = useState(false)
  // 浮窗的操作（PRD §5.2）：能换的模型、能换的风格、这条是否已收藏、一次性提示。
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [favorited, setFavorited] = useState(false)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  // OCR 结果窗的原文可以改了再翻（PRD §5.5）。识别错字是常态，
  // 逼用户重新框选一次是最没必要的摩擦。
  const [draft, setDraft] = useState('')

  useEffect(() => {
    // 读一次初始值：浮窗是常驻窗口，Rust 侧的钉住状态可能在上一次显示时就被改过。
    void api
      .panelPinned()
      .then(setPinned)
      .catch(() => {})
    // 能换的模型与风格各读一次。失败不该让浮窗显示不出来——它们只是可选操作。
    void api
      .configuredProviders()
      .then(setProviders)
      .catch(() => {})
    void api
      .styleCatalog()
      .then(setStyles)
      .catch(() => {})
  }, [])

  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    void onTranslationEvents({
      onStart: (payload) => {
        dispatch({ type: 'start', payload })
        setDraft(payload.text)
        setActionNotice(null)
        // 这段是否已收藏：一次查询，避免按钮显示错的初始状态。
        void api
          .favoritesStatus([payload.text])
          .then(([value]) => setFavorited(Boolean(value)))
          .catch(() => setFavorited(false))
      },
      onDelta: (requestId, text) => dispatch({ type: 'delta', requestId, text }),
      onCard: (requestId, payload) => dispatch({ type: 'card', requestId, payload }),
      onDone: (payload) => dispatch({ type: 'done', payload }),
      onError: (payload) => dispatch({ type: 'error', payload }),
    }).then((unlisten) => {
      // 组件在订阅完成前就卸载时，立即退订，否则会留下悬挂的监听器
      if (cancelled) unlisten()
      else dispose = unlisten
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 翻译中按 Esc = 取消请求；空闲时按 Esc = 收起浮窗
      if (state.status === 'streaming') void api.cancelTranslation()
      else void api.hidePanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state.status])

  const metrics = costLine(state.metrics, t)
  // 抽成局部 const：`useReducer` 的 state 在闭包里收窄不到，
  // 直接用 `state.translation!` 会引入非空断言（lint 也会拦）。
  const translation = state.translation
  // 流式中途的半截译文不能拿去复制或替换（审查 M18）；出错时的译文可能是上一段的残留
  // 或被取消的半段，替换进原文同样不对（审查 M15）。所以替换只在完成后出现。
  const settled = state.status === 'done'
  // 只有 OCR 结果窗的原文可编辑：划词路径里改原文没有意义
  //（那段文字还在用户自己的文档里，改了也不会同步回去）。
  const editableSource = state.mode === 'ocr'
  const notice = replaceNotice(state, t)

  return (
    // `overflow-auto` 是兜底：浮窗可被拖到 320×150，而译文可能很长——
    // 没有它的话超出的部分会被直接裁掉，用户既看不到也滚不到。
    <div className="h-screen overflow-auto p-2">
      <section
        className="rounded-card border border-border bg-background-surface shadow-theme-lg overflow-hidden"
        aria-label={t('panel.resultAria')}
      >
        {/*
          `data-tauri-drag-region` 让这块区域可以拖动整窗（PRD §5.2「可拖动」）。
          只有直接命中该属性的元素才触发拖动，所以里面的按钮照常可点。
          注意花括号：JSX 里的 `//` 不是注释，会被当成文本渲染出来（踩过一次）。
        */}
        <header
          data-tauri-drag-region
          className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border-secondary"
        >
          <span data-tauri-drag-region className="text-xs text-text-muted truncate">
            {statusLine(state, t)}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {state.translation && state.status !== 'streaming' && (
              <button
                type="button"
                className="umuo-pressable rounded-control px-2 py-0.5 text-xs text-text-secondary"
                onClick={() => void api.copyText(state.translation)}
              >
                {t('panel.copy')}
              </button>
            )}
            <button
              type="button"
              className={[
                'umuo-pressable rounded-control px-2 py-0.5 text-xs',
                pinned ? 'text-success' : 'text-text-secondary',
              ].join(' ')}
              title={t('panel.pinHint')}
              onClick={() => void api.panelSetPinned(!pinned).then(setPinned)}
            >
              {pinned ? t('panel.pinned') : t('panel.pin')}
            </button>
            <button
              type="button"
              className="umuo-pressable rounded-control px-2 py-0.5 text-xs text-text-secondary"
              onClick={() => void api.openSettings()}
            >
              {t('panel.settings')}
            </button>
            <button
              type="button"
              className="umuo-pressable rounded-control px-2 py-0.5 text-xs text-text-secondary"
              onClick={() => void api.hidePanel()}
              aria-label={t('panel.collapseAria')}
            >
              {t('panel.collapse')}
            </button>
          </div>
        </header>
        <div className="max-h-[46vh] overflow-auto px-3 py-2">
          {state.source &&
            (editableSource ? (
              <div className="mb-2">
                <textarea
                  className="max-h-24 w-full resize-none rounded-control border border-border bg-background px-2 py-1 text-xs leading-relaxed text-text-secondary"
                  value={draft}
                  spellCheck={false}
                  aria-label={t('panel.ocrEditAria')}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-text-muted">{t('panel.ocrEditHint')}</span>
                  {draft.trim() !== '' && draft !== state.source && (
                    <button
                      type="button"
                      className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-[11px] text-primary"
                      onClick={() => {
                        // 带上 ocr 模式：否则重译结果回来时模式变成 selection，
                        // 原文立刻又变回只读——这个功能就只能用一次。
                        void api
                          .retranslate(draft, null, null, null, 'ocr')
                          .catch((error: unknown) => setActionNotice(String(error)))
                      }}
                    >
                      {t('panel.retranslate')}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="mb-2 text-xs leading-relaxed text-text-muted line-clamp-3">
                {state.source}
              </p>
            ))}

          {state.status === 'streaming' && !state.translation && (
            <p className="text-sm text-text-tertiary">{t('panel.translating')}</p>
          )}

          {state.card ? (
            <WordCardView card={state.card} />
          ) : (
            state.translation && (
              <p className="text-sm leading-relaxed text-text-primary whitespace-pre-wrap">
                {state.translation}
              </p>
            )
          )}

          {state.status === 'error' && (
            <div className="rounded-control border border-error-border bg-error-surface px-2 py-2">
              <p className="text-xs text-error">
                {state.needsPermission && !state.error ? t('panel.noPermission') : state.error}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {state.needsPermission ? (
                  <ActionButton
                    label={t('panel.actionOpenSystemSettings')}
                    // 屏幕录制与辅助功能是两个不同的面板。送去错的那个，
                    // 用户照做之后功能仍然不可用——比不提示更糟。
                    onClick={() =>
                      void (state.permission === 'screenRecording'
                        ? api.openScreenRecordingSettings()
                        : api.openAccessibilitySettings())
                    }
                  />
                ) : (
                  <>
                    {state.errorActions.includes('retry') && (
                      <ActionButton
                        label={t('panel.actionRetry')}
                        // OCR 结果窗的重试要保住 ocr 模式（审查 L21），走 retranslate；
                        // 划词路径仍走 translateText，与首次翻译一致。
                        onClick={() =>
                          void (retranslateMode(state) === 'ocr'
                            ? api.retranslate(state.source, null, null, null, 'ocr')
                            : api.translateText(state.source))
                        }
                      />
                    )}
                    {(state.errorActions.includes('switch_model') ||
                      state.errorActions.includes('open_model_settings') ||
                      state.errorActions.includes('use_local_model')) && (
                      <ActionButton
                        label={t('panel.actionOpenModelSettings')}
                        onClick={() => void api.openSettings()}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        {state.warning && (
          // 翻译是成功的，只是结果来自另一个供应商。所以是提示而不是错误块。
          <p className="border-t border-border-secondary px-3 py-1.5 text-[11px] text-warning">
            {state.warning}
          </p>
        )}
        {(state.source || state.translation) && (
          <div className="flex gap-1 border-t border-border-secondary px-3 py-1.5">
            {state.source && <SpeakButton label={t('panel.speakSource')} text={state.source} />}
            {state.translation && (
              <SpeakButton label={t('panel.speakTranslation')} text={state.translation} />
            )}
            <button
              type="button"
              className="umuo-pressable rounded-control px-2 py-0.5 text-[11px] text-text-secondary"
              onClick={() => void api.stopSpeaking()}
            >
              {t('panel.stop')}
            </button>
          </div>
        )}

        {(state.source || state.translation) && (
          <div className="flex flex-wrap items-center gap-1 border-t border-border-secondary px-3 py-1.5">
            {translation && settled && (
              <button
                type="button"
                className="umuo-pressable rounded-control px-2 py-0.5 text-[11px] text-text-secondary"
                title={t('panel.replaceHint')}
                onClick={() =>
                  void api
                    .replaceSource(translation)
                    .then(() => setActionNotice(t('panel.replaced')))
                    .catch((error: unknown) =>
                      setActionNotice(t('panel.replaceFailed', { reason: String(error) })),
                    )
                }
              >
                {t('panel.replace')}
              </button>
            )}
            <button
              type="button"
              className={[
                'umuo-pressable rounded-control px-2 py-0.5 text-[11px]',
                favorited ? 'text-success' : 'text-text-secondary',
              ].join(' ')}
              // 流式中途收藏会存下半截译文（审查 L23）
              disabled={state.status === 'streaming'}
              onClick={() =>
                void api
                  .favoriteToggle(state.source, favoriteTranslation(state))
                  .then(setFavorited)
                  .catch((error: unknown) => setActionNotice(String(error)))
              }
            >
              {favorited ? t('panel.favorited') : t('panel.favorite')}
            </button>
            <button
              type="button"
              className="umuo-pressable rounded-control px-2 py-0.5 text-[11px] text-text-secondary"
              onClick={() =>
                void api
                  .openComposeWith(state.source, state.translation)
                  .catch((error: unknown) => setActionNotice(String(error)))
              }
            >
              {t('panel.compose')}
            </button>

            {/* 换模型 / 换风格：值是空的——它们是**动作**而不是当前状态的显示。
                浮窗并不知道这次用的是哪家供应商的 id（事件里只有显示名），
                与其显示一个可能是错的状态，不如让它们只负责触发。 */}
            <select
              className="ml-auto rounded-control border border-border bg-background px-1 py-0.5 text-[11px] text-text-secondary"
              value=""
              onChange={(event) => {
                const provider = providers.find((item) => item.id === event.target.value)
                if (!provider) return
                setActionNotice(t('panel.switchingModel', { provider: provider.label }))
                void api
                  .retranslate(
                    state.source,
                    provider.id,
                    provider.defaultModel,
                    null,
                    retranslateMode(state),
                  )
                  .catch((error: unknown) => setActionNotice(String(error)))
              }}
            >
              <option value="">{t('panel.switchModel')}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
            <select
              className="rounded-control border border-border bg-background px-1 py-0.5 text-[11px] text-text-secondary"
              value=""
              onChange={(event) => {
                if (!event.target.value) return
                setActionNotice(t('panel.switchingStyle'))
                void api
                  .retranslate(state.source, null, null, event.target.value, retranslateMode(state))
                  .catch((error: unknown) => setActionNotice(String(error)))
              }}
            >
              <option value="">{t('panel.switchStyle')}</option>
              {styles.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {actionNotice && (
          <p className="border-t border-border-secondary px-3 py-1 text-[11px] text-text-muted">
            {actionNotice}
          </p>
        )}
        {notice && (
          <p
            className={[
              'border-t border-border-secondary px-3 py-1.5 text-xs',
              state.replaced ? 'text-success' : 'text-text-tertiary',
            ].join(' ')}
          >
            {notice}
          </p>
        )}
        {metrics && (
          <footer className="px-3 py-1.5 border-t border-border-secondary text-[11px] text-text-muted">
            {metrics}
          </footer>
        )}
      </section>
    </div>
  )
}

/**
 * 朗读按钮。语言由 Rust 侧从文本推断，前端不传——同一段文本在浮窗与撰写窗
 * 必须用同一个发音人。
 */
function SpeakButton({ label, text }: { label: string; text: string }) {
  // 组件各自取一次 t：`Panel` 里的那个不在这个作用域里。
  const t = useT()
  const [failed, setFailed] = useState(false)
  return (
    <button
      type="button"
      className={[
        'umuo-pressable rounded-control px-2 py-0.5 text-[11px]',
        failed ? 'text-error' : 'text-text-secondary',
      ].join(' ')}
      onClick={() => {
        // 朗读失败（没有 say、没有该语言的发音人）要说出来，
        // 否则用户只会觉得「这个按钮没反应」。
        setFailed(false)
        void api.speakText(text).catch(() => setFailed(true))
      }}
    >
      {failed ? t('panel.speakFailed', { label }) : label}
    </button>
  )
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="umuo-pressable rounded-control border border-border px-2 py-0.5 text-xs text-text-primary"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root mount point: panel.html is broken')
// 主题在首屏渲染前定好，避免「先渲染成另一套、再被纠正」的闪一下。
void initUi()
createRoot(container).render(<Panel />)
