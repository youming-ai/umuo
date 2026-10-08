import type { SiteContent } from './types'

/**
 * 日本語コピー。事実は docs/PRD.md（§5 機能 / §6 BYOK / §7.2 ショートカット / §10 料金）に基づく。
 * 中国語版の直訳ではなく、日本語のプロダクトサイトとして書いた文章。
 */
export const ja: SiteContent = {
  locale: 'ja',
  seo: {
    title: 'umuo：自分の API キーで使う Mac 翻訳アプリ（BYOK）',
    description:
      'macOS のシステム全域で使える AI 翻訳クライアント。⌥D 選択範囲の翻訳、⌥A 作文ウィンドウ、⌥⇧T 入力欄の置き換え、⌥S スクリーンショット OCR。API キーは本機の Keychain に保存され、リクエストは端末から直接プロバイダーへ送られます。',
    ogLocale: 'ja_JP',
  },
  nav: {
    skipToContent: 'メインコンテンツへ移動',
    mainNavLabel: 'メインナビゲーション',
    links: [
      { kind: 'product', label: '製品' },
      { kind: 'pricing', label: '料金' },
    ],
    download: 'ダウンロード',
    menuOpen: 'メニューを開く',
    menuClose: 'メニューを閉じる',
    languageLabel: '言語',
    themeLabel: 'テーマ',
    themeToLight: 'ライトテーマに切り替え',
    themeToDark: 'ダークテーマに切り替え',
  },
  hero: {
    badge: 'macOS 版 V1.0 開発中',
    title: '自分の AI で、どこでも翻訳',
    subtitle: '文字を選び、ショートカットを押す。その場で訳文を確認。',
    facts: [
      'アカウント登録は不要',
      'キーはシステムの Keychain に保存',
      'リクエストはプロバイダーへ直結',
    ],
    demo: {
      label: '翻訳プレビュー',
      language: '日本語',
      translation: 'すばしっこい茶色のキツネが怠け者の犬を飛び越える。',
      metrics: 'gpt-4o-mini で翻訳、最初の文字まで 380 ミリ秒',
    },
    platformsLabel: 'ダウンロード',
    platforms: [
      {
        id: 'macos',
        name: 'macOS 版',
        requirement: 'macOS 13 以降、Apple Silicon と Intel に対応',
        actionLabel: 'macOS 版をダウンロード',
        statusLabel: 'V1.0 開発中',
        note: 'インストーラはまだ配布していません。メールアドレスを残していただければ、公開日にお知らせします。',
      },
    ],
    notify: {
      title: '公開のお知らせ',
      description:
        '公開時に一度だけメールでお知らせします。アドレスはその通知のためだけに保存します。',
      emailLabel: 'メールアドレス',
      emailPlaceholder: 'you@example.com',
      submit: 'リリース通知を受け取る',
      cancel: 'キャンセル',
      hint: 'アドレスを保存しました。リリース時に一度だけメールをお送りします。削除はいつでもご依頼ください。',
      error: '送信できませんでした。しばらくしてからもう一度お試しください。',
    },
  },
  shortcuts: {
    label: 'ショートカット',
    title: 'ショートカットで、その場で翻訳',
    description: '選択、入力、置換、スクリーンショットに対応。',
    items: [
      {
        keys: ['⌥', 'D'],
        name: '選択範囲を翻訳',
        description: '文字を選び、浮動パネルで訳文を確認。',
      },
      {
        keys: ['⌥', 'A'],
        name: '作文ウィンドウ',
        description: '母語で入力すると自動で翻訳。',
      },
      {
        keys: ['⌥', '⇧', 'T'],
        name: '入力欄をその場で置き換え',
        description: '入力欄を翻訳して置換。取り消しも可能。',
      },
      {
        keys: ['⌥', 'S'],
        name: 'スクリーンショット OCR',
        description: '画面を選択し、端末内で認識して翻訳。',
      },
    ],
    extraTitle: 'その他の既定キー',
    extra: [
      {
        keys: ['⌥', 'C'],
        name: 'サイレント OCR（原文の認識とコピーだけ）',
      },
      {
        keys: ['⌥', '⇧', 'C'],
        name: 'モデル比較（最大 4 つを並べて表示）',
      },
      {
        keys: ['⌥', 'R'],
        name: '選択範囲を読み上げ',
      },
      {
        keys: ['右 ⌥ を押したまま'],
        name: '音声入力（V1.1）',
      },
    ],
    extraNote: 'キーは変更可能。競合も自動で確認します。',
  },
  logoWall: {
    label: 'モデル',
    title: '好きなモデルを選ぶ',
    description: '主要 AI、独自エンドポイント、ローカルモデルに対応。',
    providers: [
      'OpenAI',
      'Anthropic',
      'Google Gemini',
      'DeepSeek',
      'Qwen 通義千問',
      '智譜 GLM',
      'Moonshot',
      'OpenRouter',
      'Ollama',
      'LM Studio',
      'カスタムエンドポイント',
    ],
    footnote: 'OpenAI 互換。Ollama / LM Studio を自動検出。',
  },
  pillars: [
    {
      id: 'read',
      label: '読む',
      title: '選んで、翻訳',
      description: 'ブラウザー、文書、チャットで訳文を確認。',
      items: [
        {
          title: '選択範囲・文単位の翻訳',
          description:
            '選択テキストはまずアクセシビリティ API から読み取ります。読めない場合は ⌘C のシミュレートに切り替え、終わったらクリップボードの中身を元に戻します。',
        },
        {
          title: '単語カード',
          description:
            '3 語以内を選ぶと、発音記号、品詞、意味、活用、例文 2 つ、再生ボタンを備えたカードを返します。',
        },
        {
          title: 'モデル比較',
          description:
            '同じ文章を設定済みの最大 4 モデルへ同時に送り、カードを横並びにして所要時間と Token 数を表示します。「最適」を付けると、その好みがローカル統計に入り、既定モデルの提案に使われます。',
        },
        {
          title: '文ごとの対訳表示',
          description:
            '長い段落は文に分割して左右に並べます。訳文を確認するときに前後へスクロールする必要はありません。',
          tag: 'V1.1',
        },
      ],
      footnote:
        '受け入れ基準：Safari、Chrome、VS Code、Slack、WeChat、Feishu、Notion、Preview（PDF）での文字取得成功率 95% 以上。',
    },
    {
      id: 'write',
      label: '書く',
      title: '母語で書く',
      description: '書いた文章をその場で目的の言語に置換。',
      items: [
        {
          title: '作文ウィンドウ',
          description:
            '上に入力、下に訳文。原文と目標の言語、モデル、スタイルを切り替えられます。「逆翻訳」ボタンは訳文を母語に戻すので、送る前に語調を確認できます。',
        },
        {
          title: '入力欄をその場で置き換え',
          description:
            '選択中の内容（未選択なら入力欄全体）を読み、翻訳し、元の位置に書き戻します。処理中はカーソルの近くに小さなインジケータが出て、失敗したときは原文を残して通知します。',
        },
        {
          title: '翻訳スタイルとプロンプトのプリセット',
          description:
            '標準、口語、ビジネス、学術、技術文書（コードと固有名詞を保持）などのプリセットを同梱。システムプロンプトを自分で書き、{source_lang}、{text}、{glossary}、{app_name} の変数も使えます。',
        },
        {
          title: '推敲と校正',
          description:
            '文法の修正、語調の書き換え、まとまりのない段落を筋道立てて整理することもできます。',
          tag: 'V1.1',
        },
      ],
      footnote:
        '目標の言語は固定もでき、「アプリごとに記憶」もできます。Slack で一度英語を選べば、以降は Slack では英語になります。',
    },
    {
      id: 'look',
      label: '見る',
      title: '画面を翻訳',
      description: '字幕、スキャン、画像の文字を読み取る。',
      items: [
        {
          title: 'スクリーンショット OCR',
          description:
            '⌥S で範囲選択モードに入り、十字カーソルと拡大鏡で位置を合わせます。認識結果が原文となり、そのまま翻訳されます。認識は Mac 上で完結し、スクリーンショットは送信されません。',
        },
        {
          title: 'サイレント OCR',
          description:
            '⌥C は文字を認識してコピーするだけで、翻訳結果は出しません。画像から文字だけを取り出したいときに便利です。',
        },
        {
          title: 'マルチモーダル画像翻訳',
          description:
            '既定の OCR エンジンは本機で動く無料の Apple Vision。マンガ、ポスター、複雑なレイアウトでは、画像を直接読むマルチモーダルモデルに切り替えられます。',
          tag: 'V1.1',
        },
        {
          title: '重ね合わせモード',
          description:
            '訳文をスクリーンショットの元の位置に貼り戻します。マンガや説明書ではこれが一番分かりやすい表示です。',
          tag: 'V1.1',
        },
        {
          title: '音声入力と音声翻訳',
          description:
            '右 ⌥ を押したまま話して離すと文字になります。母語で入力することも、母語で話して目標の言語を出力することもできます。文字起こしは公式の音声枠、自分のキー、本機の Whisper から選べます。',
          tag: 'V1.1',
        },
      ],
      footnote:
        '「画面収録」の権限は、最初にスクリーンショット機能を使うときだけ求めます。使わなければ要求しません。',
    },
  ],
  byok: {
    label: 'BYOK',
    title: 'あなたのキー、あなたのデータ',
    description: 'キーは端末内に保存。BYOK はモデルに直接接続します。',
    points: [
      {
        title: 'キーは本機の Keychain だけに',
        description: 'キーは Keychain に保存。設定やログには記録しません。',
      },
      {
        title: 'リクエストはプロバイダーへ直結',
        description: 'BYOK は直接接続。公式利用枠はゲートウェイ経由。',
      },
      {
        title: 'ローカルモデルはオフラインで動く',
        description: 'Ollama / LM Studio なら内容は端末内で完結。',
      },
    ],
    flowTitle: '3 ステップで翻訳',
    flow: ['文字を選び、⌥D を押す', 'モデルに直接接続', '訳文を確認'],
    costTitle: '使った分だけ支払う',
    costRows: [
      {
        label: '翻訳 1 回',
        value: '約 750 Token',
      },
      {
        label: '軽量モデルの単価',
        value: '100 万 Token あたり約 $0.62',
      },
      {
        label: '1 回あたり',
        value: '1,000 回で約 $0.5',
      },
    ],
    costNote:
      '費用は提供元に直接支払います。gpt-4o-mini の定価（100万トークン入力 $0.15 / 出力 $0.60）で試算すると、' +
      '1,000 文（各 40 入力 + 60 出力トークン）で約 $0.04。高性能モデルだと大きく上がります。',
  },
  features: {
    label: 'その他の機能',
    title: '毎日に役立つ機能',
    description: 'V1.0 の優先機能。バージョン表記は今後の対応予定です。',
    items: [
      {
        title: '翻訳スタイル',
        description: '日常会話、ビジネス、学術、独自 Prompt。',
      },
      {
        title: 'キーのカスタマイズ',
        description: '好みのキーを登録。競合も確認。',
      },
      {
        title: 'ローカル履歴',
        description: '訳文を検索。プライバシーモードは記録なし。',
      },
      {
        title: 'お気に入り',
        description: '訳文を保存して、あとで確認。',
      },
      {
        title: '利用量の確認',
        description: 'Token と費用を確認。月額上限を設定。',
      },
      {
        title: '読み上げ',
        description: '原文や訳文を聞いて発音を確認。',
      },
      {
        title: 'キー不要の翻訳',
        description: 'API キーなしで Web 翻訳を利用。',
      },
      {
        title: '公式利用枠',
        description: 'ログインして利用枠と残量を確認。',
      },
    ],
  },
  comparison: {
    label: '比較',
    title: 'ひと目で比較',
    description: '対応 OS、モデル、料金を比較。',
    columns: ['', 'umuo', 'DeepL デスクトップ', 'Bob', 'Trancy Air'],
    rows: [
      {
        label: '対応プラットフォーム',
        values: ['macOS 13+', 'macOS、Windows', 'macOS', 'macOS、Windows'],
      },
      {
        label: '自分のキーとローカルモデル',
        values: [
          'キーは Keychain；ローカルはオフライン対応',
          'モデルは変更できない',
          'サードパーティのプラグイン次第',
          '独自エンジンにはアカウント登録とクラウド同期が必要',
        ],
      },
      {
        label: '料金',
        values: [
          'BYOK 無料；公式枠 $5.99 / 月から',
          '無料枠とサブスクリプション',
          '一部の機能は買い切り',
          'サブスクリプション。地域により価格が変動',
        ],
      },
    ],
    footnote: '他社の最新情報は各公式サイトをご確認ください。',
  },
  pricing: {
    label: '料金',
    title: 'シンプルな料金、自由な選択',
    description: 'クライアントは無料。BYOK は無制限。公式利用枠はサブスクリプションで。',
    billingLabel: '支払い周期',
    monthly: '月払い',
    yearly: '年払い',
    yearlyBadge: '約 35% 割引',
    recommended: 'おすすめ',
    tiers: [
      {
        id: 'free',
        name: 'Free アカウント',
        tagline: 'まずはお試し',
        priceMonthly: '$0',
        priceYearly: '$0',
        periodMonthly: '永久無料',
        periodYearly: '永久無料',
        requirement: 'アカウントが必要',
        features: [
          '高速枠 30 万 Token / 月',
          '音声 30 分 / 月（V1.1）',
          '設定同期（V1.1、キーを除く）',
          'BYOK / ローカル / Web 翻訳は無制限',
        ],
        cta: 'アカウントを作成',
      },
      {
        id: 'pro',
        name: 'Pro',
        tagline: '日常の翻訳には十分',
        priceMonthly: '$5.99',
        priceYearly: '$46.99',
        periodMonthly: '/ 月',
        periodYearly: '/ 年',
        requirement: 'アカウントが必要',
        features: [
          '高速枠 300 万 Token / 月',
          '音声 300 分 / 月（V1.1）',
          'Free アカウント枠を含む',
          '月払い 1 日・年払い 3 日のお試し。期間内の解約は無料',
        ],
        cta: 'Pro にアップグレード',
        highlight: true,
      },
      {
        id: 'pro-plus',
        name: 'Pro + 高度な AI',
        tagline: 'より高い翻訳品質',
        priceMonthly: '$11.99',
        priceYearly: '$93.99',
        periodMonthly: '/ 月',
        periodYearly: '/ 年',
        requirement: 'アカウントが必要',
        features: [
          'Pro の利用枠を含む',
          '高品質モデル',
          '上位枠 1,000 万 Token / 月',
          '音声 600 分 / 月（V1.1）',
        ],
        cta: 'Pro + 高度な AI にアップグレード',
      },
    ],
    openSource: {
      title: 'BYOK は永久に無料',
      description: '全クライアント機能が無料。BYOK はアカウント不要。',
    },
    addon: {
      title: '追加パック $3.99',
      description: '上位モデル +500 万 Token または音声 +300 分。当期のみ有効。',
    },
    regionalNote:
      '中国本土では WeChat 決済に対応し、Pro は ¥28／月・¥218／年、Pro + 高度な AI は ¥58／月・¥448／年。その他の地域は現地通貨で端数調整します。',
    refundNote:
      '月払いは 7 日以内、年払いは 30 日以内なら理由を問わず返金します。高度枠を含むプランは使用済み分を差し引いて返金します。',
    footnote: '年払いで約 35% お得。Beta 中は利用枠が変わる場合があります。',
  },
  faq: {
    label: 'よくある質問',
    title: 'よくある質問',
    description: '使い方、プライバシー、料金について。',
    items: [
      {
        question: 'BYOK とは？',
        answer:
          '自分の API キーを使う方式です。umuo のアカウントは不要。費用はモデル提供元に直接支払い、無料のローカルモデルも使えます。',
      },
      {
        question: 'プランの違いは？',
        answer:
          'クライアント機能は無料。契約すると公式利用枠が増えます。使い切ったら追加購入か BYOK に切替。返金は月払い 7 日・年払い 30 日以内で、上位枠の使用分は差し引きます。',
      },
      {
        question: 'キーや内容は送信されますか？',
        answer:
          'BYOK のキーは端末内に保存し、設定した接続先へ直接送信します。公式利用枠はゲートウェイ経由ですが、翻訳内容は保存しません。',
      },
      {
        question: 'なぜ OS の権限が必要ですか？',
        answer:
          'アクセシビリティは文字の取得と置換、画面収録は範囲の撮影に使います。必要な機能を使う時に申請します。',
      },
      {
        question: 'キーなしでも使えますか？',
        answer: 'はい。Web 翻訳、ローカルモデル、またはログインして公式利用枠を使えます。',
      },
      {
        question: '対応 OS は？',
        answer: '現在は macOS 13+ のみ。Apple Silicon と Intel に対応。',
      },
      {
        question: '中国本土で使うには？',
        answer:
          'システム・HTTP・SOCKS5 プロキシ、利用可能な提供元、またはオフラインモデルを使えます。',
      },
    ],
  },
  footer: {
    ctaTitle: 'いつもの作業に、翻訳を',
    ctaDescription: 'macOS 版は開発中。公開時にお知らせします。',
    ctaDownload: 'macOS 版をダウンロード',
    ctaNotify: '公開時に通知を受け取る',
    columns: [
      {
        title: 'プロダクト',
        links: [
          {
            kind: 'features',
            label: '機能',
          },
          {
            kind: 'pricing',
            label: '料金',
          },
          {
            kind: 'comparison',
            label: '比較',
          },
          {
            kind: 'faq',
            label: 'よくある質問',
          },
          {
            kind: 'top',
            label: 'ページ上部へ',
          },
        ],
      },
      {
        title: '法務と連絡先',
        links: [
          {
            kind: 'privacy',
            label: 'プライバシーポリシー',
          },
          {
            kind: 'terms',
            label: '利用規約',
          },
          {
            kind: 'contact',
            label: '連絡先メール',
          },
        ],
      },
    ],
    comingSoon: '公開予定',
    legalNote: 'プライバシーポリシーと利用規約は正式公開前に掲載します。',
    copyright: '© 2026 umuo',
    languageLabel: '言語',
  },
}
