import { dispatch } from './dispatch'
import type { Env } from './env'

/** Void（Hono）中间件上下文里我们用到的那一点：原始请求与绑定 */
export interface LegacyContext {
  req: { raw: Request }
  env: Env
}

/**
 * Void 部署下的全部路由：一个全局中间件把请求原样交给 `dispatch`（与 wrangler 入口同一份）。
 *
 * 只有 `/__void/*` 交还给 Void（`next()`）：那是 Void 自己的保留端点。`/__void/ready` 等
 * 在进中间件之前已被 Void 的运行时接走，这里放行只是防御，不与官网任何地址冲突。
 * 其余路径一律由 `dispatch` 回答，包括静态资源与 404 页 —— Void 部署时
 * `run_worker_first` 是 `/**`，资源请求也会先到这里（见 dispatch.ts 的 assetOrNotFound）。
 *
 * 这里不 import `void`：测试在 node 里直接调它，不必加载整套 Void 运行时。
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
