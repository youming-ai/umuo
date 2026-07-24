# 体育新闻分类系统 — API接口文档与产品规划说明书 (PRD)

本规划书旨在指导 umuo 在世界杯结束后，成功转型为高可用、多视角的**体育新闻分类站（Sports News Classification Portal）**。系统将充分利用已验证的 Cloudflare Workers 边缘代理架构，以 ESPN 公开 API 为核心数据源，支持多项目比分、数据与新闻的深度分类和智能联动。

---

# 第一部分：完整 API 接口文档 (API Reference)

## 1. 全局配置与代理基础

* **本地开发代理基准**：`http://localhost:5173/api`
* **生产环境代理基准**：`https://[your-worker-domain]/api`
* **请求头要求**（由 Worker 代理自动注入，防止上游拒签）：
  ```http
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36
  Accept: application/json, text/plain, */*
  Accept-Language: en-US,en;q=0.9
  ```

---

## 2. 核心新闻 API (ESPN Now API)

用于实时拉取全局、各大项、各联赛或特定球队的新闻流。

### 2.1 获取综合实时新闻 (Global News Feed)
* **接口地址**：`GET /api/news`（Worker 代理至 `https://now.core.api.espn.com/v1/sports/news`）
* **查询参数**：
  * `limit` (number, 可选): 返回条数，默认 `20`，最大 `50`。
* **响应格式 (JSON)**：
  ```json
  {
    "count": 50,
    "headlines": [
      {
        "headline": "Lakers naming JJ Redick head coach",
        "description": "The Lakers have agreed to a four-year contract with JJ Redick.",
        "published": "2026-07-06T18:30:00Z",
        "type": "story",
        "links": {
          "web": {
            "href": "https://www.espn.com/nba/story/_/id/..."
          }
        },
        "images": [
          {
            "url": "https://a.espncdn.com/media/motion/..."
          }
        ],
        "categories": [
          {
            "id": 46,
            "description": "Lakers",
            "type": "team",
            "sportId": 46
          }
        ]
      }
    ]
  }
  ```

### 2.2 按体育大项过滤新闻 (Sport-Filtered News)
* **接口地址**：`GET /api/news?sport={sport_slug}`
* **常用大项 Slug**：`soccer` (足球), `basketball` (篮球), `football` (美式橄榄球), `baseball` (棒球), `hockey` (冰球), `golf` (高尔夫), `tennis` (网球), `racing` (赛车)。
* **示例**：`GET /api/news?sport=soccer&limit=10`

### 2.3 按联赛过滤新闻 (League-Filtered News)
* **接口地址**：`GET /api/news?leagues={league_slug}`
* **常用联赛 Slug**：`nba` (NBA), `eng.1` (英超), `esp.1` (西甲), `nfl` (NFL), `mlb` (MLB), `nhl` (NHL)。
* **示例**：`GET /api/news?leagues=nba&limit=10`

### 2.4 按特定球队过滤新闻 (Team-Filtered News)
* **接口地址**：`GET /api/news?team={team_abbrev}`（使用标准小写缩写，如 `lal`, `dal`, `che`, `mci`）
* **示例**：`GET /api/news?team=che&limit=10`（切尔西相关新闻）

---

## 3. 赛事比分与数据接口 (Scoreboard & Summary API)

用于在分类栏目顶部展示实时比赛状态，或与新闻详情进行关联战报绑定。

### 3.1 获取赛事今日比分板 (Scoreboard)
* **接口地址**：`GET /api/{sport}/{league}/scoreboard`（Worker 代理至 `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard`）
* **查询参数**：
  * `dates` (string, 可选): 格式为 `YYYYMMDD`（如 `20260706`）。若省略则返回当前最新的比赛日。
* **响应主要结构**：
  ```json
  {
    "events": [
      {
        "id": "401584000",
        "date": "2026-07-06T23:30:00Z",
        "name": "Dallas Mavericks at Los Angeles Lakers",
        "shortName": "DAL @ LAL",
        "status": {
          "type": {
            "name": "STATUS_IN_PROGRESS",
            "state": "in",
            "detail": "3rd Quarter"
          }
        },
        "competitions": [
          {
            "competitors": [
              {
                "homeAway": "home",
                "score": "88",
                "team": {
                  "id": "13",
                  "displayName": "Los Angeles Lakers",
                  "abbreviation": "LAL",
                  "logo": "https://a.espncdn.com/i/teamlogos/nba/500/lal.png"
                }
              }
            ]
          }
        ]
      }
    ]
  }
  ```

### 3.2 获取比赛详情/战报数据 (Game Summary)
* **接口地址**：`GET /api/{sport}/{league}/summary?event={eventId}`
* **响应主要结构**：
  包含单场比赛全方位的统计指标（如控球率、投篮命中率、红黄牌、节比分、伤病及实时进展），是战报页面和新闻侧栏卡片的数据核心。

---

## 4. 排行榜与统计数据接口 (Standings & Leaders API)

### 4.1 积分榜与分区表 (Standings)
* **接口地址**：`GET /api/{sport}/{league}/standings`（Worker 代理至 `https://site.api.espn.com/apis/v2/sports/{sport}/{league}/standings`）
* **核心提示**：该接口**必须**使用 `/apis/v2/`。使用 `/apis/site/v2/` 将返回无效占位符。

### 4.2 数据王与个人排行 (Leaders)
* **接口地址**：`GET /api/{sport}/{league}/leaders`
* **用途**：展示各赛事的进球榜（Soccer Goals）、助攻榜、得分榜（Basketball Points）。

---

## 5. 全球媒体 CDN 资源接口 (ESPN Media Assets)

项目可直接集成 ESPN 稳定、免签的图片服务，以丰富分类站的文章配图和球队信息卡。

* **球队高清 Logo (500x500 PNG)**:
  `https://a.espncdn.com/i/teamlogos/{sport}/500/{abbrev}.png`
  *(如湖人队: `https://a.espncdn.com/i/teamlogos/nba/500/lal.png`)*
* **球员免抠图高清头像**:
  `https://a.espncdn.com/i/headshots/{sport}/players/full/{playerId}.png`
  *(如詹姆斯: `https://a.espncdn.com/i/headshots/nba/players/full/1966.png`)*

---

# 第二部分：产品规划文档 (PRD)

## 1. 产品概述 (Product Overview)

### 1.1 项目背景与定位
随着世界杯等杯赛赛程的完结，单一赛事的流量会自然回落。本项目将转型为**体育新闻分类站（代号: umuo）**。网站定位为“高性能、极速、无广告的个性化体育新闻与赛事数据中枢”。它不再仅仅是一个比分板，而是以“新闻阅读为核心，实时数据为辅助，大项分类为驱动”的综合新闻分类平台。

### 1.2 核心愿景
* **极致性能**：延续 SPA 路由与 Cloudflare Workers 的边缘缓存优势，新闻加载延迟控制在 200ms 以内。
* **精准分类**：全自动汇聚足球（英超、欧冠、西甲、MLS等）、篮球（NBA、NCAA等）及其他大项的最新资讯。
* **数据与内容整合**：在阅读比赛战报或球队交易新闻时，侧栏或段落间无缝嵌入当前的赛事积分表、近期对阵卡片或球员生涯图表。

---

## 2. 目标用户与使用场景 (Target Users & Scenarios)

* **体育新闻爱好者**：每天多次刷新，希望在几秒钟内浏览完各大联赛的最硬干货（交易风向、赛后总结、伤病报告），讨厌弹窗广告和臃肿的客户端。
* **数据分析控**：在查看比分战报时，需要立刻查验积分榜变动、胜率差以及接下来的赛程走势。
* **特定主队粉丝**：仅关注切尔西、湖人等特定俱乐部的新闻和赛程动态。

---

## 3. 功能模块规划 (Functional Modules)

### 3.1 首页与推荐流 (Dashboard & Feed)
* **主推荐流**：混排全局最热的 20 条实时头条，采用渐进式加载（Infinite Scroll）。
* **顶置比分横条 (Scoreboard Bar)**：滚动展示当日各大项正在进行的焦点对阵，点击直接进入“战报模式”。

### 3.2 垂直分类导航栏 (Category Navigation)
* **一级导航**：足球、篮球、综合赛车、高尔夫、网球、综合格斗（MMA）。
* **二级导航（联赛）**：
  * 足球下设：英超、西甲、意甲、德甲、欧冠、美职联。
  * 篮球下设：NBA、WNBA、NCAA 男篮。
  * 赛车下设：F1、NASCAR。

### 3.3 新闻详情与智能组件联动 (Smart News View)
* **极速阅读器**：正文排版精美，支持多语言快速一键翻译（中、英、日、韩）。
* **智能联动卡片**：
  * 新闻中提及某场比赛（如“湖人险胜独行侠”）时，自动解析出 GameId，并在新闻底部渲染**“该场比赛 Boxscore / 进程速览”**。
  * 新闻提及某球员时，渲染**“球员卡片 & 赛季均值数据”**。

### 3.4 球队与球员专属主页 (Team / Player Aggregation)
* **动态聚合**：用户点击新闻中的球队或球员时，跳转至专属聚合页。
* **数据速递**：展示该球队的最新 5 场 Form 走势、赛程，以及该球员的高清免抠图头像与实时赛季数据表。

### 3.5 离线缓存与 PWA 支持 (PWA & Offline Mode)
* 充分利用 Service Worker 在本地拦截网络请求，对于已加载的新闻进行强缓存，支持离线状态下的文字流畅阅读，配合暗色/浅色 Apple 拟态主题。

---

## 4. 后端与边缘缓存策略 (Cache & Backend Strategy)

| 资源类别 | 接口地址 | 缓存新鲜度 (Fresh) | 缓存保留期 (Keep) | Coalescing (合并) |
| :--- | :--- | :--- | :--- | :--- |
| **实时全局新闻** | `/api/news` | 120 秒 | 24 小时 | 是 |
| **联赛/球队新闻** | `/api/news?leagues=...` | 300 秒 | 24 小时 | 是 |
| **赛事比分板** | `/api/{sport}/{league}/scoreboard`| 60 秒 | 24 小时 | 是 |
| **赛事积分榜** | `/api/{sport}/{league}/standings` | 600 秒 | 24 小时 | 否 |
| **单场详细战报** | `/api/{sport}/{league}/summary` | 30 秒 | 24 小时 | 是 |

---

## 5. 项目转型实施路线图 (Roadmap)

```
[阶段一: 基础框架迁移] ──> [阶段二: 新闻采集与分类引擎] ──> [阶段三: 数据新闻联动渲染] ──> [阶段四: PWA与性能优化]
```

### 阶段一：基础框架迁移与 API 代理扩展 (第 1 - 2 周)
* 修改 `wrangler.jsonc` 命名空间至 `"umuo"`。
* 编写双 TS 校验脚本，在 Worker 代理层新设 `/api/news` 数据路由转发，支持按 Sport 和 League 的 Query 请求。

### 阶段二：新闻分类展示与 Tag 引擎研发 (第 3 - 4 周)
* 前端增加 `FixturesView` 外的新闻分类展示面板，在 `src/utils/router.ts` 新增 `/news/:sport` 及 `/news/league/:league` 路径支持。
* 解析 Now API 响应中的 `categories` 实体，为每条新闻打上球队/球员的唯一 Tag，实现球队专属页的新闻聚合。

### 阶段三：数据新闻联动卡片 (第 5 - 6 周)
* 重组 `MatchDetailPage` 和 `PlayerPage`，支持从新闻文章点击球员头像/球队直接关联其统计数据。
* 封装通用比分条组件（Marquee Scoreboard），嵌入首页顶部。

### 阶段四：PWA 离线优化与全面 QA (第 7 周)
* 增强 `public/sw.js` 缓存算法，对已经阅读的新闻文本实施 Cache-First 离线持久化存储。
* 运行全套 Vitest 单元测试，确保无 Mock 漏洞，正式发布上线。
