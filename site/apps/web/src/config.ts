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
 * 服务条款与隐私政策里的经营者：个人经营者使用的屋号（商号）与所在国家/地区（不写地址）。
 * 名称不随语言翻译；国家名按语言写。
 * 韩语文案里名称后的助词按读音的收音选：Base Labs（베이스 랩스）以辅音结尾，用 은 / 이，换名称时要一起看。
 */
export const LEGAL_NAME = 'Base Labs'
export const LEGAL_COUNTRY = {
  'zh-cn': '日本',
  'zh-tw': '日本',
  en: 'Japan',
  ja: '日本',
  ko: '일본',
} as const

/** 条款版本与生效日期；改条款时一起改（不另发邮件通知：不保存用户邮箱） */
export const LEGAL_VERSION = '3.0'
export const LEGAL_EFFECTIVE = '2026-11-02'

/**
 * macOS 安装包地址。由 Worker 读 R2 里的 macos/latest.json 给出最新版（见 worker/src/releases.ts）；
 * 客户端仓库每次合进 main 都会自动发一个新版本。设回 null 则下载按钮变为不可点。
 */
export const MACOS_DOWNLOAD_URL: string | null = '/download/macos'

/**
 * umuo 的源码仓库（MIT 许可证）。
 *
 * 注意：仓库**尚未公开**，这个地址是预定的，公开后再确认一遍是否就是它。
 */
export const SOURCE_URL = 'https://github.com/youming-ai/umuo'

/**
 * 源码链接开关：打开后，「免费与开源」页与页脚出现指向 `SOURCE_URL` 的链接。
 *
 * **默认关闭**：main 合入即部署正式站，仓库公开前不能放一个打不开的链接；
 * 关闭时只写「源码即将以 MIT 许可证公开」，不出现任何链接。仓库公开、地址确认后再改成 true。
 */
export const SOURCE_PUBLIC: boolean = false

/** 语言切换顺序与 <html lang> 映射（PRD §11.4） */
export const LOCALES = ['zh-cn', 'zh-tw', 'en', 'ja', 'ko'] as const

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
