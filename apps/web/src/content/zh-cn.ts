import type { SiteContent } from './types'

/**
 * 简体中文文案（首发语言，也是其他语言的参考文本）。
 * 事实性内容来自客户端仓库 docs/PRD.md：§5 功能与版本、§7.2 快捷键。
 */
export const zhCn: SiteContent = {
  locale: 'zh-cn',
  seo: {
    title: 'umuo — 读、写、说，一键翻译 | macOS AI 翻译',
    description:
      'umuo 是 macOS 上的 AI 翻译工具：⌥D 划词翻译、⌥A 撰写窗、⌥⇧T 输入框原地替换、⌥S 截图翻译，按住右 ⌥ 语音输入。内置免费引擎，不登录也能用；登录后可用 GPT、Claude、Gemini 等模型，也能接自己的 Key 或本地模型。',
    ogLocale: 'zh_CN',
  },
  nav: {
    skipToContent: '跳到主要内容',
    themeLabel: '主题',
    themeToLight: '切换到浅色主题',
    themeToDark: '切换到深色主题',
  },
  hero: {
    title: '任何应用里，\n一键翻译',
    subtitle: '选中即译，写完一键换成外语，也能直接说。',
    demo: {
      label: '翻译预览',
      hint: '直接按 ⌥D 试试',
      modes: [
        {
          id: 'read',
          name: '划词翻译',
          keys: ['⌥', 'D'],
          before: 'The quick brown fox jumps over the lazy dog.',
          after: '敏捷的棕色狐狸跳过了那只懒狗。',
        },
        {
          id: 'write',
          name: '原地替换',
          keys: ['⌥', '⇧', 'T'],
          before: '明天下午三点开会可以吗？',
          after: 'Does 3 p.m. tomorrow work for the meeting?',
        },
        {
          id: 'speak',
          name: '语音输入',
          tag: 'V1.1',
          keys: ['按住右 ⌥'],
          before: '嗯，那个，会议能改到周五吗',
          after: 'Could we move the meeting to Friday?',
        },
      ],
    },
    platforms: [
      {
        id: 'macos',
        requirement: 'macOS 13+，支持 Apple Silicon 与 Intel',
        actionLabel: '下载 macOS 版',
        statusLabel: '预览版',
        note: '预览版未经 Apple 公证，首次打开如被拦截，到「隐私与安全性」点「仍要打开」。',
      },
    ],
  },
  footer: {
    contact: '联系邮箱',
    copyright: '© 2026 umuo',
    languageLabel: '语言',
  },
}
