import { MACOS_DOWNLOAD_URL } from '../config'
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
}: {
  label: string
  status: string
  describedBy?: string
  className?: string
}) {
  const classes = `btn-primary ${className}`.trim()
  if (MACOS_DOWNLOAD_URL) {
    return (
      // 不加 download 属性：Safari 会拿地址最后一段（macos）当文件名，压过服务器给的 Content-Disposition
      <a href={MACOS_DOWNLOAD_URL} className={classes} aria-describedby={describedBy}>
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
      aria-describedby={describedBy}
      className={`${classes} is-pending`}
    >
      <DownloadIcon className="h-4 w-4" />
      {label}
      <span className="status-tag">{status}</span>
    </button>
  )
}
