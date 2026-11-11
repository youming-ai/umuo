# PRD 实现与验收清单

2026-11-02 · 对应 [PRD v0.8](PRD.md)；开发次序与精简批次见 [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)。
本表区分已有代码、新范围调整、未实现与真机验收。范围确认不会自动把未实现项标成完成。
精简前的完整实现证据保存在 [v0.4 快照](archive/PRD-CONFORMANCE-v0.4.md)，其中退出范围的条目不再作为首版要求。

状态：✅ 已有实现及自动验证；🟡 已有基础，仍需新范围调整或验收；⬜ 未实现/待完成。
✅ 不代表已发布，也不代替权限、焦点、多显示器和真实升级验证。

## 文字翻译

| 编号 | PRD | 要求 | 状态 | 实现证据与剩余验收 |
| --- | --- | --- | --- | --- |
| T1 | §5.2 | AX 取词、复制降级与剪贴板保护 | ✅ | `Platform/Selection.swift`、`Pasteboard.swift`、`ControlledPaste.swift`；2026-11-11 补齐快照与最终核验期间的 `changeCount` 检查，变化则停止借用，撰写窗不再以失败复制兜底覆盖新内容；读取格式返回 nil 也检查时间预算，超时不继续读取后续格式；复制降级使用短时只读事件监听，用户新按键或鼠标操作后保留当前内容；慢复制在同一次有界轮询内处理，恢复后不再覆盖任意变化；`VoiceDeliveryTests` / `PasteBackTests` / `ClipboardFallbackTests` 使用假剪贴板覆盖；无输入事件的外部程序化写入来源仍无法完全区分。Swift 规则/selftest 已有，真实应用兼容继续走查 |
| T2 | §5.1–5.2 | 非激活流式浮窗、复制/朗读/钉住/拖动/缩放 | 🟡 | `Panel/`、`Platform/Speech.swift`；#107 通过 `FloatingPanelChrome` 使用非激活系统面板，顶部拖动、四边缩放；macOS 26 使用 `floatingSurface` Liquid Glass，14–15 回落系统材质；#116 输入法组字中按 Esc 只取消组字、不关浮窗不取消翻译，原文超过三行可展开/收起、新翻译开始时收回；2026-11-06 修复 v0.2.14 显示划词浮窗时 `NSHostingView.windowDidLayout` 反复增高窗口导致的 `NSGenericException`，改由 AppKit 容器持有尺寸；`PanelLayoutSelfTest` 在完整 SwiftUI 事件循环覆盖显示、长原文、流式更新、缩放、报错重开与共用外壳的撰写窗，接入 `verify.sh selftest`；焦点、拖动、外观与多显示器仍需真机验收 |
| T3 | §5.3 | 简单输入翻译窗 | 🟡 | `Compose/`：第四批已移除回译与临时换模型，保留源/目标语言、自动翻译、复制与复制粘贴；#107 共用系统面板外壳与按系统版本切换的材质；#116 记下发出翻译时的原文与语言，只有与当前输入一致时才可提交，旧译文不会被提交；关掉自动翻译时页头给出「翻译」按钮，⌘T 同效；直接输入、粘贴回原应用与外观仍待真机验收 |
| T4 | §5.4 | 选区或整框原地翻译，失败不改原文 | 🟡 | `Platform/AXWriteBack.swift`、`umuo-app/src/translate/`；取词时保留 AX 控件身份凭据，写回前通过 Host 复核，避免同应用相同文本的其他输入框被覆盖；`FocusIdentityTests` 覆盖身份区分及粘贴前校验失败恢复剪贴板；浮窗粘贴获得锁后重新核验控件与安全输入；真实应用与同应用焦点变化待验 |
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
| V2 | §5.11、§7.4 | 模型下载、校验、取消/重试、加载/卸载 | 🟡 | `Voice/VoiceModelStore.swift`、`LocalTranscriber.swift`、`voice_session/model.rs`：首次使用才在浮层下载，`.partial` + Range 续传、超长或 SHA-256 不符即删、校验后原子改名；宿主进程内 mmap 加载、串行队列、abort 取消、空闲 300 s 卸载；`Package.swift` 以 binaryTarget 引入 transcribe.cpp v0.4.1 并校验 checksum，`bundle.sh` 拷入并签名框架、附四份许可。2026-11-11 校验任务传递取消，每个哈希块及安装前检查取消，保留完整断点且不触发预热；`VoiceModelStoreTests` 用可控校验覆盖取消与重试。真实 562 MB 下载、HF 重定向后 Range、首推 Metal 初始化时延（约 45 s，尚无单独「初始化」状态）待真机 |
| V3 | §5.11、§7.2 | 麦克风、按住录音/松开结束/Esc 取消 | 🟡 | `Voice/SystemVoiceRecorder.swift`（AVAudioEngine 跟随系统默认输入，16 kHz 单声道）、`GlobalHotkeys` 松开事件；两个语音键：`voiceHotkey` 整理（默认 ⌥⌘V）、`voiceTranslateHotkey` 翻译（默认 ⌃⌘V），进设置翻译页「语音输入」分组并参与冲突检查；`Platform/EscapeRouter.swift` 统一全局 Esc，按最近认领的浮层路由、无人认领即注销；`NSMicrophoneUsageDescription` 四语言与 `audio-input` entitlement。授权弹框、拒绝权限、换设备、⌃⌘V 占用情况待真机 |
| V4 | §5.11、§7.5 | 会话状态与旧结果隔离 | 🟡 | `crates/umuo-app/src/voice_session/`：纯状态机，会话号单调递增，非当前会话结果不改状态，Esc 分阶段丢弃录音/中止转写/取消后处理；`umuo-ffi/src/voice_session.rs` 导出，`VoiceController` 执行副作用；Rust 与 Swift 假音频测试覆盖迁移、重复触发、取消、迟到结果；#10 的 `VoicePostProcessor` 保留运行中旧会话的取消记录，`VoiceTests` 用延迟句柄覆盖新会话开始前后取消旧任务，迟到句柄仍收到取消；真机连按与各阶段 Esc 待验 |
| V5 | §5.7、§5.11 | 同语言整理与目标语言翻译 | 🟡 | `umuo-core/src/voice.rs`、`umuo-app/src/voice/`；FFI `Engine.start_voice`（同步启动、句柄取消、sink 回一次）经 `VoicePostProcessor.swift` 接入会话，按下的键决定任务、重试沿用；成功且完整的结果写 `voice` 场景历史（尊重关闭记录与隐私模式）；首次引擎加载显示「正在准备语音引擎」。真机质量评估待做 |
| V6 | §5.11 | 原目标输入框交付 | 🟡 | `Voice/VoiceDelivery.swift`：按下时记 pid/焦点元素/窗口，交付前依次核验权限、应用存活、前台、`CFEqual` 同元素同窗口、非安全输入；可写文本控件写 `AXSelectedText`（有选区替换、无则插入），不可判定或 Electron 类走受控粘贴（与取词互斥、快照剪贴板、⌘V 前复核、1 s 后仅在未被改动时恢复），非输入角色与终端拒绝；不合成回车；只交付当前会话完整结果，成功收起、拒绝保留可复制并说明原因；`VoiceDeliveryTests` 假 AX/私有剪贴板覆盖；2026-11-11 补齐快照后的焦点、安全输入、可写性与权限复核，覆盖初次 AX 写入失败后再降级粘贴的路径。未核验「相关文本上下文」；浏览器重渲染误判换框、Chromium 写入假成功、Electron 慢读剪贴板、安全输入等待真机 |
| V7 | §5.11 | 失败保留转写，音频清理，结果可复制重试 | 🟡 | `VoiceFailure` 带回转写；截断与失败在浮层显示原因、可复制可重试、不交付不记历史；`VoiceAudioFiles` 临时文件 0600、结束/取消即删、启动清扫。Esc 恰在后处理请求发出前时仍会发出一次并按会话号丢弃（与翻译流水线一致） |

## 模型与基础体验

| 编号 | PRD | 要求 | 状态 | 实现证据与剩余验收 |
| --- | --- | --- | --- | --- |
| B1 | §2.2、§6.1 | BYOK 供应商、自定义端点、本地文字模型、必要代理 | ✅ | `umuo-core/src/provider.rs`、`transport.rs`、`umuo-app/src/ops.rs`、`proxy.rs`；不代表任意模型都支持语音接口 |
| B2 | §6.4 | Keychain、Key 永不回显、配置保留未知字段 | ✅ | `Platform/Keychain.swift`、`SwiftHost.swift`、`settings_patch.rs`、`config_io.rs` |
| B3 | §6.3、§7.5 | 取消、超时、长文分片与截断保护 | ✅ | `umuo-core/src/chunk.rs`、`transport.rs`、`umuo-app/src/translate/`、`tests/pipeline.rs`；FFI 任务入队前建立结束守卫，panic 与运行时关闭（含首次执行前丢弃）均补发失败；`engine.rs` 回归覆盖 1000 个排队请求各收尾一次 |
| B4 | §5.9 | 基础本地记录及关闭记录 | 🟡 | `History/`、`umuo-store`、`history.rs`：第四批移除收藏与来源/模型筛选，保留搜索、删除、清空、复制、再次编辑与关闭记录；旧收藏数据保留；#105 的清空确认改为异步窗口附属警告表单，回车取消；#107 将搜索与清空移入系统工具栏（`HistoryWindowController`），保持搜索防抖，无记录且无搜索条件时禁用清空；历史窗已改系统 List，保留完整译文与文本选择，重载清理失效选择、删除前核验可见记录，`HistoryTests` 覆盖选择与删除回归；#116 多读一条判断是否还有更多，末尾显示「已显示最近 N 条 · 显示更多」；历史跨页改用记录 id 游标，超过 500 条仍可继续读取，`HistoryTests` 与存储层回归覆盖跨页新增/删除不重复、不跳行 |
| B5 | §7 | 单一当前模型、菜单/快捷键/设置/首次引导收敛 | 🟡 | 已收敛为四个活跃文字/OCR 动作，退役键位不注册/不冲突；第二批已移除风格/术语管理及注入；第三批统一为一个当前模型，移除分场景/备用模型、本机自动回落、月度上限与费用报表，见依赖清单；#105 的设置说明常显、模型使用可编辑系统组合框、导入选文件后执行、导出结果与访达定位单独显示；首次引导改分组 Form、共用权限行与本地化窗口标题；#114 提高菜单栏模板图标清晰度；#116 快捷面板读取期间切换的暂停状态以用户操作为准，首次读取失败也能显示；`OnboardingModel` 将草稿 Key 状态与已保存首选引擎完成度分开，未探测本机模型、切换草稿与保存失败回归由 `OnboardingModelTests` 覆盖；本机探测在 Key 状态等待后重新检查引导是否结束、首选是否变化，完成/关窗/切换首选的迟到结果回归已覆盖；2026-11-11 `DraftField` 按编辑版本与焦点保护新草稿，失败仅回滚仍属于原提交的内容；`OnboardingModel.saveKey` 捕获草稿版本与模型，供应商、Key、模型、端点变化或引导结束后丢弃迟到的界面与首选更新；`DraftFieldTests` / `OnboardingModelTests` 覆盖。界面与权限需真机验收 |
| B6 | §8 | 无障碍、原生交互、四语言界面 | 🟡 | `Localizable.xcstrings` 与原生控件已有；`SettingsPaneController` 同步工具栏、窗口标题及图标辅助功能文案，`SettingsPaneLocalizationTests` 覆盖首次载入、四语言切换及保存失败回滚；菜单栏标题改用当前界面语言，提示/错误行、OCR 编辑器与暂停开关改用原生控件；新增文案、VoiceOver、键盘、输入法、对比度和减少动态效果需真机验收 |
| B7 | §6.4、§8 | 老用户配置、历史、Key、登录项兼容 | 🟡 | 标识与存储路径保留；精简迁移及正式包升级仍需验收，旧迁移不改写 |

## 开源与官网

2026-11-02 起完全免费、MIT 开源：取消买断与订阅，删除 10-30 实现的客户端许可证/试用门控、Worker Waffo 收费与官网购买/激活。
原 C1–C4（买断授权）作废，当时的实现证据见[验证记录归档](archive/VERIFICATION-LOG-2026-10.md)与提交历史。

| 编号 | PRD | 要求 | 状态 | 实现证据与剩余验收 |
| --- | --- | --- | --- | --- |
| C5 | §5.12、§10 | MIT 许可与开源 | ✅ | 整个仓库（含 `site/`）为标准 MIT 文本（GitHub 可识别），名称与图标说明移至 README；历史压成里程碑并脱敏，2026-11-02 以干净历史重建并公开 github.com/youming-ai/umuo；官网 `SOURCE_PUBLIC` 打开。第三方许可逐项核查仍待做 |
| C6 | §5.12 | 客户端与服务端无收费路径 | ✅ | 客户端删除 `License/`（7 个文件）与 `LicenseTests`、`ActionRouter.gate`、设置许可证页、引导试用说明、46 个文案 key 与 `umuo://` URL scheme；Worker 删除 checkout/webhook/`/api/license/*`、`billing.ts`、`waffo-setup.ts`、`@waffo/pancake-ts` 与 `LICENSES` KV 绑定。远端 `umuo-licenses` KV、`WAFFO_PRIVATE_KEY` secret 与 Waffo 后台商品待手动清理 |
| C7 | §11 | 五语言官网免费开源文案；官网只有首页，不再提供条款与隐私页 | 🟡 | 删除 `/activate`、购买按钮、`/pricing`、`/terms` 与 `/privacy`（旧地址返回 404）；页脚只留版权与语言切换；`SOURCE_PUBLIC` 已为 true，页眉显示 GitHub 源码链接；内容测试禁止收费时代表述。首页一屏待人工测量 |

## 更新与发布

| 编号 | PRD | 要求 | 状态 | 实现证据与剩余验收 |
| --- | --- | --- | --- | --- |
| R1 | §12 | Sparkle 代码与签名清单链路 | 🟡 | `App/AppUpdater.swift`、`bundle.sh`、`scripts/sparkle-appcast.ts`、`release.yml`：SUFeedURL 为 GitHub `releases/latest/download/appcast.xml`，enclosure 指向同版本 Release 的 `umuo.app.tar.gz`；正式包改用固定自签名证书（公钥随仓库、私钥在发布 Secrets），嵌套框架统一签名；2026-11-06 本机 arm64 release、主应用/框架/DMG 签名验证与包内自检（75 通过、9 项 TCC 跳过）通过；CI 导入脚本改为临时 runner 管理员域的非交互代码签名信任，记录阶段并限制两分钟；假命令回归覆盖授权失败不导出配置、临时 p12 清理及本机拒绝执行；Release 第 16 次运行已验证非交互导入成功；继续补齐 runner 钥匙串搜索列表及实际试签检查，防止查得到身份但 codesign 无法签名（Release 第 17 次运行已验证真实试签、主应用及嵌套框架自签名、Sparkle 更新包验签与正式 v0.2.17 发布成功）；普通门禁仍为 ad-hoc，N → N+1 与首次身份迁移未实测 |
| R2 | §12 | 正式密钥、GitHub Releases 分发、N → N+1 更新 | 🟡 | 合入 main 自动发正式 Release（标 Latest，附件 `umuo-v<版本>.dmg` / `umuo.app.tar.gz` / `appcast.xml`），官网 `/download/macos` 302 到最新的 `umuo-v<版本>.dmg`，R2 已下线；从 GitHub 真实下载、验签、替换、重启全流程待实测，不能以本机清单生成替代 |
| R3 | §8、§12 | Developer ID、公证、Gatekeeper、DMG 与系统权限 | ⬜ | 实际正式产物及安装/升级记录 |
| R4 | §8、§12 | Apple Silicon 真机、原生 release 性能 | ⬜ | 按 `NATIVE-WALKTHROUGH.md`「性能测量」新测，旧 Tauri 数字不算通过 |
| R5 | §12 | 官网直装与 Homebrew | 🟡 | 官网直装经 GitHub Releases 已打通（未公证）；Homebrew Cask 未建立。旧 Tauri 用户桥接不适用：没有旧 Tauri 用户，相关代码与脚本已删除 |

## 精简与验证

2026-11-11：macOS 全面审查的五项修复通过完整 `bun run verify`：工具 lint / 类型检查、19 项工具测试、
Rust fmt / clippy / 全量测试、443 项 Swift Testing（新增 17 项，含复制响应先清空再写入的时序）、
原生与窗口布局自检、ad-hoc 打包冒烟；包内自检 74 项通过、7 项因权限或交互条件跳过。
真实输入框、临时事件监听权限与外部程序化剪贴板写入仍需按真机清单验收。

2026-11-11：PR #21 的剪贴板快照审查修复已在本机按 `verify` 各阶段验证通过：
锁文件版本 Biome、类型检查、19 项工具测试、Rust fmt / clippy / 全量测试；
426 项 Swift Testing（新增 7 个回归用例）、原生自检与窗口布局自检、ad-hoc 打包冒烟；
包内自检 74 项通过、7 项因权限或交互条件跳过。快照期间再次复制、核验期间复制与 nil 数据超时均使用假剪贴板验证，真实应用走查仍待完成。

阶段 A 五批精简的内容、兼容处理与入口清单只记在 [开发计划](IMPLEMENTATION-PLAN.md)「入口与依赖清单及批次进度」，这里不重复。
各批次与各次合入的门禁数字（2026-10-23 至 11-02）归档在 [archive/VERIFICATION-LOG-2026-10.md](archive/VERIFICATION-LOG-2026-10.md)。

最新基线（2026-11-02，`fix/review-ci-docs`，独立 TMPDIR）：根 `bun run verify` 全通过——Biome 11 个文件、工具测试 10 项；
Rust（rust-toolchain 1.98.1）fmt / clippy 通过，umuo-app 163、umuo-core 168、umuo-ffi 23、umuo-store 45、pipeline 15、event_wire 1；
314 项 Swift Testing（48 个 suite）；冒烟包自检 75 项通过、9 项因 TCC 未授权跳过。同一套 Rust 门禁在 Linux（rust:1.98.1 容器）也全部通过。
arm64 正式组装（`bundle.sh --version 0.0.1`）：主程序 arm64，`.app` 24 MB、`.dmg` 10.7 MB、`.app.tar.gz` 8.7 MB，自检 75 项通过、9 项跳过。
本机门禁只证明代码与自动测试；真实权限、焦点、输入交付、更新与公证仍按上表的剩余验收逐项记录。
