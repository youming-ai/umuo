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
 * logo：从水里探出头的小水獭（蓝底），两只爪子搭在水面上。满底色的彩色图标，不随主题变色；
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
        <g transform="rotate(-4 50 58)">
          <circle cx="16" cy="41" r="8" fill="#A8734D" stroke="#fff" strokeWidth="4" />
          <circle cx="84" cy="41" r="8" fill="#A8734D" stroke="#fff" strokeWidth="4" />
          <ellipse cx="50" cy="58" rx="39" ry="31" fill="#A8734D" stroke="#fff" strokeWidth="4" />
          <circle cx="16" cy="41" r="6" fill="#A8734D" />
          <circle cx="84" cy="41" r="6" fill="#A8734D" />
          <circle cx="17" cy="41.5" r="3.4" fill="#7E5236" />
          <circle cx="83" cy="41.5" r="3.4" fill="#7E5236" />
          <ellipse cx="50" cy="58" rx="37" ry="29" fill="#A8734D" />
          <ellipse cx="50" cy="67" rx="29" ry="18" fill="#F4E6D2" />
          <ellipse cx="34" cy="49" rx="5.2" ry="6" fill="#2a1f1a" />
          <ellipse cx="66" cy="49" rx="5.2" ry="6" fill="#2a1f1a" />
          <circle cx="35.8" cy="46.8" r="1.9" fill="#fff" />
          <circle cx="67.8" cy="46.8" r="1.9" fill="#fff" />
          <path d="M42 58Q50 55 58 58Q58.5 63.5 50 66Q41.5 63.5 42 58Z" fill="#2a1f1a" />
          <path
            d="M50 66V69.5M50 69.5Q46 74 41.5 71M50 69.5Q54 74 58.5 71"
            fill="none"
            stroke="#2a1f1a"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <ellipse cx="24" cy="60" rx="5" ry="3.3" fill="#ff9fb0" opacity=".6" />
          <ellipse cx="76" cy="60" rx="5" ry="3.3" fill="#ff9fb0" opacity=".6" />
        </g>
        <path
          d="M-2 86Q10.5 78 23 86T48 86T73 86T98 86T123 86V102H-2Z"
          fill="#5FB2FF"
          stroke="#fff"
          strokeWidth="3.5"
        />
        <ellipse cx="35" cy="86" rx="8" ry="5.2" fill="#A8734D" stroke="#fff" strokeWidth="3" />
        <ellipse cx="65" cy="85" rx="8" ry="5.2" fill="#A8734D" stroke="#fff" strokeWidth="3" />
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

/** GitHub 标志（Octicons `mark-github`，实心）：颜色跟随文字，装饰性，链接本身带 aria-label */
export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  )
}
