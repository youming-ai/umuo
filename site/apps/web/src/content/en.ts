import type { SiteContent } from './types'

/**
 * English copy. Structure follows zh-cn.ts; facts come from docs/PRD.md (v0.5: text,
 * screenshot and voice; free, BYOK only). Wording is written for English readers, not translated.
 */
export const en: SiteContent = {
  seo: {
    title: 'umuo: AI translator for Mac — read and write in any app',
    description:
      'umuo translates in any app on your Mac: ⌃⌃ for selected text, ⌥⌘A for typed input, ⌥⌥ to replace what you typed in place, ⌥⌘O for screenshots. Use your own key (GPT, Claude, Gemini and more) or a local model. Completely free, no subscription, no account needed. Voice input is in development.',
    ogLocale: 'en_US',
  },
  nav: {
    skipToContent: 'Skip to main content',
    themeLabel: 'Theme',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
  },
  hero: {
    title: 'Translate right\nwhere you write',
    subtitle:
      'Tap ⌥ twice and the text in your input box turns into another language, in place. Selections and screenshots translate too.',
    demo: {
      label: 'Translation preview',
      modes: [
        {
          id: 'read',
          hint: 'Tap ⌃ twice on this page to try it',
          name: 'Selection',
          keys: ['⌃', '⌃'],
          before: '敏捷的棕色狐狸跳过了那只懒狗。',
          after: 'The quick brown fox jumps over the lazy dog.',
        },
        {
          id: 'write',
          hint: 'Tap ⌥ twice on this page to try it',
          name: 'Lightning Replace',
          keys: ['⌥', '⌥'],
          before: 'Could we do the meeting at 3 tomorrow afternoon?',
          after: '明天下午三点开会可以吗？',
          note: 'Replaced only if it is still the same input box. If anything fails, your original text stays.',
        },
        {
          id: 'ocr',
          hint: 'Screenshot translation runs on your Mac: press ⌥⌘O and drag',
          name: 'Screenshot',
          keys: ['⌥', '⌘', 'O'],
          before: '終電は 23:40、2 番線から発車します。',
          after: 'The last train leaves Platform 2 at 11:40 p.m.',
        },
        {
          id: 'speak',
          hint: 'In development: hold ⌃⌘V and speak, release to get it in your target language; hold ⌥⌘V to tidy it up in the same language',
          name: 'Voice',
          tag: 'In development',
          before: 'Um, so, can we move the meeting to Friday',
          after: '会议可以改到周五吗？',
          note: 'In development: the preview does not include voice input yet.',
        },
      ],
    },
    platform: {
      requirement: 'macOS 14+, Apple Silicon (M-series) only',
      actionLabel: 'Download for macOS',
      statusLabel: 'Preview',
      note: 'Not notarized yet. If macOS blocks it, open Privacy & Security and click “Open Anyway”.',
      mobileNote: 'umuo is a Mac app. Open umuo.app on your Mac to download it.',
      copyLink: 'Copy link',
      copied: 'Copied',
      copyFailed: "Couldn't copy. Please note down umuo.app",
      afterDownload: {
        title: 'Your download has started. Next:',
        steps: [
          'Open the downloaded installer and drag umuo into your Applications folder.',
          'If macOS blocks it on first launch, open System Settings › Privacy & Security and click “Open Anyway”.',
          'Follow the setup to pick a model provider and enter your API key. Selection translation needs Accessibility permission.',
        ],
      },
    },
  },
  footer: {
    copyright: '© 2026 umuo',
    languageLabel: 'Language',
  },
}
