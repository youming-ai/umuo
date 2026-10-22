import { defineMiddleware } from 'void'
import type { Env } from '../worker/src/env'
import { legacyMiddleware } from '../worker/src/void-middleware'

/**
 * Void 的路由层只有这一个中间件，逻辑在 worker/src/void-middleware.ts。
 * 线上目前仍用 wrangler 部署（wrangler.jsonc 的 main 是 worker/src/index.ts），这个文件只在
 * 根目录 `vite build`（带 voidPlugin）时进构建。
 */
export default defineMiddleware((c, next) =>
  legacyMiddleware({ req: c.req, env: c.env as unknown as Env }, next),
)
