import { type ReactNode, useEffect, useId, useState } from 'react'
import { MACOS_DOWNLOAD_URL, SITE_URL } from '../config'
import type { PlatformCard } from '../content/types'
import { enterIndex } from '../lib/motion'
import { DownloadIcon } from './icons'

/**
 * 下载按钮，里面带一枚状态标签（如「预览版」）。安装包地址未配置时不放假链接：
 * 按钮保持实心但不可点，读起来是「还没发布」而不是「坏了」。
 */
export function DownloadButton({
  label,
  status,
  describedBy,
  onDownload,
}: {
  label: string
  status: string
  describedBy?: string
  onDownload?: () => void
}) {
  if (MACOS_DOWNLOAD_URL) {
    return (
      // 不加 download 属性：Safari 会拿地址最后一段（macos）当文件名，压过跳转后 GitHub 给的 Content-Disposition
      <a
        href={MACOS_DOWNLOAD_URL}
        className="btn-solid"
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
      className="btn-solid is-pending"
    >
      <DownloadIcon className="h-4 w-4" />
      {label}
      <span className="status-tag">{status}</span>
    </button>
  )
}

/**
 * 首页的下载区：按钮 + 系统要求 + 未公证预览版的放行说明。
 * 点了下载之后，要求与放行说明就地换成「接下来」三步（拖进应用程序、放行、填 Key）：访客最容易放弃的那几步在站外，
 * 至少走之前把路标给全。
 * 触屏设备拿不到能用的安装包，换成「请在 Mac 上打开」与复制网址；两套都预渲染，由 CSS 按指针类型显示一套。
 */
export function DownloadPanel({ platform }: { platform: PlatformCard }) {
  const noteId = useId()
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  // 每成功复制一次加一：已是「已复制」时再按，状态没变，靠它重置计时并重播对勾
  const [copyRun, setCopyRun] = useState(0)
  const [started, setStarted] = useState(false)

  // 「已复制」停两秒再回到原样；期间再按一次会重新复制，两秒从头算。失败提示留着，不自动收起
  // biome-ignore lint/correctness/useExhaustiveDependencies: copyRun 只用来在重新复制时重启计时
  useEffect(() => {
    if (copy !== 'copied') return
    const timer = window.setTimeout(() => setCopy('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [copy, copyRun])

  return (
    <div className="download-panel">
      <div className="download-desktop">
        <div className="download-actions">
          <DownloadButton
            label={platform.actionLabel}
            status={platform.statusLabel}
            // 点了之后系统要求那段换成「接下来」三步，描述随之撤掉，不能指向已经不在的元素
            describedBy={started ? undefined : noteId}
            onDownload={() => setStarted(true)}
          />
        </div>
        {started ? (
          <div className="download-next" aria-live="polite">
            <p className="download-next-title" style={enterIndex(0)}>
              {platform.afterDownload.title}
            </p>
            <ol>
              {platform.afterDownload.steps.map((step, index) => (
                <li key={step} style={enterIndex(index + 1)}>
                  {step}
                </li>
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
            className="btn-secondary copy-button"
            data-state={copy}
            onClick={() => {
              const clipboard = navigator.clipboard
              if (!clipboard) return setCopy('failed')
              clipboard.writeText(SITE_URL).then(
                () => {
                  setCopy('copied')
                  setCopyRun((run) => run + 1)
                },
                () => setCopy('failed'),
              )
            }}
          >
            <span className="copy-icon" aria-hidden="true">
              <CopyGlyph className="copy-icon-idle" />
              {/* key 随复制次数变：再按一次时对勾重新进场 */}
              <CheckGlyph key={copyRun} className="copy-icon-done" />
            </span>
            {/* 两种文案由伪元素各占一次位（不可见、不进 DOM 文本），按钮宽度取较长的一种 */}
            <span className="copy-label" data-idle={platform.copyLink} data-done={platform.copied}>
              {/* aria-live 的节点不换，里面那层随复制次数换 key，文字的进场才能重播 */}
              <span className="copy-text" aria-live="polite">
                <span key={copyRun} className="copy-text-run">
                  {copy === 'copied' ? platform.copied : platform.copyLink}
                </span>
              </span>
            </span>
          </button>
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

/** 「复制网址」的两枚图标只在这里用，就地内联：两张叠放，复制成功时交叉淡化 */
function Glyph({ className, children }: { className: string; children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

function CopyGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </Glyph>
  )
}

function CheckGlyph({ className }: { className: string }) {
  return (
    <Glyph className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Glyph>
  )
}
