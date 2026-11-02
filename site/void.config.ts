import { defineConfig } from 'void/config'

/**
 * 官网与 Worker 的配置来源。显式保留线上资源、域名及访问开关，避免部署时创建新的资源或改变入口。
 * 配置不含密钥；umuo 免费开源、没有收费接口，Worker 不需要任何 secret 或变量。
 */
export default defineConfig({
  inference: {
    // 既有 Vite 前端又有中间件，不写会停下来让人选；部署两者
    appType: 'void',
    build: 'bun run build',
    // 绑定都是手写的自定义名（ASSETS / NOTIFY_KV / RELEASES），不要 Void 再推断出默认的 DB / KV / STORAGE / AI
    bindings: { db: false, kv: false, storage: false, ai: false },
  },
  // nodejs_compat 不能去掉：Void 运行时用 node:async_hooks 的 AsyncLocalStorage（见构建产物 dist/ssr/index.js）
  worker: {
    compatibility_date: '2026-07-17',
    compatibility_flags: ['nodejs_compat'],
  },
  routing: {
    // 保留 Worker 自己的 404 页。不写时 Void 推断为 SPA 兜底：Worker 回 404 后再去取 /index.html 当 200 返回
    // （眼下只因资源层对 /index.html 回 307 才没生效，不能靠这个巧合）
    notFound: 'none',
    // 页面按 cookie / Accept-Language 选语言，不能被 ISR 缓存成一份
    isr: false,
    // 不写 routing.headers：void@1.2.1 里它改不掉响应已有的头。中间件回的是 ASSETS.fetch 的响应（自带
    // Cache-Control），Void 的 headerMiddleware 再赋值 c.res 时，Hono 的 `set res` 会把旧响应的头抄回新响应，
    // 规则里的 Cache-Control 随即被覆盖（本地实测，见 docs/VOID-MIGRATION.md「静态资源的缓存」）。
    // 静态资源因此与现在线上一样是 `public, max-age=0, must-revalidate`。
  },
  cloudflare: {
    name: 'umuo',
    routes: [{ pattern: 'umuo.app', custom_domain: true }],
    // 正式站只经自定义域名访问；如需 Version URL，先在 staging 验证就绪检查。
    workers_dev: false,
    preview_urls: false,
    // 首次接管前先为现有 Worker 添加同名绑定，供 Void 在不开放 Version URL 时验证候选版本。
    version_metadata: { binding: 'VERSION_METADATA' },
    kv_namespaces: [{ binding: 'NOTIFY_KV', id: 'dad4b460f4a14797adc1e9491e42f7f1' }],
    r2_buckets: [{ binding: 'RELEASES', bucket_name: 'umuo-releases' }],
    observability: {
      enabled: true,
      logs: { enabled: true, persist: true, invocation_logs: true },
      traces: { enabled: false },
    },
  },
})
