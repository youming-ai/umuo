/** 在本机 workerd 中验证构建产物能返回候选版本 ID。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'

const site = join(dirname(fileURLToPath(import.meta.url)), '..')
const project = site
const built = JSON.parse(readFileSync(join(project, 'dist/ssr/wrangler.json'), 'utf8'))
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: 'umuo-local-ready',
    modules: true,
    scriptPath: join(project, 'dist/ssr/index.js'),
    compatibilityDate: built.compatibility_date,
    compatibilityFlags: built.compatibility_flags,
    versionMetadata: built.version_metadata.binding,
  }),
)

try {
  const response = await runtime.dispatchFetch('http://localhost/__void/ready')
  assert.equal(response.status, 200, '就绪探针状态不正确')
  assert.equal(response.headers.get('cache-control'), 'no-store', '就绪探针不能缓存')
  const body = await response.json()
  assert.equal(body.ready, true, '就绪探针未通过')
  assert.ok(
    typeof body.versionId === 'string' && body.versionId.length > 0,
    '就绪探针未返回版本 ID',
  )
  console.log('✓ 本地 workerd 就绪探针返回版本 ID')
} finally {
  await runtime.dispose()
}
