# 开发指南

本文档描述了 UMUO 项目的技术架构和开发规范。

## 技术架构

### Astro Islands Architecture

UMUO 使用 Astro 的岛屿架构，将静态内容与交互式 React 组件分离：

```astro
---
// 服务端代码 - 构建时执行
import { mockService } from '../lib/mock/service';
const products = mockService.getProducts({ limit: 10 });
---

<!-- 静态 HTML - 0 JavaScript -->
<section class="products-grid">
  {products.map(product => (
    <ProductCard product={product} />
  ))}
</section>

<!-- React Island - 按需加载 JavaScript -->
<SearchBar client:load />
<FilterPanel client:visible />
```

### 客户端指令

| 指令 | 描述 | 使用场景 |
|------|------|---------|
| `client:load` | 页面加载时立即水合 | 搜索栏、导航菜单 |
| `client:visible` | 进入视口时水合 | 图表、懒加载组件 |
| `client:idle` | 浏览器空闲时水合 | 非关键交互组件 |
| `client:only="react"` | 仅客户端渲染 | 依赖浏览器 API 的组件 |

## 项目配置

### astro.config.mjs

```javascript
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://umuo.ai',
  output: 'static',  // 静态生成
  integrations: [
    react({
      jsxImportSource: 'react',
      jsxRuntime: 'automatic'
    }),
    tailwind({
      applyBaseStyles: false
    }),
    sitemap()
  ]
});
```

### TypeScript 配置

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## 组件开发规范

### Astro 组件 (.astro)

用于静态内容，无客户端 JavaScript：

```astro
---
// src/components/ui/ProductCard.astro
interface Props {
  product: Product;
}

const { product } = Astro.props;
---

<article class="product-card">
  <img src={product.image} alt={product.name} />
  <h3>{product.name}</h3>
  <p class="price">¥{product.price.toLocaleString()}</p>
</article>
```

### React 组件 (.jsx/.tsx)

用于交互式功能，按需加载：

```jsx
// src/components/islands/SearchBar.jsx
import { useState } from 'react';

export default function SearchBar() {
  const [query, setQuery] = useState('');
  
  const handleSubmit = (e) => {
    e.preventDefault();
    window.location.href = `/search?q=${encodeURIComponent(query)}`;
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="商品を検索..."
      />
      <button type="submit">検索</button>
    </form>
  );
}
```

## 数据层

### Mock Service

开发环境使用 Mock 数据服务：

```typescript
// src/lib/mock/service.ts
export const mockService = {
  getProducts(options) { ... },
  getProductBySlug(slug) { ... },
  getCategories() { ... },
  getFeaturedDeals() { ... },
  getPriceHistory(productId) { ... }
};
```

### 使用方式

```astro
---
import { mockService } from '../lib/mock/service';

// getStaticPaths - 动态路由
export async function getStaticPaths() {
  const products = mockService.getProducts({ limit: 100 }).products;
  return products.map(p => ({
    params: { slug: p.slug },
    props: { product: p }
  }));
}

const { product } = Astro.props;
---
```

## 样式规范

### Tailwind CSS

使用 Tailwind CSS 的工具类：

```css
/* src/styles/global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer components {
  .btn {
    @apply inline-flex items-center justify-center px-4 py-2 rounded-lg
           font-medium transition-colors;
  }
  
  .btn-primary {
    @apply bg-primary-600 text-white hover:bg-primary-700;
  }
}
```

### 设计系统

| 类别 | 说明 |
|------|------|
| 圆角 | `rounded-2xl` ~ `rounded-[3rem]` 大圆角设计 |
| 阴影 | `shadow-xl shadow-gray-200/50` 柔和阴影 |
| 动画 | `animate-fade-in`, `animate-slide-up` 入场动画 |
| 间距 | 大量留白，`p-8` ~ `p-12` 内边距 |

## 本地开发

### 开发服务器

```bash
bun run dev
# 访问 http://localhost:4321
```

### 类型检查

```bash
bunx astro check
```

### 构建预览

```bash
bun run build
bun run preview
```

## 常见问题

### Lucide 图标在 Astro 中的使用

在 `.astro` 文件中使用 `className` 而非 `class`：

```astro
<Search className="w-5 h-5 text-gray-400" />
```

### 避免在 Astro Frontmatter 中使用 JSX

错误 ❌:
```astro
---
const icon = <Zap className="w-4 h-4" />;
---
```

正确 ✅:
```astro
---
const iconType = 'zap';
---

{iconType === 'zap' && <Zap className="w-4 h-4" />}
```

### 动态路由的 getStaticPaths

动态路由 `[slug].astro` 必须导出 `getStaticPaths`：

```astro
---
export async function getStaticPaths() {
  const items = await fetchItems();
  return items.map(item => ({
    params: { slug: item.slug },
    props: { item }
  }));
}
---
```

---


## Deployments

### Cloudflare Pages

1. **Build Project**: `bun run build` (output: `dist/`)
2. **Deploy**:
   - **Git Integration (Recommended)**: Connect GitHub repo to Cloudflare Pages.
     - Build command: `bun run build`
     - Output directory: `dist`
     - Node.js version: `18` (or compatible)
   - **Wrangler CLI**: `wrangler pages deploy dist --project-name umuo`

### Environment Variables

Configure in Cloudflare Pages settings:
```bash
NODE_ENV=production
```

## Route Structure

| Path | Description | Type |
|------|-------------|------|
| `/` | Home Page | Static |
| `/search` | Search Page | Static + Client Search |
| `/compare` | Comparison Page | Static + Client Interaction |
| `/products/[slug]` | Product Detail | Dynamic (getStaticPaths) |
| `/categories/[category]` | Category Detail | Dynamic (getStaticPaths) |
| `/api/*` | API Endpoints | Server/Static Functions |

For a complete list of routes, refer to the `src/pages` directory structure.

