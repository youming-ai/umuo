import { useState } from 'react'
import { MACOS_DOWNLOAD_URL } from '../config'
import type { Locale, SiteContent } from '../content/types'
import { footerTarget } from '../lib/links'
import { SiteLink } from '../lib/router'
import { ExternalLinkIcon, LogoMark } from './icons'
import { LanguageLinks } from './LanguageSwitcher'
import { NotifyForm } from './NotifyForm'

/**
 * 底部 CTA + 页脚。CTA 按钮跟随发布状态：安装包可用时是下载链接，
 * 否则是订阅上线通知（与首屏一致，不放假下载按钮）。
 * 隐私政策 / 服务条款尚未撰写，页脚按「即将上线」呈现，不留死链。
 */
export function Footer({
  content,
  locale,
  hash,
}: {
  content: SiteContent
  locale: Locale
  hash: string
}) {
  const [notifyOpen, setNotifyOpen] = useState(false)
  const { footer } = content

  return (
    <>
      <section id="cta" aria-labelledby="cta-title" className="landing-section">
        <div className="container-page">
          <div className="cta">
            <h2 id="cta-title" className="section-title">
              {footer.ctaTitle}
            </h2>
            <p className="lead mt-4">{footer.ctaDescription}</p>
            <div className="mt-8 flex">
              {MACOS_DOWNLOAD_URL ? (
                <a href={MACOS_DOWNLOAD_URL} download className="btn-primary">
                  {footer.ctaDownload}
                </a>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  aria-expanded={notifyOpen}
                  onClick={() => setNotifyOpen((current) => !current)}
                >
                  {footer.ctaNotify}
                </button>
              )}
            </div>
            {notifyOpen && !MACOS_DOWNLOAD_URL ? (
              <div className="text-left">
                <NotifyForm
                  content={content.hero.notify}
                  platformName="macOS"
                  onClose={() => setNotifyOpen(false)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <footer className="border-border border-t py-14">
        <div className="container-page grid gap-10 md:grid-cols-4">
          <div>
            <p className="flex items-center gap-2 font-heading text-lg font-semibold text-text-primary">
              <LogoMark className="h-7 w-7 u-accent-text" />
              umuo
            </p>
            <p className="mt-4 text-sm text-text-tertiary">{footer.copyright}</p>
          </div>

          {footer.columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="font-heading text-sm font-semibold text-text-primary">
                {column.title}
              </h2>
              <ul className="mt-4 flex flex-col gap-3">
                {column.links.map((link) => {
                  const target = footerTarget(link.kind)
                  if (target.kind === 'soon') {
                    return (
                      <li key={link.kind} className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-text-muted">{link.label}</span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                          {footer.comingSoon}
                        </span>
                      </li>
                    )
                  }
                  if (target.kind === 'external') {
                    return (
                      <li key={link.kind}>
                        <a
                          href={target.href}
                          target={target.href.startsWith('mailto:') ? undefined : '_blank'}
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
                        >
                          {link.label}
                          {target.href.startsWith('mailto:') ? null : (
                            <ExternalLinkIcon className="h-3.5 w-3.5" />
                          )}
                        </a>
                      </li>
                    )
                  }
                  return (
                    <li key={link.kind}>
                      <SiteLink
                        locale={locale}
                        hash={target.hash}
                        className="text-sm text-text-secondary transition-colors hover:text-text-primary"
                      >
                        {link.label}
                      </SiteLink>
                    </li>
                  )
                })}
              </ul>
            </nav>
          ))}
        </div>

        <div className="container-page mt-12">
          <div className="flex flex-col gap-4 border-border border-t pt-8">
            <LanguageLinks locale={locale} hash={hash} label={footer.languageLabel} />
            <p className="max-w-3xl text-xs leading-relaxed text-text-tertiary">
              {footer.legalNote}
            </p>
          </div>
        </div>
      </footer>
    </>
  )
}
