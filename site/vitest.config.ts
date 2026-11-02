import { defineConfig } from 'vitest/config'

/** 官网内容模型 / i18n 完整性 / hydration，以及 Worker 的路由（语言协商、下载跳转、404、缓存与安全头）。 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'apps/*/src/**/*.{test,spec}.{ts,tsx}',
      // umuo.app 的 Worker 路由；测试里用假的静态资源层，不打网络
      'worker/src/**/*.{test,spec}.ts',
      // scripts/ 的配置规则
      'scripts/**/*.test.ts',
    ],
  },
})
