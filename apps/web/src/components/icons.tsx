import type { ReactNode } from 'react'

/**
 * 内联 SVG 图标。全部 `aria-hidden`（旁边的文字已经说明含义），
 * 不用 emoji、不引外链图片。stroke 用 `currentColor`，跟随文本颜色。
 */

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...strokeProps}
    >
      {children}
    </svg>
  )
}

/** 像素小恐龙（20×20 网格），颜色跟随 currentColor。logo 尚未最终定稿。 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <path
        fill="currentColor"
        d="M10 0h8v1h-8zM9 1h10v1h-10zM9 2h2v1h-2zM12 2h7v1h-7zM9 3h10v1h-10zM9 4h10v1h-10zM9 5h10v1h-10zM9 6h5v1h-5zM9 7h8v1h-8zM0 8h1v1h-1zM8 8h5v1h-5zM0 9h1v1h-1zM7 9h6v1h-6zM0 10h2v1h-2zM6 10h11v1h-11zM0 11h3v1h-3zM5 11h10v1h-10zM16 11h1v1h-1zM0 12h14v1h-14zM1 13h13v1h-13zM2 14h11v1h-11zM3 15h9v1h-9zM4 16h4v1h-4zM10 16h3v1h-3zM4 17h3v1h-3zM11 17h2v1h-2zM4 18h2v1h-2zM11 18h1v1h-1zM4 19h3v1h-3zM11 19h2v1h-2z"
      />
    </svg>
  )
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M12 3v12" />
      <path d="m7 12 5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  )
}

export function GlobeIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.7 4 5.7 4 9s-1.5 6.3-4 9c-2.5-2.7-4-5.7-4-9s1.5-6.3 4-9Z" />
    </Svg>
  )
}

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function ThemeContrastIcon({ className }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M12 9l4.65-4.65M12 14.3l7.37-7.37M12 19.6l8.85-8.85" />
    </Svg>
  )
}
