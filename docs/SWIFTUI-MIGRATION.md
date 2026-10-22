# 迁移到 SwiftUI

> 2026-10-19 定：只做 macOS，客户端从 Tauri + React 改成 SwiftUI；翻译内核 `umuo-core`
> 保留，经 UniFFI（`crates/umuo-ffi`）给 Swift 调用。官网直装 + Homebrew 分发，不上 Mac App Store。
> 进度以本文为准，每做完一步就改它。

## 为什么是这个组合

| 决定 | 理由 |
| --- | --- |
| SwiftUI + AppKit | 只做 macOS 后，Tauri 的跨平台收益没了，代价却还在：WebView 内存、假 IPC 夹具验不到权限（0.1.4 的撰写窗就是这么坏的）、浮窗做不成真正的非激活 NSPanel |
| 保留 Rust 内核 | 约 1 万行、200 多个测试，流式解析、长文本切分、月度上限这些踩过坑的逻辑不重写 |
| 平台层改用 Swift | 取词、写回、Keychain、Vision、语音、修饰键监听本来就是 Apple API，Swift 直接调用比 Rust FFI 更短。分两类：流水线中途要现取的只有 Keychain、前台应用、写回三样，Swift 实现 `HostBridge`、**由 Rust 回调**；取词、截图、OCR、语音、快捷键、连按修饰键、窗口、自启动、更新完全留在 Swift，不过 FFI（`docs/ARCHITECTURE.md` §2.1）。`umuo-platform*` 迁移期只给 Tauri 外壳用，不移植成 FFI |
| 不上 Mac App Store | 沙盒禁止对其他 App 用辅助功能、禁止 `CGEvent.post`，划词翻译与原地替换做不了（Apple DTS，论坛 thread 805556） |

## 目录

```
crates/umuo-core/     翻译内核（不变）
crates/umuo-store/    SQLite 历史与收藏（保留，经 FFI 调用，沿用现有数据库）
crates/umuo-app/      应用层：从 Tauri 外壳抽出的编排逻辑（AppCore、Host、翻译流水线、对比、命令业务、设置、术语表、统计……），两个客户端共用
crates/umuo-ffi/      UniFFI 导出层：只做类型转换，不写业务逻辑
apps/macos/           SwiftUI 客户端（Swift Package，不依赖 Xcode 工程）
  scripts/build-core.sh  编 Rust 静态库并生成 Swift 绑定（`UNIVERSAL=1`：arm64 + x86_64 lipo 成通用静态库，打包用）
  scripts/verify.sh      build-core → swift build → swift test → --selftest → bundle.sh --quick（`bun run verify:macos`）
  scripts/bundle.sh      阶段 5：组装、签名、（可选）公证 umuo.app，产出 .dmg 与 .app.tar.gz（+ 可选的更新签名）
  packaging/             Info.plist 模板、hardened runtime 的权利文件（刻意为空）、icon.icns（拷自 Tauri 版，阶段 6 删它时不受影响）
  dist/                  bundle.sh 的产物（不提交）
  .core/                 静态库与绑定的生成物（不提交）
  Sources/UmuoCore/      生成的 Swift 绑定（不提交）
  Sources/umuo_ffiFFI/   C 头文件模块（头文件是生成物，modulemap 与 shim.c 提交）
  Sources/Umuo/          应用本体（单个可执行目标，按功能分目录）：
    App/                   UmuoApp（只留一个空场景）、AppModel（Engine + 快捷键 + 七个功能的分发 + 各窗口的入口）、ActionRouter / HotkeyPolicy、
                           StatusBar（NSStatusItem：左键快捷面板、右键菜单；TrayIcon 样式与 StatusClick 分流两条纯规则）
    Platform/              阶段 2 的平台层：SwiftHost、Keychain、FrontmostApp、Selection、Pasteboard、KeyEvent、AX、
                           AXWriteBack、ReplaceSelection（浮窗替换原文，含 ⌘V 兜底）、HotkeyCombo、GlobalHotkeys、Hotkeys、
                           ModifierTap、ScreenCapture、OCR、Speech、Autostart（开机自启的 LaunchAgent，与 Tauri 同一个文件）
    Models/                L10n（String Catalog 读取与界面语言判定）、JSONValue（设置按键取值，不整份 Codable）、
                           Languages（设置页与首次引导共用的语言表）
    Panel/                 浮窗：PanelModel（状态机）、PanelSession（窗口状态 + PanelBackend 接缝）、PanelRules（定位、外观）、
                           PanelWindow（非激活 NSPanel、拖动区、缩放把手）、PanelView / WordCardView、PanelController（显示、
                           看门狗、Engine 流 → session、替换原文）、PanelTriggers（划词 / 原地替换 / 朗读 / 截图 / 静默 OCR）
    Theme/                 ThemeChoice（选择 → 真正用哪套）、Palette（packages/tokens/app.css 三套主题的令牌）
    Settings/              设置窗：SettingsModel（载入、改了就存、Key 状态）与各页子模型（EngineEditor / HotkeyEditor /
                           StylePresetsEditor / GlossaryManager / GeneralEditor / AdvancedEditor / RoutingEditor）、
                           SettingsBackend（接缝；正式实现 EngineSettingsBackend）、SettingsQueue、纯规则（SettingsTabs、
                           HotkeyFormat、StylePresets、GlossaryEditor、SettingsRules、Limits、SceneRouting、HotkeyConflict）、
                           SettingsUI（排版积木、失焦提交的 DraftField）、SettingsWindow（窗口与录键监听）、Pages/（六个分区页）
    Compose/               撰写窗：ComposeSession（输入、防抖、调度、回译、提交）、ComposeRules（粘贴目标、请求构造、写死的文案）、
                           ComposeQueue、ComposeWindow（可成为 key 的非激活 NSPanel、ComposeKey 快捷键）、ComposeView、ComposeController
    Compare/               对比窗：CompareModel（状态机）、CompareSession（选它、排序、空状态）、Reorder、CompareView（含 CompareLayout）、
                           CompareController（取词 → compareWithTicket、Esc 只取消这一轮）
    History/               历史窗：HistoryFormat（`history-format.ts` 的移植）、HistoryModel（HistoryBackend 接缝；正式实现
                           EngineHistoryBackend）、HistoryView、HistoryWindow（窗口与成为 key 时重读）
    Onboarding/            首次引导：Onboarding（步骤与完成度、默认引擎、本机模型挑选）、OnboardingModel（OnboardingBackend 接缝；
                           正式实现 EngineOnboardingBackend 转给 EngineSettingsBackend）、OnboardingView、OnboardingWindow
    Quick/                 菜单栏快捷面板：QuickModel（QuickBackend 接缝）、QuickView、QuickPanel（NSPopover + 正式 backend）
    Resources/Strings/     Localizable.xcstrings（由 scripts/export-xcstrings.ts 从 Tauri 版文案表导出）
    Resources/Tray/        菜单栏图标的三份 PNG（与 `src-tauri/icons/tray*.png` 同一套，`.copy` 原样拷贝）
    SelfTest/              `--selftest` 的各项
  Tests/UmuoTests/       Swift Testing：视图模型与纯规则的验收用例（由 TS 的 *.test.ts 逐条改写）
apps/desktop/         旧的 Tauri 客户端，迁移完成后删除
crates/umuo-platform*/ 旧客户端的平台层，只给 Tauri 外壳用，随它一起删除
```

## 本地开发

```bash
apps/macos/scripts/build-core.sh          # 内核或导出层改了就重跑；PROFILE=debug 更快
cd apps/macos && swift build
.build/debug/Umuo --selftest              # 从 Swift 逐项调用 Rust 内核
swift test -Xswiftc -plugin-path -Xswiftc /Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing
                                          # 视图模型与纯规则（只装 CLT 时要给插件路径，完整 Xcode 直接 swift test）
.build/debug/Umuo                         # 以菜单栏应用启动（默认不注册全局快捷键，见下）
.build/debug/Umuo --hotkeys               # 开发时强制注册（先退出 Tauri 版，否则两边抢同一个键）
.build/debug/Umuo --settings              # 启动时直接打开设置窗（读写的是真实配置目录与 Keychain，别在上面乱点）
```

只装了 Command Line Tools 也能编（不需要完整 Xcode），打包（`scripts/bundle.sh`，见「阶段 5」）也只要 CLT。
两处只装 CLT 才有的绕法：

- **Swift Testing**：CLT 带了 `Testing.framework`，但 `swift test` 找不到 `TestingMacros` 插件（`@Test` 报
  plugin not found），插件在工具链的 `usr/lib/swift/host/plugins/testing`，`verify.sh` 存在就显式传给它。XCTest 在 CLT 里没有。
- **String Catalog**：SwiftPM 见到目标里的 `.xcstrings` 就调 Xcode 的 `xcstringstool`（`.process` 要编译，`.copy` 单个文件也要生成符号），
  CLT 里没有它。所以整个 `Resources/Strings` 目录 `.copy`、运行时自己读 JSON（`Models/L10n.swift`）；两种工具链下行为一致，
  界面语言也能按设置明选而不跟系统。组装 .app 时 `Umuo_Umuo.bundle` 放进 `Contents/Resources`（`Bundle.module` 在那里找），`bundle.sh` 每次都断言这一点。

**全局快捷键默认不注册**（`App/ActionRouter.swift` 的 `HotkeyPolicy`）：开发期两个客户端常同时开着，抢同一个快捷键时后注册的静默失败。
只有 Bundle ID 是 `app.umuo.desktop` 的正式包（阶段 5 组装的 .app）才注册；`.build/debug/Umuo` 没有 Info.plist，不注册。
`--hotkeys` 开发时强制注册，`--no-hotkeys` 正式包也不注册（排查用）。

## 阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 | UniFFI 链路：字符串、布尔、列表、回调四种形态从 Swift 调通；CI 跑 `--selftest` | ✅ |
| 1 | 内核 API 导出：流式翻译（回调 + 取消）、Prompt / 路由 / 计量、单词词卡、术语表、月度上限；`umuo-store` 的历史与用量 | 🟡 主链路已通，剩余项见下 |
| 2 | Swift 平台层：AX 取词与写回、剪贴板降级、全局快捷键与连按修饰键（CGEventTap）、Keychain、Vision OCR、ScreenCaptureKit、语音 | 🟡 2a（`HostBridge`）已完成，见下 |
| 3 | 窗口：浮窗（真正的非激活 NSPanel，补上已知差距）→ 设置 → 撰写 → 对比 → 历史 → 首次引导 → 菜单栏快捷面板 | 🟡 3·基础、3·浮窗、3·设置、3·撰写、3·对比、3·历史、3·引导、3·快捷面板已完成（见下），待真机项见各行 |
| 4 | Pro 许可证：Keychain 存密钥，向官网 `/api/license/verify` 校验并缓存，离线按缓存；`umuo://activate?key=` 深链接；Pro 功能开关 | ⬜ |
| 5 | 打包与分发：组装 .app（Info.plist、LSUIElement、hardened runtime）、Developer ID 签名与公证、R2 发布沿用现有流程、Homebrew Cask、应用内检查更新 | 🟡 5·打包已完成（`bundle.sh`、经 update.json 的桥接脚本，见下）；Developer ID、Sparkle、Homebrew Cask 未做 |
| 6 | 切换：发布第一个 SwiftUI 版本，删除 `apps/desktop`、`umuo-platform*`、`packages/tokens` 与 Tauri 相关 CI | ⬜ |

## 阶段 1 的拆分

编排逻辑先从 Tauri 外壳搬进 `crates/umuo-app`（每一步 Tauri 都能编译、测试全绿、可以发版，行为不变），再经 `umuo-ffi` 导出。

| 步 | 内容 | 状态 |
| --- | --- | --- |
| 1.0 | 未知字段保留：`Settings` / `Glossaries` / `Stats` / 导出包与嵌套的 core 结构都带 `extra`（数据丢失修复，#70） | ✅ |
| 1.1 | 建 `crates/umuo-app`，搬设置、术语表、统计、导入导出、原子写、请求登记；外壳 `pub use` 重导出；CI 加 Linux job `app-core-linux`（#72） | ✅ |
| 1.2 | `AppCore` 与 `Host` trait；历史、预算搬进 `umuo-app`；外壳 `AppState` 拆成 `core` + 窗口状态，`Deref` 过渡（#73） | ✅ |
| 1.3 | 事件模型进 `umuo-app`（`TranslateEvent` / `CompareEvent` / 两个 sink），外壳经 `TauriSink` 发出，黄金快照守线上格式逐字节不变（#74） | ✅ |
| 1.4 | 搬流水线之前先写端到端测试：假宿主 + 本地 SSE 桩（`apps/desktop/src-tauri/src/pipeline_tests.rs`） | ✅ |
| 1.5 | 翻译流水线搬进 `umuo_app::translate`；`Host` 补上 `frontmost_app_token` 与 `write_back`，写回守卫留在 Rust | ✅ |
| 1.6 | 多模型对比搬进 `umuo_app::compare`，取消落到每一路 | ✅ |
| 1.7 | 命令的业务部分搬进 `umuo_app::ops`；设置保存改为 `AppCore::apply_settings_patch`（mtime 重载、顶层 patch、失败两边不变） | ✅ |
| 1.8 | `umuo-ffi` 导出 `Engine`（`open` / `translate` / `compare` / `settingsJson` / `applySettingsPatch`）、`RequestHandle`、`HostBridge` 与两个 sink、事件镜像、`defaultConfigDir`；`--selftest` 经本地 SSE 桩跑通 Start → Delta → Done、取消后不再有增量、设置往返保留未知字段 | ✅ |
| 1.9 | 文档：`docs/ARCHITECTURE.md` §2.1–2.3（应用层、Host、事件协议、线程约定） | ✅ |
| 1.10 | `ops` 的其余部分经 Engine 导出：历史、用量、收藏、术语表增删与导入导出、配置导入导出、Key 状态、模型列表、对比偏好 | ✅ `crates/umuo-ffi/src/ops.rs`：`historyQuery/Facets/Delete/Clear`、`favoriteToggle/favoritesStatus/favoritesList/favoriteRemove`、`usageSummary/usageDaily/monthlySpend`、`glossaryListJson/SaveJson/Remove/Import/Export`（**术语表走 JSON**：`Glossary` 带 `extra`，镜像成 Record 会在 Swift 存回时丢未知字段）、`keyStatus`、`configuredProviders`、`providerDetails`、`listModels`（阻塞等网络，只从后台调）、`styleCatalog`、`exportConfig/importConfig`（导入带回 `settingsJson` 与 `hotkeysChanged`）、`comparePicks/recordComparePick`、`quickState`；`beginRequest/cancelSurface`（宿主自己发提示时登记新 id，同 Tauri 的 `emit_notice`）；`prepareApiKey`（存 Key 前的校验规则，写 Keychain 留在 Swift，Host 不加写方法） |
| 1.11 | 纯规则导出：`parse_hotkey`、连按修饰键检测（`DoubleTapDetector`）、`should_auto_hide`（后者现在还在 Tauri 外壳里，先搬进 `umuo-app`） | ✅ `parseHotkey`、`doubleTapMatches`、`DoubleTapDetector`（`crates/umuo-ffi/src/hotkey.rs`）；`should_auto_hide` 与 `plan_replace` 搬进 `umuo_app::panel`（Tauri 已冻结，原件留到阶段 6 随外壳删除），连同写回守卫与失败文案、`selection_block_notice` 经 `crates/umuo-ffi/src/panel.rs` 导出 |
| 1.12 | 记录 release 下静态库与 .app 的体积（对 30 MB 目标的压力，见迁移计划风险 12） | ✅ 2026-10-22，`bundle.sh --version 0.2.0`（通用二进制、`strip -x`）：通用静态库 224 MB（只参与链接，不进包）；可执行文件每个架构约 13 MB，lipo 后 27 MB、strip 后 19 MB；`.app` 18 MB，`.dmg` 9.5 MB，`.app.tar.gz` 7.8 MB（strip 前分别是 26 / 11 / 9 MB）。同机的 Tauri 0.1.22：`.app` 18 MB、`.dmg` 8.5 MB、`.app.tar.gz` 9 MB。30 MB 的安装包门槛有余量 |

线程约定（sink 只 `yield`、宿主回调要快（写回守卫的 pid 例外，必须现查）、取消走 `RequestHandle`）写在 `docs/ARCHITECTURE.md` §2.3，Swift 端照它实现。

## 阶段 2 / 3 从哪里开始

**阶段 2（平台层）**：

| 步 | 内容 | 状态 |
| --- | --- | --- |
| 2a | `SwiftHost`（`apps/macos/Sources/Umuo/`）：`Keychain.swift`（SecItem，不设 `kSecUseDataProtectionKeychain`，与 `keyring` 写的同一个旧文件 Keychain 条目；读写删）、`FrontmostApp.swift`（名字读 NSWorkspace 通知缓存，pid 每次现查 AX）、`AXWriteBack.swift`（照搬 `replace_focus_text` 的可写与原文检查，无 ⌘V 兜底）；菜单栏应用后台打开正式 Engine；FFI 加 `bundleId()`；`--selftest` 用独立服务名 `app.umuo.desktop.selftest` 做 Keychain 往返，AX 项没授权时打印跳过 | ✅ 待真机：同签名读 Tauri 写的 Key 零弹窗、签名 .app 授权后 token 与写回 |
| 2b | AX 取词与 ⌘C 降级、全局快捷键、连按修饰键、OCR、截图、语音 | ⬜ |
| 2b·取词 | `Selection.swift`：AX 取选区（`AXSelectedText`），静默翻译的 `readFocusText` 无选区时只在 `AXValue` 明确可写才读整框；⌘C 降级（`Pasteboard.swift` 全量快照与恢复、进程级互斥、按 changeCount 判断、合成失败先恢复、迟到复制再恢复）；`KeyEvent.swift` 用 CGEvent 合成 ⌘C / ⌘V。黑名单仍由 Rust `check_trigger` 判断。`--selftest` 在私有命名剪贴板上跑整段降级事务，不碰用户剪贴板、不投递按键 | ✅ 待真机：授权后 Safari / Electron 取词、降级后剪贴板（含图片）原样 |
| 2b·快捷键 | `Hotkeys.swift`（`HotkeyCenter`）：七行设置先经 Rust `parseHotkey` 分流，组合键由 `HotkeyCombo.swift` 照搬 `global-hotkey` 0.8 的解析与 `key_to_scancode`，解析不了才回落默认键位；`GlobalHotkeys.swift` 用 Carbon `RegisterEventHotKey`（不要 TCC），失败按设置字段名记进 `failures`；暂停与录键（30 s 看门狗、录键时注销组合键、结束后重注册）共用一个 `suspended`。连按：`ModifierTap.swift` 只读 CGEventTap（设备位分左右、按完整 flags 对账补发丢失的松开、被系统停用时重新启用并清空按住状态），判定交给 Rust `DoubleTapDetector`；只在配了连按时才建监听，只记成功、授权后 `retryStart`。`--selftest` 只注册 ⌃⌥⇧⌘F13…F19 并全部注销，没有输入监控权限时不建监听、打印跳过 | ✅ 待真机：签名 .app 授权输入监控后 ⌃⌃ / ⌥⌥、⌃⌘Q 锁屏后连按不失灵、与 Tauri 版同开时的冲突表现。接进菜单栏应用（七个处理函数）随阶段 3 的窗口 |
| 2b·截图 OCR | `ScreenCapture.swift`：权限只用 `CGPreflightScreenCaptureAccess` 查询，`CGRequestScreenCaptureAccess`（每进程只弹一次）留给用户点「授权」；框选照旧调 `screencapture -i -x -o`（系统框选负责选区到像素的映射；ScreenCaptureKit 不带框选 UI，换它就得自绘浮层），临时文件放每次新建的 0700 目录、结束即删，没写出文件就是用户取消；ImageIO 解码（RGB / RGBA 都认）。`OCR.swift`：Vision `VNRecognizeTextRequest` accurate + 语言纠正，语言提示 zh-Hans / en-US / ja-JP，每行取 top1，`OcrResult` 丢空行、逐行 trim、`\n` 拼接；`ScreenOCR.run` 照 `screenshot.rs` 的分支与文案（无权限引导、取消不提示、截图失败 / 识别失败 / 没识别到文字）。`--selftest` 用内存里画的中英两行文字跑 Vision，框选与权限申请不跑 | ✅ 待真机：签名 .app 授权屏幕录制后 ⌥S 框选、多显示器与 Retina、Esc 取消不提示。接进菜单栏应用随阶段 3 的窗口 |
| 2b·朗读 | `Speech.swift`：进程内 `AVSpeechSynthesizer`（整个类在 MainActor 上，主线程 run loop 由应用持有——这正是 Tauri 版改用 `say` 的顾虑）；「停上一段 → 新建合成器开念 → 存起来」在同一个 MainActor 方法里做完，不叠音、不留停不掉的一段；文本经 `AVSpeechUtterance(string:)` 作为数据传入，以 `-` 开头的译文不会变成选项。`SpeechRules` 照搬 `speech.rs`：四层挑发音人（地区精确 / 同语言 × 自然 / 趣味）、30 个趣味音名单外加 AVSpeech 的 `isNoveltyVoice`，按名字排序后取第一个（与 `say -v '?'` 的字母序一致），返回 identifier（同名趣味音每个语言一份）；排除 Siri 音与个人声音；`toSpeechText` 同一套清理规则。`--selftest` 跑 Rust 的夹具与本机五种语言的挑选，不出声 | ✅ 待真机：词卡 / 浮窗的朗读按钮连点、念到一半按停。接进界面随阶段 3 的窗口 |


- 实现 `HostBridge` 的四个方法（语义与调用时机见 `docs/ARCHITECTURE.md` §2.1 的 Host 表）：Keychain 用 Security.framework 读 service `app.umuo.desktop`、account = 供应商 id 的同一个条目；
  前台应用的名字可以用 NSWorkspace 通知维护一个加锁缓存；`frontmostAppToken` 的 pid **必须调用时现查** AX 系统级 `AXFocusedApplication`（与 Tauri、与触发时取 `guardToken` 同一来源），
  不能读缓存：激活通知晚到时守卫会放行、把译文写进刚切过去的应用。写回走 AX，按 `FocusSource` 替换选区或整框。
- 其余平台能力在 Swift 里直接做，不经 Rust：AX 取词与 ⌘C 降级、全局快捷键、连按修饰键的 CGEventTap、Vision OCR、ScreenCaptureKit、语音。
  已知的坑照 `crates/umuo-platform*/` 的模块文档搬。
- 阶段 2 完成前要在真机上确认：装过 Tauri 版的机器上，同一个 Developer ID 签名的 Swift 构建读 Keychain 零弹窗；LaunchAgent 路径（见下）。

**阶段 3（窗口）**：

| 步 | 内容 | 状态 |
| --- | --- | --- |
| 3·基础 | 应用外壳：`AppModel` 启动时设 `.accessory`（菜单栏应用）、后台 `Engine.open`（`SwiftHost`）、持有 `FrontmostApp` 与 `HotkeyCenter`（连按的 `DoubleTapRouter` 在里面）；七个功能经 `ActionRouter` 分发，处理函数由各窗口 `handle` 进来，没接上的只打日志；快捷键注册受 `HotkeyPolicy` 门控（见「本地开发」）；设置变更 `hotkeysChanged` 时重注册。视图模型：`PanelModel` / `CompareModel`（按 `requestId` / `runId` 丢旧事件、同一 id 再来 Start 整体重置、FFI 事件换型）、`ComposeQueue`、`SettingsQueue`（同步部分在调用当下做完再返回保存任务，保存不在主线程调 Engine）；纯规则：`Reorder`、`Limits`、`SceneRouting`、`HotkeyConflict`、`ThemeChoice`、`OnboardingStep`、`AppLocale`。i18n：`scripts/export-xcstrings.ts` 一次性导出 448 条（zh-Hans 源 / zh-Hant / en / ja，`{name}` → `%N$@`，名字表在 `comment`），`Package.swift` 的 `defaultLocalization: "zh-Hans"`。`Tests/UmuoTests` 140 个用例（TS 的 `*.test.ts` 逐条改写 + 文案表 key 集合与占位符一致性），接进 `verify.sh`；`--selftest` 加 ops 导出项 | ✅ 待真机：签名 .app 下 `.accessory` 不出 Dock 图标、正式包注册快捷键 / `--hotkeys` 开发注册、与 Tauri 版同开时默认不抢键 |
| 3·浮窗 | `PanelWindow`：真正的非激活 NSPanel（`.nonactivatingPanel` + 无边框、`.floating`、`canJoinAllSpaces` / `fullScreenAuxiliary`、`hidesOnDeactivate = false`、`becomesKeyOnlyIfNeeded`：只有 OCR 原文框要打字时才成为 key；初始 420×260、最小 320×150）；header 是拖动区（`performDrag`），右下角缩放把手（无边框窗口的边缘缩放不可靠时也能缩）。Esc：浮窗弹出后、点按钮后都不是 key，窗口收不到按键，所以**浮窗可见期间把 Esc 注册成 Carbon 系统级热键**（无需 TCC，`PanelController.armEscape`，收起即注销；`GlobalHotkeys` 的 id 改为进程内全局递增、不认识的 id 放行给另一个实例），窗口的 keyDown 只是兜底。不让浮窗在显示 / 点击时成为 key：「替换原文」的 ⌘V 兜底发往 HID、落在 key 窗口上，浮窗是 key 就粘进了自己。界面缩放读设置的 `uiScale`（原值，坏值按 1、越界收进 0.85–1.5），缩放字号、圆角与 OCR 原文框高度（`Palette.Metrics`），窗口大小不变。显示在鼠标右下 (14, 18)，比 Tauri 多一步收进当前屏幕（`PanelRules.topLeft`）。`PanelController`：`Engine.translate` 在后台调，sink 只 `yield` 进每次请求自己的 `AsyncStream`（Done / Error 收尾，消费方没了就 `cancel()`），MainActor 上逐个交给 `PanelSession`；不经流水线的提示先 `beginRequest("panel")` 再发错误（Tauri 的 `emit_notice`）；划词 / 原地替换按键时登记的凭据一路用到翻译（`Engine.translateWithTicket` → `umuo_app::translate::run`，`Requests::ticket` 只认仍是当前的那一张，被顶掉就不跑），先按的键取词慢也不会后来居上。看门狗 500 ms、只在可见时跑、pid 后台现查，判据 Rust `shouldAutoHide`；归属在显示**之后**后台取、取到前为空（不收起），截图 OCR 的归属是本进程 pid。操作：复制（拿 `Pasteboard.exclusive`，后台）、朗读原文 / 译文 / 词卡（语言由 Rust `detectLanguage` 判）、替换原文（`planReplace` → 必要时切回源应用并等 600 ms → `replaceTargetError` 守卫 → `ReplaceSelection`：AX 改选区；`check_panel_writable` 只拒明确只读的文本控件，否则写剪贴板 + ⌘V 在同一次独占里、不恢复）、收藏（开始时查一次状态）、在撰写窗打开（`AppModel.composeOpener`，带浮窗归属）、换模型 / 换风格重译（只覆盖这一次，OCR 保住 ocr 模式）、OCR 原文可改后重译、钉住；出错块按 `SuggestedAction` 给重试 / 打开模型设置，缺权限送去对应的系统设置面板。`AppModel` 接上划词、原地替换、朗读、截图翻译、静默 OCR（黑名单经 `Engine.selectionBlockNotice`，应用名由现查的 pid 取、不读缓存）；菜单栏加了四个与 Tauri 托盘同名的入口（开发期不注册快捷键也能点）。设置窗与撰写窗的入口是 `AppModel.settingsOpener` / `composeOpener`，由那两组接上。`Theme/Palette`：`packages/tokens/app.css` 三套主题的色值、圆角、字号，主题与界面语言读设置的 `theme` / `locale`。测试：`PanelSessionTests`（按钮条件与动作，假 backend）、`PanelRulesTests`（定位、外观、`check_panel_writable`、FFI 规则）、`PaletteTests`（主色按钮与正文对比度 ≥ 4.5）；`--selftest` 加 ⌘V 兜底（私有剪贴板、假 ⌘V）、无权限时的替换拒绝、黑名单提示 | ✅ 待真机：签名 .app 授权辅助功能后浮窗不抢焦点（在文本编辑里划词，焦点与选区留在原处）、全屏应用与多桌面上出现、拖动 / 边缘缩放 / 把手缩放、切到别的应用 0.5 s 内收起而钉住不收、Esc 取消与收起、Safari / 备忘录里替换原文（AX）、VS Code / Slack 里替换原文（⌘V 兜底）、终端里拒绝替换、截图翻译与静默 OCR、黑名单应用里按快捷键只出提示；**不点浮窗**直接按 Esc：流式中取消、空闲时收起，浮窗开着时 Esc 不再送到源应用、收起后恢复，点进 OCR 原文框后按 Esc 只处理一次；设置里改界面缩放后再弹浮窗，字号随之变化；先按划词（⌘C 降级的慢应用）紧接着在快的应用里再按，浮窗只显示后一次的译文 |
| 3·设置 | `SettingsWindowController`：普通可聚焦窗口（840×700、最小 720×520、标题「umuo 设置」，与 Tauri 同），菜单栏加「设置…」（⌘,），浮窗的「设置」按钮经 `AppModel.settingsOpener` 打开它；菜单栏应用开窗前先 `activate`；内核还没打开就开了窗时，内核就绪后自动重载。六个分区与 Tauri 逐页对齐（通用 / 翻译 / 引擎 / 权限 / 高级 / 关于），起始页与点灯按 `SettingsTabs`（没配 Key → 引擎，缺权限 → 权限，超限点亮高级）。**读** `Engine.settingsJson`、**写** `applySettingsPatch` 只交改了的顶层键，经 `SettingsQueue`（逐个保存、失败只退回这几个字段、页面顶部 `prefs.saveFailed`、文本框的错误写在那一行）；保存与导入后交给 `AppModel.settingsApplied`，`hotkeysChanged` 时当场重注册；关掉再打开时整份重载（`SettingsModel.reopen`：各页草稿与行内错误清空，用量、花费、对比选择、开机启动、风格重读，起始页重算，换一个新的 `NSHostingView`；关窗时丢掉没保存的 Key 草稿，与 Tauri 每次新建 WebView 一致）；窗口开着、重新成为 key 时只重查权限、重读设置（有保存在路上时不刷新），`HotkeyCenter.onRegistered` 回来重读失败清单。**嵌套对象保留未知字段**：`customStyles` / `monthlyLimits` / `sceneModels` / 术语表都是「原对象 + 改动的字段」写回，不经 Swift 结构体丢 `extra`；`ModelRef` 与术语表的语言对是 **snake_case**（`provider_id`、`source_lang` / `target_lang`：Rust 那两个结构体没有 `rename_all`），`--selftest` 的 settings 几项把 Swift 写出的 patch 过一遍 Rust 校验。引擎页：Key 只出不进、明确按「保存」才写 Keychain（`prepareApiKey` → `Keychain.write`，后台，可能弹系统授权框）、换供应商清掉 Key 草稿并换成默认模型、结果回来时供应商换了就丢掉；Azure / 自定义端点、模型（失焦提交 + 推荐 / 拉到的模型菜单）、拉模型列表、分场景模型与备用顺序。翻译页：七行快捷键（录键器：点键帽开始，`HotkeyCenter.setRecording` 暂停全局快捷键，窗口的本地按键监听交给 `HotkeyEditor`，组合键按物理键位，连按两下修饰键交给 Rust 的 `DoubleTapDetector`；Esc / 窗口失焦 / 25 s / 关窗 / 换一行 / 换分区都结束并恢复；与别的功能撞键不存）、注册失败与静态冲突提示、风格、对比模型与供应商、常用组合、语言规则（按 App 记住、第二目标语言、取词黑名单）、自建风格编辑器（例句按行 id 绑定，删掉正在编辑的那一行不越界、不串行）、术语表管理（粘贴 CSV / TSV、复制 CSV，外加从文件读入、导出成文件；解析仍在 Rust）。高级页：代理（「自定义」没存过地址时先只展开地址栏）、用量、超限动作、每家月度上限（「10,5」这种认不出的数字拒绝提交，不当成清空）、历史开关 / 隐私模式 / 保留天数、打开历史。通用页：主题（设置窗自己即时换，含跟随系统）、目标 / 母语 / 界面语言、缩放、开机启动（`Autostart`：与 Tauri 同一个 LaunchAgent 文件与 Label，以磁盘为准，临时位置拒绝；**开发构建拒绝打开**，免得登录项指向 .build）、首次引导入口、菜单栏图标样式（只存设置）、配置导出 / 导入（导入后列出端点与黑名单的变化）。权限页：辅助功能、屏幕录制的实时状态（授权后 `retryStart` 补起连按监听）、申请与打开系统设置。关于页：版本（`CFBundleShortVersionString`，裸二进制显示未知）、更新占位行（如实说还没有应用内更新、去官网下载）、反馈与官网。String Catalog 新增 7 条（四种语言）。测试：`SettingsRulesTests`（分区、录键、连按、预设、术语表、输入规则、未知字段保留、LaunchAgent 用临时 HOME）、`SettingsModelTests`（假 backend：只交改动、失败回滚、换供应商、存 Key、录键暂停与恢复、换分区停录、关掉再打开清草稿并重读花费、撞键、预设 / 术语表保存顺序、代理与上限、每页三套主题渲染不崩）；`--selftest` 加 settings 六项 | ✅ 待真机：签名 .app 下保存 Key 覆盖 Tauri 写的条目时的授权框、之后浮窗读 Key 零弹窗；正式包录快捷键（录 ⌥D 不触发划词、录完恢复、⌃⌃ / 右⌘⌘ 录得出来）、与 Tauri 版同开时录键；开机启动写的 LaunchAgent 下次登录拉起的是 .app；权限页两个「打开系统设置」在当前 macOS 落到对应面板、授完辅助功能切回设置窗状态即时变绿；导入 / 导出配置与术语表文件（Excel 存的 UTF-16 CSV）；界面语言与主题切换后整窗即时更新、中英日三种语言下右侧控件不挤压折行；浮窗开着时在录键器里按 Esc 的表现；保存 Key 时恰好有翻译在读 Keychain（读的期间进程级关掉了 Keychain 交互），覆盖 Tauri 条目要的授权框可能弹不出来、报 -25308，重按保存即可（写入不能等读锁：那会让流水线的宿主回调排在用户对话框后面，§2.3）|
| 3·撰写 | `ComposeController` + `ComposeWindow`：无边框、透明、置顶、可缩放（660×440、最小 520×320，与 Tauri 的 `build_compose` 同），每次唤出重新居中；**可成为 key 的非激活 NSPanel**（收键盘输入、不激活 umuo，唤出前的应用一直在前台）。入口：⌥⌘A 与菜单栏「撰写窗」切换（可见就收起；唤出**之前**现查前台 pid 记成 ⌘⇧↩ 的粘贴目标，umuo 自己不算）；浮窗「在撰写窗打开」经 `AppModel.composeOpener` 只显示不切换，粘贴目标按 `ComposeRules.ownerForCaller`（浮窗归属优先、是自己才退回前台；Tauri `compose_owner_for_caller` 的测试逐条改写），原文只填输入框、交给防抖。`ComposeSession`：输入框是自己的状态，停 500 ms（`ComposeRules.debounce`）交给 `ComposeQueue`（翻译中只排队、最新的胜出），自动翻译可关，四个下拉（源语言 / 目标语言 / 供应商 / 风格）是这一次的覆盖、不写回设置，换一个就按新选择再翻；主译文与回译各一份 `PanelModel`，事件按 `Route.back` 分道，主译文 start 时清掉旧回译，只有主译文的 done / error 推动队列；内核没打开时就地报错并收尾队列。回译：只在主译文完成后可点，目标语言由 Rust `detectLanguage` 从原文推断，判断不出时说「无法判断原文语言，回译不可用」不发请求。提交：⌘↩ / ⌘⇧↩（窗口本地按键监听，输入法组字时放行；⌃↩ 同 Tauri 也算），流式中途与空译文不提交；写剪贴板（剪贴板锁）→ 收起 → ⌘⇧↩ 时 `ReplaceSelection.refocus` 切回目标、**现查前台 pid 确认确实是它**才在同一把剪贴板锁里写入并 ⌘V（审查 M19），确认不了就只留在剪贴板、用浮窗说「译文已复制到剪贴板，但原来的应用没能回到前台……」。Esc 只收起（与 Tauri 一样不取消）。词卡朗读走共用的 `Speech`。`ReplaceSelection.refocus` 从 `PanelController` 挪出来与浮窗「替换原文」共用。测试：`ComposeRulesTests`（粘贴目标、请求覆盖、回译三种情形、快捷键与组字）、`ComposeSessionTests`（假 backend：防抖合并、排队、出错推动队列、自动翻译开关、预填不绕过开关、换下拉重翻、内核未就绪、回译分道与清空、流式中途不提交、提交带目标与结果文案、重试走队列） | ✅ 待真机：中文输入法在非激活面板里组字、候选窗位置、Esc 取消组字不收起窗口；⌘↩ 后焦点直接回到原应用；⌘⇧↩ 粘回 Safari / 备忘录 / Electron（Slack、VS Code）、从设置窗里按 ⌥⌘A 唤出时 ⌘⇧↩ 不粘贴并由浮窗提示、没有辅助功能权限时同样只复制；浮窗开着时从浮窗打开撰写窗，第一下 Esc 先收起浮窗（浮窗的系统级 Esc）；四个下拉在非激活面板里能正常弹出；全屏应用上唤出；输入框里 ⌘V / ⌘A / ⌘Z（菜单栏应用没有编辑菜单时 NSTextView 拿不到这些快捷键，设置窗的 Key 框同样依赖它） |
| 3·对比 | `CompareController`：普通标题栏窗口「umuo 对比」（1000×460、最小 640×320、置顶，与 Tauri 的 `build_compare` 同），开窗前 `activate`。入口：对比快捷键与菜单栏「多模型对比」——后台 `beginRequest("compare")` 当场顶掉上一轮，**取词黑名单**拦下就用整窗提示，取词（选区优先、⌘C 降级）失败也用整窗提示，成功后用按键时的凭据 `Engine.compareWithTicket`（FFI 新增，与 `translateWithTicket` 同理：慢的旧按键不会后来居上，被顶掉时什么都不跑、不计费）。sink 只 `yield`，流在 Rust 丢掉 sink 时收尾（对比没有「整轮结束」事件）。`CompareSession`：卡片按 `CompareModel`（`runId` 丢旧事件、按下标归位、落定后不再收增量），头部「N 个模型 · 目标语言」与原文、排序提示、最常选；每张卡流式译文、等待 / 翻译中、截断提醒、出错保留半段译文、计量行（耗时 · token · 费用，价格未知说无价格信息）、复制这一版；「选它」→ `recordComparePick` 换上新排行并标「已选为最佳」，新一轮 start / notice 清掉；◀ ▶ 与拖动按**当前显示顺序**挪，顺序跨轮保留；拖拽数据是只在本进程可见的私有类型 `app.umuo.compare-card`，放下只认它（别的应用拖来的文字不换位置）；SwiftUI 没有拖动结束回调，取消的拖动留下的位置在新一轮 / 收起 / Esc / 唤出、以及鼠标松开后回到卡片区时清掉（Tauri 在 `onDragEnd` 清）；空状态先说快捷键（读设置的 `compareHotkey`）再说整窗提示或「还需要两把 Key」；卡片平分宽度、最窄 240，放不下整排横向滚动（`CompareLayout`）。Esc（窗口本地按键监听）先 `cancelSurface("compare")` 再收起，只停这一轮的四路；「收起」按钮只收起。测试：`CompareSessionTests`（Esc 与收起、选它与清空、记偏好失败、左右移动与越界、拖放、取消的拖动之后不接外来文字、残留拖动在新一轮 / 收起 / Esc 清掉、跨轮保留顺序、空状态与头部文案、复制、卡片宽度、快捷键文字）；Rust `compare_with_ticket_runs_only_the_latest_begun_run` | ✅ 待真机：四家各配 Key 时四张卡同时流出、一家 Key 填错只有那张报错；Esc 停住后不再长字、浮窗与撰写窗的翻译不受影响；拖动卡片（SwiftUI `onDrag` / `onDrop`；拖到窗口外或按 Esc 取消后，鼠标回到卡片区半透明即消失；取消一次拖动后再从别的应用拖文字进来不换位置、也不显示可放下）与 ◀ ▶；窄窗口横向滚动；密码管理器里按对比快捷键被拦下 |
| 3·历史 | `HistoryWindowController`：普通可聚焦窗口「umuo 翻译历史」（760×620、最小 560×420，与 Tauri 的 `open_history` 同），复用同一个窗口与模型，开窗前 `activate`；入口：菜单栏「翻译历史」、快捷面板、设置「高级」页。**每次成为 key 都重读**（审查 L25）。`HistoryModel`：两个分页（历史 / 收藏 N）；页头是本月用量一行（`usageLine`：未计价条数如实说出）与最近 14 天的按日柱状图（`dailyBars`：只排已有的天、不补零，最矮 2pt，悬浮说明带日期 · 次数 · 费用）；搜索与来源 App、模型两个筛选是 AND，改了 250 ms 防抖后重查（期间再改只查最后一次，慢的旧查询晚回来不盖新结果），候选值来自 `historyFacets`；每页 100 条，一次问完一屏的收藏状态；隐私模式开着时如实提示；数据库打不开时页头说「历史不可用：原因」而不是空列表。每行：时间（本地 `YYYY-MM-DD HH:mm`）、译文、原文两行、元信息（供应商 · 模型 · 场景 · 风格 · token · 估算 · 费用或「未计价」· 来源 App，拿不到就略过）；收藏 / 复制 / 再次编辑（`openCompose`，不带浮窗归属，粘贴目标只认当前前台的外部应用）/ 删除；清空先 `NSAlert` 确认、说出清了几条、收藏不受影响。收藏页：原文、译文、单词 / 句子 · 语言；复制（空串译文退回原文，审查 L23）、移除。Engine 的 SQLite 调用都在 `Task.detached`。测试：`HistoryTests`（`history-format.test.ts` 逐条改写 + 视图模型：AND 一起送、防抖只查最后一次、失败说清楚、收藏切换、清空确认与取消、删除、再次编辑、收藏复制与移除、隐私模式）；`--selftest` 的 `DataSelfTest`（真实 FFI 上的筛选、柱状图与用量一行、删除与清空不动收藏） | ✅ 待真机：上千条记录时的滚动与搜索手感；清空的确认框在历史窗前面弹出；「再次编辑」后 ⌘⇧↩ 粘回的是唤出历史窗之前的应用 |
| 3·引导 | `OnboardingWindowController`：普通窗口「欢迎使用 umuo」（720×560、最小 560×460、居中，与 Tauri 的 `open_onboarding` 同）；已开着（含最小化：先还原）只前置、不另开第二个窗，`windowWillClose` 只认自己那扇窗，关掉后再开是新模型、从第一步重来（设置「通用」页的「重新运行首次引导」）。**启动时**内核打开后读 `onboardingDone`（显式字段，不靠「有没有配 Key」推断，`AppModel.needsOnboarding`），没走完就**错开 400 ms** 再弹。`OnboardingModel`：五步（欢迎 / 语言 / 模型 / 权限 / 试一试），进度与 ✓ 只用于显示、**不拦「下一步」**，第一页没有「上一步」；欢迎页的键帽读当前设置。语言与引擎经与设置窗同一条 `SettingsQueue`（逐个保存、只交改了的键、失败退回）写进设置：**存 Key 之后连 `providerId` + 该家的默认模型一起存**（修好的 TS 版 H6；Key 走 `prepareApiKey` + Keychain，与设置窗同一份实现）；「检测本机模型」依次问 Ollama、LM Studio 的模型列表（`Onboarding.pickLocal`：第一家有模型的取第一个；在跑但没模型与压根没检测到说法不同），首选此刻用不了才换成探测到的那家（`engineForLocalModel`：有 Key 的云端引擎、本来就是本机供应商的都不抢）。权限：辅助功能与屏幕录制的状态、打开系统设置、重新检测、请求授权（只在点了才申请，系统对话框一个进程只弹一次）；窗口重新成为 key 时自动重查。试一试：示例句走与划词相同的流水线，浮窗自己弹出来。没有引擎时最后一页写明后果；「跳过」与「开始使用」都先等最后一次保存落定，再 `applySettingsPatch({onboardingDone: true})` 并关窗，记不下就留着窗口说原因。测试：`OnboardingModelTests`（只交改了的键、H6、空白 Key 不存、Ollama / LM Studio 探测与不抢首选、两种失败说法、试一试、权限、结束等保存 / 没引擎也能结束 / 记不下不关窗 / 前面保存失败照样结束）+ `PickLocalTests`；`DataSelfTest` 验 `providerId` + `model` 与 `onboardingDone` 过得了 Rust 校验 | ✅ 待真机：全新用户（删掉 settings.json）启动 400 ms 后弹出；在引导里存 Key 是否弹 Keychain 授权框（覆盖 Tauri 版写的条目、签名不同时）；开着 Ollama / LM Studio 时检测到模型；授完辅助功能切回窗口状态自动变成已授权；最小化后再点「重新运行首次引导」还原同一扇窗；「翻一句看看」浮窗出现在鼠标旁 |
| 3·快捷面板 | `StatusBarController`：菜单栏图标改用 `NSStatusItem`（SwiftUI 的 `MenuBarExtra` 分不出左右键）；**左键开快捷面板，右键与 ⌃ 左键出菜单**（`StatusClick`，菜单只在右键时临时挂上、弹完摘掉，否则左键也弹菜单）。菜单项与顺序与 Tauri 的 `build_tray` 逐条一致（写死的中文）：翻译选中文本 / 输入框原地替换 / 撰写窗 / 多模型对比 / 截图翻译 / 静默 OCR（只复制原文） / — / 快捷面板… / 翻译历史 / 设置…（⌘,） / 检查更新… / 退出 umuo（⌘Q）；「检查更新…」是占位：弹框说明这一版还没有应用内更新、请到官网下载（与设置「关于」页同一句，随阶段 5 换成真的）。图标按设置的 `trayIconStyle`（模板 / 品牌色 / 黑色，认不出回落模板；只有模板交给系统着色），启动与每次保存设置后当场换（`TrayIcon`）。`QuickPanelController`：图标下弹出的 `NSPopover`（340×420，与 Tauri 的快捷面板同尺寸），**要抢焦点**（快速输入得能打字），同一入口再点就收起；每次弹出重读状态与外观（`.transient` 在点图标的 mouseDown 就收起面板，按钮 action 在 mouseUp 才到：0.3 s 内刚收起的不再弹回，`shouldReopen`）。`QuickModel`：页头暂停 / 恢复（`HotkeyCenter.paused`：组合键与连按都停，菜单与面板里的入口照常）与暂停提示；当前模型（供应商 · 模型，没选写「未选择」）与「配置」；快速输入（⌘↩ 或按钮，只有空白时不发）走与划词相同的流水线、先收起面板、浮窗自己弹出来（审查 H3）；最近翻译点一下复制译文；末尾一行打开历史 / 设置。测试：`QuickTests`（状态与模型一行、第一次读不到说原因之后不打扰、暂停切换、空白不发、失败说在面板上、复制、图标样式与资源、左右键分流、菜单项与 Tauri 逐条一致、引导要不要自动弹）；`DataSelfTest` 的 `quickState` | ✅ 待真机：左键弹面板 / 右键与 ⌃ 左键出菜单、⌘, ⌘Q 在菜单里生效；三种图标样式在浅色 / 深色菜单栏上的样子（模板图着色、品牌色不被重画）；面板挂在图标下面（含副屏、刘海屏）、点外面收起、再点图标收起而不是闪一下又弹回、能直接打字、⌘↩ 触发翻译；暂停后全局快捷键不响应、恢复后照常；⌘, 在历史 / 引导窗里不会打开空白窗口 |

与 Tauri 版有意不同的一处：`HotkeyConflict.normalize` 的别名表补了 `alt`（TS 版漏了，`Alt+Shift+T` 与 `Option+Shift+T` 归一化后不相等、重复检查放过去）。

浮窗与 Tauri 版有意不同的几处（都是补差距，不改语义）：浮窗放不下时收进当前屏幕；显示后归属取到之前为空，看门狗不会拿上一次的归属把刚弹出的浮窗判成「切走」；
「换个模型」的供应商列表每次显示都重读（Tauri 只在启动时读一次，刚配的 Key 要重启才出现）；复制失败会在浮窗里说出来（Tauri 吞掉了）；
黑名单判断用现查 pid 对应的应用名（Tauri 是 AX 的 `AXTitle`，同为现查）；被顶掉的划词请求根本不发出（Tauri 照发、靠旧 id 丢事件）。
与 Tauri 版不同、是代价的几处：浮窗开着时 Esc 被浮窗独占（系统级热键），源应用收不到，umuo 自己的设置 / 撰写窗也收不到（例如录键器里按 Esc 会先收起浮窗）；浮窗从不主动成为 key，按钮不能用 Tab 键盘导航
（保住源应用的焦点与选区、⌘V 兜底不粘进自己）；主题、语言、界面缩放在下一次弹出时生效，不像 Tauri 那样随 `settings://*` 广播即时变。

设置窗与 Tauri 版有意不同的几处：术语表多了「从文件读入…」「导出文件…」（Tauri 只有粘贴与复制 CSV），配置导入多了「选择…」；
开发构建不许打开开机启动；关于页的更新行是占位说明（应用内更新随阶段 5）；术语表编辑框里还没存过的新表在列表刷新后留着（Tauri 会丢）；
`ModelRef` 与术语表语言对按 Rust 真实的 snake_case 读写。**Tauri 版这两处其实是坏的**：TS 发 `providerId` / `sourceLang`，
前者让 `applySettingsPatch` 整次拒掉（分场景模型、备用顺序、对比模型在 Tauri 设置页里存不上），后者被当成未知字段存下、Rust 看到的语言对永远是「不限」。
Tauri 已冻结、这不属于安全 / 数据丢失 / 崩溃，没有修；要修就在 `umuo-core` 给这两个字段加 `serde(alias)`。
与 Tauri 版不同、是代价的：浮窗开着时 Esc 被浮窗的系统级热键先拿走，录键器里按 Esc 会先收起浮窗（见上）；
菜单栏图标样式随 3·快捷面板接上了：改了当场换图标。

撰写窗与 Tauri 版有意不同的几处：窗口是可成为 key 的**非激活**面板（Tauri 会激活自己：⌘↩ 收起后 umuo 留在前台、没有窗口，
⌘⇧↩ 必须先把原应用切回来）；目标语言下拉默认「按设置」（Tauri 一打开就把设置里的目标语言当成这一次的覆盖传进去，
于是绕过了「原文就是第一目标语言时改用第二目标语言」——母语写的内容会被翻成母语——并在开了「按 App 记住」时把它记成那个应用的选择）；
供应商与风格列表每次唤出都重读（Tauri 只在窗口建好时读一次）；「重试」走调度队列（Tauri 直接发，紧接着的输入可能与它并发）；
输入法组字时 Esc / ⌘↩ 交给输入法；⌘⇧↩ 的写入与 ⌘V 在同一把剪贴板锁里做完。

对比窗与 Tauri 版有意不同的几处：入口过取词黑名单（Tauri 的 `compare::trigger` 漏了，密码管理器里的文字会被同时发给四家）；
取词后用按键时的凭据开跑（`compareWithTicket`；Tauri 外壳本来就是按键时登记、取词后沿用，FFI 原来只有现登记的 `compare`）；
「选它」失败、复制失败会在头部说出来（Tauri 吞掉了）；◀ ▶ 在两端禁用；内核没打开时按快捷键也开窗、用整窗提示说明。

历史窗与 Tauri 版有意不同的几处：收藏、清空之后的「已收藏」「已清除 N 条」真的留在页头（Tauri 先写提示再整页重读，重读成功会把提示清掉，一闪而过）；
慢的旧查询晚回来不会盖掉新查询的结果；历史行的「复制」失败会说出来（Tauri 吞掉了）。

首次引导与 Tauri 版有意不同的几处：「检测本机模型」在 Ollama 之后还问 LM Studio（Tauri 只问 Ollama，可引导文案本来就写着
「Ollama 或 LM Studio」），为此新增三条文案（`onboarding.detectLocal` / `localMissing` / `localNoModels`，Ollama 专用的两条留在表里不再用）；
「翻一句看看」会把浮窗弹出来（Tauri 的 `translate_text` 不弹，浮窗没开着时什么都看不见，页面上却写着「浮窗应该已经出现了」）；
窗口重新成为 key 时自动重查权限（Tauri 只能点「重新检测」）；探测进行中按钮置灰、不叠请求。

快捷面板与菜单栏与 Tauri 版有意不同的几处：面板是挂在图标下的 `NSPopover`，点外面就收起（Tauri 是无边框置顶窗口、不会自己收起，
从菜单打开时摆在屏幕右上角）；面板末尾多了打开历史 / 设置两个入口（新增 `quick.openHistory` / `quick.openSettings` 两条文案）；
⌃ 左键也出菜单（触控板没有右键的习惯）；图标样式按**规范化之后**的值决定是否模板（Tauri 用原始值，手改成认不出的值时模板图以原色显示）；
菜单里不再有「内核已连接」一行（Tauri 托盘没有；内核没打开时快捷面板会说「快捷面板不可用：原因」）。
有意没做的：应用内更新（随阶段 5）；暂停状态不持久化（与 Tauri 一样，重启后恢复响应）。
`UmuoApp` 只留一个不插进菜单栏的 `MenuBarExtra`（`isInserted: false`）：换成 `Settings` 场景的话 SwiftUI 会往主菜单塞一个 ⌘, 「设置…」，
历史窗等窗口是 key 时 ⌘, 会打开一个空白的 SwiftUI 设置窗。历史窗在内核就绪前打开时，内核打开后自动重读（与设置窗的 `engineReady` 同）。

- 流式：`Engine.translate(request:guardToken:sink:)` / `Engine.compare(text:sink:)`（快捷键入口用 `translateWithTicket` / `compareWithTicket`）立即返回 `RequestHandle`；sink 把事件 `yield` 进 `AsyncStream`，
  `onTermination` 里调 `handle.cancel()`。静默翻译在触发时取好前台 pid 作 `guardToken` 传入。
- 视图模型：把 `panel-state.ts`、`compare-state.ts`、`compose-queue.ts`、`settings-queue.ts` 移植成 `@Observable`（按 `requestId` / `runId` 丢弃旧事件，
  同一 id 再来 Start 就整体重置），原来的 `.test.ts` 改写成 Swift Testing 当验收用例（CLT 里没有 XCTest）。已完成，见上表。
- 设置：`Engine.settingsJson()` 读、`applySettingsPatch` 写（只交自己改的键，`hotkeysChanged` 为真就重注册快捷键）；Swift 只解码视图要用的字段。
- 历史、术语表等窗口要的数据接口按 1.10 逐个从 `umuo_app::ops` 导出。

## 阶段 5：打包与分发

**还没有 Developer ID**（2026-10-22）：脚本按「有就用、没有就 ad-hoc」写好，拿到证书后只需设环境变量，不改脚本。

| 步 | 内容 | 状态 |
| --- | --- | --- |
| 5·打包 | `apps/macos/scripts/bundle.sh`（`bun run bundle:macos -- --version X.Y.Z`）：`build-core.sh` 以 `UNIVERSAL=1` 编 arm64 / x86_64 两份 release 静态库并 lipo（`MACOSX_DEPLOYMENT_TARGET=14.0`，否则 ring 等 C / 汇编按本机 SDK 打标）；`swift build -c release --triple <arch>-apple-macosx14.0` 两个架构**各用一个 scratch 目录**（新构建系统的产物目录不分架构，共用会互相覆盖；链接前删旧可执行文件，SwiftPM 不把 `-L` 的静态库当输入）；lipo + `strip -x`。组装 `umuo.app`：`packaging/Info.plist`（`app.umuo.desktop`、`LSUIElement`、`LSMinimumSystemVersion` 14.0、`umuo://` 的 `CFBundleURLTypes`、四种界面语言、版本号来自参数）、`icon.icns`、`Contents/Resources/Umuo_Umuo.bundle`。签名由内向外（先资源包再 .app，不用 `--deep`），hardened runtime + `packaging/umuo.entitlements`（不开沙盒，刻意为空）；身份取 `APPLE_SIGNING_IDENTITY`，没有就 ad-hoc。`APPLE_API_KEY` / `APPLE_API_ISSUER` / `APPLE_API_KEY_PATH` 都在时：zip → `notarytool --wait` → staple .app，再从 staple 过的 .app 打 `.dmg`（签名、公证、staple）与 `.app.tar.gz`。`--updater-sign`：用 Tauri 更新通道的 minisign 私钥（`TAURI_SIGNING_PRIVATE_KEY` 或 `~/.tauri/umuo-updater.key`，经 `bunx tauri signer sign`）签 `.app.tar.gz`。每次组装完自检：Info.plist 关键值、资源包位置、`codesign --verify --strict`、hardened runtime、通用二进制，再**从 .app 里跑 `--selftest`**（新增 `resources` 一项：报出资源包的真实路径与 Bundle ID，脚本断言它在这个 .app 的 `Contents/Resources` 里、Bundle ID 是正式的）。只产出文件，不上传 | ✅ 待真机：见下 |
| 5·冒烟 | `bundle.sh --quick`：复用 `swift build` 刚编好的 debug 产物、只本机架构、一律 ad-hoc（忽略 `APPLE_SIGNING_IDENTITY` / `APPLE_API_*`，门禁保持离线、不弹 Keychain）、不打 .dmg，同一套自检。已接进 `verify.sh` 与 CI 的 macos-app job。平常只多几秒；新签名的二进制第一次启动时系统要评估一遍，那一次二三十秒。正式的通用二进制（两个架构各编一遍 release，3–5 分钟）不进门禁 | ✅ |
| 5·桥接 | `scripts/release-swift-local.sh X.Y.Z [--publish]`（`bun run release:swift`）：前置检查与 `release-local.sh` 相同 → `bun run verify` → 临时改 Cargo.toml 版本（Rust 的 User-Agent 与导出配置里的 `appVersion`）→ `bundle.sh --updater-sign` → 在 `apps/macos/dist` 写好与 `release-local.sh` 同形状的 `update.json` / `latest.json`。**默认不上传**，`--publish` 才按「安装包先、清单后」传 R2，且要显式 `ACK_MIN_OS_14=1`（见下「发桥接版之前」第 4 条）。`release-local.sh`（Tauri 版）一个字没改 | ✅ 未发过 |
| 5·Sparkle | Swift 版自己的应用内更新 | ⬜ 见下 |
| 5·Developer ID / 公证 | 证书到手后设 `APPLE_SIGNING_IDENTITY` 与三个 `APPLE_API_*` | ⬜ 没有证书 |
| 5·Homebrew Cask | | ⬜ |

**为什么文件名沿用 Tauri 的**：`.app` 叫 `umuo.app`、可执行文件叫 `umuo-desktop`（`CFBundleExecutable`）。开着开机自启的老用户，
`~/Library/LaunchAgents/app.umuo.desktop.plist` 里写死的是 `/Applications/umuo.app/Contents/MacOS/umuo-desktop`；
换名字的话升级后登录项指向一个不存在的文件，`Autostart` 以磁盘为准，开关也会显示成「关」。`.dmg` 拖进「应用程序」时也正好替换掉旧的那一个。

**桥接怎么生效**（`tauri-plugin-updater` 2.14 / `tauri` 2.12 的源码）：更新器下载 `update.json` 指向的 `.app.tar.gz`，用 `tauri.conf.json` 的公钥验 minisign 签名；
解压时**剥掉第一层目录**、换进用户现在的安装位置（压缩包里 `.app` 叫什么都行，但顶层只能有一个目录）；
「重启以更新」读**新** Info.plist 的 `CFBundleExecutable` 再启动。所以同一把私钥签的 Swift 版 `.app.tar.gz` 会被 Tauri 版静默装上。

**发桥接版之前**（以下任何一条没想好就别 `--publish`）：

1. **先接上 Sparkle**。Swift 版现在没有应用内更新（菜单与关于页的「检查更新」是占位），桥接过去的用户此后收不到任何更新，只能自己去官网下载。
2. 发出去之后 `update.json` 指向 Swift 版，**不要再用 `release-local.sh` 发 Tauri 版**：它会把 `update.json` 改回 Tauri 包，还没升上来的用户收到的就又是 Tauri 版
   （已经换成 Swift 版的用户不读这个清单，不受影响），`latest.json` 也会让官网下载退回 Tauri 版。
3. 没有 Developer ID 时是 ad-hoc 签名。现在的 Tauri 版也是 ad-hoc（`codesign -dv` 显示 `Signature=adhoc`），每次更新 cdhash 都变，
   用户本来就要重新授权辅助功能 / 输入监控 / 屏幕录制、读 Key 时弹一次 Keychain 授权；换成 Swift 版这一次一样，不更糟。有了 Developer ID 之后才不再这样，
   所以**最好等证书**：桥接版用 Developer ID 签，之后的 Sparkle 更新授权都留得住。
4. **Swift 版要 macOS 14+**（`LSMinimumSystemVersion` 14.0），已发的 Tauri 版是 10.13+。Tauri 的更新器只比版本号与平台键（`darwin-aarch64` / `darwin-x86_64`），
   不看最低系统版本，所以 macOS 13 及更早的用户也会被换进 Swift 版，「重启以更新」后起不来（「需要 macOS 14」），手里没有能用的应用、也没有退回的更新路径。
   先弄清 14 以下的用户占比再决定；`--publish` 要显式设 `ACK_MIN_OS_14=1` 才放行。不能接受的话就一直保留 Tauri 版的 `update.json`（不桥接），只走官网下载。

**切到 Sparkle（之后做）**：

- 依赖：Sparkle 2 是 SwiftPM 包（`https://github.com/sparkle-project/Sparkle`，二进制 target 的 xcframework；只装 CLT 时能否链接要先验一次）；`bundle.sh` 要把
  `Sparkle.framework` 拷进 `Contents/Frameworks`、给可执行文件加 `@executable_path/../Frameworks` 的 rpath，并**由内向外**先签框架里的
  `Autoupdate`、`Updater.app`、XPC 服务再签 .app（不要 `--deep`）。
- 签名：Sparkle 用自己的 EdDSA（ed25519）密钥，`generate_keys` 生成，公钥写进 Info.plist 的 `SUPublicEDKey`，私钥只在发版机的 Keychain。
  与 Tauri 的 minisign 私钥是两把钥匙，不能混用。
- 清单：Sparkle 读 appcast（RSS，`SUFeedURL`，例如 `https://umuo.app/download/macos/appcast.xml`），由 `generate_appcast` 按 `.dmg` 或 zip 生成，
  在 R2 里与 `update.json` **并存**：`update.json` 留给还没升上来的 Tauri 用户（指向最后一个桥接版），appcast 给 Swift 用户。
- 界面：菜单「检查更新…」与关于页的占位换成 `SPUStandardUpdaterController.checkForUpdates`；启动后静默检查沿用 Tauri 版的节奏（错开 10 s、不打断翻译、装好等用户重启）。
- 顺序：Sparkle 版先作为普通 Swift 版发出（官网下载）、确认能从 N 升到 N+1，再用 `release-swift-local.sh --publish` 发桥接版。

**待真机**：Intel 机器上启动通用二进制（本机没有 Rosetta，x86_64 那一半只验了 `lipo -archs`，没跑起来过）；装着 Tauri 版的机器上走一次桥接
（先用一把**测试用**的 minisign 密钥与本机起的 update.json 验：Tauri 版下载、验签、换进 `/Applications/umuo.app`、「重启以更新」拉起的是 Swift 版）；
桥接后开机自启照常（LaunchAgent 指向的 `umuo-desktop` 还在）、设置与历史都在、读 Key 的授权框只弹一次；
从 `.dmg` 拖装后 Gatekeeper 的「仍要打开」流程（ad-hoc）；正式包启动后不出 Dock 图标（`LSUIElement`）、默认注册全局快捷键；
在 macOS 13 的虚拟机上启动正式包（应被系统以「需要 macOS 14」拒绝，确认第 4 条的后果）；`open umuo://x` 能拉起应用（只登记了 scheme，没有处理函数，阶段 4 再做）；有证书之后：公证通过、`spctl --assess` 通过、`stapler validate`。

## 真机冒烟清单

迁移期间把流水线从 Tauri 外壳搬进 `umuo-app` 再接到 SwiftUI，每一步都只该「挪位置、不改行为」。
自动化部分由 `apps/desktop/src-tauri/src/pipeline_tests.rs` 守着（假宿主 + 本地 SSE 桩：故障转移重发 start、
Esc 后不再有增量、超额换供应商、断网走本机模型、分片并发与顺序、只在成功时写回、前台换了拒绝写回、对比按卡片分流）；
下面这些依赖真实的系统权限、窗口与网络，只能在真机上点。**每次发 Tauri 版之前、以及每个搬流水线的 PR 合并前跑一遍**，
先 `bun run build:desktop-ui && cargo build -p umuo-desktop`（见 AGENTS.md：只跑 `cargo test` 不会更新二进制）。

- [ ] **划词**：在 Safari / 备忘录里选一句英文按划词快捷键，浮窗在鼠标旁出现、逐字流出译文，结果卡片显示模型与耗时；历史里多一条、来源应用正确。
- [ ] **⌥⌥ 静默替换**：在文本编辑的输入框里选一段（以及不选、整框）连按 ⌥，原文被译文原地替换；翻译中途切到别的应用，原文不被改动并提示目标已变化。
- [ ] **撰写回译**：撰写窗输入中文翻成英文，再点回译，回译结果出现在单独区域、不覆盖主译文。
- [ ] **对比**：选一句按对比快捷键，每个已配 Key 的供应商一张卡片各自流出；故意填错一家的 Key，错误只落在那张卡上。
- [ ] **Esc**：长文翻译流到一半按 Esc，增量立刻停住，不再有新字出现。
- [ ] **超额换供应商**：给当前供应商设一个已超出的月度上限、动作选「换供应商」，翻译改由另一家完成，结果卡片带提醒。
- [ ] **断网走本地模型**：开着 Ollama 或 LM Studio 并拔网（或关 Wi-Fi），翻译改由本机模型完成并标「离线」。
- [ ] **截图 OCR**：截图翻译快捷键框选一段屏幕文字，浮窗显示识别结果的译文；没有屏幕录制权限时引导到对应的系统设置面板。

## 必须守住的兼容性

- **Bundle ID 保持 `app.umuo.desktop`**：设置目录、Keychain 服务名（`app.umuo.desktop`）、辅助功能授权都挂在它上面。改了，老用户升级后 Key、设置、历史全部「消失」。
- **`.app` 名 `umuo.app`、可执行文件名 `umuo-desktop` 不变**：开机自启的 LaunchAgent 写死了 `…/umuo.app/Contents/MacOS/umuo-desktop`（见「阶段 5」）。
- **`settings.json` 的字段名与格式不变**（camelCase）。**只由 Rust 读写**：Swift 经 FFI 改设置，不自己用 Codable 解析这个文件（Swift 合成的 Codable 缺键会整体解码失败，老用户的设置会被重置）。
  未知字段已经保留（`umuo_core::UnknownFields`，规则见 `docs/ARCHITECTURE.md` §4）：新版本写的字段，用户回到旧版本保存一次也不会丢。
  配置目录是 `~/Library/Application Support/app.umuo.desktop`（2026-10-21 真机确认）。Tauri 用 `app_config_dir()`；
  Swift 经 FFI 的 `defaultConfigDir()`（即 `umuo_app::paths::config_dir_for`）取，`--selftest` 断言它。**仍待真机确认**：LaunchAgent 路径。
- **历史库沿用 `history.db` 与 `umuo-store` 的迁移**，不换存储引擎。
- 快捷键默认值、取词黑名单、隐私模式等行为以 `docs/PRD-CONFORMANCE.md` 为验收标准，逐条对齐，不凭印象。

## 参考

- [Easydict](https://github.com/tisfeng/Easydict) 的交互与架构可以参考（同样是直装分发、AX + 模拟 ⌘C 取词）。
  **它是 GPL-3.0，umuo 是闭源软件，不能复制它的任何代码**——只看设计，按 THIRD_PARTY_NOTICES 的规则登记参考。
- 平台层的已知坑（坐标系、剪贴板恢复、CGEventTap 被系统停用后要重新启用）都写在 `crates/umuo-platform*/` 的模块文档里，移植时照着搬。
