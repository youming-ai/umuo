/**
 * 官网内容模型。
 *
 * 全站文案只有一个来源：每种语言一份 `SiteContent` 数据（`./<locale>.ts`），
 * 组件只负责摆放，不写死任何句子。新增语言 = 新增一个数据文件，
 * 类型不完整时 `tsc --noEmit` 会直接报错。
 */

export type Locale = 'zh-cn' | 'zh-tw' | 'en' | 'ja' | 'ko'

/** 首屏演示的三种模式：读 / 写 / 说 */
export type DemoModeId = 'read' | 'write' | 'speak'

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
}

/** 首屏演示的一种模式：上一行经快捷键变成下一行 */
export interface DemoMode {
  id: DemoModeId
  /** 切换按钮上的功能名 */
  name: string
  /** 版本标记，例如 V1.1；首发功能留空 */
  tag?: string
  /** 触发键位，键帽逐个渲染；带文字的（如「按住右 ⌥」）也写在这里，随语言翻译 */
  keys: string[]
  /** 原文 / 草稿 / 口述 */
  before: string
  /** 译文 / 替换结果 / 整理后的文字 */
  after: string
}

export interface HeroContent {
  title: string
  subtitle: string
  demo: {
    label: string
    /** 提示访客在页面上直接按快捷键（触屏设备上隐藏） */
    hint: string
    modes: DemoMode[]
  }
  platforms: PlatformCard[]
}

export interface FooterContent {
  /** 联系邮箱链接的文字 */
  contact: string
  copyright: string
  languageLabel: string
}

/** 法律文本的正文块：字符串是段落，字符串数组是列表，`{ heading }` 是小节标题 */
export type LegalBlock = string | string[] | { heading: string }

export interface LegalDoc {
  /** 页面 h1，也是页脚链接文字 */
  title: string
  /** meta description */
  description: string
  /** 版本号与生效日期，显示在标题下（Waffo 要求两者一起存档） */
  meta: string
  /** 第 1 节之前的引言段落 */
  intro?: string[]
  sections: Array<{ heading: string; body: LegalBlock[] }>
}

/** 定价页的一个方案 */
export interface PricingPlan {
  name: string
  tagline: string
  /** 月付价格，例如「$2.99 / 月」；免费方案写「$0」 */
  monthly: string
  /** 年付价格，例如「或 $29.90 / 年」；免费方案写「永久免费」 */
  yearly: string
  features: string[]
  /** 卡片底部的操作：免费方案放下载按钮，付费方案放结账表单 */
  action: 'download' | 'checkout'
}

/** 定价页的结账表单（`POST /api/checkout`，Waffo 收银台在新标签页打开） */
export interface CheckoutContent {
  emailLabel: string
  emailPlaceholder: string
  /** 月付 / 年付按钮上的文字，含价格 */
  monthly: string
  yearly: string
  /** 正在创建结账会话 */
  opening: string
  /** 浏览器拦了新标签页时，给一个手动打开的链接 */
  openManually: string
  /** 收银台已在新标签页打开时的提示，同时是一个再次打开的链接 */
  opened: string
  /** 结账还没开放（CHECKOUT_ENABLED = false）时代替表单的说明 */
  unavailable: string
  /** 表单下方的小字：付款在哪里完成、付完会发生什么 */
  fineprint: string
  errors: { invalidEmail: string; rateLimited: string; failed: string }
}

/** 付款完成后的激活页 `/activate?claim=…`：轮询领取码，拿到许可证密钥 */
export interface ActivateContent {
  title: string
  description: string
  /** 等待 Waffo 的付款结果 */
  pending: string
  /** 等了很久还没结果 */
  slow: string
  ready: string
  keyLabel: string
  copy: string
  copied: string
  /** `umuo://activate?key=…` 深链接按钮 */
  openApp: string
  /** 拿到密钥之后怎么用 */
  steps: string[]
  /** 地址里没有领取码 */
  missing: string
  /** 领取码不存在或已过期 */
  unknown: string
  error: string
}

export interface PricingContent {
  /** 页面 h1，也是页眉链接文字 */
  title: string
  /** meta description */
  description: string
  lead: string
  plans: PricingPlan[]
  checkout: CheckoutContent
  /** 方案下面的说明：怎么买、试用、税费、取消、退款 */
  notes: Array<{
    heading: string
    body: string
    /** 只在结账开放（CHECKOUT_ENABLED）时才成立的说明，比如「在本页购买」「在客户端里管理订阅」 */
    checkoutOnly?: boolean
  }>
}

export interface SiteContent {
  locale: Locale
  seo: SeoContent
  nav: NavContent
  hero: HeroContent
  footer: FooterContent
  /** 定价页：Waffo 审核要求下单前就能在网站上看到价格与计费周期 */
  pricing: PricingContent
  activate: ActivateContent
  /** 服务条款与隐私政策（按 Waffo Pancake 的 V1 订阅模板） */
  legal: { terms: LegalDoc; privacy: LegalDoc }
}
