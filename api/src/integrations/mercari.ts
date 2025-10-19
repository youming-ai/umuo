/**
 * Mercari integration
 * Implements Mercari API for Japanese C2C marketplace
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

interface MercariSearchResponse {
  data: Array<{
    id: string;
    name: string;
    price: number;
    thumbnails: string[];
    status: string;
    created: string;
    updated: string;
    likes: number;
    num_comments: number;
    seller: {
      id: string;
      name: string;
      rating: number;
      total_ratings: number;
    };
    category: {
      id: string;
      name: string;
    };
    brand?: {
      id: string;
      name: string;
    };
    size?: {
      id: string;
      name: string;
    };
    condition: string;
    shipping_payer: string;
    shipping_method: string;
    prefecture: string;
  }>;
  meta: {
    numFound: number;
    page: number;
    perPage: number;
    hasNextPage: boolean;
  };
}

interface MercariItemResponse {
  data: {
    id: string;
    name: string;
    price: number;
    thumbnails: string[];
    description: string;
    status: string;
    created: string;
    updated: string;
    likes: number;
    num_comments: number;
    seller: {
      id: string;
      name: string;
      rating: number;
      total_ratings: number;
    };
    category: {
      id: string;
      name: string;
      parent_category?: {
        id: string;
        name: string;
      };
    };
    brand?: {
      id: string;
      name: string;
    };
    size?: {
      id: string;
      name: string;
    };
    condition: string;
    shipping_payer: string;
    shipping_method: string;
    shipping_from_area: string;
    shipping_duration: string;
    likes_count: number;
  };
}

export class MercariIntegration extends BasePlatformIntegration {
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;

  constructor(config: any) {
    super(config);

    this.clientId = process.env.MERCARI_CLIENT_ID || config.clientId;
    this.clientSecret = process.env.MERCARI_CLIENT_SECRET || config.clientSecret;

    if (!this.clientId || !this.clientSecret) {
      throw new IntegrationError(
        'Mercari API credentials not configured',
        this.config.platform,
        'CONFIG'
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    try {
      const response = await this.makeRequest({
        method: 'POST',
        url: '/oauth/token',
        data: {
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: 'read_items read_users',
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }, undefined, 0);

      this.accessToken = response.access_token;
      return this.accessToken;
    } catch (error) {
      throw new IntegrationError(
        'Failed to get Mercari access token',
        this.config.platform,
        'AUTH'
      );
    }
  }

  async searchProducts(query: string, filters?: SearchFilters): Promise<IntegrationResponse<ProductSearchResult>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      await this.getAccessToken();
      const cacheKey = this.getCacheKey('search', { query, ...filters });

      const params: Record<string, any> = {
        keyword: query,
        category_id: await this.getCategoryId(filters?.category),
        brand_id: await this.getBrandId(filters?.brand?.[0]),
        price_min: filters?.minPrice,
        price_max: filters?.maxPrice,
        item_condition_id: this.mapCondition(filters?.condition?.[0]),
        status: 'on_sale',
        sort: this.mapSortBy(filters?.sortBy),
        order: 'desc',
        page: filters?.page || 1,
        per_page: Math.min(filters?.limit || 30, 30), // Mercari API max is 30
        include_barcode: true,
      };

      // Remove undefined parameters
      Object.keys(params).forEach(key => {
        if (params[key] === undefined || params[key] === '') {
          delete params[key];
        }
      });

      const response = await this.makeRequest<MercariSearchResponse>({
        method: 'GET',
        url: '/v1/items',
        params,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      }, cacheKey, 300); // 5-minute cache for search results

      const products = response.data.map(item => this.transformMercariItem(item));
      const totalCount = response.meta.numFound;

      return {
        success: true,
        data: {
          products,
          totalCount,
          currentPage: response.meta.page,
          totalPages: Math.ceil(totalCount / response.meta.perPage),
          hasNextPage: response.meta.hasNextPage,
          hasPreviousPage: response.meta.page > 1,
          searchQuery: query,
          filters,
          platform: 'mercari',
          searchTime: Date.now() - startTime,
        },
        metadata: {
          requestId,
          platform: 'mercari',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Mercari search failed', {
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
          platform: 'mercari',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getProduct(productId: string): Promise<IntegrationResponse<Product>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      await this.getAccessToken();
      const cacheKey = this.getCacheKey('product', { id: productId });

      const response = await this.makeRequest<MercariItemResponse>({
        method: 'GET',
        url: `/v1/items/${productId}`,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      }, cacheKey, 1800); // 30-minute cache for product details

      const product = this.transformMercariItem(response.data);

      return {
        success: true,
        data: product,
        metadata: {
          requestId,
          platform: 'mercari',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Mercari get product failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'mercari',
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
            platform: 'mercari',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = productResponse.data;
      const currentPrice = product.metadata?.currentPrice || 0;

      const price: Price = {
        id: `${productId}-mercari-current`,
        productId,
        platform: 'mercari',
        currentPrice,
        currency: 'JPY',
        seller: product.metadata?.sellerName,
        condition: product.metadata?.condition,
        shippingCost: product.metadata?.freeShipping ? 0 : null,
        availability: product.availability,
        url: `https://jp.mercari.com/item/${productId}`,
        recordedAt: new Date(),
      };

      return {
        success: true,
        data: price,
        metadata: {
          requestId,
          platform: 'mercari',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Mercari get current price failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'mercari',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getPriceHistory(productId: string, days: number = 90): Promise<IntegrationResponse<PriceHistory>> {
    // Mercari doesn't provide price history via API
    // This would require a third-party service or manual tracking
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      const cacheKey = this.getCacheKey('price_history', { id: productId, days });

      // Try to get from cache first
      const cached = await this.getFromCache<any>(cacheKey);
      if (cached) {
        return {
          success: true,
          data: cached,
          metadata: {
            requestId,
            platform: 'mercari',
            responseTime: Date.now() - startTime,
            cached: true,
          },
        };
      }

      // Return mock data for now
      const mockPriceHistory: PriceHistory = {
        productId,
        platform: 'mercari',
        prices: [],
        currentPrice: 0,
        highestPrice: 0,
        lowestPrice: 0,
        averagePrice: 0,
        priceChange: 0,
        priceChangePercentage: 0,
        currency: 'JPY',
        startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      };

      return {
        success: true,
        data: mockPriceHistory,
        metadata: {
          requestId,
          platform: 'mercari',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Mercari get price history failed', {
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
          platform: 'mercari',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getProductByBarcode(barcode: string): Promise<IntegrationResponse<Product>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      await this.getAccessToken();

      const response = await this.makeRequest<MercariSearchResponse>({
        method: 'GET',
        url: '/v1/items',
        params: {
          barcode: barcode,
          status: 'on_sale',
          per_page: 10,
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      }, undefined, 0); // No cache for barcode search

      if (!response.data.length) {
        return {
          success: false,
          error: 'Product not found for barcode',
          metadata: {
            requestId,
            platform: 'mercari',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = this.transformMercariItem(response.data[0]);

      return {
        success: true,
        data: product,
        metadata: {
          requestId,
          platform: 'mercari',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Mercari get product by barcode failed', {
        requestId,
        barcode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'mercari',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async healthCheck(): Promise<IntegrationResponse<{ status: string; latency: number }>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      await this.getAccessToken();

      // Make a simple search request to check API health
      await this.makeRequest({
        method: 'GET',
        url: '/v1/items',
        params: {
          keyword: 'test',
          per_page: 1,
          status: 'on_sale',
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
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
          platform: 'mercari',
          responseTime: latency,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Mercari health check failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'mercari',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getMetrics(): Promise<IntegrationResponse<PlatformMetrics>> {
    try {
      const metrics: PlatformMetrics = {
        platform: 'mercari',
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
      logger.error('Failed to get Mercari metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Helper methods
  private async getCategoryId(categoryName?: string): Promise<number | undefined> {
    if (!categoryName) return undefined;

    try {
      const cacheKey = this.getCacheKey('category', { name: categoryName });

      // Check cache first
      const cached = await this.getFromCache<number>(cacheKey);
      if (cached) {
        return cached;
      }

      // Mercari category mapping (simplified - would need full API for complete mapping)
      const categoryMap: Record<string, number> = {
        'electronics': 5,
        'computers': 9,
        'smartphones': 10,
        'cameras': 23,
        'audio': 26,
        'televisions': 28,
        'appliances': 32,
        'kitchen': 34,
        'beauty': 37,
        'health': 43,
        'fashion': 1,
        'womens': 2,
        'mens': 3,
        'sports': 47,
        'toys': 58,
        'books': 62,
        'games': 68,
        'automotive': 74,
      };

      const categoryId = categoryMap[categoryName.toLowerCase()];

      if (categoryId) {
        // Cache the result
        await this.setCache(cacheKey, categoryId, 86400); // 24 hours
        return categoryId;
      }

      return undefined;
    } catch (error) {
      logger.error('Failed to get Mercari category ID', {
        categoryName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  private async getBrandId(brandName?: string): Promise<number | undefined> {
    if (!brandName) return undefined;

    try {
      const cacheKey = this.getCacheKey('brand', { name: brandName });

      // Check cache first
      const cached = await this.getFromCache<number>(cacheKey);
      if (cached) {
        return cached;
      }

      // Mercari brand search would require separate API call
      // For now, return undefined - would need full implementation
      return undefined;
    } catch (error) {
      logger.error('Failed to get Mercari brand ID', {
        brandName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  private transformMercariItem(item: any): Product {
    const images: ProductImage[] = [];

    if (item.thumbnails && item.thumbnails.length > 0) {
      item.thumbnails.forEach((url: string, index: number) => {
        images.push({
          url,
          isPrimary: index === 0,
        });
      });
    }

    return {
      id: item.id,
      title: this.sanitizeString(item.name),
      description: this.sanitizeString(item.description),
      brand: item.brand?.name,
      category: item.category?.name,
      subcategory: item.category?.parent_category?.name,
      images,
      url: `https://jp.mercari.com/item/${item.id}`,
      platform: 'mercari',
      availability: this.mapMercariStatus(item.status),
      metadata: {
        currentPrice: item.price,
        likes: item.likes,
        numComments: item.num_comments,
        sellerName: item.seller?.name,
        sellerRating: item.seller?.rating,
        sellerTotalRatings: item.seller?.total_ratings,
        sellerId: item.seller?.id,
        condition: this.mapMercariCondition(item.condition),
        freeShipping: item.shipping_payer === 'seller',
        shippingMethod: item.shipping_method,
        shippingFromArea: item.shipping_from_area || item.prefecture,
        shippingDuration: item.shipping_duration,
        brandId: item.brand?.id,
        size: item.size?.name,
        created: item.created,
        updated: item.updated,
      },
      createdAt: new Date(item.created),
      updatedAt: new Date(item.updated),
    };
  }

  private mapSortBy(sortBy?: string): string {
    const sortMap: Record<string, string> = {
      'price_low': 'price',
      'price_high': 'price',
      'newest': 'created',
      'likes': 'likes',
      'popularity': 'likes',
    };

    return sortMap[sortBy || ''] || 'likes'; // Default to sort by likes (popularity)
  }

  private mapCondition(condition?: string): number | undefined {
    if (!condition) return undefined;

    const conditionMap: Record<string, number> = {
      'new': 1,
      'like_new': 2,
      'very_good': 3,
      'good': 4,
      'fair': 5,
      'poor': 6,
    };

    return conditionMap[condition.toLowerCase()];
  }

  private mapMercariStatus(status: string): 'in_stock' | 'out_of_stock' | 'limited' | 'unknown' {
    const statusMap: Record<string, 'in_stock' | 'out_of_stock' | 'limited' | 'unknown'> = {
      'on_sale': 'in_stock',
      'trading': 'limited',
      'sold_out': 'out_of_stock',
      'stop': 'out_of_stock',
    };

    return statusMap[status] || 'unknown';
  }

  private mapMercariCondition(condition: string): 'new' | 'used' | 'refurbished' {
    if (condition.includes('新品') || condition.includes('未使用')) {
      return 'new';
    }
    if (condition.includes('再生品') || condition.includes('refurbished')) {
      return 'refurbished';
    }
    return 'used';
  }
}