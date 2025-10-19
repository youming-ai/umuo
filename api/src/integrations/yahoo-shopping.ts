/**
 * Yahoo Shopping integration
 * Implements Yahoo Shopping Web Service API for Japanese marketplace
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

interface YahooSearchResponse {
  'ResultSet': {
    '0': {
      'Result': {
        '0': {
          'Attributes': {
            'Id': string;
            'Name': string;
            'Description': string;
            'Url': string;
            'Headline': string;
            'Caption': string;
            'Code': string;
            'Price': {
              '_value': string;
            };
            'PriceLabel': {
              '_value': string;
            };
            'TaxFlag': string;
            'Stock': {
              '_value': string;
            };
            'Image': {
              'Id': string;
              'Small': string;
              'Medium': string;
              'Large': string;
            };
            'Review': {
              'Rate': string;
              'Count': string;
            };
            'Store': {
              'Id': string;
              'Name': string;
              'Url': string;
              'Logo': {
                'Small': string;
                'Medium': string;
              };
            };
            'Category': {
              'Current': {
                'Id': string;
                'Title': string;
              };
              'Parent': {
                'Id': string;
                'Title': string;
              };
            };
            'Affiliate': {
              'Url': string;
              'Rate': string;
            };
            'Shipping': {
              'Code': string;
              'Name': string;
            };
            'Payment': {
              'Code': string;
              'Name': string;
            };
          };
        };
      };
      '@attributes': {
        'totalResultsReturned': string;
        'totalResultsAvailable': string;
        'firstResultPosition': string;
      };
    };
  };
}

export class YahooShoppingIntegration extends BasePlatformIntegration {
  private clientId: string;
  private clientSecret: string;

  constructor(config: any) {
    super(config);

    this.clientId = process.env.YAHOO_CLIENT_ID || config.clientId;
    this.clientSecret = process.env.YAHOO_CLIENT_SECRET || config.clientSecret;

    if (!this.clientId) {
      throw new IntegrationError(
        'Yahoo client ID not configured',
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
        appid: this.clientId,
        query: query,
        results: Math.min(filters?.limit || 20, 50), // Yahoo API max is 50
        start: ((filters?.page || 1) - 1) * (filters?.limit || 20) + 1,
        sort: this.mapSortBy(filters?.sortBy),
        condition: this.mapCondition(filters?.condition?.[0]),
        price_from: filters?.minPrice,
        price_to: filters?.maxPrice,
        store_id: filters?.seller?.join(','),
        category_id: await this.getCategoryId(filters?.category),
        availability: this.mapAvailability(filters?.availability),
        shipping: this.mapShipping(filters?.shipping),
        payment: this.mapPayment(filters?.payment),
      };

      // Remove undefined parameters
      Object.keys(params).forEach(key => {
        if (params[key] === undefined || params[key] === '') {
          delete params[key];
        }
      });

      const response = await this.makeRequest<YahooSearchResponse>({
        method: 'GET',
        url: '/WebService/V1/shopping/itemSearch',
        params,
      }, cacheKey, 300); // 5-minute cache for search results

      const resultSet = response.ResultSet['0'];
      const totalResults = parseInt(resultSet['@attributes'].totalResultsAvailable);
      const totalReturned = parseInt(resultSet['@attributes'].totalResultsReturned);

      const products = resultSet.Result ? Object.values(resultSet.Result)
        .filter((item: any) => item && item.Attributes)
        .map((item: any) => this.transformYahooItem(item.Attributes)) : [];

      return {
        success: true,
        data: {
          products,
          totalCount: totalResults,
          currentPage: filters?.page || 1,
          totalPages: Math.ceil(totalResults / (filters?.limit || 20)),
          hasNextPage: ((filters?.page || 1) * (filters?.limit || 20)) < totalResults,
          hasPreviousPage: (filters?.page || 1) > 1,
          searchQuery: query,
          filters,
          platform: 'yahoo',
          searchTime: Date.now() - startTime,
        },
        metadata: {
          requestId,
          platform: 'yahoo',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Yahoo Shopping search failed', {
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
          platform: 'yahoo',
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

      const response = await this.makeRequest<YahooSearchResponse>({
        method: 'GET',
        url: '/WebService/V1/shopping/itemLookup',
        params: {
          appid: this.clientId,
          itemcode: productId,
          responsegroup: 'large',
        },
      }, cacheKey, 1800); // 30-minute cache for product details

      const resultSet = response.ResultSet['0'];
      if (!resultSet.Result || !resultSet.Result['0'] || !resultSet.Result['0'].Attributes) {
        return {
          success: false,
          error: 'Product not found',
          metadata: {
            requestId,
            platform: 'yahoo',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = this.transformYahooItem(resultSet.Result['0'].Attributes);

      return {
        success: true,
        data: product,
        metadata: {
          requestId,
          platform: 'yahoo',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Yahoo Shopping get product failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'yahoo',
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
            platform: 'yahoo',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = productResponse.data;
      const currentPrice = product.metadata?.currentPrice || 0;

      const price: Price = {
        id: `${productId}-yahoo-current`,
        productId,
        platform: 'yahoo',
        currentPrice,
        currency: 'JPY',
        seller: product.metadata?.storeName,
        condition: 'new', // Yahoo Shopping primarily sells new items
        shippingCost: product.metadata?.freeShipping ? 0 : null,
        availability: product.availability,
        url: product.url,
        recordedAt: new Date(),
      };

      return {
        success: true,
        data: price,
        metadata: {
          requestId,
          platform: 'yahoo',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Yahoo Shopping get current price failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'yahoo',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getPriceHistory(productId: string, days: number = 90): Promise<IntegrationResponse<PriceHistory>> {
    // Yahoo Shopping doesn't provide price history via API
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
            platform: 'yahoo',
            responseTime: Date.now() - startTime,
            cached: true,
          },
        };
      }

      // Return mock data for now
      const mockPriceHistory: PriceHistory = {
        productId,
        platform: 'yahoo',
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
          platform: 'yahoo',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Yahoo Shopping get price history failed', {
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
          platform: 'yahoo',
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
        url: '/WebService/V1/shopping/itemSearch',
        params: {
          appid: this.clientId,
          query: 'test',
          results: 1,
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
          platform: 'yahoo',
          responseTime: latency,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Yahoo Shopping health check failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'yahoo',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getMetrics(): Promise<IntegrationResponse<PlatformMetrics>> {
    try {
      const metrics: PlatformMetrics = {
        platform: 'yahoo',
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
      logger.error('Failed to get Yahoo Shopping metrics', {
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

      // Yahoo Shopping doesn't have a category search API, so we'll use a basic mapping
      const categoryMap: Record<string, string> = {
        'electronics': '1',
        'books': '2',
        'fashion': '3',
        'home': '4',
        'beauty': '5',
        'sports': '6',
        'toys': '7',
        'automotive': '8',
        'health': '9',
        'food': '10',
        'kitchen': '11',
        'pets': '12',
        'office': '13',
      };

      const categoryId = categoryMap[categoryName.toLowerCase()];

      if (categoryId) {
        // Cache the result
        await this.setCache(cacheKey, categoryId, 86400); // 24 hours
        return categoryId;
      }

      return undefined;
    } catch (error) {
      logger.error('Failed to get Yahoo Shopping category ID', {
        categoryName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  private transformYahooItem(item: any): Product {
    const images: ProductImage[] = [];

    // Add images from different sizes
    if (item.Image) {
      if (item.Image.Large) {
        images.push({
          url: item.Image.Large,
          isPrimary: true,
        });
      } else if (item.Image.Medium) {
        images.push({
          url: item.Image.Medium,
          isPrimary: true,
        });
      } else if (item.Image.Small) {
        images.push({
          url: item.Image.Small,
          isPrimary: true,
        });
      }
    }

    // Extract price
    const currentPrice = this.sanitizePrice(item.Price?._value) || 0;

    return {
      id: item.Code || item.Id,
      title: this.sanitizeString(item.Name || item.Headline),
      description: this.sanitizeString(item.Description || item.Caption),
      category: item.Category?.Current?.Title || '',
      subcategory: item.Category?.Parent?.Title,
      images,
      url: item.Url,
      platform: 'yahoo',
      availability: this.mapYahooAvailability(item.Stock?._value),
      rating: item.Review?.Rate ? parseFloat(item.Review.Rate) : undefined,
      reviewCount: item.Review?.Count ? parseInt(item.Review.Count) : undefined,
      metadata: {
        storeName: item.Store?.Name,
        storeId: item.Store?.Id,
        storeUrl: item.Store?.Url,
        storeLogo: item.Store?.Logo,
        currentPrice,
        priceLabel: item.PriceLabel?._value,
        taxFlag: item.TaxFlag,
        shipping: item.Shipping,
        payment: item.Payment,
        affiliateUrl: item.Affiliate?.Url,
        affiliateRate: item.Affiliate?.Rate ? parseFloat(item.Affiliate.Rate) : undefined,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private mapSortBy(sortBy?: string): string {
    const sortMap: Record<string, string> = {
      'price_low': '-price',
      'price_high': '+price',
      'rating': '-review_rate',
      'review_count': '-review_count',
      'newest': '-update_time',
      'popularity': '-review_count',
    };

    return sortMap[sortBy || ''] || '-review_count'; // Default to sort by review count
  }

  private mapCondition(condition?: string): string {
    const conditionMap: Record<string, string> = {
      'new': 'new',
      'used': 'used',
      'refurbished': 'used',
    };

    return conditionMap[condition || ''] || 'all';
  }

  private mapAvailability(availability?: string): 'in_stock' | 'out_of_stock' | 'limited' | 'unknown' {
    if (!availability) return 'unknown';

    const availabilityMap: Record<string, 'in_stock' | 'out_of_stock' | 'limited' | 'unknown'> = {
      '在庫あり': 'in_stock',
      '在庫僅少': 'limited',
      '在庫なし': 'out_of_stock',
      '入荷予定': 'limited',
      '販売終了': 'out_of_stock',
    };

    return availabilityMap[availability] || 'unknown';
  }

  private mapShipping(shipping?: string[]): string {
    if (!shipping || shipping.length === 0) return 'all';

    if (shipping.includes('free')) {
      return '0'; // Free shipping
    }

    return 'all';
  }

  private mapPayment(payment?: string[]): string {
    if (!payment || payment.length === 0) return 'all';

    // Yahoo Shopping payment codes
    const paymentMap: Record<string, string> = {
      'card': '1',
      'cash': '2',
      'bank': '3',
      'convenience': '4',
    };

    const codes = payment
      .map(p => paymentMap[p.toLowerCase()])
      .filter(Boolean);

    return codes.length > 0 ? codes.join(',') : 'all';
  }
}