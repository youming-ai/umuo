# UMUO 路由结构文档

本文档描述了 UMUO 应用的完整路由结构，包括所有改进后的路由。

## 更新时间
2024-01-20

## 路由结构总览

### 核心页面路由

| 路径 | 描述 | 文件位置 |
|------|------|----------|
| `/` | 首页 | `src/pages/index.astro` |
| `/search` | 搜索页面（支持查询参数） | `src/pages/search.astro` |
| `/compare` | 产品比较页面 | `src/pages/compare.astro` |
| `/deals` | 特惠商品页面 | `src/pages/deals.astro` |
| `/alerts` | 价格提醒页面 | `src/pages/alerts.astro` |
| `/profile` | 用户资料页面 | `src/pages/profile.astro` |
| `/404` | 404错误页面 | `src/pages/404.astro` |

### 动态路由

| 路径 | 描述 | 文件位置 |
|------|------|----------|
| `/products/[slug]` | 动态产品详情页 | `src/pages/products/[slug].astro` |
| `/categories/[category]` | 动态分类页面 | `src/pages/categories/[category].astro` |

### 分类路由

| 路径 | 描述 | 文件位置 |
|------|------|----------|
| `/categories` | 分类列表页 | `src/pages/categories/index.astro` |
| `/categories/[category]` | 特定分类的商品列表 | `src/pages/categories/[category].astro` |

### 用户资料子路由

| 路径 | 描述 | 文件位置 |
|------|------|----------|
| `/profile` | 用户资料主页 | `src/pages/profile.astro` |
| `/profile/settings` | 账户设置 | `src/pages/profile/settings.astro` |
| `/profile/alerts` | 价格提醒管理 | `src/pages/profile/alerts.astro` |

### API 路由

| 路径 | 描述 | 文件位置 |
|------|------|----------|
| `/api/search.json` | 商品搜索 API | `src/pages/api/search.json.ts` |
| `/api/products/[slug].json` | 产品详情 API | `src/pages/api/products/[slug].json.ts` |
| `/api/compare.json` | 产品比较 API | `src/pages/api/compare.json.ts` |

## 查询参数支持

### 搜索页面 `/search`

支持的查询参数：
- `q`: 搜索关键词
- `category`: 分类筛选
- `platform`: 平台筛选
- `minPrice`: 最低价格
- `maxPrice`: 最高价格
- `sort`: 排序方式 (relevance, price_low, price_high, rating, newest, discount)
- `page`: 页码
- `limit`: 每页数量

示例：
```
/search?q=iPhone&category=家電&sort=price_low&page=1
```

### 分类页面 `/categories/[category]`

支持的查询参数：
- `subcategory`: 子分类筛选
- `sort`: 排序方式 (popular, price-low, price-high, newest, discount)
- `page`: 页码

示例：
```
/categories/家電・カメラ?subcategory=スマートフォン&sort=price-low
```

### API 搜索 `/api/search.json`

支持的查询参数：
- `q`: 搜索关键词
- `category`: 分类筛选
- `platform`: 平台筛选
- `minPrice`: 最低价格
- `maxPrice`: 最高价格
- `sort`: 排序方式
- `page`: 页码
- `limit`: 每页数量

### API 比较 `/api/compare.json`

支持的查询参数：
- `ids`: 要比较的产品ID列表（逗号分隔）

示例：
```
/api/compare.json?ids=1,2,3
```

## 动态路由特性

### 产品动态路由 `/products/[slug]`

- 支持 `getStaticPaths` 预生成
- 根据产品 slug 动态获取数据
- 404 错误自动重定向
- SEO 优化的 meta 标签

### 分类动态路由 `/categories/[category]`

- 支持 `getStaticPaths` 预生成
- 支持子分类筛选
- 分页功能
- 多种排序选项

## 新增功能

### 1. 动态产品路由
- 替换静态的 iPhone 产品页面
- 支持任意产品 slug
- 统一的产品详情模板

### 2. 分类系统
- 12个主要分类
- 每个分类包含多个子分类
- 分类页面的产品列表和筛选

### 3. 用户资料子路由
- `/profile/settings`: 完整的账户设置
- `/profile/alerts`: 价格提醒管理

### 4. API 端点
- RESTful API 设计
- CORS 支持
- 适当的缓存头
- 标准化错误响应

## 导航更新

Header 组件已更新，包含以下链接：
- カテゴリー (Categories)
- 検索 (Search)
- 比較 (Compare)
- お得 (Deals)
- お知らせ (Alerts)

## SEO 优化

所有路由都包含：
- 动态生成的标题
- 描述性的 meta description
- Open Graph 标签
- Twitter Card 标签

## 注意事项

1. 所有 API 路由返回 JSON 格式
2. 动态路由使用 mock 数据，实际部署时需要连接真实数据库
3. 分页默认每页 20 个结果
4. 搜索 API 支持多种排序和筛选选项
5. 所有页面都使用 BaseLayout 以保持一致性

## 未来扩展计划

1. `/api/users/[userId]`: 用户信息 API
2. `/api/alerts`: 价格提醒 CRUD API
3. `/api/categories`: 分类信息 API
4. `/search/[query]`: 搜索结果的永久链接
5. `/products/[category]/[slug]`: 带分类的产品路由
6. `/users/[userId]`: 公开的用户资料页面