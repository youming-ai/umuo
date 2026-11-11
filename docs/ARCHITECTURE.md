# umuo 架构

> 本文描述当前代码结构（Swift + SwiftUI + AppKit 客户端，Rust 内核经 UniFFI 调用；旧 Tauri / WebView 与 Rust 平台层已于 2026-10-22 删除）。
> 产品范围见 [PRD](PRD.md)，功能验收见 [PRD-CONFORMANCE.md](PRD-CONFORMANCE.md)，发布流程见 [SWIFTUI-MIGRATION.md](SWIFTUI-MIGRATION.md)。
> 多模型对比、风格 / 术语、费用预算、模型路由与收藏已退出；三项核心是文字翻译（含原地替换）、OCR 截图翻译、语音输入后整理 / 翻译。

## 1. 全貌

```text
apps/macos/Sources/Umuo/          SwiftUI 界面 + AppKit 窗口 + Apple 系统 API
  App/                           生命周期、菜单栏、动作分发、应用模型与 Sparkle 更新
  Platform/                      AX 取词与写回、Keychain、剪贴板、快捷键与全局 Esc、Vision、朗读、自启动
  Panel/ Compose/                翻译浮窗、输入翻译
  Voice/                         录音、模型下载、本机转写（transcribe.cpp）、语音浮层、后处理与交付
  History/ Settings/             历史与设置
  Onboarding/ Quick/             首次引导与菜单栏快捷面板
  Theme/                         外观选择（ThemeChoice）与浮窗材质（floatingSurface），不是设计令牌
  Models/ SelfTest/              文案表、语言等共用模型；--selftest 自检
             │ UniFFI 生成的 Swift 绑定
             ▼
crates/umuo-ffi/                  Engine、RequestHandle、HostBridge、VoiceSession / VoiceSink、事件换型
             ▼
crates/umuo-app/                  AppCore、Host、翻译流水线、语音后处理（voice/）与会话状态机（voice_session/）、设置、历史
             ├── crates/umuo-core/   Provider、Prompt（翻译与语音任务）、协议、传输、计量
             └── crates/umuo-store/  SQLite 历史（收藏与用量表只保留旧数据）

site/                            官网与 Worker，独立 Bun 项目
```

## 2. 分层规则

Swift 负责界面、窗口与系统集成；可复用应用逻辑放 `umuo-app`，Swift 经 FFI 调用，不重新实现。
`umuo-ffi` 只做类型转换与调用转发，不写业务逻辑。
`umuo-core`、`umuo-app` 不依赖任何平台 API 或 UniFFI；Linux CI 验证它们可编译测试。
供应商网络请求统一由 Rust 发出，界面只显示 Key 是否已配置，不读回明文。

原生界面遵循 Apple Human Interface Guidelines；优先使用 SwiftUI 标准控件、系统语义颜色、字体、SF Symbols，
由 AppKit 补充非激活浮窗、菜单栏与窗口管理。不维护自己的设计令牌：`Theme/` 只有外观选择（跟随系统 / 浅色 / 深色）
与浮窗材质（macOS 26 的 Liquid Glass，更早回落系统材质）；视觉与辅助功能仍需真机走查。

## 2.1 应用层与宿主

`AppCore` 持有设置、历史库、HTTP 客户端与请求登记。
流水线中途必须现取的平台能力通过 `Host` 回调 Swift 的 `SwiftHost`；可以提前取得的值由 Swift 随请求传入。
取词、截图、OCR、录音与本机转写、输入框交付、快捷键、窗口、自启动与更新留在 Swift 宿主，不扩充为 Rust 平台层。

| Host 方法 | 实现与约束 |
| --- | --- |
| `api_key(provider_id)` | `Platform/Keychain.swift` 用 Security.framework 读旧文件 Keychain，不设 `kSecUseDataProtectionKeychain`；service 保持 `app.umuo.desktop`，account 是供应商 id |
| `frontmost_app_name()` | `FrontmostApp.swift` 读取 NSWorkspace 激活通知维护的加锁缓存，用于来源标注与按 App 记忆 |
| `frontmost_app_token()` | 每次现查系统 AXFocusedApplication 的 pid，不能用可能晚一拍的激活通知缓存 |
| `write_back(source, original, text)` | `AXWriteBack.swift`：仅成功且目标守卫放行后写回；检查可写性与原文；静默替换不模拟粘贴 |

回调全部同步，在 Rust 工作线程执行，不等待用户授权，也不得 `DispatchQueue.main.sync`。
需要授权时返回可操作错误，由界面引导用户处理，避免主线程与 Rust 同步调用互相等待。

## 2.2 事件协议

流水线通过 `umuo_app::event` 的 `TranslateSink` 发事件。
`umuo-ffi/src/event.rs` 镜像成 UniFFI enum / record，Swift sink 收到后按顺序放入 AsyncStream。
转换使用完整解构，不用 `..`，让新增字段在导出层触发编译错误。

- 翻译：Start、Delta、Card、Done、Error；`Route` 指定 surface、request_id。
- Swift 只处理当前 request_id，旧请求迟到的事件不得覆盖新结果。
- 语音后处理：`Engine.start_voice` 同步启动、返回句柄，结果经 `VoiceSink` 只回一次（成功或带转写的失败），不流式。
- 语音会话：`VoiceSession` 是纯状态机，Swift 把输入（按下、松开、Esc、转写结果等）交给它，按返回的副作用执行；
  会话号单调递增，非当前会话的结果不改状态。

`crates/umuo-app/tests/event_wire.rs` 保留历史 JSON 契约快照；当前 Swift 通过 FFI 类型接收事件，不经过 WebView IPC。

## 2.3 线程约定

- Swift 在后台完成阻塞取词、Engine 初始化、SQLite 和设置操作，UI 状态在 MainActor 更新。
- Engine 自建多线程 tokio 运行时；不开 UniFFI 的 tokio feature，保持连接池只活在这一套运行时。
- Host 回调由 BridgeHost 包在 `block_in_place` 内；不等待主线程，不阻塞其他流与取消轮询。
- Sink 同步 yield 到 AsyncStream 后立即返回；不要为每个增量分别创建 Task，避免重排。
- 流式方法同步启动并立即返回 RequestHandle；取消显式调用 `cancel()`，Swift 的流终止时取消；丢弃句柄不会自动取消。
- 设置锁不跨 await。传输层每 100 ms 检查取消，取消后不再发送增量。
- Engine 释放时 `shutdown_background`，不等待工作线程，避免主线程死锁或 tokio 自线程退出 panic。

权威细节在 `umuo-ffi/src/lib.rs`、`engine.rs`、`host.rs`、`event.rs` 的文档注释里，修改时同步更新。

## 3. 一次翻译的链路

全局组合键由 Carbon RegisterEventHotKey 注册，连按修饰键由 CGEventTap 监听，再交给 App 的动作分发。
Swift 先检查取词黑名单与权限，在后台 AX 取词；必要时用串行剪贴板降级、模拟 ⌘C 并恢复原剪贴板。
浮窗使用 AppKit 非激活 NSPanel，通过 NSHostingView 承载 SwiftUI。

Engine 启动 `umuo_app::translate`：读取设置、取当前供应商的 Key 与地址、判断语言、构造 Prompt、
必要时分片、发出流式事件、记历史。只用一个当前模型，失败如实上报，不换候选、不回落本机模型。
Swift 处理事件更新界面。

### 3.1 入口

文字与截图有四个入口：划词读选区；原地替换读选区或整个可编辑输入框；撰写由用户输入；OCR 由系统框选后本机识别。
撰写窗的源 / 目标语言覆盖只作用于本次请求；模型始终是设置里的当前模型，不按请求覆盖。
语音有两个按住说话的键：整理（默认 ⌥⌘V）与翻译（默认 ⌃⌘V），链路见 §3.5。
全局 Esc 由 `Platform/EscapeRouter.swift` 统一注册，按最近认领的浮层路由，无人认领即注销，不吞其他应用的 Esc。

### 3.2 撰写调度

`ComposeSession` / `ComposeQueue` 处理防抖、最新输入与请求登记，旧增量按 id 丢弃。
提交只复制，或在确认原应用已回到前台后粘贴；无法确认时只复制并提示，不向其他应用投递按键。

### 3.3 写回守卫

静默替换在触发时取得前台 pid，成功后现查前台 pid 与之比较，变化或不可读就拒绝写回。
整框替换还要确认 AXValue 可写且原文未变；失败、取消或结果截断都不能修改原文。
浮窗「替换原文」在源应用恢复后执行，首选 AX 改写选区；AX 走不通时的剪贴板兜底与语音交付共用受控粘贴
（与取词互斥、快照剪贴板、⌘V 前复核目标、事后仅在未被改动时恢复）；明确只读的文本控件拒绝，不盲目粘贴。

### 3.4 回归验证

`crates/umuo-app/tests/pipeline.rs` 使用假 Host + 本地 SSE 桩覆盖单模型请求、失败不换候选（含旧路由/预算配置）、取消、
断网不探测本机模型、分片并发与顺序、写回守卫；在 Linux 也能执行。
`umuo-ffi` 的 Engine 测试与 Swift `--selftest` 验证跨语言链路；视图模型与纯规则由 Swift Testing 验证。
真实授权、焦点、多显示器、剪贴板降级与按键需要真机验收，不以单测通过代替。

### 3.5 语音链路

1. 按下语音键：`VoiceController` 记下目标（pid、焦点元素、窗口），检查麦克风权限与模型；模型只在首次使用时下载
   （`VoiceModelStore`：`.partial` + Range 续传、SHA-256 校验后原子改名）。
2. 录音：`SystemVoiceRecorder` 用 AVAudioEngine 录 16 kHz 单声道到 0600 的临时文件（`VoiceAudioFiles`，结束、取消即删，启动时清扫）。
3. 松开：`LocalTranscriber` 在宿主进程内用 transcribe.cpp（`CTranscribe.framework`）+ Qwen3-ASR 模型转写，mmap 加载、空闲 300 s 卸载；
   不走网络，不需要语音 Key。
4. 后处理：`VoicePostProcessor` 调 `Engine.start_voice`，Rust 的 `umuo-app::voice` 用当前文字模型做同语言整理或翻译
   （指令在 `umuo-core::voice`，保留否定、数字、姓名、日期与金额）；成功且完整的结果写 `voice` 场景历史。
5. 交付：`VoiceDelivery` 依次核验权限、应用存活、前台、同一焦点元素与窗口、非安全输入；可写文本控件写 `AXSelectedText`，
   不可判定或 Electron 类走受控粘贴，终端与非输入角色拒绝；不合成回车。拒绝或失败时结果留在浮层可复制、可重试。
6. Esc 在录音、转写、后处理各阶段分别丢弃录音、中止转写、取消请求；迟到的结果按会话号丢弃。

## 4. 数据与存储

| 数据 | 存在哪 | 为什么 |
| --- | --- | --- |
| API Key | 系统 Keychain（Swift Security.framework，服务名 `app.umuo.desktop`） | PRD §6.4。不进配置文件、不进日志、不进历史库 |
| 偏好（供应商 / 模型 / 语言 / 快捷键 / 历史开关） | `settings.json`（应用配置目录） | 不敏感但需要记住。结构体上有一条测试守「文件里不许出现 Key 字段」 |
| 旧对比偏好统计 | `stats.json` | 仅保留旧文件，当前版本不再读取、更新或删除 |
| 翻译与语音历史 | `history.db`（SQLite，`crates/umuo-store`） | PRD §5.9。本机文件，不上传 |
| 旧收藏、旧用量账本 | 同上，`favorites` 表与 `usage` 表 | 功能已退出，表与迁移保留、旧数据不删，程序不再读写 |
| 语音模型 | 应用配置目录的 `models/`（`umuo-app::voice_session::model`） | 首次使用时下载并校验 SHA-256，不随安装包分发 |

`settings.json`、`glossaries.json` 共用 `persist.rs` 的读写：
**写**是临时文件 + `sync_all` + `rename`，断电后不会只剩半截；**读**只有「文件不存在」才静默回落默认值，
读不动（编码不对、权限）或解析失败都先挪成 `<文件名>.corrupt-<时间戳>` 再回落——
用户手改坏一个字符，不该连原内容都看不到，备份带时间戳也不会被第二次损坏覆盖。

保存设置与导入配置走同一个 `AppCore::apply_settings_patch`（`crates/umuo-app/src/settings_patch.rs`）：
JSON 顶层逐键覆盖在最新设置上，mtime 变了先重载；嵌套对象整体替换，不做深合并。
重载逐字段容错：类型不对的键沿用当前值，其余手改照样生效；有读不懂的内容时，真要写盘前先复制原文到 `.corrupt-<时间戳>`，复制失败就不保存。
`Settings::prepare_for_save` 做规范化、代理与端点校验；失败时内存和文件都不变。
Swift 经 `Engine.applySettingsPatch` 只交自己改的键，不自己解析配置文件。
快捷键重注册、外观与界面语言由 Swift 宿主应用。
**自定义端点与需要 Key 的供应商覆盖只接受 `https://`**（`localhost` / `127.0.0.1` / `[::1]` 例外）：这些地址会收到明文的 Bearer Key。本机模型类供应商（Ollama / LM Studio）不发 Key，局域网 http 地址也放行。
只校验这次改动了的端点，老配置里已有的局域网 `http://` 地址不会让用户从此改不了任何设置。
导入分两步：Swift 只读一次文件，`Engine.previewImport` 校验并给出摘要、什么都不写；用户在确认框里看过才用**同一份内容**调 `Engine.importConfig`。
不合法就整份拒绝、一个文件都不写；摘要列出端点、代理、取词黑名单、快捷键的变化，保留期改短（应用时当场删历史），以及会被整份替换的本地旧风格与术语表。

**本版本不认识的字段原样保留**（`umuo_core::UnknownFields`，`#[serde(flatten)] extra`）：设置与导出包保留未知字段。
退役的 `customStyles` 及 `glossaries.json` 的列表使用完整 JSON Value 保存，不解释、规范化或重建条目。
旧 `styleId` 只保留配置兼容，新历史统一记录 `standard`；旧历史中的风格标识不改写。
导入（`config_io::prepare_import`）对设置与术语表**顶层**的 `extra` 按键合并、文件优先、本地独有的保留；嵌套列表随文件整份替换。
导出时设置 `extra` 里名字像凭据的键（含 apikey / secret / token / password / credential）一律去掉。

### 4.1 历史库（`umuo-store`）

- **迁移走 `PRAGMA user_version`**，脚本按版本递进放在 `MIGRATIONS` 里。
  **已发布的迁移不要改**：用户的库只会执行比它当前版本高的那些，改旧迁移对既有库完全无效，
  只会让新库与旧库的形状悄悄分叉。要改就加新一版。
- **打开失败不让客户端起不来**：`AppCore.store` 是 `Option`，`None` 时历史命令
  返回失败原因给 UI 显示，翻译功能完全不受影响。历史不可用不该拖垮翻译工具。
- **写历史失败绝不冒泡**：一次成功的翻译不该因为「历史没写进去」而看起来失败。
- **关闭历史时一条都不写**（PRD §5.9）。用户关掉它不是因为嫌列表长，而是因为不想留下记录。
- **用量账本（v2，`usage` 表）已退役**：费用报表与月度上限退出后（PRD §5.10），程序不再读写它，`umuo-store` 的存取函数已删；
  表与 v2 回填迁移原样保留，已有数据不删。历史的 `cost_usd` 列同样保留，新记录写 NULL。
- **库损坏时自动挪开重建**：`Store::open_recovering` 只在 `is_corruption()` 时把 `history.db`
  （连同 `-wal` / `-shm`）挪成 `history.db.corrupt-<时间戳>` 再建新库；保留期清理失败只打日志、库照用。
- **拒绝打开更高版本的库**：`user_version` 高于程序认识的版本（用户装回旧版）时返回
  `SchemaTooNew`，不当成损坏、不挪文件，历史在这次会话里不可用。

#### 为什么用 `LIKE` 而不是 FTS5

FTS5 的默认 tokenizer（`unicode61`）**不切分中日韩文本**：一整句中文会被当成一个 token，
搜其中的某个词根本命中不了。要修就得再引一个分词器（体积与复杂度都上一个台阶）。
本机历史的规模是几千到几万条，`LIKE '%词%'` 在这个量级是毫秒级，而且对中文是真能搜到的。

> 所以：**不要「顺手优化成 FTS5」**，那会把中文搜索弄坏。真要上 FTS5，
> 必须先解决 CJK 分词，并且用现有测试验证中文命中。

搜索会转义 `%` 与 `_`：不转义的话用户搜「100%」会变成「匹配任何内容」，
在界面上看起来就是「搜索坏了」。

#### 收藏与历史的边界

收藏流程已退出首版：浮窗、历史窗、ops、FFI 与 `umuo-store` 的收藏存取都已删除；
`favorites` 表与迁移保留，旧收藏原样留在库里，清空历史不影响它们。
历史窗只保留关键词搜索；来源 App / 模型筛选（含存储层 `HistoryFilter` 的对应参数）与用量统计查询的代码都已删除，只保留表与迁移以兼容旧数据。

## 4.2 长文本切分：并发但不乱序（PRD §6.3）

超过模型上下文 70% 时按段落切分、**并发**请求、结果**按顺序**合并。三处要点：

**① 上下文窗口靠一张保守的内置表。** 供应商的模型列表接口不返回上下文长度，
没有这张表就无法执行「超过 70% 就切」。估小了只是多切一片；估大了会把
「超过上下文长度」的错误直接摔在用户脸上——代价不对称，所以默认值取保守的 8k，
本地模型（Ollama 的 `num_ctx` 常被压到 2k–8k）也按默认值处理。
`context_window_for` 的前缀表**顺序有意义**：`gpt-4.1` 必须排在 `gpt-4` 前面，
否则前者会被当成 8k 的老模型（有测试钉住）。

**② 并发用 `buffer_unordered`，不是 spawn。** `StreamOptions.cancel` 是引用，
spawn 需要 `'static`；在同一个任务里并发轮询既满足「同时推进」又能借用调用方的数据。

**③ 并发完成顺序不确定，但输出必须按原文顺序。**
未轮到的分片先存进 `pending`，只吐「从游标开始连续就绪」的那一段
（`chunk::drain_in_order`）。这里踩过两个坑，现在都有回归测试：
用**推进后的**游标判断换行会给同一批的第一片也加前导换行；
而 `drain_in_order` 是 `take()` 走的，回头从 `pending` 拼最终文本会得到空串
（必须用单独收集的 `merged`）。

用量按片相加，`estimated` 取「或」——只要有一片是估的，整体就不能声称精确。

**④ 预算还要看输出上限。** 每片的原文量取「上下文 70%」与「输出上限 ÷ 膨胀系数 2」的较小者
（`chunk::char_budget`，输出上限即 `wire::DEFAULT_MAX_OUTPUT_TOKENS` = 8192）。
只看上下文的话，2 万字对 200k 窗口是「一次就发」，译文却在输出上限处被截断。

**⑤ 截断要识别出来。** 传输层读各协议的停止原因（OpenAI `finish_reason: length / content_filter`、
Anthropic `stop_reason: max_tokens`、Gemini `finishReason: MAX_TOKENS`；Gemini 的 `SAFETY` 等按错误处理），
既没有结束哨兵也没有停止原因就 EOF 的也算截断。截断结果标 `StreamOutcome.truncated`：
浮窗照常显示并附提醒、不进历史，静默翻译拒绝写回（`CoreError::Truncated`），任何一片截断整篇都算截断。

## 4.3 单一当前模型

PRD §6.3 首版只用一个当前文字模型：`translate` 解析 `provider_id` + `model`（设置里的模型或供应商默认模型），
没配 Key（本机供应商除外）报 `MissingKey`，读 Keychain 失败报 `InvalidKey`（去模型设置重新保存），自定义端点没填地址报 `CustomEndpointMissing`，不发请求。
请求失败、超时、限流都如实交给用户重试或换模型；不按场景选模型、不按备用顺序重试、不因断网改用本机模型，
所以同一请求只有一个 Start。超时（`transport::DEFAULT_TIMEOUT`，8 s 首字）、Esc 取消、长文分片与截断保护不变。

### 退役入口与配置兼容

2026-10-23 已移除对比的 Swift 窗口、Rust 流水线、FFI、事件、排行和内核场景。
`sceneModels`（含其中的 `compare`）、`compareProviders` 仅为旧配置读写兼容保留，不参与请求；旧历史中的 compare 场景仍可显示。
对比、静默 OCR 和独立朗读的旧快捷键字段保留，但 Rust 的 hotkeys 与 Swift 的注册/冲突检查只使用划词、原地替换、输入翻译、OCR 四项。
旧 stats.json 不读写；修改退役键位不产生快捷键重注册效果。回归见 settings_patch 与原生录键测试。

## 4.4 退役术语数据的兼容

术语表管理、CSV 导入导出、语言对匹配及 Prompt 注入已删除。
`legacy_glossaries::Glossaries` 只在用户显式导入/导出配置时读写旧 `glossaries.json`，保留列表与未知字段。
AppCore 启动和翻译都不访问该文件；文件损坏也不会触发启动阶段的备份或覆盖。
普通翻译、词卡、长文分片均不读取旧术语或预设；兼容行为由 `tests/pipeline.rs` 和 `config_io` 回归验证。

## 4.5 退役的路由与预算配置

`sceneModels`、`fallbackModels`、`monthlyLimits`、`limitAction` 已从 `Settings` 结构体删除，
旧配置里的值落进 `extra`（未知字段）原样读写，不参与请求、不让设置窗点灯。
回归：`settings.rs` 的嵌套未知字段测试、`tests/pipeline.rs` 的 `with_retired_routing` 两条、Swift `--selftest` 的「退役路由与预算字段」。

## 4.6 内部翻译指令

`umuo-core::prompt` 仅接收源/目标语言，固定内部任务规则与版本，原文独立放入 user 消息。
不提供风格目录、模板变量渲染、few-shot、解释开关或用户温度覆盖；普通与分片翻译使用相同约束及温度 0.2。
保真规则明确保留格式、占位符、否定、数字、日期、金额与姓名，不补充事实。
词卡只请求词、发音与语境释义（第四批移除词形变化与例句），不接受旧预设或术语注入。
`ChatRequest::temperature` 将非有限值回落 0.2，Anthropic 协议仍按供应商上限截到 1，保留传输健壮性。

## 4.7 单词词卡的路径与其它翻译不同

选中的文本 ≤3 个词时走词卡（PRD §5.2），两处与普通翻译不同：

1. **不流式渲染。** 词卡模式下模型返回的是 JSON，逐字打到界面上会让用户看到
   `{"word":"hello","senses":[{"part_of_speech"` 这种半截结构。所以后端**抑制增量**，
   整段回来后解析成结构再一次性推送（`translate://card`）。
2. **解析失败降级为纯文本**（PRD §6.5）。降级时必须把原文补发一次——
   增量被抑制了，不补的话界面会是一片空白，用户以为翻译没出结果。

判定「是不是一个词」的规则只有一处：`umuo_core::word_card::is_word_mode`。
连续的中日文只算一个词，所以另有两道保护：中日韩文字超过 8 个、或汉字后紧跟 を/は/が
（「本を読む」）时按句子处理（审查 M10）。词卡不再注入术语表，前端不重复实现这条判定。
词卡只含词、发音与语境释义；模型多给的 `forms` / `examples` 等字段解析时忽略。

## 4.8 自定义端点的地址覆盖

「自定义 OpenAI 兼容端点」的地址由用户填，而供应商目录里的字段是 `&'static str`，
装不下运行时字符串。所以核心层有两个入口：

- `wire::build_chat_request(provider, …)` —— 用目录里的地址（绝大多数供应商）；
- `wire::build_chat_request_at(provider, base_url, …)` —— 显式指定地址。

`ChatTarget.base_url: Option<&str>` 承载覆盖。**没填地址时在发请求前就拦住**
（`CoreError::CustomEndpointMissing`），否则请求会打到一个空 URL，
用户看到的是一条莫名其妙的网络错误，完全不知道是自己没填地址。
`Settings::base_url_override` 是唯一的判定点，并且有一条测试守住
「用户在自定义端点里填的地址不会影响 OpenAI / DeepSeek 这些内置供应商」。

## 4.9 发音朗读

Swift 使用进程内 AVSpeechSynthesizer，按机器实际安装的发音人匹配语言；规则在 `Platform/Speech.swift`。
不再使用旧 Rust 平台层的 `/usr/bin/say` 方案。

## 4.10 浮窗与菜单栏

`PanelWindow` 是非激活 NSPanel，支持钉住、拖动与缩放。切走自动收起由可见期间的看门狗与应用层纯规则决定。
`StatusBar` 使用 NSStatusItem，左键打开 NSPopover 快捷面板、右键打开菜单；菜单栏图标是 Swift 资源里的一份模板图，由系统按菜单栏明暗着色。
图标生成脚本写入 `apps/macos/packaging/icon.icns` 与 `Resources/Tray/`，不依赖旧客户端目录。

## 4.11 首次引导

`Onboarding/` 实现欢迎、语言、模型、权限、试一试五步。允许跳过，明确说明缺权限与未配置引擎的后果。
完成状态写入 `onboarding_done`，不用「有没有 Key」推断；配置和试译使用正式 Engine。

## 4.12 截图 OCR

框选使用系统 `screencapture -i`，本机 Vision 识别，不上传截图。
取消框选不报错，识别为空明确提示。尚无自绘遮罩、选区坐标覆盖模式或多模态识图。

## 5. 安全与兼容性

Key 只存 Keychain，只经 Rust 请求头发往用户配置的端点，不进请求体、设置、日志或历史。
Bundle ID 保持 `app.umuo.desktop`；配置目录、历史库、Keychain 服务名与旧用户一致。
`umuo.app` 与可执行文件名 `umuo-desktop` 保持不变，兼容已有 LaunchAgent。

## 6. 发布与已知边界

免费、MIT 开源、纯 BYOK，没有许可证或收费路径。客户端只发 Apple Silicon（arm64）、macOS 14+ 的包：
客户端改动合入 main 由 `release.yml` 发布到 GitHub Releases，应用内更新用 Sparkle（appcast 随 Release 发布），
当前为 ad-hoc 签名、未经 Apple 公证。Developer ID 公证、真实 N → N+1 更新与 Homebrew Cask 待做，见 `SWIFTUI-MIGRATION.md`。
真机权限、焦点、语音交付与原生 release 性能仍需按 `NATIVE-WALKTHROUGH.md` 验收；旧 Tauri 性能数字只是历史基线。
浮窗按光标定位，不是精确选区边界；截图采用系统框选，覆盖模式未做。
