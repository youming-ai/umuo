# PRD 实现与验收清单

2026-10-23 · 对应 [PRD v0.5](PRD.md)；开发次序见 [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)。
本表区分已有代码、新范围调整、未实现与真机验收。范围确认不会自动把未实现项标成完成。
精简前的完整实现证据保存在 [v0.4 快照](archive/PRD-CONFORMANCE-v0.4.md)，其中退出范围的条目不再作为首版要求。

状态：✅ 已有实现及自动验证；🟡 已有基础，仍需新范围调整或验收；⬜ 未实现/待完成。
✅ 不代表已发布，也不代替权限、焦点、多显示器和真实升级验证。

## 文字翻译

| 编号 | PRD | 要求 | 状态 | 实现证据与剩余验收 |
| --- | --- | --- | --- | --- |
| T1 | §5.2 | AX 取词、复制降级与剪贴板保护 | ✅ | `Platform/Selection.swift`、`Pasteboard.swift`；Swift 规则/selftest 已有，真实应用兼容继续走查 |
| T2 | §5.1–5.2 | 非激活流式浮窗、复制/朗读/钉住/拖动/缩放 | 🟡 | `Panel/`、`Platform/Speech.swift`；#107 通过 `FloatingPanelChrome` 使用非激活系统面板，顶部拖动、四边缩放；macOS 26 使用 `floatingSurface` Liquid Glass，14–15 回落系统材质；焦点、缩放、外观与多显示器仍需真机验收 |
| T3 | §5.3 | 简单输入翻译窗 | 🟡 | `Compose/`：第四批已移除回译与临时换模型，保留源/目标语言、自动翻译、复制与复制粘贴；#107 共用系统面板外壳与按系统版本切换的材质；直接输入、粘贴回原应用与外观仍待真机验收 |
| T4 | §5.4 | 选区或整框原地翻译，失败不改原文 | 🟡 | `Platform/AXWriteBack.swift`、`umuo-app/src/translate/`；已有守卫测试，真实应用与同应用焦点变化待验 |
| T5 | §5.2 | 单词语境释义与朗读 | 🟡 | `umuo-core/src/word_card.rs`、`Panel/WordCardView.swift`：第四批只保留词、发音、语境释义与朗读；真机待验收 |

## OCR 截图翻译

| 编号 | PRD | 要求 | 状态 | 实现证据与剩余验收 |
| --- | --- | --- | --- | --- |
| O1 | §5.5 | 系统框选、Vision 本地识别 | ✅ | `Platform/ScreenCapture.swift`、`OCR.swift`、`PanelTriggers.swift`；截图取消/空结果已有规则，真实权限待验 |
| O2 | §5.5 | 识别原文修正后重译 | ✅ | `PanelView.swift`、`PanelSession.swift`；重译保持 OCR 模式 |
| O3 | §5.5 | 截图入口收敛，取消独立静默 OCR 产品流程 | ✅ | 已移除 `ocrSilent` 动作、菜单、设置、引导与截图分支；旧字段保留但不注册，旧键位透传/复用回归与 verify 通过 |

## 语音输入与翻译

现有 `Platform/Speech.swift` 仅为朗读，不计作转写实现。Handy 研究已完成，见 [源码分析](research/handy-voice-analysis.md)。

| 编号 | PRD | 要求 | 状态 | 完成证据要求 |
| --- | --- | --- | --- | --- |
| V1 | §5.11、§8 | 本地转写候选、模型与许可验证 | 🟡 | `scripts/asr-fixtures.ts`、`scripts/asr-runner.swift`、`scripts/asr-eval.ts` 及 `asr-eval.test.ts` 已完成 `transcribe.cpp` v0.4.1 与 4 份 GGUF 权重在 Apple M2 Pro 上的实测（见 `research/local-transcription-engines.md`）：选定 `Qwen3-ASR-0.6B-Q4_K_M.gguf`（562.3 MiB，Apache-2.0），16 条合成语音平均误差 0.67%、热推理 142.4 ms（30.6× RT）、峰值 `phys_footprint` 333.1 MB、卸载回落至 108.7 MB；平台范围已确认只针对 Apple Silicon（M 系列）+ macOS 14+；真人麦克风录音样本待阶段 C 补充 |
| V2 | §5.11、§7.4 | 模型下载、校验、取消/重试、加载/卸载 | ⬜ | 首次语音使用才下载，失败恢复与资源释放有证据 |
| V3 | §5.11、§7.2 | 麦克风、按住录音/松开结束/Esc 取消 | ⬜ | Swift 录音实现、用途说明、权限引导、设备/错误处理与真机结果 |
| V4 | §5.11、§7.5 | 会话状态与旧结果隔离 | ⬜ | umuo-app 规则与假音频测试，取消、重复触发及迟到结果不污染当前任务 |
| V5 | §5.7、§5.11 | 同语言整理与目标语言翻译 | ⬜ | Rust 任务与现有 provider/Key/请求复用；否定、数字、金额、日期、姓名和自我纠正样本 |
| V6 | §5.11 | 原目标输入框交付 | ⬜ | 目标捕获与复核、AX/受控粘贴、用户复制保护；同应用换框和跨应用均不误写 |
| V7 | §5.11 | 失败保留转写，音频清理，结果可复制重试 | ⬜ | 翻译失败不自动交付源语言；临时音频生命周期测试与隐私说明 |

## 模型与基础体验

| 编号 | PRD | 要求 | 状态 | 实现证据与剩余验收 |
| --- | --- | --- | --- | --- |
| B1 | §2.2、§6.1 | BYOK 供应商、自定义端点、本地文字模型、必要代理 | ✅ | `umuo-core/src/provider.rs`、`transport.rs`、`umuo-app/src/ops.rs`、`proxy.rs`；不代表任意模型都支持语音接口 |
| B2 | §6.4 | Keychain、Key 永不回显、配置保留未知字段 | ✅ | `Platform/Keychain.swift`、`SwiftHost.swift`、`settings_patch.rs`、`config_io.rs` |
| B3 | §6.3、§7.5 | 取消、超时、长文分片与截断保护 | ✅ | `umuo-core/src/chunk.rs`、`transport.rs`、`umuo-app/src/translate/`、`tests/pipeline.rs` |
| B4 | §5.9 | 基础本地记录及关闭记录 | 🟡 | `History/`、`umuo-store`、`history.rs`：第四批移除收藏与来源/模型筛选，保留搜索、删除、清空、复制、再次编辑与关闭记录；旧收藏数据保留；#105 的清空确认改为异步窗口附属警告表单，回车取消；#107 将搜索与清空移入系统工具栏（`HistoryWindowController`），保持搜索防抖，无记录且无搜索条件时禁用清空；历史窗已改系统 List，保留完整译文与文本选择，重载清理失效选择、删除前核验可见记录，`HistoryTests` 覆盖选择与删除回归 |
| B5 | §7 | 单一当前模型、菜单/快捷键/设置/首次引导收敛 | 🟡 | 已收敛为四个活跃文字/OCR 动作，退役键位不注册/不冲突；第二批已移除风格/术语管理及注入；第三批统一为一个当前模型，移除分场景/备用模型、本机自动回落、月度上限与费用报表，见依赖清单；#105 的设置说明常显、模型使用可编辑系统组合框、导入选文件后执行、导出结果与访达定位单独显示；首次引导改分组 Form、共用权限行与本地化窗口标题，界面与权限需真机验收 |
| B6 | §8 | 无障碍、原生交互、四语言界面 | 🟡 | `Localizable.xcstrings` 与原生控件已有；`SettingsPaneController` 同步工具栏、窗口标题及图标辅助功能文案，`SettingsPaneLocalizationTests` 覆盖首次载入、四语言切换及保存失败回滚；菜单栏标题改用当前界面语言，提示/错误行、OCR 编辑器与暂停开关改用原生控件；新增文案、VoiceOver、键盘、输入法、对比度和减少动态效果需真机验收 |
| B7 | §6.4、§8 | 老用户配置、历史、Key、登录项兼容 | 🟡 | 标识与存储路径保留；精简迁移及正式包升级仍需验收，旧迁移不改写 |

## 买断授权与官网

订阅、官方额度与 AI 网关退出当前范围；已有官网订阅文案不代表已实现收费客户端。
买断许可已进入开发范围，价格定为 9 美元（2026-10-27）；设备数、试用/退款、更新权益和最终支付方案尚未确定。

| 编号 | PRD | 要求 | 状态 | 完成证据要求 |
| --- | --- | --- | --- | --- |
| C1 | §5.12、§10 | 商业参数与一次性商品/授权方案 | ⬜ | 明确金额、设备/试用/退款/更新权益，审查现有支付能力 |
| C2 | §5.12 | 购买、许可证发放、激活、状态、解绑/换机 | ⬜ | 支付与授权测试闭环；客户端独立授权状态，不要求 umuo 账号 |
| C3 | §5.12、§6.4 | 退款、失效与离线状态、凭据分离 | ⬜ | 明确行为及自动回归；服务端不处理模型 Key、正文或音频 |
| C4 | §11 | 五语言首页、定价、条款、隐私、购买/激活 | 🟡 | `site/apps/web/src/content/`：已改为买断 BYOK，五语言定价页展示 US$9、未开放购买；首页增加 OCR 演示与买断 BYOK 说明，删除订阅/额度与已退出功能，语音标「开发中」；条款/隐私 v2.0 按请求直连改写。商业参数与支付处理方定案后补全 |

## 更新与发布

| 编号 | PRD | 要求 | 状态 | 实现证据与剩余验收 |
| --- | --- | --- | --- | --- |
| R1 | §12 | Sparkle 代码与签名清单链路 | 🟡 | `App/AppUpdater.swift`、`bundle.sh`、`scripts/sparkle-appcast.ts` 与 Worker 路由已改；本机签名冒烟通过，未发布 |
| R2 | §12 | 正式密钥、线上路由、N → N+1 更新 | ⬜ | 真实下载、验签、替换、重启全流程，不能以本机清单生成替代 |
| R3 | §8、§12 | Developer ID、公证、Gatekeeper、DMG 与系统权限 | ⬜ | 实际正式产物及安装/升级记录 |
| R4 | §8、§12 | 双架构真机、原生 release 性能 | ⬜ | 按 `RELEASE-GATES.md` 新测，旧 Tauri 数字不算通过 |
| R5 | §12 | 旧用户桥接、官网直装与 Homebrew | ⬜ | 先解决旧系统版本门槛，再验证配置/历史/Key/登录项保留；Homebrew Cask 未建立 |

## 本轮精简的执行状态

2026-10-23 第一批已开发：多模型对比的 Swift 窗口、Rust 编排与排行、FFI、专属事件、内核场景及专属测试已移除；
静默 OCR 和独立朗读快捷键的菜单/设置/引导/注册与执行分支已清理。结果朗读、正常 OCR 与四个文字/截图入口保留。
旧配置字段、未知字段、stats.json 和历史 compare 记录保留；退役键位不参与注册或冲突检查，也不触发热键重注册。
通用运行时阻塞/取消回归改用翻译任务，不能随对比删除。代码和测试依据见 [入口与依赖清单](IMPLEMENTATION-PLAN.md)。

第二批已移除风格切换、预设编辑、术语管理及其 FFI、模板渲染与注入链路。新翻译使用内部任务指令，
新历史统一记录 standard；旧 styleId/customStyles、术语文件及历史标识保留，配置转移仍支持旧数据。
损坏的旧术语文件不在启动/翻译中读取。导入提示明确旧数据不参与翻译。

第三批已移除月度上限、超限自动切换、费用报表与按日用量、单条与浮窗费用、分场景模型、备用顺序及本机自动回落；
翻译只用当前模型，失败如实上报。`sceneModels`/`fallbackModels`/`monthlyLimits`/`limitAction` 作为未知字段保留，
usage 表、v2 迁移与历史 `cost_usd` 列不动、只是停写。
第四批已移除输入翻译窗的回译与临时换模型、浮窗的收藏与换模型、词卡的词形变化与例句、历史的收藏分页与来源/模型筛选；
翻译请求不再带供应商/模型覆盖与回译标记，ops/FFI 的收藏与筛选候选接口删除，`favorites` 表与旧数据保留。
第五批已移除快捷面板的快速输入与菜单栏图标样式选择（固定模板图，旧 `trayIconStyle` 作未知字段保留）。
阶段 A 的代码精简已完成，原生验收基线（真机）尚未完成。
原地翻译继续属于核心，按 T4 验证。第一批已通过本机完整门禁，真实系统交互仍待验收。

## 验证记录

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
