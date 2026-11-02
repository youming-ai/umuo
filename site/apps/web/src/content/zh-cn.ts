import type { SiteContent } from './types'

/**
 * 简体中文文案（首发语言，也是其他语言的参考文本）。
 * 事实性内容来自根目录 docs/PRD.md（v0.5：文字 / 截图 / 语音三项核心，免费、纯 BYOK）。
 */
export const zhCn: SiteContent = {
  seo: {
    title: 'umuo — 读与写，一键翻译 | macOS AI 翻译',
    description:
      'umuo 是 macOS 上的 AI 翻译工具：⌃⌃ 划词翻译、⌥⌘A 输入翻译、⌥⌥ 闪电替换、⌥⌘O 截图翻译。接上自己的 Key（GPT、Claude、Gemini 等）或本地模型即可使用，完全免费，无订阅、无需账号；语音输入开发中。',
    ogLocale: 'zh_CN',
  },
  nav: {
    skipToContent: '跳到主要内容',
    themeLabel: '主题',
    themeToLight: '切换到浅色主题',
    themeToDark: '切换到深色主题',
  },
  hero: {
    title: '在哪里写，\n就在哪里译',
    subtitle: '写完按两下 ⌥，输入框里的文字原地换成外语；划词、截图也能译。',
    demo: {
      label: '翻译预览',
      modes: [
        {
          id: 'read',
          hint: '在这个页面连按两下 ⌃ 试试',
          name: '划词翻译',
          keys: ['⌃', '⌃'],
          before: 'The quick brown fox jumps over the lazy dog.',
          after: '敏捷的棕色狐狸跳过了那只懒狗。',
        },
        {
          id: 'write',
          hint: '在这个页面连按两下 ⌥ 试试',
          name: '闪电替换',
          keys: ['⌥', '⌥'],
          before: '明天下午三点开会可以吗？',
          after: 'Does 3 p.m. tomorrow work for the meeting?',
          note: '确认还是同一个输入框才替换；失败或取消时原文不动。',
        },
        {
          id: 'ocr',
          hint: '截图翻译要在 Mac 上按 ⌥⌘O 框选',
          name: '截图翻译',
          keys: ['⌥', '⌘', 'O'],
          before: 'Last train leaves Platform 2 at 11:40 p.m.',
          after: '末班车晚上 11:40 从 2 号站台发车。',
        },
        {
          id: 'speak',
          hint: '开发中：按住 ⌃⌘V 说话，松开后翻译成目标语言；按住 ⌥⌘V 则整理成通顺的同语言文字',
          name: '语音输入',
          tag: '开发中',
          before: '嗯，那个，会议能改到周五吗',
          after: 'Could we move the meeting to Friday?',
          note: '开发中：预览版暂不包含语音输入。',
        },
      ],
    },
    platform: {
      requirement: 'macOS 14+，仅支持 Apple Silicon（M 系列芯片）',
      actionLabel: '下载 macOS 版',
      statusLabel: '预览版',
      note: '预览版未经 Apple 公证，首次打开如被拦截，到「隐私与安全性」点「仍要打开」。',
      mobileNote: 'umuo 是 Mac 应用，请在 Mac 上打开 umuo.app 下载。',
      copyLink: '复制网址',
      copied: '已复制',
      copyFailed: '没能复制，请手动记下 umuo.app',
      afterDownload: {
        title: '下载已开始，接下来：',
        steps: [
          '打开下载的安装包，把 umuo 拖进「应用程序」文件夹。',
          '首次打开如被拦截，到「系统设置 › 隐私与安全性」点「仍要打开」。',
          '按引导选模型供应商、填入你的 API Key；划词翻译需要授予辅助功能权限。',
        ],
      },
    },
  },
  footer: {
    copyright: '© 2026 umuo',
    languageLabel: '语言',
  },
}
