# umuo

<div align="center">

**macOS 翻译与语音表达工具 · 免费开源 · 自带模型 Key**

macOS 专用 · Swift + SwiftUI + AppKit· Rust 共享核心 · 纯 BYOK · MIT 开源

</div>

---

## 这是什么

umuo 是 macOS 原生的翻译与语音表达工具，当前产品范围为：

| 核心 | 范围 | 当前状态 |
| --- | --- | --- |
| 文字翻译 | 划词、输入翻译、输入框原地替换；复制、朗读与轻量结果窗 | 已有实现，待精简与真机验收 |
| OCR 截图翻译 | 系统框选、Apple Vision 本地识别、修正原文后翻译 | 已有实现，待入口收敛与真机验收 |
| 语音表达 | 按键录音、本地转写、同语言润色或目标语言翻译、输入框输出 | 主要参考 Handy，研究完成，功能尚未实现 |

umuo 完全免费、以 MIT 许可证开源，纯 BYOK：用户自带模型 Key，模型调用直接向供应商付费；umuo 不收费，没有许可证、试用、订阅、官方额度或 AI 网关。

模型 Key 存系统 Keychain，供应商请求从本机直连用户配置的端点。本地转写方案若验证通过，无需额外语音 Key，
润色/翻译复用文字模型；使用云端文字模型时，转写文本会发送给该供应商。

## 当前状态与开发入口

2026-10-23 已完成原生迁移和 Sparkle 代码接入，尚未完成正式发布。已完成五批精简：移除多模型对比、静默 OCR、独立朗读快捷键、风格/术语管理及注入、费用报表与月度预算、分场景/备用模型与本地自动回落、回译与临时换模型、收藏与复杂历史筛选、词卡学习内容、快捷面板快速输入与菜单栏图标样式；旧数据保留。
历史实现不代表首版继续承诺这些能力。

- [产品需求](docs/PRD.md)：当前功能与商业边界。
- [首版开发计划](docs/IMPLEMENTATION-PLAN.md)：精简、语音、开源与发布的次序和完成条件。
- [实现与验收清单](docs/PRD-CONFORMANCE.md)：已有代码、新范围调整、未实现与真机验收。
- [Handy 语音研究](docs/research/handy-voice-analysis.md)：源码证据和本地引擎实验方向。
- [迁移与发布记录](docs/SWIFTUI-MIGRATION.md)：Developer ID、公证、Sparkle N → N+1、旧用户桥接与双架构待办。

官网及 Worker 在 [site/](site/)，同步改为免费开源说明，不含购买或激活流程。

## 快速开始

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
| `bun run bundle:macos -- --version X.Y.Z` | 生成通用 `.app` / `.dmg` / `.app.tar.gz`，须配置 Sparkle 公钥，不上传 |
| `bun run icons` | 直接生成原生应用 ICNS 与菜单栏 PNG |
| `bun run lint` / `bun run format` | Biome 检查 / 格式化工具脚本 |
| `bun run type-check` | 工具脚本的 TypeScript 类型检查 |
| `bun run test:rust` | Rust workspace 单测与流水线回归测试 |
| `bun run verify:macos` | Swift 构建、Swift Testing、FFI 自检与打包冒烟 |
| `bun run verify` | 提交前完整门禁，与客户端 CI 对齐 |

### 跑通划词翻译需要一次系统授权

启动客户端后，先在**设置 → 模型**里填一个供应商的 API Key，然后到
**系统设置 → 隐私与安全性 → 辅助功能**里勾上 `umuo`（开发模式下是运行它的终端或 IDE）。
没有这个权限，客户端读不到你选中的文字——浮窗会直接告诉你这件事，而不是静默失败。

之后在任意 App 里选中文字、连按两下 **⌃**（⌃⌃），译文会以流式方式出现在鼠标附近的浮窗里。

## 仓库结构

```
apps/macos/          Swift + SwiftUI + AppKit 原生客户端（SwiftPM）
  Sources/Umuo/      App、Platform、Panel、Compose、History、Settings、Onboarding、Quick
  Tests/UmuoTests/   Swift Testing：视图模型与纯规则
  packaging/         Info.plist、图标与签名权限
  scripts/           Rust 绑定构建、原生开发、验证与打包
crates/umuo-ffi/     UniFFI 导出与类型转换
crates/umuo-app/     共享应用逻辑：设置、流水线、历史
  tests/             本地 SSE 流水线回归与事件兼容快照
crates/umuo-core/    平台无关翻译内核：Provider、Prompt、流式解析、计量
crates/umuo-store/   本地 SQLite：历史、收藏与用量
site/               官网与 Worker，独立 Bun 项目
scripts/            图标生成与原生发布工具
docs/              PRD、架构、迁移与发布验收记录
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
- 默认不开启内容遥测。

## 许可

[MIT](LICENSE)。`site/`（官网与官网 Worker）不在 MIT 范围内，其许可待定。「umuo」名称与图标不随 MIT 授权，分发修改版请换名。贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。参考与复用的第三方实现记在 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。
