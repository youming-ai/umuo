# umuo

<div align="center">

**系统级 AI 翻译客户端 —— 用你自己的 Key，在任意 App 里读、写、看都能即时翻译**

macOS 专用 · Swift + SwiftUI + AppKit· Rust 共享核心 · BYOK 优先 · 闭源

</div>

---

## 这是什么

umuo 是一个常驻菜单栏、快捷键驱动的桌面翻译客户端。它不是浏览器插件，也不是语言学习 App——
目标只有一个：**把翻译塞进你已有的工作流里，一次按键就出结果。**

| | 能力 |
| --- | --- |
| **读** | 划词 / 划句翻译、单词词卡、多模型对比翻译 |
| **写** | 撰写窗（输入翻译）、输入框原地替换（静默翻译） |
| **看** | 截图 OCR 翻译、静默 OCR |
| **模型** | BYOK：OpenAI / Azure OpenAI / Anthropic / Gemini / DeepSeek / 通义 / 智谱 / Moonshot / OpenRouter / Ollama / LM Studio / 任意 OpenAI 兼容端点 |
| **账本** | 翻译历史与检索、Token 用量与费用统计 |

三条不可动摇的产品原则：

1. **BYOK 优先**——粘贴自己的 Key 就能用，不需要注册账号。Key 存系统 Keychain，请求由本机直连厂商。
2. **快捷键驱动**——所有核心功能都能在两次按键内触发，浮窗不抢焦点、不打断当前工作。
3. **成本透明**——每次翻译记录 Token 与预估费用，厂商返回什么就显示什么，估算值明确标注「估算」。

完整需求见 **[docs/PRD.md](docs/PRD.md)**。

## 当前状态

**里程碑 1 已交付**：仓库重建为 umuo，并打通了「全局快捷键 → 辅助功能取词 → BYOK 流式翻译 → 非激活浮窗」这条垂直切片。官网在 [`site/`](site/)。

| 模块 | 状态 |
| --- | --- |
| 仓库骨架（Bun workspace + Cargo workspace + CI） | ✅ |
| Rust 共享内核 `crates/umuo-core` + 应用层 + 存储层（单元测试覆盖） | ✅ 见下表的已实现能力 |
| macOS 平台适配：Accessibility 取词 / 剪贴板降级 / Keychain | ✅ |
| SwiftUI + AppKit 客户端：菜单栏、**七个**全局快捷键（含连按修饰键）、非激活浮窗 + 六个功能窗 | ✅ 快捷键全部可在设置里改 |
| 输入框原地替换（静默翻译，⌥⌥） | ✅ 含「目标应用已切换就不写回」的保护 |
| 撰写窗（⌥⌘A）：上方写、下方实时出译文，⌘Enter 复制 | ✅ |
| 多模型对比（⌥P）：并发发给最多 4 个模型，卡片横排 | ✅ 含「选它」偏好统计 |
| 翻译历史与检索 + 收藏 + 按日/按月用量与费用（本机 SQLite） | ✅ 可设保留天数、可完全关闭历史 |
| 单词词卡（音标 / 释义 / 词形 / 例句） | ✅ 选一个词即出卡片；JSON 解析失败自动降级为纯文本 |
| 截图 OCR（⌥⌘O）：框选 → 本机 Vision 识别 → 翻译 | ✅ 用系统框选；自绘浮层与「覆盖模式」列为后续项 |
| 静默 OCR（⌥⇧O）：框选 → 只识别并复制原文 | ✅ 成功时不弹任何窗口 |
| 自定义 OpenAI 兼容端点 | ✅ 可填 Base URL；没填会被明确拦下 |
| 发音朗读 + 音标 / 拼音 | ✅ 系统语音合成；发音人按机器实际安装情况挑选 |
| 自定义翻译风格预设 | ✅ 系统 Prompt（含变量）、温度、few-shot 示例、是否附解释 |
| 按供应商设月度费用上限 | ✅ 超限可只提醒或自动切到未超限的供应商 |
| 术语表（PRD §5.8）：按语言对生效、CSV/TSV 导入导出 | ✅ 只注入命中的术语，整表多大都不影响单次费用 |
| 分场景模型 + 备用顺序（PRD §6.3） | ✅ 六个场景各自指定供应商与模型；跨供应商的备用顺序真的会重试 |
| 账号 / 订阅 / 官方额度 | ⬜ 服务端不在此仓库（PRD §9.6，本仓库范围外） |
| 免 Key 兜底通道（有道 / Bing / Google 网页通道、DeepL） | ⬜ 未实现：上游实现硬编码了逆向签名密钥，有 ToS 风险，待定 |
| 多模态识图翻译、覆盖模式（PRD §5.5 可选项） | ⬜ 未实现（V1.1） |
| 对比窗超限供应商的提示 | ⚠️ 超限的供应商会被排除出对比，但界面只显示卡片变少，没有说明为什么 |

`crates/umuo-core` 里已经能用的能力：12 家 Provider（含 Azure OpenAI）的数据驱动目录、按 Key 前缀推测供应商、
四种协议的请求构造（OpenAI 兼容 / Anthropic / Gemini / Azure）、**SSE 流式解析**（跨分片多字节安全）、
7 个翻译风格预设、术语表命中注入、长文本按上下文切分、故障转移策略、Token 与费用计量、
语言判断与目标切换、单词模式判定与词卡解析。

> **范围诚实声明**：客户端之外只有官网（[`site/`](site/)）。PRD §9.6 里的账号、订阅、模型网关是闭源服务端、独立部署，
> 客户端只通过公开 API 调用它，仓库中不包含服务端实现。
>
> **发布仍有待办**：应用内更新、Developer ID 签名与公证、Homebrew Cask，以及系统权限和多显示器等真机验收。旧客户端源码已清理；这不代表 SwiftUI 版已经发布。见 [迁移记录](docs/SWIFTUI-MIGRATION.md)。

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
| `bun run bundle:macos -- --version X.Y.Z` | 生成通用 `.app` / `.dmg` / `.app.tar.gz`，不上传 |
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
  Sources/Umuo/      App、Platform、Panel、Compose、Compare、History、Settings、Onboarding、Quick
  Tests/UmuoTests/   Swift Testing：视图模型与纯规则
  packaging/         Info.plist、图标与签名权限
  scripts/           Rust 绑定构建、原生开发、验证与打包
crates/umuo-ffi/     UniFFI 导出与类型转换
crates/umuo-app/     共享应用逻辑：设置、流水线、对比、历史、预算
  tests/             本地 SSE 流水线回归与事件兼容快照
crates/umuo-core/    平台无关翻译内核：Provider、Prompt、流式解析、路由、计量
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
- 翻译历史与收藏存在本机 SQLite，可设置保留天数，也可完全关闭。
- 默认不开启内容遥测。

## 许可

专有软件，保留所有权利（见 [LICENSE](LICENSE)）。官网与官网 Worker 在 [`site/`](site/)。参考与复用的第三方实现记在 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。
