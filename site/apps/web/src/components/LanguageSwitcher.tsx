import { useEffect, useId, useRef, useState } from 'react'
import { LOCALE_LABEL, LOCALES } from '../config'
import type { Locale } from '../content/types'
import { LocaleLink } from '../lib/router'
import { ChevronDownIcon, GlobeIcon } from './icons'

/** Header 向下展开，Footer 向上展开；切换语言就地生效，地址不变。 */
export function LanguageMenu({
  locale,
  label,
  placement = 'bottom',
}: {
  locale: Locale
  label: string
  placement?: 'top' | 'bottom'
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
        className="btn-ghost h-10 gap-2 px-3 text-xs"
      >
        <GlobeIcon className="h-4 w-4" />
        <span className={placement === 'top' ? undefined : 'hidden sm:inline'}>
          {LOCALE_LABEL[locale]}
        </span>
        <ChevronDownIcon className={`h-3 w-3 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <ul
          id={panelId}
          aria-label={label}
          className={`absolute end-0 z-50 min-w-40 rounded-card border border-border bg-surface p-2 shadow-lg ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          {LOCALES.map((code) => (
            <li key={code}>
              <LocaleLink
                locale={code}
                current={code === locale}
                onNavigate={() => {
                  setOpen(false)
                  trigger.current?.focus()
                }}
                className={[
                  'block rounded-control px-3 py-2 text-sm transition-colors',
                  code === locale
                    ? 'bg-background-tertiary text-text-primary'
                    : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary',
                ].join(' ')}
              >
                {LOCALE_LABEL[code]}
              </LocaleLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
