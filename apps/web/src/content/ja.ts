import type { SiteContent } from './types'

/**
 * 日本語コピー。事実は docs/PRD.md（§5 機能とバージョン / §7.2 ショートカット / §10 料金）に基づく。
 * 中国語版の直訳ではなく、日本語のプロダクトサイトとして書いた文章。
 * 発音練習のスコア表示は PRD にないため「近日公開」とだけ書き、バージョンは付けない。
 */
export const ja: SiteContent = {
  locale: 'ja',
  seo: {
    title: 'umuo — 読む・書く・話すをワンキーで翻訳 | Mac AI 翻訳',
    description:
      'umuo は macOS 向けの AI 翻訳アプリ。⌥D で選択範囲を翻訳、⌥A で作文ウィンドウ、⌥⇧T で入力欄をその場で置き換え、⌥S でスクリーンショット翻訳、右 ⌥ を長押しで音声入力。無料エンジン内蔵でログイン不要。ログインすれば GPT、Claude、Gemini などのモデルも使え、自分の API キーやローカルモデルにも対応します。',
    ogLocale: 'ja_JP',
  },
  nav: {
    skipToContent: 'メインコンテンツへ移動',
    themeLabel: 'テーマ',
    themeToLight: 'ライトテーマに切り替え',
    themeToDark: 'ダークテーマに切り替え',
  },
  hero: {
    title: 'どのアプリでも、\nワンキーで翻訳',
    subtitle:
      '外国語を選べば、すぐに訳文。母語で書いた文章は、ワンキーで外国語に。話して入力することもできます。',
    demo: {
      label: '翻訳プレビュー',
      hint: 'ここで ⌥D を押しても試せます',
      modes: [
        {
          id: 'read',
          name: '選択翻訳',
          keys: ['⌥', 'D'],
          before: 'The quick brown fox jumps over the lazy dog.',
          after: 'すばしっこい茶色のキツネが怠け者の犬を飛び越える。',
        },
        {
          id: 'write',
          name: 'その場で置換',
          keys: ['⌥', '⇧', 'T'],
          before: '明日の午後 3 時に打ち合わせできますか？',
          after: 'Does 3 p.m. tomorrow work for the meeting?',
        },
        {
          id: 'speak',
          name: '音声入力',
          tag: 'V1.1',
          keys: ['右 ⌥ を長押し'],
          before: 'えーと、あの、会議を金曜日に変更できるか聞いてもらえますか',
          after: 'Could we move the meeting to Friday?',
        },
      ],
    },
    platforms: [
      {
        id: 'macos',
        requirement: 'macOS 13 以降、Apple Silicon と Intel に対応',
        actionLabel: 'macOS 版をダウンロード',
        statusLabel: 'V1.0 開発中',
      },
    ],
  },
  footer: {
    contact: '連絡先メール',
    copyright: '© 2026 umuo',
    languageLabel: '言語',
  },
}
