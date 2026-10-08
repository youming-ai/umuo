import type { SiteContent } from './types'

/**
 * 简体中文文案（首发语言，也是其他语言的参考文本）。
 * 事实性内容来自 docs/PRD.md：§11.2 页面结构、§5 功能、§6 BYOK、§10 定价。
 */
export const zhCn: SiteContent = {
  locale: 'zh-cn',
  seo: {
    title: 'umuo — 用你自己的 AI，翻译你看到的一切',
    description:
      'umuo 是 macOS 系统级 AI 翻译客户端：⌥D 划词翻译、⌥A 撰写窗、⌥⇧T 输入框原地替换、⌥S 截图 OCR。自带 API Key（BYOK），Key 只存本机 Keychain，请求从你的电脑直连厂商，也可接 Ollama 等本地模型离线翻译。',
    ogLocale: 'zh_CN',
  },
  nav: {
    skipToContent: '跳到主要内容',
    mainNavLabel: '主导航',
    links: [
      {
        kind: 'features',
        label: '功能',
      },
      {
        kind: 'pricing',
        label: '定价',
      },
      {
        kind: 'comparison',
        label: '对比',
      },
      {
        kind: 'faq',
        label: '常见问题',
      },
    ],
    download: '下载',
    menuOpen: '打开菜单',
    menuClose: '关闭菜单',
    languageLabel: '语言',
    themeLabel: '主题',
    themeToLight: '切换到浅色主题',
    themeToDark: '切换到深色主题',
  },
  hero: {
    badge: 'macOS 版 V1.0 开发中',
    title: '用自己的 AI，随处翻译',
    subtitle: '选中文字，按下快捷键。译文就在当前窗口。',
    facts: ['无需注册账号', 'Key 存系统 Keychain', '请求直连厂商'],
    demo: {
      label: '翻译预览',
      language: '简体中文',
      translation: '敏捷的棕色狐狸跳过了那只懒狗。',
      metrics: 'gpt-4o-mini 翻译，首字 380 毫秒',
    },
    platformsLabel: '下载',
    platforms: [
      {
        id: 'macos',
        name: 'macOS 版',
        requirement: 'macOS 13 或更高版本，Apple Silicon 与 Intel 均可',
        actionLabel: '下载 macOS 版',
        statusLabel: 'V1.0 开发中',
        note: '安装包还没发布。留个邮箱，发布当天通知你。',
      },
    ],
    notify: {
      title: '订阅上线通知',
      description: '发布时给你一封邮件；邮箱只用于这一封上线通知。',
      emailLabel: '邮箱',
      emailPlaceholder: 'you@example.com',
      submit: '订阅上线通知',
      cancel: '取消',
      hint: '已记下这个邮箱，发布时只会给你发一封邮件；随时可以来信要求删除。',
      error: '这次没有提交成功，稍后再试一次。',
    },
  },
  shortcuts: {
    label: '快捷键',
    title: '一个快捷键，少一次切换',
    description: '划词、撰写、替换、截图，随手就能译。',
    items: [
      {
        keys: ['⌥', 'D'],
        name: '划词翻译',
        description: '选中文字，在浮窗里看译文。',
      },
      {
        keys: ['⌥', 'A'],
        name: '撰写窗',
        description: '输入母语，自动生成译文。',
      },
      {
        keys: ['⌥', '⇧', 'T'],
        name: '输入框原地替换',
        description: '翻译并替换输入框内容，可撤销。',
      },
      {
        keys: ['⌥', 'S'],
        name: '截图 OCR 翻译',
        description: '框选屏幕，本机识别后翻译。',
      },
    ],
    extraTitle: '其他默认快捷键',
    extra: [
      {
        keys: ['⌥', 'C'],
        name: '静默 OCR（只识别并复制原文）',
      },
      {
        keys: ['⌥', '⇧', 'C'],
        name: '多模型对比（最多 4 个模型并排）',
      },
      {
        keys: ['⌥', 'R'],
        name: '朗读选中文本',
      },
      {
        keys: ['按住右 ⌥'],
        name: '语音输入（V1.1）',
      },
    ],
    extraNote: '快捷键可自定义，自动检查冲突。',
  },
  logoWall: {
    label: '模型',
    title: '选你喜欢的模型',
    description: '支持主流 AI、自定义端点和本地模型。',
    providers: [
      'OpenAI',
      'Anthropic',
      'Google Gemini',
      'DeepSeek',
      '通义千问',
      '智谱 GLM',
      'Moonshot',
      'OpenRouter',
      'Ollama',
      'LM Studio',
      '自定义端点',
    ],
    footnote: '兼容 OpenAI 接口，自动发现 Ollama / LM Studio。',
  },
  pillars: [
    {
      id: 'read',
      label: '读',
      title: '选中，即翻译',
      description: '在浏览器、文档或聊天里查看译文。',
      items: [
        {
          title: '划词 / 划句翻译',
          description:
            '优先用辅助功能接口直接读取选中文本；取不到时降级为模拟 ⌘C，并在结束后把剪贴板恢复原样。',
        },
        {
          title: '单词词卡',
          description:
            '选中 3 个词以内返回结构化词卡：音标、词性、释义、词形变化、两条例句和发音按钮。',
        },
        {
          title: '多模型对比',
          description:
            '同一段文字并行发给最多 4 个已配置模型，卡片横排显示各自耗时与 Token 数；标记「最佳」会让偏好进入本地统计，用于推荐默认模型。',
        },
        {
          title: '逐句对照',
          description: '长段落按句拆分、左右对照，逐句核对译文时不用来回滚动。',
          tag: 'V1.1',
        },
      ],
      footnote:
        '验收标准：Safari、Chrome、VS Code、Slack、微信、飞书、Notion、Preview（PDF）中取词成功率 ≥ 95%。',
    },
    {
      id: 'write',
      label: '写',
      title: '用母语，自在表达',
      description: '写完按下快捷键，原地换成目标语言。',
      items: [
        {
          title: '撰写窗',
          description:
            '上输入下译文，支持切换源 / 目标语言、模型与风格；「回译」按钮把译文翻回母语，用来自检语气是否走样。',
        },
        {
          title: '输入框原地替换',
          description:
            '读取当前选中内容（没选中就读整个输入框）→ 翻译 → 写回原位。处理中光标附近显示小型加载指示，失败时保留原文并给出提示。',
        },
        {
          title: '翻译风格与 Prompt 预设',
          description:
            '内置标准、口语、正式商务、学术、技术文档（保留代码与专有名词）等预设，也能自己写系统 Prompt，支持 {source_lang}、{text}、{glossary}、{app_name} 变量。',
        },
        {
          title: '润色与纠错',
          description: '语法纠错、语气改写，以及把整段话按意图整理得更清楚。',
          tag: 'V1.1',
        },
      ],
      footnote:
        '目标语言可以固定，也可以「按 App 记忆」——例如在 Slack 里选过一次英文，之后在 Slack 里就默认翻成英文。',
    },
    {
      id: 'look',
      label: '看',
      title: '截图，也能翻译',
      description: '字幕、扫描件、图片里的字都能识别。',
      items: [
        {
          title: '截图 OCR 翻译',
          description:
            '⌥S 进入框选模式，十字光标与放大镜辅助定位；识别结果作为原文进入浮窗并直接翻译。识别在本机完成，截图不会上传。',
        },
        {
          title: '静默 OCR',
          description: '⌥C 只识别、直接复制原文，不弹翻译结果，适合只想把图里的字抠出来。',
        },
        {
          title: '多模态识图翻译',
          description:
            '默认 OCR 引擎是本地、免费的 Apple Vision；漫画、海报、复杂排版可以切换成多模态大模型直接识图翻译。',
          tag: 'V1.1',
        },
        {
          title: '覆盖模式',
          description: '把译文贴回截图中的原位置，看漫画和说明书时最直观。',
          tag: 'V1.1',
        },
        {
          title: '语音输入与语音翻译',
          description:
            '按住右 ⌥ 说话、松开即出文字，可以输入母语或直接输出目标语言；转写可用官方语音额度、自己的 Key，或本地 Whisper。',
          tag: 'V1.1',
        },
      ],
      footnote: '「屏幕录制」权限只在你第一次用截图功能时申请，用不到就不问。',
    },
  ],
  byok: {
    label: 'BYOK',
    title: '你的 Key，你的数据',
    description: 'Key 留在本机，BYOK 请求直连你的模型。',
    points: [
      {
        title: 'Key 只存本机 Keychain',
        description: 'Key 存系统 Keychain，不写入配置或日志。',
      },
      {
        title: '请求直连厂商',
        description: 'BYOK 直连厂商；官方额度经模型网关。',
      },
      {
        title: '本地模型可离线',
        description: '接入 Ollama / LM Studio，内容不出本机。',
      },
    ],
    flowTitle: '三步完成翻译',
    flow: ['选中文字，按 ⌥D', '直连你的模型', '译文出现在浮窗'],
    costTitle: '按用量付费',
    costRows: [
      {
        label: '单次翻译',
        value: '约 750 Token',
      },
      {
        label: '轻量模型单价',
        value: '约 $0.62 / 百万 Token',
      },
      {
        label: '折合下来',
        value: '1,000 次约 $0.5',
      },
    ],
    costNote:
      '费用直接向厂商结算。按 gpt-4o-mini 牌价估算（每百万 token 输入 $0.15 / 输出 $0.60），' +
      '翻译 1,000 句（每句约 40 输入 + 60 输出 token）约 $0.04；换更强的模型会明显更贵。',
  },
  features: {
    label: '更多功能',
    title: '细节，刚刚好',
    description: 'V1.0 优先功能；标注版本的功能将后续上线。',
    items: [
      {
        title: '翻译风格',
        description: '口语、商务、学术，或自定义 Prompt。',
      },
      {
        title: '自定义快捷键',
        description: '录制自己的键位，自动检查冲突。',
      },
      {
        title: '本地历史',
        description: '搜索译文，隐私模式不留记录。',
      },
      {
        title: '收藏',
        description: '保存译文，随时回看。',
      },
      {
        title: '用量统计',
        description: '查看 Token 与费用，设置月度上限。',
      },
      {
        title: '发音朗读',
        description: '听原文和译文，查看音标。',
      },
      {
        title: '免 Key 翻译',
        description: '用网页通道翻译，无需配置 Key。',
      },
      {
        title: '官方额度',
        description: '登录使用额度，随时查看余量。',
      },
    ],
  },
  comparison: {
    label: '对比',
    title: '一眼看懂区别',
    description: '平台、模型与费用，放在一起看。',
    columns: ['', 'umuo', 'DeepL 桌面版', 'Bob', 'Trancy Air'],
    rows: [
      {
        label: '支持平台',
        values: ['macOS 13+', 'macOS、Windows', 'macOS', 'macOS、Windows'],
      },
      {
        label: '自带 Key 与本地模型',
        values: [
          'Keychain 存 Key；本地模型可离线',
          '无法换模型',
          '取决于第三方插件',
          '自定义引擎需注册账号并经云端同步',
        ],
      },
      {
        label: '计费方式',
        values: [
          'BYOK 免费；官方额度 $5.99 / 月起',
          '免费额度 + 订阅',
          '部分能力需付费买断',
          '订阅制，价格按地区浮动',
        ],
      },
    ],
    footnote: '竞品信息以各家官网最新说明为准。',
  },
  pricing: {
    label: '定价',
    title: '简单定价，自由选择',
    description: '客户端免费下载。自带 Key 不限量，订阅获取官方额度。',
    billingLabel: '计费周期',
    monthly: '月付',
    yearly: '年付',
    yearlyBadge: '约 35% 折扣',
    recommended: '推荐方案',
    tiers: [
      {
        id: 'free',
        name: 'Free 账号',
        tagline: '轻量体验',
        priceMonthly: '$0',
        priceYearly: '$0',
        periodMonthly: '永久免费',
        periodYearly: '永久免费',
        requirement: '需要账号',
        features: [
          '快速档 30 万 Token / 月',
          '语音 30 分钟 / 月（V1.1）',
          '设置云同步（V1.1，不含 Key）',
          'BYOK / 本地模型 / 免 Key 通道不限量',
        ],
        cta: '创建账号',
      },
      {
        id: 'pro',
        name: 'Pro',
        tagline: '日常翻译够用',
        priceMonthly: '$5.99',
        priceYearly: '$46.99',
        periodMonthly: '/ 月',
        periodYearly: '/ 年',
        requirement: '需要账号',
        features: [
          '快速档 300 万 Token / 月',
          '语音 300 分钟 / 月（V1.1）',
          '包含 Free 账号额度',
          '月付试用 1 天，年付 3 天，期内取消免费',
        ],
        cta: '升级 Pro',
        highlight: true,
      },
      {
        id: 'pro-plus',
        name: 'Pro + 高级 AI',
        tagline: '更高质量',
        priceMonthly: '$11.99',
        priceYearly: '$93.99',
        periodMonthly: '/ 月',
        periodYearly: '/ 年',
        requirement: '需要账号',
        features: [
          '包含 Pro 额度',
          '高质量模型',
          '高级档 1,000 万 Token / 月',
          '语音 600 分钟 / 月（V1.1）',
        ],
        cta: '升级 Pro + 高级 AI',
      },
    ],
    openSource: {
      title: 'BYOK 永久免费',
      description: '全部客户端功能免费，BYOK 无需账号。',
    },
    addon: {
      title: '加油包 $3.99',
      description: '高级档 +500 万 Token，或语音 +300 分钟，当期有效。',
    },
    regionalNote:
      '中国大陆走微信支付：Pro ¥28／月、¥218／年，Pro + 高级 AI ¥58／月、¥448／年；其他地区按本地货币取整。',
    refundNote: '月付 7 天、年付 30 天内无条件退款；含高级额度的档位扣除已用量后退还。',
    footnote: '年付约省 35%；Beta 期间额度可能调整。',
  },
  faq: {
    label: '常见问题',
    title: '常见问题',
    description: '关于使用、隐私与订阅。',
    items: [
      {
        question: '什么是 BYOK？',
        answer:
          '使用自己的 API Key，无需 umuo 账号。费用直接付给模型厂商，也可使用免费的本地模型。',
      },
      {
        question: '各套餐有什么区别？',
        answer:
          '客户端功能免费，订阅增加官方额度。用完可加购或切换 BYOK。月付 7 天、年付 30 天内可退款，高级额度扣除已用费用。',
      },
      {
        question: 'Key 和内容会上传吗？',
        answer: 'BYOK 的 Key 留在本机，请求直连你的端点。官方额度通过网关，不保存翻译内容。',
      },
      {
        question: '为什么需要系统权限？',
        answer: '辅助功能用于取词与写回；屏幕录制用于截图。权限在使用相应功能时申请。',
      },
      {
        question: '没有 Key 能用吗？',
        answer: '可以选择免 Key 网页通道、本地模型，或登录使用官方额度。',
      },
      {
        question: '支持哪些系统？',
        answer: '目前仅支持 macOS 13+，兼容 Apple Silicon 和 Intel。',
      },
      {
        question: '国内网络怎么用？',
        answer: '支持系统代理及 HTTP / SOCKS5 代理，也可选国内厂商或离线模型。',
      },
    ],
  },
  footer: {
    ctaTitle: '翻译，留在你的工作流里',
    ctaDescription: 'macOS 版开发中，发布时通知你。',
    ctaDownload: '下载 macOS 版',
    ctaNotify: '订阅上线通知',
    columns: [
      {
        title: '产品',
        links: [
          {
            kind: 'features',
            label: '功能',
          },
          {
            kind: 'pricing',
            label: '定价',
          },
          {
            kind: 'comparison',
            label: '对比',
          },
          {
            kind: 'faq',
            label: '常见问题',
          },
          {
            kind: 'top',
            label: '回到顶部',
          },
        ],
      },
      {
        title: '法务与联系',
        links: [
          {
            kind: 'privacy',
            label: '隐私政策',
          },
          {
            kind: 'terms',
            label: '服务条款',
          },
          {
            kind: 'contact',
            label: '联系邮箱',
          },
        ],
      },
    ],
    comingSoon: '即将上线',
    legalNote: '隐私政策与服务条款将在正式发布前公布。',
    copyright: '© 2026 umuo',
    languageLabel: '语言',
  },
}
