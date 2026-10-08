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
        <circle cx="27" cy="52" r="7.5" fill="#A8734D" stroke="#fff" strokeWidth="3.5" />
        <circle cx="95" cy="47" r="7.5" fill="#A8734D" stroke="#fff" strokeWidth="3.5" />
        <ellipse cx="61" cy="70" rx="38" ry="33" fill="#A8734D" stroke="#fff" strokeWidth="3.5" />
        <circle cx="27" cy="52" r="5.8" fill="#A8734D" />
        <circle cx="95" cy="47" r="5.8" fill="#A8734D" />
        <circle cx="28" cy="52" r="3" fill="#7E5236" />
        <circle cx="94" cy="47" r="3" fill="#7E5236" />
        <ellipse cx="61" cy="70" rx="36.2" ry="31.2" fill="#A8734D" />
        <ellipse cx="60" cy="77" rx="29" ry="17" fill="#F4E6D2" />
        <ellipse cx="45" cy="61" rx="4.4" ry="5" fill="#2a1f1a" />
        <ellipse cx="74" cy="58" rx="4.4" ry="5" fill="#2a1f1a" />
        <circle cx="46.4" cy="59.3" r="1.6" fill="#fff" />
        <circle cx="75.4" cy="56.3" r="1.6" fill="#fff" />
        <path d="M53 68Q60 65 67 67.5Q67.5 72 60 74Q52.5 72.5 53 68Z" fill="#2a1f1a" />
        <path
          d="M60 74V77M60 77Q56.5 80.5 53 78M60 77Q63.5 80.5 67 78"
          fill="none"
          stroke="#2a1f1a"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M43 73L30 70M43 77L29 78M77 71L91 67M78 75L92 74"
          fill="none"
          stroke="#7E5236"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <ellipse cx="36" cy="69" rx="4.2" ry="2.8" fill="#ff9fb0" opacity=".55" />
        <ellipse cx="84" cy="65" rx="4.2" ry="2.8" fill="#ff9fb0" opacity=".55" />
        <path
          d="M0 89Q8 84 16 89T32 89T48 89T64 89T80 89T96 89T112 89V100H0Z"
          fill="#5FB2FF"
          stroke="#fff"
          strokeWidth="3"
        />
        <ellipse cx="44" cy="89" rx="7" ry="4.5" fill="#A8734D" stroke="#fff" strokeWidth="2.5" />
        <ellipse cx="77" cy="88" rx="7" ry="4.5" fill="#A8734D" stroke="#fff" strokeWidth="2.5" />
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

/** GitHub 标志（官方 mark），颜色跟随 currentColor */
export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
      />
    </svg>
  )
}
