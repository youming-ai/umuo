# luca-translate 代码复用审计

> **历史调研，仅供参考。** 审计针对已删除的 Tauri 客户端时代（2026-10-06）；当前客户端是 Swift + SwiftUI，
> 文中「可搬运的模块」一个都没有搬（见 [THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES)），PRD 章节号也已变动。

**审计对象：** [lucaslus/luca-translate](https://github.com/lucaslus/luca-translate)（MIT，Rust + Tauri 2）
**审计日期：** 2026-10-06
**审计人：** 工程侧（AI agent），受 `docs/PRD.md` §9.5 委派
**目的：** 为 umuo 的「第 1–2 周代码审计，产出复用清单」这一里程碑（PRD §9.5 复用流程）提供基于**实际读码**的结论，验证或推翻 PRD §9.5 中基于猜测写成的复用表。

---

## 0. 元信息与审计方法

| 项 | 值 | 证据 |
| --- | --- | --- |
| 仓库 | `lucaslus/luca-translate` | GitHub API |
| URL | https://github.com/lucaslus/luca-translate | — |
| 默认分支 | `main` | `git rev-parse --abbrev-ref HEAD`；GitHub API `default_branch: main` |
| **commit SHA** | **`7988637662db4df81988ee00e6b3ce36ee289111`** | `git rev-parse HEAD`（克隆后 `HEAD == origin/main`） |
| **commit 日期** | **2026-10-05T13:56:41+08:00**（周五） | `git log -1 --format=%cI` |
| commit 标题 | `feat: add native Omarchy plugin and configurable desktop shortcuts` | `git log -1` |
| 仓库创建时间 | 2026-09-02T11:02:47Z | GitHub API `created_at` |
| 最后推送 | 2026-10-05T05:56:46Z | GitHub API `pushed_at` |
| **Star 数** | **1**（fork 0，open issues 0） | GitHub API `stargazers_count` |
| 提交总数 | **17** | `git rev-list --count HEAD` |
| 受版本控制文件 | 210 | `git ls-files \| wc -l` |
| 许可证 | MIT (`LICENSE`)，SPDX `MIT` | GitHub API + 文件 |
| 克隆位置 | `/tmp/luca-translate-audit`（**不在本仓库内**） | `git clone --depth 200 ... /tmp/luca-translate-audit` |

**方法：** 浅克隆（depth 200，足以覆盖全部 17 个提交）到 `/tmp` 只读审查。**未向本仓库复制上游任何一行源码**——PRD §9.5 明确规定「复制」是审计之后的下游动作。本仓库工作区本次仅新增本文档。

**证据标注约定（全文遵循）：**

- **已核实** —— 我实际读了该文件，并给出 `路径:行号`。
- **推断** —— 由已核实事实推导，未经上游代码直接确认。
- **未验证** —— 无法确认，不猜测、不凑数。

**已实际检查的关键文件（非穷举）：**

```
LICENSE, README.md, package.json
.github/workflows/{check,release,arch,omarchy-native}.yml
app/src-tauri/Cargo.toml, app/src-tauri/tauri.conf.json
app/src-tauri/src/main.rs                       (905 行，全文分段精读)
app/src-tauri/src/config.rs                     (646 行，精读)
app/src-tauri/src/translation.rs                (503 行，全文)
app/src-tauri/src/hotkeys.rs                    (148 行，全文)
app/src-tauri/src/db.rs                         (147 行，全文)
app/src-tauri/src/provider_guard.rs
app/src-tauri/src/desktop_control.rs
app/src-tauri/src/updates.rs, desktop_shortcuts.rs, settings_commands.rs
app/src-tauri/src/platform/{mod,macos,linux,windows}.rs   (全文)
app/src-tauri/tests/{screen_capture_abi,tray_menu}.rs
app/ui/overlay.js, app/ui/main.js, app/ui/settings*.js
crates/lucas-core/Cargo.toml, crates/lucas-core/src/lib.rs
crates/lucas-core/src/services/{mod,openai_compat,youdao_dict}.rs
crates/lucas-core/src/{http,pinyin,tts,lang,paragraph}.rs
crates/lucas-core/tests/integration.rs
crates/lucas-omarchy/Cargo.toml, crates/lucas-omarchy/src/{config,desktop}.rs
packaging/omarchy/editor/{LICENSE,NOTICE,clipboard-controls.patch}
```

---

## 1. 一句话结论

**不值得作为整体起点「按模块复制」，但其中 3 个模块（macOS 取词适配、Apple Vision OCR + 截图选区、核心词典/音标/拼音）、约 2,700 行 Rust 是真实、可测、可直接搬的高价值资产；而 PRD 认为是核心复用对象的 OpenAI 兼容层与「Ollama 支持」实际上只有一个 140 行、非流式的玩具实现，umuo 的命脉「BYOK 流式翻译」在上游一行都抄不到。**

补充定性：上游是一个 **17 个提交、1 个 star、创建仅 33 天**的个人项目。PRD §12.1 说它「处于早期，部分流程未完整验证」——**这个判断准确，而且偏乐观**。但它的代码质量显著高于其知名度（132 个 `#[test]`、4 条 CI workflow、真实多 OS 构建），所以是「**选矿**」而非「**搬山**」。

---

## 2. 架构速览

### 2.1 技术栈（全部已核实）

| 层 | 上游实现 | 证据 |
| --- | --- | --- |
| 桌面外壳 | **Tauri 2**（`tauri = { version = "2", features = ["macos-private-api", "tray-icon", "image-png"] }`） | `app/src-tauri/Cargo.toml:20` |
| Tauri CLI | `@tauri-apps/cli` **2.11.4** | `package.json` devDependencies |
| **前端** | **原生 HTML/CSS/JS，无框架、无打包器、无 npm 运行时依赖** | `app/ui/*.js`（15 个文件），devDeps 仅 cli/eslint/playwright/prettier |
| 语言（后端） | Rust，edition 2021，workspace 含 3 个 crate | `crates/*/Cargo.toml` |
| HTTP | `reqwest` 0.12（rustls-tls，自定义连接池与重定向策略）+ `ureq` 2 | `crates/lucas-core/Cargo.toml`, `crates/lucas-core/src/http.rs:26-42` |
| 并发 | `tokio`（JoinSet/Semaphore/CancellationToken）+ `std::thread::scope` | `translation.rs:221-260`, `services/mod.rs:196-239` |
| 存储 | `rusqlite` 0.32（bundled） | `app/src-tauri/Cargo.toml` |
| 凭据 | `keyring` 3.6（`apple-native` / `windows-native` / `sync-secret-service`） | `Cargo.toml` 三个 target 段 |
| macOS 原生 | `objc2` / `objc2-vision` / `objc2-app-kit` / `core-foundation` / `core-graphics` | `Cargo.toml` macOS 段 |
| Windows 原生 | `windows` 0.58（含 `Media_Ocr`、`Win32_UI_Input_KeyboardAndMouse`、`Win32_System_Ole`） | `Cargo.toml` Windows 段 |
| 托盘/更新/单实例 | `tauri-plugin-{tray-icon, updater, single-instance, window-state, global-shortcut, autostart, notification}` | `Cargo.toml` |
| Linux/Omarchy | QML Shell 插件（`omarchy/*.qml`）+ 独立 headless Rust 后端（stdio JSON 协议） | `crates/lucas-omarchy/`, `omarchy/` |

> **与 PRD §9.1 的对照：** PRD 判断「同为 Rust + Tauri 2 同栈，源码可复制改造」——**正确**。但 PRD 未记录的是：上游前端是**无框架的原生 JS**，若 umuo 前端用 React（AGENTS.md 显示 `apps/desktop/src` 为 React），前端部分**完全不可复用**，只能复用 Rust 侧。

### 2.2 目录结构与 LOC 分布（已核实）

```
luca-translate/                        210 tracked files, 17 commits
├── app/
│   ├── ui/                            ~4,465 行 原生 HTML/CSS/JS（main.js 1015）
│   └── src-tauri/                     ~3,600 行 Rust（Tauri 外壳）
│       └── src/main.rs 905 · config.rs 646 · translation.rs 503
│           platform/macos.rs 350 · desktop_control.rs 326 · hotkeys.rs 148 · db.rs 147
├── crates/
│   ├── lucas-core/                    ~3,700 行 Rust（纯逻辑，无平台依赖）
│   │   └── services/youdao_dict.rs 1103 · bing_free 309 · lang.rs 302
│   │       services/mod.rs 273 · http.rs 217 · openai_compat.rs 140 · pinyin 81 · tts 42
│   ├── lucas-omarchy/                 ~2,000 行 Rust（headless 后端）
│   └── platform-check/                  68 行（CI 环境 stub 检查）
├── omarchy/                           QML 插件（16 个 .qml + Lua + JS）
├── packaging/{arch,omarchy}/           PKGBUILD.in · Tensaku 编辑器补丁（MPL-2.0，见 §6）
├── tests/ + omarchy/tests/            JS/Lua/Python/QML 测试
└── .github/workflows/                 4 条 workflow
```

**LOC 总量：** Rust **11,258 行**（52 个 `.rs`）；UI（js/css/html/qml）**约 6,092 行**。

**分层观察（推断）：** 上游的架构与 umuo 的设计意图**同构**——`lucas-core` 不依赖 Tauri、不依赖平台 API（已核实：`crates/lucas-core/Cargo.toml` 只有网络/序列化/pinyin/whatlang 依赖），平台能力下沉到 `app/src-tauri/src/platform/`。**这对 umuo 的 `umuo-core` / `umuo-platform` / `umuo-platform-macos` 分层几乎是一一映射**，是整个复用评估中最有利的结构性事实。

---

## 3. 复用表（PRD §9.5 的验证版）

> **行数勘误：** 任务描述称 PRD §9.5 有「14 行」，实际 `docs/PRD.md:437–449` 是 **13 个数据行**。下表按实际 13 行逐行验证，并补充「PRD 判断」与「审计裁决」两列。
>
> **裁决分档：** 🟢 **直接复用**（可近乎原样搬） / 🟡 **复制后改造**（骨架可用，需实质改动） / 🔴 **不要复用，自己写**。

| # | 模块 | 源路径（本次实际检查） | PRD 原判 | 审计裁决 | 改造要点 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 划词取词（macOS AX、Linux PRIMARY/X11） | `app/src-tauri/src/platform/macos.rs:39-153`；`linux.rs:20-54`；`platform/mod.rs` | 复制后小改：**补剪贴板降级与恢复**、App 黑名单 | 🟢 macOS 部分直接复用 / 🟡 Linux 部分改造 | macOS：**剪贴板降级与恢复上游已完整实现**（PRD 判断有误，见 §5）；只缺 App 黑名单。Linux：上游**有意不做**剪贴板降级（`linux.rs:51-53` 有明确注释说明理由），要补是**新写**不是小改 | Linux 上模拟 Ctrl+C 会破坏任意剪贴板格式并读到陈旧文本——上游的顾虑成立，umuo 若强推降级需自担风险 |
| 2 | Windows 平台适配 | `app/src-tauri/src/platform/windows.rs`（204 行） | 复制后改造：按 §9.3 补齐 **UI Automation 取词**与 Authenticode 签名 | 🟡 复制后改造（工作量**大于** PRD 描述） | 上游 Windows **只有**模拟 Ctrl+C + OLE 剪贴板恢复，**没有 UI Automation**（已核实全文）；OCR 用 `Windows.Media.Ocr` 可直接留用；签名完全缺失 | UIA 取词是 umuo 最需要的部分，恰恰是上游缺的，属新写；Windows 打包**只有 x64，无 ARM64**（见 §5） |
| 3 | 截图选区、离线 OCR、静默 OCR | `app/ui/overlay.js` + `overlay.html`；`main.rs:215-488`；`macos.rs:205-327`（Apple Vision）；`linux.rs:107-141`（Tesseract）；`windows.rs:112-204`（WinRT OCR） | 复制后小改：增加多模态模型识图与覆盖模式 | 🟢 **直接复用** | 真·静默 OCR **已存在**（⌥C → OCR → 直接进剪贴板）；选区覆盖层是一整块全屏透明 Tauri 窗口 + 原生 JS 拖拽，逻辑干净；只需加多模态识图分支与「覆盖模式」 | 覆盖层与 macOS 多显示器/Retina 坐标换算耦合在前端 `screenX/screenY`，多显示器要复测 |
| 4 | 全局快捷键与冲突检测 | `hotkeys.rs`（148 行）；`desktop_shortcuts.rs`；`settings_commands.rs` | 复制后小改：换默认键位，增加双击修饰键与按住说话 | 🟢 基本直接复用 | 校验（必须含修饰键、同 App 内去重）、**注册失败降级为 warning 而非启动崩溃**、事务式保存带回滚——都很完整；Hyprland 走 `--check/--apply` 真冲突检测 | **非 Linux 平台没有主动冲突检测**，只有「注册失败后提示」，PRD 说的「冲突检测」在 macOS/Windows 上是**被动**的 |
| 5 | 系统凭据存储（Keychain / 凭据管理器 / Secret Service） | `config.rs:96-100,232-249,250-296,305-381`；`crates/lucas-omarchy/src/config.rs:216-240` | 直接复用：查看 Key 时增加身份验证 | 🟢 **直接复用（安全上最放心的一块）** | key 存 `keyring` 服务名 `com.lucas.translate.ai` + 随机 UUID 账号；**IPC 只回 `has_api_key: bool`**；无落盘明文、无日志泄露（§4.6 有完整证据） | 上游**没有「查看 Key」功能**，所以 PRD 说的「查看时增加身份验证」不是改造而是**新功能**；`config.json` 保留了 legacy `api_key` 字段用于一次性迁移，建议 umuo 直接删掉该字段 |
| 6 | 网页翻译通道（有道/Bing/Google）、DeepL API | `crates/lucas-core/src/services/{youdao_translate,youdao_dict,deepl_free,bing_free,google_free,deepl_api}.rs` | 直接复用：作为免 Key 兜底引擎 | 🟢 代码可复用，⚠️ **合规/稳定性有风险** | 5 个渠道 + 官方 DeepL API，都是 trait 对象，接口干净；DeepL API（`deepl_api.rs`）是正规官方接口 | **有道通道硬编码了从网页 JS bundle 里扒出的签名密钥**（`youdao_dict.rs:19`：`Mk6hqtUp33DGGtoS63tTJbMUYjRrG1Lu`，注释自承「observed in Youdao's web_dict 3.1.0 client on 2026-09-17」）并伪装浏览器 UA；这是**逆向非官方接口**，随时可能失效，且存在 ToS 风险 |
| 7 | OpenAI 兼容与 Ollama 适配 | `crates/lucas-core/src/services/openai_compat.rs`（**仅 140 行**） | 复制后改造：抽象为 Provider 层，补 Anthropic/Gemini 原生接口、模型列表、故障转移、Token 计量 | 🔴 **不要复用，自己写**（仅 URL 安全校验可参考） | 上游是**非流式**的（`openai_compat.rs:5` 注释自承：「非流式实现（简单可靠），流式后续迭代」）；**无 Ollama 自动探测**；无模型列表；无 Anthropic/Gemini | **PRD 此处最严重高估**：umuo 里程碑 1 的垂直切片核心是「BYOK **流式**翻译」，上游**没有流式**（全仓库 grep `text/event-stream`/`"stream"`/SSE 解析 = 0 命中，见 §4.7）。所谓「故障转移」上游已有的是 cooldown 熔断（`provider_guard.rs`），不是切换供应商的 failover |
| 8 | 多渠道并行翻译与单独重试 | `app/src-tauri/src/translation.rs:182-292`；`provider_guard.rs`；`result_cache.rs`；`crates/lucas-core/src/services/mod.rs:177-240` | 复制后改造：升级为多模型对比卡片，显示耗时与 Token | 🟢 **直接复用**（PRD 低估了它） | 已有：`JoinSet` 真并行扇出、每渠道独立取消、`Semaphore` 限流、熔断+抖动退避、结果缓存、按 `only` 参数做**单渠道重试**、诊断埋点带 `incident_id` 与耗时 | 「显示 Token」是纯新增（上游无 token 计量）；UI 卡片需要重做 |
| 9 | 查词、音标与发音、拼音 | `crates/lucas-core/src/services/youdao_dict.rs`（1103 行 / 28 个测试）；`tts.rs:1-30`；`pinyin.rs` | 直接复用：词卡增加 AI 释义与例句 | 🟢 **直接复用（ROI 最高）** | 纯函数、无平台依赖、测试最厚；`DictCard` 直接给出美/英音标 + 发音 URL；`pinyin.rs` 用 `pinyin` crate 输出带声调拼音 | 数据源是有道非官方接口（同上 ToS/稳定性）；拼音仅对中文有意义 |
| 10 | 历史与收藏 | `app/src-tauri/src/db.rs`（**仅 147 行**） | 复制后改造：增加模型、风格、来源 App、Token 字段与**全文检索** | 🟡 改造，但**收益有限**（等价于重写） | 现状：`history` + `favorites` 两张表，各 5 列（`id,text,result,service,created_at`），`created_at` 单列索引 | **无 FTS、无 search、无模型/风格/来源/Token 列**（PRD 判断正确）；但总共只有 147 行，改造量 ≈ 重写量，建议直接按 umuo 的 schema 新写 |
| 11 | Tauri Updater、CI 与打包 | `.github/workflows/{check,release,arch,omarchy-native}.yml`；`updates.rs`；`packaging/arch/PKGBUILD.in`；`tauri.conf.json` | 复制后小改：增加 macOS 签名公证与 Windows Authenticode | 🟡 复制后改造（CI 骨架值钱） | updater 用 minisign 公钥 + GitHub Releases `latest.json`，签名校验失败有专门文案（`updates.rs:20-30`）；CI 真跑 macOS 双架构 + Windows + Linux 构建 | `tauri.conf.json` 的 `bundle.macOS.signingIdentity` 是 **`"-"`（ad-hoc 签名）**，公证完全没有——PRD 判断正确；**Windows 无 ARM64**（PRD 判断错误，见 §5） |
| 12 | Omarchy QML Shell 插件与 setup 脚本 | `omarchy/*.qml`（16 个）；`crates/lucas-omarchy/src/*.rs`；`packaging/omarchy/` | V2 复制后改造：换品牌与命名 | 🟡 V2 复用（现在不必动） | 真原生插件：QML 前端 + headless Rust 后端走 stdio JSON 协议（`protocol.rs` 还会**拒收**含 `api_key` 字段的帧，属安全设计）；快捷键 `--check/--apply` 脚本 | ⚠️ **许可证陷阱**：`packaging/omarchy/editor/` 是 fork 自 Satty 的 **Tensaku（MPL-2.0）**，复制该子目录会触发 MPL-2.0 文件级 copyleft（见 §6） |
| 13 | 输入框原地替换、风格预设/Prompt 引擎、术语表、用量与费用统计、语音输入、Onboarding、**托盘/菜单栏面板** | — | 新写 | 🟡 **1 项判断错误**：托盘面板**已存在**；其余 6 项判断正确 | 托盘（`main.rs:625-655`）：`TrayIconBuilder` + 菜单（打开/截图/静默 OCR/设置/退出），可直接复用；其余 6 项确实不存在 | PRD 把「托盘/菜单栏面板」误列为新写，属**低估**（见 §5） |

---

## 4. 逐项核实结果

### 4.1 它是否真是 Rust + Tauri 2？Tauri 版本？前端用什么？

**已核实。是。**

- Tauri **2**：`app/src-tauri/Cargo.toml:20` `tauri = { version = "2", features = [...] }`；CLI `@tauri-apps/cli` **2.11.4**（`package.json`）。`Cargo.lock` 未在浅克隆中展开核对具体 patch 版本 → 精确到 `2.x` 为已核实，具体 patch 号**未验证**。
- **前端是原生 HTML/CSS/JS**：`app/ui/` 下 15 个文件（`main.js` 1015 行、`style.css` 859 行等），`package.json` 的 devDependencies 只有 `@tauri-apps/cli` / `eslint` / `playwright` / `prettier`——**没有 React/Vue/Svelte，没有 Vite/webpack，没有构建步骤**。窗口直接 `WebviewUrl::App("overlay.html")`（`main.rs:306`）。
- 另有 Omarchy 的 QML 前端（`omarchy/*.qml`）。

**对 umuo 的含义（推断）：** Rust 侧结构可搬；**前端一行都不可复用**（umuo 是 React）。

### 4.2 macOS 取词到底怎么做的？

**已核实：AX 优先 + 模拟 ⌘C 兜底，两者都有。** 位于 `app/src-tauri/src/platform/macos.rs`（350 行），取词主体 `:18-153`。

| 环节 | 实现 | 证据 |
| --- | --- | --- |
| ① Accessibility API | 手写 FFI 调 `AXUIElementCreateSystemWide` → `AXFocusedUIElement` → `AXSelectedText`，设 0.8s messaging timeout | `macos.rs:39-97` |
| ② 读取失败才降级 | `capture_selection_text()` 先试 AX，`None` 才走剪贴板 | `macos.rs:99-102` |
| ③ 模拟 ⌘C | `CGEvent` 发 `kVK_ANSI_C(8)` + `CGEventFlagCommand`，post 到 `HID` tap | `macos.rs:18-32` |
| ④ 判定复制成功 | 轮询 `NSPasteboard.changeCount()`，400ms deadline，20ms 间隔 | `macos.rs:129-135` |
| ⑤ 读文本 | `stringForType("public.utf8-plain-text")` | `macos.rs:137-139` |
| ⑥ 依赖 crate | `core-foundation 0.10`、`core-graphics 0.25`、`objc2 0.6`、`objc2-foundation 0.3`、`objc2-app-kit`、`objc2-vision`、`keyring` | `Cargo.toml` macOS 段 |

**规模与质量：** 取词部分约 **135 行**，体量小但细节密度高（有专门的注释解释为什么不清空剪贴板、为什么要设 AX timeout）。

### 4.3 取词失败降级与「恢复剪贴板原内容」是否真的实现了？有没有 App 黑名单？

**降级与恢复：已核实，macOS 与 Windows 都实现了，而且质量高于预期。App 黑名单：已核实，不存在。**

- **macOS —— 完整实现，且是「全类型快照」而非只存文本**（`macos.rs:105-151`）：
  - 复制前遍历 `pasteboardItems()` 的**每一个 item 的每一种 type**，逐个 `dataForType` 存进新建的 `NSPasteboardItem`；
  - 累计 32 MB 上限，超限或无法保真保存时**直接放弃并返回 `None`，绝不动用户剪贴板**（`:118-120`）；
  - 保存前后 `changeCount` 不一致就放弃（避免与并发写入打架，`:125-127`）；
  - 恢复时再校验 `changeCount == copied_count`，**「不允许延迟任务覆盖用户后续的复制」**（`:140-151` 的注释）；
  - 失败判定用「changeCount 是否变化」而非「先清空剪贴板」——`:128` 注释明确：`Never clear the pasteboard to detect failure.`
- **Windows —— 用 OLE 保存/恢复**（`windows.rs:58-98`）：`OleGetClipboard` 存原对象 + `GetClipboardSequenceNumber` 做前后校验，读取后 `OleSetClipboard` + `OleFlushClipboard` 还原。
- **Linux —— 有意不降级**（`linux.rs:51-53`）：
  > `// Do not synthesize Copy when PRIMARY is unavailable: it destroys arbitrary clipboard formats and can mistake stale clipboard text for the selection.`
  
  只读 `wl-paste --primary`（Wayland）或 `xclip -selection primary`（X11），拿不到就返回 `None`。
- **App 黑名单：已核实不存在。** 全仓库 grep `blacklist|denylist|exclude|ignore_app|bundle_id`，唯一命中是 `main.rs:539` 的 `.with_denylist(&["overlay", "settings"])`——那是 **Tauri 窗口白名单**，与「按 App 排除取词」无关。

> **→ PRD §9.5 第 1 行的判断错误：** PRD 写「补剪贴板降级与恢复、App 黑名单」，仿佛两者都缺。实际上 macOS/Windows 的**降级与恢复上游已经实现得很好**，真正缺的只有 **App 黑名单**，以及 Linux 的降级（那需要新写）。

### 4.4 全局快捷键用的什么？有没有冲突检测？

**已核实：`tauri-plugin-global-shortcut` 2；冲突检测部分存在，非 Linux 平台是被动的。**

- 实现：`app/src-tauri/src/hotkeys.rs`（148 行），4 个动作 `input / selection / screenshot / ocr`（`:24`），默认键位（`config.rs:191-205`）：
  | 动作 | 默认键 |
  | --- | --- |
  | `input`（撰写窗） | `Alt+A` |
  | `selection`（划词） | `Alt+D` |
  | `screenshot`（截图翻译） | `Alt+S` |
  | `ocr`（静默 OCR） | `Alt+C` |
  
  > **注：** 这三组默认键与 umuo PRD §5.2/5.3/5.5/7.2 的 `⌥D / ⌥A / ⌥S` **完全一致**——上游已按同一套心智模型选键，PRD 说「换成本产品默认键位」实际上几乎不用换。
- **冲突检测能力分三档（已核实）：**
  1. **App 内重复键**：`parse()` 用 `shortcut.id()` 去重，重复直接报错 `"两个操作不能使用相同的快捷键"`（`hotkeys.rs:47-52`）；
  2. **系统占用**：注册时若 `register()` 失败，**只记 warning，不让启动失败**（`hotkeys.rs:78-86`），保存时事务式重试 + 失败回滚原设置（`:98-115`）；
  3. **Hyprland**：走 `desktop_shortcuts::run("--check", ...)` 真正查 `.conflicts`（`:125-131`）。
  
  但 `hotkeys.rs:130` 明写：`Ok(BTreeMap::new()) // Other platforms detect OS registration conflicts when saving.` —— **macOS/Windows 没有主动查询「键是否被别的 App 占用」的能力，只有注册失败后的被动提示**。

### 4.5 截图选区与 OCR：Apple Vision 还是 Tesseract？「静默 OCR」存在吗？

**已核实：三平台三套原生 OCR；静默 OCR 真实存在且可用。**

- **OCR 引擎（不是二选一，是各平台各用各的）：**
  | 平台 | 引擎 | 证据 |
  | --- | --- | --- |
  | macOS | **Apple Vision**（`VNRecognizeTextRequest`，`Accurate` level，语言 `zh-Hans/zh-Hant/en-US`，内存内 PNG 不落临时文件） | `macos.rs:276-327` |
  | Linux | **Tesseract CLI**（`tesseract <file> stdout -l eng+chi_sim`，失败回退默认语言包） | `linux.rs:107-141` |
  | Windows | **Windows.Media.Ocr**（WinRT，优先中文引擎，回退用户语言） | `windows.rs:150-204` |
  
  → **PRD §9.5 第 3 行说「离线 OCR」可复用：正确。** 注意它复用的是**三套**，不是一套；PRD §9.4 对 Linux 用 Tesseract 的描述也与上游一致。
- **截图选区：** 不是原生 API，而是一个**全屏透明 Tauri 窗口**（`main.rs:283-327`，`decorations(false).transparent(true).always_on_top(true).focused(false)`）+ 前端原生 JS 鼠标拖拽（`app/ui/overlay.js`，97 行，用 `screenX/screenY` 上报选区）。macOS 实际截图走 `/usr/sbin/screencapture -x -T0 -R{x,y,w,h}`（`macos.rs:214-225`），带 8s 超时与进程回收。
- **「静默 OCR」= 快捷键 `ocr`（默认 Alt+C）**：`main.rs:204` → `start_region_capture(app, true)` → OCR 结果直接 `arboard::Clipboard::set_text()` 进剪贴板（`main.rs:460-469`），并用系统通知反馈「已复制 N 行文字」（`silent_feedback`，`:349-361`，注释强调**通知内容不含识别文本**）。**已核实存在且完整。**

### 4.6 系统凭据存储用什么 crate？key 存在哪？有没有明文落盘？（安全承诺项）

**已核实：`keyring` 3.6；key 只进 OS 凭据库；无明文落盘、无日志泄露。这是本次审计中**最正面**的发现。**

**证据链：**

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| crate | `keyring 3.6`，按平台启 feature：`apple-native` / `windows-native` / `sync-secret-service + crypto-rust` | `app/src-tauri/Cargo.toml` 三个 target 段；omarchy 用 `sync-secret-service` |
| 存在哪 | macOS Keychain / Windows Credential Manager / Secret Service（GNOME Keyring 等）。**服务名固定 `com.lucas.translate.ai`，账号是随机 UUID**——不是「provider 名」这类可猜测标识 | `config.rs:235,240,245`；`config.rs:133` `uuid::Uuid::new_v4()` |
| 是否明文落盘 | **否。** `config.json` 里只有 `secret_id: Option<String>`（UUID），key 本体存在 keyring | `config.rs:82-95` `Document` 结构 |
| legacy 明文字段 | `Document` 保留了一个 `api_key: String` 字段，**仅用于一次性迁移**：`load()` 时若非空 → 写入 keyring → `std::mem::take` 清空 → 重写文件 | `config.rs:89-90, 269-280` |
| 迁移是否有测试 | **有。** `legacy_key_migrates_without_disclosure`：写一个含 `"api_key":"synthetic-test-secret"` 的 config.json，断言迁移后文件里**不再包含该字符串**，且 `AiView` 序列化结果也不含 | `config.rs:514-529` |
| 是否回传前端 | **否。** `AiView { enabled, base_url, model, has_api_key: bool }`——只有布尔值 | `config.rs:64-70, 305-313` |
| 是否进日志 | **未发现。** 全仓库 `println!/eprintln!/log::/tracing::` 仅有 7 处，均与 key 无关（OCR 诊断、usage 提示、一行 DeepL 结果在 `#[cfg(test)]` 内）。`http.rs:2` 注释明写 `No response bodies, request URLs, or credentials enter public error messages.` | grep 结果见 `main.rs:522`、`ocr_diagnostics.rs:18,30,38`、`desktop_control.rs:55`、`deepl_free.rs:229`(test) |
| 是否进 DB | **否。** `lucas.db` 的 `history`/`favorites` 表无 key 列 | `db.rs:31-40` |
| 额外加固 | base_url 强制 HTTPS（仅 loopback 允许 http）、禁 query/fragment/内嵌凭据；Omarchy IPC 协议**主动拒收**带 `api_key` 字段的帧 | `config.rs:383-407`；`openai_compat.rs:60-77`；`crates/lucas-omarchy/src/protocol.rs:58`（有测试断言 `parse(b"{\"api_key\":...}")` 必须报错） |

**仍存在的安全注意点（不是漏洞，但 umuo 应处理）：**

1. **legacy 明文路径应删除。** 迁移失败时（`persist` 报错）代码会 `vault.remove(&id)` 并返回错误——行为是 fail-safe 的，但**磁盘上那份含明文的 `config.json` 会被原样保留**直到用户修好权限。umuo 是新仓库，没有历史包袱，**不应保留 `api_key` 字段**。
2. **历史库是明文 SQLite。** 所有译文原文与结果以明文存在 `<AppData>/lucas.db`（`main.rs:131-137`）。对翻译工具而言可接受，但 umuo 主打隐私，应在 PRD 里明确「本地历史不加密」这一事实，别让营销话术越界。
3. **「查看 Key」功能不存在**，所以 PRD §9.5 说的「查看 Key 时增加身份验证」是**新功能**而非改造。
4. **内存中明文常驻**：`Store.secret: Option<(String, String)>` 会把 key 缓存在进程内（`config.rs:255`），并有测试 `legacy_key_migrates_without_disclosure` 检查序列化不外泄。属正常做法，但 umuo 若要求更严可考虑 zeroize。

### 4.7 Provider 层：支持哪些服务？硬编码还是数据驱动？有无 OpenAI 兼容 / Ollama 自动探测 / 流式？有无多引擎对比与单独重试？

**已核实。**

**支持的服务（6 个，全部已核实到实现文件）：**

| 服务 | 实现 | 类型 | 证据 |
| --- | --- | --- | --- |
| 有道词典（含音标/发音/整句翻译兜底） | `youdao_dict.rs`（1103 行） | 非官方 web 接口 | `services/mod.rs:103` |
| DeepL 免费通道 | `deepl_free.rs`（231 行） | 非官方 | `services/mod.rs:104` |
| Google 免费通道 | `google_free.rs`（103 行） | 非官方 | `services/mod.rs:105` |
| Bing 免费通道 | `bing_free.rs`（309 行） | 非官方 | `main.rs` build_services |
| DeepL 官方 API | `deepl_api.rs`（119 行） | 官方，需 key | `config.rs:156-166` |
| OpenAI 兼容端点 | `openai_compat.rs`（**140 行**） | 通用 | `main.rs:59-88` |

**没有** Anthropic、Gemini、Claude、Cerebras、Groq、OpenRouter 等任何原生适配。

**硬编码 vs 数据驱动 —— 混合，偏硬编码：**

- **接口层是数据驱动的**：`trait TranslateService: Send + Sync`（`services/mod.rs:60-81`），服务以 `Vec<Box<dyn TranslateService>>` 传递，`default_translate_services()` 返回默认集合（`:101-107`）。
- **装配层是硬编码的**：`app/src-tauri/src/main.rs:59-88` 的 `build_services()` 是一串 `if toggles.xxx { services.push(Box::new(...)) }`；服务目录 `translation.rs:65-103` 的 `catalog()` 是硬编码 `vec![ServiceInfo{...}]`。
- 开关本身存在 `config.json` 的 `ServiceToggles`（`config.rs:36-55`）里，但**开关只能映射到编译期写死的 5 个 id**（`config.rs:441-452` 是 `match id { "youdao" => ..., "deepl" => ..., ... _ => Err("未知服务") }`）。
- → **要新增一个 Provider，必须改代码**，做不到「加一行配置就多一个服务」。PRD §9.5 要求「Provider 适配器做成独立 crate，便于社区贡献新服务」——这个目标上游**尚未达到**，是改造重点。

**OpenAI 兼容端点：有，支持自定义 `base_url`。** `openai_compat.rs:11-28` 收 `base_url/api_key/model` 三件套，拼 `{base_url}/chat/completions`（`:100`），非本地端点必须有 key（`:78-81`）。

**Ollama 自动探测：已核实不存在。** 上游对 Ollama 的「支持」仅体现为一句注释（`openai_compat.rs:4`：「DeepSeek、Kimi、智谱、通义、**Ollama（本地）**、OpenAI 等一切 OpenAI 兼容端点」）和「本地端点可免 key」这条规则（`:78-81`）。**没有任何对 `127.0.0.1:11434` 的探测、没有 `/api/tags` 模型列表拉取。** 用户必须**手打** Ollama 的 base_url 和模型名。
> → PRD §9.5 前言称上游「已具备…OpenAI 兼容与 Ollama」——**措辞误导**：Ollama 不是被「支持」，只是恰好符合 OpenAI 兼容格式。

**流式输出：已核实不存在。** 这是本次最重要的否定结论：
- `openai_compat.rs:5` 原文自承：`//! 非流式实现（简单可靠），流式后续迭代。`
- 全仓库 grep `text/event-stream` / `"stream"` / `stream: true` / `delta` / `chunked` —— **0 处真实命中**（仅命中测试里的 `assert!(!data.contains("secret"))` 之类无关键）。
- HTTP 层是同步阻塞（`ureq`/`reqwest` 的 `send_json` → `into_json`，`openai_compat.rs:108-109`），`translate()` 返回 `Vec<String>`，是**一次性完整响应**。
- 前端 `main.js` 里那个叫 `stream` 的变量（`:26, 123, 160`）是**客户端按请求聚合各渠道结果的累加器**，不是 token 流。UI 层面确实做到「哪个引擎先返回就先渲染哪张卡」（`translation.rs:263-279` 的 `while let Some(result) = tasks.join_next()`），是**引擎级渐进**，不是**token 级流式**。

**多引擎并行对比：有，做得不错。** `translation.rs:182-292`：
- `tokio::task::JoinSet` 为每个启用服务 spawn 一个任务（`:221-260`）；
- 每任务独立 `CancellationToken`，新请求会取消上一个（`:138-144`）；
- 全局 `Semaphore(8)` 限流（`:54`）+ 每 provider `Semaphore(1)` 单飞（`provider_guard.rs:27-34`）；
- `provider_guard` 熔断：失败后进入 cooldown，带 0–5 抖动（`translation.rs:253`）；
- `result_cache` 命中即返回（`:246-247`）；
- 结果**边完成边发射**（`:268`），注释明写 `Storage latency must not delay the result.`；
- 65s 总超时 + 每 provider 诊断记录（含 `incident_id`、耗时，`:252-255`）。

**单独重试：有。** `translation.rs:201-203`：
```rust
if let Some(name) = &only {
    services.retain(|s| s.name() == name);
}
```
配合 `:261` 的 `let mut recorded = only.is_some(); // A card retry must not duplicate the query history.`——即「只重跑一个渠道，且不重复写历史」。

### 4.8 历史与收藏：什么存储？表结构？有全文检索吗？

**已核实：SQLite（rusqlite，bundled），两张扁平表，无全文检索。**

- 位置：`<AppData>/lucas.db`（`main.rs:131-137`，`app.path().resolve("", BaseDirectory::AppData)`），WAL 模式，`busy_timeout` 2s（`db.rs:29-30`）。
- Schema 原文（`db.rs:31-40`）：
  ```sql
  CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, result TEXT NOT NULL,
      service TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, result TEXT NOT NULL,
      service TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_favorites_created ON favorites(created_at DESC);
  ```
- 查询只有分页列表：`SELECT ... ORDER BY created_at DESC,id DESC LIMIT ?1 OFFSET ?2`（`db.rs:72-76`），limit 被 `clamp(1,100)`。
- **没有 FTS5、没有 LIKE 搜索、没有搜索接口。** 没有 `model` / `style` / `source_app` / `token` 字段。收藏去重靠 `WHERE NOT EXISTS(...)`（`db.rs:104`）。
- 其他：`clear_history()` 是整表删除（`:95-100`），**没有单条删除**；`add_history` 是每次翻译追加，**无上限/无自动清理**。

> **→ PRD §9.5 第 10 行的判断（「增加模型、风格、来源 App、Token 字段与全文检索」）全部正确。** 但要注意：整份 `db.rs` 只有 147 行，「复制后改造」的实际工作量约等于重写。

### 4.9 使用量 / Token 计量存在吗？

**已核实：完全不存在。** PRD 说这是我们「新写」的——**判断正确**。

执行的 grep（全部返回 0 条业务命中）：
```bash
grep -rni "prompt_tokens\|completion_tokens\|total_tokens\|\"usage\"\|token_count\|cost\|pricing\|price" \
  --include=*.rs app crates
```
唯一相关的是 `openai_compat.rs:114` 从响应里取 `/choices/0/message/content`——**只取内容，`usage` 字段被完全忽略**。没有价格表、没有费用计算、没有用量统计面板。

### 4.10 输入框原地替换 / 静默翻译存在吗？

**已核实：不存在。** PRD 说这是「新写」——**判断正确**。

关键区分（这是 PRD §5.4 与上游最实质的差距）：

| 能力 | 上游是否有 | 证据 |
| --- | --- | --- |
| (a) 把译文复制到剪贴板 | **有** | `main.rs:462` `arboard::Clipboard::new().and_then(\|mut cb\| cb.set_text(text))` |
| (b) 读回剪贴板 | **有** | `windows.rs:88`；`linux.rs`（`wl-paste`/`xclip`） |
| (c) **把译文粘贴回原 App 的焦点位置** | **无** | 全仓库 grep `paste\|write_back\|insert_text\|enigo\|wtype\|Cmd+V\|CmdV`：**无任何「模拟 ⌘V / Ctrl+V」或 `enigo` 类输入注入代码**。`paste` 的命中全是 `NSPasteboard` / `wl-paste` 这类**读取**语义 |

也就是说：上游只做到「翻译 → 复制」，**从未尝试写回源 App**。umuo §5.4 的「原地替换 + ⌘Z 撤销 + 按 App 记忆目标语言」在上游**零基础**。

**顺带确认：** 「静默 OCR」（识别后复制原文）**存在**（§4.5），别与「静默翻译」混淆——PRD §9.5 第 3 行把静默 OCR 列为可复用（正确），第 13 行把静默翻译列为新写（正确），两处并不矛盾。

### 4.11 测试覆盖什么水平？有 CI 吗？PRD 风险表说它「处于早期，部分流程未完整验证」准确吗？

**已核实：132 个 `#[test]` + 4 个 `#[tokio::test]` = 136 个；4 条真实 CI workflow。「处于早期」准确，但「未完整验证」需分两面看。**

**测试数量按 crate（已核实）：**

| crate | `#[test]`/`#[tokio::test]` | 说明 |
| --- | --- | --- |
| `crates/lucas-core` | **79** | 纯逻辑，最厚：`youdao_dict.rs` 28、`tests/integration.rs` 14（网络）、`lang.rs` 8 |
| `app/src-tauri` | **32** | config 6、translation 6、provider_guard 5、db 2、hotkeys 1、platform/macos 2、platform/linux 1… |
| `crates/lucas-omarchy` | **25** | translation 6、config 6、provider_guard 5… |
| **合计** | **136** | — |

**测试性质（已核实）：**
- 绝大多数是**单元级纯函数测试**（schema 往返、路由决策、错误分类、快捷键校验、语言检测）。
- `crates/lucas-core/tests/integration.rs` 是**真实网络**测试，函数名一律 `network_` 前缀，文件头注明 `CI 无网环境可用 cargo test -- --skip network 跳过`。CI 真的这么跑（见下）。
- app 层有 2 个真集成测试：`screen_capture_abi.rs`、`tray_menu.rs`。
- 前端/Omarchy 另有一层**非 Rust** 测试：`tests/overlay.test.cjs`、`tests/release.test.cjs`（Node）、`tests/ui.regression.cjs`（Playwright）、`tests/omarchy.test.lua`、`tests/omarchy_shortcuts_test.py`、`omarchy/tests/*.py` + 5 个 `.qml`。

**CI（已核实，4 条 workflow）：**

| workflow | 触发 | 内容 |
| --- | --- | --- |
| `check.yml` | push/PR | 矩阵 `macos-15` / `macos-15-intel` / `windows-2022` / `ubuntu-22.04`：跑 core 测试（`--skip network`）+ desktop 测试 + **真出安装包**；另有 `ui` job 跑 eslint + Node 测试 + Playwright |
| `release.yml` | main 分支 | 同上矩阵 + 签名 updater artifact；`if: github.ref == 'refs/heads/main'` |
| `arch.yml` | 被调用 | 在 `archlinux:base-devel` 容器里构建 PKGBUILD，装包后 `pacman -Qkk` + `ldd` 验依赖 |
| `omarchy-native.yml` | push/PR | Omarchy 后端构建 |

**判定：**
- 「**处于早期**」—— **准确，甚至偏保守**。17 个提交、1 star、创建 33 天、`version: 0.1.0`。
- 「**部分流程未完整验证**」—— **部分准确**。说它「没测试」是错的（136 个测试 + 4 条 CI 比多数 1-star 项目强得多）；但关键流程确实**未被验证**，具体是：
  - 取词成功率（PRD §5.2 要求 Safari/Chrome/VS Code/Slack/微信/飞书/Notion/Preview ≥95%）上游**没有任何兼容性矩阵或端到端测试**——`macos.rs` 的测试只覆盖了「错误文案分类」和「无效区域」，**AX 取词与剪贴板恢复本身没有测试**；
  - 剪贴板恢复逻辑（本次最欣赏的代码）**无测试覆盖**；
  - 多显示器/Retina 选区**无测试**；
  - 更新器安装流程**无自动化测试**（只有 `examples/verify_update.rs` 验签名，注释明写 `No installation performed`）。
- **PRD §12.1 这一行的结论「复制前审计、复制后补测试；按模块验收，不整体照搬」——本次审计完全支持。**

### 4.12 许可证合规：根 LICENSE 是什么？有 COPYING / 第三方声明吗？复制代码要保留什么？

**已核实：根 MIT；无根级 THIRD_PARTY_NOTICES / COPYING；但存在一个被 PRD 忽略的 MPL-2.0 子目录。**

- 根 `LICENSE`：**MIT License, Copyright (c) 2026 Lucas**。三个 crate 的 `Cargo.toml` 都声明 `license = "MIT"`。
- **根目录没有 `THIRD_PARTY_NOTICES`、没有 `COPYING`。** README 的 License 段只有一行 `[MIT](LICENSE). Independent project; not affiliated with Bob Translate.`（`README.md:126-128`）。也没有 AUTHORS / CONTRIBUTORS 文件。
- ⚠️ **但存在两处子目录级许可证文件，其中一处不是 MIT：**

| 路径 | 许可证 | 内容 |
| --- | --- | --- |
| `omarchy/LICENSE` | **MIT** | 与根 LICENSE 同（Copyright 2026 Lucas） |
| `packaging/omarchy/editor/LICENSE` | **MPL-2.0** | 16,725 字节，完整的 Mozilla Public License 2.0 |
| `packaging/omarchy/editor/NOTICE` | — | 声明这是 **Tensaku**，fork 自 **Satty**（Matthias Gabriel），fork 点 `d19a403d6fd2854eaacd277998bf6c5cba85f7a5`，明确「Tensaku and Satty are both licensed under MPL-2.0」 |
| `packaging/omarchy/editor/clipboard-controls.patch` | 派生自上述 | 72 行补丁 |

**复制时需要保留/遵守什么（推断 + 法务提示）：**

1. **Rust 主体（`crates/` + `app/src-tauri/`，MIT）：** 保留版权声明与 MIT 许可文本。umuo 计划的做法（PRD §9.5）——根目录 `THIRD_PARTY_NOTICES` 注明来源仓库 + commit SHA、README 致谢——**满足 MIT 要求**，也是好实践。
2. ⚠️ **`packaging/omarchy/editor/`（MPL-2.0）是另一回事。** MPL-2.0 是**文件级 copyleft**：若 umuo 复制这个子目录（或其中的 patch）并分发，必须 (a) 保留该目录的 MPL-2.0 LICENSE 与 NOTICE，(b) **公开对其中 MPL 源文件的修改**，(c) 不得使用 Satty/Tensaku 的商标（NOTICE 里专门写了 §2.3 商标条款）。**PRD §9.5 只提「保留原版权声明」，没有覆盖这一条。**
   - **建议：** umuo 的 Omarchy 适配是 V2。若届时只需 QML 插件与快捷键脚本（`omarchy/*.qml`、`packaging/omarchy/lucas-translate-setup-omarchy`、`lucas-translate.lua`），**不要复制 `packaging/omarchy/editor/`**，即可完全避开 MPL-2.0。这需要在上游 commit 里做路径级筛选。
3. **`omarchy/` QML 与 `crates/lucas-omarchy/` 是 MIT**，可放心复用。
4. **无第三方 vendored crate 源码**（依赖走 Cargo/npm），所以没有额外的 vendored-license 清单需要核对。

---

## 5. 与 PRD §9.5 的差异（要改的行）

> PRD §9.5 的表是**基于阅读 README/简介的猜测**写的，不是读代码写的——这一点在本次审计中被多处证实。以下按「错的严重程度」排序。

### 5.1 【严重错误】第 7 行「OpenAI 兼容与 Ollama」——低估了一个数量级的改造量

- **PRD 写：** 「复制后改造：抽象为 Provider 层，补 Anthropic / Gemini 原生接口、模型列表、故障转移、Token 计量」
- **实际：** 源文件 `openai_compat.rs` **只有 140 行**，且 `:5` 自承**非流式**。没有 Ollama 探测、没有模型列表、没有 Anthropic/Gemini。
- **为什么严重：** umuo 里程碑 1 的垂直切片是「全局快捷键 → 辅助功能取词 → **BYOK 流式翻译** → 非激活浮窗」（AGENTS.md）。**流式是这个切片的一半，而上游零基础。** 把这一行标为「复制后改造」会让排期严重失真。
- **建议改为：** 「**新写**（仅可参考其 URL 安全校验与 system prompt）：上游为 140 行非流式实现；umuo 需自建流式传输层、Provider 抽象与模型列表。」

### 5.2 【错误】第 11 行「打包（macOS 双架构、Windows x64 / ARM64、Arch 包）」——Windows ARM64 不存在

- **PRD 写：** 把「Windows x64 / ARM64」当作上游已有能力去「复制后小改」。
- **实际：** `release.yml` 的构建矩阵只有 `windows-2022 / windows-x86_64`。全仓库 grep `aarch64-pc-windows|arm64`（`.github/`、`packaging/`、`app/package.json`）**0 命中**。macOS 双架构是真的（`darwin-aarch64` + `darwin-x86_64`），Arch 包是真的。
- **建议改为：** 「macOS 双架构 + Windows x64 + Arch/deb/rpm/AppImage 可直接复用；**Windows ARM64 构建是新增工作**。」

### 5.3 【错误】第 13 行把「托盘 / 菜单栏面板」列为「新写」——它已经存在

- **实际：** `main.rs:625-655` 有完整的 `TrayIconBuilder`：菜单项「打开翻译窗口 / 截图 OCR / 静默截图 OCR / 偏好设置… / 退出」，macOS 用 template icons、其它平台用彩色图标，`show_menu_on_left_click(true)`，且有一条务实注释解释为什么不能同时绑 mouse-up（否则菜单交互会误触发 `show_main`）。`silent_feedback`（`:349-361`）还会同步更新 tray tooltip。
- **建议改为：** 从「新写」移到「直接复用」，改造要点写「换图标/品牌、菜单项改为 umuo 的功能集」。

### 5.4 【错误】第 1 行「补剪贴板降级与恢复」——macOS/Windows 已完整实现

- **实际：** 见 §4.3。macOS 是**全类型快照 + 32 MB 上限 + 双重 changeCount 校验 + 拒绝延迟任务覆盖用户复制**；Windows 走 OLE 保存/恢复。这块代码质量是上游最高的之一，PRD 却把它写成待补的缺口。
- **建议改为：** 「macOS/Windows 剪贴板降级与恢复**已实现且质量高，直接复用**；缺的是 **App 黑名单**（全新）；Linux 上游**有意不做**降级（`linux.rs:51-53` 有理由），如需降级是**新写**。」

### 5.5 【措辞误导】§9.5 前言「已具备…OpenAI 兼容与 Ollama」

- **实际：** Ollama 不是被支持的功能，只是「凡 OpenAI 兼容端点皆可填 URL」的副产品；没有自动探测、没有模型列表。
- **建议改为：** 「已具备 OpenAI 兼容**自定义端点**能力（不含 Ollama 自动探测）」。

### 5.6 【措辞误导】§9.5 前言「已具备…离线 OCR」

- **实际：** 是**三套**平台各自的离线 OCR（Apple Vision / Windows.Media.Ocr / Tesseract CLI），不是一套可移植实现。复用时必须按平台分别处理。
- **建议改为：** 「已具备三平台各自的离线 OCR 实现（macOS Apple Vision、Windows WinRT OCR、Linux Tesseract CLI）」。

### 5.7 【低估】第 6 行「网页翻译通道…直接复用」未提合规与稳定性风险

- **实际：** 有道通道硬编码了从网页 JS bundle 扒出的签名密钥 `Mk6hqtUp33DGGtoS63tTJbMUYjRrG1Lu`（`youdao_dict.rs:19`）并伪装 Chrome UA，Bing/Google/DeepL-Free 同属逆向非官方接口。这既可能随时失效，也有 ToS 风险——而 umuo 的商业模式（§10）要靠这些通道做「免 Key 兜底」，风险敞口是商业级的。
- **建议改为：** 保留「可复用」，但把「逆向非官方接口、密钥硬编码、随时失效与 ToS 风险」写进「风险」列，并要求兜底引擎可远程开关（这一点 PRD §12.1「免费网页通道被上游限流」已有相关行，需要交叉引用）。

### 5.8 【低估】第 8 行「多渠道并行翻译与单独重试」判为「复制后改造」

- **实际：** 这是上游工程质量最高的一块（JoinSet 扇出 + 逐渠道取消 + 双层限流 + 熔断抖动 + 结果缓存 + `only` 单渠道重试 + 诊断埋点带 incident_id）。除了 UI 卡片和 token 显示，**后端几乎不需要改**。
- **建议改为：** 「**直接复用**（PRD 低估）；仅新增 Token 字段与卡片 UI。」

### 5.9 【次要】第 10 行「历史与收藏」——判断正确但工作量描述失真

- 全部要补的字段与全文检索都确实不存在（判断正确），但源文件只有 147 行，改造量 ≈ 重写量。建议标注「等价于新写」。

### 5.10 【次要】PRD 表行数

- 任务书说「14 行」，`docs/PRD.md:437–449` 实为 **13 行**。可能是把表头或前言段落计入。此处仅作勘误记录。

### 5.11 PRD 判断**正确**的行（应保留，无需修改）

| 行 | PRD 判断 | 审计结论 |
| --- | --- | --- |
| 3 | 截图选区、离线 OCR、静默 OCR 可复用 | ✅ 正确，且静默 OCR 确实存在 |
| 5 | 系统凭据存储直接复用 | ✅ 正确，安全实现干净（§4.6） |
| 9 | 查词/音标/发音/拼音直接复用 | ✅ 正确，ROI 最高（1103 行 + 28 测试） |
| 10 | 历史需补字段与全文检索 | ✅ 正确（但工作量被低估） |
| 12 | Omarchy 插件 V2 复制后改造 | ✅ 正确（但有 MPL-2.0 陷阱，PRD 未记录） |
| 13 中 6/7 项 | 原地替换、风格预设、术语表、用量统计、语音、Onboarding = 新写 | ✅ 全部正确，逐项 grep 验证（§4.9、§4.10） |
| §9.2 | 「自动更新：Tauri Updater（与 luca-translate 一致）」 | ✅ 正确 |
| §9.3 | 「其 CI 已覆盖 Windows x64 构建」 | ✅ 正确 |
| §12.1 | 「处于早期，部分流程未完整验证」 | ✅ 正确，甚至偏保守（§4.11） |

---

## 6. 许可证与合规

| 范围 | 许可证 | 复制时的义务 |
| --- | --- | --- |
| 仓库根 `LICENSE`、三个 crate | **MIT**（Copyright 2026 Lucas） | 保留版权声明与 MIT 全文；`THIRD_PARTY_NOTICES` 注明来源仓库 + commit `7988637…`；README 致谢。**PRD §9.5 的方案已满足。** |
| `omarchy/LICENSE` | MIT | 同上 |
| ⚠️ `packaging/omarchy/editor/`（`LICENSE` + `NOTICE` + `clipboard-controls.patch`） | **MPL-2.0**（Tensaku，fork 自 Satty，fork 点 `d19a403d6fd2854eaacd277998bf6c5cba85f7a5`） | **文件级 copyleft**：保留 MPL-2.0 文本与 NOTICE、公开对 MPL 文件的修改、不得使用 Satty/Tensaku 商标。**PRD §9.5 完全未覆盖。** |
| 根目录 `THIRD_PARTY_NOTICES` | **不存在** | 上游自己也没有——umuo 要新建 |

**合规建议：**
1. 复制范围**限定在** `crates/lucas-core/` + `app/src-tauri/src/platform/`（macOS）+ 必要的 `app/src-tauri/src/{translation,hotkeys,db,config}.rs`。
2. **V2 做 Omarchy 时，路径级排除 `packaging/omarchy/editor/`**，只用 `omarchy/*.qml` + `crates/lucas-omarchy/` + setup 脚本 → 完全规避 MPL-2.0。
3. `THIRD_PARTY_NOTICES` 记录：仓库 URL、commit `7988637662db4df81988ee00e6b3ce36ee289111`、MIT 全文、以及（若复制了 editor 目录）Tensaku/Satty 的 MPL-2.0 声明。
4. PRD §9.5 的「同步策略：不跟随上游更新」在本案中代价低（上游 17 个提交、1 star、活跃但极小），但仍需在 notices 里**锁定 commit SHA**，否则「来源」不可追溯。

---

## 7. 建议的复用清单（按价值排序）

### 7.1 价值排序与裁决

| 排名 | 模块 | 源路径 | 规模 | 裁决 | 理由 |
| --- | --- | --- | --- | --- | --- |
| **1** | **查词 / 音标 / 发音 / 拼音** | `crates/lucas-core/src/services/youdao_dict.rs`（1103）· `pinyin.rs`（81）· `tts.rs`（42）· `services/mod.rs` 的 `DictCard`/`DictService` | ~1,300 行 | 🟢 **直接复用** | 纯函数、无平台依赖、28 个测试、`DictCard` 直接产出美/英音标+发音 URL；是 PRD §5.1「单词词卡」P0 的现成实现。**唯一注意：数据源为逆向接口** |
| **2** | **macOS 取词适配** | `app/src-tauri/src/platform/macos.rs:18-203` | ~190 行 | 🟢 **直接复用** | AX 优先 + ⌘C 降级的剪贴板快照/恢复做得比 PRD 预期好得多，正好命中 umuo 最难的原生集成；改动只需加 App 黑名单 |
| **3** | **截图选区 + Apple Vision OCR + 静默 OCR** | `app/src-tauri/src/platform/macos.rs:205-327` · `app/ui/overlay.js`+`overlay.html` · `main.rs:215-488` | ~400 行 Rust + ~160 行 JS | 🟢 **直接复用** | 端到端可用（⌥S 翻译 / ⌥C 静默复制），含权限引导、看门狗、超时回收、多显示器定位 |
| **4** | **多渠道并行编排 + 单独重试 + 熔断** | `app/src-tauri/src/translation.rs:182-292` · `provider_guard.rs`（172）· `result_cache.rs`（126）· `services/mod.rs:177-240` | ~700 行 | 🟢 **直接复用** | 上游工程完成度最高处；PRD 的多模型对比卡片可直接架在上面 |
| **5** | **系统凭据存储** | `app/src-tauri/src/config.rs:96-100,232-249,250-296,305-381` | ~200 行 | 🟢 **直接复用** | 三平台 keyring 封装 + IPC 不外泄 + legacy 迁移测试；直接满足 umuo 的 Keychain 承诺 |
| **6** | **全局快捷键与冲突处理** | `app/src-tauri/src/hotkeys.rs`（148）· `desktop_shortcuts.rs`（75）· `settings_commands.rs`（93） | ~320 行 | 🟢 **直接复用** | 默认键位与 umuo PRD 完全一致；事务式保存/回滚/降级提示可直接搬 |
| **7** | **CI 与打包骨架** | `.github/workflows/{check,release,arch}.yml` · `packaging/arch/PKGBUILD.in` · `updates.rs`（129）· `tauri.conf.json` | ~400 行配置 | 🟡 **复制后改造** | 矩阵/签名/updater 流程成熟；但要去掉 ad-hoc 签名、加公证与 Authenticode、加 Windows ARM64 |
| **8** | **免费网页翻译通道 + DeepL API** | `crates/lucas-core/src/services/{bing_free,google_free,deepl_free,deepl_api,youdao_translate}.rs` | ~1,050 行 | 🟡 **复制后改造** | 代码可用；但逆向接口需加可远程关闭的开关与降级链 |
| **9** | **Windows 适配** | `app/src-tauri/src/platform/windows.rs`（204） | 204 行 | 🟡 **复制后改造** | 只有剪贴板降级 + WinRT OCR 可留；**UIA 取词是必补的新写** |
| **10** | **历史与收藏** | `app/src-tauri/src/db.rs`（147） | 147 行 | 🟡 **复制后改造**（≈重写） | schema 与查询都要重做；只有连接管理/错误处理值得借鉴 |
| **11** | **Omarchy 插件** | `omarchy/*.qml` · `crates/lucas-omarchy/`（~2,000） | ~3,000 行 | 🟡 **V2 复制后改造** | 现在不用动；**务必排除 `packaging/omarchy/editor/`（MPL-2.0）** |
| **12** | **Provider / OpenAI 兼容层** | `crates/lucas-core/src/services/openai_compat.rs`（140） | 140 行 | 🔴 **不要复用，自己写** | 非流式、无 Ollama 探测、无模型列表、无多厂商；umuo 的核心切片在这儿是**零起点**。仅可借鉴 URL 安全校验（`openai_compat.rs:60-77`）与 system prompt（`:83-89`） |
| **13** | **输入框原地替换 / 静默翻译** | —（不存在） | — | 🔴 **新写** | 上游无任何写回源 App 的能力（§4.10） |

### 7.2 最值得复用的 3 个模块

1. **macOS 取词适配（`platform/macos.rs`）** —— umuo 最难、最容易做砸的原生集成，上游 ~190 行就做到了 AX + ⌘C 降级 + 全类型剪贴板恢复，可直接搬。
2. **截图选区 + Apple Vision OCR + 静默 OCR（`platform/macos.rs:205-327` + `app/ui/overlay.js` + `main.rs:215-488`）** —— 端到端可用，含权限引导、看门狗、超时与多显示器处理，PRD §5.5 的 P0 几乎现成。
3. **多渠道并行编排（`translation.rs` + `provider_guard.rs` + `result_cache.rs`）** —— 上游工程质量最高处，PRD §5.6 多模型对比翻译可直接架在上面。

> 第 1 名（词典/音标/拼音）价值同样极高，但它对应的是 PRD §5.1 的词卡而非里程碑 1 的垂直切片；就**里程碑 1 的紧迫度**而言，上面 3 个更关键。若按纯 ROI 排序，词典模块仍是第一。

### 7.3 最不该复用的 2 个模块

1. 🔴 **Provider / OpenAI 兼容层（`openai_compat.rs`）** —— 140 行非流式实现。umuo 的里程碑 1 就是「BYOK **流式**翻译」，这里**一行都不解决核心问题**；还会诱导团队以为「Provider 层已经有了」而低估排期。自己写流式传输层 + 真正的 Provider trait + 模型列表。
2. 🔴 **历史与收藏（`db.rs`）** —— 147 行、两张 5 列表、无 FTS、无需要的任何字段。改造量≈重写量，且 umuo 需要 `model/style/source_app/token` + 全文检索的新 schema，直接新写更快更干净。

（若允许第三个：`packaging/omarchy/editor/` —— 不是「不值得复用」，而是**为了许可证合规应当主动排除**。）

### 7.4 建议的复制顺序（按依赖与风险倒序）

> 原则：**先搬自包含、可独立测试的纯逻辑，再搬平台适配，最后碰外壳与配置。** 每步都按 PRD §9.5「复制后补齐单元测试」执行。

| 阶段 | 动作 | 验收 |
| --- | --- | --- |
| **0** | 建 `THIRD_PARTY_NOTICES`，锁定 commit `7988637662db4df81988ee00e6b3ce36ee289111`，附 MIT 全文 | 合规基线 |
| **1** | 搬 `crates/lucas-core/` 的 `services/` + `pinyin.rs` + `tts.rs` + `lang.rs` + `paragraph.rs` + `http.rs` → `crates/umuo-core/` | `cargo test` 通过；剥离 `openai_compat.rs`（改自写）；跑一次 `--skip network` 与联网测试 |
| **2** | 搬 `platform/macos.rs` 的取词部分到 `crates/umuo-platform-macos/`，**补 AX 取词与剪贴板恢复的单元测试**（上游缺） | 目标 App 取词成功率实测（PRD §5.2 的 ≥95%） |
| **3** | 搬截图 + Vision OCR + 静默 OCR（含 `overlay.js` 移植到 React 或独立 overlay 窗口） | ⌥S / ⌥C 端到端；多显示器与 Retina |
| **4** | 搬 `translation.rs` 的并行编排 + `provider_guard.rs` + `result_cache.rs`，接上第 1 阶段的自写 Provider 层 | 多引擎并发 + 单渠道重试 |
| **5** | 搬 `config.rs` 的 keyring 封装（**删除 legacy `api_key` 字段**）+ `hotkeys.rs` | Keychain 读写；快捷键冲突回滚 |
| **6** | 搬 `db.rs` 的连接管理思路，**按 umuo 自己的 schema 新写**（含 FTS5 与 token/model/style 列） | 全文检索与字段完整性 |
| **7** | 搬 CI 骨架（矩阵 + arch workflow），补公证/Authenticode/Windows ARM64 | `bun run verify` 全绿 |
| **8** | V2：Omarchy QML + `crates/lucas-omarchy`（**排除 `editor/`**） | — |

### 7.5 三条给 PRD 的落地建议

1. **把「按模块复制源码改造」改为「按模块复制 + 逐模块补测试」**：上游的取词与剪贴板恢复**没有测试**（`macos.rs` 的 2 个测试只覆盖错误文案），而这恰是 umuo 最依赖的部分。PRD §9.5 已写「复制后补齐单元测试」——审计确认这条**必须**执行，不是可选项。
2. **把字段级差距写进 PRD 的排期**：「流式输出」「原地替换」「Token 计量」「App 黑名单」「UIA 取词」「Windows ARM64」是 6 项**明确的新增**，不该出现在「复用」栏里。按 §5 修正后，PRD 的 12 周周期假设会更容易校准。
3. **Agent 指令一致性**：`AGENTS.md` 规定「API Key 不能出现在前端、日志、配置文件或历史库里」。上游的做法（keyring + IPC 只回布尔 + 迁移测试）与这条**完全兼容**，可直接作为实现参考；但 `Document.api_key` 这个 legacy 字段**不要带进 umuo**。

---

## 8. 置信度与未验证项

**高置信（已核实，有 `路径:行号`）：** 技术栈与版本、commit SHA/日期/star/分支、LOC 分布、macOS/Windows/Linux 取词与剪贴板恢复实现、OCR 三平台引擎、静默 OCR、全局快捷键与冲突处理能力边界、keyring 凭据存储全链路与「无明文落盘」结论、Provider 清单与硬编码装配、**无流式**、**无 Ollama 自动探测**、**无 Token 计量**、**无原地替换**、历史表结构、136 个测试与 4 条 CI、许可证范围与 MPL-2.0 子目录。

**推断：** 上游分层与 umuo 分层的一一映射关系（基于依赖关系与模块边界判断，非官方文档声明）；「复制量≈XX 行」的估算；Linux 补剪贴板降级的实际工作量。

**未验证：**
- 上游在真实 macOS/Windows 机器上的**运行时行为**（本次为纯静态审计，未编译、未运行、未在真实 App 中测取词成功率）。
- `Cargo.lock` 中各 crate 的**精确 patch 版本**（浅克隆下未逐条核对；Tauri 精确到 `2.x`）。
- 「取词成功率 ≥95%」这类**端到端指标**：上游无任何兼容性矩阵，umuo 必须自测。
- Star 数为审计时刻（2026-10-06）的 GitHub API 快照，会随时间变化。
- 上游 README 中我未逐字核对的功能声明（本文所有结论均以**代码**为准，未采信 README 描述）。

**审计的局限：** 本次为静态只读审计，**没有编译、没有运行、没有复制任何源码**。所有「可复用」结论都指**代码结构与逻辑值得搬运**，而非「已验证可用」——按 PRD §9.5 的流程，「复制后补齐单元测试、按模块验收」仍是必要动作。
