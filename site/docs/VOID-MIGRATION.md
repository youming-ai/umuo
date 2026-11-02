# 现有官网迁至 Void

> 2026-11-02 起 umuo 改为免费开源，收费与许可证代码、`LICENSES` 绑定与 `WAFFO_*` 变量已从仓库删除；
> 下文中关于 Waffo secret 与结账的内容是当时的接管记录，之后的部署不再需要核对 `WAFFO_PRIVATE_KEY`。

目标：保留 `umuo-app`、`umuo.app`、现有 KV / R2 与 Waffo secret，用 Void + Vite 构建，
由 `scripts/cf-deploy.ts` 以 `cf deploy --prebuilt` 部署、`cf` 管理 Cloudflare 资源。

## 当前状态

- 仓库的 `void.config.ts` 声明正式配置；本地门禁包含 Void 构建，生成物不作为配置来源。
- **2026-10-28 生产接管完成**：v72（`1d809512-c92f-45b8-bdb5-d20a47ef1412`）为 Void 构建、`cf` 部署，
  经过与旧版的响应比对、secret 核对与一次真实 Waffo 结账会话创建验证。过程见下方接管记录。
- 2026-10-28 已创建空预览桶 `umuo-releases-preview` 并部署独立 staging `umuo-app-void-staging`
  。远端已验证页面语言、404、`/api/health`、`/__void/ready`、
  更新清单（空桶 204；写入测试对象后 200 + `no-store`，更新包 `immutable`）与下载接口，测试对象已清理。
  Waffo 测试凭据未配置，支付链路未在 staging 验证。2026-10-29 已删除该 Worker 与仓库中的 staging 配置，预览 KV / R2 保留。
- Workers Builds 已恢复自动部署，deploy 命令为 `bun scripts/cf-deploy.ts`（见下方 Workers Builds）。
- 旧 Wrangler 命令不能用于新配置：仓库已无 `wrangler.jsonc`，它可能触发自动配置并部署缺少绑定的 Worker。

## 本地验证

需要 Node ≥ 24.21；本机默认版本低时使用 `mise exec node@24 --`。所有命令在 `site/`：

```bash
bun install --frozen-lockfile
bun run verify
bun run build:web
bun run dev:worker
```

验证首页语言、`/pricing` 301 回 `/`、404、`/api/health`、`/download/macos/update.json` 与 `/__void/ready`；
本地运行使用本地 KV / R2，不证明云端资源、Waffo 凭据或生产网络配置正确。
`bun run build` 使用 Void 1.2.1 的部署构建模式，并检查生成的 Worker 名、域名、访问开关、绑定及就绪探针。

## 静态资源的缓存

Void 1.2.1 的 `routing.headers` 无法覆盖资源响应已有的 `Cache-Control`：Hono 会把旧响应头复制回新响应。
因此正式 Void 配置不设置该规则；静态资源继续由资源层提供缓存头，更新清单由 Worker 明确返回 `no-store`。

## 首次接管生产的门槛（历史记录）

Void 1.2.1 关联已有 Worker 时，必须保留现有绑定；不能在接管过程里同时新增 version metadata。
就绪检查要求现有 Worker 已有 version metadata 绑定，或候选 Version URL 可用。当前线上版本尚无该绑定，且 Version URL 已关闭。
在完成并验证以下方案之一前，**不要运行生产 `void deploy`**：

1. 首选：先给现有 Worker 增加 `VERSION_METADATA` 绑定并验证所有原绑定与 secret；仓库新配置已声明同名绑定。
2. 明确批准并保护临时 Version URL，完成首次接管后恢复原访问策略。

Version URL 使用候选版本的真实资源，开启时默认公开；不能把它当成资源隔离的 staging。
完整核对活动版本、最新上传版本、域名、`workers_dev` / `preview_urls`、KV / R2、secret 名称与日志。
如果有较新的未激活版本，先核实并消除冲突，不强行覆盖其他部署。

准备首选方案的本地产物（只 build / dry-run，不上传）：

```bash
cd site
bun run prepare:handoff <当前线上版本对应的 Git 提交>
```

脚本从该提交的锁文件重建旧版，在临时目录生成 `cf` 构建，仅新增 `VERSION_METADATA`；它核对正式域名、
访问开关、KV / R2、变量、旧资源路由和元数据绑定，再执行 `cf deploy --prebuilt --dry-run`。
该目录需在下一步使用前保持不变；正式部署前再次确认线上活动版本、最新上传版本和 secret 的继承来源。
2026-10-28 只读核查时活动版本对应提交 `cbd74e1`，后续切换前须重新核查，不能假定它仍是当前版本。

确认部署命令仍为无操作或 Workers Builds 已暂停，并完成 staging 验证后，负责人可从仓库根目录执行以下命令，将该产物部署到现有 Worker，增加元数据绑定：

```bash
cd site
UMUO_HANDOFF_CF="$PWD/node_modules/cf/bin/cf"
bun run prepare:handoff <当前线上版本对应的 Git 提交>
cd "<脚本输出的临时 site 路径>"
node "$UMUO_HANDOFF_CF" deploy --prebuilt
```

核对新活动版本仍有原域名、访问开关、KV / R2 和 `WAFFO_PRIVATE_KEY` secret，并新增 `VERSION_METADATA`；
确认官网、健康检查和更新清单正常。若不一致，先回滚，不继续接管。

然后在干净、已审查的迁移代码上执行首次交互式 `bunx void deploy`，选择关联已有 Worker。
Void 关联后生成的 `void.lock.json` 需核验并提交。部署后检查 `umuo.app` 首页、`/api/health`、
`/download/macos/update.json`、`/download/macos/appcast.xml` 与 secret 名称，确认正式绑定和流量。

## 2026-10-28 接管记录

- **元数据接管已完成**：`bun run prepare:handoff cbd74e1` 的产物以 `cf deploy --prebuilt` 部署为 v68
  （`20d65980-65a6-43b8-ae4c-d14f916171e1`），绑定、secret 与线上响应同 v67，仅新增 `VERSION_METADATA`。
  当前生产即 v68；回滚点仍是 v68（或更早的 v67 `1ba7ac99`）。
- **`void deploy` 关联已有 Worker 未成功**，三次都被 Void 自身的校验拦下，未激活：
  1. 候选版本 v69 丢失 `WAFFO_PRIVATE_KEY`：Void 关联时只补 `keep_vars`；它认的 `keep_secrets` 会被
     wrangler@4.152 丢弃。已在 `void.config.ts` 用 `unsafe.metadata.keep_bindings: ['secret_text']` 修正。
  2. 被拒的候选成为「最新上传」后，Void 拒绝在「活动版本 ≠ 最新上传」时继续。
  3. 重试时报「未保留现有 Worker 的 event handlers」，原因未查明（版本 API 无 handlers 字段，疑为 Void 读取方式问题）。
- **事故**：为让最新上传等于活动版本，曾用同一产物 `cf deploy --prebuilt` 重新部署为 v70。**cf 从最新上传
  （缺 secret 的 v69）继承 secret**，v70 因此缺少 `WAFFO_PRIVATE_KEY`，2026-10-28 06:35:24Z–06:36:27Z
  （约 63 秒）`/api/checkout` 与 webhook 返回 503，随后以 `cf workers deployments create` 切回 v68。
  **被拒的候选存在时，不要用 `cf deploy` 重新部署来「重置」**，只用 `deployments create` 指向已核实的版本。
- 交接残留（`.void/cloudflare-link.json`、生产 `void.lock.json`）已从工作区移除，`unsafe` 绕过配置已撤回。
- **改用 `cf` 部署 Void 产物**：`void/deploy` 的 `prepareCfBuildOutput` 把 `dist/ssr` 转成 `cf` 构建输出，
  `scripts/cf-deploy.ts` 核对 Worker 名、域名、访问开关、KV / R2、变量、`VERSION_METADATA` 与 `ASSETS`
  后执行 `cf deploy --prebuilt`。因最新上传是缺 secret 的 v71，首次部署以 `--secrets-file` 显式带上
  `WAFFO_PRIVATE_KEY`，得到 v72 并激活。验证：页面、404、健康检查、更新清单、appcast、下载与旧版一致；
  `/__void/ready` 返回 v72；`WAFFO_PRIVATE_KEY` 为 `secret_text`；`POST /api/checkout` 空体 400、
  有效套餐 200 并返回 Waffo 结账链接。回滚点：v68 `20d65980`。

### 之后的部署

```bash
cd site
bun run deploy            # = bun run build && bun scripts/cf-deploy.ts；加 -- --dry-run 只核对
```

`cf` 从**最新上传**（不是活动版本）继承 secret。Worker 已不需要任何 secret（`WAFFO_PRIVATE_KEY` 可在远端手动删除）；
将来若再加 secret，部署前用 `bunx cf workers versions list --worker-id umuo` 确认最新上传带有它，
否则用 `--secrets-file <json>` 显式带上（文件权限 600，用后删除）。
不要再用 `void deploy` 关联已有 Worker（void@1.2.1 会丢 secret 并被自身校验拦下）。

## Workers Builds

2026-10-28 已恢复自动部署：`main` 上 `site/*` 有改动即触发，root `site`，build `bun run build`，
deploy `bun scripts/cf-deploy.ts`（构建机 Node 24.22.1；`cf` 读取 Workers Builds 注入的 `CLOUDFLARE_API_TOKEN`）。
先以 `--dry-run` 试跑通过，再正式部署出 v73（`50625005`），secret 继承、响应、就绪探针与 Waffo 结账均已核对。
不要改回 `void deploy` 或 `wrangler deploy`。保持 PR 预览关闭，直到单独确定隔离资源与部署策略。
2026-11-02 仓库改名为 `youming-ai/umuo`、Worker 改名为 `umuo` 后，触发器被重建成默认值（root `/`、deploy `npx wrangler deploy`、路径 `*`），
构建去跑了客户端而失败；已用 `cf builds triggers update` 改回 root `/site`、build `bun run build`、deploy `bun scripts/cf-deploy.ts`、路径 `site/*`。
以后改名或重连仓库后，先用 `cf builds triggers list --external-script-id <Worker ID>` 核对这四项。
最新上传若缺少 secret（例如本地手动部署时出错），自动部署会继承这个缺口，须先用 `--secrets-file` 手动补齐。

## 回滚

切换前记录当前生产 Version ID 与完整 Workers Builds 设置。需要回滚时先停止自动构建，
由负责人用 `bunx cf workers deployments create --worker umuo --strategy percentage --versions '[{"version_id":"<ID>","percentage":100}]'`
恢复已记录的版本（不要用重新部署来回滚），并核对域名及访问开关。
回滚代码不回滚 KV / R2 数据；恢复旧构建命令前同时恢复对应版本的配置。
