# umuo

<div align="center">

**macOS 翻译与语音表达工具 · 免费开源 · 自带模型 Key**

A free, open-source macOS translator: translate in place, select-to-translate, screenshot OCR and voice input — with your own API key.

macOS 14+ · Apple Silicon · Swift + SwiftUI + AppKit · Rust 共享核心 · 纯 BYOK · MIT 开源

[官网](https://umuo.app) · [下载（Apple Silicon）](https://umuo.app/download/macos) · [所有版本](https://github.com/youming-ai/umuo/releases) · [贡献指南](CONTRIBUTING.md)

[![Release](https://img.shields.io/github/v/release/youming-ai/umuo?label=release)](https://github.com/youming-ai/umuo/releases/latest)
[![CI](https://github.com/youming-ai/umuo/actions/workflows/ci.yml/badge.svg)](https://github.com/youming-ai/umuo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%2014%2B%20%C2%B7%20Apple%20Silicon-lightgrey)

</div>

---

## 这是什么

umuo 是 macOS 原生的翻译与语音表达工具，当前产品范围为：

| 核心 | 范围 | 当前状态 |
| --- | --- | --- |
| 文字翻译 | 划词（⌃⌃）、输入翻译（⌥⌘A）、输入框原地替换（⌥⌥）；复制、朗读与轻量结果窗 | 已实现，待真机验收 |
| OCR 截图翻译 | 系统框选（⌥⌘O）、Apple Vision 本地识别、修正原文后翻译 | 已实现，待真机验收 |
| 语音表达 | 按住 ⌥⌘V 说话整理成通顺文字、按住 ⌃⌘V 说话翻译成目标语言；本机转写，结果写回原输入框 | 已实现，待真机验收 |

umuo 完全免费、以 MIT 许可证开源，纯 BYOK：用户自带模型 Key，模型调用直接向供应商付费；umuo 不收费，没有许可证、试用、订阅、官方额度或 AI 网关。

模型 Key 存系统 Keychain，供应商请求从本机直连用户配置的端点。语音在本机用 transcribe.cpp + Qwen3-ASR-0.6B 转写，
不需要额外的语音 Key；整理与翻译复用文字模型，使用云端文字模型时，转写文本会发送给该供应商。

## 下载与安装

从 [umuo.app/download/macos](https://umuo.app/download/macos) 下载（macOS 14+，仅 Apple Silicon），
它会跳到 [GitHub Releases](https://github.com/youming-ai/umuo/releases) 最新版的安装包（如 `umuo-v0.2.5.dmg`）；每次客户端改动合入 `main` 都会自动发布一个新的正式版（标为 Latest），
已安装的应用可在「设置 › 关于」里检查更新。
安装包尚未经 Apple 公证：首次打开如被拦截，到**系统设置 → 隐私与安全性**点「仍要打开」。
也可以按下方「从源码构建」自己编译。

## 当前状态与开发入口

2026-11-02：原生客户端、Sparkle 自动更新与语音输入（录音、本机转写、整理/翻译、写回输入框）已完成，
客户端改动合入 `main` 即自动发布到 GitHub Releases（`v0.2.<序号>`，正式版，安装包 `umuo-v<版本>.dmg`，未经 Apple 公证）；
真机验收与 Developer ID 签名公证待做。为收敛首版，多模型对比、风格与术语管理、费用预算、收藏等旧功能已移除（旧数据保留）。

- [产品需求](docs/PRD.md)：当前功能与商业边界。
- [首版开发计划](docs/IMPLEMENTATION-PLAN.md)：精简、语音、开源与发布的次序和完成条件。
- [实现与验收清单](docs/PRD-CONFORMANCE.md)：已有代码、新范围调整、未实现与真机验收。
- [Handy 语音研究](docs/research/handy-voice-analysis.md)：源码证据和本地引擎实验方向。
- [发布与 Sparkle 密钥](docs/SWIFTUI-MIGRATION.md)：GitHub Releases 自动发版、失败清理、密钥与以后接公证的步骤。
- [真机走查](docs/NATIVE-WALKTHROUGH.md)：文字、截图、语音的真机验收表与性能测量口径。
- [贡献指南](CONTRIBUTING.md)：许可、开发前须知与 PR 要求。

官网 [umuo.app](https://umuo.app)（单页首页）与 Worker 在 [site/](site/)，合入 `main` 后由 Cloudflare Workers Builds 自动部署。

## 从源码构建

需要：Apple Silicon Mac、macOS 14+；Xcode 26（或带 macOS 26 SDK 的 Command Line Tools，浮窗用到 Liquid Glass）、
[rustup](https://rustup.rs)（Rust 版本由 `rust-toolchain.toml` 固定，首次构建自动安装）、[Bun](https://bun.sh) 1.4+（以 `package.json` 的 `packageManager` 为准）。

```bash
bun install          # 仓库工具脚本依赖
cargo fetch          # Rust 依赖

bun run dev:macos    # 编 Rust 绑定与 SwiftUI 客户端后启动（macOS 14+，Swift 6）
# 开发二进制默认不注册全局快捷键；先退出其他实例，再用 bun run dev:macos --hotkeys
```

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `bun run dev:macos` | 编译并启动 SwiftUI 客户端 |
| `bun run build` | 编译 Rust 绑定与原生客户端 |
| `bun run bundle:macos -- --version X.Y.Z` | 生成 Apple Silicon（arm64）的 `.app` / `.dmg` / `.app.tar.gz`，须配置 Sparkle 公钥，不上传 |
| `bun run icons` | 直接生成原生应用 ICNS 与菜单栏 PNG |
| `bun run lint` / `bun run format` | Biome 检查 / 格式化工具脚本 |
| `bun run type-check` | 工具脚本的 TypeScript 类型检查 |
| `bun run test:rust` | Rust workspace 单测与流水线回归测试 |
| `bun run verify:macos` | Swift 构建、Swift Testing、FFI 自检与打包冒烟 |
| `bun run verify` | 提交前完整门禁，与 GitHub Actions 的 CI 对齐 |

### 跑通划词翻译需要一次系统授权

启动客户端后，先在**设置 → 模型**里填一个供应商的 API Key，然后到
**系统设置 → 隐私与安全性 → 辅助功能**里勾上 `umuo`（开发模式下是运行它的终端或 IDE）。
没有这个权限，客户端读不到你选中的文字——浮窗会直接告诉你这件事，而不是静默失败。

之后在任意 App 里选中文字、连按两下 **⌃**（⌃⌃），译文会以流式方式出现在鼠标附近的浮窗里。

### 语音输入

在任意输入框里按住 **⌥⌘V** 说话，松开后整理成通顺的文字写回输入框；按住 **⌃⌘V** 则翻译成目标语言再写回。
首次使用会请求麦克风权限，并从 Hugging Face 下载约 560 MB 的转写模型；写回输入框同样需要辅助功能权限。
两个键都可以在**设置 → 翻译 → 语音输入**里修改。

## 仓库结构

```
apps/macos/          Swift + SwiftUI + AppKit 原生客户端（SwiftPM）
  Sources/Umuo/      App、Platform、Panel、Compose、Voice、History、Settings、Onboarding、Quick
  Tests/UmuoTests/   Swift Testing：视图模型与纯规则
  packaging/         Info.plist、图标与签名权限
  scripts/           Rust 绑定构建、原生开发、验证与打包
crates/umuo-ffi/     UniFFI 导出与类型转换
crates/umuo-app/     共享应用逻辑：设置、翻译流水线、语音会话与后处理、历史
  tests/             本地 SSE 流水线回归与事件兼容快照
crates/umuo-core/    平台无关翻译内核：Provider、Prompt、流式解析、计量
crates/umuo-store/   本地 SQLite：历史（旧收藏与用量表只保留数据）
site/               官网与 Worker，独立 Bun 项目
scripts/            图标生成与原生发布工具
docs/              PRD、架构、发布、真机走查与验收清单
```

## 架构原则

1. UI 使用 SwiftUI，窗口与系统能力使用 AppKit 和 Apple 原生 API；交互以 Apple Human Interface Guidelines 为依据。
2. `umuo-app` 与 `umuo-core` 保持平台无关，在 Linux 上可测试；应用编排经 UniFFI 提供给 Swift，不在 Swift 重写。
3. 平台能力在 Swift 宿主实现：AX 取词与写回、Keychain、Vision OCR、语音、快捷键和窗口。
4. Provider 是数据；请求流式输出，每次请求独立取消，旧事件不覆盖新结果。
5. Key 只存系统 Keychain，不进配置、日志或历史，供应商请求由 Rust 发出。

## 隐私

- BYOK 模式下，请求只发往你自己配置的端点；umuo 的服务器收不到你的内容，也收不到你的 Key。
- 翻译历史存在本机 SQLite，可搜索、删除，可设置保留天数，也可完全关闭。
- 语音在本机转写：录音只写入临时文件，转写结束或取消后立即删除，不发给 umuo，也不发给模型供应商。
- 默认不开启内容遥测。

## 参与贡献

欢迎提 Issue 与 Pull Request。开发前先读 [AGENTS.md](AGENTS.md)（分层规则、命令与测试约定，人和 agent 共用）与 [CONTRIBUTING.md](CONTRIBUTING.md)；
提交前在本机跑通 `bun run verify`（改官网时另在 `site/` 跑 `bun run verify`），PR 会由 CI 再跑一遍。

## 许可

[MIT](LICENSE)，整个仓库（含官网 `site/`）。「umuo」名称与水獭图标不随 MIT 授权：分发修改版请换用其他名称与图标，说明作品基于 umuo 不受限制。贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。参考与复用的第三方实现记在 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。
