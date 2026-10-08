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

/**
 * logo：从圆角方块右下角探出头的小恐龙（蓝底绿龙）。满底色的彩色图标，不随主题变色；
 * 与 public/favicon.svg 是同一张图，改一处要同步另一处。
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="umuo-logo-tile">
          <rect width="100" height="100" rx="22" />
        </clipPath>
      </defs>
      <g clipPath="url(#umuo-logo-tile)">
        <rect width="100" height="100" fill="#0A84FF" />
        <path
          d="M30.6 63.5L20.1 47.4L39.0 51.1ZM40.9 49.4L38.2 28.5L54.1 42.4ZM56.5 41.8L64.0 21.4L71.5 41.8ZM73.3 42.2L88.7 28.6L86.7 49.0Z"
          fill="#4FA83D"
          stroke="#fff"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <circle cx="64" cy="77" r="40" fill="#8BD66B" stroke="#fff" strokeWidth="3.5" />
        <path
          d="M30.6 63.5L20.1 47.4L39.0 51.1ZM40.9 49.4L38.2 28.5L54.1 42.4ZM56.5 41.8L64.0 21.4L71.5 41.8ZM73.3 42.2L88.7 28.6L86.7 49.0Z"
          fill="#4FA83D"
          stroke="#4FA83D"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="64" cy="77" r="38.2" fill="#8BD66B" />
        <ellipse cx="54" cy="91" rx="27" ry="17" fill="#E9F8DE" />
        <ellipse cx="48" cy="64" rx="5" ry="6" fill="#1b1d22" />
        <ellipse cx="76" cy="61" rx="5" ry="6" fill="#1b1d22" />
        <circle cx="49.6" cy="61.8" r="1.9" fill="#fff" />
        <circle cx="77.6" cy="58.8" r="1.9" fill="#fff" />
        <circle cx="47" cy="80" r="1.6" fill="#1b1d22" />
        <circle cx="57" cy="79" r="1.6" fill="#1b1d22" />
        <path d="M44 87Q54 99 66 86Q55 91 44 87Z" fill="#1b1d22" />
        <path d="M50 92.5Q55 96 60 91.5Q55 92.6 50 92.5Z" fill="#ff8fa3" />
        <ellipse cx="38" cy="75" rx="4.5" ry="3" fill="#ff9fb0" opacity=".55" />
        <ellipse cx="86" cy="71" rx="4.5" ry="3" fill="#ff9fb0" opacity=".55" />
      </g>
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
