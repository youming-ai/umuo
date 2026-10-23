# umuo 架构

> 2026-10-22：客户端仅保留 Swift + SwiftUI + AppKit。旧 Tauri 源码、WebView UI 和 Rust 平台适配层已删除。
> 源码清理不等于正式版本已经切换；发布剩余项见 `SWIFTUI-MIGRATION.md`，功能验收见 `PRD-CONFORMANCE.md`。

## 1. 全貌

```text
apps/macos/Sources/Umuo/          SwiftUI 界面 + AppKit 窗口 + Apple 系统 API
  App/                           生命周期、菜单栏、动作分发与应用模型
  Platform/                      AX、Keychain、剪贴板、快捷键、Vision、语音、自启动
  Panel/ Compose/ Compare/       翻译浮窗、撰写、多模型对比
  History/ Settings/             历史与设置
  Onboarding/ Quick/             首次引导与菜单栏快捷面板
             │ UniFFI 生成的 Swift 绑定
             ▼
crates/umuo-ffi/                  Engine、RequestHandle、HostBridge、事件换型
             ▼
crates/umuo-app/                  AppCore、Host、流水线、对比、设置、历史、预算、术语表
             ├── crates/umuo-core/   Provider、Prompt、协议、传输、路由、计量
             └── crates/umuo-store/  SQLite 历史、收藏与用量

site/                            官网与 Worker，独立 Bun 项目
```

## 2. 分层规则

Swift 负责界面、窗口与系统集成；可复用应用逻辑放 `umuo-app`，Swift 经 FFI 调用，不重新实现。
`umuo-ffi` 只做类型转换与调用转发，不写业务逻辑。
`umuo-core`、`umuo-app` 不依赖任何平台 API 或 UniFFI；Linux CI 验证它们可编译测试。
供应商网络请求统一由 Rust 发出，界面只显示 Key 是否已配置，不读回明文。

原生界面遵循 Apple Human Interface Guidelines；优先使用 SwiftUI 标准控件、系统语义颜色、字体、SF Symbols，
由 AppKit 补充非激活浮窗、菜单栏与窗口管理。现有自定义主题仍在 `Theme/`，不把删除 CSS 视为视觉与辅助功能验收完成。

## 2.1 应用层与宿主

`AppCore` 持有设置、统计、术语表、历史库、HTTP 客户端与请求登记。
流水线中途必须现取的平台能力通过 `Host` 回调 Swift 的 `SwiftHost`；可以提前取得的值由 Swift 随请求传入。
取词、截图、OCR、语音、快捷键、窗口、自启动与更新留在 Swift 宿主，不扩充为 Rust 平台层。

| Host 方法 | 实现与约束 |
| --- | --- |
| `api_key(provider_id)` | `Platform/Keychain.swift` 用 Security.framework 读旧文件 Keychain，不设 `kSecUseDataProtectionKeychain`；service 保持 `app.umuo.desktop`，account 是供应商 id |
| `frontmost_app_name()` | `FrontmostApp.swift` 读取 NSWorkspace 激活通知维护的加锁缓存，用于来源标注与按 App 记忆 |
| `frontmost_app_token()` | 每次现查系统 AXFocusedApplication 的 pid，不能用可能晚一拍的激活通知缓存 |
| `write_back(source, original, text)` | `AXWriteBack.swift`：仅成功且目标守卫放行后写回；检查可写性与原文；静默替换不模拟粘贴 |

回调全部同步，在 Rust 工作线程执行，不等待用户授权，也不得 `DispatchQueue.main.sync`。
需要授权时返回可操作错误，由界面引导用户处理，避免主线程与 Rust 同步调用互相等待。

## 2.2 事件协议

流水线通过 `umuo_app::event` 的 `TranslateSink` / `CompareSink` 发事件。
`umuo-ffi/src/event.rs` 镜像成 UniFFI enum / record，Swift sink 收到后按顺序放入 AsyncStream。
转换使用完整解构，不用 `..`，让新增字段在导出层触发编译错误。

- 翻译：Start、Delta、Card、Done、Error；`Route` 指定 surface、request_id、back。
- 对比：Start、Delta、Done、Error、Notice；按 run_id 与卡片 index 归位。
- 同一请求再次 Start 表示故障转移，界面清空这一轮译文后继续。
- Swift 只处理当前 request_id / run_id，旧请求迟到的事件不得覆盖新结果。
- 回译由 back 标记分流到单独区域，不能覆盖主译文。

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

Engine 启动 `umuo_app::translate`：读取设置、按候选取 Key、判断语言、构造 Prompt、路由与分片、发出流式事件、
故障转移、记用量与历史。Swift 处理事件更新界面。对比使用同一应用层的并发候选流水线。

### 3.1 三条入口

划词读选区；静默替换读选区或整个可编辑输入框；撰写由用户输入。
撰写模型、语言与风格覆盖只作用于本次请求，回译单独调度。

### 3.2 撰写调度

`ComposeSession` / `ComposeQueue` 处理防抖、最新输入、请求登记与回译，旧增量按 id 丢弃。
提交只复制，或在确认原应用已回到前台后粘贴；无法确认时只复制并提示，不向其他应用投递按键。

### 3.3 写回守卫

静默替换在触发时取得前台 pid，成功后现查前台 pid 与之比较，变化或不可读就拒绝写回。
整框替换还要确认 AXValue 可写且原文未变；失败、取消或结果截断都不能修改原文。
浮窗「替换原文」另走 `ReplaceSelection.swift`，在源应用恢复后执行；AX 明确不可写时拒绝，不盲目粘贴。

### 3.4 回归验证

`crates/umuo-app/tests/pipeline.rs` 使用假 Host + 本地 SSE 桩覆盖故障转移、取消、超额切换、离线回落、
分片并发与顺序、写回守卫、对比分流；在 Linux 也能执行。
`umuo-ffi` 的 Engine 测试与 Swift `--selftest` 验证跨语言链路；视图模型与纯规则由 Swift Testing 验证。
真实授权、焦点、多显示器、剪贴板降级与按键需要真机验收，不以单测通过代替。

## 4. 数据与存储

| 数据 | 存在哪 | 为什么 |
| --- | --- | --- |
| API Key | 系统 Keychain（Swift Security.framework，服务名 `app.umuo.desktop`） | PRD §6.4。不进配置文件、不进日志、不进历史库 |
| 偏好（供应商 / 模型 / 语言 / 风格 / 快捷键 / 历史开关） | `settings.json`（应用配置目录） | 不敏感但需要记住。结构体上有一条测试守「文件里不许出现 Key 字段」 |
| 对比偏好统计 | `stats.json` | 与设置分开：一个是用户显式配置、一个是行为副产品，损坏代价不同 |
| 翻译历史与用量 | `history.db`（SQLite，`crates/umuo-store`） | PRD §5.9 / §5.10。本机文件，不上传 |
| 收藏（词 / 句） | 同上，`favorites` 表 | 用户**显式**标记，因此不参与保留天数清理 |

`settings.json`、`glossaries.json` 共用 `persist.rs` 的读写（`stats.json` 只共用写，丢了无所谓）：
**写**是临时文件 + `sync_all` + `rename`，断电后不会只剩半截；**读**只有「文件不存在」才静默回落默认值，
读不动（编码不对、权限）或解析失败都先挪成 `<文件名>.corrupt-<时间戳>` 再回落——
用户手改坏一个字符，不该连原内容都看不到，备份带时间戳也不会被第二次损坏覆盖。

保存设置与导入配置走同一个 `AppCore::apply_settings_patch`（`crates/umuo-app/src/settings_patch.rs`）：
JSON 顶层逐键覆盖在最新设置上，mtime 变了先重载；嵌套对象整体替换，不做深合并。
`Settings::prepare_for_save` 做规范化、代理与端点校验；失败时内存和文件都不变。
Swift 经 `Engine.applySettingsPatch` 只交自己改的键，不自己解析配置文件。
快捷键重注册、主题、语言、缩放与菜单栏样式由 Swift 宿主应用。
**自定义端点与需要 Key 的供应商覆盖只接受 `https://`**（`localhost` / `127.0.0.1` / `[::1]` 例外）：这些地址会收到明文的 Bearer Key。本机模型类供应商（Ollama / LM Studio）不发 Key，局域网 http 地址也放行。
只校验这次改动了的端点，老配置里已有的局域网 `http://` 地址不会让用户从此改不了任何设置。
导入先在内存里校验整份设置，不合法就整份拒绝、一个文件都不写；摘要列出端点与取词黑名单的变化。

**本版本不认识的字段原样保留**（`umuo_core::UnknownFields`，`#[serde(flatten)] extra`）：`Settings`、`Glossaries`、`Stats`、导出包，
以及嵌套的自建预设、月度上限、场景模型、术语表与术语条目都有。新版本（SwiftUI 版）写的字段，用户回到旧版本保存一次不会丢。
会**重建**这些结构的代码要把 `extra` 带过去：自建预设的规范化沿用原值；术语表在设置页保存（整表转 CSV 再导入）时按原文匹配，带上旧条目的。
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
- **用量账本独立于历史**（v2，`usage` 表）：只存时间、供应商、模型、token 与费用，没有原文译文。
  每次成功翻译都记，**不看**历史开关与隐私模式，清空历史与保留期清理也不删它——
  月度上限与「本月用量」都从这张表读，否则关掉历史就等于关掉上限。v2 迁移从历史表回填，
  月中升级的用户本月已花的钱不会归零。记账是单独的 `history::record_usage`，在厂商返回成功后、
  静默替换写回之前调用：写回失败（中途切了窗口）不记历史，但已计费的用量照样进账本。
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

#### 「本月」的边界有一个必须记住的坑

`datetime('now','localtime','start of month')` 产出的是**本地日历上的字符串**，
而 `strftime('%s', …)` 会把它按 **UTC** 解释，结果整整偏掉一个时区偏移
（东九区实测是 09:00 而不是 00:00，`month_start_unix` 的测试当场抓到了）。

正确写法要在末尾补一个 `'utc'`，把这个本地时刻换算回真正的瞬时：

```sql
strftime('%s', datetime('now', 'localtime', 'start of month', 'utc'))
```

少写它，每月头几个小时会被算成上个月。

#### 收藏与历史的边界

收藏是**用户显式标记**的，所以它不参与「保留天数」清理——用户不会希望
三个月前收藏的那个词被自动删掉。`favorites` 表的唯一约束是 `(kind, text)`
而不是 `text`：同一个词与包含它的句子是两条不同的收藏。
重复收藏不报错、也不产生第二行（连点两下收藏是很常见的事）。

「这段话算单词还是句子」由 **Rust 侧**用词卡那套规则（`umuo_core::word_card::is_word_mode`）
判定，前端不重复实现——两处各写一遍，迟早会出现「同一个词在词卡里是词、在收藏里是句」。

历史列表一次问完一屏的收藏状态（`favorites_status`），而不是逐行发一次 IPC。

## 4.2 长文本切分：并发但不乱序（PRD §6.3）

超过模型上下文 70% 时按段落切分、**并发**请求、结果**按顺序**合并。三处要点：

**① 上下文窗口靠一张保守的内置表。** 供应商的模型列表接口不返回上下文长度，
没有这张表就无法执行「超过 70% 就切」。估小了只是多切一片；估大了会把
「超过上下文长度」的错误直接摔在用户脸上——代价不对称，所以默认值取保守的 8k，
本地模型（Ollama 的 `num_ctx` 常被压到 2k–8k）也按默认值处理。
`context_window_for` 的前缀表**顺序有意义**：`gpt-4.1` 必须排在 `gpt-4` 前面，
否则前者会被当成 8k 的老模型（有测试钉住）。

**② 并发用 `FuturesUnordered`，不是 spawn。** `StreamOptions.cancel` 是引用，
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

## 4.3 分场景模型与备用顺序：每个候选各自解析供应商

`ModelRef` 里带着 `provider_id`，所以**分场景模型与备用顺序都允许指向另一家供应商**。
但重试循环原本在循环外只解析一次 `provider` 与 `api_key`，循环内只换模型名——
这会把 A 家的模型名发到 B 家的端点，得到一个「模型不存在」的 404。

现在每个候选各自解析供应商、Key 与地址：

- **没配 Key 的候选直接跳过**。拿空 Key 去请求只会得到 401，而它并不是这次失败的真正原因。
- **自定义端点没填地址的候选跳过**，并把它记成 `last_error`。
- 计价与历史记录都用**候选自己的** `provider_id`，不是首选的。
- 长文本的分片路径走同一套候选循环，按整批故障转移（不逐片重试），每个候选按自己的上下文窗口重新切分。

全部候选被跳过时兜底错误从 `NoEngine` 改成 `MissingKey`：
用户明明配了引擎、只是这次没用上，`NoEngine` 是误导。

`SceneModels` 加了 `#[serde(rename_all = "camelCase")]`：少了它，
`settings.json` 里会混进 `silent_replace` / `word_card` 这种 snake_case，
而旁边全是 camelCase——用户手改配置时极易写错。现在加是免费的（该字段刚引入），
以后加就是破坏性变更。

### 对比模型的来源只能有一处权威

对比模型有两个可能的来源，优先级从高到低：

1. `scene_models.compare`：显式指定「供应商 + 模型」。表达力更强
   （可以对比同一家的两个模型），所以非空时**完全接管**。
2. `compare_providers`：只挑供应商，模型用各自的默认值。
3. 都没配：自动用所有已配 Key 且能确定模型的供应商。

**不做合并**：两个来源混在一起，用户永远说不清最终到底发了哪几个模型。
每一条都有测试钉住（含「显式清单里某条没配 Key 时跳过」「模型名为空时回落到供应商清单」）。

## 4.4 术语表：三个刻意的取舍（PRD §5.8）

**① 存在自己的文件里，不塞进 `settings.json`。**
一张真用起来的表可能几百上千条，塞进设置文件会让它膨胀到没法人工查看，
而设置文件的定位恰恰是「小、能手改」。这与 `stats.json` 单开一个文件同一个理由：
按**数据的性质**分文件，不是按「都是配置」硬塞在一起。

**② 只注入命中的术语。**
一张 500 条的表全量注入，每次翻译要多花几千 token——用户会在账单上看到这笔钱，
却不知道为什么。`block_for` 先按语言对筛表、再在原文里找命中，没有任何命中时
返回 `None`，`{glossary}` 段根本不会出现在 Prompt 里。

**③ 跨表去重，先出现的表优先。**
同一个词可能同时出现在「通用表」与「公司术语表」里；两条都注入会让模型收到
互相矛盾的两条规则。顺序就是用户在设置页看到的顺序——把更具体的表排前面即可。

### CSV 解析是整段扫描，不是逐行

RFC 4180 允许引号字段里含换行。第一版实现先按行切再解析字段，
于是**导出再导入会丢数据**：导出那边会正确给含换行的字段加引号，
而逐行解析会把它从中间切开、整条术语静默消失。
`export_then_import_round_trips` 这条测试当场抓到了它，现在改成整段扫描。

其余容错也都是实际会遇到的：Excel 存的 CSV 必带 BOM（不处理的话第一个术语
永远匹配不上）、表头行、注释行、多余列、只有一列的行（缺译文的丢掉，
空译法注入进去只会让模型困惑）。

**导入失败不清空。** 解析结果为 0 条时返回错误而不是把已有条目替换成空——
静默清空是最糟的失败方式，用户会以为导入成功了。

## 4.5 月度上限：判断是纯的，取数是分开的

三层分工，都是为了这条规则能被测清楚：

1. `umuo_core::budget` —— **纯计算**：给定「本月已花」与「上限」，判断是否超限、
   该换成谁（`decide`）。没有数据库、没有网络，23 个用例覆盖。
2. `umuo-store::usage_by_provider` —— 数据来源，按供应商聚合本月的花费（读独立的用量账本，见 4.1）。
3. `crates/umuo-app/src/budget.rs` —— 执行点：取数、拼候选清单、按决定换人。
   没给当前供应商设上限就直接放行，不查库；没超限也不读其它供应商的 Keychain——
   只有超限且设成自动切换时才去找备选。

### 三条刻意的规则

**① `limit_usd: None` 与 `Some(0.0)` 是两回事。**
`None` = 没设上限，永远不拦；`Some(0.0)` = 用户明确说「这个供应商一分钱也不许花」。
把 0 当成「没设」会让「临时停用某个供应商」这个用法失效——
用户只能删掉 Key，而删 Key 会丢掉 Key 本身。

**② 默认是提醒，不是自动切换。**
换供应商意味着译文风格、术语甚至语言质量都会变。用户没有明确同意之前不该悄悄换。

**③ 上限是约束，不是路障。**
任何一步拿不到数据（历史库打不开、Key 状态读不到、候选里没有当前供应商）都按
「不拦」处理；一个可用的备选都没有时，照常发出并提醒。用户按下快捷键是为了拿到译文。

超限的判断用 `>=` 而不是 `>`：上限的含义是「最多花这么多」，用 `>` 会出现
「设了 5 美元却花了 5.0001」。

### 换供应商必须连模型一起换

执行点在 `translate` 里**位于解析模型与地址之前**。被换到另一个供应商时，
用户配置的模型名属于原来那家，拿它去新端点只会得到一个「模型不存在」的 404，
而用户完全不知道为什么。所以换供应商时改用新供应商的默认模型。

### 多模型对比也遵守上限

对比本身是一次**多倍**支出，让已经超限的供应商再花四倍钱是最不该发生的事。
所以 `plan_candidates` 多接一个 `over_budget` 判定，超限的供应商直接不参与。

两个刻意的边界：

- **一个都不剩时退回原清单。** 用户按下快捷键是为了对比，不是为了看一张空窗口。
  这时候额度约束让位于「他要这个结果」。
- **判定读不到数据时不拦。** 历史库打不开就当成都未超限。

已知的小缺口：被排除的供应商只在界面上表现为「卡片变少」，没有一句说明。

## 4.6 用户自建预设：两层结构，一处转换

`StyleSpec` 是**运行时**形态（渲染 Prompt 用），`CustomStyle` 是**存储**形态
（写进 `settings.json`，人能读懂、能手改）。两者之间只有一处转换：
`CustomStyle::validated`。

这条边界挡的是「设置里存得下来、跑起来却是另一个样子」：

- 空标签 → `未命名预设`（而不是存下来一个空名字）
- 温度越界 → 夹回 `0..=2`；**`NaN` → 回落 0.2**（NaN 序列化进 JSON 会变成 `null`，
  供应商报参数错误，用户却看到一条无从下手的网络错误）
- 空白 few-shot 行 → 丢掉（那是用户点「加一行」留下的）
- id 与内置冲突 → **报错，不覆盖**。内置 id 是保留字：历史记录与 `PROMPT_VERSION`
  都按 id 关联，允许覆盖会让「这句话是用哪一版规则翻的」无法回答

温度的上限按协议各夹一次（见 `wire.rs`）：我们的范围是 `0..=2`（OpenAI 的上限），
Anthropic 只接受到 1，所以在 Anthropic 分支单独 `.min(1.0)`。
按 1.0 全局夹会悄悄拿掉 OpenAI 用户想要的自由度。

### 坏预设不会让应用起不来

`find_style_with` 与 `all_styles` 都会跳过验证失败的预设，所以用户手改配置文件
塞进一条 id 冲突的预设时，客户端照常启动（实测过），那一条只是不出现。

## 4.7 单词词卡的路径与其它翻译不同

选中的文本 ≤3 个词时走词卡（PRD §5.2），两处与普通翻译不同：

1. **不流式渲染。** 词卡模式下模型返回的是 JSON，逐字打到界面上会让用户看到
   `{"word":"hello","senses":[{"part_of_speech"` 这种半截结构。所以后端**抑制增量**，
   整段回来后解析成结构再一次性推送（`translate://card`）。
2. **解析失败降级为纯文本**（PRD §6.5）。降级时必须把原文补发一次——
   增量被抑制了，不补的话界面会是一片空白，用户以为翻译没出结果。

判定「是不是一个词」的规则只有一处：`umuo_core::word_card::is_word_mode`。
连续的中日文只算一个词，所以另有两道保护：中日韩文字超过 8 个、或汉字后紧跟 を/は/が
（「本を読む」）时按句子处理（审查 M10）。术语表对词卡同样生效，命中的术语会写进词卡 Prompt。
前端不重复实现它（`favorite_kind_for` 也复用它来区分「词」与「句」）。
规则改过，所以星标的查询与取消只按文本匹配（`is_text_favorited`），不看 kind——旧规则下存成「词」的收藏仍然认得。

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
`StatusBar` 使用 NSStatusItem，左键打开 NSPopover 快捷面板、右键打开菜单；菜单栏图标直接从 Swift 资源加载。
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

SwiftUI 功能窗口和打包链路已实现，旧源码已清理；正式切换发布尚未完成。
当前未接应用内更新、未完成 Developer ID 签名公证和 Homebrew Cask；真机权限、焦点和 Intel 运行仍需验收。
浮窗按光标定位，不是精确选区边界；截图采用系统框选，覆盖模式未做。
收费许可证暂缓。详细状态见 `SWIFTUI-MIGRATION.md` 与 `PRD-CONFORMANCE.md`。
旧客户端性能数字仅作为历史基线，SwiftUI 发布前须重新测量。
