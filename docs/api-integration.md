# API Integration Documentation

## 概述

本文档描述了 Yabaii 价格比较应用与日本主要电商平台的 API 集成方案。

## 支持的电商平台

### 1. Amazon Japan (https://www.amazon.co.jp/)

**API 类型**: Amazon Product Advertising API v5.0

**认证方式**:
- Access Key ID & Secret Access Key
- Associate Tag (affiliate tracking)

**主要功能**:
- 商品搜索 (by keywords, ASIN, JAN)
- 价格信息获取
- 商品详情 (标题、描述、图片)
- 库存状态检查
- 客户评价数据

**API 端点示例**:
```
GET https://webservices.amazon.com/paapi5/searchitems
GET https://webservices.amazon.com/paapi5/getitems
```

**数据字段映射**:
```json
{
  "asin": "ASIN标识符",
  "title": "商品标题",
  "price": {
    "amount": 价格数值,
    "currency": "JPY"
  },
  "availability": "库存状态",
  "url": "商品链接(带associate tag)",
  "images": ["图片URL数组"],
  "rating": "评分",
  "reviews_count": "评价数量"
}
```

**限制说明**:
- 每秒请求限制: 1 request/second
- 每日请求限制: 8640 requests/day
- 需要日本地区 IP 或代理

### 2. Yahoo Shopping (https://shopping.yahoo.co.jp/)

**API 类型**: Yahoo Shopping Web API

**认证方式**:
- Application ID
- Client ID (可选)
- Secret (可选)

**主要功能**:
- 商品搜索 (by keywords, JAN code)
- 价格比较
- 商品详情获取
- 店铺信息
- 评价数据

**API 端点示例**:
```
GET https://shopping.yahooapis.jp/ShoppingWebService/V1/itemSearch
GET https://shopping.yahooapis.jp/ShoppingWebService/V1/itemLookup
```

**数据字段映射**:
```json
{
  "code": "商品代码",
  "name": "商品名称",
  "price": {
    "amount": 价格数值,
    "currency": "JPY"
  },
  "availability": "在库状态",
  "url": "商品链接",
  "image": {
    "medium": "中等尺寸图片",
    "large": "大尺寸图片"
  },
  "review": {
    "rate": "评分",
    "count": "评价数量"
  },
  "store": {
    "name": "店铺名称",
    "url": "店铺链接"
  }
}
```

**限制说明**:
- 每日请求限制: 50,000 requests/day
- 需要申请 Yahoo Japan 开发者账号

### 3. Rakuten (https://www.rakuten.co.jp/)

**API 类型**: Rakuten Ichiba API

**认证方式**:
- Application ID
- Affiliate ID (可选，用于佣金跟踪)

**主要功能**:
- 商品搜索 (by keywords, JAN code)
- 价格信息
- 商品详情
- 店铺信息
- 商品评价

**API 端点示例**:
```
GET https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706
GET https://app.rakuten.co.jp/services/api/IchibaItem/Lookup/20170706
```

**数据字段映射**:
```json
{
  "itemCode": "商品代码",
  "itemName": "商品名称",
  "itemPrice": 价格数值,
  "availability": "在库状况",
  "itemUrl": "商品链接",
  "mediumImageUrls": ["图片URL数组"],
  "reviewAverage": "平均评分",
  "reviewCount": "评价数量",
  "shopName": "店铺名称",
  "shopUrl": "店铺链接"
}
```

**限制说明**:
- 每秒请求限制: 1 request/second
- 每日请求限制: 10,000 requests/day
- 需要申请 Rakuten 开发者账号

## API 集成架构

### 1. 统一接口层

所有电商平台 API 通过统一的接口层访问，隐藏平台差异：

```typescript
interface ProductSearchRequest {
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'price' | 'rating' | 'relevance';
}

interface ProductSearchResult {
  products: Product[];
  totalResults: number;
  pageSize: number;
  currentPage: number;
}

interface Product {
  id: string;
  title: string;
  description?: string;
  price: PriceInfo;
  platform: Platform;
  availability: Availability;
  images: Image[];
  rating?: Rating;
  url: string;
  janCode?: string;
  platformSpecific: Record<string, any>;
}
```

### 2. 平台适配器模式

每个电商平台都有对应的适配器：

```typescript
interface PlatformAdapter {
  search(request: ProductSearchRequest): Promise<ProductSearchResult>;
  getProductDetails(productId: string): Promise<Product>;
  getByJanCode(janCode: string): Promise<Product[]>;
}

class AmazonAdapter implements PlatformAdapter {
  private apiClient: AmazonAPIClient;

  async search(request: ProductSearchRequest): Promise<ProductSearchResult> {
    // Amazon API 调用逻辑
    const response = await this.apiClient.searchItems({
      Keywords: request.query,
      MinPrice: request.minPrice,
      MaxPrice: request.maxPrice,
      SortBy: this.mapSortOption(request.sort)
    });

    return this.transformAmazonResponse(response);
  }

  private transformAmazonResponse(response: AmazonResponse): ProductSearchResult {
    // 数据转换逻辑
  }
}
```

### 3. 聚合服务

聚合服务负责从所有平台获取数据并合并结果：

```typescript
class ProductAggregationService {
  private adapters: Map<Platform, PlatformAdapter>;

  async searchAllPlatforms(request: ProductSearchRequest): Promise<ProductSearchResult> {
    const platformPromises = Array.from(this.adapters.entries()).map(
      async ([platform, adapter]) => {
        try {
          const result = await adapter.search(request);
          return { platform, result };
        } catch (error) {
          console.error(`Error searching ${platform}:`, error);
          return { platform, result: { products: [], totalResults: 0 } };
        }
      }
    );

    const platformResults = await Promise.allSettled(platformPromises);
    return this.mergeResults(platformResults);
  }

  private mergeResults(results: PromiseSettledResult<{ platform: Platform, result: ProductSearchResult }[]>): ProductSearchResult {
    // 合并和排序逻辑
  }
}
```

## 数据存储策略

### 1. 缓存层

使用 Redis 作为缓存层，提高响应速度：

```typescript
interface CacheConfig {
  productSearch: { ttl: 300 }; // 5分钟
  productDetails: { ttl: 1800 }; // 30分钟
  priceHistory: { ttl: 86400 }; // 24小时
}

class CacheService {
  async getSearchResults(cacheKey: string): Promise<ProductSearchResult | null> {
    const cached = await redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  async setSearchResults(cacheKey: string, results: ProductSearchResult): Promise<void> {
    await redis.setex(cacheKey, 300, JSON.stringify(results));
  }
}
```

### 2. 数据库模式

PostgreSQL 用于存储产品信息和价格历史：

```sql
-- 产品表
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spu_id VARCHAR(255) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category_id UUID REFERENCES categories(id),
  brand VARCHAR(255),
  images JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 平台产品映射表
CREATE TABLE platform_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  platform VARCHAR(50) NOT NULL,
  platform_product_id VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  availability VARCHAR(50),
  platform_specific JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(platform, platform_product_id)
);

-- 价格历史表
CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_product_id UUID REFERENCES platform_products(id),
  price_amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'JPY',
  recorded_at TIMESTAMP DEFAULT NOW(),
  source VARCHAR(100) DEFAULT 'api'
);
```

## 错误处理和重试策略

### 1. API 限制处理

```typescript
class RateLimiter {
  private limiter = new Map<string, { count: number; resetTime: number }>();

  async checkLimit(platform: Platform): Promise<boolean> {
    const limits = this.getPlatformLimits(platform);
    const key = `${platform}_${this.getCurrentHour()}`;
    const current = this.limiter.get(key) || { count: 0, resetTime: this.getNextHour() };

    if (current.count >= limits.perHour) {
      const waitTime = current.resetTime - Date.now();
      if (waitTime > 0) {
        await this.sleep(waitTime);
        current.count = 0;
        current.resetTime = this.getNextHour();
      }
    }

    current.count++;
    this.limiter.set(key, current);
    return true;
  }
}
```

### 2. 降级策略

```typescript
class FallbackService {
  async searchWithFallback(request: ProductSearchRequest): Promise<ProductSearchResult> {
    try {
      // 尝试实时搜索
      return await this.aggregationService.searchAllPlatforms(request);
    } catch (error) {
      console.warn('Real-time search failed, using cached data:', error);

      // 降级到缓存数据
      const cachedResults = await this.cacheService.getSearchResults(
        this.generateCacheKey(request)
      );

      if (cachedResults) {
        return cachedResults;
      }

      // 最后降级到热门商品
      return await this.getPopularProducts(request.category);
    }
  }
}
```

## 性能优化

### 1. 并行请求

```typescript
async function parallelPlatformSearch(request: ProductSearchRequest): Promise<ProductSearchResult[]> {
  const platformRequests = [
    amazonAdapter.search(request),
    rakutenAdapter.search(request),
    yahooAdapter.search(request)
  ];

  const results = await Promise.allSettled(platformRequests);

  return results
    .filter((result): result is PromiseFulfilledResult<ProductSearchResult> =>
      result.status === 'fulfilled')
    .map(result => result.value);
}
```

### 2. 数据预加载

```typescript
class PreloadService {
  @Cron('0 */6 * * *') // 每6小时执行
  async preloadPopularProducts() {
    const categories = await this.getPopularCategories();

    for (const category of categories) {
      const request: ProductSearchRequest = {
        query: category.keywords,
        category: category.id,
        sort: 'relevance'
      };

      const results = await this.aggregationService.searchAllPlatforms(request);
      await this.cacheService.setSearchResults(
        `popular_${category.id}`,
        results
      );
    }
  }
}
```

## 监控和日志

### 1. API 性能监控

```typescript
class ApiMonitoringService {
  async trackApiCall(platform: Platform, endpoint: string, duration: number, success: boolean) {
    const metrics = {
      platform,
      endpoint,
      duration,
      success,
      timestamp: new Date()
    };

    // 发送到监控系统
    await this.metricsCollector.record('api_call', metrics);

    // 记录到日志
    if (!success) {
      logger.error(`API call failed: ${platform} ${endpoint}`, metrics);
    }
  }
}
```

### 2. 错误告警

```typescript
class AlertService {
  async checkApiHealth() {
    const platforms = ['amazon', 'rakuten', 'yahoo'];

    for (const platform of platforms) {
      const health = await this.checkPlatformHealth(platform);

      if (!health.isHealthy) {
        await this.sendAlert({
          type: 'api_health',
          platform,
          message: `Platform ${platform} API is unhealthy: ${health.error}`,
          severity: 'high'
        });
      }
    }
  }
}
```

## 环境配置

### 开发环境

```env
# Amazon API
AMAZON_ACCESS_KEY_ID=your_amazon_access_key
AMAZON_SECRET_ACCESS_KEY=your_amazon_secret_key
AMAZON_ASSOCIATE_TAG=your_associate_tag
AMAZON_ENDPOINT=https://webservices.amazon.com/paapi5

# Yahoo Shopping API
YAHOO_APP_ID=your_yahoo_app_id

# Rakuten API
RAKUTEN_APP_ID=your_rakuten_app_id
RAKUTEN_AFFILIATE_ID=your_affiliate_id

# 缓存配置
REDIS_URL=redis://localhost:6379
CACHE_TTL_SEARCH=300
CACHE_TTL_DETAILS=1800

# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/yabaii
```

### 生产环境

```env
# 生产环境需要使用真实的 API 密钥
# 建议使用 AWS Secrets Manager 或类似服务管理密钥

# 监控配置
SENTRY_DSN=your_sentry_dsn
PROMETHEUS_ENDPOINT=your_prometheus_endpoint

# 性能配置
API_TIMEOUT=30000
MAX_CONCURRENT_REQUESTS=10
```

## 测试策略

### 1. Mock 数据

为开发和测试提供 Mock 数据：

```typescript
// tests/mocks/amazon.mock.ts
export const mockAmazonResponse = {
  data: {
    SearchResult: {
      Items: [
        {
          ASIN: "B08N5WRWNW",
          DetailPageURL: "https://www.amazon.co.jp/dp/B08N5WRWNW",
          Title: "iPhone 15 Pro",
          Offers: {
            Listings: [
              {
                Price: {
                  Amount: 149800,
                  Currency: "JPY"
                },
                Availability: {
                  Message: "在庫あり"
                }
              }
            ]
          }
        }
      ]
    }
  }
};
```

### 2. 集成测试

```typescript
describe('API Integration', () => {
  it('should search products across all platforms', async () => {
    const request: ProductSearchRequest = {
      query: 'iPhone 15',
      sort: 'price'
    };

    const result = await aggregationService.searchAllPlatforms(request);

    expect(result.products).toHaveLength.greaterThan(0);
    expect(result.products.map(p => p.platform)).toContain('amazon');
    expect(result.products.map(p => p.platform)).toContain('rakuten');
    expect(result.products.map(p => p.platform)).toContain('yahoo');
  });
});
```

## 安全考虑

### 1. API 密钥管理

- 使用环境变量存储 API 密钥
- 定期轮换密钥
- 限制 API 密钥权限

### 2. 请求签名

某些 API 需要请求签名验证：

```typescript
class AmazonSignatureService {
  generateSignature(
    method: string,
    uri: string,
    params: Record<string, string>,
    timestamp: string,
    secretKey: string
  ): string {
    // 实现 AWS Signature Version 4
  }
}
```

### 3. 代理配置

为日本地区限制的 API 配置代理：

```typescript
const proxyConfig = {
  amazon: {
    host: 'proxy.example.com',
    port: 8080,
    country: 'JP'
  }
};
```

---

## 下一步实施计划

1. **第一周**: 实现基础适配器架构和 Amazon 集成
2. **第二周**: 添加 Rakuten 和 Yahoo Shopping 集成
3. **第三周**: 实现缓存层和数据库存储
4. **第四周**: 添加监控、日志和错误处理
5. **第五周**: 性能优化和测试

## 联系信息

如有技术问题或需要支持，请联系：
- 技术负责人: [tech-lead@yabaii.com]
- API 支持: [api-support@yabaii.com]