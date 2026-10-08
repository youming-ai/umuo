import { useId, useState } from 'react'
import { LOCALE_LABEL, LOCALES } from '../config'
import type { Locale } from '../content/types'
import { LocaleLink } from '../lib/router'
import { GlobeIcon } from './icons'

/** 导航栏里的语言下拉 */
export function LanguageMenu({
  locale,
  hash,
  label,
}: {
  locale: Locale
  hash: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        title={label}
        onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        className="btn-ghost h-10 gap-1 px-3 text-xs"
      >
        <GlobeIcon className="h-5 w-5" />
        <span className="hidden sm:inline">{LOCALE_LABEL[locale]}</span>
        <span className="sr-only">{label}</span>
      </button>
      {open ? (
        <ul
          id={panelId}
          className="absolute end-0 z-50 mt-2 min-w-40 rounded-card border border-border bg-surface p-2 shadow-theme-lg"
        >
          {LOCALES.map((code) => (
            <li key={code}>
              <LocaleLink
                locale={code}
                hash={hash}
                current={code === locale}
                onNavigate={() => setOpen(false)}
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

/** 页脚的完整语言列表，比下拉更好发现 */
export function LanguageLinks({
  locale,
  hash,
  label,
}: {
  locale: Locale
  hash: string
  label: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-sm text-text-tertiary">{label}</span>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {LOCALES.map((code) => (
          <li key={code}>
            <LocaleLink
              locale={code}
              hash={hash}
              current={code === locale}
              className={[
                'text-sm transition-colors',
                code === locale
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {LOCALE_LABEL[code]}
            </LocaleLink>
          </li>
        ))}
      </ul>
    </div>
  )
}
