import { join } from 'node:path'
import { unstable_readConfig } from 'wrangler'
import base from '../void.config'
import staging from '../void-staging/void.config'

/**
 * void-staging/ 是给 staging Worker 用的第二份 Void 配置（void@1.2.1 只认 cwd 下的 void.config.ts，见 docs/VOID-MIGRATION.md）。
 * staging 要验的是 PR 4 上线时的那份配置，所以除了 `cloudflare` 与 `worker.vars`，两份必须一字不差；
 * staging 也绝不能绑正式资源或挂上正式域名。
 */
const wrangler = unstable_readConfig({ config: join(import.meta.dirname, '..', 'wrangler.jsonc') })

describe('void-staging/void.config.ts', () => {
  it('除 cloudflare 与 worker.vars 外与 site/void.config.ts 一致', () => {
    const { build: _stagingBuild, ...stagingInference } = staging.inference ?? {}
    const { build: _baseBuild, ...baseInference } = base.inference ?? {}
    expect(stagingInference).toEqual(baseInference)
    expect(staging.routing).toEqual(base.routing)
    expect(staging.worker?.compatibility_date).toBe(base.worker?.compatibility_date)
    expect(staging.worker?.compatibility_flags).toEqual(base.worker?.compatibility_flags)
    // 两边的构建只差「在哪个目录跑」
    expect(staging.inference?.build).toBe(
      'bun --cwd .. run build:web && ../node_modules/.bin/vite build',
    )
    expect(base.inference?.build).toBe('bun run build:web && vite build')
  })

  it('兼容日期与 flags 与线上 wrangler.jsonc 一致', () => {
    expect(staging.worker?.compatibility_date).toBe(wrangler.compatibility_date)
    expect(staging.worker?.compatibility_flags).toEqual(wrangler.compatibility_flags)
  })

  it('是独立的 Worker，只绑预览资源，不挂域名', () => {
    const cf = staging.cloudflare as Record<string, unknown>
    expect(cf.name).toBe('umuo-app-void-staging')
    expect(cf.name).not.toBe(wrangler.name)
    // 写了 routes 就会把 umuo.app 挂到 staging 上
    expect(cf.routes).toBeUndefined()
    expect(cf.route).toBeUndefined()
    expect(cf.kv_namespaces).toEqual(wrangler.previews?.kv_namespaces)
    expect(cf.r2_buckets).toEqual(
      wrangler.previews?.r2_buckets?.map(({ binding, bucket_name }) => ({ binding, bucket_name })),
    )
    const prodKv = wrangler.kv_namespaces.map((kv) => kv.id)
    for (const kv of cf.kv_namespaces as { id: string }[]) expect(prodKv).not.toContain(kv.id)
    expect(cf.observability).toEqual(wrangler.observability)
  })

  it('Waffo 走测试环境，其余 ID 与线上相同', () => {
    const { WAFFO_ENV, ...rest } = staging.worker?.vars ?? {}
    expect(WAFFO_ENV).toBe('test')
    const { WAFFO_ENV: _prodEnv, ...prodRest } = wrangler.vars as Record<string, string>
    expect(rest).toEqual(prodRest)
  })
})
