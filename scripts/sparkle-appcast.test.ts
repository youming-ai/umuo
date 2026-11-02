import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createAppcast } from './sparkle-appcast'

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const archive = Buffer.from('本地测试更新包，不访问 Keychain')
  const signature = sign(null, archive, privateKey).toString('base64')
  return {
    version: '0.2.0',
    archive,
    signature,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    publishedAt: new Date('2026-10-23T00:00:00Z'),
  }
}

describe('Sparkle 更新清单', () => {
  test('为验签通过的包生成 macOS 14+ 更新与正确的长度', () => {
    const input = fixture()
    const xml = createAppcast(input)
    expect(xml).toContain('<sparkle:minimumSystemVersion>14.0.0</sparkle:minimumSystemVersion>')
    expect(xml).toContain(
      'https://github.com/youming-ai/umuo/releases/download/v0.2.0/umuo.app.tar.gz',
    )
    expect(xml).toContain(
      `sparkle:edSignature="${input.signature}" length="${input.archive.length}"`,
    )
  })

  test('错误私钥或被修改的包不生成清单', () => {
    const input = fixture()
    expect(() => createAppcast({ ...input, publicKey: fixture().publicKey })).toThrow('不匹配')
    expect(() => createAppcast({ ...input, archive: Buffer.from('篡改后的包') })).toThrow('不匹配')
    expect(() => createAppcast({ ...input, signature: '无效' })).toThrow('长度无效')
  })

  test('拒绝把非版本字符串插入 XML', () => {
    expect(() => createAppcast({ ...fixture(), version: '0.2.0</title>' })).toThrow('版本号')
  })
})
