# Agent Instructions

本文件是本仓库对 AI agent 的唯一指令来源，`CLAUDE.md` 只做指针。

## 仓库范围

这里是 umuo 仓库的 `site/`：**umuo.app 官网（`apps/web`）与它的 Worker（`worker`）**，下文路径都相对 `site/`。
它是独立的 Bun 项目，命令都在 `site/` 里跑；客户端代码在仓库根目录（`apps/`、`crates/`），不要搬进来。
客户端闭源，官网文案不要写「开源 / MIT / 自行编译」之类的宣称。

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
Vite + Void 负责开发和构建。Waffo 变量每项独占一行，供 `scripts/waffo-setup.ts` 改写；私钥只放远端 secret。
生成的 `.void-wrangler.jsonc` 和 `.void/` 不提交。

线上已由 Void 构建接管；调整 Workers Builds 或回滚前，先读 `docs/VOID-MIGRATION.md`。
迁移的部署、远端验证与回滚只由负责人执行；本地构建、测试和 cf 的 dry-run 可独立运行。

## 官网的硬约束

- **文案只有一个来源**：`apps/web/src/content/<locale>.ts`，五种语言（zh-cn / zh-tw / en / ja / ko）结构一致；新增文案五种语言都要写，
  `content.test.ts` 会拦空串与漏翻。组件不写死句子。
- **预渲染必须能 hydrate**：渲染期不读 `window`、不用随机数和计时器，副作用放进 effect（`hydration.test.tsx` 守着）。
- **不放假下载链接**：`MACOS_DOWNLOAD_URL` 指向 Worker 的 `/download/macos`（读 R2 最新版）；设回 `null` 时下载按钮变为不可点。
- 目前站点是首页一屏，外加 `/pricing`（定价，页眉右侧链接）、页脚链接的 `/terms`（服务条款）与 `/privacy`（隐私政策），以及 `/activate`（激活码领取页）。页眉左边 logo（蓝底、从水里探出头的小水獭，`LogoMark` 与 `public/favicon.svg` 是同一张图），右边定价（仓库是私有的，不放 GitHub 链接）。页面清单在 `apps/web/src/lib/pages.ts`，Worker 的 `PAGES`（`worker/src/locale.ts`）要同步。
- **产品范围**：文字翻译、OCR 截图翻译、语音输入后润色/翻译，一次性购买、纯 BYOK。修改产品或收费页面前读根目录 `docs/PRD.md` 与 `docs/PRD-CONFORMANCE.md`；只宣称已发布能力，语音尚未实现。账号、订阅、官方额度与 AI 网关退出范围，不继续宣传为即将推出。
- **收费文案**：已定案——US$9 一次性买断（不含税，Waffo 按地区计税）；每个许可证最多 3 台 Mac、可自助解绑换机；7 天免费试用（客户端本地计时）；购买 14 天内可退款、退款后许可证吊销；永久免费更新；无 umuo 账号。定价页、激活页与条款须一致；模型调用费用由用户另向供应商支付。购买入口由 `apps/web/src/config.ts` 的 `PURCHASE_OPEN` 控制，**默认关闭**（main 合入即部署正式站）：关闭时定价页写「尚未开放购买」；正式 Waffo 建好买断商品、Worker 收费接口可用后再改成 true。Worker 的收费与许可证接口见 `worker/src/billing.ts` 文件头（结账、webhook、领取、激活 / 校验 / 解绑、门户），客户端按其中的 JSON 契约实现。
- **条款与隐私政策**：已按买断授权与请求直连边界改写，v2.2 补入上述购买规则，并写明支付处理方 Waffo 及购买、激活时我们保存的数据（买家随机标识、密钥哈希、设备标识与设备名）。经营者、国家与版本/生效日期仍集中在 `config.ts` 的 `LEGAL_*`；改条款时更新版本与日期，并履行已有通知承诺。
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
