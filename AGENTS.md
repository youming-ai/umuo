# Agent Instructions

本文件是本仓库对 AI agent 的唯一指令来源。`CLAUDE.md` 只做指针。

## 项目与边界

umuo 是 macOS 系统级 AI 翻译客户端，BYOK、MIT 开源（含 `site/`），仓库公开于 github.com/youming-ai/umuo。客户端使用 Swift 6 + SwiftUI + AppKit（macOS 14+），
Rust 内核经 UniFFI 调用。2026-10-22 已按用户要求删除旧 Tauri 客户端、React UI、CSS tokens 与 Rust 平台适配层。
官网及 Worker 在 `site/`，是独立 Bun 项目；修改它时先读 `site/AGENTS.md`。

开发功能或精简入口前，先读 `docs/PRD.md`、`docs/PRD-CONFORMANCE.md` 与 `docs/IMPLEMENTATION-PLAN.md`；
按开发计划推进，完成后更新验收清单的实现证据与状态。
发布流程、Sparkle 密钥与必须守住的兼容性见 `docs/SWIFTUI-MIGRATION.md`。只做 macOS、只发 Apple Silicon（arm64），不为未来平台提前抽象。
当前核心为文字翻译（含原地替换）、OCR 截图翻译、语音输入后润色/翻译。完全免费、纯 BYOK（2026-11-02 定案）；
收费、许可证、试用、账号、订阅、官方额度与 AI 网关都不在范围内，不要重新引入。
语音主要参考 Handy，本地转写引擎先验证再选定；不引入 Tauri 外壳。旧范围与实现记录已归档，不据此恢复退出功能。

## 开发与验证

需要 Bun 1.4+（唯一 JS 包管理器，版本以 `packageManager` 为准）、rustup（Rust 版本由 `rust-toolchain.toml` 固定）、
Swift 6 与 macOS 26 SDK（Xcode 26，或带该 SDK 的 Command Line Tools；浮窗的 Liquid Glass 需要它）。
命令以根 `package.json` 为准。`bun run dev:macos` 从当前源码编译后启动；开发二进制默认不注册快捷键，
需要时加 `--hotkeys`，先确认只有一个 umuo 实例。不要拿上次编译的二进制验证当前修改。

提交前跑 `bun run verify`：工具 lint / 类型检查、cargo fmt、clippy -D warnings、Rust 测试、
Swift build / Swift Testing / FFI selftest / 原生打包冒烟。非 macOS 跳过 Swift 部分，CI 的 macos-app 仍须验证。
改翻译逻辑必须跑 `bun run test:rust`；改原生 UI 必须跑 `bun run verify:macos`。
新增 CI 门禁时同步接入 `verify`，避免本机全绿而 CI 漏检；CI 的 macos-app 直接调用 `verify.sh`。
CI：PR 跑完整 `ci.yml`；main 上客户端改动由 `release.yml` 调用同一套 CI 后发布，其余非文档改动只跑 `ci.yml`，只改文档不跑。
功能分支要在 CI 上验证时用 `gh workflow run ci.yml --ref <分支>`。
本机门禁照常先跑，PR 描述写明结果；GitHub 网页合并会用账号默认邮箱，合并改在本地做再推送。

## 目录与分层

- `apps/macos/`：原生客户端；`Sources/Umuo` 按功能分目录，`Tests/UmuoTests` 使用 Swift Testing。
- `crates/umuo-app/`：应用编排、Host、流水线、设置、历史等业务逻辑。
- `crates/umuo-core/`：翻译协议、Prompt、计量与传输。
- `crates/umuo-ffi/`：只做类型转换与导出，不写业务逻辑。
- `crates/umuo-store/`：SQLite 历史；旧收藏与用量账本的表与迁移保留，程序不再读写。
- `scripts/`：图标生成与发布工具；`site/` 独立维护。

`umuo-core` 与 `umuo-app` 不得依赖平台 API、Tauri 或 UniFFI，必须可在 Linux 编译测试。
流水线中途需要的平台能力（Key、前台应用、写回）只走 `umuo_app::Host`；其余系统能力留在 Swift 宿主。
线程与事件约定见 `docs/ARCHITECTURE.md` §2.1–2.3；同步 Host 回调不得等待主线程。
可复用业务逻辑放 `umuo-app`，Swift 通过 `umuo-ffi` 调用，不另写一份。

## Apple 原生界面规范

界面与交互遵循 Apple Human Interface Guidelines，优先使用 SwiftUI 标准控件、系统语义颜色、字体与 SF Symbols。
窗口、菜单、焦点、快捷键、键盘导航与辅助功能遵循 macOS 原生行为；特殊非激活浮窗使用 AppKit NSPanel。
保留 VoiceOver、提高对比度与减少动态效果支持；不要把旧 WebView 的 CSS 布局当成原生规范。
不维护自己的设计令牌：颜色用系统语义色，字号用系统文字样式，分组用 `Form(.grouped)` / `GroupBox`，浮动窗口用 `floatingSurface`（macOS 26 的 Liquid Glass，更早回落系统材质）。外观只有跟随系统 / 浅色 / 深色三种，经 `ThemeChoice.apply` 设到整个应用；高对比度交给系统设置。

## 风格与测试

注释与提交信息用中文，代码标识符用英文。Rust public API 写文档注释，cargo fmt 标准格式，clippy 零 warning。
TS/JS 以 Biome 为准：2 空格、100 列、单引号、无分号；不引入 ESLint、Prettier 或第二个包管理器。

Rust 单测与模块同文件，跨模块流水线回归在 `crates/umuo-app/tests/pipeline.rs`，
事件兼容快照在 `crates/umuo-app/tests/event_wire.rs`。FFI 行为另由 `crates/umuo-ffi/src/engine.rs` 与 `Umuo --selftest` 验证。
Swift 视图模型与纯规则用 Swift Testing；不要在测试里碰真实 Keychain、用户剪贴板、投递按键或访问真实供应商端点。
官网 TS 测试使用它自己的 Vitest；不要用 `bun test` 替代。

## 发布与兼容性

客户端改动合入 main 即由 `.github/workflows/release.yml` 发布到 GitHub Releases（`v0.2.<运行序号>`，arm64，正式版并标 Latest，固定自签名证书签名、尚未公证）。
手动发版用该工作流的 workflow_dispatch；发布失败后的清理见 `docs/SWIFTUI-MIGRATION.md`。
附件：安装包 `umuo-v<版本>.dmg`（官网 `/download/macos` 由 Worker 读 `releases/latest` 的跳转拿到最新 tag 再跳过去，缓存 5 分钟），
更新包 `umuo.app.tar.gz` 与 `appcast.xml` 名字固定（Sparkle 的 SUFeedURL 指向 `releases/latest/download/appcast.xml`）。
不要改这些命名规则，也不要把 Release 标成预发布（预发布不算 latest）。
本机 `bun run bundle:macos -- --version X.Y.Z` 只产出文件、不上传。官网不存安装包（没有 R2）。

保留 Bundle ID `app.umuo.desktop`、`umuo.app` 与可执行文件名 `umuo-desktop`，不能破坏 Keychain、系统授权与旧 LaunchAgent。
`settings.json` 只由 Rust 读写，Swift 只提交 patch；保留未知字段。历史沿用 `history.db` 与已发布迁移。
API Key 只进 Keychain，不写配置、日志、历史，不从界面读回明文；供应商请求走 Rust。

测性能前读 `docs/NATIVE-WALKTHROUGH.md`「性能测量」：用 release 包，内存用 `footprint` 的 phys_footprint，不用 RSS；
快捷键测量前确认只有一个 umuo 实例。旧 Tauri 的数字已归档，不能当作 SwiftUI 的发布验收结果。
