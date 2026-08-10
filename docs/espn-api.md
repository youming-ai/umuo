# ESPN 隐藏 API 接入文档（历史）

> ⚠️ **历史文档（2026 归档）**：本文档原记录 umuo 的 ESPN 记分板接入（scoreboard / standings / summary / teams / injuries / transactions / leaders，经 `src/data/api.ts` 的 `serve*` + KV SWR 缓存）。该平面已于 2026 年随比赛类页面整体移除（PR #83），产品现为纯新闻聚合 + AI 加工。
>
> ESPN 如今只作为 ~20 个 ingest 源之一存在：`src/feeds/sources.ts` 的 `espn-*` 源经 `src/competitions.ts` 的 `buildUrl()` 拉取 `site.api.espn.com/apis/site/v2/sports/soccer/{league}/news?limit=50`，由 `src/feeds/ingest.ts`（注意其 `API_JSON_HEADERS` 的 `curl/8.7.1` UA——ESPN 按 UA 名放行）与 `src/newsFeed.ts`（`parseNewsFeed`）消费。
>
> 本文内容已不反映现状，仅作为历史参考保留（`docs/superpowers/plans/*` 仍引用）。
