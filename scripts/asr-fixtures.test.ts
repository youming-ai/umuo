import { describe, expect, test } from 'bun:test'
import { addNoise, FIXTURES, readWav, SAMPLE_RATE, writeWav } from './asr-fixtures'

describe('转写实验音频夹具', () => {
  test('清单覆盖阶段 B 要求的每一类，且 id 唯一、噪声基底排在前面', () => {
    const kinds = new Set(FIXTURES.map((fixture) => fixture.kind))
    for (const kind of [
      'zh',
      'mixed',
      'names-numbers',
      'negation',
      'self-correction',
      'silence',
      'noise',
    ] as const)
      expect(kinds.has(kind)).toBe(true)
    const ids = FIXTURES.map((fixture) => fixture.id)
    expect(new Set(ids).size).toBe(ids.length)
    FIXTURES.forEach((fixture, index) => {
      if ('base' in fixture) expect(ids.indexOf(fixture.base)).toBeLessThan(index)
    })
  })

  test('必保留词能在期望文本里找到，静音期望为空', () => {
    for (const fixture of FIXTURES) {
      if (fixture.kind === 'silence') expect(fixture.reference).toBe('')
      for (const group of fixture.keep)
        expect(group.some((word) => fixture.reference.includes(word))).toBe(true)
    }
  })

  test('WAV 写出后读回逐样本一致，并跳过未知块', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768])
    expect(readWav(writeWav(samples))).toEqual({ sampleRate: SAMPLE_RATE, samples })

    const plain = writeWav(samples)
    const extra = new Uint8Array(
      [...'LIST'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 1, 2, 3, 0]),
    )
    const withList = new Uint8Array(plain.length + extra.length)
    withList.set(plain.subarray(0, 36))
    withList.set(extra, 36)
    withList.set(plain.subarray(36), 36 + extra.length)
    expect(readWav(withList).samples).toEqual(samples)
  })

  test('噪声按信噪比叠加、可复现且不越界', () => {
    const speech = Int16Array.from({ length: 16_000 }, (_, i) =>
      Math.round(8000 * Math.sin(i / 10)),
    )
    const noisy = addNoise(speech, 10)
    expect(addNoise(speech, 10)).toEqual(noisy)
    let signal = 0
    let noise = 0
    for (let i = 0; i < speech.length; i++) {
      signal += (speech[i] ?? 0) ** 2
      noise += ((noisy[i] ?? 0) - (speech[i] ?? 0)) ** 2
    }
    expect(10 * Math.log10(signal / noise)).toBeCloseTo(10, 0)
    expect(
      addNoise(Int16Array.from([32767, -32768]), -40).every((v) => v >= -32768 && v <= 32767),
    ).toBe(true)
  })
})
