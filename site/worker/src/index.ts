import { dispatch } from './dispatch'
import type { Env } from './env'

/**
 * 旧 Worker 入口，供迁移前后行为回归测试使用。路由全在 `./dispatch.ts`；
 * 正式构建入口是 Void 的 `middleware/01.legacy.ts`。
 *
 * 不在这里顺手 `export { dispatch }`：入口模块的具名导出会被 workerd 当成 entrypoint 看待。
 */
export default {
  fetch: (request: Request, env: Env): Promise<Response> => dispatch(request, env),
} satisfies ExportedHandler<Env>
