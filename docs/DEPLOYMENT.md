# 部署指南

本指南说明如何将 UMUO 部署到 Cloudflare Pages。

## 快速部署

### 1. 构建项目

```bash
bun run build
```

构建输出目录: `dist/`

### 2. Cloudflare Pages 部署

#### 方式一：Git 集成 (推荐)

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Pages** → **Create application**
3. 连接 GitHub 仓库
4. 配置构建设置：

| 设置 | 值 |
|------|-----|
| Build command | `bun run build` |
| Build output directory | `dist` |
| Node.js version | `18` |

#### 方式二：Wrangler CLI

```bash
# 安装 Wrangler
bun add -g wrangler

# 登录 Cloudflare
wrangler auth login

# 部署
wrangler pages deploy dist --project-name umuo
```

## 环境变量

在 Cloudflare Pages 设置中配置：

```bash
NODE_ENV=production
```

## 自定义域名

1. 在 Cloudflare Pages 项目设置中添加自定义域名
2. 配置 DNS 记录：
   - CNAME: `www` → `umuo.pages.dev`
   - 或使用 Cloudflare 代理的 A 记录

## 构建统计

```
页面数量:     116
构建时间:     < 4 秒
输出大小:     约 2.5 MB
```

## 缓存配置

静态资产自动通过 Cloudflare CDN 缓存。API 响应包含以下缓存头：

```javascript
'Cache-Control': 'public, max-age=300' // 5 分钟缓存
```

## 故障排除

### 构建失败

```bash
# 清除缓存重新构建
rm -rf node_modules dist
bun install
bun run build
```

### 环境变量问题

确保在 Cloudflare Pages 设置中正确配置所有必需的环境变量，然后重新部署。

---

*最后更新: 2024-12-23*
