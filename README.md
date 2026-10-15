# umuo

<div align="center">

**系统级 AI 翻译客户端 —— 用你自己的 Key，在任意 App 里读、写、看都能即时翻译**

macOS 13+ · Tauri 2 · Rust 共享核心 · BYOK 优先 · 闭源

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

**里程碑 1 已交付**：仓库重建为 umuo，并打通了「全局快捷键 → 辅助功能取词 → BYOK 流式翻译 → 非激活浮窗」这条垂直切片。官网已迁到公开仓库 [youming-ai/umuo](https://github.com/youming-ai/umuo)。

| 模块 | 状态 |
| --- | --- |
| 仓库骨架（Bun workspace + Cargo workspace + CI） | ✅ |
| Rust 共享内核 `crates/umuo-core` + 平台层 + 存储层（单元测试覆盖） | ✅ 见下表的已实现能力 |
| macOS 平台适配：Accessibility 取词 / 剪贴板降级 / Keychain | ✅ |
| Tauri 2 外壳：菜单栏托盘、**七个**全局快捷键（含连按修饰键）、非激活浮窗 + 六个功能窗 | ✅ 快捷键全部可在设置里改 |
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

> **范围诚实声明**：本仓库只包含**客户端**（官网在公开仓库 youming-ai/umuo）。PRD §9.6 里的账号、订阅、模型网关是闭源服务端、独立部署，
> 客户端只通过公开 API 调用它，仓库中不包含服务端实现。
>
> **尚未在真机上人工验证的部分**：浮窗的「不抢焦点」目前用 Tauri 的 `focused(false)` 实现，
> 与 PRD 要求的非激活 NSPanel 仍有差距；浮窗按鼠标位置摆放，不是精确锚定选区。
> 详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的「已知边界」。

## 快速开始

```bash
bun install          # JS 依赖（Bun workspace）
cargo fetch          # Rust 依赖

bun run dev:desktop  # 桌面客户端 → Tauri 窗口（需要 Xcode Command Line Tools）
```

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `bun run dev:desktop` | 桌面客户端开发（Tauri，热重载前端 + Rust 增量编译） |
| `bun run build:desktop` | 打包 `.app` / `.dmg`（macOS 签名与公证另配） |
| `bun run icons` | 重新生成图标资产（`scripts/make-icons.ts`，加 `--preview` 可在终端自检形状） |
| `bun run lint` / `bun run format` | Biome 检查 / 格式化 |
| `bun run type-check` | 全部 TypeScript 项目类型检查 |
| `bun run test:run` | Vitest（客户端 UI 的纯逻辑） |
| `bun run test:rust` | `cargo test --workspace`（翻译内核） |
| `bun run verify` | 上面全部串一遍——**提交前跑这个** |

### 跑通划词翻译需要一次系统授权

启动客户端后，先在**设置 → 模型**里填一个供应商的 API Key，然后到
**系统设置 → 隐私与安全性 → 辅助功能**里勾上 `umuo`（开发模式下是运行它的终端或 IDE）。
没有这个权限，客户端读不到你选中的文字——浮窗会直接告诉你这件事，而不是静默失败。

之后在任意 App 里选中文字、连按两下 **⌃**（⌃⌃），译文会以流式方式出现在鼠标附近的浮窗里。

## 仓库结构

```
apps/desktop/        桌面客户端
  src/               前端 UI（React，跑在 Tauri WebView 里）
    panel.tsx          划词浮窗
    settings.tsx       设置窗外壳（侧边栏 + 改了就存）；各分区页在 settings/
  src-tauri/         Tauri 2 外壳：托盘、全局快捷键、窗口、IPC 命令
    src/translator.rs  划词链路编排
crates/umuo-core/    共享翻译内核：Provider 目录、Prompt 引擎、流式解析、路由、计量
crates/umuo-platform/      平台能力 trait（取词、写回、剪贴板、凭据存储）
crates/umuo-platform-macos/ macOS 实现（Accessibility FFI、Keychain）
crates/umuo-store/   本机 SQLite：翻译历史、收藏、用量
packages/tokens/     设计令牌（客户端的 CSS 变量与 @theme 映射）
scripts/make-icons.ts 图标生成（手写 PNG/ICNS 编码器，无图形库依赖）
docs/PRD.md          产品需求文档
docs/ARCHITECTURE.md 架构与已知边界
docs/research/       竞品拆解与 luca-translate 复用审计
```

## 架构原则

1. **翻译逻辑全部在 `umuo-core`**，且不依赖任何操作系统 API——因此可以在 Linux/macOS CI 上直接 `cargo test`。
2. **凡是跟操作系统打交道的能力都下沉到平台适配层**：取词、写回、截图 OCR、全局快捷键、凭据存储。
   V1 只有 macOS 实现（`umuo-platform-macos`），Windows（V1.1）与 Omarchy（V2）按同一组 trait 补齐，不改内核。
3. **Provider 是数据不是分支**：新增一家供应商 = 往目录里加一条数据，而不是到处加 `if`。
4. **全部请求流式输出**：首字延迟是这类工具的核心体验指标，等整段返回再渲染是不可接受的。
5. **Key 只存系统凭据存储**，不进配置文件、不进日志、不进翻译历史。

## 隐私

- BYOK 模式下，请求只发往你自己配置的端点；umuo 的服务器收不到你的内容，也收不到你的 Key。
- 翻译历史与收藏存在本机 SQLite，可设置保留天数，也可完全关闭。
- 默认不开启内容遥测。

## 许可

专有软件，保留所有权利（见 [LICENSE](LICENSE)）。官网与官网 Worker 在公开仓库 [youming-ai/umuo](https://github.com/youming-ai/umuo)。参考与复用的第三方实现记在 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。
