import type { SiteContent } from './types'

/**
 * English copy. Structure follows zh-cn.ts; facts come from docs/PRD.md (§5 features,
 * §7.2 shortcuts, §10 pricing). Wording is written for English readers, not translated.
 */
export const en: SiteContent = {
  locale: 'en',
  seo: {
    title: 'umuo: AI translator for Mac — read, write and speak',
    description:
      'umuo translates in any app on your Mac: ⌥D for selected text, ⌥A for a writing window, ⌥⇧T to replace what you typed, ⌥S for screenshots, and hold right ⌥ to dictate. The free built-in engine needs no account; sign in for GPT, Claude and Gemini, or use your own key or a local model.',
    ogLocale: 'en_US',
  },
  nav: {
    skipToContent: 'Skip to main content',
    themeLabel: 'Theme',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
  },
  hero: {
    title: 'Translate in any app with one shortcut',
    subtitle:
      'Select text to read it in English. Write in English and switch it to another language with one keystroke. Or just speak.',
    demo: {
      label: 'Translation preview',
      hint: 'Or press ⌥D right here',
      modes: [
        {
          id: 'read',
          name: 'Selection',
          keys: ['⌥', 'D'],
          before: '敏捷的棕色狐狸跳过了那只懒狗。',
          after: 'The quick brown fox jumps over the lazy dog.',
        },
        {
          id: 'write',
          name: 'Replace',
          keys: ['⌥', '⇧', 'T'],
          before: 'Could we do the meeting at 3 tomorrow afternoon?',
          after: '明天下午三点开会可以吗？',
        },
        {
          id: 'speak',
          name: 'Voice',
          tag: 'V1.1',
          keys: ['Hold right ⌥'],
          before: 'Um, so, can you ask if we could move the meeting to Friday',
          after: '会议可以改到周五吗？',
        },
      ],
    },
    platforms: [
      {
        id: 'macos',
        requirement: 'macOS 13 or later, Apple Silicon or Intel',
        actionLabel: 'Download for macOS',
        statusLabel: 'V1.0 in development',
      },
    ],
  },
  footer: {
    contact: 'Contact email',
    copyright: '© 2026 umuo',
    languageLabel: 'Language',
  },
}
