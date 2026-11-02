# Handy 语音输入实现研究

研究日期：2026-10-23。本文用于 umuo 语音功能设计，不代表已经实现或完成性能验收。

## 结论与产品边界

Handy 是合适的主要参考：它已经覆盖快捷键录音、本地转写、可选 LLM 后处理、输入框输出，而非只有语音识别。
umuo 保留原生 SwiftUI + AppKit 外壳，参考这些流程及纯规则，不引入 Handy 的 Tauri / React 架构。

当前用户确定的范围：文字翻译（划词、输入、原地替换）、OCR 截图翻译、语音输入后润色或翻译。
商业模式为一次性购买、纯 BYOK、无 umuo AI 网关。语音首版建议验证「本地转写 → 已配置的文字模型 → 受守卫保护的输出」。
本地转写无需新的 API Key，但需要下载模型；润色、翻译可复用现有文字供应商 Key。可选云端转写必须另行确认供应商的音频接口、模型与凭据能力，不能假设普通聊天端点支持音频。

## 研究基线

只读取上游源码，未运行项目、未下载语音模型、未访问真实 Keychain 或用户剪贴板。

- 仓库：[cjpais/Handy](https://github.com/cjpais/Handy)
- 固定提交：[`5a9451e70aedc90648ce2befd9d7e0304746f9c1`](https://github.com/cjpais/Handy/tree/5a9451e70aedc90648ce2befd9d7e0304746f9c1)
- 以下上游链接均固定至此提交。依赖版本与当前主分支 README 的旧印象可能不同，以所读提交为准。

## 已核实的上游实现

### 1. 录音与按键是完整会话

`shortcut/handler.rs` 接收按下、松开事件，将转写动作交给 `TranscriptionCoordinator`。协调器支持 Toggle、PushToTalk、HoldOrToggle，
以 Idle / Recording / Processing 管理生命周期，处理去抖、重复按键、忙碌期间的输入与取消。其决策规则和副作用分离，适合借鉴测试方法。
这比给现有「按下一次执行动作」增加一个录音按钮更完整。
来源：[快捷键分发](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/shortcut/handler.rs)、
[会话协调器](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/transcription_coordinator.rs)。

当前录音依赖 `handy-recorder = "0.1"`；音频管理层以 16 kHz 为处理采样率，管理设备、首帧就绪和 VAD。
VAD 不是仅据 README 推测：音频管理有 Silero / Earshot 适配，动作层按模型流式能力选择 Disabled / Streaming / Offline 策略。
是否采用相同录音依赖属于 umuo 后续选型，macOS 系统录音仍应归 Swift 宿主。
来源：[依赖清单](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/Cargo.toml)、
[音频管理](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/managers/audio.rs)、
[动作编排](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/actions.rs)。

### 2. 当前转写引擎不只是直接调用 whisper-rs

此提交统一依赖 `transcribe-cpp 0.4.0`，macOS 启用 Metal。独立 worker 是原生推理代码的运行位置；
通过 `transcribe_cpp::{Model, ModelOptions, Session, Stream}` 加载、批量 `session.run` 或流式 `session.stream`。
这是值得关注的崩溃隔离与释放边界，但不表示 umuo 首版必须照搬进程协议，或当前平台目标已经兼容该依赖。
来源：[Cargo.toml](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/Cargo.toml)、
[worker 实现](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/engine_supervisor/worker.rs)。

转写管理器集中处理模型加载、状态事件与空闲卸载；录音期间刷新活动时间，避免模型正在使用时被空闲计时器卸载。
不能只引入模型推理函数而忽略加载失败、取消、重试及内存释放。
来源：[转写管理器](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/managers/transcription.rs)。

### 3. 已有文字后处理及自定义端点

`post_process_transcription` 读取所选 provider、model、prompt 与 Key，调用 LLM；设置里有可编辑 `base_url` 的 custom provider，默认示例为本机 Ollama `/v1`。
`llm_client.rs` 的兼容路径构造 `/chat/completions`，另有 Anthropic `/messages` 分支。
因此可参考「转写与润色分阶段」；umuo 应复用自己的 Rust 供应商与 Keychain 路径，不新增 Handy 的另一套 Key 设置。
来源：[后处理编排](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/actions.rs)、
[LLM 客户端](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/llm_client.rs)、
[后处理设置](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/settings.rs)。

重要差异：Handy 的 `process_transcription_output` 在后处理未返回结果时保留原转写。
umuo 应按模式决定失败行为：润色失败可提供原文供用户选择；语音翻译失败应显示失败并保留转写，不能把源语言悄悄输入需要目标语言的输入框。

### 4. 输入框输出与剪贴板仍须单独设计

Handy `clipboard::paste` 串行处理粘贴，支持直接键入及剪贴板方式。普通剪贴板路径保存文本，读不到文本才保存图像，延时后恢复；
这不是完整的所有 item / UTI 快照。macOS 还有由 `reliable_paste` 设置控制的 receipt 路径：通过惰性 NSPasteboard 提供者观察读取，
用 `changeCount` 与所有权保护恢复，避免覆盖用户后续复制。此路径不能被概括成无条件可靠粘贴。
来源：[输出分发与普通路径](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/clipboard.rs)、
[macOS receipt 路径](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/paste_tx/macos.rs)。

上述读取回执只能说明有人读取剪贴板，不能单独证明是录音开始时那个输入框。umuo 应保存会话目标，提交前重新核验前台应用及焦点输入对象；
切换应用或同一应用内切换输入框时，先保留结果供复制，不向新目标自动投递。首版不自动按 Enter 发送消息。

### 5. 模型下载与许可分开处理

模型目录位于应用数据目录的 `models/`。HTTP 下载实现 `.partial`、Range 续传、取消、长度检查，以及有预期值时的 SHA-256 校验；
自定义模型缺少预期 hash 时不会完成相同的真实性校验。可借鉴这一小块协议规则，不能把「下载结束」当作模型可用。
来源：[模型目录与注册](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/managers/model.rs)、
[HTTP 下载器](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/managers/model/download.rs)。

Handy 主项目为 MIT；实际复制代码需保留版权与许可声明。模型目录包含 `mit`、`apache-2.0`、`cc-by-4.0`、`other`，亦有 `cc-by-nc-4.0` 条目，
说明应用源码许可不覆盖所有权重。候选引擎自身依赖、指定版本的模型卡、权重许可、再分发与署名要求均须单独确认，不能因项目 MIT 就打包所有模型。
来源：[MIT LICENSE](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/LICENSE)、
[模型目录元数据](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/catalog/catalog.json)。

## 映射到 umuo：建议而非已实现

分层依据：本仓库 [ARCHITECTURE.md](../ARCHITECTURE.md) §2–3。

| 责任 | 建议位置与范围 |
| --- | --- |
| 麦克风权限、设备、录音、按下与松开、浮层 | Swift 宿主；补麦克风用途说明与录音状态，不把平台 API 放进 umuo-app/core |
| 录音会话纯规则、模式与取消、迟到结果隔离 | umuo-app；明确 idle / recording / transcribing / processing / ready / failed，以及每会话 id |
| 本地转写 | 先验证候选引擎与独立生命周期边界；平台装配归宿主，纯推理适配不强迫核心加载平台依赖；最终位置由兼容性实验决定 |
| 同语言润色、目标语言翻译、供应商请求 | Rust umuo-app/core；复用现有 provider、取消和凭据获取，新增明确任务语义 |
| 焦点目标、AX 写入或受控粘贴 | Swift；复用已有守卫思路，新增语音插入的目标捕获与验证 |
| 跨语言导出 | umuo-ffi 只转换类型和转发；不把录音或润色业务写进 FFI |

当前有几个不能直接复用的接口：

- `crates/umuo-app/src/translate/plan.rs` 的 Mode 只有 Selection / SilentReplace / Compose / Ocr，尚无「同语言润色」任务。
- `Platform/Hotkeys.swift` 的 HotkeyAction 已在阶段 A 收敛为四种功能动作；按住录音还需按下、松开、取消事件，不等同于连按修饰键。
- `Platform/ReplaceSelection.swift` 的 pasteFallback 为异步目标读取保留译文剪贴板、不恢复旧内容；refocus 仅校验应用 pid，不能证明同一个输入框。语音插入不能直接当作已有原地替换已覆盖。

## 建议首版与验证顺序

1. 先固定两个输出模式：「同语言整理」与「翻译到目标语言」，不暴露 Prompt / 温度 / 多引擎比较。短句优先，按住说话、松开处理，Esc 全链路取消。
2. 选一个多语言本地转写候选做最小实验；比较中文、中英混说、姓名数字、静音、噪声、短停顿，分别测冷启动与热启动。先验证模型，再承诺默认方案。
3. 在假音频和假 Host 下验证状态机、取消、过期结果；通过现有 Rust 客户端做润色/翻译。否定词、数量、日期、金额、姓名必须作为语义保真用例，禁止润色自行补事实。
4. 最后真机验证输入交付：同应用换输入框、跨应用、非可编辑焦点、安全输入、目标退出、用户中途复制、慢速剪贴板读取。失败保留可复制结果。
5. 性能验收按 macOS 14+、仅 Apple Silicon（2026-10-28 起不再考虑 Intel）；记录模型版本、下载体积、phys_footprint、冷/热延迟和卸载效果。不能沿用旧 PRD 的云端 P50≤2s 作为本地模型承诺。

待验证：transcribe-cpp / whisper.cpp 等候选的真实 API、构建与模型许可、Metal 与 Intel 兼容性、进程隔离必要性、模型首次下载体验、中文精度与内存。
版本、许可、平台与公开基准的核对见 [本地转写引擎与模型选型](local-transcription-engines.md)；真机精度与内存仍待实验。

## 产品文档衔接

2026-10-23 已将三项核心、买断 BYOK、取消网关与语音首版目标同步到 [PRD v0.5](../PRD.md)。
开发顺序见 [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md)，实际状态见 [验收清单](../PRD-CONFORMANCE.md)。
本研究仍是选型依据，本地引擎及性能目标须经实验确定，未实现项不计为完成。
