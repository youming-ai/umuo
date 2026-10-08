import type { SiteContent } from './types'

/**
 * 繁體中文（台灣）文案。用詞依台灣習慣重寫（軟體、設定、網路、使用者、金鑰、權限），
 * 不是簡體版的逐字轉換。事實依據：docs/PRD.md §5 / §6 / §10。
 */
export const zhTw: SiteContent = {
  locale: 'zh-tw',
  seo: {
    title: 'umuo — 讀、寫、說，一鍵翻譯 | Mac AI 翻譯軟體',
    description:
      'umuo 是 macOS 上的 AI 翻譯軟體：⌥D 劃詞翻譯、⌥A 撰寫視窗、⌥⇧T 輸入框原地替換、⌥S 截圖翻譯，按住右 ⌥ 語音輸入。內建免費引擎，不登入也能用；登入後可用 GPT、Claude、Gemini 等模型，也能接自己的金鑰或本機模型。',
    ogLocale: 'zh_TW',
  },
  nav: {
    skipToContent: '跳到主要內容',
    themeLabel: '主題',
    themeToLight: '切換為淺色主題',
    themeToDark: '切換為深色主題',
  },
  hero: {
    title: '在任何 App 裡，\n一鍵翻譯',
    subtitle: '選取外文就看到譯文，用母語寫完一鍵換成外語，也可以直接用說的。',
    demo: {
      label: '翻譯預覽',
      hint: '也可以直接按 ⌥D 試試',
      modes: [
        {
          id: 'read',
          name: '劃詞翻譯',
          keys: ['⌥', 'D'],
          before: 'The quick brown fox jumps over the lazy dog.',
          after: '敏捷的棕色狐狸跳過了那隻懶狗。',
        },
        {
          id: 'write',
          name: '原地替換',
          keys: ['⌥', '⇧', 'T'],
          before: '明天下午三點開會可以嗎？',
          after: 'Does 3 p.m. tomorrow work for the meeting?',
        },
        {
          id: 'speak',
          name: '語音輸入',
          tag: 'V1.1',
          keys: ['按住右 ⌥'],
          before: '嗯，那個，幫我問一下會議能不能改到禮拜五',
          after: 'Could we move the meeting to Friday?',
        },
      ],
    },
    platforms: [
      {
        id: 'macos',
        requirement: 'macOS 13 或更新版本，Apple Silicon 與 Intel 皆可',
        actionLabel: '下載 macOS 版',
        statusLabel: 'V1.0 開發中',
      },
    ],
  },
  footer: {
    contact: '聯絡信箱',
    copyright: '© 2026 umuo',
    languageLabel: '語言',
  },
}
