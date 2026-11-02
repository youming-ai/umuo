import type { SiteContent } from './types'

/**
 * 繁體中文（台灣）文案。用詞依台灣習慣重寫（軟體、設定、網路、使用者、金鑰、權限），
 * 不是簡體版的逐字轉換。事實依據：docs/PRD.md（v0.5：文字／截圖／語音三項核心，免費、純 BYOK）。
 */
export const zhTw: SiteContent = {
  seo: {
    title: 'umuo — 讀與寫，一鍵翻譯 | Mac AI 翻譯軟體',
    description:
      'umuo 是 macOS 上的 AI 翻譯軟體：⌃⌃ 劃詞翻譯、⌥⌘A 輸入翻譯、⌥⌥ 閃電替換、⌥⌘O 截圖翻譯。接上自己的金鑰（GPT、Claude、Gemini 等）或本機模型即可使用，完全免費，無訂閱、不需帳號；語音輸入開發中。',
    ogLocale: 'zh_TW',
  },
  nav: {
    skipToContent: '跳到主要內容',
    themeLabel: '主題',
    themeToLight: '切換為淺色主題',
    themeToDark: '切換為深色主題',
  },
  hero: {
    title: '在哪裡寫，\n就在哪裡譯',
    subtitle: '寫完按兩下 ⌥，輸入框裡的文字原地換成外語；劃詞、截圖也能譯。',
    demo: {
      label: '翻譯預覽',
      modes: [
        {
          id: 'read',
          hint: '在這個頁面連按兩下 ⌃ 試試',
          name: '劃詞翻譯',
          keys: ['⌃', '⌃'],
          before: 'The quick brown fox jumps over the lazy dog.',
          after: '敏捷的棕色狐狸跳過了那隻懶狗。',
        },
        {
          id: 'write',
          hint: '在這個頁面連按兩下 ⌥ 試試',
          name: '閃電替換',
          keys: ['⌥', '⌥'],
          before: '明天下午三點開會可以嗎？',
          after: 'Does 3 p.m. tomorrow work for the meeting?',
          note: '確認仍是同一個輸入框才替換；失敗或取消時原文不動。',
        },
        {
          id: 'ocr',
          hint: '截圖翻譯要在 Mac 上按 ⌥⌘O 框選',
          name: '截圖翻譯',
          keys: ['⌥', '⌘', 'O'],
          before: 'Last train leaves Platform 2 at 11:40 p.m.',
          after: '末班車晚上 11:40 從 2 號月台發車。',
        },
        {
          id: 'speak',
          hint: '開發中：按住 ⌃⌘V 說話，放開後翻譯成目標語言；按住 ⌥⌘V 則整理成通順的同語言文字',
          name: '語音輸入',
          tag: '開發中',
          before: '嗯，那個，會議能改到禮拜五嗎',
          after: 'Could we move the meeting to Friday?',
          note: '開發中：預覽版暫不包含語音輸入。',
        },
      ],
    },
    platform: {
      requirement: 'macOS 14+，僅支援 Apple Silicon（M 系列晶片）',
      actionLabel: '下載 macOS 版',
      statusLabel: '預覽版',
      note: '預覽版未經 Apple 公證，首次打開若被攔下，到「隱私權與安全性」點「仍要打開」。',
      mobileNote: 'umuo 是 Mac App，請在 Mac 上開啟 umuo.app 下載。',
      copyLink: '複製網址',
      copied: '已複製',
      copyFailed: '沒能複製，請手動記下 umuo.app',
      afterDownload: {
        title: '下載已開始，接下來：',
        steps: [
          '打開下載的安裝檔，把 umuo 拖進「應用程式」資料夾。',
          '首次打開若被攔下，到「系統設定 › 隱私權與安全性」點「仍要打開」。',
          '依引導選擇模型供應商、填入你的 API 金鑰；劃詞翻譯需要授予輔助使用權限。',
        ],
      },
    },
  },
  footer: {
    copyright: '© 2026 umuo',
    languageLabel: '語言',
  },
}
