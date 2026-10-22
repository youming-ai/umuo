import { defineConfig } from 'void/config'

/**
 * Void 的项目配置。线上目前仍是 wrangler 部署，这里只放「Void 构建要与现状等价」必需的几项；
 * 绑定、vars、域名等等到关联线上 Worker 时再补（迁移方案 PR 2 / PR 4）。
 */
export default defineConfig({
  inference: {
    // 既有 Vite 前端又有中间件，不写会停下来让人选；部署两者
    appType: 'void',
    build: 'bun run build:web && vite build',
    // 绑定都是手写的自定义名（ASSETS / NOTIFY_KV / LICENSES / RELEASES），不要 Void 再推断出默认的 DB / KV / STORAGE / AI
    bindings: { db: false, kv: false, storage: false, ai: false },
  },
  // 与 wrangler.jsonc 保持一致；nodejs_compat 是 Waffo SDK（node:crypto）要的
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
    // 规则里的 Cache-Control 随即被覆盖（本地 wrangler dev 实测，见 docs/VOID-MIGRATION.md「已知限制」）。
    // 静态资源因此与现在线上一样是 `public, max-age=0, must-revalidate`。
  },
})
