import { defineConfig } from 'vite'
import { voidPlugin } from 'void'

/**
 * staging Worker（umuo-app-void-staging）的 Void 构建，与 site/vite.config.ts 只差 publicDir 的相对路径。
 * 为什么单开一个目录：见 void.config.ts 的说明与 docs/VOID-MIGRATION.md。
 */
export default defineConfig({
  plugins: [voidPlugin()],
  publicDir: '../apps/web/dist',
})
