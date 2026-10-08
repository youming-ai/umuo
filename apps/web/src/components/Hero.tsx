import { type CSSProperties, useId, useState } from 'react'
import { MACOS_DOWNLOAD_URL } from '../config'
import type { Locale, SiteContent } from '../content/types'
import { DownloadIcon } from './icons'
import { LanguageGrid } from './LanguageGrid'
import { NotifyForm } from './NotifyForm'

export const DEMO_SOURCE = 'The quick brown fox jumps over the lazy dog.'

/**
 * 首屏：多语言网格衬托居中文案，下方展示选中即译；背景不影响下载与订阅操作。
 * 主按钮是「下载 macOS 版」；安装包还没发布（MACOS_DOWNLOAD_URL 为 null），
 * 所以此刻点击打开的是订阅通知面板，而不是一个假下载链接。
 */
export function Hero({ content }: { content: SiteContent; locale: Locale }) {
  const [notifyOpen, setNotifyOpen] = useState(false)
  const { hero } = content
  const headingId = useId()

  const macos = hero.platforms.find((platform) => platform.id === 'macos')
  const macosNoteId = 'platform-macos-note'

  return (
    <section id="download" aria-labelledby={headingId} className="hero-stage">
      <LanguageGrid />
      <div className="hero container-page">
        <div className="hero-copy">
          <p className="text-sm text-text-tertiary">{hero.badge}</p>
          <h1 id={headingId} className="hero-title mt-4">
            {hero.title}
          </h1>
          <p className="lead mt-5">{hero.subtitle}</p>

          {macos ? (
            <div className="mt-9">
              <div className="hero-actions flex flex-wrap items-center gap-3">
                {MACOS_DOWNLOAD_URL ? (
                  <a
                    href={MACOS_DOWNLOAD_URL}
                    download
                    className="btn-primary"
                    aria-describedby={macosNoteId}
                  >
                    <DownloadIcon className="h-4 w-4" />
                    {macos.actionLabel}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNotifyOpen(true)}
                    aria-describedby={macosNoteId}
                    aria-expanded={notifyOpen}
                    className="btn-primary"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    {macos.actionLabel}
                  </button>
                )}
              </div>
              <p id={macosNoteId} className="mt-3 text-sm text-text-tertiary">
                {macos.requirement}
              </p>
            </div>
          ) : null}

          {notifyOpen && macos ? (
            <div className="mt-8">
              <NotifyForm
                content={hero.notify}
                platformName={macos.name}
                onClose={() => setNotifyOpen(false)}
              />
            </div>
          ) : null}
        </div>

        <figure aria-label={hero.demo.label} className="hero-page">
          <p lang="en" className="source-text">
            Keep your focus. <mark className="selection">{DEMO_SOURCE}</mark> Everything else can
            wait.
          </p>
          <div className="mt-6 flex items-center gap-1.5" aria-hidden="true">
            <kbd className="keycap">⌥</kbd>
            <kbd className="keycap">D</kbd>
          </div>
          <p className="translation-text mt-4">
            <span className="sr-only">{hero.demo.translation}</span>
            {/* 首屏唯一的自发动效（网格高光只跟随指针）：译文逐字流式出现。纯 CSS 延迟，服务端与客户端渲染一致；减少动态效果时直接显示全文 */}
            <span aria-hidden="true">
              {[...hero.demo.translation].map((char, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 字符序列固定，下标就是身份
                <span key={index} className="stream-char" style={{ '--i': index } as CSSProperties}>
                  {char}
                </span>
              ))}
              <span className="stream-caret" />
            </span>
          </p>
          <figcaption className="mt-5 text-xs text-text-tertiary">{hero.demo.metrics}</figcaption>
        </figure>
      </div>
    </section>
  )
}
