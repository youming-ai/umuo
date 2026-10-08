import { defineConfig } from 'vitest/config'

/** 官网内容模型 / i18n 完整性 / hydration，以及 Worker 的邮箱校验与限流。 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'apps/*/src/**/*.{test,spec}.{ts,tsx}',
      // umuo.app 那个 Worker 的邮箱校验与限流；测试里用假 KV，不打网络
      'worker/src/**/*.{test,spec}.ts',
    ],
  },
})
