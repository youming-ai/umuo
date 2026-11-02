# Agent Instructions

本文件是本仓库对 AI agent 的唯一指令来源，`CLAUDE.md` 只做指针。

## 仓库范围

这里是 umuo 仓库的 `site/`：**umuo.app 官网（`apps/web`）与它的 Worker（`worker`）**，下文路径都相对 `site/`。
它是独立的 Bun 项目，命令都在 `site/` 里跑；客户端代码在仓库根目录（`apps/`、`crates/`），不要搬进来。
umuo 完全免费、按 MIT 许可证开源（仓库尚未公开），纯 BYOK；没有购买、许可证、激活或试用，官网不要再写回这些。

## 常用命令

```bash
bun install
bun run dev:web        # 官网
bun run build:web      # 生成本地 Worker 所需的预渲染页面
bun run dev:worker     # Vite + Void，本地 KV / R2
bun run verify         # lint + type-check + vitest + 官网及 Void Worker 构建
```

Node 需 ≥ 24.21；本机默认版本较低时用 `mise exec node@24 -- bun run verify`。
`void.config.ts` 是正式 Worker 配置的唯一来源：域名、资源 ID、访问开关和日志均显式声明，改它们会影响部署。
Void 中间件与 `worker/src/index.ts` 共用 `worker/src/dispatch.ts`；正式配置由 `scripts/void-config.test.ts` 检查。
`cf` 管理 Cloudflare 资源与预构建部署（`scripts/cf-deploy.ts` 转换 Void 构建产物后调 `cf deploy --prebuilt`）；
Vite + Void 负责开发和构建。Worker 没有任何 secret 或变量。
生成的 `.void-wrangler.jsonc` 和 `.void/` 不提交。

线上已由 Void 构建接管；调整 Workers Builds 或回滚前，先读 `docs/VOID-MIGRATION.md`。
迁移的部署、远端验证与回滚只由负责人执行；本地构建、测试和 cf 的 dry-run 可独立运行。

## 官网的硬约束

- **文案只有一个来源**：`apps/web/src/content/<locale>.ts`，五种语言（zh-cn / zh-tw / en / ja / ko）结构一致；新增文案五种语言都要写，
  `content.test.ts` 会拦空串与漏翻。组件不写死句子。
- **预渲染必须能 hydrate**：渲染期不读 `window`、不用随机数和计时器，副作用放进 effect（`hydration.test.tsx` 守着）。
- **不放假下载链接**：`MACOS_DOWNLOAD_URL` 指向 Worker 的 `/download/macos`（读 R2 最新版）；设回 `null` 时下载按钮变为不可点。
- 目前站点是首页一屏，外加页脚链接的 `/terms`（服务条款）与 `/privacy`（隐私政策）。页眉只有左边的 logo（蓝底、从水里探出头的小水獭，`LogoMark` 与 `public/favicon.svg` 是同一张图）。原来的「免费与开源」页 `/pricing` 已删除（不做重定向，旧地址返回 404），不要再加回定价页。页面清单在 `apps/web/src/lib/pages.ts`，Worker 的 `PAGES`（`worker/src/locale.ts`）要同步。
- **产品范围**：文字翻译、OCR 截图翻译、语音输入后润色/翻译，完全免费、纯 BYOK。修改产品页面前读根目录 `docs/PRD.md` 与 `docs/PRD-CONFORMANCE.md`；只宣称已发布能力，语音尚未实现。账号、订阅、付费版、官方额度与 AI 网关退出范围，不继续宣传为即将推出。
- **免费与开源**：umuo 免费，没有付费版、内购、试用期、许可证或激活；模型调用费用只在用户与供应商之间。整个仓库（含官网）按 MIT 许可证开源，源码地址是 `apps/web/src/config.ts` 的 `SOURCE_URL`（github.com/youming-ai/umuo，2026-11-02 公开）。同文件的 `SOURCE_PUBLIC` 已打开：页脚有源码链接，首页下载旁那句用 `freeNote.public` 并链到 `SOURCE_URL`；仓库若再改为私有，须先把它改回 false（关闭时用纯文字 `hero.freeNote.pending`）。「umuo」名称与水獭图标不随 MIT 授权。
- **条款与隐私政策**：v3.0（2026-11-02）起软件本身按 MIT 许可证提供，条款只约束网站与官方发行版的使用、商标、第三方模型供应商等；隐私政策不再有支付、许可证与设备数据，写明下载、检查更新、上线通知订阅与语音（本机转写、Hugging Face 模型下载）。经营者、国家与版本/生效日期集中在 `config.ts` 的 `LEGAL_*`；改条款时更新版本与日期，并履行已有通知承诺。
- **地址不带语言前缀**：只有 `umuo.app/`。Worker（`worker/src/locale.ts`）按 cookie `umuo-lang` → `Accept-Language` → 简体中文挑一份 `dist/<locale>/index.html` 返回；页面上切换语言只写 cookie、就地换内容；`/en/` 这类旧地址 301 回 `/`。

## 视觉方向：「对照本」

官网排成一本双语对照本，这是定过的方向，别退回通用的 landing 模板：

- **首页只有一屏、不滚动**：左边标题与下载，右边可切换读 / 写 / 说的演示；改动后用 1280×720 与 390×844 量一下 `scrollHeight`。
- 暖纸咖啡墨字，全站自托管 Open Sans（中日韩回落系统字体）；主题色只取水獭本身的咖啡色系（`#A8734D` / `#7E5236` / `#2A1F1A` / `#F4E6D2`）。
  **界面不用蓝**：logo 底色的蓝（`#0A84FF` / `#5FB2FF`）只留在 logo 图里。令牌与组件规范见 `DESIGN.md`。
- 左对齐，但页面网格居中并铺满（最宽约 76rem）；区块头像书的章首，标题左、描述右。
- 字体只用自托管或系统字体，不引 Google Fonts 等外部服务（大陆访问不稳且阻塞首屏）。
- **不要加回**：深色光晕 / 渐变、胶囊形 eyebrow 标签、标题里单个渐变词、`A · B · C` 式中间点、千篇一律的圆角卡片墙、无意义的 01/02/03 编号。
- 全页只有一处自发动效：首屏译文逐字流式出现（尊重 reduced-motion）；切换演示模式时重新流出，属于访客触发。
