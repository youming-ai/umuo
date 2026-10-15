import type { ReactNode } from 'react'

import type { TabId } from '../lib/settings-tabs'

/**
 * 侧边栏图标：系统设置式的彩色圆角方块 + 白色线条符号。
 * 颜色取 macOS 系统色，深浅模式下都够醒目；符号是自绘的简单线条。
 */
const COLORS: Record<TabId, string> = {
  general: '#8e8e93',
  translate: '#30b0c7',
  engine: '#5e5ce6',
  permissions: '#ff3b30',
  advanced: '#ff9500',
  about: '#8e9aaf',
}

const GLYPHS: Record<TabId, ReactNode> = {
  // 齿轮
  general: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </>
  ),
  // 「文 / A」：两种语言
  translate: (
    <>
      <path d="M4 6h8M8 4v2M5.5 6c.6 2.6 2.4 4.6 5 5.6M10.5 6c-.6 2.6-2.4 4.6-5 5.6" />
      <path d="M13 20l3.5-8 3.5 8M14.3 17h4.4" />
    </>
  ),
  // 芯片：模型与引擎
  engine: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3" />
    </>
  ),
  // 锁
  permissions: (
    <>
      <rect x="6" y="11" width="12" height="9" rx="2" />
      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
    </>
  ),
  // 滑杆
  advanced: (
    <>
      <path d="M5 8h14M5 16h14" />
      <circle cx="9" cy="8" r="2" />
      <circle cx="15" cy="16" r="2" />
    </>
  ),
  // i
  about: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
}

export function SidebarIcon({ tab }: { tab: TabId }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-[5px]"
      style={{ background: COLORS[tab] }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-3.5"
        fill="none"
        stroke="white"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[tab]}
      </svg>
    </span>
  )
}
