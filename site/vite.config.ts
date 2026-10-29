import { defineConfig } from 'vite'
import { voidPlugin } from 'void'

/**
 * **只用于 Void 部署构建**，官网前端的开发与构建仍用 apps/web/vite.config.ts（`bun run dev:web` / `build:web`）。
 *
 * 先 `bun run build:web` 产出预渲染好的 apps/web/dist，再在 site/ 根跑 `vite build`：
 * voidPlugin 把 publicDir 原样拷进 dist/client（静态资源），把 middleware/ 打成 dist/ssr（Worker）。
 * 见 Void 文档「Adding a backend to a static site」。voidPlugin 只能放在这个根配置里。
 *
 * 构建由 `bun run build` 和 `bun run verify` 调用；Worker 的配置来自 void.config.ts。
 */
export default defineConfig({
  plugins: [voidPlugin()],
  publicDir: 'apps/web/dist',
})
