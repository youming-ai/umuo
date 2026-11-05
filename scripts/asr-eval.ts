import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FIXTURES, type Fixture } from './asr-fixtures'

/**
 * 阶段 B 本地转写引擎与模型评测工具。
 * - 固定 transcribe.cpp v0.4.1 官方预编译 xcframework 及模型 revision / 文件大小 / SHA-256
 * - 提供下载完整性校验（.partial + 字节数 + SHA-256）、CER/WER 与必保留词评分
 * - 驱动 scripts/asr-runner.swift 测量冷/热延迟、取消重试、异常输入守卫与 Mach phys_footprint
 */

export interface EngineArtifact {
  name: string
  version: string
  url: string
  sizeBytes: number
  sha256: string
  license: string
  minMacOS: string
}

export interface CandidateModel {
  id: string
  variant: string
  quant: 'Q4_K_M' | 'Q8_0'
  repo: string
  revision: string
  filename: string
  sizeBytes: number
  sha256: string
  license: string
  role: 'product-candidate' | 'speed-reference-only'
}

export const ENGINE_ARTIFACT: EngineArtifact = {
  name: 'transcribe.cpp (TranscribeCpp.xcframework)',
  version: '0.4.1',
  url: 'https://github.com/handy-computer/transcribe.cpp/releases/download/v0.4.1/TranscribeCpp.xcframework.zip',
  sizeBytes: 10_293_235,
  sha256: 'fb5646e564036a6c49659e3efcf72eb567af20da31b8569045c9a08181d35126',
  license: 'MIT',
  minMacOS: '13.0',
}

export const CANDIDATE_MODELS: CandidateModel[] = [
  {
    id: 'qwen3-asr-0.6b-q4_k_m',
    variant: 'qwen3-asr-0.6b',
    quant: 'Q4_K_M',
    repo: 'handy-computer/Qwen3-ASR-0.6B-gguf',
    revision: '7e7c69a577fa2725dfedbe34b5e999336e30a19b',
    filename: 'Qwen3-ASR-0.6B-Q4_K_M.gguf',
    sizeBytes: 589_560_480,
    sha256: '5b58f32a58ffa2c8783e0b0963485623e286e6272d953dfc9e28bc3447dee0c0',
    license: 'Apache-2.0',
    role: 'product-candidate',
  },
  {
    id: 'qwen3-asr-0.6b-q8_0',
    variant: 'qwen3-asr-0.6b',
    quant: 'Q8_0',
    repo: 'handy-computer/Qwen3-ASR-0.6B-gguf',
    revision: '7e7c69a577fa2725dfedbe34b5e999336e30a19b',
    filename: 'Qwen3-ASR-0.6B-Q8_0.gguf',
    sizeBytes: 850_423_456,
    sha256: 'f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8',
    license: 'Apache-2.0',
    role: 'product-candidate',
  },
  {
    id: 'sensevoice-small-q4_k_m',
    variant: 'sensevoice-small',
    quant: 'Q4_K_M',
    repo: 'handy-computer/SenseVoiceSmall-gguf',
    revision: 'ff8f085a8fa2e5ccae0e849ef19ebc6dc18e608b',
    filename: 'SenseVoiceSmall-Q4_K_M.gguf',
    sizeBytes: 145_738_304,
    sha256: '9d775303e6b4e793d049ef226214c400b2b1746c734ed017146a1a085b13d02b',
    license: 'FunASR-MODEL-LICENSE-1.1',
    role: 'speed-reference-only',
  },
  {
    id: 'sensevoice-small-q8_0',
    variant: 'sensevoice-small',
    quant: 'Q8_0',
    repo: 'handy-computer/SenseVoiceSmall-gguf',
    revision: 'ff8f085a8fa2e5ccae0e849ef19ebc6dc18e608b',
    filename: 'SenseVoiceSmall-Q8_0.gguf',
    sizeBytes: 252_684_608,
    sha256: '6c759ee4c9748c9b3f7a5a60ca74f0f7e685fb9d45d1378fce7cfd62f59adf29',
    license: 'FunASR-MODEL-LICENSE-1.1',
    role: 'speed-reference-only',
  },
]

export function hfResolveUrl(
  model: Pick<CandidateModel, 'repo' | 'revision' | 'filename'>,
): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.filename}`
}

/** 校验本地文件的精确字节大小与 SHA-256。 */
export async function verifyFileIntegrity(
  filePath: string,
  expectedSizeBytes: number,
  expectedSha256: string,
): Promise<{ ok: boolean; actualSizeBytes: number; actualSha256: string; reason?: string }> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(filePath)
  } catch {
    return { ok: false, actualSizeBytes: 0, actualSha256: '', reason: '文件不存在' }
  }
  if (info.size !== expectedSizeBytes) {
    return {
      ok: false,
      actualSizeBytes: info.size,
      actualSha256: '',
      reason: `文件大小不匹配：期望 ${expectedSizeBytes}，实际 ${info.size}`,
    }
  }
  const hasher = new Bun.CryptoHasher('sha256')
  const reader = Bun.file(filePath).stream().getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    hasher.update(value)
  }
  const actualSha256 = hasher.digest('hex').toLowerCase()
  const targetSha256 = expectedSha256.toLowerCase()
  if (actualSha256 !== targetSha256) {
    return {
      ok: false,
      actualSizeBytes: info.size,
      actualSha256,
      reason: `SHA-256 不匹配：期望 ${targetSha256}，实际 ${actualSha256}`,
    }
  }
  return { ok: true, actualSizeBytes: info.size, actualSha256 }
}

/** CJK / 混说字级归一化：NFKC、小写、去标点与符号、去全部空白。 */
export function normalizeForCer(text: string): string[] {
  const cleaned = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
  return Array.from(cleaned)
}

/** 英文词级归一化：NFKC、小写、标点转空格、按空白切词。 */
export function normalizeForWer(text: string): string[] {
  const cleaned = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .trim()
  return cleaned ? cleaned.split(/\s+/u) : []
}

export function editDistance(refTokens: string[], hypTokens: string[]): number {
  const n = refTokens.length
  const m = hypTokens.length
  const stride = m + 1
  const dp = new Int32Array((n + 1) * stride)
  for (let i = 0; i <= n; i++) dp[i * stride] = i
  for (let j = 0; j <= m; j++) dp[j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = refTokens[i - 1] === hypTokens[j - 1] ? 0 : 1
      const del = (dp[(i - 1) * stride + j] ?? 0) + 1
      const ins = (dp[i * stride + (j - 1)] ?? 0) + 1
      const sub = (dp[(i - 1) * stride + (j - 1)] ?? 0) + cost
      dp[i * stride + j] = Math.min(del, ins, sub)
    }
  }
  return dp[n * stride + m] ?? 0
}

const HAN_VARIANT_MAP: Record<string, string> = {
  這: '这',
  請: '请',
  後: '后',
  覆: '复',
  個: '个',
  議: '议',
  討: '讨',
  論: '论',
  預: '预',
  報: '报',
  週: '周',
  張: '张',
  偉: '伟',
  訂: '订',
  單: '单',
  號: '号',
  額: '额',
  點: '点',
  達: '达',
  題: '题',
  還: '还',
  決: '决',
  閉: '闭',
  數: '数',
}

function foldHanVariants(text: string): string {
  return Array.from(text, (ch) => HAN_VARIANT_MAP[ch] ?? ch).join('')
}

export interface TranscriptScore {
  metric: 'CER' | 'WER' | 'SILENCE'
  distance: number
  refLength: number
  errPct: number
  writtenErrPct: number
  keepMatched: number
  keepTotal: number
  keepPassed: boolean
  missingKeepGroups: string[][]
}

export function scoreTranscript(
  fixture: Pick<Fixture, 'kind' | 'reference' | 'keep'> & { say?: string },
  hypothesis: string,
): TranscriptScore {
  if (fixture.kind === 'silence') {
    const hypTokens = normalizeForCer(hypothesis)
    return {
      metric: 'SILENCE',
      distance: hypTokens.length,
      refLength: 0,
      errPct: hypTokens.length === 0 ? 0 : 100,
      writtenErrPct: hypTokens.length === 0 ? 0 : 100,
      keepMatched: 0,
      keepTotal: 0,
      keepPassed: hypTokens.length === 0,
      missingKeepGroups: [],
    }
  }

  const isEn = fixture.kind === 'en'
  const refTokens = isEn
    ? normalizeForWer(fixture.reference)
    : normalizeForCer(foldHanVariants(fixture.reference))
  const hypTokens = isEn
    ? normalizeForWer(hypothesis)
    : normalizeForCer(foldHanVariants(hypothesis))
  const writtenDistance = editDistance(refTokens, hypTokens)
  const writtenErrPct = refTokens.length > 0 ? (writtenDistance / refTokens.length) * 100 : 0

  let bestDistance = writtenDistance
  let bestRefLen = refTokens.length
  let bestErrPct = writtenErrPct

  if (fixture.say && fixture.say !== fixture.reference) {
    const sayTokens = isEn
      ? normalizeForWer(fixture.say)
      : normalizeForCer(foldHanVariants(fixture.say))
    const sayDist = editDistance(sayTokens, hypTokens)
    const sayErrPct = sayTokens.length > 0 ? (sayDist / sayTokens.length) * 100 : 0
    if (sayErrPct < bestErrPct) {
      bestDistance = sayDist
      bestRefLen = sayTokens.length
      bestErrPct = sayErrPct
    }
  }

  const normHyp = foldHanVariants(hypothesis.normalize('NFKC').toLowerCase()).replace(/\s+/gu, '')
  const missingKeepGroups: string[][] = []
  let keepMatched = 0
  for (const group of fixture.keep) {
    const matched = group.some((candidate) => {
      const normCand = foldHanVariants(candidate.normalize('NFKC').toLowerCase()).replace(
        /\s+/gu,
        '',
      )
      return normHyp.includes(normCand)
    })
    if (matched) {
      keepMatched += 1
    } else {
      missingKeepGroups.push(group)
    }
  }

  return {
    metric: isEn ? 'WER' : 'CER',
    distance: bestDistance,
    refLength: bestRefLen,
    errPct: Number(bestErrPct.toFixed(2)),
    writtenErrPct: Number(writtenErrPct.toFixed(2)),
    keepMatched,
    keepTotal: fixture.keep.length,
    keepPassed: missingKeepGroups.length === 0,
    missingKeepGroups,
  }
}

/** 按 `--models=a,b` 筛选候选模型；不带该参数时评测全部。 */
export function selectModels(args: string[]): CandidateModel[] {
  const modelFilterArg = args.find((a) => a.startsWith('--models='))?.slice('--models='.length)
  const selectedIds = modelFilterArg
    ? new Set(modelFilterArg.split(',').map((s) => s.trim()))
    : null
  return selectedIds ? CANDIDATE_MODELS.filter((m) => selectedIds.has(m.id)) : CANDIDATE_MODELS
}

export async function downloadFileWithVerify(
  url: string,
  destPath: string,
  expectedSizeBytes: number,
  expectedSha256: string,
): Promise<{ downloadedFromNetwork: boolean; verifyMs: number }> {
  const t0 = performance.now()
  const existing = await verifyFileIntegrity(destPath, expectedSizeBytes, expectedSha256)
  if (existing.ok) {
    return { downloadedFromNetwork: false, verifyMs: Number((performance.now() - t0).toFixed(1)) }
  }

  const partialPath = `${destPath}.partial`
  console.log(`下载: ${url} -> ${partialPath}`)
  const proc = Bun.spawn(['curl', '-fL', '-C', '-', '--retry', '3', '-o', partialPath, url], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await proc.exited) !== 0) {
    throw new Error(`下载失败: ${url}`)
  }

  const v0 = performance.now()
  const check = await verifyFileIntegrity(partialPath, expectedSizeBytes, expectedSha256)
  const verifyMs = Number((performance.now() - v0).toFixed(1))
  if (!check.ok) {
    await rm(partialPath, { force: true })
    throw new Error(`下载校验未通过 (${destPath}): ${check.reason}`)
  }
  await rename(partialPath, destPath)
  return { downloadedFromNetwork: true, verifyMs }
}

async function main(): Promise<void> {
  const rootDir = join(import.meta.dir, '..')
  const evalDir = join(rootDir, 'target', 'asr-eval')
  const modelsDir = join(evalDir, 'models')
  const fixturesDir = join(rootDir, 'target', 'asr-fixtures')
  await mkdir(modelsDir, { recursive: true })

  // 1. 确保夹具已生成
  try {
    await stat(join(fixturesDir, 'manifest.json'))
  } catch {
    console.log('生成合成音频夹具...')
    const gen = Bun.spawn(['bun', 'run', join(import.meta.dir, 'asr-fixtures.ts')], {
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if ((await gen.exited) !== 0) throw new Error('生成音频夹具失败')
  }

  // 2. 确保 TranscribeCpp.xcframework.zip 已下载并校验 SHA-256
  const xcfZip = join(evalDir, 'TranscribeCpp.xcframework.zip')
  await downloadFileWithVerify(
    ENGINE_ARTIFACT.url,
    xcfZip,
    ENGINE_ARTIFACT.sizeBytes,
    ENGINE_ARTIFACT.sha256,
  )
  const frameworkDir = join(evalDir, 'TranscribeCpp.xcframework', 'macos-arm64_x86_64')
  try {
    await stat(join(frameworkDir, 'CTranscribe.framework'))
  } catch {
    const unzip = Bun.spawn(['unzip', '-q', '-o', xcfZip, '-d', evalDir], {
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if ((await unzip.exited) !== 0) throw new Error('解压 TranscribeCpp.xcframework.zip 失败')
  }

  // 3. 编译 scripts/asr-runner.swift
  const runnerBin = join(evalDir, 'asr-runner')
  const compile = Bun.spawn(
    [
      'swiftc',
      '-O',
      join(import.meta.dir, 'asr-runner.swift'),
      '-F',
      frameworkDir,
      '-framework',
      'CTranscribe',
      '-Xlinker',
      '-rpath',
      '-Xlinker',
      frameworkDir,
      '-o',
      runnerBin,
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  if ((await compile.exited) !== 0) throw new Error('编译 asr-runner 失败')

  // 4. 解析模型筛选参数
  const models = selectModels(process.argv.slice(2))

  const fixtureMap = new Map(FIXTURES.map((f) => [f.id, f]))
  const modelResults = []

  for (const model of models) {
    const modelPath = join(modelsDir, model.filename)
    const url = hfResolveUrl(model)
    const dlInfo = await downloadFileWithVerify(url, modelPath, model.sizeBytes, model.sha256)

    console.log(`\n=== 运行评测: ${model.id} (${model.quant}, ${model.role}) ===`)
    const proc = Bun.spawn([runnerBin, '--model', modelPath, '--fixtures', fixturesDir], {
      stdout: 'pipe',
      stderr: 'inherit',
    })
    if ((await proc.exited) !== 0) {
      throw new Error(`asr-runner 执行失败: ${model.id}`)
    }
    const rawJson = await new Response(proc.stdout).text()
    const runOutput = JSON.parse(rawJson)

    const scoredFixtures = runOutput.warmRuns.map(
      (run: {
        id: string
        text: string
        wallMs: number
        xrt: number
        audioDurationS: number
        detectedLanguage: string
      }) => {
        const fixture = fixtureMap.get(run.id)
        if (!fixture) throw new Error(`未知夹具: ${run.id}`)
        const score = scoreTranscript(fixture, run.text)
        return {
          ...run,
          reference: fixture.reference,
          score,
        }
      },
    )

    const speechRuns = scoredFixtures.filter((r: { kind: string }) => r.kind !== 'silence')
    const avgErrPct =
      speechRuns.reduce((acc: number, r: { score: TranscriptScore }) => acc + r.score.errPct, 0) /
      speechRuns.length
    const avgWrittenErrPct =
      speechRuns.reduce(
        (acc: number, r: { score: TranscriptScore }) => acc + r.score.writtenErrPct,
        0,
      ) / speechRuns.length
    const totalKeepMatched = speechRuns.reduce(
      (acc: number, r: { score: TranscriptScore }) => acc + r.score.keepMatched,
      0,
    )
    const totalKeep = speechRuns.reduce(
      (acc: number, r: { score: TranscriptScore }) => acc + r.score.keepTotal,
      0,
    )
    const avgWarmWallMs =
      scoredFixtures.reduce((acc: number, r: { wallMs: number }) => acc + r.wallMs, 0) /
      scoredFixtures.length
    const avgXrt =
      scoredFixtures.reduce((acc: number, r: { xrt: number }) => acc + r.xrt, 0) /
      scoredFixtures.length

    modelResults.push({
      model,
      downloadVerifyMs: dlInfo.verifyMs,
      summary: {
        avgSpeechErrPct: Number(avgErrPct.toFixed(2)),
        avgWrittenErrPct: Number(avgWrittenErrPct.toFixed(2)),
        keepMatched: totalKeepMatched,
        keepTotal: totalKeep,
        keepRecallPct: Number(((totalKeepMatched / totalKeep) * 100).toFixed(2)),
        silenceClean:
          scoredFixtures.find((r: { id: string }) => r.id === 'silence-1')?.score.errPct === 0,
        backendInitWallMs: Number(runOutput.backendInitWallMs.toFixed(1)),
        loadWallMs: Number(runOutput.loadWallMs.toFixed(1)),
        coldFirstWallMs: Number(runOutput.coldFirstRun.wallMs.toFixed(1)),
        avgWarmWallMs: Number(avgWarmWallMs.toFixed(1)),
        avgXrt: Number(avgXrt.toFixed(2)),
        processEntryFootprintMB: Number((runOutput.memory.processEntryBytes / 1048576).toFixed(1)),
        baselineFootprintMB: Number((runOutput.memory.baselineBytes / 1048576).toFixed(1)),
        loadedFootprintMB: Number((runOutput.memory.loadedBytes / 1048576).toFixed(1)),
        peakFootprintMB: Number((runOutput.memory.peakBytes / 1048576).toFixed(1)),
        unloadedFootprintMB: Number((runOutput.memory.unloadedBytes / 1048576).toFixed(1)),
        cancelOk:
          runOutput.cancelRetry.abortStatus === 13 &&
          runOutput.cancelRetry.wasAbortedFlag === true &&
          runOutput.cancelRetry.retryStatus === 0 &&
          runOutput.cancelRetry.retryMatchesWarm === true,
        edgeGuardsOk:
          runOutput.edgeInput.emptySamplesStatus === 1 && runOutput.edgeInput.nanSampleStatus === 1,
      },
      raw: runOutput,
      scoredFixtures,
    })
  }

  const outPath = join(evalDir, 'results.json')
  await writeFile(
    outPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), engine: ENGINE_ARTIFACT, results: modelResults }, null, 2)}\n`,
  )
  console.log(`\n评测结果已写入: ${outPath}`)
  for (const res of modelResults) {
    console.log(
      `- ${res.model.id}: 平均误差=${res.summary.avgSpeechErrPct}%, 必保留词=${res.summary.keepMatched}/${res.summary.keepTotal} (${res.summary.keepRecallPct}%), 加载=${res.summary.loadWallMs}ms, 首条冷推理=${res.summary.coldFirstWallMs}ms, 平均热推理=${res.summary.avgWarmWallMs}ms (${res.summary.avgXrt}xRT), 峰值内存=${res.summary.peakFootprintMB}MB -> 卸载后=${res.summary.unloadedFootprintMB}MB, 取消重试=${res.summary.cancelOk}`,
    )
  }
}

if (import.meta.main) await main()
