/**
 * 官网内容模型。
 *
 * 全站文案只有一个来源：每种语言一份 `SiteContent` 数据（`./<locale>.ts`），
 * 组件只负责摆放，不写死任何句子。新增语言 = 新增一个数据文件，
 * 类型不完整时 `tsc --noEmit` 会直接报错。
 */

export type Locale = 'zh-cn' | 'zh-tw' | 'en' | 'ja' | 'ko'

/** 导航与页脚可用的站内锚点 / 外链目标 */
export type NavLinkKind = 'product' | 'features' | 'pricing' | 'comparison' | 'faq'

export type FooterLinkKind = NavLinkKind | 'privacy' | 'terms' | 'contact' | 'top'

/** 「读 / 写 / 看」三段 */
export type PillarId = 'read' | 'write' | 'look'

/** Hero 的下载区三张卡片 */
export type PlatformId = 'macos' | 'windows' | 'linux'

export type TierId = 'free' | 'pro' | 'pro-plus'

export type Billing = 'monthly' | 'yearly'

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
  mainNavLabel: string
  links: { kind: NavLinkKind; label: string }[]
  download: string
  /** 移动端菜单 */
  menuOpen: string
  menuClose: string
  languageLabel: string
  themeLabel: string
  themeToLight: string
  themeToDark: string
}

export interface PlatformCard {
  id: PlatformId
  name: string
  requirement: string
  /** 按钮文案；主平台是「下载 macOS 版」，未发布平台是「订阅上线通知」 */
  actionLabel: string
  /** 次要说明，例如版本计划 */
  statusLabel: string
  note: string
}

export interface NotifyFormContent {
  title: string
  description: string
  emailLabel: string
  emailPlaceholder: string
  submit: string
  cancel: string
  /** 提交成功后显示的一句确认：存了什么、怎么删 */
  hint: string
  /** 提交失败（接口不通或被限流）时显示的一句提示 */
  error: string
}

export interface HeroContent {
  badge: string
  title: string
  subtitle: string
  facts: string[]
  demo: {
    label: string
    language: string
    translation: string
    /** 演示译文下方的一行说明：用了哪个模型、多快 */
    metrics: string
  }
  platformsLabel: string
  platforms: PlatformCard[]
  notify: NotifyFormContent
}

export interface ShortcutItem {
  keys: string[]
  name: string
  description: string
  /** 版本标记，例如 V1.1；V1.0 首发功能留空 */
  tag?: string
}

export interface ShortcutContent {
  label: string
  title: string
  description: string
  items: ShortcutItem[]
  extraTitle: string
  extra: { keys: string[]; name: string }[]
  extraNote: string
}

export interface LogoWallContent {
  label: string
  title: string
  description: string
  providers: string[]
  footnote: string
}

export interface PillarItem {
  title: string
  description: string
  tag?: string
}

export interface PillarContent {
  id: PillarId
  label: string
  title: string
  description: string
  items: PillarItem[]
  footnote: string
}

export interface ByokContent {
  label: string
  title: string
  description: string
  points: PillarItem[]
  flowTitle: string
  flow: string[]
  costTitle: string
  costRows: { label: string; value: string }[]
  costNote: string
}

export interface FeatureGridContent {
  label: string
  title: string
  description: string
  items: PillarItem[]
}

export interface ComparisonContent {
  label: string
  title: string
  description: string
  /** 第一列是行标题列，留空字符串 */
  columns: string[]
  rows: { label: string; values: string[] }[]
  footnote: string
}

export interface PriceTier {
  id: TierId
  name: string
  tagline: string
  priceMonthly: string
  priceYearly: string
  periodMonthly: string
  periodYearly: string
  /** 「需要账号」这类前置条件 */
  requirement: string
  features: string[]
  cta: string
  highlight?: boolean
}

export interface PricingContent {
  label: string
  title: string
  description: string
  billingLabel: string
  monthly: string
  yearly: string
  yearlyBadge: string
  recommended: string
  tiers: PriceTier[]
  openSource: { title: string; description: string }
  addon: { title: string; description: string }
  regionalNote: string
  refundNote: string
  footnote: string
}

export interface FaqContent {
  label: string
  title: string
  description: string
  items: { question: string; answer: string }[]
}

export interface FooterContent {
  ctaTitle: string
  ctaDescription: string
  ctaDownload: string
  ctaNotify: string
  columns: { title: string; links: { kind: FooterLinkKind; label: string }[] }[]
  /** 指向「即将上线」而非死链的条目，键为链接 kind */
  comingSoon: string
  legalNote: string
  copyright: string
  languageLabel: string
}

export interface SiteContent {
  locale: Locale
  seo: SeoContent
  nav: NavContent
  hero: HeroContent
  shortcuts: ShortcutContent
  logoWall: LogoWallContent
  pillars: PillarContent[]
  byok: ByokContent
  features: FeatureGridContent
  comparison: ComparisonContent
  pricing: PricingContent
  faq: FaqContent
  footer: FooterContent
}
