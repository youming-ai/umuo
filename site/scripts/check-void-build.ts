/** 校验 Void 实际部署构建包含版本就绪信息及配置中指定的正式资源，并验证可转换为 cf 预构建输出。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareCfBuildOutput } from 'void/deploy'
import source from '../void.config'

const site = join(import.meta.dirname, '..')

export async function prepareVerifiedCfBuild() {
  const project = site
  const config = source
  const expected = config.cloudflare as Record<string, unknown>
  const prepared = await prepareCfBuildOutput(join(project, 'dist/ssr'), { mode: 'production' })
  assert.ok(prepared, 'Void 构建无法转换为 cf 构建输出；先运行构建')

  try {
    const worker = JSON.parse(
      readFileSync(
        join(prepared.directory, '.cloudflare/output/v0/workers/default/worker.config.json'),
        'utf8',
      ),
    )
    const routes = expected.routes as { pattern: string }[] | undefined
    const kv = expected.kv_namespaces as { binding: string; id: string }[]
    const r2 = expected.r2_buckets as { binding: string; bucket_name: string }[]
    const vars = (config.worker?.vars ?? {}) as Record<string, string>

    assert.equal(worker.name, expected.name, 'Worker 名称不一致')
    assert.deepEqual(
      worker.domains ?? [],
      routes?.map((route) => route.pattern) ?? [],
      '域名不一致',
    )
    assert.equal(worker.workersDev, expected.workers_dev, 'workers.dev 开关不一致')
    assert.equal(worker.previewUrls, expected.preview_urls, 'Version URL 开关不一致')
    assert.equal(
      worker.compatibilityDate,
      config.worker?.compatibility_date,
      'compatibility_date 不一致',
    )
    assert.deepEqual(
      worker.compatibilityFlags,
      config.worker?.compatibility_flags,
      'compatibility_flags 不一致',
    )
    assert.deepEqual(
      worker.observability,
      {
        enabled: true,
        logs: { enabled: true, persist: true, invocationLogs: true },
        traces: { enabled: false },
      },
      'observability 不一致',
    )
    assert.deepEqual(worker.assets?.runWorkerFirst, ['/**'], 'assets.runWorkerFirst 不一致')
    for (const { binding, id } of kv)
      assert.deepEqual(worker.env[binding], { type: 'kv', id }, `${binding} 不一致`)
    for (const { binding, bucket_name } of r2)
      assert.deepEqual(worker.env[binding], { type: 'r2', name: bucket_name }, `${binding} 不一致`)
    assert.equal(worker.env.VERSION_METADATA?.type, 'version-metadata', '版本元数据绑定缺失')
    assert.equal(worker.env.ASSETS?.type, 'assets', '静态资源绑定缺失')
    for (const [name, value] of Object.entries(vars))
      assert.deepEqual(worker.env[name], { type: 'text', value }, `变量 ${name} 不一致`)

    const expectedKeys = [
      'ASSETS',
      'VERSION_METADATA',
      ...kv.map((x) => x.binding),
      ...r2.map((x) => x.binding),
      ...Object.keys(vars),
    ].sort()
    assert.deepEqual(
      Object.keys(worker.env ?? {}).sort(),
      expectedKeys,
      'cf 构建输出包含未声明的额外绑定',
    )

    return { prepared, workerName: worker.name as string }
  } catch (error) {
    await prepared.dispose()
    throw error
  }
}

if (import.meta.main) {
  const project = site
  const config = source
  const built = JSON.parse(readFileSync(join(project, 'dist/ssr/wrangler.json'), 'utf8'))
  const entry = readFileSync(join(project, '.void/entry.ts'), 'utf8')
  const expected = config.cloudflare as Record<string, unknown>
  const version = expected.version_metadata as { binding: string }

  assert.equal(built.name, expected.name, 'Worker 名称不一致')
  assert.deepEqual(built.routes, expected.routes, '域名不一致')
  assert.equal(built.workers_dev, expected.workers_dev, 'workers.dev 开关不一致')
  assert.equal(built.preview_urls, expected.preview_urls, 'Version URL 开关不一致')
  assert.deepEqual(built.kv_namespaces, expected.kv_namespaces, 'KV 绑定不一致')
  assert.deepEqual(built.r2_buckets, expected.r2_buckets, 'R2 绑定不一致')
  assert.deepEqual(built.version_metadata, version, '版本元数据绑定缺失')
  assert.equal(built.assets?.binding, 'ASSETS', '静态资源绑定缺失')
  assert.deepEqual(built.assets?.run_worker_first, ['/**'], '资源路由与 Void 不一致')
  assert.deepEqual(built.vars, config.worker?.vars, 'Worker 变量不一致')
  assert.ok(
    entry.includes(`versionMetadataBinding: ${JSON.stringify(version.binding)}`),
    'Void 就绪探针没有携带版本元数据',
  )

  const { prepared } = await prepareVerifiedCfBuild()
  await prepared.dispose()
  console.log(`✓ Void ${'正式'}构建已核对绑定、访问开关、cf 预构建转换与版本就绪探针`)
}
