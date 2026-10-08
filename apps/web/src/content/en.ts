import type { SiteContent } from './types'

/**
 * English copy. Facts come from docs/PRD.md (§5 features, §6 BYOK, §7.2 shortcuts,
 * §10 pricing); wording is written for English readers rather than translated.
 */
export const en: SiteContent = {
  locale: 'en',
  seo: {
    title: 'umuo: Mac AI translator with your own API key (BYOK)',
    description:
      'System-wide AI translation for macOS: ⌥D selection, ⌥A writing window, ⌥⇧T in-place replace, ⌥S screenshot OCR. Bring your own key, stored in the local Keychain.',
    ogLocale: 'en_US',
  },
  nav: {
    skipToContent: 'Skip to main content',
    mainNavLabel: 'Main navigation',
    links: [
      {
        kind: 'features',
        label: 'Features',
      },
      {
        kind: 'pricing',
        label: 'Pricing',
      },
      {
        kind: 'comparison',
        label: 'Comparison',
      },
      {
        kind: 'faq',
        label: 'FAQ',
      },
    ],
    download: 'Download',
    menuOpen: 'Open menu',
    menuClose: 'Close menu',
    languageLabel: 'Language',
    themeLabel: 'Theme',
    themeToLight: 'Switch to light theme',
    themeToDark: 'Switch to dark theme',
  },
  hero: {
    badge: 'Preview for macOS, updated often',
    title: 'Your AI. Translation everywhere.',
    subtitle: 'Select text. Press a shortcut. Keep working.',
    facts: [
      'No account required',
      'Keys live in the system Keychain',
      'Requests go straight to your provider',
    ],
    demo: {
      label: 'Translation preview',
      language: 'English',
      translation: 'A swift brown fox leaps over the lazy dog.',
      metrics: 'Translated by gpt-4o-mini, first word in 380 ms',
    },
    platformsLabel: 'Download',
    platforms: [
      {
        id: 'macos',
        name: 'macOS',
        requirement: 'macOS 13 or later, Apple Silicon or Intel',
        actionLabel: 'Download for macOS',
        statusLabel: 'Preview',
        note: 'The preview isn’t notarized by Apple yet. If macOS blocks it the first time, go to System Settings → Privacy & Security and click “Open Anyway”.',
      },
    ],
    notify: {
      title: 'Launch notification',
      description: 'One email when it launches. The address is stored for that notice only.',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      submit: 'Notify me at launch',
      cancel: 'Cancel',
      hint: 'Saved. We will email you once at launch — ask us to delete it any time.',
      error: 'That did not go through. Please try again in a moment.',
    },
  },
  shortcuts: {
    label: 'Shortcuts',
    title: 'One shortcut. Fewer interruptions.',
    description: 'Select, write, replace, or capture text.',
    items: [
      {
        keys: ['⌥', 'D'],
        name: 'Translate a selection',
        description: 'Select text and read the translation in a panel.',
      },
      {
        keys: ['⌥', 'A'],
        name: 'Writing window',
        description: 'Write in your language. Get a translation automatically.',
      },
      {
        keys: ['⌥', '⇧', 'T'],
        name: 'Replace text in place',
        description: 'Translate and replace input text. Undo anytime.',
      },
      {
        keys: ['⌥', 'S'],
        name: 'Screenshot OCR',
        description: 'Capture an area. Recognize text locally, then translate.',
      },
    ],
    extraTitle: 'Other defaults',
    extra: [
      {
        keys: ['⌥', 'C'],
        name: 'Silent OCR (copy the original text only)',
      },
      {
        keys: ['⌥', '⇧', 'C'],
        name: 'Compare models (up to four side by side)',
      },
      {
        keys: ['⌥', 'R'],
        name: 'Read the selection aloud',
      },
      {
        keys: ['Hold right ⌥'],
        name: 'Voice input (V1.1)',
      },
    ],
    extraNote: 'Customize shortcuts with automatic conflict checks.',
  },
  logoWall: {
    label: 'Models',
    title: 'Choose your model',
    description: 'Use leading AI providers, custom endpoints, or local models.',
    providers: [
      'OpenAI',
      'Anthropic',
      'Google Gemini',
      'DeepSeek',
      'Qwen',
      'Zhipu GLM',
      'Moonshot',
      'OpenRouter',
      'Ollama',
      'LM Studio',
      'Custom endpoint',
    ],
    footnote: 'OpenAI compatible. Automatically discovers Ollama / LM Studio.',
  },
  pillars: [
    {
      id: 'read',
      label: 'Read',
      title: 'Select and translate',
      description: 'Read translations in browsers, documents, and chats.',
      items: [
        {
          title: 'Translate a selection or a sentence',
          description:
            'Selected text is read through the accessibility API first; if that fails, umuo simulates ⌘C and restores your clipboard when it is done.',
        },
        {
          title: 'Word cards',
          description:
            'Select three words or fewer and you get a structured card: phonetics, part of speech, definitions, inflections, two example sentences and a play button.',
        },
        {
          title: 'Compare models',
          description:
            'Send one passage to up to four configured models at once and see latency and token counts side by side. Mark the best result and that preference feeds local statistics that suggest your default model.',
        },
        {
          title: 'Sentence-by-sentence view',
          description:
            'Long passages are split into sentences and shown side by side, so you can check a translation without scrolling back and forth.',
          tag: 'V1.1',
        },
      ],
      footnote:
        'Our acceptance bar: at least 95% success reading the selection in Safari, Chrome, VS Code, Slack, WeChat, Feishu, Notion and Preview.',
    },
    {
      id: 'write',
      label: 'Write',
      title: 'Write in your language',
      description: 'Turn your draft into the target language in place.',
      items: [
        {
          title: 'Writing window',
          description:
            'Input on top, translation below, with source and target language, model and style selectors. Back-translate renders the result in your own language so you can check the tone before you send it.',
        },
        {
          title: 'Replace text in place',
          description:
            'Reads the current selection (or the whole field when nothing is selected), translates, writes the result back. A small spinner sits near the caret while it works; on failure your text stays as it was and a toast explains why.',
        },
        {
          title: 'Styles and prompt presets',
          description:
            'Presets for standard, casual, formal business, academic and technical writing (code and proper nouns preserved), plus your own system prompt with {source_lang}, {text}, {glossary} and {app_name} variables.',
        },
        {
          title: 'Polish and correction',
          description:
            'Grammar fixes, tone rewrites, and turning a rambling paragraph into something clearly organised.',
          tag: 'V1.1',
        },
      ],
      footnote:
        'Fix the target language, or let umuo remember it per app: pick English once in Slack and Slack keeps using English.',
    },
    {
      id: 'look',
      label: 'Look',
      title: 'Translate your screen',
      description: 'Capture text from subtitles, scans, or images.',
      items: [
        {
          title: 'Screenshot OCR',
          description:
            'Press ⌥S to enter selection mode, with a crosshair and a magnifier. The recognised text becomes the source and is translated right away. Recognition runs on your Mac; the screenshot is never uploaded.',
        },
        {
          title: 'Silent OCR',
          description:
            '⌥C recognises the text and copies it, with no translation window. For when you only wanted the characters out of the image.',
        },
        {
          title: 'Multimodal image translation',
          description:
            'The default OCR engine is Apple Vision: local and free. For comics, posters and complex layouts, switch to a multimodal model that reads the image directly.',
          tag: 'V1.1',
        },
        {
          title: 'Overlay mode',
          description:
            'Paste the translation back over the original spot in the screenshot. The clearest option for comics and manuals.',
          tag: 'V1.1',
        },
        {
          title: 'Voice input and speech translation',
          description:
            'Hold right ⌥, speak, release, and the text is there. Dictate in your own language or speak it and get the target language back. Transcribe with official voice quota, your own key, or local Whisper.',
          tag: 'V1.1',
        },
      ],
      footnote:
        'The screen recording permission is requested the first time you take a screenshot. If you never use it, you are never asked.',
    },
  ],
  byok: {
    label: 'BYOK',
    title: 'Your key. Your data.',
    description: 'Keys stay on your device. BYOK requests go directly to your model.',
    points: [
      {
        title: 'The key stays in the local Keychain',
        description: 'Keys stay in Keychain, out of config files and logs.',
      },
      {
        title: 'Requests go straight to the provider',
        description: 'BYOK connects directly. Included usage goes through our gateway.',
      },
      {
        title: 'Local models work offline',
        description: 'Use Ollama / LM Studio without sending content off your device.',
      },
    ],
    flowTitle: 'Translate in three steps',
    flow: ['Select text and press ⌥D', 'Connect to your model', 'Read the translation'],
    costTitle: 'Pay for what you use',
    costRows: [
      {
        label: 'One translation',
        value: 'About 750 tokens',
      },
      {
        label: 'Lightweight model',
        value: 'About $0.62 per million tokens',
      },
      {
        label: 'In practice',
        value: 'About $0.50 for 1,000 translations',
      },
    ],
    costNote:
      'You pay your provider directly. At gpt-4o-mini list prices ($0.15 / $0.60 per million tokens),' +
      ' translating 1,000 sentences (~40 input + 60 output tokens each) costs about $0.04 — stronger models cost noticeably more.',
  },
  features: {
    label: 'More',
    title: 'Useful details',
    description: 'Planned for V1.0. Version labels indicate later releases.',
    items: [
      {
        title: 'Translation styles',
        description: 'Casual, business, academic, or your own prompt.',
      },
      {
        title: 'Custom shortcuts',
        description: 'Record your shortcuts with conflict checks.',
      },
      {
        title: 'Local history',
        description: 'Search translations. Privacy mode keeps no history.',
      },
      {
        title: 'Favorites',
        description: 'Save translations for later.',
      },
      {
        title: 'Usage tracking',
        description: 'Track tokens and costs. Set monthly limits.',
      },
      {
        title: 'Read aloud',
        description: 'Listen to text and check pronunciation.',
      },
      {
        title: 'No key needed',
        description: 'Use web translation without an API key.',
      },
      {
        title: 'Included AI usage',
        description: 'Sign in and check your remaining allowance.',
      },
    ],
  },
  comparison: {
    label: 'Comparison',
    title: 'Compare at a glance',
    description: 'Platforms, models, and pricing side by side.',
    columns: ['', 'umuo', 'DeepL Desktop', 'Bob', 'Trancy Air'],
    rows: [
      {
        label: 'Platforms',
        values: ['macOS 13+', 'macOS, Windows', 'macOS', 'macOS, Windows'],
      },
      {
        label: 'Your own key and local models',
        values: [
          'Keys in Keychain; offline local models',
          'The model cannot be changed',
          'Depends on third-party plugins',
          'Custom engines need an account and sync through their cloud',
        ],
      },
      {
        label: 'Pricing',
        values: [
          'Free BYOK; included usage from $5.99 / month',
          'Free tier plus subscription',
          'Some capabilities are one-time purchases',
          'Subscription, priced by region',
        ],
      },
    ],
    footnote: 'Check each provider’s website for current details.',
  },
  pricing: {
    label: 'Pricing',
    title: 'Simple pricing. Your choice.',
    description: 'The client is free to download. Unlimited BYOK. Subscribe for included AI usage.',
    billingLabel: 'Billing period',
    monthly: 'Monthly',
    yearly: 'Yearly',
    yearlyBadge: 'About 35% off',
    recommended: 'Recommended',
    tiers: [
      {
        id: 'free',
        name: 'Free account',
        tagline: 'Try it out',
        priceMonthly: '$0',
        priceYearly: '$0',
        periodMonthly: 'free forever',
        periodYearly: 'free forever',
        requirement: 'Account required',
        features: [
          '300K fast tokens / month',
          '30 voice minutes / month (V1.1)',
          'Settings sync (V1.1, excludes keys)',
          'Unlimited BYOK, local models, and web translation',
        ],
        cta: 'Create an account',
      },
      {
        id: 'pro',
        name: 'Pro',
        tagline: 'Enough for daily work',
        priceMonthly: '$5.99',
        priceYearly: '$46.99',
        periodMonthly: '/ month',
        periodYearly: '/ year',
        requirement: 'Account required',
        features: [
          '3M fast tokens / month',
          '300 voice minutes / month (V1.1)',
          'Includes Free account allowance',
          '1 day monthly / 3 days yearly trial; cancel free',
        ],
        cta: 'Upgrade to Pro',
        highlight: true,
      },
      {
        id: 'pro-plus',
        name: 'Pro + Advanced AI',
        tagline: 'Higher quality',
        priceMonthly: '$11.99',
        priceYearly: '$93.99',
        periodMonthly: '/ month',
        periodYearly: '/ year',
        requirement: 'Account required',
        features: [
          'Includes Pro allowance',
          'Higher quality models',
          '10M advanced tokens / month',
          '600 voice minutes / month (V1.1)',
        ],
        cta: 'Upgrade to Pro + Advanced AI',
      },
    ],
    openSource: {
      title: 'BYOK, free forever',
      description: 'All client features are free. BYOK needs no account.',
    },
    addon: {
      title: 'Top-up, $3.99',
      description: '+5M advanced tokens or +300 voice minutes, valid for the current period.',
    },
    regionalNote:
      'Mainland China pays by WeChat: Pro ¥28/month or ¥218/year, Pro + Advanced AI ¥58/month or ¥448/year. Elsewhere, prices are rounded in local currency.',
    refundNote:
      'Refunds within 7 days on monthly and 30 days on yearly plans, no questions asked. Tiers that include advanced quota are refunded minus what you already used.',
    footnote: 'Save about 35% yearly. Beta allowances may change.',
  },
  faq: {
    label: 'FAQ',
    title: 'Common questions',
    description: 'Usage, privacy, and subscriptions.',
    items: [
      {
        question: 'What is BYOK?',
        answer:
          'Bring your own API key. No umuo account required. Pay your model provider directly, or use a free local model.',
      },
      {
        question: 'How do the plans differ?',
        answer:
          'Client features are free. Subscriptions add AI usage. Top up or switch to BYOK when it runs out. Refunds: 7 days monthly, 30 days yearly; used advanced credits are deducted.',
      },
      {
        question: 'Are keys or content uploaded?',
        answer:
          'BYOK keys stay on your device and requests go directly to your endpoint. Included usage uses our gateway, which does not store translations.',
      },
      {
        question: 'Why are system permissions needed?',
        answer:
          'Accessibility reads and replaces text. Screen recording captures selected areas. Permissions are requested when needed.',
      },
      {
        question: 'Can I use it without a key?',
        answer: 'Yes. Use web translation, local models, or sign in for included AI usage.',
      },
      {
        question: 'Which systems are supported?',
        answer: 'Currently macOS 13+ only, on Apple Silicon and Intel.',
      },
      {
        question: 'How do I use it in mainland China?',
        answer:
          'Use system, HTTP, or SOCKS5 proxies, a locally available provider, or an offline model.',
      },
    ],
  },
  footer: {
    ctaTitle: 'Keep translation in your workflow',
    ctaDescription: 'The macOS preview is ready to download. Select text, press a shortcut, done.',
    ctaDownload: 'Download for macOS',
    ctaNotify: 'Notify me at launch',
    columns: [
      {
        title: 'Product',
        links: [
          {
            kind: 'features',
            label: 'Features',
          },
          {
            kind: 'pricing',
            label: 'Pricing',
          },
          {
            kind: 'comparison',
            label: 'Comparison',
          },
          {
            kind: 'faq',
            label: 'FAQ',
          },
          {
            kind: 'top',
            label: 'Back to top',
          },
        ],
      },
      {
        title: 'Legal and contact',
        links: [
          {
            kind: 'privacy',
            label: 'Privacy policy',
          },
          {
            kind: 'terms',
            label: 'Terms of service',
          },
          {
            kind: 'contact',
            label: 'Contact email',
          },
        ],
      },
    ],
    comingSoon: 'Coming soon',
    legalNote: 'Privacy policy and terms will be available before launch.',
    copyright: '© 2026 umuo',
    languageLabel: 'Language',
  },
}
