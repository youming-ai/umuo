/**
 * 站点级常量：URL、联系方式、发布状态。
 *
 * 官网里所有外链和「能不能下载」的判断都收敛在这里，页面组件不写死 URL。
 */

/** 正式域名（PRD §11.4） */
export const SITE_URL = 'https://umuo.app'

/**
 * 注：**当前没有 og:image。** 分享图需要一张设计稿，代码里程序化生成的那版
 * 版式不合格，已撤掉（连同生成脚本）。og:title / description / url / locale
 * 都齐了，只缺一张 1200×630 的图；设计稿到位后放到 `public/og/<locale>.png`，
 * 再在 seo.ts 与 vite.config.ts 两处各加一行即可。
 */

/** 联系邮箱；PRD 未指定具体地址，暂用域名下的常规邮箱 */
export const CONTACT_EMAIL = 'hello@umuo.app'

/**
 * macOS 安装包地址。V1.0 里程碑 1 尚未发布，所以是 null：
 * Hero 的主按钮此时走「订阅上线通知」，发布后把它换成 DMG 地址即可。
 */
export const MACOS_DOWNLOAD_URL: string | null = null

/** 对外展示的版本状态 */
export const RELEASE = {
  macos: 'V1.0',
  windows: 'V1.1',
  linux: 'V2',
} as const

/** 语言切换顺序与 <html lang> 映射（PRD §11.4） */
export const LOCALES = ['zh-cn', 'zh-tw', 'en', 'ja'] as const

export const HTML_LANG: Record<string, string> = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  en: 'en',
  ja: 'ja',
}

/** 语言切换器里显示的名字（各语言写法固定，不进内容模型） */
export const LOCALE_LABEL: Record<string, string> = {
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  en: 'English',
  ja: '日本語',
}
