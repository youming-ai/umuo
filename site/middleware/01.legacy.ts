import { defineMiddleware } from 'void'
import type { Env } from '../worker/src/env'
import { legacyMiddleware } from '../worker/src/void-middleware'

/**
 * Void 的路由层只有这一个中间件，逻辑在 worker/src/void-middleware.ts。
 * 根目录 `vite build`（带 voidPlugin）会把它打进 Worker。
 */
export default defineMiddleware((c, next) =>
  legacyMiddleware({ req: c.req, env: c.env as unknown as Env }, next),
)
