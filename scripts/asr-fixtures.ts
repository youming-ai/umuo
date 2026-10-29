import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 阶段 B 转写实验的音频夹具：用系统 `say` 合成，16 kHz 单声道 16-bit WAV。
 * 合成语音不是真人口音，只用来跑通流程和做可复现的横向比较；真人录音另行补充。
 * 产物写到 target/asr-fixtures/（不提交），清单里的期望文本与必保留词随脚本版本固定。
 */

export const SAMPLE_RATE = 16_000

export type Fixture = {
  id: string
  /** 测的是哪一类：对应 IMPLEMENTATION-PLAN 阶段 B 第二项。 */
  kind:
    | 'zh'
    | 'mixed'
    | 'names-numbers'
    | 'negation'
    | 'self-correction'
    | 'en'
    | 'ja'
    | 'silence'
    | 'noise'
  /** 期望的书面转写；静音为空串。 */
  reference: string
  /** 语义上必须保留的词，每组任一写法出现即算保留（如「500」或「五百」）。 */
  keep: string[][]
} & ({ voice: string; say: string } | { silenceSeconds: number } | { base: string; snrDb: number })

export const FIXTURES: Fixture[] = [
  {
    id: 'zh-plain-1',
    kind: 'zh',
    voice: 'Tingting',
    say: '今天下午三点在会议室讨论下个季度的预算安排。',
    reference: '今天下午三点在会议室讨论下个季度的预算安排。',
    keep: [['预算']],
  },
  {
    id: 'zh-plain-2',
    kind: 'zh',
    voice: 'Tingting',
    say: '麻烦把这份报告整理一下，周五之前发给我。',
    reference: '麻烦把这份报告整理一下，周五之前发给我。',
    keep: [['周五']],
  },
  {
    id: 'zh-hant-1',
    kind: 'zh',
    voice: 'Meijia',
    say: '這份文件請在明天中午前回覆。',
    reference: '這份文件請在明天中午前回覆。',
    keep: [['明天'], ['中午']],
  },
  {
    id: 'mixed-1',
    kind: 'mixed',
    voice: 'Tingting',
    say: '这个 PR 我已经 review 过了，等 CI 通过就可以 merge。',
    reference: '这个PR我已经review过了，等CI通过就可以merge。',
    keep: [['PR'], ['review'], ['CI'], ['merge']],
  },
  {
    id: 'mixed-2',
    kind: 'mixed',
    voice: 'Tingting',
    say: '明天的 meeting 改到 Zoom 上开，记得带上 slides。',
    reference: '明天的meeting改到Zoom上开，记得带上slides。',
    keep: [['meeting'], ['Zoom'], ['slides']],
  },
  {
    id: 'mixed-3',
    kind: 'mixed',
    voice: 'Tingting',
    say: '我们用 Swift 写界面，核心逻辑放在 Rust 里。',
    reference: '我们用Swift写界面，核心逻辑放在Rust里。',
    keep: [['Swift'], ['Rust']],
  },
  {
    id: 'names-numbers-1',
    kind: 'names-numbers',
    voice: 'Tingting',
    say: '请转告张伟，订单号是四七零二九，金额一千二百五十元。',
    reference: '请转告张伟，订单号是47029，金额1250元。',
    keep: [['张伟'], ['47029', '四七零二九'], ['1250', '一千二百五十']],
  },
  {
    id: 'names-numbers-2',
    kind: 'names-numbers',
    voice: 'Tingting',
    say: '李娜的航班三月十五日早上八点二十分到达。',
    reference: '李娜的航班3月15日早上8点20分到达。',
    keep: [['李娜'], ['3月15日', '三月十五日'], ['8点20', '八点二十']],
  },
  {
    id: 'negation-1',
    kind: 'negation',
    voice: 'Tingting',
    say: '我不同意这个方案，先不要发出去。',
    reference: '我不同意这个方案，先不要发出去。',
    keep: [['不同意'], ['不要']],
  },
  {
    id: 'negation-2',
    kind: 'negation',
    voice: 'Tingting',
    say: '这个问题还没有解决，别关闭工单。',
    reference: '这个问题还没有解决，别关闭工单。',
    keep: [['没有'], ['别']],
  },
  {
    id: 'self-correction-1',
    kind: 'self-correction',
    voice: 'Tingting',
    say: '我们周三见，不对，是周四下午见。',
    reference: '我们周三见，不对，是周四下午见。',
    keep: [['周三'], ['周四']],
  },
  {
    id: 'self-correction-2',
    kind: 'self-correction',
    voice: 'Tingting',
    say: '把数量改成五十，哦不，改成五百。',
    reference: '把数量改成50，哦不，改成500。',
    keep: [
      ['50', '五十'],
      ['500', '五百'],
    ],
  },
  {
    id: 'en-1',
    kind: 'en',
    voice: 'Samantha',
    say: 'Please send me the updated contract by Friday, not Thursday.',
    reference: 'Please send me the updated contract by Friday, not Thursday.',
    keep: [['Friday'], ['not'], ['Thursday']],
  },
  {
    id: 'ja-1',
    kind: 'ja',
    voice: 'Kyoko',
    say: '明日の会議は午後二時からに変更になりました。',
    reference: '明日の会議は午後2時からに変更になりました。',
    keep: [['2時', '二時'], ['会議']],
  },
  { id: 'silence-1', kind: 'silence', silenceSeconds: 3, reference: '', keep: [] },
  {
    id: 'noise-zh-10db',
    kind: 'noise',
    base: 'zh-plain-1',
    snrDb: 10,
    reference: '今天下午三点在会议室讨论下个季度的预算安排。',
    keep: [['预算']],
  },
  {
    id: 'noise-mixed-5db',
    kind: 'noise',
    base: 'mixed-1',
    snrDb: 5,
    reference: '这个PR我已经review过了，等CI通过就可以merge。',
    keep: [['PR'], ['review'], ['CI'], ['merge']],
  },
]

/** 读出 16-bit PCM WAV 的采样；按块查找 fmt/data，不假设固定 44 字节头。 */
export function readWav(bytes: Uint8Array): { sampleRate: number; samples: Int16Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('不是 WAV 文件')
  let sampleRate = 0
  let at = 12
  while (at + 8 <= bytes.length) {
    const id = tag(at)
    const size = view.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ') {
      const format = view.getUint16(body, true)
      const channels = view.getUint16(body + 2, true)
      const bits = view.getUint16(body + 14, true)
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error('只支持单声道 16-bit PCM')
      sampleRate = view.getUint32(body + 4, true)
    } else if (id === 'data') {
      if (!sampleRate) throw new Error('data 块在 fmt 块之前')
      const count = Math.min(size, bytes.length - body) >> 1
      const samples = new Int16Array(count)
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(body + i * 2, true)
      return { sampleRate, samples }
    }
    at = body + size + (size & 1)
  }
  throw new Error('WAV 缺少 data 块')
}

export function writeWav(samples: Int16Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => {
    for (let i = 0; i < 4; i++) bytes[at + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i] ?? 0, true)
  return bytes
}

function rms(samples: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2
  return samples.length ? Math.sqrt(sum / samples.length) : 0
}

/** 固定种子的伪随机数，保证每次生成的噪声夹具逐字节一致。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 按信噪比叠加近似高斯的白噪声（12 个均匀数求和），结果截断到 16-bit 范围。 */
export function addNoise(speech: Int16Array, snrDb: number, seed = 1): Int16Array {
  const random = seeded(seed)
  const noise = Float64Array.from(speech, () => {
    let sum = 0
    for (let i = 0; i < 12; i++) sum += random()
    return sum - 6
  })
  const noiseRms = rms(noise)
  const scale = noiseRms ? rms(speech) / 10 ** (snrDb / 20) / noiseRms : 0
  return Int16Array.from(speech, (value, i) =>
    Math.max(-32768, Math.min(32767, Math.round(value + (noise[i] ?? 0) * scale))),
  )
}

async function synthesize(voice: string, text: string, path: string): Promise<void> {
  const process = Bun.spawn(
    [
      'say',
      '-v',
      voice,
      '-o',
      path,
      '--file-format=WAVE',
      `--data-format=LEI16@${SAMPLE_RATE}`,
      '--channels=1',
      text,
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  )
  if ((await process.exited) !== 0)
    throw new Error(
      `say -v ${voice} 失败：${await new Response(process.stderr).text()}（系统设置里可能未下载该语音）`,
    )
}

async function main(): Promise<void> {
  const out = join(import.meta.dir, '..', 'target', 'asr-fixtures')
  await mkdir(out, { recursive: true })
  const made = new Map<string, Int16Array>()
  for (const fixture of FIXTURES) {
    const path = join(out, `${fixture.id}.wav`)
    if ('say' in fixture) {
      await synthesize(fixture.voice, fixture.say, path)
      const wav = readWav(new Uint8Array(await Bun.file(path).arrayBuffer()))
      if (wav.sampleRate !== SAMPLE_RATE)
        throw new Error(`${fixture.id} 采样率是 ${wav.sampleRate}`)
      made.set(fixture.id, wav.samples)
    } else if ('silenceSeconds' in fixture) {
      await writeFile(path, writeWav(new Int16Array(fixture.silenceSeconds * SAMPLE_RATE)))
    } else {
      const base = made.get(fixture.base)
      if (!base) throw new Error(`${fixture.id} 依赖的 ${fixture.base} 需排在前面`)
      await writeFile(path, writeWav(addNoise(base, fixture.snrDb)))
    }
  }
  const manifest = FIXTURES.map(({ id, kind, reference, keep, ...source }) => ({
    id,
    file: `${id}.wav`,
    kind,
    reference,
    keep,
    synthetic: true,
    source,
  }))
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`已生成 ${FIXTURES.length} 条夹具：${out}`)
}

if (import.meta.main) await main()
