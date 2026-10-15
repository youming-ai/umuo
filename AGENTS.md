# Agent Instructions

本文件是本仓库对 AI agent 的**唯一**指令来源。`CLAUDE.md` 只做指针，不重复内容——重复必然漂移。

## 项目是什么

**umuo**：macOS 系统级 AI 翻译客户端（PRD 见 `docs/PRD.md`），核心卖点是「系统级随处翻译 + 自带 API Key（BYOK）」。
Tauri 2 外壳 + Rust 共享内核 + 平台适配层。**本仓库私有、客户端闭源**；官网与它的 Worker 在公开仓库 `youming-ai/umuo`，不在这里。

**里程碑 1 已完成**，PRD 的 P0 功能也已实现（详见 `docs/PRD-CONFORMANCE.md` 的已对齐表）。
**当前方向**（2026-10-08 用户决定）：客户端功能按 Trancy Air 的设置结构逐块对齐——听写、跟读、朗读，
以及账号与订阅。`docs/PRD.md` 已是 v0.3，§5.12 账号与订阅为 P0；服务端不在本仓库，
客户端的登录 / 订阅入口还没做（对齐表的「未对齐」里有专节），动手前先把它拆成可验收的条目。
**跟读与 PRD §3.3 冲突**（非目标写着「不做语言学习体系（单词本复习、跟读评测）」），做之前先请用户拍板。第一步「设置窗重排为分区侧边栏 + 改了就存」已完成：分区定义在
`apps/desktop/src/lib/settings-tabs.ts`，保存队列在 `apps/desktop/src/lib/settings-queue.ts`，
各页在 `apps/desktop/src/settings/`。进度与缺口见 `docs/PRD-CONFORMANCE.md`，
**不要凭印象判断「做完了没有」**。

**范围边界**：本仓库只有客户端。账号 / 订阅 / 模型网关是闭源服务端（PRD §9.6），不在本仓库，不要在这里实现它。

## 前置条件

- **Bun >= 1.2**（JS 侧唯一的包管理器与脚本运行器；不要用 npm/pnpm/yarn）
- **Rust stable**（内核与 Tauri 外壳；`cargo` 必须可用）
- **Xcode Command Line Tools**（macOS 客户端编译）
- 本地没有也不需要任何服务端密钥：BYOK 的 key 由用户在应用内填写，存系统 Keychain

## 常用命令

```bash
bun install                # JS 依赖
cargo fetch                # Rust 依赖

bun run dev:desktop        # Tauri 客户端（会先编译 Rust，首次较慢）
bun run build:desktop-ui   # 只构建客户端前端（panel / settings / compose / compare / history / onboarding / quick 七个入口）
bun run build:desktop      # 完整打包 .app / .dmg
bun run icons              # 重新生成图标（加 --preview 可在终端 ASCII 自检形状）

bun run lint               # biome check .
bun run fmt:rust           # cargo fmt --all -- --check（CI 里有这一步）
bun run clippy             # cargo clippy --workspace --all-targets -- -D warnings
bun run format             # biome format . --write
bun run type-check         # 根 + 客户端 UI 的 tsc
bun run test:run           # vitest run（TS 侧）
bun run test:rust          # cargo test --workspace（翻译内核）
bun run verify             # 提交前的完整门禁：lint + type-check + vitest + **cargo fmt --check** + **clippy -D warnings** + cargo test + 客户端前端构建
```

改动翻译逻辑后，**必须**同时跑 `bun run test:rust`；改动 UI 后必须跑 `bun run build:desktop-ui`。直接跑 `bun run verify` 最省事。

> 门禁与 CI 对不上，本仓库犯过**两次**同一个错：clippy 与 `cargo fmt --check` 都只存在于 CI，
> 而 `verify` 的链条里没有，于是「本机全绿但 PR 上红」。两次都补进 `verify` 了。
> 以后往门槛里加检查时，顺手确认它真的在 `verify` 的链条上，而不是只存在于某个人的肌肉记忆里。
>
> 注意 fmt 的版本差：`verify` 用的是本机 rustfmt，CI 用 `dtolnay/rust-toolchain@stable` 的当前版本
> （本仓库出现过本机 1.98.1 / CI 1.99.0）。本机绿不等于 CI 绿，最终以 CI 为准。

### 冒烟测试前先 `cargo build -p umuo-desktop`

`cargo check` 与 `cargo test` **不会更新 `target/debug/umuo-desktop`**。
只跑过这两条就去启动那个二进制，验的是**上一轮的代码**——表现是「新功能看起来完全没生效」，
很容易被误判成产品 bug（本仓库真的这样误判过一次）。完整顺序：

```bash
bun run build:desktop-ui      # 前端产物（Tauri 读的是 apps/desktop/dist）
cargo build -p umuo-desktop   # 主程序
./target/debug/umuo-desktop   # 再启动
```

### 客户端窗口可以在浏览器里验证（用假的 IPC 桥）

> **夹具验不到权限**：它绕过 Tauri 的 capability 检查。应用命令（invoke）不受 capability 限制，但 `listen()` 与窗口操作是插件命令，窗口不在 `src-tauri/capabilities/default.json` 里就会被拒——0.1.4 的撰写窗、对比窗就是这样收不到事件的。**新增窗口必须加进 capabilities**，事件与拖动类功能要在真机 dev 构建里看一眼 devtools。

`apps/desktop` 的窗口在挂载时会调 Tauri 命令，所以直接用浏览器打开构建产物只会停在
「载入中…」。要看真实渲染，复制 `apps/desktop/dist` 到临时目录，往 `settings.html`（或
其它入口）的 `<head>` 里插一段桩：

```html
<script>
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd) => ({ /* 按 apps/desktop/src/lib/ipc.ts 的形状返回 */ })[cmd],
  transformCallback: () => 1,
  unregisterCallback: () => {},
  registerListener: () => 1,
  unregisterListener: () => {},
};
// 事件插件在**退订**时还会读这个另一个全局。少了它，控制台会出现
// 「Cannot read properties of undefined (reading 'unregisterListener')」——
// 那是夹具的缺陷，不是产品的 bug（本仓库为此白查过一次）。
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
</script>
```

然后用 `--headless=new --dump-dom` 取渲染结果。**这一步能抓到只有真机会暴露的白屏**——
本仓库靠它抓到过一次 hook 顺序错误（React #310：提前返回之后又调 hook，
首次渲染与加载完成后 hook 数量不一致，整棵树被丢弃），构建与 lint 都是绿的。

## 发布门槛实测

`docs/RELEASE-GATES.md` 记录 PRD §8 门槛的**实测方法与数字**，以及哪几项现在测不了。
两条测量卫生要求写在那里，动手前先看：

1. **内存用 `footprint` 的 `phys_footprint`，不要用 `ps` 的 RSS**——RSS 把共享框架页
   重复计入，同一时刻差 3.5 倍，会让「通过」看起来像「超标 35%」。
2. **测全局快捷键前先确认只有一个实例在跑**（`ps -eo pid=,comm= | grep umuo`）。
   两个实例抢同一个快捷键时，后注册的会**静默失败**，埋点一行都不输出，
   而报告上看不出任何异常（本仓库真的被这件事绊过一次）。

## 进度与 PRD 对齐情况

`docs/PRD-CONFORMANCE.md` 是「与 PRD 逐条对齐」的追踪表：✅ 已对齐 / ⬜ 未对齐 / 🔀 有意偏离（含理由）/ ➕ 超出 PRD。
**动 PRD 里的功能前先看它**；做完一条就把状态改掉，有意偏离的要写清理由——不写理由的偏离，过几轮就没人知道是刻意还是漏了。

## 仓库结构

```
apps/desktop/             Tauri 2 客户端
  src/                    前端 UI（React）
  src-tauri/              Rust 外壳：托盘、全局快捷键、窗口、IPC 命令
crates/umuo-core/         共享翻译内核（纯逻辑 + 传输，平台无关）
crates/umuo-platform/     平台能力 trait 定义
crates/umuo-platform-macos/ macOS 实现：取词、写回、凭据、OCR、朗读、修饰键监听
crates/umuo-store/        本机 SQLite：历史、收藏、用量
packages/tokens/          设计令牌 CSS，客户端 @import
```

### 分层规则（违反它会立刻让 CI 或架构崩掉）

1. `umuo-core` **不得**依赖任何平台 API，也不得依赖 Tauri。它必须能在 Linux 上编译并测试。
2. 一切与操作系统交互的能力走 `umuo-platform` 里的 trait；`umuo-core` 只依赖 trait，不依赖具体实现。
3. Tauri 的 `src-tauri` 只做「窗口 / 快捷键 / 命令 / 组装依赖」这些外壳工作，翻译逻辑一律调用内核。
4. 前端 **不得**直接持有 API Key，也不得直接发供应商请求——请求走 Rust 侧，key 走 Keychain。

## 代码风格

- **TS/JS**：Biome 是唯一真源（`biome.json`）。2 空格、100 列、单引号、无分号、import 顺序由 Biome 管理。不要引入 ESLint/Prettier。
- **Rust**：`cargo fmt` 标准格式；clippy 不得有 warning（CI 里 `-D warnings`）。public API 写文档注释，注释解释**为什么**而不是复述代码。
- **CSS**：Tailwind v4 是 CSS-only 配置。设计令牌在 `packages/tokens/app.css` 的 `@theme {}` 块里，不要新增 `tailwind.config.*` / `postcss.config.*`，也不要写与已有令牌重复的 arbitrary value。
- 注释与提交信息用中文，与现有仓库一致；代码标识符用英文。

### 设计令牌的三条硬约束（踩过的坑，别再踩一次）

1. **按钮的前景/背景必须在四个主题下都达到 WCAG AA**。`--color-primary` 在暗色主题取
   `--brand-500`（亮绿）配深色文字，浅色主题取 `--brand-700`（深绿）配白字。
   换成别的组合前，请手算对比度——这两组是算过才定下来的，不是随手挑的色号。
2. **不要给 `--accent-color` 加 `--color-accent` 映射**。`--color-accent` 已被 shadcn 的
   surface 语义占用（`--accent: var(--surface-muted)`，一个背景色），同名映射会让
   `.text-accent` 静默解析到背景色——不报错，只是颜色错。新工具类请用 `--color-brand-accent`。
3. **焦点环、`prefers-reduced-motion`、`.sr-only`、`prefers-contrast` 这四组规则必须留在
   触摸媒体查询之外**。它们曾经被关在 `@media (hover: none) and (pointer: coarse)` 里，
   导致桌面端键盘用户看不到焦点缓冲、低动效偏好失效、跳过链接变成可见文字。

## 测试约定

- Rust 内核：单测与被测模块同文件（`#[cfg(test)] mod tests`），跨模块行为放 `crates/umuo-core/tests/`。
  优先测**纯函数**：请求构造、流式事件解析、Prompt 渲染、路由决策、费用计算、语言判断。
- TS 侧：Vitest，测试文件与被测代码同目录 `__tests__/` 或 `*.test.ts`。
  **不要用 `bun test`**——它不读 `vitest.config.ts`。
- 网络：不要在测试里打真实供应商端点。传输层的价值在「字节流 → 事件」这段纯逻辑上，把它单独抽出来测。


## 明确不要做的事

- 不要实现浏览器扩展、网页沉浸式双语阅读（PRD §3.3 已把它列为非目标）。
- 不要把 API Key 写进配置、日志、历史库，或从前端明文传给 Rust（用 Keychain 的读写命令）。
- 不要为「以后可能的平台」提前抽象：新平台接入时按现有 trait 补一个实现即可。
- 不要在 Tauri 命令里写业务逻辑；命令只做参数校验与内核调用。
- 不要引入第二个包管理器或第二个 lint 工具链。
