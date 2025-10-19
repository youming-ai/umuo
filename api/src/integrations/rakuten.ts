/**
 * Rakuten Ichiba integration
 * Implements Rakuten Web Service API for Japanese marketplace
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

interface RakutenSearchResponse {
  count: number;
  page: number;
  pageCount: number;
  first: number;
  last: number;
  hits: number;
  carrier: number;
  pageCount: number;
  Items: Array<{
    Item: {
      itemName: string;
      catchcopy?: string;
      itemCode: string;
      itemPrice: number;
      itemCaption: string;
      itemUrl: string;
      affiliateUrl: string;
      imageFlag: number;
      smallImageUrls: Array<{ imageUrl: string }>;
      mediumImageUrls: Array<{ imageUrl: string }>;
      mediumImageUrls?: Array<{ imageUrl: string }>;
      availability: number;
      taxFlag: number;
      postageFlag: number;
      creditCardFlag: number;
      shopOfTheYearFlag: number;
      shipOverseasFlag: number;
      shipOverseasArea: string;
      asurakuFlag: number;
      asurakuClosingTime: number;
      startTime: string;
      endTime: string;
      reviewCount: number;
      reviewAverage: number;
      pointRate: number;
      pointRateStartTime: string;
      pointRateEndTime: string;
      shopName: string;
      shopCode: string;
      shopUrl: string;
      affiliateRate: number;
      genreId: string;
      genreName: string;
    };
  }>;
}

interface RakutenGenreResponse {
  current: {
    genreId: string;
    genreName: string;
    genreLevel: number;
  };
  parents: Array<{
    genreId: string;
    genreName: string;
    genreLevel: number;
  }>;
  children: Array<{
    genreId: string;
    genreName: string;
    genreLevel: number;
  }>;
}

export class RakutenIntegration extends BasePlatformIntegration {
  private appId: string;
  private affiliateId: string;

  constructor(config: any) {
    super(config);

    this.appId = process.env.RAKUTEN_APP_ID || config.appId;
    this.affiliateId = process.env.RAKUTEN_AFFILIATE_ID || config.affiliateId;

    if (!this.appId) {
      throw new IntegrationError(
        'Rakuten App ID not configured',
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
        applicationId: this.appId,
        affiliateId: this.affiliateId,
        keyword: query,
        format: 'json',
        formatVersion: 2,
        sort: this.mapSortBy(filters?.sortBy),
        page: filters?.page || 1,
        hits: Math.min(filters?.limit || 30, 30), // Rakuten API max is 30
      };

      // Add genre/category filter
      if (filters?.category) {
        const genreId = await this.getGenreId(filters.category);
        if (genreId) {
          params.genreId = genreId;
        }
      }

      // Add price range
      if (filters?.minPrice) {
        params.minPrice = filters.minPrice;
      }
      if (filters?.maxPrice) {
        params.maxPrice = filters.maxPrice;
      }

      // Add availability filter
      if (filters?.availability?.includes('in_stock')) {
        params.availability = 1; // 1 = Available
      }

      // Add shipping filter
      if (filters?.shipping?.includes('free')) {
        params.postageFlag = 0; // 0 = Free shipping
      }

      // Add shop filters
      if (filters?.seller?.length) {
        params.shopCode = filters.seller.join(',');
      }

      const response = await this.makeRequest<RakutenSearchResponse>({
        method: 'GET',
        url: '/services/api/IchibaItem/Search/20220601',
        params,
      }, cacheKey, 300); // 5-minute cache for search results

      const products = response.Items.map(item => this.transformRakutenItem(item.Item));
      const totalCount = response.count;

      return {
        success: true,
        data: {
          products,
          totalCount,
          currentPage: response.page,
          totalPages: response.pageCount,
          hasNextPage: response.page < response.pageCount,
          hasPreviousPage: response.page > 1,
          searchQuery: query,
          filters,
          platform: 'rakuten',
          searchTime: Date.now() - startTime,
        },
        metadata: {
          requestId,
          platform: 'rakuten',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Rakuten search failed', {
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
          platform: 'rakuten',
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

      // Rakuten doesn't have a direct get item API, so we search by item code
      const response = await this.makeRequest<RakutenSearchResponse>({
        method: 'GET',
        url: '/services/api/IchibaItem/Search/20220601',
        params: {
          applicationId: this.appId,
          affiliateId: this.affiliateId,
          itemCode: productId,
          format: 'json',
          formatVersion: 2,
          hits: 1,
        },
      }, cacheKey, 1800); // 30-minute cache for product details

      if (!response.Items.length) {
        return {
          success: false,
          error: 'Product not found',
          metadata: {
            requestId,
            platform: 'rakuten',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = this.transformRakutenItem(response.Items[0].Item);

      return {
        success: true,
        data: product,
        metadata: {
          requestId,
          platform: 'rakuten',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Rakuten get product failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'rakuten',
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
            platform: 'rakuten',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = productResponse.data;
      const currentPrice = product.metadata?.currentPrice || 0;

      const price: Price = {
        id: `${productId}-rakuten-current`,
        productId,
        platform: 'rakuten',
        currentPrice,
        currency: 'JPY',
        seller: product.metadata?.shopName,
        condition: 'new', // Rakuten primarily sells new items
        shippingCost: product.metadata?.postageFlag === 0 ? 0 : null,
        availability: product.availability,
        url: product.url,
        recordedAt: new Date(),
      };

      return {
        success: true,
        data: price,
        metadata: {
          requestId,
          platform: 'rakuten',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Rakuten get current price failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'rakuten',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getPriceHistory(productId: string, days: number = 90): Promise<IntegrationResponse<PriceHistory>> {
    // Rakuten doesn't provide price history via API
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
            platform: 'rakuten',
            responseTime: Date.now() - startTime,
            cached: true,
          },
        };
      }

      // Return mock data for now
      const mockPriceHistory: PriceHistory = {
        productId,
        platform: 'rakuten',
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
          platform: 'rakuten',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Rakuten get price history failed', {
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
          platform: 'rakuten',
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
        url: '/services/api/IchibaItem/Search/20220601',
        params: {
          applicationId: this.appId,
          keyword: 'test',
          format: 'json',
          formatVersion: 2,
          hits: 1,
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
          platform: 'rakuten',
          responseTime: latency,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Rakuten health check failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'rakuten',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getMetrics(): Promise<IntegrationResponse<PlatformMetrics>> {
    try {
      const metrics: PlatformMetrics = {
        platform: 'rakuten',
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
      logger.error('Failed to get Rakuten metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Helper methods
  private async getGenreId(categoryName: string): Promise<string | null> {
    try {
      const cacheKey = this.getCacheKey('genre', { name: categoryName });

      // Check cache first
      const cached = await this.getFromCache<string>(cacheKey);
      if (cached) {
        return cached;
      }

      // Search for genre by name
      const response = await this.makeRequest<RakutenGenreResponse>({
        method: 'GET',
        url: '/services/api/IchibaGenre/Search/20220701',
        params: {
          applicationId: this.appId,
          format: 'json',
          formatVersion: 2,
          genreName: categoryName,
        },
      }, cacheKey, 86400); // Cache for 24 hours

      if (response.current?.genreId) {
        return response.current.genreId;
      }

      return null;
    } catch (error) {
      logger.error('Failed to get Rakuten genre ID', {
        categoryName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private transformRakutenItem(item: any): Product {
    const images: ProductImage[] = [];

    // Add medium images
    if (item.mediumImageUrls && item.mediumImageUrls.length > 0) {
      item.mediumImageUrls.forEach((imageUrl: { imageUrl: string }, index: number) => {
        images.push({
          url: imageUrl.imageUrl,
          isPrimary: index === 0,
        });
      });
    }

    // Add small images if no medium images
    if (images.length === 0 && item.smallImageUrls && item.smallImageUrls.length > 0) {
      item.smallImageUrls.forEach((imageUrl: { imageUrl: string }, index: number) => {
        images.push({
          url: imageUrl.imageUrl,
          isPrimary: index === 0,
        });
      });
    }

    return {
      id: item.itemCode,
      title: this.sanitizeString(item.itemName),
      description: this.sanitizeString(item.itemCaption),
      category: item.genreName,
      images,
      url: item.itemUrl,
      platform: 'rakuten',
      availability: this.mapRakutenAvailability(item.availability),
      rating: item.reviewAverage ? parseFloat(item.reviewAverage) : undefined,
      reviewCount: item.reviewCount,
      metadata: {
        shopName: item.shopName,
        shopCode: item.shopCode,
        shopUrl: item.shopUrl,
        currentPrice: item.itemPrice,
        catchcopy: item.catchcopy,
        pointRate: item.pointRate,
        affiliateRate: item.affiliateRate,
        genreId: item.genreId,
        taxFlag: item.taxFlag,
        postageFlag: item.postageFlag,
        creditCardFlag: item.creditCardFlag,
        shipOverseasFlag: item.shipOverseasFlag,
        shipOverseasArea: item.shipOverseasArea,
        asurakuFlag: item.asurakuFlag,
        startTime: item.startTime,
        endTime: item.endTime,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private mapSortBy(sortBy?: string): string {
    const sortMap: Record<string, string> = {
      'price_low': '+itemPrice',
      'price_high': '-itemPrice',
      'rating': '-reviewAverage',
      'review_count': '-reviewCount',
      'newest': '-updateTimestamp',
      'popularity': '-reviewCount',
    };

    return sortMap[sortBy || ''] || '-reviewCount'; // Default to sort by review count
  }

  private mapRakutenAvailability(availability: number): 'in_stock' | 'out_of_stock' | 'limited' | 'unknown' {
    switch (availability) {
      case 0:
        return 'out_of_stock';
      case 1:
        return 'in_stock';
      case 2:
        return 'limited';
      default:
        return 'unknown';
    }
  }
}