import { dispatch } from './dispatch'
import type { Env } from './env'

/**
 * umuo.app 的 Worker 入口（wrangler.jsonc 的 `main`）。路由全在 `./dispatch.ts`；
 * 这里只保留 wrangler 与测试要的 `export default { fetch }`。
 *
 * 不在这里顺手 `export { dispatch }`：入口模块的具名导出会被 workerd 当成 entrypoint 看待。
 */
export default {
  fetch: (request: Request, env: Env): Promise<Response> => dispatch(request, env),
} satisfies ExportedHandler<Env>
