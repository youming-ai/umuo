/**
 * 官网内容模型。
 *
 * 全站文案只有一个来源：每种语言一份 `SiteContent` 数据（`./<locale>.ts`），
 * 组件只负责摆放，不写死任何句子。新增语言 = 新增一个数据文件，
 * 类型不完整时 `tsc --noEmit` 会直接报错。
 */

export type Locale = 'zh-cn' | 'zh-tw' | 'en' | 'ja' | 'ko'

/** 首屏演示的四种模式：划词 / 闪电替换 / 截图 / 语音 */
export type DemoModeId = 'read' | 'write' | 'ocr' | 'speak'

/** 首屏下载按钮对应的平台 */
export type PlatformId = 'macos'

export interface SeoContent {
  /** <title> 与 og:title，含 SEO 关键词 */
  title: string
  /** meta description 与 og:description */
  description: string
  /** <html lang> 之外给 OG 用的语言标记，如 zh_CN */
  ogLocale: string
}

export interface NavContent {
  skipToContent: string
  themeLabel: string
  themeToLight: string
  themeToDark: string
}

export interface PlatformCard {
  id: PlatformId
  /** 系统要求，显示在下载按钮下方 */
  requirement: string
  actionLabel: string
  /** 下载按钮里的状态标签，例如「预览版」 */
  statusLabel: string
  /** 按钮下方的补充说明：未公证的预览版首次打开怎么放行 */
  note: string
  /** 触屏设备上替代下载按钮的说明：这是 Mac 应用 */
  mobileNote: string
  /** 触屏设备上「复制网址」按钮的文字、复制成功与失败后的文字 */
  copyLink: string
  copied: string
  copyFailed: string
  /** 点了下载之后就地出现的收尾：下载后接下来要做的几步 */
  afterDownload: {
    title: string
    steps: string[]
  }
}

/** 首屏演示的一种模式：上一行经快捷键变成下一行 */
export interface DemoMode {
  id: DemoModeId
  /** 切换按钮上的功能名 */
  name: string
  /** 状态标记，例如「开发中」；已发布的功能留空 */
  tag?: string
  /** 触发键位，键帽逐个渲染；键帽里只放键名（如「右 ⌥」），动作写进 keyHint */
  keys: string[]
  /** 键帽前的动作说明，例如「按住」；连按、组合键留空 */
  keyHint?: string
  /** 结果下方的一行补充，例如闪电替换的安全边界 */
  note?: string
  /** 演示底部的提示：怎样在这个页面上亲手试（触屏设备上隐藏） */
  hint: string
  /** 原文 / 草稿 / 口述 */
  before: string
  /** 译文 / 替换结果 / 整理后的文字 */
  after: string
}

export interface HeroContent {
  title: string
  subtitle: string
  /**
   * 下载按钮旁的一句「免费、自带 Key」说明，链到 `/pricing`（免费与开源页）。
   * 按 config.ts 的 `SOURCE_PUBLIC` 二选一：仓库公开前写「即将开源」，公开后写「MIT 开源」。
   */
  freeNote: { pending: string; public: string }
  demo: {
    label: string
    /** 第一项是默认展示的模式 */
    modes: DemoMode[]
  }
  platforms: PlatformCard[]
}

export interface FooterContent {
  /** 联系邮箱链接的文字 */
  contact: string
  copyright: string
  languageLabel: string
  /** 源码链接的文字；只在 `SOURCE_PUBLIC` 打开后显示 */
  source: string
}

/** 法律文本的正文块：字符串是段落，字符串数组是列表，`{ heading }` 是小节标题 */
export type LegalBlock = string | string[] | { heading: string }

export interface LegalDoc {
  /** 页面 h1，也是页脚链接文字 */
  title: string
  /** meta description */
  description: string
  /** 版本号与生效日期，显示在标题下 */
  meta: string
  /** 第 1 节之前的引言段落 */
  intro?: string[]
  sections: Array<{ heading: string; body: LegalBlock[] }>
}

/** 「免费与开源」页的一笔账：付给谁、多少、怎么付 */
export interface PricingBill {
  payee: string
  /** 金额：付给 umuo 的写「免费」；付给供应商的写「按用量」 */
  amount: string
  /** 金额下的一行小字 */
  cadence: string
  body: string
}

/** 「包含」清单的一行：功能名，配默认快捷键或状态标记（如「开发中」） */
export interface PricingFeature {
  name: string
  keys?: string[]
  tag?: string
}

/** `/pricing`（地址沿用旧的定价页）：umuo 免费、MIT 开源，模型费用只在用户与供应商之间 */
export interface PricingContent {
  /** 页面 h1，也是页眉链接文字 */
  title: string
  /** meta description */
  description: string
  lead: string
  /** 两笔账，像对照本的左右两页：umuo 本身免费，模型用量付给供应商 */
  bills: [PricingBill, PricingBill]
  /**
   * 源码一行，按 config.ts 的 `SOURCE_PUBLIC` 二选一：
   * 关闭时只显示 `pending`（「源码即将以 MIT 许可证公开」），打开后显示指向 `SOURCE_URL` 的 `link`。
   */
  source: { pending: string; link: string }
  /** 不包含：用一份短清单把「免费 + 自带 Key」反过来说清楚 */
  excluded: { title: string; items: string[] }
  /** 「包含」区块的标题 */
  included: string
  /** 标题下的一句：键位是默认值、可以改 */
  includedNote: string
  features: PricingFeature[]
}

export interface SiteContent {
  locale: Locale
  seo: SeoContent
  nav: NavContent
  hero: HeroContent
  footer: FooterContent
  /** 免费与开源页（`/pricing`）：umuo 免费、MIT 开源、自带模型 Key */
  pricing: PricingContent
  /** 服务条款与隐私政策（软件按 MIT 提供；条款只约束网站与官方发行版 + 请求直连） */
  legal: { terms: LegalDoc; privacy: LegalDoc }
}
