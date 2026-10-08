import type { SiteContent } from './types'

/**
 * 繁體中文（台灣）文案。用詞依台灣習慣重寫（軟體、設定、網路、使用者、金鑰、權限），
 * 不是簡體版的逐字轉換。事實依據：docs/PRD.md §5 / §6 / §10。
 */
export const zhTw: SiteContent = {
  locale: 'zh-tw',
  seo: {
    title: 'umuo：Mac 翻譯軟體，自帶 API Key（BYOK）',
    description:
      'macOS 系統級 AI 翻譯用戶端：⌥D 劃詞翻譯、⌥A 撰寫視窗、⌥⇧T 輸入框原地替換、⌥S 截圖 OCR。自帶 API Key，金鑰只存在本機 Keychain，請求由你的電腦直接連線供應商。',
    ogLocale: 'zh_TW',
  },
  nav: {
    skipToContent: '跳到主要內容',
    mainNavLabel: '主導覽',
    links: [
      {
        kind: 'features',
        label: '功能',
      },
      {
        kind: 'pricing',
        label: '定價',
      },
      {
        kind: 'comparison',
        label: '比較',
      },
      {
        kind: 'faq',
        label: '常見問題',
      },
    ],
    download: '下載',
    menuOpen: '開啟選單',
    menuClose: '關閉選單',
    languageLabel: '語言',
    themeLabel: '主題',
    themeToLight: '切換為淺色主題',
    themeToDark: '切換為深色主題',
  },
  hero: {
    badge: 'macOS 預覽版，持續更新',
    title: '用自己的 AI，隨處翻譯',
    subtitle: '選取文字，按下快捷鍵。譯文就在目前視窗。',
    facts: ['不需要註冊帳號', '金鑰存在系統 Keychain', '請求直接連線供應商'],
    demo: {
      label: '翻譯預覽',
      language: '繁體中文',
      translation: '敏捷的棕色狐狸跳過了那隻懶狗。',
      metrics: 'gpt-4o-mini 翻譯，首字 380 毫秒',
    },
    platformsLabel: '下載',
    platforms: [
      {
        id: 'macos',
        name: 'macOS 版',
        requirement: 'macOS 13 或更新版本，Apple Silicon 與 Intel 皆可',
        actionLabel: '下載 macOS 版',
        statusLabel: '預覽版',
        note: '預覽版還沒有經過 Apple 公證：首次打開若被攔下，到「系統設定 → 隱私權與安全性」點「仍要打開」即可。',
      },
    ],
    notify: {
      title: '訂閱上線通知',
      description: '發布時寄一封通知給你；信箱只用於這一封上線通知。',
      emailLabel: '電子郵件',
      emailPlaceholder: 'you@example.com',
      submit: '訂閱上線通知',
      cancel: '取消',
      hint: '已記下這個信箱，發布時只會寄一封通知；隨時可以來信要求刪除。',
      error: '這次沒有送出成功，請稍後再試一次。',
    },
  },
  shortcuts: {
    label: '快捷鍵',
    title: '一個快捷鍵，少一次切換',
    description: '選詞、撰寫、取代、截圖，隨手就能譯。',
    items: [
      {
        keys: ['⌥', 'D'],
        name: '劃詞翻譯',
        description: '選取文字，在浮窗裡看譯文。',
      },
      {
        keys: ['⌥', 'A'],
        name: '撰寫視窗',
        description: '輸入母語，自動產生譯文。',
      },
      {
        keys: ['⌥', '⇧', 'T'],
        name: '輸入框原地替換',
        description: '翻譯並取代輸入框內容，可復原。',
      },
      {
        keys: ['⌥', 'S'],
        name: '截圖 OCR 翻譯',
        description: '框選螢幕，本機辨識後翻譯。',
      },
    ],
    extraTitle: '其他預設快捷鍵',
    extra: [
      {
        keys: ['⌥', 'C'],
        name: '靜默 OCR（只辨識並複製原文）',
      },
      {
        keys: ['⌥', '⇧', 'C'],
        name: '多模型比較（最多 4 個模型並排）',
      },
      {
        keys: ['⌥', 'R'],
        name: '朗讀選取文字',
      },
      {
        keys: ['按住右 ⌥'],
        name: '語音輸入（V1.1）',
      },
    ],
    extraNote: '快捷鍵可自訂，自動檢查衝突。',
  },
  logoWall: {
    label: '模型',
    title: '選你喜歡的模型',
    description: '支援主流 AI、自訂端點與本機模型。',
    providers: [
      'OpenAI',
      'Anthropic',
      'Google Gemini',
      'DeepSeek',
      '通義千問',
      '智譜 GLM',
      'Moonshot',
      'OpenRouter',
      'Ollama',
      'LM Studio',
      '自訂端點',
    ],
    footnote: '相容 OpenAI 介面，自動探索 Ollama / LM Studio。',
  },
  pillars: [
    {
      id: 'read',
      label: '讀',
      title: '選取，即翻譯',
      description: '在瀏覽器、文件或聊天裡查看譯文。',
      items: [
        {
          title: '劃詞 / 劃句翻譯',
          description:
            '優先透過輔助使用介面直接讀取選取文字；讀不到時改用模擬 ⌘C 的方式，並在結束後把剪貼簿還原成原本的內容。',
        },
        {
          title: '單字卡',
          description:
            '選取 3 個字以內會回傳結構化單字卡：音標、詞性、釋義、詞形變化、兩句例句與發音按鈕。',
        },
        {
          title: '多模型比較',
          description:
            '同一段文字同時送給最多 4 個已設定的模型，卡片並排顯示各自的耗時與 Token 數；標記「最佳」會把偏好存進本機統計，用來推薦預設模型。',
        },
        {
          title: '逐句對照',
          description: '長段落會依句子拆開、左右對照，逐句核對譯文時不用來回捲動。',
          tag: 'V1.1',
        },
      ],
      footnote:
        '驗收標準：在 Safari、Chrome、VS Code、Slack、微信、飛書、Notion、Preview（PDF）的取詞成功率 ≥ 95%。',
    },
    {
      id: 'write',
      label: '寫',
      title: '用母語，自在表達',
      description: '寫完按下快捷鍵，原地換成目標語言。',
      items: [
        {
          title: '撰寫視窗',
          description:
            '上方輸入、下方譯文，可切換來源與目標語言、模型與風格；「回譯」按鈕會把譯文翻回母語，讓你確認語氣有沒有跑掉。',
        },
        {
          title: '輸入框原地替換',
          description:
            '讀取目前選取內容（沒有選取就讀整個輸入框）→ 翻譯 → 寫回原位。處理時游標旁會顯示小型載入指示，失敗時保留原文並跳出提示。',
        },
        {
          title: '翻譯風格與 Prompt 預設',
          description:
            '內建標準、口語、正式商務、學術、技術文件（保留程式碼與專有名詞）等預設，也能自己寫系統 Prompt，支援 {source_lang}、{text}、{glossary}、{app_name} 變數。',
        },
        {
          title: '潤飾與糾錯',
          description: '文法修正、語氣改寫，也能把一段零散的話整理得更有條理。',
          tag: 'V1.1',
        },
      ],
      footnote:
        '目標語言可以固定，也可以「依 App 記住」：在 Slack 裡選過一次英文，之後在 Slack 裡就預設翻成英文。',
    },
    {
      id: 'look',
      label: '看',
      title: '截圖，也能翻譯',
      description: '字幕、掃描件、圖片裡的字都能辨識。',
      items: [
        {
          title: '截圖 OCR 翻譯',
          description:
            '⌥S 進入框選模式，十字游標與放大鏡協助定位；辨識結果會作為原文進入浮窗並直接翻譯。辨識在本機完成，截圖不會上傳。',
        },
        {
          title: '靜默 OCR',
          description: '⌥C 只辨識並直接複製原文，不顯示翻譯結果，適合只想把圖裡的字取出來。',
        },
        {
          title: '多模態讀圖翻譯',
          description:
            '預設 OCR 引擎是免費且在本機執行的 Apple Vision；漫畫、海報與複雜排版可以切換成多模態大模型直接讀圖翻譯。',
          tag: 'V1.1',
        },
        {
          title: '覆蓋模式',
          description: '把譯文貼回截圖中的原始位置，看漫畫與說明書時最直覺。',
          tag: 'V1.1',
        },
        {
          title: '語音輸入與語音翻譯',
          description:
            '按住右 ⌥ 說話、放開就出文字，可以用母語聽寫或直接輸出目標語言；轉寫可用官方語音額度、自己的金鑰，或本機 Whisper。',
          tag: 'V1.1',
        },
      ],
      footnote: '「螢幕錄製」權限只在你第一次使用截圖功能時才會詢問，用不到就不會打擾你。',
    },
  ],
  byok: {
    label: 'BYOK',
    title: '你的金鑰，你的資料',
    description: '金鑰留在本機，BYOK 請求直連你的模型。',
    points: [
      {
        title: '金鑰只存在本機 Keychain',
        description: '金鑰存系統 Keychain，不寫入設定或日誌。',
      },
      {
        title: '請求直接連線供應商',
        description: 'BYOK 直連供應商；官方額度經模型閘道。',
      },
      {
        title: '本機模型可離線',
        description: '接入 Ollama / LM Studio，內容不出本機。',
      },
    ],
    flowTitle: '三步完成翻譯',
    flow: ['選取文字，按 ⌥D', '直連你的模型', '譯文出現在浮窗'],
    costTitle: '按用量付費',
    costRows: [
      {
        label: '單次翻譯',
        value: '約 750 Token',
      },
      {
        label: '輕量模型單價',
        value: '約 $0.62 / 百萬 Token',
      },
      {
        label: '換算下來',
        value: '1,000 次約 $0.5',
      },
    ],
    costNote:
      '費用直接向供應商結算。按 gpt-4o-mini 牌價估算（每百萬 token 輸入 $0.15 / 輸出 $0.60），' +
      '翻譯 1,000 句（每句約 40 輸入 + 60 輸出 token）約 $0.04；換更強的模型會明顯更貴。',
  },
  features: {
    label: '更多功能',
    title: '細節，剛剛好',
    description: 'V1.0 優先功能；標註版本的功能將後續上線。',
    items: [
      {
        title: '翻譯風格',
        description: '口語、商務、學術，或自訂 Prompt。',
      },
      {
        title: '自訂快捷鍵',
        description: '錄製自己的鍵位，自動檢查衝突。',
      },
      {
        title: '本機歷史',
        description: '搜尋譯文，隱私模式不留紀錄。',
      },
      {
        title: '收藏',
        description: '儲存譯文，隨時回看。',
      },
      {
        title: '用量統計',
        description: '查看 Token 與費用，設定每月上限。',
      },
      {
        title: '發音朗讀',
        description: '聽原文和譯文，查看音標。',
      },
      {
        title: '免金鑰翻譯',
        description: '用網頁通道翻譯，不需設定金鑰。',
      },
      {
        title: '官方額度',
        description: '登入使用額度，隨時查看餘量。',
      },
    ],
  },
  comparison: {
    label: '比較',
    title: '一眼看懂差異',
    description: '平台、模型與費用，放在一起看。',
    columns: ['', 'umuo', 'DeepL 桌面版', 'Bob', 'Trancy Air'],
    rows: [
      {
        label: '支援平台',
        values: ['macOS 13+', 'macOS、Windows', 'macOS', 'macOS、Windows'],
      },
      {
        label: '自帶金鑰與本機模型',
        values: [
          'Keychain 存金鑰；本機模型可離線',
          '無法更換模型',
          '取決於第三方外掛',
          '自訂引擎需註冊帳號並經雲端同步',
        ],
      },
      {
        label: '計費方式',
        values: [
          'BYOK 免費；官方額度 $5.99 / 月起',
          '免費額度加訂閱',
          '部分能力需買斷',
          '訂閱制，價格依地區浮動',
        ],
      },
    ],
    footnote: '競品資訊以各家官網最新說明為準。',
  },
  pricing: {
    label: '定價',
    title: '簡單定價，自由選擇',
    description: '用戶端免費下載。自帶金鑰不限量，訂閱取得官方額度。',
    billingLabel: '計費週期',
    monthly: '月付',
    yearly: '年付',
    yearlyBadge: '約 35% 折扣',
    recommended: '推薦方案',
    tiers: [
      {
        id: 'free',
        name: 'Free 帳號',
        tagline: '輕量體驗',
        priceMonthly: '$0',
        priceYearly: '$0',
        periodMonthly: '永久免費',
        periodYearly: '永久免費',
        requirement: '需要帳號',
        features: [
          '快速檔 30 萬 Token / 月',
          '語音 30 分鐘 / 月（V1.1）',
          '設定雲端同步（V1.1，不含金鑰）',
          'BYOK / 本機模型 / 免金鑰通道不限量',
        ],
        cta: '建立帳號',
      },
      {
        id: 'pro',
        name: 'Pro',
        tagline: '日常翻譯夠用',
        priceMonthly: '$5.99',
        priceYearly: '$46.99',
        periodMonthly: '/ 月',
        periodYearly: '/ 年',
        requirement: '需要帳號',
        features: [
          '快速檔 300 萬 Token / 月',
          '語音 300 分鐘 / 月（V1.1）',
          '包含 Free 帳號額度',
          '月付試用 1 天，年付 3 天，期間取消免費',
        ],
        cta: '升級 Pro',
        highlight: true,
      },
      {
        id: 'pro-plus',
        name: 'Pro + 進階 AI',
        tagline: '更高品質',
        priceMonthly: '$11.99',
        priceYearly: '$93.99',
        periodMonthly: '/ 月',
        periodYearly: '/ 年',
        requirement: '需要帳號',
        features: [
          '包含 Pro 額度',
          '高品質模型',
          '進階檔 1,000 萬 Token / 月',
          '語音 600 分鐘 / 月（V1.1）',
        ],
        cta: '升級 Pro + 進階 AI',
      },
    ],
    openSource: {
      title: 'BYOK 永久免費',
      description: '所有用戶端功能免費，BYOK 不需帳號。',
    },
    addon: {
      title: '加油包 $3.99',
      description: '進階檔 +500 萬 Token，或語音 +300 分鐘，當期有效。',
    },
    regionalNote:
      '中國大陸使用微信支付：Pro ¥28／月、¥218／年，Pro + 進階 AI ¥58／月、¥448／年；其他地區以當地貨幣取整。',
    refundNote: '月付 7 天內、年付 30 天內無條件退費；含進階額度的方案會扣除已使用量後退還。',
    footnote: '年付約省 35%；Beta 期間額度可能調整。',
  },
  faq: {
    label: '常見問題',
    title: '常見問題',
    description: '關於使用、隱私與訂閱。',
    items: [
      {
        question: '什麼是 BYOK？',
        answer:
          '使用自己的 API Key，不需 umuo 帳號。費用直接付給模型供應商，也可使用免費的本機模型。',
      },
      {
        question: '各方案有什麼差異？',
        answer:
          '用戶端功能免費，訂閱增加官方額度。用完可加購或切換 BYOK。月付 7 天、年付 30 天內可退款，進階額度扣除已用費用。',
      },
      {
        question: '金鑰和內容會上傳嗎？',
        answer: 'BYOK 的金鑰留在本機，請求直連你的端點。官方額度透過閘道，不儲存翻譯內容。',
      },
      {
        question: '為什麼需要系統權限？',
        answer: '輔助使用用於取詞與寫回；螢幕錄製用於截圖。權限在使用對應功能時申請。',
      },
      {
        question: '沒有金鑰能用嗎？',
        answer: '可以選擇免金鑰網頁通道、本機模型，或登入使用官方額度。',
      },
      {
        question: '支援哪些系統？',
        answer: '目前僅支援 macOS 13+，相容 Apple Silicon 和 Intel。',
      },
      {
        question: '中國大陸網路怎麼用？',
        answer: '支援系統代理及 HTTP / SOCKS5 代理，也可選中國大陸供應商或離線模型。',
      },
    ],
  },
  footer: {
    ctaTitle: '翻譯，留在你的工作流程裡',
    ctaDescription: 'macOS 預覽版已可下載，選取文字按一下快捷鍵就能翻譯。',
    ctaDownload: '下載 macOS 版',
    ctaNotify: '訂閱上線通知',
    columns: [
      {
        title: '產品',
        links: [
          {
            kind: 'features',
            label: '功能',
          },
          {
            kind: 'pricing',
            label: '定價',
          },
          {
            kind: 'comparison',
            label: '比較',
          },
          {
            kind: 'faq',
            label: '常見問題',
          },
          {
            kind: 'top',
            label: '回到頂端',
          },
        ],
      },
      {
        title: '法務與聯絡',
        links: [
          {
            kind: 'privacy',
            label: '隱私政策',
          },
          {
            kind: 'terms',
            label: '服務條款',
          },
          {
            kind: 'contact',
            label: '聯絡信箱',
          },
        ],
      },
    ],
    comingSoon: '即將上線',
    legalNote: '隱私政策與服務條款將在正式發布前公布。',
    copyright: '© 2026 umuo',
    languageLabel: '語言',
  },
}
