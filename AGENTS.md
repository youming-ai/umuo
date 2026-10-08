# Agent Instructions

本文件是本仓库对 AI agent 的唯一指令来源，`CLAUDE.md` 只做指针。

## 仓库范围

这里只有 **umuo.app 官网（`apps/web`）与它的 Worker（`worker`）**。
umuo 客户端是**闭源**的，在私有仓库里，**不要往这里放任何客户端代码、内核代码或客户端文档**；
官网文案也不要再写「开源 / MIT / 自行编译」之类的宣称。

## 常用命令

```bash
bun install
bun run dev:web        # 官网
bun run dev:worker     # Worker（wrangler dev，本地 KV）
bun run verify         # 提交前门禁：lint + type-check + vitest + build:web
```

## 官网的硬约束

- **文案只有一个来源**：`apps/web/src/content/<locale>.ts`，四种语言结构一致；新增文案四种语言都要写，
  `content.test.ts` 会拦空串与漏翻。组件不写死句子。
- **预渲染必须能 hydrate**：渲染期不读 `window`、不用随机数和计时器，副作用放进 effect（`hydration.test.tsx` 守着）。
- **不放假下载链接**：`MACOS_DOWNLOAD_URL` 指向 Worker 的 `/download/macos`（读 R2 最新版）；设回 `null` 时下载按钮变为不可点。
- 目前站点只有首页一屏：定价页暂时下线，页眉只放 logo（蓝底、从水里探出头的小水獭，`LogoMark` 与 `public/favicon.svg` 是同一张图）。页面清单在 `apps/web/src/lib/pages.ts`。

## 视觉方向：「对照本」

官网排成一本双语对照本，这是定过的方向，别退回通用的 landing 模板：

- **首页只有一屏、不滚动**：左边标题与下载，右边可切换读 / 写 / 说的演示；改动后用 1280×720 与 390×844 量一下 `scrollHeight`。
- 白纸墨字，全站自托管 Open Sans（中日韩回落系统字体）；唯一的颜色是 macOS 文字选区蓝。
- 左对齐，但页面网格居中并铺满（最宽约 76rem）；区块头像书的章首，标题左、描述右。
- 字体只用自托管或系统字体，不引 Google Fonts 等外部服务（大陆访问不稳且阻塞首屏）。
- **不要加回**：深色光晕 / 渐变、胶囊形 eyebrow 标签、标题里单个渐变词、`A · B · C` 式中间点、千篇一律的圆角卡片墙、无意义的 01/02/03 编号。
- 全页只有一处自发动效：首屏译文逐字流式出现（尊重 reduced-motion）；切换演示模式时重新流出，属于访客触发。
