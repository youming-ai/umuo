import { defineConfig } from 'vitest/config'

/**
 * 只跑 TypeScript 侧的测试：桌面端 UI 的状态机与请求构造等。
 * 翻译内核在 Rust（`crates/umuo-core`，由 `cargo test --workspace` 负责）。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/*/src/**/*.{test,spec}.{ts,tsx}', 'packages/*/src/**/*.{test,spec}.ts'],
  },
})
