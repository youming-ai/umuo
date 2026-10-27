import { createPublicKey, verify } from 'node:crypto'
import { join } from 'node:path'

const namespace = 'http://www.andymatuschak.org/xml-namespaces/sparkle'

/** 先用包内公钥验签，避免发版机误用另一应用的 Sparkle 私钥后生成无人能安装的更新。 */
export function createAppcast(options: {
  version: string
  archive: Uint8Array
  signature: string
  publicKey: string
  publishedAt: Date
}): string {
  const { version, archive, signature, publicKey, publishedAt } = options
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('版本号要是 X.Y.Z')
  const rawKey = Buffer.from(publicKey, 'base64')
  const rawSignature = Buffer.from(signature, 'base64')
  if (rawKey.length !== 32 || rawSignature.length !== 64)
    throw new Error('Sparkle 公钥或签名长度无效')
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]),
    format: 'der',
    type: 'spki',
  })
  if (!verify(null, archive, key, rawSignature))
    throw new Error('更新签名与包内 Sparkle 公钥不匹配，或更新包已被修改')
  // 签名重新编码为规范 Base64，版本经过白名单，XML 中不拼接任意输入。
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="${namespace}">
  <channel>
    <title>umuo</title>
    <link>https://umuo.app</link>
    <description>umuo macOS updates</description>
    <item>
      <title>umuo ${version}</title>
      <pubDate>${publishedAt.toUTCString()}</pubDate>
      <sparkle:version>${version}</sparkle:version>
      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0.0</sparkle:minimumSystemVersion>
      <enclosure url="https://umuo.app/download/macos/umuo-${version}-universal.app.tar.gz"
        sparkle:edSignature="${rawSignature.toString('base64')}" length="${archive.byteLength}" type="application/gzip" />
    </item>
  </channel>
</rss>
`
}

if (import.meta.main) {
  const [out, version] = Bun.argv.slice(2)
  if (!out || !version) throw new Error('用法：bun scripts/sparkle-appcast.ts <产物目录> <版本>')
  const plist = Bun.spawnSync([
    'plutil',
    '-convert',
    'json',
    '-o',
    '-',
    join(out, 'umuo.app/Contents/Info.plist'),
  ])
  if (plist.exitCode !== 0) throw new Error('无法读取安装包 Info.plist')
  const info = JSON.parse(plist.stdout.toString()) as Record<string, unknown>
  if (info.CFBundleVersion !== version || typeof info.SUPublicEDKey !== 'string') {
    throw new Error('安装包版本或 Sparkle 公钥无效')
  }
  const archivePath = join(out, 'umuo.app.tar.gz')
  const signTool = new URL(
    '../apps/macos/.build/artifacts/sparkle/Sparkle/bin/sign_update',
    import.meta.url,
  ).pathname
  const privateKeyPath = process.env.SPARKLE_PRIVATE_KEY_PATH
  const args = privateKeyPath
    ? ['--ed-key-file', privateKeyPath]
    : ['--account', 'app.umuo.desktop']
  const signed = Bun.spawnSync([signTool, ...args, '-p', archivePath])
  if (signed.exitCode !== 0)
    throw new Error(
      'Sparkle 签名失败：检查 app.umuo.desktop 的签名 Keychain 或 SPARKLE_PRIVATE_KEY_PATH',
    )
  const appcast = createAppcast({
    version,
    archive: new Uint8Array(await Bun.file(archivePath).arrayBuffer()),
    signature: signed.stdout.toString().trim(),
    publicKey: info.SUPublicEDKey,
    publishedAt: new Date(),
  })
  await Bun.write(join(out, 'appcast.xml'), appcast)
  console.log('✓ Sparkle 更新签名已用包内公钥验证，appcast.xml 已生成')
}
