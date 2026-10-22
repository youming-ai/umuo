import { defineConfig } from 'void/config'

/**
 * **staging 专用**：用 Void 把站点部署到一个独立的新 Worker `umuo-app-void-staging`，绑预览用的 KV 与 R2，
 * 在不碰线上 `umuo-app` 的前提下验证 Void 部署（迁移方案 PR 3，步骤见 docs/VOID-MIGRATION.md）。
 *
 * 为什么是单独一个目录而不是 `void.staging.config.ts`：void@1.2.1 只认项目根（= 执行命令时的 cwd）下的
 * `void.config.ts`，没有 `--config` 之类的选项（`void/dist/project-paths-*.mjs` 的 `loadVoidConfig`、
 * `void/dist/cli/cli.mjs` 的 deploy 参数表）；官方文档也写「Use a separate Void project config for each target」。
 * 这个目录里没有 wrangler.jsonc，所以也不会撞上 site/ 根「void.config.ts 与 wrangler.jsonc 并存就拒绝构建」的限制。
 *
 * 除了 `cloudflare` 与 `worker.vars`，其余各项必须与 site/void.config.ts 一致（void-config.test.ts 守着）：
 * staging 验的就是 PR 4 要上线的那份配置。
 */
export default defineConfig({
  inference: {
    appType: 'void',
    // 命令在本目录执行：先在 site/ 跑官网的预渲染构建，再用 site/ 的 vite（本目录没有 node_modules）打 Worker
    build: 'bun --cwd .. run build:web && ../node_modules/.bin/vite build',
    bindings: { db: false, kv: false, storage: false, ai: false },
  },
  worker: {
    compatibility_date: '2026-07-17',
    compatibility_flags: ['nodejs_compat'],
    // Waffo 走测试环境：staging 上的结账与 webhook 不会碰正式的店铺与许可证。私钥另用 `void secret put`
    vars: {
      WAFFO_ENV: 'test',
      WAFFO_MERCHANT_ID: 'MER_REDACTED',
      WAFFO_STORE_ID: 'STO_REDACTED',
      WAFFO_PRODUCT_PREMIUM_MONTHLY: 'PROD_REDACTED_MONTHLY',
      WAFFO_PRODUCT_PREMIUM_YEARLY: 'PROD_REDACTED_YEARLY',
    },
  },
  routing: {
    notFound: 'none',
    isr: false,
    // 不写 routing.headers：void@1.2.1 里它改不掉响应已有的头。中间件回的是 ASSETS.fetch 的响应（自带
    // Cache-Control），Void 的 headerMiddleware 再赋值 c.res 时，Hono 的 `set res` 会把旧响应的头抄回新响应，
    // 规则里的 Cache-Control 随即被覆盖（本地 wrangler dev 实测，见 docs/VOID-MIGRATION.md「已知限制」）。
    // 静态资源因此与现在线上一样是 `public, max-age=0, must-revalidate`。
  },
  cloudflare: {
    name: 'umuo-app-void-staging',
    // **不写 routes**：照抄正式配置的 `umuo.app` custom_domain 会把线上域名挂到这个 staging Worker 上。
    // 只用 <name>.<子域>.workers.dev 访问；Preview URL 也打开，Void 的就绪检查要用它。
    workers_dev: true,
    preview_urls: true,
    // 都是 wrangler.jsonc 里 `previews` 段的预览资源，与正式数据隔离
    kv_namespaces: [
      { binding: 'NOTIFY_KV', id: '269178fa91564fc6954a8fd1b33d3be7' },
      { binding: 'LICENSES', id: '5197702966104e0a834192959fad8a25' },
    ],
    r2_buckets: [{ binding: 'RELEASES', bucket_name: 'umuo-releases-preview' }],
    observability: {
      enabled: true,
      logs: { enabled: true, persist: true, invocation_logs: true },
      traces: { enabled: false },
    },
  },
})
