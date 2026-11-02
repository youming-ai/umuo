import type { Locale } from './content/types'

/**
 * 站点级常量：URL、发布状态、语言。
 *
 * 官网里所有外链和「能不能下载」的判断都收敛在这里，页面组件不写死 URL。
 */

/** 正式域名（PRD §11.4） */
export const SITE_URL = 'https://umuo.app'

/**
 * 注：**当前没有 og:image。** 分享图需要一张设计稿，代码里程序化生成的那版
 * 版式不合格，已撤掉（连同生成脚本）。og:title / description / url / locale
 * 都齐了，只缺一张 1200×630 的图；设计稿到位后放到 `public/og/<locale>.png`，
 * 在 lib/seo.ts 的 headTags 里加 og:image，并把 twitter:card 从 summary 换成 summary_large_image。
 */

/**
 * macOS 安装包地址。Worker 把它 302 到 GitHub Releases 最新版的 umuo.dmg（见 worker/src/releases.ts）；
 * 客户端改动每次合进 main 都会自动发一个新版本。设回 null 则下载按钮变为不可点。
 */
export const MACOS_DOWNLOAD_URL: string | null = '/download/macos'

/** umuo 的源码仓库（MIT 许可证，2026-11-02 公开）。 */
export const SOURCE_URL = 'https://github.com/youming-ai/umuo'

/**
 * 源码链接开关：打开时页眉右侧出现「GitHub」，指向 `SOURCE_URL`（站内唯一的源码入口）。
 *
 * 仓库已公开，开关为 true。main 合入即部署正式站，仓库若改回私有须先把它改成 false，
 * 不能放一个打不开的链接；关闭时页面上不出现任何源码链接。
 */
export const SOURCE_PUBLIC: boolean = true

/** 语言切换顺序（PRD §11.4） */
export const LOCALES = ['zh-cn', 'zh-tw', 'en', 'ja', 'ko'] as const

/** 默认语言：Worker 协商不出时、预渲染的根路径兜底页都用它（worker/src/locale.ts 另有一份，locale.test.ts 比对） */
export const DEFAULT_LOCALE: Locale = 'zh-cn'

/** 各语言的 `<html lang>`（BCP-47，简繁用 Hans / Hant 区分） */
export const HTML_LANG: Record<string, string> = {
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
}

/** 语言切换器里显示的名字（各语言写法固定，不进内容模型） */
export const LOCALE_LABEL: Record<string, string> = {
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
}
