# umuo 架构

> 需求来源：`docs/PRD.md`。本文只写**已经存在**的东西；未实现的部分在最后一节明确列出，
> 不把规划写成现状。

## 1. 全貌

```
┌──────────────────────── 客户端进程（Tauri 2） ────────────────────────┐
│                                                                       │
│  apps/desktop/src/            前端（React 19 + Tailwind v4），7 个窗口 │
│    panel 划词浮窗 · settings 设置 · compose 撰写 · compare 对比       │
│    history 历史与收藏 · onboarding 首次引导 · quick 菜单栏快捷面板    │
│         │  invoke（应用命令）/ listen（事件，需在 capabilities 里授权）│
│         ▼                                                             │
│  apps/desktop/src-tauri/      Tauri 外壳：窗口、托盘、快捷键、命令    │
│    main.rs        建窗口 / 建托盘 / 注册快捷键 / 组装依赖 / 看门狗    │
│    double_tap.rs  连按修饰键（⌃⌃、⌥⌥、右⌘⌘）的接线                    │
│    translator.rs  划词的触发、取词线程、浮窗的显示与归属              │
│    compare.rs     对比的触发与开窗 · screenshot.rs 截图 OCR 的触发    │
│    host_mac.rs    Host 的 macOS 实现（转给 umuo-platform-macos）      │
│    sink.rs        应用层事件 → translate:// compare:// webview 事件   │
│    commands.rs    IPC 命令：参数转发 + 调 umuo-app + 窗口操作         │
│         │                                                             │
│         ▼                                                             │
│  crates/umuo-app/             应用层（不依赖 Tauri，两端共用，§2.1）  │
│    core（AppCore）/ host（Host，4 个方法）/ event（事件与 Sink）      │
│    translate 翻译流水线 · compare 多模型对比 · ops 命令的业务部分     │
│    settings / settings_patch / glossaries / stats / config_io         │
│    persist / requests / history / budget / paths                      │
│         │                                                             │
│         ▼                                                             │
│  crates/umuo-core/            共享翻译内核（平台无关，可在 Linux 测试） │
│    provider / key_detect / wire / prompt / glossary / chunk / proxy   │
│    router / usage / budget / lang / word_card / hotkey / transport    │
│                                                                       │
│  crates/umuo-store/           SQLite：历史、收藏、用量                │
│                                                                       │
│  crates/umuo-platform/        外壳用的能力边界（trait，无平台依赖）   │
│    SelectionReader / Clipboard / SecretStore / Capture / Ocr /        │
│    Speech / ModifierMonitor                                           │
│         │                                                             │
│         ▼                                                             │
│  crates/umuo-platform-macos/  macOS 实现                              │
│    ax.rs 手写 AX FFI · key_event.rs CGEvent · selection.rs AX 优先    │
│    secret.rs Keychain · ocr.rs Vision · speech.rs say ·               │
│    modifier_tap.rs 只读 CGEventTap · capture.rs · clipboard.rs        │
└───────────────────────────────────────────────────────────────────────┘

┌─────────────────── SwiftUI 客户端（迁移中，见 SWIFTUI-MIGRATION.md）──┐
│  apps/macos/                  SwiftPM 包；目前只有 --selftest，无界面 │
│         │  UniFFI 生成的 Swift 绑定（scripts/build-core.sh）          │
│         ▼                                                             │
│  crates/umuo-ffi/             导出层：只做换型，不写业务逻辑          │
│    engine.rs Engine / RequestHandle · event.rs 事件镜像与两个 sink    │
│    host.rs HostBridge（Swift 实现的宿主）→ BridgeHost 接到 Host 上    │
│         │                                                             │
│         ▼                                                             │
│  crates/umuo-app/  ← 与 Tauri 外壳用的是同一份                        │
└───────────────────────────────────────────────────────────────────────┘

packages/tokens/  客户端设计令牌：CSS 变量 + Tailwind v4 @theme 映射
```

## 2. 分层规则（违反它会让架构立刻塌）

| 规则 | 为什么 |
| --- | --- |
| `umuo-core` 不依赖任何平台 API，也不依赖 Tauri | 它必须能在 Linux 上 `cargo test`。翻译逻辑的正确性不该需要一台 Mac 才能验证 |
| `umuo-app` 不依赖 Tauri、uniffi 或 `umuo-platform*` | 两个客户端共用它；CI 的 `app-core-linux` 在 Linux 上跑 `cargo test -p umuo-app -p umuo-core` 守着这条 |
| 流水线中途要的平台能力只走 `umuo_app::Host`（§2.1）；其余平台能力（取词、截图、OCR、语音、快捷键、窗口）留在宿主里 | 应用层只认 4 个方法，宿主换成 Swift 时一行流水线都不改。Tauri 外壳自己的平台能力走 `umuo-platform` 的 trait，迁移完成后随外壳删除 |
| Tauri 命令与 FFI 导出里不写业务逻辑 | 命令只做参数转发、调 `umuo-app` 与窗口操作；`umuo-ffi` 只做换型。否则逻辑会被锁死在 IPC / FFI 边界里，无法单测，两个客户端各有一份还会漂移 |
| 前端不持有 Key、不发供应商请求 | 见 §5 |
| 每个窗口都列进 `capabilities/default.json` | 应用命令不受 capability 限制，但 `listen()` 是插件命令：不在名单里的窗口收不到任何事件。浏览器夹具（假 `__TAURI_INTERNALS__`）绕过权限检查，这类问题只有真机能发现 |
| 窗口专属事件只用 `getCurrentWebviewWindow().listen()` 订阅（`ipc.ts::listenHere`） | 裸 `listen()` 的 target 是 Any，Tauri 对 Any 直接放行，`emit_to` 的定向会失效：撰写窗收到浮窗的译文，反之亦然。只有设置变更这类真广播才用 `listen()` |
| 每次请求一个 id 与独立取消标志（`requests.rs`），按窗口登记 | 新请求顶掉同一窗口的旧请求；Esc 只取消发起它的窗口；事件带 id，前端丢弃不属于当前请求的增量，旧流不会和新流交错 |
| Provider 是数据不是分支 | 新增供应商 = 加一条数据。只有协议本身不同（OpenAI 兼容 / Anthropic / Gemini）才动 `wire` |

## 2.1 应用层 `umuo-app` 与宿主

`umuo-app` 是内核之上、界面之下的一层：两个客户端都要、又和窗口系统无关的东西都在这里，
只写一份。Tauri 外壳与 SwiftUI 客户端（经 `umuo-ffi`）是它的两个**宿主**。

| 模块 | 内容 |
| --- | --- |
| `core` | `AppCore`：配置目录、设置、统计、术语表、历史库、HTTP 客户端、请求登记、`Arc<dyn Host>`。`AppCore::open` 里是启动规则：代理设置坏了按「跟随系统」、历史库打不开也照常启动 |
| `host` | `Host` trait 与 `FocusSource`，见下表 |
| `event` | 发给界面的事件与载荷、`TranslateSink` / `CompareSink`，见 §2.2 |
| `translate` | 翻译流水线：规划、故障转移、离线回落、分片、记账、写回守卫、事件。`AppCore::start_translation` / `translate::run` |
| `compare` | 多模型对比：`plan_candidates` 与并发扇出 `run` |
| `ops` | 界面命令的业务部分：历史、用量、收藏、术语表、导入导出、Key 状态、对比偏好、模型列表。返回的 DTO 就是 IPC 契约 |
| `panel` | 浮窗的纯规则：看门狗的 `should_auto_hide`、「替换原文」的 `plan_replace` 与写回守卫文案、取词黑名单的提示（SwiftUI 用；Tauri 外壳冻结前的原件留在 `translator.rs`） |
| `settings` / `settings_patch` | 设置结构与校验；`AppCore::apply_settings_patch`（顶层 patch，§4） |
| `glossaries` / `stats` / `config_io` / `persist` / `requests` / `history` / `budget` | 术语表与统计文件、导入导出包、原子写、每窗口的请求登记、历史写入、月度上限执行点 |
| `paths` | `BUNDLE_ID` 与 `config_dir_for(home)`：两个客户端必须指向同一个配置目录 |

宿主自己负责、**不进** `umuo-app` 的：取词（AX 与 ⌘C 降级）、截图与 OCR、朗读、全局快捷键与连按修饰键、
窗口与浮窗定位、看门狗、托盘、自启动、更新。

Tauri 外壳的 `AppState` 是 `{ core: Arc<AppCore>, 平台单元与窗口状态… }`，并实现了 `Deref<Target = AppCore>`
（`state.settings` 就是 `state.core.settings`）。这是迁移期的拐杖，随 Tauri 外壳一起删除。

### Host：流水线中途向宿主要的东西

原则：能提前取的值由宿主先取好再传进来（例如静默翻译写回守卫用的前台标识，触发时由宿主取好、作 `guard` 传入），
**流水线中途必须现取的才走 `Host`**。四个方法全部同步，在流水线所在的工作线程上调用（§2.3）。

| 方法 | 谁在什么时候调 | Tauri（`host_mac.rs` 的 `MacHost`） | Swift（`umuo-ffi` 的 `HostBridge`） |
| --- | --- | --- | --- |
| `api_key(provider_id)` | 首选与每个候选各取一次、月度上限找备选时看「有没有 Key」、对比的每一路、`ops` 的 Key 状态与模型列表。所以不能由宿主一次预取 | `MacSecretStore`（Keychain：service `app.umuo.desktop`，account = 供应商 id） | 同一个 Keychain 条目，Security.framework 直接读（`apps/macos` 的 `SwiftHost` / `Keychain.swift`：SecItem 查旧文件 Keychain，**不设** `kSecUseDataProtectionKeychain`，服务名取 FFI 的 `bundleId()`） |
| `frontmost_app_name()` | 记历史时取「来源应用」（取值时机与迁移前相同：记账时）；按 App 记忆目标语言或风格里写了 `{app_name}` 时 | `MacSelection` 的 AX 查询 | 读加锁缓存（`FrontmostApp.swift`，NSWorkspace 激活通知维护，取 `localizedName`）：只用来标注历史与按 App 记忆，晚一拍无害 |
| `frontmost_app_token()` | 只在写回守卫里用：写回前与 `guard` 比对（§3.3） | AX 现查：系统级 `AXFocusedApplication` 的 pid（`ax::frontmost_pid`） | **必须调用时现查，不能读缓存**：与 Tauri 同一来源（AX 系统级 `AXFocusedApplication` 的 pid），触发时取 `guardToken` 也用它。NSWorkspace 的激活通知经主线程 run loop 晚到，用户刚切走时缓存还是旧 pid，守卫会放行、把译文写进新应用 |
| `write_back(source, original, text)` | 静默翻译**成功且守卫放行后**调一次；没有 ⌘V 兜底，写不进去就报 `WriteBackFailed` | `replace_focus_text` | AX 写回（`AXWriteBack.swift`，照搬 `replace_focus_text` 的可写与原文检查、错误文案逐字一致）。AX 是线程安全的 C API，直接在工作线程上调，不切主线程。**不要** `DispatchQueue.main.sync`（§2.3）：主线程可能正在同步调用 Engine、等着这个回调返回，会死锁；聚焦的是 umuo 自己的窗口时，AX 请求本身也要主线程 run loop 来应答 |

迁移计划里写过的 `AppIdentity` / `HostError` / async `write_back` 没有采用：没有调用方需要它们。
`write_back` 保持同步，是因为它在流水线的 future 里直接调用，做成 async 就得在运行时里 `block_on`
（理由也写在 `crates/umuo-ffi/src/host.rs` 的模块文档里）。

## 2.2 事件协议

流水线只认 `umuo_app::event` 里的事件，经 sink 发出，不碰任何窗口系统。

| | 事件 | 语义 |
| --- | --- | --- |
| `TranslateEvent`（浮窗 / 撰写窗） | `Start` | 开始；**同一请求 id 再来一次 Start = 故障转移换了候选**，界面整体重置译文、保持流式状态 |
| | `Delta` | 增量，只追加 |
| | `Card` | 单词词卡，与 `Delta` 互斥：词卡模式下增量被抑制，整段解析成结构后一次推送（§4.7） |
| | `Done` / `Error` | 结束。`Done.warning` 是成功附带的提醒（例如月度上限），不是错误；`Error.source` 带原文供「重试」 |
| `CompareEvent`（对比窗） | `Start` / `Delta` / `Done` / `Error` | 每个载荷带 `run_id` 与卡片下标 `index`，N 路增量按下标归位 |
| | `Notice` | 整窗级提示（没有卡片时也要显示） |

翻译事件旁边还有一个 `Route { surface, request_id, back }`：发往哪个窗口、属于哪一次请求、是不是撰写窗的回译。
界面**只认自己正在显示的那个 `request_id` / `run_id`**，被顶掉的旧请求迟到的事件一律丢掉。
不经流水线的提示（取词失败、黑名单、缺权限、截图识别不到文字）由宿主自己发：Tauri 外壳用同一个 `Error` 事件
（`translator::emit_notice`：新登记一次请求 id，并把浮窗弹出来）。

同一组事件有两种线上编码：

- **Tauri**（`sink.rs` 的 `TauriSink`）：事件名取 `TranslateEvent::name()`（`translate://start` 等），
  翻译载荷外面套一层 `{ requestId, back, …载荷 }`，`emit_to` 发给 `route.surface` 那个窗口；对比事件就是载荷本身。
  载荷的字段名与顺序就是前端契约，`sink.rs` 的黄金快照逐字节守着。
- **FFI**（`crates/umuo-ffi/src/event.rs`）：镜像成 `uniffi::Enum`，`Route` 是单独的 Record，
  Swift 实现 `TranslateSink.onEvent(route, event)` / `CompareSink.onEvent(event)`。只做换型（`&'static str` → `String`、
  `usize` → `u32`），`From` 一律用不带 `..` 的解构：`umuo-app` 的载荷加了字段，这里当场编译失败。

## 2.3 线程约定

| | Tauri 外壳 | SwiftUI（经 `umuo-ffi`） |
| --- | --- | --- |
| 取词 | `std::thread::spawn`：取词是阻塞的，不能放在主线程（§3） | Swift 自己决定，不经过 Rust |
| 流水线跑在哪 | `tauri::async_runtime`。请求登记在调用时同步完成，返回的 future 交给运行时 | `Engine` 自建的多线程 tokio 运行时（线程名 `umuo-engine`，工作线程数取默认）。**不开** uniffi 的 `tokio` feature：reqwest 的连接池只活在这一个运行时里 |
| `Host` 回调 | 在 tokio 工作线程上同步调用 | 同左；`BridgeHost` 每次回调包在 `block_in_place` 里，回调慢了也不占住工作线程、不拖停其他流和取消轮询 |
| sink | 同步调用，`emit_to` 立即返回 | 同步调用，**只把事件 `yield` 进 `AsyncStream` 就返回**（保证增量按顺序到达；多个 `Task { @MainActor }` 不保证先后）。禁止 `DispatchQueue.main.sync`：主线程可能正等着 Engine 的同步方法 |
| 取消 | Esc / 新请求置位本窗口这次请求的取消标志 | 流式请求不做成 `async fn`（UniFFI 0.32 的 Swift 绑定传不进取消）：同步启动、立即返回 `RequestHandle`，取消显式调 `cancel()`（幂等），Swift 在 `onTermination` 里调。丢掉句柄**不会**取消 |

两端共同的：

- 传输层每 100 ms 看一次取消标志，取消后不再有增量。
- 设置的 `MutexGuard` 不跨 `await`：每次请求开头 clone 一份设置，锁只活在那一个语句里（否则 future 不是 `Send`）。
- Engine 的同步方法（设置、SQLite）与 `Engine.open` 从后台调用，不放在 MainActor 上，不阻塞菜单栏出现。
- `Engine` 释放时只发关闭信号（`shutdown_background`），不等工作线程：最后一个引用可能在主线程或运行时自己的线程上释放，等的话前者互相卡死、后者 tokio 直接 panic。

这些约定的权威写法在 `crates/umuo-ffi/src/lib.rs` 与 `engine.rs` / `host.rs` / `event.rs` 的文档注释里，改了要两处一起改。

## 3. 一次划词翻译的完整链路

```
用户按划词快捷键（默认 ⌃⌃，可在设置里改）
  │
  ├─ 组合键走 tauri-plugin-global-shortcut（main.rs），连按修饰键走 double_tap.rs
  │
  ├─ translator::trigger
  │    └─ std::thread::spawn：取词是阻塞的（降级路径要轮询剪贴板最多 400ms），
  │       放在主线程会让浮窗「先卡一下再出现」，150ms 唤醒指标直接不达标
  │         │
  │         ├─ MacSelection::read_selection()
  │         │    ① Accessibility：AXUIElementCreateSystemWide → AXFocusedUIElement
  │         │       → AXSelectedText（只读、无副作用）
  │         │    ② 失败才降级（全程独占剪贴板，连按不互相踩）：快照剪贴板的**全部 item 与类型**
  │         │       → 清空 → 合成 ⌘C → 按 changeCount 轮询 → **原样恢复**（合成失败也先恢复）
  │         │       → 超时则再盯 600ms，慢应用迟到的复制盖上来就再恢复一次
  │         │
  │         ├─ show_panel_near_cursor()：按鼠标位置摆放浮窗并显示
  │         │
  │         └─ tauri::async_runtime::spawn(umuo_app::translate::run)
  │              （SwiftUI 版经 Engine::translate 走同一个函数；事件经 sink 发出，§2.2）
  │              │
  │              ├─ 读设置（settings.json）
  │              ├─ 读 Key（`Host::api_key` → Keychain；每个候选各取一次）
  │              ├─ lang::detect  → 源语言（按书写系统；拉丁字母再用变音字母与虚词粗分欧洲语言，英文是强默认，至少两条线索且比英文多两条才改判）
  │              │  lang::pick_target → 源==第一目标语言时改用第二目标语言
  │              ├─ prompt::find_style + build_translation_request → ChatRequest
  │              ├─ router::build_plan → 候选模型序列（首选 + 备用，目前备用为空）
  │              ├─ emit translate://start
  │              │
  │              └─ 对每个候选：
  │                   transport::stream_chat
  │                     ├─ wire::build_chat_request（纯函数，Key 只进 header）
  │                     ├─ reqwest 发送（超时只约束「拿到响应头」这一段）
  │                     ├─ SseDecoder：字节 → 完整事件（跨分片的多字节字符不破损）
  │                     └─ 每个 delta → emit translate://delta
  │                   ├─ 成功 → emit translate://done（含用量、费用、首字延迟）
  │                   └─ 失败且 router::next_after_failure 有下一个 → 换模型重试
  │
  └─ 前端 reducer 更新浮窗（只认当前请求 id 的事件）；Esc 置位**本窗口**这次请求的取消标志，传输层让取消与读取竞争（每 100 ms 看一次标志），不必等下一个分片
```

### 3.1 三条触发路径，同一条链路

三个功能共用 `umuo_app::translate` 的同一条流水线。差异收敛在 `Mode` 一个枚举里
（`surface()` / `scene()` / `write_back()` 都由它派生），流水线本身不再有分支：

| | 划词翻译 ⌃⌃ | 原地替换 ⌥⌥ | 撰写窗 ⌥⌘A |
| --- | --- | --- | --- |
| 文本来源 | `read_selection()`：AX 优先，失败降级模拟 ⌘C | `read_focus_text()`：选区优先，没有选区读整个输入框；**不降级** | 用户输入框里的文本（前端传入） |
| 事件收件人 | `panel` 窗口 | `panel` 窗口 | `compose` 窗口 |
| 路由场景 | `Scene::Selection` | `Scene::SilentReplace` | `Scene::Compose` |
| 结果去向 | 只显示 | **写回原处** | 只显示在译文区 |

`read_focus_text` 之所以不降级到剪贴板：写回用的是同一条可访问性通道，
通道不通的话降级取词也救不回来，只会白动一次用户的剪贴板。

**写回只在「流式翻译成功」这一个分支里发生。** §5.4 要求的「失败时不修改原文」
不是靠 try/finally，而是靠控制流本身——任何失败路径都到不了 `write_back`。

### 3.2 撰写窗的翻译调度（最新一次输入胜出）

撰写窗是三个功能里唯一有**持续输入**的：用户连续打字，防抖只能减少请求数，
消不掉「上一次还在流式返回、下一次已经该发了」。并发两个请求会让两段 delta
交错写进同一个译文区（一句话前半段来自旧文本、后半段来自新文本），
所以 `lib/compose-queue.ts` 做排队：翻译中到达的新文本只记作 pending，
等当前这次结束再发；后来的输入覆盖先前的 pending。

这个模块是纯函数、单独测试——时序 bug 在真实 UI 里几乎无法复现，
在纯函数里却是一行断言的事。

另一个容易漏的点：`compose_translate` 命令**直接失败**时（例如文本为空）
不会推 done/error 事件，调度器必须在那条路径上自己收尾，
否则窗口会永远停在 streaming 上、再也不翻译。代码里用 `.catch` 处理了这个分支。

### 3.3 写回前的目标守卫（这条别删）

静默翻译要花几秒，用户完全可能在这期间切到别的窗口。没有守卫的话，
译文会被打进另一个应用的输入框里——这是本产品能造成的最糟糕的破坏。

做法：取词前记下前台应用的标识（macOS 上是 `AXFocusedApplication` 的 pid），
写回前经 `Host::frontmost_app_token` 再取一次比对，见 `umuo_app::translate::target_still_matches`（`translate/plan.rs`）。三种情形的取舍：

- 前后都拿得到 → 相等才写；
- **之前拿得到、现在拿不到 → 按「已切换」处理，放弃写回**；
- 之前就拿不到 → 放行（否则在拿不到标识的受限进程里，功能会一律失败）。

放弃写回时浮窗会明确说明「目标应用已切换」，**不会**假装替换成功——
否则用户会以为改好了，转头再手动粘贴一遍。

### 3.4 多模型对比（PRD §5.6）

`umuo_app::compare` 与其它三个功能最大的结构性差别：它**并发**发起 N 路请求，
每路都是一次真实计费调用。三个必须做对的点：

1. **候选先去重再截断**（`router::compare_candidates`，最多 4 个）。
   重复候选会让用户看到两张一模一样的卡片，却各付一次钱。
2. **每路增量都带卡片下标**（`compare://delta { index, text }`）。
   不带下标的话 N 路流式输出会串进同一张卡片——前端 `compare-state.ts` 按 index 归位。
3. **共用同一份 prompt**。对比的意义就是「同一句话、不同模型」；
   各写各的 prompt，比出来的东西说明不了任何问题。

候选怎么来（`compare::plan_candidates`，纯函数 + 注入 `has_key`）：

- 用户在设置里勾选了供应商 → 按勾选顺序，且**跳过没有 Key 的**；
- 一个都没勾 → 自动取「所有已配置 Key 的供应商」，
  当前供应商用它自己填的模型，其余用目录里的默认模型；
- 本机模型（Ollama / LM Studio）的 `default_model` 是空的，**直接跳过**——
  它们必须先探测出可用模型，编一个名字出来只会让那一格必然报错。

「选它」的偏好存在 `stats.json`（与 `settings.json` 分开：一个是用户配置、
一个是行为副产品，损坏代价不同，不该被同一次坏写入一起毁掉）。
设置页把排行显示出来并提供「设为默认」，这样 PRD 说的「偏好用于推荐默认模型」
是一个**闭环**，而不是只写不读的数据。

**为什么这是独立窗口**：PRD §7.1 把它定义为「可调整大小的普通窗口」——
最多 4 张卡片横排，每张都要放下一段译文与一行计量，浮窗的 420px 装不下。

## 4. 数据与存储

| 数据 | 存在哪 | 为什么 |
| --- | --- | --- |
| API Key | 系统 Keychain（`keyring`，服务名 `app.umuo.desktop`） | PRD §6.4。不进配置文件、不进日志、不进历史库 |
| 偏好（供应商 / 模型 / 语言 / 风格 / 快捷键 / 历史开关） | `settings.json`（应用配置目录） | 不敏感但需要记住。结构体上有一条测试守「文件里不许出现 Key 字段」 |
| 对比偏好统计 | `stats.json` | 与设置分开：一个是用户显式配置、一个是行为副产品，损坏代价不同 |
| 翻译历史与用量 | `history.db`（SQLite，`crates/umuo-store`） | PRD §5.9 / §5.10。本机文件，不上传 |
| 收藏（词 / 句） | 同上，`favorites` 表 | 用户**显式**标记，因此不参与保留天数清理 |

`settings.json`、`glossaries.json` 共用 `persist.rs` 的读写（`stats.json` 只共用写，丢了无所谓）：
**写**是临时文件 + `sync_all` + `rename`，断电后不会只剩半截；**读**只有「文件不存在」才静默回落默认值，
读不动（编码不对、权限）或解析失败都先挪成 `<文件名>.corrupt-<时间戳>` 再回落——
用户手改坏一个字符，不该连原内容都看不到，备份带时间戳也不会被第二次损坏覆盖。

保存设置与导入配置走同一个 `AppCore::apply_settings_patch`（`crates/umuo-app/src/settings_patch.rs`）：
JSON 顶层逐键覆盖在**最新**的设置上（settings.json 的 mtime 变了先重载，缩小两个客户端互相覆盖的窗口；
嵌套对象整体替换、不做深合并，与 `settings-queue.ts` 一致），`Settings::prepare_for_save` 做规范化、
代理校验和端点校验，通过才写盘；失败时内存和文件都不变。副作用由宿主执行：
Tauri 的 `save_settings` 把前端传来的整份对象当全键 patch，再由 `run_settings_effects` 在 `SettingsEffects.hotkeys`
为真时重注册快捷键，并广播主题 / 语言 / 缩放、应用托盘样式；Swift 经 `Engine.applySettingsPatch` 只交自己改的键，**不自己解析这个文件**。
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

## 4.9 发音朗读：为什么用 `say` 而不是 `AVSpeechSynthesizer`

`AVSpeechSynthesizer` 是进程内的正确选择，但它**需要一个 run loop 才真正开口**，
而 Tauri 的命令跑在哪个线程上并不由我们决定——接错线程属于「写错了只有真人按一下才
知道」的那类问题。`say` 是独立进程：有没有在说话、能不能停，都可用 `Child` 观测。

代价是每次朗读起一个进程（几十毫秒），以及依赖 `/usr/bin/say`（macOS 自带，路径固定）。

文本前一定有 `--`：以 `-` 开头的译文（Markdown 列表）不加的话会被当成选项，
选中「-o/路径」朗读还会把那个文件覆盖成空录音。「停上一段 → 起新的 → 存起来」在同一把锁里做完，
并发朗读不会叠音、也不会留下停不掉的进程。

### 发音人是查出来的，不是猜出来的

第一版按语言硬编码了一张名字表（`ja → Kyoko`、`en → Samantha`…）。
**实测本机 `say -v '?'` 后发现这张表不可靠**：`say -v '?'` 不是按质量排序的
（`en_US` 第一条是 "Albert"，后面还有 "Bad News"、"Bubbles"），而且 macOS 会在
**每个语言下**都塞一整套趣味发音人（Eddy / Flo / Grandma…按字母序排在前面）。

所以现在是：启动时查询一次系统装了哪些发音人并缓存，然后按四层优先级挑：

1. 地区精确 + 自然音
2. 同语言（其它地区）+ 自然音 ← **本机中文就吃这一层**：`zh_CN` 只有趣味音，
   而 `zh_TW` 有自然音 Meijia。让 Meijia 念简体好过让 Eddy 念。
3. 地区精确 + 趣味音
4. 同语言 + 趣味音

四层全落空就交给系统默认发音人。趣味音名单在 `NOVELTY_VOICES` 里——
它是一份**已知的固定名单**（macOS 自带的角色音），不是启发式猜测。

## 4.10 浮窗的钉住与拖动

PRD §5.2 要求浮窗「可钉住、拖动、调整大小」，§7.1 补一句「失焦或按 Esc 关闭；可钉住」。

- **调整大小**：`resizable(true)` + `min_inner_size(320, 150)`，防止被拖成一条缝。
- **拖动**：`data-tauri-drag-region` 放在浮窗 header 与标题上。Tauri 只对**直接命中该属性**的
  元素触发拖动，所以 header 里的按钮照常可点。
- **钉住**：控制「切走是否自动收起」，见下。

### 「失焦收起」只能靠轮询

浮窗是**非激活**窗口，创建时不接受焦点，因此没有可靠的 blur 事件。而用户真正想表达的是
「我不看它了」——即**切到了别的应用**。所以看门狗每 500 ms 读一次前台应用标识，
与「显示浮窗时记下的那个应用」比对，不同就收起，钉住则不动。

两个保守之处：**只在浮窗可见时才查**（隐藏时一次 AX 调用都不发）；**拿不到标识时不收起**
（宁可多留一会儿，也不能让用户正在读的浮窗凭空消失）。判据 `should_auto_hide` 是纯函数。

### JSX 里没有 `//` 注释

浮窗 header 上那段说明第一次写成了 `//` 开头，被 React **当成文本渲染**出来——
浮窗顶部多了两行 `// ...`。JSX 里的注释必须写成 `{/* ... */}`。
这是渲染夹具（假 IPC 桥 + `--dump-dom`）读出来的，构建与 lint 全程绿。

## 4.11 首次启动引导：不拦人，但要说清后果

PRD §7.4 的五步引导。两条产品规则落在实现里：

**① 不阻止前进。** 权限可以稍后授予、模型可以稍后再配——因为用户暂时不想授权就把他卡在
第四步，他只会卸载，而不是去系统设置里点一下。所以 `isStepSatisfied` **只用于显示进度与提示**，
不用于禁用「下一步」。唯一的例外是第一页没有「上一步」（那里本来就没有可回退的）。

**② 但要说清后果。** 一个引擎都没有时引导仍然可以结束，不过最后一页会写明
「现在结束的话客户端翻不了任何东西」，而不是让他事后以为软件是坏的。

### 记下来而不是靠「有没有配 Key」判断

`Settings::onboarding_done` 是显式字段。用「有没有配 Key」推断的话，
明确选择先跳过的用户下次启动会又被引导糊一次脸。

### 启动时错开 400 ms

托盘图标、快捷键、浮动窗都还在初始化，抢在前面弹窗会让客户端显得「一启动就弹东西」。
引导在独立线程里等 400 ms 再开。

### 第 5 步走的是真实流水线

「翻一句看看」调用的是与 ⌥D 完全相同的 `translate_text` —— 浮窗、流式、模型、费用都是真的。
没有去模拟一次全局快捷键（那需要真实的键盘事件），因为**假装的演示比不演示更糟**。

## 4.12 截图 OCR 的三个决定（PRD §5.5）

**① 识别走本机 Apple Vision，不把截图发给多模态模型。**
截图 OCR 是高频动作，每次上传一张图既慢又贵，而用户截的往往就是自己屏幕上的东西。
多模态识图留给「图片、复杂排版」那类 Vision 做不好的场景——PRD 里它是可选项。

**② 选区交给系统自带的框选（`screencapture -i`），不自绘浮层。**
自绘浮层要把「窗口坐标」与「屏幕全局坐标」对齐，两套坐标系在 macOS 上的原点约定
并不一致（实测本机三块屏里有一块原点在 `(-1080, -331)`）。弄错就会截到别的地方，
而这类错误在没有真人盯着屏幕时**几乎无法验证**。系统框选由系统完成选区到像素的映射，
把这块风险整个消掉。

代价是拿不到选区坐标，所以 PRD 里「可选」的**覆盖模式**（把译文贴回截图原位置）
暂时做不了。自绘浮层列为后续项——到那时本文 §3 里的 `Region` 换算逻辑已经写好并有测试，
接上去即可：`clip_to_display` / `to_display_local` / `region_pixels` / `normalize_drag`。

**③ 用户取消不是错误，识别不到文字也不是失败。**
按 Esc 取消框选是完全正常的操作，不弹任何提示；截到图片或纯色区域时识别为空，
要明确说「没有识别到文字」——否则用户会以为快捷键没生效。

单位约定见 `crates/umuo-platform/src/capture.rs` 的模块文档：
**对外只用点（point）**，只有在真正取位图时才按显示器 `scale` 换算成像素。

## 5. 安全模型（BYOK）

三条不变量，都有测试或类型约束兜底：

1. **Key 只进请求头，不进请求体。**
   `wire::build_chat_request` 有一条测试专门断言 body 里搜不到 Key 字符串。
   这样它也不会经由任何日志或错误上报泄露出去。
2. **Key 不从前端回传。** 前端能拿到的只有 `key_status` → 布尔值。
   一旦让 WebView 能读回明文，它就会出现在 devtools 与内存快照里。
3. **请求只发往用户配置的端点。** BYOK 模式下不经过任何 umuo 服务端；
   `open_external` 只放行 `https://`，避免把「打开本机文件」的能力交给页面。

诚实边界：Keychain 保护的是**密钥本身**；但它保护不了「模型供应商能看到你翻译了什么」——
这是 BYOK 的固有性质，UI 上也如实说明，不做含糊承诺。

## 6. 被否决的方案（避免以后重新纠结）

| 方案 | 否决理由 |
| --- | --- |
| 用第三方 accessibility crate 取词 | 我们只需要四个函数，而这类 crate 的 API 与维护状态都不稳定。手写 FFI 只有几十行，AX 的 C API 十几年没变 |
| 取词首选模拟 ⌘C | 会改写用户的剪贴板。必须 AX 优先，剪贴板只兜底 |
| 在 settings.json 里存 Key | 明文落盘，和安全承诺冲突 |
| 用前端发供应商请求 | 页面 CSP、Key 暴露、跨平台不一致，三个问题一起出现 |
| 核心逻辑放 TypeScript | 三端共享的是 Rust 核心；同一份翻译逻辑在两端重写必然漂移 |
| 浮窗做成 NSPanel 真·非激活 | 需要 objc2 子类化 NSWindow，里程碑 1 先用 Tauri 的 `focused(false) + always_on_top`。**这是已知差距**，见下 |

## 7. 已知边界与后续项

| 项 | 现状 | 影响 |
| --- | --- | --- |
| 浮窗不抢焦点 | 用 Tauri 的 `focused(false)`；点击浮窗仍可能激活本应用 | 与 PRD §7.1「非激活窗口」有差距，需要真正的 NSPanel |
| 浮窗锚定位置 | 按鼠标位置摆放 | 不是精确贴在选区旁；需要 `AXBoundsForRange` |
| 截图 OCR 的选区 | 用系统框选，**没有自绘浮层** | 因此拿不到选区坐标，「覆盖模式」（译文贴回原位置）做不了 |
| 截图 OCR 的识图翻译 | 只做本机 Vision 文字识别 | 「多模态模型直接识图」（PRD §5.5 可选）未做 |
| 剪贴板降级的延迟类型 | 降级会存下所有 item 的所有类型原样恢复；但只以「延迟提供」挂着、读取时已取不到数据的类型（例如源应用已退出的文件承诺）恢复不了 | AX 路径不受影响；降级路径才有此限制 |
| 对比窗没有收藏入口 | 浮窗与历史窗可以收藏，对比窗的卡片上没有 | 要收藏对比结果得先绕到历史窗 |
| 翻译历史无导出 | 只有列表与检索 | PRD 未要求；用户迟早会想要 |
| 对比卡片不能单独重试 | 失败了只能整轮重来 | — |
| 端到端未人工验证 | 首次真跑需要用户自己的 API Key | 详见 README 的「跑通划词翻译需要一次系统授权」 |
| 账号 / 订阅 / 官方额度 | 本仓库不含服务端（PRD §9.6） | 前端也没有对应入口 |
| 免 Key 兜底通道（有道 / Bing / Google 网页通道、DeepL） | 未实现 | 这些通道涉及逆向签名与 ToS 风险，见 `docs/research/luca-translate-audit.md` |
| luca-translate 代码复用 | **尚未复制任何代码** | 审计结论见 `docs/research/luca-translate-audit.md`；其中 3 个模块（macOS 取词、截图 OCR、多渠道编排）值得搬 |

### 已经完成、曾经列在这个表里的项

撰写窗（⌥A）、输入框原地替换（⌥⇧T）、截图 OCR（⌥S）、多模型对比（⌥⇧C）、
翻译历史与收藏与用量统计（§5.9 / §5.10）、隐私模式、分场景模型与备用顺序（§6.3）都已实现并有测试覆盖。
这张表只留**还没做**的，避免它变成一份过期清单。

## 8. 与 PRD 的对应关系

| PRD 小节 | 落点 |
| --- | --- |
| §5.2 划词 / 划句翻译 | `crates/umuo-app/src/translate/`（流水线）+ 外壳 `translator.rs`（触发与取词）+ `apps/desktop/src/panel.tsx` |
| §5.4 输入框原地替换（静默翻译） | `umuo_app::translate::Mode::SilentReplace` + 写回守卫 + `Host::write_back`；平台侧 `read_focus_text` / `replace_selection` |
| §5.3 撰写窗 | `apps/desktop/src/compose.tsx` + `lib/compose-queue.ts`；Rust 侧 `Mode::Compose` 与 `compose_*` 命令 |
| §6.3 分场景模型与备用顺序 | `umuo_core::router`（`SceneModels` / `build_plan`）+ `Settings::scene_models` / `fallback_models` + 设置页的「模型路由」 |
| §5.8 术语表 | `umuo_core::glossary`（筛选 / 命中 / 渲染 / CSV）+ `crates/umuo-app/src/glossaries.rs`（存储与注入块） |
| §5.10 月度上限 | `umuo_core::budget`（纯决策）+ `umuo-store` 的按供应商月汇总 + `crates/umuo-app/src/budget.rs`（执行点） |
| §5.7 翻译风格预设 | `umuo_core::prompt`（`StyleSpec` / `CustomStyle` / 模板渲染）+ 设置页的预设编辑器 |
| §5.1 发音朗读 | `umuo_platform::Speech`（trait）+ `umuo-platform-macos` 的 `say` 实现 + 浮窗/词卡的朗读按钮 |
| §5.2 单词词卡 | `umuo_core::word_card`（判定 + Prompt + 解析）+ 浮窗/撰写窗的 `WordCardView` |
| §5.5 截图 OCR | `crates/umuo-platform{,-macos}` 的 `capture` / `ocr` + `apps/desktop/src-tauri/src/screenshot.rs` |
| §5.6 多模型对比 | `crates/umuo-app/src/compare.rs`（候选规划与并发扇出）+ `apps/desktop/src-tauri/src/compare.rs`（触发与开窗）+ `lib/compare-state.ts`（N 路增量归位）+ `stats.rs`（偏好统计） |
| §5.9 翻译历史 | `crates/umuo-store`（SQLite）+ `history.rs`（写入适配）+ 历史窗（历史 / 收藏两页） |
| §5.10 用量与费用 | `umuo-store::{usage_this_month, usage_by_day}`（读 `usage` 账本）+ 历史窗顶部的按日柱状图 + 设置页的「本月」一行 |
| §5.2 单词模式 | `umuo-core::word_card::is_word_mode` + 浮窗与撰写窗的 `WordCardView` |
| §5.7 翻译风格 | `umuo-core::prompt`（7 个内置预设）+ 设置页风格选择 |
| §6.1 Provider 接入 | `umuo-core::provider::PROVIDERS`（12 条数据，含 Azure OpenAI） |
| §6.2 配置流程 | `umuo-core::key_detect` + `list_models` 命令（用真实 Key 拉模型列表） |
| §6.3 模型路由与故障转移 | `umuo-core::router` + `umuo_app::translate` 的候选循环 |
| §6.4 Key 安全 | `umuo-platform-macos::secret` + `wire` 的 body 断言 |
| §6.5 Prompt 规范 | `umuo-core::prompt::BASE_RULES` |
| §8 首字延迟 | `transport::StreamOutcome::first_token_ms`（浮窗结果显示） |
| §5.10 费用 | `umuo-core::usage`（内置价格表 + 估算标记） |
| §11 官网 | `site/`（独立的 Bun 项目，见 `site/AGENTS.md`） |
