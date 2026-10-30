import { type ReactNode, useId, useState } from 'react'
import { MACOS_DOWNLOAD_URL, SITE_URL } from '../config'
import type { PlatformCard } from '../content/types'
import { DownloadIcon } from './icons'

/**
 * 下载按钮，里面带一枚状态标签（如「预览版」）。安装包地址未配置时不放假链接：
 * 按钮保持实心但不可点，读起来是「还没发布」而不是「坏了」。
 */
export function DownloadButton({
  label,
  status,
  describedBy,
  className = '',
  onDownload,
}: {
  label: string
  status: string
  describedBy?: string
  className?: string
  onDownload?: () => void
}) {
  const classes = `btn-primary ${className}`.trim()
  if (MACOS_DOWNLOAD_URL) {
    return (
      // 不加 download 属性：Safari 会拿地址最后一段（macos）当文件名，压过服务器给的 Content-Disposition
      <a
        href={MACOS_DOWNLOAD_URL}
        className={classes}
        aria-label={`${label} ${status}`}
        aria-describedby={describedBy}
        onClick={onDownload}
      >
        <DownloadIcon className="h-4 w-4" />
        {label}
        <span className="status-tag">{status}</span>
      </a>
    )
  }
  return (
    <button
      type="button"
      disabled
      aria-label={`${label} ${status}`}
      aria-describedby={describedBy}
      className={`${classes} is-pending`}
    >
      <DownloadIcon className="h-4 w-4" />
      {label}
      <span className="status-tag">{status}</span>
    </button>
  )
}

/**
 * 首页与定价页共用的下载区：按钮 + 系统要求 + 未公证预览版的放行说明，两页说法一致。
 * 点了下载之后，要求与放行说明就地换成「接下来」三步（拖进应用程序、放行、填 Key）：访客最容易放弃的那几步在站外，
 * 至少走之前把路标给全。
 * 触屏设备拿不到能用的安装包，换成「请在 Mac 上打开」与复制网址；两套都预渲染，由 CSS 按指针类型显示一套。
 * 购买开放后，桌面版在下载按钮旁多一个「购买」按钮：许可证要在 Mac 上激活，触屏版不放。
 */
export function DownloadPanel({
  platform,
  purchase,
  aside,
}: {
  platform: PlatformCard
  /** 购买开放后放在下载按钮旁的「购买」按钮（见 config.ts 的 PURCHASE_OPEN）；触屏版不放 */
  purchase?: ReactNode
  aside?: ReactNode
}) {
  const noteId = useId()
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [started, setStarted] = useState(false)

  return (
    <div className="download-panel">
      <div className="download-desktop">
        <div className="download-actions">
          <DownloadButton
            label={platform.actionLabel}
            status={platform.statusLabel}
            describedBy={noteId}
            className="btn-solid"
            onDownload={() => setStarted(true)}
          />
          {purchase}
          {aside}
        </div>
        {started ? (
          <div className="download-next" aria-live="polite">
            <p className="download-next-title">{platform.afterDownload.title}</p>
            <ol>
              {platform.afterDownload.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : (
          <>
            <p id={noteId} className="download-requirement">
              {platform.requirement}
            </p>
            {MACOS_DOWNLOAD_URL ? <p className="download-note">{platform.note}</p> : null}
          </>
        )}
      </div>
      <div className="download-touch">
        <p className="download-mobile-note">{platform.mobileNote}</p>
        <div className="download-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const clipboard = navigator.clipboard
              if (!clipboard) return setCopy('failed')
              clipboard.writeText(SITE_URL).then(
                () => setCopy('copied'),
                () => setCopy('failed'),
              )
            }}
          >
            <span aria-live="polite">
              {copy === 'copied' ? platform.copied : platform.copyLink}
            </span>
          </button>
          {aside}
        </div>
        {copy === 'failed' ? (
          <p className="download-note" role="status">
            {platform.copyFailed}
          </p>
        ) : null}
      </div>
    </div>
  )
}
