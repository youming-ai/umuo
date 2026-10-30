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
  /** 下载按钮旁的一句商业模式说明，链到定价页 */
  pricingNote: string
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

/** 定价页的一笔账：付给谁、多少、怎么付 */
export interface PricingBill {
  payee: string
  /** 金额：付给 umuo 的写带币种的 US$9；付给供应商的写「按用量」 */
  amount: string
  /** 一次性 / 按用量 */
  cadence: string
  body: string
}

/** 「包含」清单的一行：功能名，配默认快捷键或状态标记（如「开发中」） */
export interface PricingFeature {
  name: string
  keys?: string[]
  tag?: string
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
  /** 拿到密钥之后怎么用：保存密钥、在 umuo 里激活、最多 3 台 Mac 与换机解绑 */
  steps: string[]
  /** 地址里没有领取码 */
  missing: string
  /** 领取码不存在或已过期 */
  unknown: string
  error: string
  /** 非成功状态下的出口：回首页、发邮件、刷新重试 */
  home: string
  contact: string
  retry: string
}

/** 购买入口（`PURCHASE_OPEN` 打开后才显示）：按钮、跳转中、出错，以及付款后怎么激活 */
export interface PurchaseContent {
  /** 按钮文字：购买 US$9 */
  buy: string
  /** 正在向 Worker 要收银台链接 */
  opening: string
  /** Worker 回 503：收费还没配好 */
  unavailable: string
  /** 网络错误或其他失败 */
  error: string
  /** 定价页按钮上方的一句（替代「尚未开放购买」）：先免费试用、再买 */
  lead: string
  /** 定价页按钮下方的激活说明：领取密钥、在 umuo 里激活、3 台 Mac */
  activation: string
}

export interface PricingContent {
  /** 页面 h1，也是页眉链接文字 */
  title: string
  /** meta description */
  description: string
  lead: string
  /** 两笔账，像对照本的左右两页：付给 umuo 的一次性买断，付给模型供应商的用量费 */
  bills: [PricingBill, PricingBill]
  /** 购买尚未开放（`PURCHASE_OPEN` 关闭）时，放在下载按钮上方的说明 */
  unavailable: string
  purchase: PurchaseContent
  /** 不包含：用一份短清单把「买断 + 自带 Key」反过来说清楚 */
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
  /** 定价页：买断 + 自带 Key；支付审核要求下单前就能在网站上看到价格 */
  pricing: PricingContent
  activate: ActivateContent
  /** 服务条款与隐私政策（买断授权 + 请求直连） */
  legal: { terms: LegalDoc; privacy: LegalDoc }
}
