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
 * logo：实心水獭剪影——头、两只耳朵，眼睛和鼻子镂空，下面一道水波。单色，跟随文字颜色（`currentColor`），
 * 三套主题下都是当前的墨色。与 public/favicon.svg 是同样两条路径（__tests__/logo.test.ts 盯着）；favicon 由仓库根的 scripts/make-icons.ts 生成，
 * 改图形先改那个脚本，再把生成的路径抄到这里。
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="-2 6.75 104 104" className={className} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6 50a44 30 0 1 1 88 0a44 30 0 1 1-88 0ZM1 38a8 8 0 1 1 16 0a8 8 0 1 1-16 0ZM83 38a8 8 0 1 1 16 0a8 8 0 1 1-16 0ZM27.5 46a6.5 7 0 1 0 13 0a6.5 7 0 1 0-13 0ZM59.5 46a6.5 7 0 1 0 13 0a6.5 7 0 1 0-13 0ZM40 59a10 6 0 1 0 20 0a10 6 0 1 0-20 0Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        d="M4 91Q15.5 85 27 91T50 91T73 91T96 91"
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
