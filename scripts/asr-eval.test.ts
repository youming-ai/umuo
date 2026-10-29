import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CANDIDATE_MODELS,
  ENGINE_ARTIFACT,
  hfResolveUrl,
  normalizeForCer,
  normalizeForWer,
  scoreTranscript,
  verifyFileIntegrity,
} from './asr-eval'

describe('阶段 B 本地转写评测规则与目录校验', () => {
  test('引擎与候选模型均固定版本、commit revision、精确大小与 64 位 SHA-256', () => {
    expect(ENGINE_ARTIFACT.version).toBe('0.4.1')
    expect(ENGINE_ARTIFACT.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(ENGINE_ARTIFACT.sizeBytes).toBeGreaterThan(1_000_000)

    expect(CANDIDATE_MODELS.length).toBe(4)
    for (const model of CANDIDATE_MODELS) {
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(model.sizeBytes).toBeGreaterThan(100_000_000)
      expect(hfResolveUrl(model)).toContain(`/${model.revision}/${model.filename}`)
    }

    const productModels = CANDIDATE_MODELS.filter((m) => m.role === 'product-candidate')
    expect(productModels.every((m) => m.license === 'Apache-2.0')).toBe(true)
    const refModels = CANDIDATE_MODELS.filter((m) => m.role === 'speed-reference-only')
    expect(refModels.every((m) => m.variant === 'sensevoice-small')).toBe(true)
  })

  test('verifyFileIntegrity 校验文件存在、精确字节数与 SHA-256', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'umuo-asr-verify-'))
    try {
      const file = join(dir, 'sample.bin')
      const payload = new TextEncoder().encode('umuo-stage-b-verification')
      await writeFile(file, payload)
      const expectedHash = new Bun.CryptoHasher('sha256').update(payload).digest('hex')

      const ok = await verifyFileIntegrity(file, payload.byteLength, expectedHash)
      expect(ok.ok).toBe(true)

      const wrongSize = await verifyFileIntegrity(file, payload.byteLength + 1, expectedHash)
      expect(wrongSize.ok).toBe(false)
      expect(wrongSize.reason).toContain('文件大小不匹配')

      const wrongHash = await verifyFileIntegrity(file, payload.byteLength, '0'.repeat(64))
      expect(wrongHash.ok).toBe(false)
      expect(wrongHash.reason).toContain('SHA-256 不匹配')

      const missing = await verifyFileIntegrity(join(dir, 'missing.bin'), 10, expectedHash)
      expect(missing.ok).toBe(false)
      expect(missing.reason).toContain('文件不存在')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('CER 与 WER 归一化及必保留词评分覆盖中英混说、繁简与静音', () => {
    expect(normalizeForCer('这个 PR，我已经 review 过了！').join('')).toBe('这个pr我已经review过了')
    expect(normalizeForWer('Please send me the contract, by Friday!')).toEqual([
      'please',
      'send',
      'me',
      'the',
      'contract',
      'by',
      'friday',
    ])

    const mixedScore = scoreTranscript(
      {
        kind: 'mixed',
        reference: '这个PR我已经review过了，等CI通过就可以merge。',
        keep: [['PR'], ['review'], ['CI'], ['merge']],
      },
      '这个 pr 我已经 Review 过了，等 ci 通过就可以 merge',
    )
    expect(mixedScore.metric).toBe('CER')
    expect(mixedScore.errPct).toBe(0)
    expect(mixedScore.keepPassed).toBe(true)

    const hantScore = scoreTranscript(
      {
        kind: 'zh',
        reference: '這份文件請在明天中午前回覆。',
        keep: [['明天'], ['中午']],
      },
      '这份文件请在明天中午前回复。',
    )
    expect(hantScore.errPct).toBe(0)
    expect(hantScore.keepPassed).toBe(true)

    const silenceOk = scoreTranscript({ kind: 'silence', reference: '', keep: [] }, '  。 ')
    expect(silenceOk.metric).toBe('SILENCE')
    expect(silenceOk.errPct).toBe(0)
    expect(silenceOk.keepPassed).toBe(true)

    const silenceHallucinated = scoreTranscript(
      { kind: 'silence', reference: '', keep: [] },
      '谢谢观看',
    )
    expect(silenceHallucinated.errPct).toBe(100)
    expect(silenceHallucinated.keepPassed).toBe(false)
  })
})
