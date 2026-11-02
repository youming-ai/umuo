import type { SiteContent } from './types'

/**
 * 日本語コピー。事実はルートの docs/PRD.md（v0.5：文字 / スクリーンショット / 音声の 3 本柱、無料・BYOK のみ）に基づく。
 * 中国語版の直訳ではなく、日本語のプロダクトサイトとして書いた文章。
 */
export const ja: SiteContent = {
  locale: 'ja',
  seo: {
    title: 'umuo — 読む・書くをワンキーで翻訳 | Mac AI 翻訳',
    description:
      'umuo は macOS 向けの AI 翻訳アプリ。⌃⌃ で選択範囲を翻訳、⌥⌘A で入力翻訳、⌥⌥ で入力欄をその場で置き換え、⌥⌘O でスクリーンショット翻訳。自分の API キー（GPT、Claude、Gemini など）やローカルモデルでそのまま使え、完全無料でサブスクリプションはなく、アカウントも不要です。音声入力は開発中です。',
    ogLocale: 'ja_JP',
  },
  nav: {
    skipToContent: 'メインコンテンツへ移動',
    themeLabel: 'テーマ',
    themeToLight: 'ライトテーマに切り替え',
    themeToDark: 'ダークテーマに切り替え',
  },
  hero: {
    title: '書いたその場で、\n外国語に',
    subtitle:
      '⌥ を 2 回押せば、入力欄の文章がその場で外国語に。選択したテキストもスクショも翻訳できます。',
    demo: {
      label: '翻訳プレビュー',
      modes: [
        {
          id: 'read',
          hint: 'このページで ⌃ を 2 回押して試せます',
          name: '選択翻訳',
          keys: ['⌃', '⌃'],
          before: 'The quick brown fox jumps over the lazy dog.',
          after: 'すばしっこい茶色のキツネが怠け者の犬を飛び越える。',
        },
        {
          id: 'write',
          hint: 'このページで ⌥ を 2 回押して試せます',
          name: '瞬間置換',
          keys: ['⌥', '⌥'],
          before: '明日の午後 3 時に打ち合わせできますか？',
          after: 'Does 3 p.m. tomorrow work for the meeting?',
          note: '同じ入力欄のままのときだけ置き換えます。失敗・キャンセル時は原文を残します。',
        },
        {
          id: 'ocr',
          hint: 'スクショ翻訳は Mac で ⌥⌘O を押して範囲を選びます',
          name: 'スクショ翻訳',
          keys: ['⌥', '⌘', 'O'],
          before: 'Last train leaves Platform 2 at 11:40 p.m.',
          after: '終電は午後 11 時 40 分に 2 番線から発車します。',
        },
        {
          id: 'speak',
          hint: '開発中：⌃⌘V を押したまま話すと、離したときに目標言語へ翻訳します。⌥⌘V なら同じ言語のまま整えます',
          name: '音声入力',
          tag: '開発中',
          keyHint: '長押し',
          keys: ['⌃', '⌘', 'V'],
          before: 'えーと、会議を金曜日に移せますか',
          after: 'Could we move the meeting to Friday?',
          note: '開発中：プレビュー版には音声入力はまだ含まれていません。',
        },
      ],
    },
    platforms: [
      {
        id: 'macos',
        requirement: 'macOS 14 以降、Apple Silicon（M シリーズ）専用',
        actionLabel: 'macOS 版をダウンロード',
        statusLabel: 'プレビュー版',
        note: '未公証のプレビュー版です。開けない場合は「プライバシーとセキュリティ」で「このまま開く」を押してください。',
        mobileNote: 'umuo は Mac 用アプリです。Mac で umuo.app を開いてダウンロードしてください。',
        copyLink: 'URL をコピー',
        copied: 'コピーしました',
        copyFailed: 'コピーできませんでした。umuo.app を控えてください',
        afterDownload: {
          title: 'ダウンロードを開始しました。次の手順：',
          steps: [
            'ダウンロードしたインストーラを開き、umuo を「アプリケーション」フォルダへドラッグします。',
            '初回起動がブロックされたら「システム設定 › プライバシーとセキュリティ」で「このまま開く」を押します。',
            '案内に沿ってモデルプロバイダーを選び、API キーを入力します。選択翻訳にはアクセシビリティの許可が必要です。',
          ],
        },
      },
    ],
  },
  footer: {
    copyright: '© 2026 umuo',
    languageLabel: '言語',
  },
}
