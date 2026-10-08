import { MACOS_DOWNLOAD_URL } from '../config'
import { DownloadIcon } from './icons'

/**
 * 首屏与导航共用。安装包地址未配置时不放假链接：按钮保持实心但不可点，
 * 里面带一枚状态标签（如「V1.0 开发中」），读起来是「还没发布」而不是「坏了」。
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
      <a href={MACOS_DOWNLOAD_URL} download className={classes} aria-describedby={describedBy}>
        <DownloadIcon className="h-4 w-4" />
        {label}
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
      <span className="pending-tag">{status}</span>
    </button>
  )
}
