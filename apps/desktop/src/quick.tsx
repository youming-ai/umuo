import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { useT } from './lib/i18n'
import { api, type QuickRecord, type QuickState } from './lib/ipc'
import { initUi } from './lib/ui-bootstrap'
import './styles/app.css'

/**
 * 菜单栏快捷面板（PRD §7.1）。
 *
 * 点托盘图标左键弹出，包含四件事：暂停/恢复、当前模型、快速输入、最近翻译。
 * 它是**要抢焦点**的窗口（与翻译浮窗相反）——因为「快速输入」得能打字。
 */
function Quick() {
  const t = useT()
  const [state, setState] = useState<QuickState | null>(null)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void api
      .quickState()
      .then(setState)
      .catch((error: unknown) => setNotice(t('quick.unavailable', { reason: String(error) })))
    // 这是一个可以反复开关的窗口：每次显示都重新拉一次状态，
    // 否则「当前模型」会一直停在上次打开时的值。
    const onFocus = () =>
      void api
        .quickState()
        .then(setState)
        .catch(() => {})
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [t])

  const translate = () => {
    if (draft.trim() === '') return
    void api.quickTranslate(draft).catch((error: unknown) => setNotice(String(error)))
  }

  return (
    <div className="flex h-screen flex-col bg-background text-text-primary">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold">umuo</span>
        <button
          type="button"
          className={[
            'umuo-pressable rounded-control border px-2 py-0.5 text-[11px]',
            state?.paused ? 'border-warning text-warning' : 'border-border text-text-secondary',
          ].join(' ')}
          onClick={() => {
            const next = !(state?.paused ?? false)
            void api
              .setPaused(next)
              .then((paused) => setState((prev) => (prev ? { ...prev, paused } : prev)))
          }}
        >
          {state?.paused ? t('quick.resume') : t('quick.pause')}
        </button>
      </header>

      {state?.paused && (
        <p className="border-b border-border px-3 py-1.5 text-[11px] text-warning">
          {t('quick.pausedHint')}
        </p>
      )}

      <section className="border-b border-border px-3 py-2">
        <p className="text-[11px] text-text-muted">{t('quick.currentModel')}</p>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-text-secondary">
            {state ? `${state.providerLabel} · ${state.model || t('quick.modelUnset')}` : '…'}
          </span>
          <button
            type="button"
            className="umuo-pressable shrink-0 rounded-control border border-border px-2 py-0.5 text-[11px] text-text-secondary"
            onClick={() => void api.openSettings()}
          >
            {t('quick.configure')}
          </button>
        </div>
      </section>

      <section className="border-b border-border px-3 py-2">
        <p className="text-[11px] text-text-muted">{t('quick.quickInput')}</p>
        <textarea
          className="mt-1 h-16 w-full resize-none rounded-control border border-border bg-background px-2 py-1 text-xs text-text-primary outline-none"
          placeholder={t('quick.inputPlaceholder')}
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              translate()
            }
          }}
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-text-tertiary">{t('quick.inputHint')}</span>
          <button
            type="button"
            className="umuo-pressable rounded-control border border-border bg-primary px-3 py-0.5 text-[11px] text-primary-foreground"
            disabled={draft.trim() === ''}
            onClick={translate}
          >
            {t('quick.translate')}
          </button>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <p className="text-[11px] text-text-muted">{t('quick.recent')}</p>
        {state && state.recent.length === 0 ? (
          <p className="mt-1 text-[11px] text-text-tertiary">{t('quick.noRecent')}</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {state?.recent.map((record) => (
              <RecentRow
                key={record.id}
                record={record}
                onCopied={() => setNotice(t('quick.copied'))}
                onFailed={(reason) => setNotice(reason)}
              />
            ))}
          </ul>
        )}
      </section>

      {notice && (
        <p className="border-t border-border px-3 py-1 text-[11px] text-text-muted">{notice}</p>
      )}
    </div>
  )
}

function RecentRow({
  record,
  onCopied,
  onFailed,
}: {
  record: QuickRecord
  onCopied: () => void
  onFailed: (reason: string) => void
}) {
  const t = useT()
  return (
    <li>
      <button
        type="button"
        className="umuo-pressable w-full rounded-control border border-border px-2 py-1 text-left"
        title={t('quick.copyTranslation')}
        onClick={() =>
          void api
            .copyText(record.translation)
            .then(onCopied)
            .catch((error: unknown) => onFailed(String(error)))
        }
      >
        <span className="block truncate text-[11px] text-text-tertiary">{record.source}</span>
        <span className="block truncate text-xs text-text-primary">{record.translation}</span>
      </button>
    </li>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('missing #root mount point: quick.html is broken')

void initUi()
createRoot(container).render(<Quick />)
