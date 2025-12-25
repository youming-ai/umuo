# 📚 UMUO 项目文档

UMUO 是一个日本价格比较网站，使用 **Astro** 框架构建，部署在 **Cloudflare Pages**。

## 📋 文档目录

| 文档 | 描述 |
|------|------|
| [API 文档](./API_DOCUMENTATION.md) | 后端 API 接口详细说明 |
| [路由文档](./ROUTES_DOCUMENTATION.md) | 前端路由结构和页面说明 |
| [部署指南](./DEPLOYMENT.md) | Cloudflare Pages 部署配置 |
| [开发指南](./DEVELOPMENT.md) | 本地开发和技术架构说明 |

---

## 🚀 技术栈

```
Framework:      Astro 5.x (Static Generation)
UI Components:  React 19 (Islands Architecture)
Styling:        Tailwind CSS 3.x
State:          Zustand + React Query
Package:        Bun
Deployment:     Cloudflare Pages (Static)
```

## 📁 项目结构

```
src/
├── components/
│   ├── islands/       # React 交互组件 (client:load)
│   │   ├── SearchBar.jsx
│   │   ├── FilterPanel.jsx
│   │   └── BottomNav.jsx
│   ├── ui/            # 静态 UI 组件
│   │   ├── ProductCard.jsx
│   │   └── Header.astro
│   └── layout/        # 布局组件
├── pages/
│   ├── index.astro           # 首页
│   ├── search.astro          # 搜索页
│   ├── deals.astro           # 特惠页
│   ├── compare.astro         # 比较页
│   ├── alerts.astro          # 提醒页
│   ├── profile.astro         # 用户页
│   ├── products/[slug].astro # 产品详情
│   ├── categories/           # 分类系统
│   └── api/                  # API 端点
├── layouts/
│   └── BaseLayout.astro
├── lib/
│   └── mock/          # Mock 数据和服务
├── styles/
│   └── global.css
└── store/             # Zustand 状态管理
```

## 🛠️ 快速开始

```bash
# 安装依赖
bun install

# 本地开发
bun run dev

# 构建生产版本
bun run build

# 预览生产版本
bun run preview
```

## ✨ 主要功能

- **价格比较**: 从多个 EC 平台比较商品价格
- **智能搜索**: 实时搜索建议和筛选功能
- **价格提醒**: 设置目标价格，价格下降时通知
- **分类浏览**: 12 个主要分类，支持子分类筛选
- **AI 分析**: AI 驱动的评论摘要和购买建议

## 📊 性能指标

- **Lighthouse Score**: 95+
- **First Contentful Paint**: < 1s
- **Build Time**: < 4s (116 pages)
- **Bundle Size**: Islands only, minimal JS

---

*最后更新: 2024-12-23*