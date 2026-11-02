import { defineMiddleware } from 'void'
import { dispatch } from '../worker/src/dispatch'
import type { Env } from '../worker/src/env'

/** Void（Hono）中间件上下文里我们用到的那一点：原始请求与绑定 */
export interface LegacyContext {
  req: { raw: Request }
  env: Env
}

/**
 * Void 部署下的全部路由：一个全局中间件把请求原样交给 `dispatch`（worker/src/dispatch.ts）。
 * 根目录 `vite build`（带 voidPlugin）会把它打进 Worker。
 *
 * 只有 `/__void/*` 交还给 Void（`next()`）：那是 Void 自己的保留端点。`/__void/ready` 等
 * 在进中间件之前已被 Void 的运行时接走，这里放行只是防御，不与官网任何地址冲突。
 * 其余路径一律由 `dispatch` 回答，包括静态资源与 404 页 —— `run_worker_first` 是 `/**`，
 * 资源请求也会先到这里（见 dispatch.ts 的 assetOrNotFound）。
 */
export async function legacyMiddleware(
  c: LegacyContext,
  next: () => Promise<void>,
): Promise<Response | undefined> {
  const { pathname } = new URL(c.req.raw.url)
  if (pathname === '/__void' || pathname.startsWith('/__void/')) {
    await next()
    return undefined
  }
  return dispatch(c.req.raw, c.env)
}

export default defineMiddleware((c, next) =>
  legacyMiddleware({ req: c.req, env: c.env as unknown as Env }, next),
)
