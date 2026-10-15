import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const dir = import.meta.dirname

/**
 * 两个入口：浮窗（panel）与设置（settings）。
 *
 * 它们刻意是两个独立的 HTML，而不是一个 SPA 里的两条路由：
 * 浮窗要的是「立刻出现、立刻消失、体积最小」，设置窗要的是完整表单，
 * 共享一个 bundle 只会让浮窗多加载用不到的代码。
 *
 * `root: 'src'` 不是为了整齐，而是必需的：不设它的话 Vite 会保留输入的相对路径，
 * 产出 `dist/src/panel.html`，而 Tauri 侧按 `dist/panel.html` 找窗口页面——
 * 结果是一个能构建成功、运行时白屏的配置。
 */
export default defineConfig({
  root: resolve(dir, 'src'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(dir, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: resolve(dir, 'src/panel.html'),
        settings: resolve(dir, 'src/settings.html'),
        compose: resolve(dir, 'src/compose.html'),
        compare: resolve(dir, 'src/compare.html'),
        history: resolve(dir, 'src/history.html'),
        onboarding: resolve(dir, 'src/onboarding.html'),
        quick: resolve(dir, 'src/quick.html'),
      },
    },
  },
  clearScreen: false,
})
