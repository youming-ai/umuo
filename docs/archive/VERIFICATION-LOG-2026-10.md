# 验证记录归档（2026-10-23 至 2026-11-02）

> 归档于 2026-11-02，从 [PRD-CONFORMANCE.md](../PRD-CONFORMANCE.md) 移出。逐条保留当时的原文与数字，只作追溯；
> 其中提到的买断授权、闭源回退、`release-swift-local.sh`、通用二进制等均已被后来的决定取代，不代表现状。

2026-10-23 Sparkle 接入阶段已通过根 `bun run verify`、370 项 Swift Testing 与签名打包冒烟；
包内 selftest 有 74 项通过，另有 7 项依赖系统权限的检查跳过。`site/` 的 verify 通过，含 196 项 Vitest。
这些记录为精简前基线，不能视为新语音、买断授权或精简迁移验收通过。
2026-10-23 阶段 A 第一批：`bun run verify` 最终全通过，包括工具 lint/类型检查与 3 项工具测试、Rust fmt/clippy、
474 项 Rust 测试、329 项 Swift Testing（49 个 suite）、FFI 自检及签名打包冒烟。包内自检 74 项通过、7 项因权限跳过。
新增回归验证退役字段不触发注册、活跃键位可复用旧键位、未知字段和 stats.json 不丢失；通用阻塞 Host 测试保留。
文案检查改为核心入口存在、四语言和占位符一致性，移除与旧 Tauri 文案总数相等的断言。
本批未修改官网运行代码、未发布客户端；未获得系统权限的真机项目不算验收通过。

2026-10-23 阶段 A 第二批：根 `bun run verify` 全通过，含 3 项工具测试、Rust fmt/clippy、404 项 Rust 测试、
303 项 Swift Testing（47 个 suite）、FFI 自检及签名打包冒烟。包内自检 72 项通过、7 项因 TCC 未授权跳过。
进一步把退役配置回归加强为写入旧数据后重新启动 Engine，再走普通/词卡/分片翻译；随后 clippy 与完整 Rust 测试再次通过。
退役功能的专属测试随功能移除，新增回归覆盖旧数据透传、无关设置保存不受旧预设校验阻塞、新请求不注入旧规则、
新历史统一标记以及损坏术语文件不影响启动/翻译。本批未发布；真实权限、焦点与升级仍待真机验收。
2026-10-23 阶段 A 第三批：根 `bun run verify` 全通过，含 3 项工具测试、Rust fmt/clippy、353 项 Rust 测试、
270 项 Swift Testing（42 个 suite）、FFI 自检及签名打包冒烟。包内自检 70 项通过、7 项因 TCC 未授权跳过。
预算、路由、价目表、离线回落与用量报表的专属测试随功能移除；新增回归覆盖旧路由/预算配置不改变请求目标、
流内或 HTTP 失败与分片失败都不换候选、断网不探测本机模型、旧字段经无关保存保留（Rust 与 `--selftest` 两侧），
浮窗计量行与历史元信息不再出现费用。本批未发布；真实权限、焦点与升级仍待真机验收。
2026-10-23 界面改用系统样式：删除 `Palette` 设计令牌、自定义高对比度主题与界面缩放；设置窗改为 `NavigationSplitView` + 分组 `Form`，
浮窗与输入翻译窗用 Liquid Glass（macOS 26，14–15 回落系统材质），快捷面板用系统 popover 材质，引导卡片用 `GroupBox`。
`bun run verify:macos` 通过：262 项 Swift Testing（41 个 suite），包内自检 70 项通过、7 项因 TCC 未授权跳过，冒烟包 ad-hoc 签名校验通过。
真机观感（两代系统）、VoiceOver 与增强对比度未走查。

2026-10-26 设置工具栏语言同步修复：`SettingsPaneController` 观察设置的界面语言，首次载入、四语言切换及保存失败回滚后，
同步工具栏标签、窗口标题与图标辅助功能文案，并保持当前分区。两项回归先在原实现上失败、修复后通过。
根 `bun run verify` 全通过：353 项 Rust 测试、264 项 Swift Testing（42 个 suite）、FFI 自检及签名打包冒烟；
包内自检 70 项通过、7 项因 TCC 未授权跳过。VoiceOver 与真实界面走查仍待验收。

2026-10-27 阶段 A 第四批：根 `bun run verify` 全通过，含 Rust fmt/clippy、348 项 Rust 测试；`verify:macos` 通过，
247 项 Swift Testing（41 个 suite）、FFI 自检及签名打包冒烟，包内自检 69 项通过、7 项因 TCC 未授权跳过。
回译、换模型、收藏与筛选候选的专属测试随功能移除；新增回归覆盖词卡 Prompt 不再要求 forms/examples、旧格式词卡仍可解析，
阻塞 Host 测试改为显式放行开关（不再依赖请求级供应商覆盖）。本批未发布；真实权限、焦点与升级仍待真机验收。
2026-10-27 阶段 A 第五批：根 `bun run verify` 全通过（348 项 Rust 测试）；`verify:macos` 通过，243 项 Swift Testing（41 个 suite）、
FFI 自检及签名打包冒烟，包内自检 69 项通过、7 项因 TCC 未授权跳过。新增回归覆盖旧 `trayIconStyle` 经保存原样保留。本批未发布。

2026-10-28 #105 设置与首次引导原生化验收记录补齐：`SettingsUI.swift`、`Settings/Pages/`、
`OnboardingView.swift` 与 `OnboardingWindow.swift` 实现常显说明、系统组合框、分组表单、共用权限状态行与窗口标题本地化；
`GeneralEditor` 将导入/导出反馈分开，`SettingsModelTests` 覆盖导出反馈与文件位置；`PrefConfirm` 的清空确认使用异步 sheet，回车取消。
本次本机根 `bun run verify` 全通过：348 项 Rust 测试、247 项 Swift Testing（41 个 suite）、FFI 自检与签名打包冒烟；包内自检 69 项通过、7 项依赖权限或人工交互而跳过。设置六页、首次引导五步、组合框键盘操作与清空确认仍待真机走查；未发布，不提升真机验收状态。

2026-10-28 #107 窗口外壳原生化与审查修复：`FloatingPanelChrome` 保留系统标题栏框架、非激活属性与系统边缘缩放；
`Theme.swift` 恢复 `floatingSurface` 的 macOS 26 Liquid Glass，使用矩形材质并由系统窗口裁切圆角，14–15 保留 `.popover` / `.active` 回落。
`HistoryWindowController` 提供系统搜索与清空工具栏；走查表同步两代材质与四边缩放的期望。
本机根 `bun run verify` 全通过：348 项 Rust 测试、247 项 Swift Testing（41 个 suite）、FFI 自检与签名打包冒烟；
包内自检 69 项通过、7 项依赖权限或人工交互而跳过。验证使用独立 TMPDIR，避免两份存储测试的固定临时路径相互干扰。
浮窗焦点、OCR 编辑、撰写输入与写回、浅深色与两代材质、四边缩放及多显示器仍待真机走查；未发布，不提升相关验收状态。

2026-10-28 全仓审查与加固（PR #108 合并后）：
1. Rust 内核：`translate/mod.rs` 在 `stream_chat`/`stream_chunks` 返回后、`write_back_focus` 前补齐取消校验，防止 `SilentReplace` 流末尾取消仍覆写用户输入框；`settings.rs` 在 `prepare_for_save` 统一剥离未知字段中形似密钥（`apikey`/`secret`/`token`/`password`/`credential`）的项，覆盖配置导入与 patch 保存落盘；`wire.rs` 对 Gemini `model` 与 Azure `deployment` 路径段做 URL 编码与前缀归一化；`error.rs` 在 HTTP 错误摘要中脱敏 `Bearer` 与 `sk-` 令牌；`word_card.rs` 补齐 CJK 扩展 A 区判断与反注入指令；`umuo-store` 恢复备份改用毫秒时间戳、设置 `busy_timeout` 并清理残留 `-wal`/`-shm`；清理未使用依赖与修正 `HostBridge` 线程注释。
2. macOS 原生客户端：`PanelSession`/`PanelController` 新增 `capturesGlobalEscape`，浮窗钉住且空闲时释放全局 `Escape` Carbon 热键（流式生成中仍保留取消能力），避免吞掉其他应用的 `Esc`；`HistoryFormat` 与 `Localizable.xcstrings` 补齐 `ocr` 场景四语言标签；`ComposeView` 补齐 `state.warning` 提示条与输入框无障碍标签；菜单栏按钮与设置页 `DraftField` 补齐 VoiceOver 标签。
3. 官网与脚本：修复 `app.css` 选择器特异性顺序告警（Biome 零 warning）；`check-void-build.ts` 与 `cf-deploy.ts` 共用 `prepareVerifiedCfBuild` 在 `build`/`verify` 阶段即核验 `cf` 构建产物转换与完整 Worker 配置；同步 `site/AGENTS.md`、`site/README.md` 与 `scripts/release-swift-local.sh` 参数校验。
本机根 `bun run verify`（353 项 Rust 测试、247 项 Swift Testing、FFI 自检及签名打包冒烟）与 `site/` 完整 `verify` + `cf-deploy.ts --dry-run` 全通过。

2026-10-28 阶段 B 本地转写引擎与模型实测完成：
用户确认硬件范围收敛为 Apple Silicon（M 系列芯片，`arm64`）+ macOS 14+，不再考虑 Intel。
新增 `scripts/asr-runner.swift`、`scripts/asr-eval.ts` 与 `scripts/asr-eval.test.ts`（根工具测试增至 10 项全通过），在 Apple M2 Pro（32 GB，macOS 27.2）上对 `transcribe.cpp` v0.4.1（`TranscribeCpp.xcframework`）及 `Qwen3-ASR-0.6B` / `SenseVoiceSmall` 的 `Q4_K_M`、`Q8_0` 共 4 份 GGUF 模型完成 17 条夹具、SHA-256 校验、冷/热延迟、`phys_footprint`、取消重试与异常输入守卫实测。
选定 `Qwen3-ASR-0.6B-Q4_K_M.gguf`（562.3 MiB，Apache-2.0）为默认模型，采用 Swift 宿主进程内加载 + `mmap` + 空闲自动卸载方案（峰值 `phys_footprint` 333.1 MB，卸载回落至 108.7 MB）。详见 `docs/research/local-transcription-engines.md`。

2026-10-29 #114–#117 合入后（`beed455`）：#116 修复撰写窗只提交与当前输入一致的译文、快捷面板暂停开关以用户操作为准、
输入法组字中 Esc 只取消组字、历史「显示更多」与浮窗长原文展开，`ComposeTests`/`HistoryTests`/`PanelSessionTests`/`QuickTests` 补回归；
#114 提高菜单栏图标清晰度；#115/#117 为官网与 `.gitignore`。2026-10-30 本机根 `bun run verify` 全通过：353 项 Rust 测试、
254 项 Swift Testing（41 个 suite）、FFI 自检及签名打包冒烟；包内自检 69 项通过、7 项因 TCC 未授权或需人工交互跳过。未发布，不提升真机验收状态。

2026-10-30 用户取消开源与仓库公开计划：恢复闭源专有许可、Cargo/npm 许可元数据和五语言官网原有条款，移除 AGPL 许可文件及公开准备事项。仓库继续私有，未改远端历史或部署官网；US$9 买断及既定设备/试用/退款/更新权益保留。历史审计材料仍仅保存在本机私有目录。保留 `.claude/worktrees` 的 Git/Biome 忽略规则，避免本机独立工作树阻断验证。
回退后验证：根 `bun run verify` 在独立 TMPDIR 下全通过（先前两次误并行验证因 Rust 测试共用临时路径失败）；`site/` Node 24 完整 verify 通过。闭源许可元数据及五语言条款与开源前版本一致性核验通过，GitHub 可见性确认为 PRIVATE。

2026-10-30 阶段 C、D（Rust）与 F 集成（`feat/voice-license-integration`）：录音与会话状态机、语音整理/翻译 Rust 任务、客户端许可证与试用、
Worker 一次性买断与官网购买入口（默认关闭）合入同一分支，解决 `umuo-app/src/lib.rs` 与 `Info.plist` 注释两处冲突。
本机根 `bun run verify` 全通过：398 项 Rust 测试、308 项 Swift Testing（49 个 suite）、FFI 自检及签名打包冒烟；包内自检 74 项通过、9 项因 TCC 未授权跳过。
`site/` 的 `bun run verify` 全通过：13 个文件 208 项 Vitest。真实模型下载与推理、麦克风、Waffo test 环境闭环与真机均未验证；未发布。

2026-10-30 语音后处理接入与阶段 E（`feat/voice-delivery`，`03d8cb8`、`a7cc07b`）：`Engine.start_voice` FFI、双语音键与设置冲突检查、`EscapeRouter`、
`voice` 历史场景、`VoiceDelivery` 目标核验与 AX/受控粘贴交付。根 `bun run verify` 全通过：Rust umuo-app 163、umuo-core 168、umuo-ffi 23、umuo-store 45、
pipeline 15、event_wire 1，fmt/clippy 通过；341 项 Swift Testing（53 个 suite）；包内自检 75 项通过、9 项因 TCC 未授权跳过；签名打包冒烟通过。真机交付各路径未验证；未发布。

2026-11-02 下载与自动更新改走 GitHub Releases（`feat/releases-via-github`）：Release 工作流发正式版并标 Latest，附件固定为 `umuo.dmg` / `umuo.app.tar.gz` / `appcast.xml`；
SUFeedURL 改为 `releases/latest/download/appcast.xml`，enclosure 指向 `releases/download/v<版本>/umuo.app.tar.gz`；版本号主.次升到 0.2（避开旧 Tauri 版用过的 0.1.x）。
官网 `/download/macos` 与 `/download/macos/appcast.xml` 改为 302 到 GitHub 最新版，其余旧下载地址与 `/api/release`、`/api/notify` 删除，
Worker 去掉 `RELEASES`（R2）与 `NOTIFY_KV`（KV）绑定；旧 Tauri 桥接（minisign、`update.json`、`--updater-sign`、`--publish`、`cf-r2.sh`）删除——没有旧 Tauri 用户，R5 的桥接项不适用。
根 verify 各步通过（lint 因工作树路径被 `biome.json` 忽略，临时去掉该忽略后单独跑：12 个文件无问题）：工具测试 10 项；Rust umuo-app 163、umuo-core 168、umuo-ffi 23、
umuo-store 45、pipeline 15、event_wire 1，fmt/clippy 通过；314 项 Swift Testing（48 个 suite）；包内自检 75 项通过、9 项因 TCC 未授权跳过；签名打包冒烟通过。
`site/` 的 verify 通过：Biome 59 个文件、8 个文件 85 项 Vitest、Void 构建核对；`cf-deploy.ts --dry-run` 绑定只剩 `ASSETS` 与 `VERSION_METADATA`。未部署、未发布。
