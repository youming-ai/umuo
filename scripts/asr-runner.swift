import CTranscribe
import Darwin
import Foundation

/// 阶段 B 本地转写实验原生运行器（仅开发实验使用，不打入正式客户端）。
/// 链接官方预编译 TranscribeCpp.xcframework，在同一进程内测量：
/// - 模型加载耗时、capabilities 与 session limits
/// - 首条冷启动时延 vs 17 条夹具热启动时延（mel / encode / decode / wall / xRT）
/// - 取消回调（TRANSCRIBE_ERR_ABORTED）与同会话重试恢复
/// - 异常输入（空采样、NaN）的错误返回（验证不触发 GGML_ASSERT 崩溃）
/// - 加载前、加载后、推理峰值、卸载后的 Mach task_vm_info.phys_footprint

struct ManifestItem: Decodable {
    let id: String
    let file: String
    let kind: String
    let reference: String
}

struct DeviceReport: Encodable {
    let name: String
    let description: String
    let kind: String
    let memoryTotalBytes: UInt64
    let memoryFreeBytes: UInt64
}

struct FixtureRunReport: Encodable {
    let id: String
    let kind: String
    let audioDurationS: Double
    let status: Int32
    let statusName: String
    let text: String
    let rawText: String
    let detectedLanguage: String
    let wallMs: Double
    let melMs: Double
    let encodeMs: Double
    let decodeMs: Double
    let xrt: Double
    let footprintBytes: UInt64
}

struct CancelRetryReport: Encodable {
    let abortStatus: Int32
    let abortStatusName: String
    let wasAbortedFlag: Bool
    let abortLatencyMs: Double
    let retryStatus: Int32
    let retryText: String
    let retryMatchesWarm: Bool
}

struct EdgeInputReport: Encodable {
    let emptySamplesStatus: Int32
    let nanSampleStatus: Int32
}

struct MemoryReport: Encodable {
    let processEntryBytes: UInt64
    let baselineBytes: UInt64
    let loadedBytes: UInt64
    let coldRunBytes: UInt64
    let peakBytes: UInt64
    let unloadedBytes: UInt64
}

struct EvalRunOutput: Encodable {
    let engineVersion: String
    let modelPath: String
    let requestedBackend: String
    let activeBackend: String
    let arch: String
    let variant: String
    let nativeSampleRate: Int32
    let maxAudioMs: Int64
    let effectiveNCtx: Int32
    let effectiveMaxAudioMs: Int64
    let maxKvBytes: Int64
    let supportsLanguageDetect: Bool
    let supportsStreaming: Bool
    let supportsCancellation: Bool
    let devices: [DeviceReport]
    let backendInitWallMs: Double
    let loadWallMs: Double
    let loadInternalMs: Double
    let coldFirstRun: FixtureRunReport
    let warmRuns: [FixtureRunReport]
    let cancelRetry: CancelRetryReport
    let edgeInput: EdgeInputReport
    let memory: MemoryReport
}

func currentPhysFootprintBytes() -> UInt64 {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
        MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size
    )
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
    }
    return kr == KERN_SUCCESS ? UInt64(info.phys_footprint) : 0
}

func nowMs() -> Double {
    var ts = timespec()
    clock_gettime(CLOCK_MONOTONIC, &ts)
    return Double(ts.tv_sec) * 1000.0 + Double(ts.tv_nsec) / 1_000_000.0
}

func loadWavFloat32(url: URL) throws -> (sampleRate: Int, samples: [Float]) {
    let data = try Data(contentsOf: url)
    guard data.count >= 44 else {
        throw NSError(domain: "asr-runner", code: 1, userInfo: [NSLocalizedDescriptionKey: "WAV 太短"])
    }
    return try data.withUnsafeBytes { raw -> (Int, [Float]) in
        let bytes = raw.bindMemory(to: UInt8.self)
        func tag(_ offset: Int) -> String {
            String(bytes: bytes[offset ..< offset + 4], encoding: .ascii) ?? ""
        }
        func u16(_ offset: Int) -> UInt16 {
            UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
        }
        func u32(_ offset: Int) -> UInt32 {
            UInt32(bytes[offset])
                | (UInt32(bytes[offset + 1]) << 8)
                | (UInt32(bytes[offset + 2]) << 16)
                | (UInt32(bytes[offset + 3]) << 24)
        }
        func i16(_ offset: Int) -> Int16 {
            Int16(bitPattern: u16(offset))
        }
        guard tag(0) == "RIFF", tag(8) == "WAVE" else {
            throw NSError(domain: "asr-runner", code: 2, userInfo: [NSLocalizedDescriptionKey: "非 RIFF/WAVE"])
        }
        var sampleRate = 0
        var at = 12
        while at + 8 <= bytes.count {
            let chunkId = tag(at)
            let size = Int(u32(at + 4))
            let body = at + 8
            if chunkId == "fmt " {
                let format = u16(body)
                let channels = u16(body + 2)
                let bits = u16(body + 14)
                guard format == 1, channels == 1, bits == 16 else {
                    throw NSError(domain: "asr-runner", code: 3, userInfo: [NSLocalizedDescriptionKey: "仅支持单声道 16-bit PCM"])
                }
                sampleRate = Int(u32(body + 4))
            } else if chunkId == "data" {
                let count = min(size, bytes.count - body) / 2
                var pcm = [Float](repeating: 0, count: count)
                for i in 0 ..< count {
                    pcm[i] = Float(i16(body + i * 2)) / 32768.0
                }
                return (sampleRate, pcm)
            }
            at = body + size + (size & 1)
        }
        throw NSError(domain: "asr-runner", code: 4, userInfo: [NSLocalizedDescriptionKey: "缺少 data 块"])
    }
}

final class AbortBox {
    var shouldAbort: Bool
    init(shouldAbort: Bool) {
        self.shouldAbort = shouldAbort
    }
}

private let abortTrampoline: transcribe_abort_callback = { userData in
    guard let userData else { return false }
    let box = Unmanaged<AbortBox>.fromOpaque(userData).takeUnretainedValue()
    return box.shouldAbort
}

func runSingle(
    session: OpaquePointer,
    item: ManifestItem,
    pcm: [Float],
    sampleRate: Int
) -> FixtureRunReport {
    var runParams = transcribe_run_params()
    transcribe_run_params_init(&runParams)
    transcribe_reset_timings(session)

    let t0 = nowMs()
    let status = pcm.withUnsafeBufferPointer { buf in
        transcribe_run(session, buf.baseAddress, Int32(buf.count), &runParams)
    }
    let wallMs = nowMs() - t0

    var timings = transcribe_timings()
    transcribe_timings_init(&timings)
    _ = transcribe_get_timings(session, &timings)

    let text = String(cString: transcribe_full_text(session))
    let rawText = String(cString: transcribe_raw_text(session))
    let detected = String(cString: transcribe_detected_language(session))
    let statusName = String(cString: transcribe_status_string(Int32(status.rawValue)))
    let durationS = Double(pcm.count) / Double(sampleRate)
    let xrt = wallMs > 0 ? durationS / (wallMs / 1000.0) : 0
    let fp = currentPhysFootprintBytes()

    return FixtureRunReport(
        id: item.id,
        kind: item.kind,
        audioDurationS: durationS,
        status: Int32(status.rawValue),
        statusName: statusName,
        text: text,
        rawText: rawText,
        detectedLanguage: detected,
        wallMs: wallMs,
        melMs: Double(timings.mel_ms),
        encodeMs: Double(timings.encode_ms),
        decodeMs: Double(timings.decode_ms),
        xrt: xrt,
        footprintBytes: fp
    )
}

func parseArgs() -> (modelPath: String, fixturesDir: String, backend: String, noMmap: Bool) {
    var modelPath = ""
    var fixturesDir = "target/asr-fixtures"
    var backend = "auto"
    var noMmap = false
    let args = CommandLine.arguments
    var i = 1
    while i < args.count {
        switch args[i] {
        case "--model":
            i += 1
            if i < args.count { modelPath = args[i] }
        case "--fixtures":
            i += 1
            if i < args.count { fixturesDir = args[i] }
        case "--backend":
            i += 1
            if i < args.count { backend = args[i] }
        case "--no-mmap":
            noMmap = true
        default:
            break
        }
        i += 1
    }
    guard !modelPath.isEmpty else {
        fputs("用法: asr-runner --model <gguf> [--fixtures <dir>] [--backend auto|metal|cpu] [--no-mmap]\n", stderr)
        exit(2)
    }
    return (modelPath, fixturesDir, backend, noMmap)
}

let opts = parseArgs()
let processEntryFootprint = currentPhysFootprintBytes()
let backendInitStart = nowMs()
_ = transcribe_init_backends_default()

let version = String(cString: transcribe_version())
var devices: [DeviceReport] = []
let devCount = transcribe_device_count()
for idx in 0 ..< devCount {
    if let dev = transcribe_device_get(idx) {
        var info = transcribe_device_info()
        transcribe_device_info_init(&info)
        if transcribe_device_get_info(dev, &info) == TRANSCRIBE_OK {
            devices.append(
                DeviceReport(
                    name: info.name.map { String(cString: $0) } ?? "",
                    description: info.description.map { String(cString: $0) } ?? "",
                    kind: info.kind.map { String(cString: $0) } ?? "",
                    memoryTotalBytes: info.memory_total,
                    memoryFreeBytes: info.memory_free
                )
            )
        }
    }
}
let backendInitWallMs = nowMs() - backendInitStart

let fixturesURL = URL(fileURLWithPath: opts.fixturesDir)
let manifestData = try Data(contentsOf: fixturesURL.appendingPathComponent("manifest.json"))
let manifest = try JSONDecoder().decode([ManifestItem].self, from: manifestData)

var audioMap: [String: (sampleRate: Int, samples: [Float])] = [:]
for item in manifest {
    let wavURL = fixturesURL.appendingPathComponent(item.file)
    audioMap[item.id] = try loadWavFloat32(url: wavURL)
}

let baselineFootprint = currentPhysFootprintBytes()

var loadParams = transcribe_model_load_params()
transcribe_model_load_params_init(&loadParams)
switch opts.backend.lowercased() {
case "metal":
    loadParams.backend = TRANSCRIBE_BACKEND_METAL
case "cpu":
    loadParams.backend = TRANSCRIBE_BACKEND_CPU
case "cpu_accel":
    loadParams.backend = TRANSCRIBE_BACKEND_CPU_ACCEL
default:
    loadParams.backend = TRANSCRIBE_BACKEND_AUTO
}
loadParams.no_mmap = opts.noMmap

let loadStart = nowMs()
var model: OpaquePointer?
let loadStatus = transcribe_model_load_file(opts.modelPath, &loadParams, &model)
guard loadStatus == TRANSCRIBE_OK, let loadedModel = model else {
    let msg = String(cString: transcribe_status_string(Int32(loadStatus.rawValue)))
    fputs("模型加载失败: \(msg) (\(loadStatus.rawValue))\n", stderr)
    exit(1)
}

var sessionParams = transcribe_session_params()
transcribe_session_params_init(&sessionParams)
var sessionPtr: OpaquePointer?
let sessStatus = transcribe_session_init(loadedModel, &sessionParams, &sessionPtr)
guard sessStatus == TRANSCRIBE_OK, let session = sessionPtr else {
    let msg = String(cString: transcribe_status_string(Int32(sessStatus.rawValue)))
    fputs("会话初始化失败: \(msg) (\(sessStatus.rawValue))\n", stderr)
    transcribe_model_free(loadedModel)
    exit(1)
}
let loadWallMs = nowMs() - loadStart
let loadedFootprint = currentPhysFootprintBytes()

var initTimings = transcribe_timings()
transcribe_timings_init(&initTimings)
_ = transcribe_get_timings(session, &initTimings)

let activeBackend = String(cString: transcribe_model_backend(loadedModel))
let arch = String(cString: transcribe_model_arch_string(loadedModel))
let variant = String(cString: transcribe_model_variant_string(loadedModel))

var caps = transcribe_capabilities()
transcribe_capabilities_init(&caps)
_ = transcribe_model_get_capabilities(loadedModel, &caps)

var limits = transcribe_session_limits()
transcribe_session_limits_init(&limits)
_ = transcribe_session_get_limits(session, &limits)

let supportsCancellation = transcribe_model_supports(loadedModel, TRANSCRIBE_FEATURE_CANCELLATION)

// 1. 首条冷启动推理（使用第一条夹具 zh-plain-1）
let firstItem = manifest[0]
let firstAudio = audioMap[firstItem.id]!
let coldReport = runSingle(
    session: session,
    item: firstItem,
    pcm: firstAudio.samples,
    sampleRate: firstAudio.sampleRate
)
let coldRunFootprint = currentPhysFootprintBytes()
var peakFootprint = max(loadedFootprint, coldRunFootprint)

// 2. 全部 17 条夹具热启动推理
var warmReports: [FixtureRunReport] = []
for item in manifest {
    let audio = audioMap[item.id]!
    let report = runSingle(
        session: session,
        item: item,
        pcm: audio.samples,
        sampleRate: audio.sampleRate
    )
    peakFootprint = max(peakFootprint, report.footprintBytes)
    warmReports.append(report)
}

// 3. 取消与同会话重试验证
let abortBox = AbortBox(shouldAbort: true)
let abortPtr = Unmanaged.passUnretained(abortBox).toOpaque()
transcribe_set_abort_callback(session, abortTrampoline, abortPtr)

var cancelParams = transcribe_run_params()
transcribe_run_params_init(&cancelParams)
let abortStart = nowMs()
let abortStatus = firstAudio.samples.withUnsafeBufferPointer { buf in
    transcribe_run(session, buf.baseAddress, Int32(buf.count), &cancelParams)
}
let abortLatencyMs = nowMs() - abortStart
let wasAbortedFlag = transcribe_was_aborted(session)

abortBox.shouldAbort = false
transcribe_set_abort_callback(session, nil, nil)
let retryReport = runSingle(
    session: session,
    item: firstItem,
    pcm: firstAudio.samples,
    sampleRate: firstAudio.sampleRate
)

let cancelRetry = CancelRetryReport(
    abortStatus: Int32(abortStatus.rawValue),
    abortStatusName: String(cString: transcribe_status_string(Int32(abortStatus.rawValue))),
    wasAbortedFlag: wasAbortedFlag,
    abortLatencyMs: abortLatencyMs,
    retryStatus: retryReport.status,
    retryText: retryReport.text,
    retryMatchesWarm: retryReport.text == warmReports[0].text
)

// 4. 异常输入守卫验证（空采样与 NaN）
let emptyStatus = firstAudio.samples.withUnsafeBufferPointer { buf in
    transcribe_run(session, buf.baseAddress, 0, &cancelParams)
}
let nanSamples: [Float] = [Float.nan, 0.0, 0.1]
let nanStatus = nanSamples.withUnsafeBufferPointer { buf in
    transcribe_run(session, buf.baseAddress, Int32(buf.count), &cancelParams)
}
let edgeInput = EdgeInputReport(
    emptySamplesStatus: Int32(emptyStatus.rawValue),
    nanSampleStatus: Int32(nanStatus.rawValue)
)

// 5. 卸载会话与模型并测量内存回落
transcribe_session_free(session)
transcribe_model_free(loadedModel)
let unloadedFootprint = currentPhysFootprintBytes()

let output = EvalRunOutput(
    engineVersion: version,
    modelPath: opts.modelPath,
    requestedBackend: opts.backend,
    activeBackend: activeBackend,
    arch: arch,
    variant: variant,
    nativeSampleRate: caps.native_sample_rate,
    maxAudioMs: caps.max_audio_ms,
    effectiveNCtx: limits.effective_n_ctx,
    effectiveMaxAudioMs: limits.effective_max_audio_ms,
    maxKvBytes: limits.max_kv_bytes,
    supportsLanguageDetect: caps.supports_language_detect,
    supportsStreaming: caps.supports_streaming,
    supportsCancellation: supportsCancellation,
    devices: devices,
    backendInitWallMs: backendInitWallMs,
    loadWallMs: loadWallMs,
    loadInternalMs: Double(initTimings.load_ms),
    coldFirstRun: coldReport,
    warmRuns: warmReports,
    cancelRetry: cancelRetry,
    edgeInput: edgeInput,
    memory: MemoryReport(
        processEntryBytes: processEntryFootprint,
        baselineBytes: baselineFootprint,
        loadedBytes: loadedFootprint,
        coldRunBytes: coldRunFootprint,
        peakBytes: peakFootprint,
        unloadedBytes: unloadedFootprint
    )
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let jsonData = try encoder.encode(output)
FileHandle.standardOutput.write(jsonData)
FileHandle.standardOutput.write(Data("\n".utf8))
