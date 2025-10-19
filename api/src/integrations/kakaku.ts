/**
 * Kakaku.com integration
 * Implements Kakaku.com API for Japanese price comparison platform
 */

import { BasePlatformIntegration } from './base';
import {
  Platform,
  IntegrationResponse,
  Product,
  ProductSearchResult,
  Price,
  PriceHistory,
  SearchFilters,
  PlatformMetrics,
  ProductImage
} from './types';

interface KakakuSearchResponse {
  ProductInfo: Array<{
    ProductID: string;
    ProductName: string;
    MakerName: string;
    CategoryName: string;
    ImageUrl: string;
    LowestPrice: number;
    HighestPrice: number;
    AveragePrice: number;
    ReviewCount: number;
    ReviewAverage: number;
    BbsCount: number;
    ItemPageUrl: string;
    ReleaseDate: string;
  }>;
  NumOfResult: number;
  CurrentPage: number;
  TotalPage: number;
}

interface KakakuProductResponse {
  ProductInfo: {
    ProductID: string;
    ProductName: string;
    MakerName: string;
    CategoryName: string;
    SubCategoryName?: string;
    ImageUrl: string;
    Description: string;
    SpecList?: Array<{
      SpecName: string;
      SpecValue: string;
    }>;
    ReleaseDate: string;
    ReviewCount: number;
    ReviewAverage: number;
    BbsCount: number;
    ItemPageUrl: string;
    ShopList: Array<{
      ShopName: string;
      ShopUrl: string;
      Price: number;
      StockStatus: string;
      ShippingCost: number;
      PointRate: number;
      UpdateTime: string;
    }>;
  };
}

interface KakakuPriceHistoryResponse {
  PriceHistory: Array<{
    Date: string;
    LowestPrice: number;
    AveragePrice: number;
    HighestPrice: number;
    ShopCount: number;
  }>;
}

export class KakakuIntegration extends BasePlatformIntegration {
  private apiKey: string;

  constructor(config: any) {
    super(config);

    this.apiKey = process.env.KAKAKU_API_KEY || config.apiKey;

    if (!this.apiKey) {
      throw new IntegrationError(
        'Kakaku API key not configured',
        this.config.platform,
        'CONFIG'
      );
    }
  }

  async searchProducts(query: string, filters?: SearchFilters): Promise<IntegrationResponse<ProductSearchResult>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      const cacheKey = this.getCacheKey('search', { query, ...filters });

      const params: Record<string, any> = {
        Keyword: query,
        CategoryId: await this.getCategoryId(filters?.category),
        MakerName: filters?.brand?.[0],
        MinPrice: filters?.minPrice,
        MaxPrice: filters?.maxPrice,
        SortBy: this.mapSortBy(filters?.sortBy),
        SortOrder: 'desc',
        PageNum: filters?.page || 1,
        PageSize: Math.min(filters?.limit || 20, 100), // Kakaku API max is 100
        ImageSize: 2, // Large images
        Format: 'json',
        ApiKey: this.apiKey,
      };

      // Remove undefined parameters
      Object.keys(params).forEach(key => {
        if (params[key] === undefined || params[key] === '') {
          delete params[key];
        }
      });

      const response = await this.makeRequest<KakakuSearchResponse>({
        method: 'GET',
        url: '/json/ProductSearch.json',
        params,
      }, cacheKey, 300); // 5-minute cache for search results

      const products = response.ProductInfo.map(item => this.transformKakakuItem(item));
      const totalCount = response.NumOfResult;

      return {
        success: true,
        data: {
          products,
          totalCount,
          currentPage: response.CurrentPage,
          totalPages: response.TotalPage,
          hasNextPage: response.CurrentPage < response.TotalPage,
          hasPreviousPage: response.CurrentPage > 1,
          searchQuery: query,
          filters,
          platform: 'kakaku',
          searchTime: Date.now() - startTime,
        },
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Kakaku search failed', {
        requestId,
        query,
        filters,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getProduct(productId: string): Promise<IntegrationResponse<Product>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      const cacheKey = this.getCacheKey('product', { id: productId });

      const response = await this.makeRequest<KakakuProductResponse>({
        method: 'GET',
        url: '/json/ProductInfo.json',
        params: {
          ProductId: productId,
          ImageSize: 2,
          Format: 'json',
          ApiKey: this.apiKey,
        },
      }, cacheKey, 1800); // 30-minute cache for product details

      const product = this.transformKakakuItem(response.ProductInfo);

      return {
        success: true,
        data: product,
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Kakaku get product failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getCurrentPrice(productId: string): Promise<IntegrationResponse<Price>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      const productResponse = await this.getProduct(productId);
      if (!productResponse.success || !productResponse.data) {
        return {
          success: false,
          error: productResponse.error || 'Failed to get product',
          metadata: {
            requestId,
            platform: 'kakaku',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = productResponse.data;
      const shopInfo = product.metadata?.shopList?.[0];

      if (!shopInfo) {
        return {
          success: false,
          error: 'No pricing information available',
          metadata: {
            requestId,
            platform: 'kakaku',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const price: Price = {
        id: `${productId}-kakaku-current`,
        productId,
        platform: 'kakaku',
        currentPrice: shopInfo.price,
        currency: 'JPY',
        seller: shopInfo.shopName,
        condition: 'new', // Kakaku primarily focuses on new products
        shippingCost: shopInfo.shippingCost,
        availability: this.mapKakakuStockStatus(shopInfo.stockStatus),
        url: shopInfo.shopUrl,
        recordedAt: new Date(),
      };

      return {
        success: true,
        data: price,
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Kakaku get current price failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getPriceHistory(productId: string, days: number = 90): Promise<IntegrationResponse<PriceHistory>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      const cacheKey = this.getCacheKey('price_history', { id: productId, days });

      const response = await this.makeRequest<KakakuPriceHistoryResponse>({
        method: 'GET',
        url: '/json/PriceHistory.json',
        params: {
          ProductId: productId,
          Term: days.toString(),
          Format: 'json',
          ApiKey: this.apiKey,
        },
      }, cacheKey, 3600); // 1-hour cache for price history

      const prices = response.PriceHistory.map(item => ({
        price: item.LowestPrice,
        currency: 'JPY',
        recordedAt: new Date(item.Date),
        source: 'kakaku',
      }));

      const currentPrice = prices.length > 0 ? prices[prices.length - 1].price : 0;
      const allPrices = prices.map(p => p.price).filter(p => p > 0);
      const highestPrice = allPrices.length > 0 ? Math.max(...allPrices) : 0;
      const lowestPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;
      const averagePrice = allPrices.length > 0 ? allPrices.reduce((sum, price) => sum + price, 0) / allPrices.length : 0;

      const priceHistory: PriceHistory = {
        productId,
        platform: 'kakaku',
        prices,
        currentPrice,
        highestPrice,
        lowestPrice,
        averagePrice,
        priceChange: prices.length > 1 ? currentPrice - prices[0].price : 0,
        priceChangePercentage: prices.length > 1 && prices[0].price > 0 ?
          ((currentPrice - prices[0].price) / prices[0].price) * 100 : 0,
        currency: 'JPY',
        startDate: prices.length > 0 ? prices[0].recordedAt : new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      };

      return {
        success: true,
        data: priceHistory,
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Kakaku get price history failed', {
        requestId,
        productId,
        days,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async healthCheck(): Promise<IntegrationResponse<{ status: string; latency: number }>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      // Make a simple search request to check API health
      await this.makeRequest({
        method: 'GET',
        url: '/json/ProductSearch.json',
        params: {
          Keyword: 'test',
          PageSize: 1,
          Format: 'json',
          ApiKey: this.apiKey,
        },
      }, undefined, 0); // No cache for health check

      const latency = Date.now() - startTime;

      return {
        success: true,
        data: {
          status: 'healthy',
          latency,
        },
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: latency,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Kakaku health check failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'kakaku',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getMetrics(): Promise<IntegrationResponse<PlatformMetrics>> {
    try {
      const metrics: PlatformMetrics = {
        platform: 'kakaku',
        totalProducts: this.getMetric('total_products'),
        lastSyncAt: new Date(),
        syncDuration: this.getMetric('avg_response_time'),
        errorRate: this.getMetric('errors') / Math.max(this.getMetric('requests'), 1),
        averageResponseTime: this.getMetric('avg_response_time'),
        rateLimitHits: this.getMetric('rate_limit_hits'),
        cacheHitRate: this.getMetric('cache_hits') / Math.max(this.getMetric('requests'), 1),
      };

      return {
        success: true,
        data: metrics,
      };
    } catch (error) {
      logger.error('Failed to get Kakaku metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Helper methods
  private async getCategoryId(categoryName?: string): Promise<string | undefined> {
    if (!categoryName) return undefined;

    try {
      const cacheKey = this.getCacheKey('category', { name: categoryName });

      // Check cache first
      const cached = await this.getFromCache<string>(cacheKey);
      if (cached) {
        return cached;
      }

      // Kakaku category mapping (simplified)
      const categoryMap: Record<string, string> = {
        'electronics': '101',
        'computers': '10101',
        'smartphones': '10104',
        'cameras': '10105',
        'audio': '10107',
        'televisions': '10108',
        'appliances': '102',
        'kitchen': '10201',
        'beauty': '103',
        'health': '104',
        'fashion': '105',
        'sports': '106',
        'toys': '107',
        'books': '108',
        'games': '109',
        'automotive': '110',
      };

      const categoryId = categoryMap[categoryName.toLowerCase()];

      if (categoryId) {
        // Cache the result
        await this.setCache(cacheKey, categoryId, 86400); // 24 hours
        return categoryId;
      }

      return undefined;
    } catch (error) {
      logger.error('Failed to get Kakaku category ID', {
        categoryName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  private transformKakakuItem(item: any): Product {
    const images: ProductImage[] = [];

    if (item.ImageUrl) {
      images.push({
        url: item.ImageUrl,
        isPrimary: true,
      });
    }

    return {
      id: item.ProductID,
      title: this.sanitizeString(item.ProductName),
      description: item.Description || '',
      brand: item.MakerName,
      category: item.CategoryName,
      subcategory: item.SubCategoryName,
      images,
      url: item.ItemPageUrl,
      platform: 'kakaku',
      availability: 'in_stock', // Kakaku doesn't provide individual product stock status
      rating: item.ReviewAverage ? parseFloat(item.ReviewAverage) : undefined,
      reviewCount: item.ReviewCount,
      metadata: {
        lowestPrice: item.LowestPrice,
        highestPrice: item.HighestPrice,
        averagePrice: item.AveragePrice,
        bbsCount: item.BbsCount,
        releaseDate: item.ReleaseDate,
        shopList: item.ShopList?.map((shop: any) => ({
          shopName: shop.ShopName,
          shopUrl: shop.ShopUrl,
          price: shop.Price,
          stockStatus: shop.StockStatus,
          shippingCost: shop.ShippingCost,
          pointRate: shop.PointRate,
          updateTime: shop.UpdateTime,
        })),
        specs: item.SpecList?.reduce((acc: Record<string, string>, spec: any) => {
          acc[spec.SpecName] = spec.SpecValue;
          return acc;
        }, {}),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private mapSortBy(sortBy?: string): string {
    const sortMap: Record<string, string> = {
      'price_low': 'PriceLowest',
      'price_high': 'PriceHighest',
      'rating': 'ReviewAverage',
      'review_count': 'ReviewCount',
      'newest': 'ReleaseDate',
      'popularity': 'BbsCount',
    };

    return sortMap[sortBy || ''] || 'ReviewCount'; // Default to sort by community discussion count
  }

  private mapKakakuStockStatus(stockStatus?: string): 'in_stock' | 'out_of_stock' | 'limited' | 'unknown' {
    if (!stockStatus) return 'unknown';

    const statusMap: Record<string, 'in_stock' | 'out_of_stock' | 'limited' | 'unknown'> = {
      '在庫あり': 'in_stock',
      '在庫僅少': 'limited',
      '在庫なし': 'out_of_stock',
      '取り寄せ': 'limited',
      '販売終了': 'out_of_stock',
    };

    return statusMap[stockStatus] || 'unknown';
  }
}