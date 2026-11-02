# 本地转写引擎与模型选型调研

研究日期：2026-10-27 调研，2026-10-28 补本机实测并定案。对应 [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) 阶段 B。

> **读法**：「结论」到「待定问题」是 10-27 的书面调研，只读上游源码、发布页、模型卡与许可原文，表中准确率与速度来自上游公开基准，
> 当时的约束还包括 Intel 与闭源买断（均已取消）。**最终选型以文末「2026-10-28 阶段 B 实测结果与最终选型」为准**：
> 在 Apple M2 Pro 上实测 transcribe.cpp v0.4.1 与四份 GGUF 权重，选定 `Qwen3-ASR-0.6B-Q4_K_M`；平台只剩 Apple Silicon + macOS 14+。

## 结论

1. **引擎首选 transcribe.cpp**（Handy 使用的同一引擎，MIT）。它有官方预编译 Swift `xcframework`（macOS 13+，arm64 走 Metal、x86_64 只走 CPU），
   接入不需要 cmake 也不需要完整 Xcode；模型目录带固定 revision 和 SHA-256，并有统一基准可比。
2. **备选 sherpa-onnx**（Apache-2.0）。Rust crate 构建时下载官方静态库，同样不需要 cmake；支持 SenseVoice、Qwen3-ASR、Fun-ASR、Whisper。
   若 transcribe.cpp 在 Intel 或 macOS 14 上实测不过，切到它代价最小。
3. **默认模型候选 Qwen3-ASR-0.6B**（Apache-2.0）。在中文、英文、日文三种界面语言上误差都低，Q8_0 约 850 MB，Q4_K_M 约 590 MB。
4. **不建议**：whisper-rs（约 7 个月无更新、需本机 cmake、只有 Whisper 系列）；Apple `SFSpeechRecognizer`（每个识别器只能设一种语言，不适合中英混说）；
   macOS 26 的 `SpeechAnalyzer` 不满足 macOS 14+ 底线。
5. **SenseVoiceSmall 最快最小，但许可有风险**：FunASR 模型许可第 3 条写「仅作为参考和学习使用」，用于收费闭源客户端前需要你判断或另行确认。
6. **中英混说没有任何一份公开基准覆盖**（FLEURS 是单语朗读），所有候选都要用我们自己的夹具测。

## 约束回顾

| 约束 | 来源 | 对选型的影响 |
| --- | --- | --- |
| macOS 14+，Intel 与 Apple Silicon | PRD「兼容边界」 | Intel 上 ggml/onnxruntime 都只跑 CPU，模型不能太大 |
| 闭源、一次性购买 | PRD「商业边界」 | 引擎与权重许可都要允许商用；署名、NOTICE 随包或在「关于」里展示 |
| 本机只有 Command Line Tools、无 cmake | 当前开发机 | 需要源码编译 C++ 的路线要先 `brew install cmake`，CI 同理 |
| 界面语言 zh-Hans / zh-Hant / en / ja | `Localizable.xcstrings` | 口述语言优先普通话、英语、日语；繁体输出可由后续润色/翻译步骤处理，不要求模型直出 |
| 首次使用才下载模型，不默认保存音频 | 阶段 C 计划 | 模型来源、校验与再分发许可要先定 |

## 引擎对比

| | transcribe.cpp 0.4.1 | sherpa-onnx 2.0.1 | whisper.cpp（whisper-rs 0.16.0） | Apple SFSpeechRecognizer |
| --- | --- | --- | --- | --- |
| 许可 | MIT；内含 ggml、Silero VAD、miniz 均 MIT | Apache-2.0；内含 onnxruntime 1.28.2（MIT） | whisper-rs Unlicense；whisper.cpp MIT | 系统框架，无额外许可 |
| 最近发布 | 2026-10-22，活跃 | 2026-10-27（2.x 刚发布数天） | 2026-03-12，之后无提交 | 随系统 |
| Swift 接入 | 官方 `TranscribeCpp.xcframework`，SwiftPM `binaryTarget`，macOS 13+ | 官方 macOS xcframework（静态 / 动态） | 官方 xcframework，macOS 13.3+，arm64 + x86_64 | 原生 |
| Rust 接入 | `transcribe-cpp` crate，**需 cmake** 源码编译 | `sherpa-onnx` crate，**下载预编译静态库**，无需 cmake；只取单架构，universal 需两次构建再 `lipo` | `whisper-rs`，**需 cmake**（bindgen 失败时用自带绑定） | 无 |
| Apple Silicon | Metal + CPU，Metal 着色器嵌入二进制、运行时编译 | CPU；CoreML EP 代码存在，但 Rust 静态包是否含 CoreML 未核实 | Metal（嵌入式）+ CPU | 系统 |
| Intel x86_64 | **只 CPU**；构建固定 SSE4.2 + AVX + F16C 下限，不按构建机调优 | CPU，有 x64 预编译包 | CPU + Accelerate；需显式 `GGML_NATIVE=OFF`，否则按构建机指令集编译 | 系统 |
| 中/英/日模型 | Whisper、Qwen3-ASR、SenseVoice、Fun-ASR、Nemotron、Cohere 等（GGUF） | SenseVoice、Qwen3-ASR、Fun-ASR Nano、Paraformer、Whisper（ONNX） | 只有 Whisper 系列 | 每个识别器单一语言；端侧支持哪些语言只能运行时查 `supportsOnDeviceRecognition` |
| 取消 / 并发 | 有取消 token；同一模型同时只允许一次推理，crate 内部用锁排队 | 未逐项核实 | 未逐项核实 | 系统任务可取消 |

来源：
- transcribe.cpp：[crate 0.4.1](https://crates.io/crates/transcribe-cpp/0.4.1)、[v0.4.1 发布页（含 macOS 预编译包与 xcframework）](https://github.com/handy-computer/transcribe.cpp/releases/tag/v0.4.1)、
  [Swift 绑定说明（平台与后端表）](https://github.com/handy-computer/transcribe.cpp/blob/v0.4.1/bindings/swift/README.md)、[THIRD-PARTY-LICENSES](https://github.com/handy-computer/transcribe.cpp/blob/v0.4.1/THIRD-PARTY-LICENSES.md)、
  `transcribe-cpp-sys` 0.4.1 `bindings/rust/sys/build.rs`（Metal 嵌入、macOS CPU 下限注释）。
- sherpa-onnx：[crate](https://crates.io/crates/sherpa-onnx)、[v2.0.1 发布页](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v2.0.1)、[xcframework 发布页](https://github.com/k2-fsa/sherpa-onnx/releases/tag/xcframework)、
  `sherpa-onnx-sys` 2.0.1 `build.rs`（`RELEASE_BASE_URL`、`SHERPA_ONNX_ARCHIVE_DIR` 离线目录）。
- whisper-rs：[Codeberg 仓库](https://codeberg.org/tazz4843/whisper-rs)（内嵌 whisper.cpp 1.8.3；上游已到 1.9.5）。
- Apple：[requiresOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)（「on-device requests won't be as accurate」）、
  [SFSpeechRecognizer](https://developer.apple.com/documentation/speech/sfspeechrecognizer)（「Each speech recognizer supports only one language」）、[SpeechTranscriber（macOS 26.0+）](https://developer.apple.com/documentation/speech/speechtranscriber)。

transcribe.cpp 的 Swift 绑定 CI 运行在自托管 ARM64 Mac 上；x86_64 切片是否经过运行测试未核实，需要我们自己验证。

## 模型对比（中文可用的候选）

数据取自 Handy 固定提交 [`5a9451e`](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/catalog/catalog.json) 的模型目录。它由 `@handy-computer/models@0.2.2` 生成，基准来自 transcribe.cpp v0.4.0。

读数说明：
- **误差**：FLEURS test 集、Q8_0 量化。中、日、韩是 CER（字错误率），英文是 WER。打分前做 NFKC、去标点、大小写折叠；CER 去掉全部空白；ITN 关闭。
  依据：[`languages.py`](https://github.com/handy-computer/transcribe.cpp/blob/f1dcd15858c4bbba87ca97862b4e448b2cf15b8f/scripts/wer/languages.py#L55-L58)、[`score.py`](https://github.com/handy-computer/transcribe.cpp/blob/f1dcd15858c4bbba87ca97862b4e448b2cf15b8f/scripts/wer/score.py#L10-L18)。
- **30 秒口述等待**：`30 ÷ xRT`。xRT 为音频秒数 ÷ 计算秒数，越大越快。测速机器是 **Ryzen 4750U 笔记本**（GPU 档为 Vulkan，CPU 档为纯 CPU），**不能换算到 Mac**。
  依据：[`ingest_perf.py`](https://github.com/handy-computer/transcribe.cpp/blob/f1dcd15858c4bbba87ca97862b4e448b2cf15b8f/scripts/catalog/ingest_perf.py#L126-L131)。
- `@handy-computer/models` 包的推荐规则（Handy 在该提交里用的是硬编码排序，不读这些阈值）：任一所选语言误差 < 20% 才算可用，≥ 15% 会标注偏弱；综合推荐偏好 GPU 等待 ≤ 5 秒，「快」档要求 CPU 等待 ≤ 4 秒。

| 模型 | 参数 | 中 CER | 英 WER | 日 CER | 韩 CER | 30 秒等待 GPU / CPU | Q8_0 | Q4_K_M | 权重许可 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Qwen3-ASR-0.6B** | 0.78B | 7.6 | 4.2 | 8.6 | 5.8 | 3.1 / 5.7 秒 | 850 MB | 590 MB | Apache-2.0 |
| Qwen3-ASR-1.7B | 2.0B | 7.1 | 3.2 | 5.3 | 4.6 | 7.3 / 12.1 秒 | 2185 MB | 1320 MB | Apache-2.0 |
| whisper-large-v3-turbo | 0.81B | 8.5 | 4.4 | 4.8 | 5.2 | 9.7 / 21.0 秒 | 886 MB | 536 MB | MIT |
| SenseVoiceSmall | 0.23B | 10.1 | 7.1 | 7.6 | 8.3 | 1.1 / 1.5 秒 | 253 MB | 146 MB | FunASR 模型许可 v1.1 ⚠ |
| Fun-ASR-Nano-2512 | 0.83B | 8.6 | 5.5 | 8.5 | — | 2.8 / 3.8 秒 | 891 MB | 557 MB | GGUF 标 FunASR v1.1，上游标 Apache-2.0 ⚠ |
| Fun-ASR-MLT-Nano-2512 | 0.83B | 8.6 | 4.9 | 2.3 | 5.2 | 3.4 / 5.5 秒 | 891 MB | 557 MB | 同上 ⚠ |
| nemotron-3.5-asr-streaming-0.6b | 0.64B | 18.9 | 7.9 | 13.5 | 8.9 | 1.8 / 2.8 秒 | 751 MB | — | OpenMDW-1.1（宽松） |
| whisper-small | 0.24B | 23.1 | 6.5 | 12.8 | 7.7 | 2.6 / 5.1 秒 | 270 MB | 172 MB | MIT |

- whisper-small 和 nemotron 列出来是为了说明它们的中文不达标（≥ 15%），不作候选。
- Qwen3-ASR-1.7B、whisper-large-v3-turbo 在 Intel 纯 CPU 上的等待很可能过长，只适合作为 Apple Silicon 上的「更准」可选项。
- 表中只有 Q8_0 有基准；更小量化（Q4_K_M 等）的误差变化未测。
- sherpa-onnx 侧对应的 ONNX 包：SenseVoice int8 约 166 MB、Qwen3-ASR-0.6B int8 约 879 MB、Fun-ASR Nano int8 约 842 MB（[asr-models 发布页](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) 压缩包大小）。

### 许可细节

全部 GGUF 仓库都不需要登录或同意条款（`gated: false`）。仓库只做了格式转换与量化，没有重新训练；每个仓库都带 `LICENSE` 与 `NOTICE`，NOTICE 写明上游 commit。

- **Qwen3-ASR**：GGUF 与上游 [Qwen/Qwen3-ASR-0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) 均为 Apache-2.0。需保留 LICENSE、NOTICE，并注明「已转换为 GGUF」。
- **Whisper**：GGUF 与上游 [openai/whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) 均为 MIT（Handy 目录里写的 apache-2.0 与仓库元数据不符，以仓库为准）。
- **SenseVoiceSmall**：[FunASR MODEL_LICENSE v1.1](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE)。
  - 2.1 允许使用、复制、修改、分享。
  - 2.2 要求注明来源与作者，并保留模型名。
  - 第 3 条写「仅作为参考和学习使用」，位于免责条款中，能否据此限制商用有歧义，本文不做法律判断。
  - 第 6 条允许单方修订并自动生效；第 7 条管辖法律处是未填的占位符。
- **Fun-ASR Nano**：handy-computer 的 GGUF 仓库标 FunASR v1.1，上游 [FunAudioLLM/Fun-ASR-Nano-2512](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512) 与上游 GitHub 标 Apache-2.0。哪一个是权重的权威许可未核实。
- **Nemotron**：[OpenMDW-1.1](https://openmdw.ai/license/1-1/)，允许商用与再分发。分发时需附协议全文与原有版权声明；对模型提起专利诉讼会使授权终止。

再分发：如果要把模型镜像到我们自己的 R2，只对 Apache-2.0、MIT、OpenMDW 的模型做，并随文件附上 LICENSE / NOTICE。FunASR 系模型不建议镜像，用户如果选用，就直接从 Hugging Face 下载并在界面上提示许可。

### 中英混说

模型卡里没有任何一个明确声称支持「句内中英混说」：

- **Fun-ASR**：系列卡片有「free language switching and mixed recognition」，但没有专门说中英，而且同一张卡的 Nano 表格只列中、英、日。
- **Nemotron**：只做到按整句识别语言。
- **Qwen3-ASR、SenseVoice、Whisper**：卡片里都没有相关说法。

FLEURS 是单语朗读，不覆盖混说。所以混说只能靠阶段 B 第二项的固定音频夹具来比较，这也是选默认模型前最需要补的数据。

## 进程隔离的依据

Handy 把 transcribe.cpp 的全部原生代码放进子进程，由 App 自身加 `--transcribe-worker` 参数重新启动。原因写在 [`engine_supervisor/mod.rs`](https://github.com/cjpais/Handy/blob/5a9451e70aedc90648ce2befd9d7e0304746f9c1/src-tauri/src/engine_supervisor/mod.rs#L1-L20) 里：

- **崩溃隔离**：GPU 驱动故障、`GGML_ASSERT` 中止或卡死，只会杀掉 worker；GPU 出问题时自动用纯 CPU 的 worker 重试一次。
- **内存释放**：worker 的寿命与模型一致，卸载模型就是结束进程，CPU 和 GPU 内存全部还给系统。
- **超时设置**：首次握手 60 秒（macOS 首次编译 Metal 着色器约 15 秒）、加载 180 秒，GPU 与 CPU 的卡死判定分开。

对 umuo 的含义：做最小实验时可以先在进程内加载，量出 `phys_footprint`、卸载后的回落，以及异常输入下是否会中止。如果出现中止、卸载后内存不回落，或 Metal 初始化挂起，再按 Handy 的方式拆出 helper 进程。这对应阶段 B 第四项。

## 建议的阶段 B 实验方案

1. **最小接入**：transcribe.cpp 用官方 xcframework（不用新装 cmake），放在 Swift 宿主里，做一个只在开发构建里出现的实验入口。
   umuo-app 只接收转写文本，不加载推理依赖（符合 ARCHITECTURE「平台装配归宿主」）。
2. **模型**：Qwen3-ASR-0.6B 与 SenseVoiceSmall 各测 Q8_0 与 Q4_K_M。SenseVoice 只作速度参照；是否能用于产品，等你对许可的判断。
3. **夹具**：中文、中英混说、姓名与数字、否定、自我纠正、静音、噪声各若干条，自己录制，不使用有版权的音频。
4. **测量**：在 Apple Silicon（本机）和至少一台 Intel Mac 上，记录冷/热延迟、`phys_footprint`、卸载后的内存。没有 Intel 机器时明确记为「未测」。
5. **sherpa-onnx 备选**：只有在第 4 步 Intel 或 macOS 14 不通过时才接入比较，避免同时维护两套。

## 需要你决定的事

1. 实验引擎先用 transcribe.cpp（推荐），还是两个引擎并行实验？
2. SenseVoice 的许可风险能否接受？不接受的话，它只作测速参照，不进入产品候选。
3. 模型下载来源：直接从 Hugging Face 下载（不需要我们的服务器，但国内网络可能慢或连不上），还是只对宽松许可的模型镜像到 R2？
4. 有没有可用的 Intel Mac 做实测？没有的话，Intel 一栏在首版前保持「未测」，发布说明要相应措辞。

### 2026-10-27 已定

- 下载来源：首版直接从 Hugging Face 下载，按目录里的 SHA-256 校验；是否镜像到 R2 留到发布前再定。
- 夹具：先用系统 `say` 合成，`bun run asr:fixtures` 生成到 `target/asr-fixtures/`（清单见 `scripts/asr-fixtures.ts`）；真人录音之后补。
- 引擎实测（下载 xcframework 与模型权重并在本机运行）暂缓，第 1、2、4 项待实测启动时再定。

### 2026-10-28 阶段 B 实测结果与最终选型

2026-10-28 已确认平台范围收敛为 **Apple Silicon（M 系列芯片，`arm64`）+ macOS 14+**，不再考虑 Intel。
同日通过 `scripts/asr-runner.swift` + `scripts/asr-eval.ts`（`bun run asr:eval`）完成 `transcribe.cpp` v0.4.1 与四份 GGUF 权重的本机实测。

#### 1. 测试环境与固定产物清单

- **测试机器**：Apple M2 Pro（32 GB 统一内存），macOS 27.2（Build 26B123），Metal GPU 后端（`MTL0`）。
- **引擎产物**：`TranscribeCpp.xcframework.zip` v0.4.1（`10,293,235` 字节，SHA-256 `fb5646e564036a6c49659e3efcf72eb567af20da31b8569045c9a08181d35126`，MIT，`minos 13.0`）。
- **候选模型与校验信息**：

| 模型 ID | 仓库与固定 Revision | 文件名 | 精确大小（字节） | SHA-256 | 许可与定位 |
| --- | --- | --- | --- | --- | --- |
| **qwen3-asr-0.6b-q4_k_m** | `handy-computer/Qwen3-ASR-0.6B-gguf` @ `7e7c69a5` | `Qwen3-ASR-0.6B-Q4_K_M.gguf` | `589,560,480` (562.3 MiB) | `5b58f32a58ffa2c8783e0b0963485623e286e6272d953dfc9e28bc3447dee0c0` | Apache-2.0 · **默认首选** |
| **qwen3-asr-0.6b-q8_0** | `handy-computer/Qwen3-ASR-0.6B-gguf` @ `7e7c69a5` | `Qwen3-ASR-0.6B-Q8_0.gguf` | `850,423,456` (811.0 MiB) | `f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8` | Apache-2.0 · 高精度备选 |
| sensevoice-small-q4_k_m | `handy-computer/SenseVoiceSmall-gguf` @ `ff8f085a` | `SenseVoiceSmall-Q4_K_M.gguf` | `145,738,304` (139.0 MiB) | `9d775303e6b4e793d049ef226214c400b2b1746c734ed017146a1a085b13d02b` | FunASR v1.1 · 仅速度对照 |
| sensevoice-small-q8_0 | `handy-computer/SenseVoiceSmall-gguf` @ `ff8f085a` | `SenseVoiceSmall-Q8_0.gguf` | `252,684,608` (241.0 MiB) | `6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29` | FunASR v1.1 · 仅速度对照 |

#### 2. 17 条音频夹具准确率与性能实测汇总

17 条夹具覆盖中文（简/繁）、中英混说（3 条）、姓名数字（2 条）、否定（2 条）、自我纠正（2 条）、英文、日文、3 秒纯静音、10 dB 中文噪声与 5 dB 中英混说强噪声：

| 模型 ID | 16 条语音平均误差 | 必保留词召回 | 3 秒静音无幻觉 | 模型加载 `loadWallMs` | 首条冷推理 | 17 条平均热推理（xRT） |
| --- | --- | --- | --- | --- | --- | --- |
| **qwen3-asr-0.6b-q4_k_m** | **0.67%**（15 条干净+10dB 噪声全 0%） | **35/37 (94.59%)** | ✅ `""` | 110.8 ms | 238.7 ms | **142.4 ms (30.61× RT)** |
| **qwen3-asr-0.6b-q8_0** | **0.45%**（15 条干净+10dB 噪声全 0%） | **36/37 (97.30%)** | ✅ `""` | 128.7 ms | 244.6 ms | **161.4 ms (27.32× RT)** |
| sensevoice-small-q4_k_m | 5.63% | 29/37 (78.38%) | ❌ 幻觉 `"그."` | 16.0 ms | 72.3 ms | 55.9 ms (76.56× RT) |
| sensevoice-small-q8_0 | 3.17% | 32/37 (86.49%) | ❌ 幻觉 `"그."` | 16.4 ms | 73.7 ms | 55.5 ms (77.46× RT) |

关键发现：
- **中英混说差距显著**：`Qwen3-ASR-0.6B`（`Q4_K_M` 与 `Q8_0`）在全部 3 条中英混说夹具（`PR` / `review` / `CI` / `merge` / `meeting` / `Zoom` / `slides` / `Swift` / `Rust`）上均为 **0% 误差**；而 `SenseVoiceSmall` 将 `PR` 误识为 `PER`、`CI` 误识为 `CIE`、`meeting` 误识为 `meag`、`Rust` 误识为 `rost`、`核心` 误识为 `和心`。
- **静音幻觉**：`SenseVoiceSmall` 在 3 秒纯静音（`silence-1`）下输出韩文字符 `"그."`；`Qwen3-ASR-0.6B` 稳定返回空串 `""`。
- **数字格式（ITN）**：`Qwen3-ASR-0.6B` 原生不开启 ITN，对中文数字输出汉字形式（如 `四七零二九`、`一千二百五十`、`三月十五日`），字面与发音完全一致，交由阶段 D 的 LLM 润色/翻译步骤统一规整为阿拉伯数字即可。
- **首次 Metal 着色器编译**：进程首次在机器上初始化 Metal 后端时，`ggml_metal_library_compile_all` 编译 35 个内嵌着色器库耗时约 **45 秒**；系统着色器缓存建立后，后续进程启动初始化 Metal 仅需 **40–100 ms**。因此阶段 C 首次下载模型完成后应立即执行一次后台预热加载，并在界面展示「正在初始化语音引擎…」。

#### 3. 内存生命周期（`phys_footprint`）与取消/异常验证

使用 Mach `task_info(TASK_VM_INFO).phys_footprint` 实测进程内加载与卸载：

| 模型 ID | 进程初始 | Metal 初始化后 | 模型加载后 (`mmap`) | 推理峰值 | `session_free` + `model_free` 卸载后 | 取消与同会话重试 | 空采样 / `NaN` 守卫 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **qwen3-asr-0.6b-q4_k_m** | 1.8 MB | 41.8 MB | 309.8 MB | **333.1 MB** | **108.7 MB**（回收 224.4 MB） | ✅ 0.04 ms 返回 `ABORTED(13)`，重试一致 | ✅ 返回 `INVALID_ARG(1)` 不崩溃 |
| **qwen3-asr-0.6b-q8_0** | 1.8 MB | 40.7 MB | 309.5 MB | **331.0 MB** | **106.5 MB**（回收 224.5 MB） | ✅ 0.04 ms 返回 `ABORTED(13)`，重试一致 | ✅ 返回 `INVALID_ARG(1)` 不崩溃 |
| sensevoice-small-q4_k_m | 1.7 MB | 41.3 MB | 46.5 MB | 83.0 MB | 82.7 MB | ✅ 通过 | ✅ 通过 |
| sensevoice-small-q8_0 | 1.8 MB | 41.8 MB | 47.3 MB | 83.8 MB | 85.0 MB | ✅ 通过 | ✅ 通过 |

#### 4. 最终选型与资源策略定案

1. **正式引擎**：`transcribe.cpp` v0.4.1（Swift 宿主通过 `TranscribeCpp.xcframework` 的 `CTranscribe.framework` 接入，`umuo-app` 保持平台无关、只接收转写文本并编排会话状态与后处理）。
2. **默认模型**：**`Qwen3-ASR-0.6B-Q4_K_M.gguf`**（562.3 MiB，`Apache-2.0`）。相比 `Q8_0` 节省 30.7% 下载体积（少 248.7 MiB），干净与 10 dB 噪声夹具准确率同为 100%，Apple Silicon Metal 热推理平均仅 142 ms（30.6× RT）。`SenseVoiceSmall` 因中英混说失准、静音幻觉及 FunASR 许可条款，不进入产品模型列表。
3. **进程策略（进程内加载 + 空闲卸载，不拆独立子进程）**：
   - 在 Apple Silicon 统一内存 + 默认 `mmap` 下，562 MiB 权重直接映射至 `MTL0_Mapped` 文件页，推理峰值 `phys_footprint` 仅约 **333 MB**；
   - 调用 `transcribe_session_free` + `transcribe_model_free` 后，`phys_footprint` 立即回落 ~224 MB 至 **~108 MB**，且异常输入（空音频、`NaN`）与中途 `abort` 均安全返回错误码、不触发 `GGML_ASSERT`；
   - 因此首版无需引入 Handy 的跨进程 `--transcribe-worker` IPC 复杂度，直接在 Swift 宿主内串行管理单个模型会话，配合 **空闲自动卸载计时器（如 5 分钟无语音活动自动释放模型）** 即可兼顾热响应（~140 ms）与常驻内存。

## 已核实与待补充项

- 已核实：`transcribe.cpp` v0.4.1 `CTranscribe.framework` 的 `LC_BUILD_VERSION` 为 `minos 13.0` / `sdk 15.5`，仅依赖系统框架（`Foundation`、`Metal`、`MetalKit`、`Accelerate`、`libc++`），满足 macOS 14+ 与 Apple Silicon 要求。
- 已核实：`Q4_K_M` 相对 `Q8_0` 在 15 条干净夹具与 10 dB 噪声上零差异，仅在 5 dB 强噪声混说下多错 1 个词（10.71% vs 7.14%）。
- 待阶段 C 接入麦克风后补充：真人麦克风口述采样验证。
