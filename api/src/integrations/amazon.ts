/**
 * Amazon Japan integration
 * Implements Amazon Product Advertising API for Japanese marketplace
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

interface AmazonConfig {
  accessKey: string;
  secretKey: string;
  associateTag: string;
  marketplace: string;
  region: string;
}

interface AmazonSearchResponse {
  SearchResult: {
    Items: AmazonItem[];
  };
  RequestInformation: {
    IsValid: boolean;
    Errors?: any[];
  };
}

interface AmazonItemResponse {
  ItemResult: {
    Items: AmazonItem[];
  };
  RequestInformation: {
    IsValid: boolean;
    Errors?: any[];
  };
}

interface AmazonItem {
  ASIN: string;
  ItemInfo: {
    Title: {
      DisplayValue: string;
    };
    Features?: {
      DisplayValues: string[];
    };
    ByLineInfo?: {
      Brand: {
        DisplayValue: string;
      };
    };
    ProductInfo?: {
      ByLineInfo?: {
        Brand?: {
          DisplayValue: string;
        };
      };
    };
    Classification?: {
      Weblabs?: string;
      Binding?: {
        DisplayValue: string;
      };
    };
    ContentInfo?: {
      PagesCount?: {
        DisplayValue: string;
      };
      PublicationDate?: {
        DisplayValue: string;
      };
    };
    ExternalIds?: {
      EANs?: {
        DisplayValues: string[];
      };
      UPCs?: {
        DisplayValues: string[];
      };
      ISBNs?: {
        DisplayValues: string[];
      };
    };
    ManufactureInfo?: {
      ItemPartNumber?: {
        DisplayValue: string;
      };
      Model?: {
        DisplayValue: string;
      };
    };
    ProductImages?: {
      Primary?: {
        Large?: {
          URL: string;
          Height: number;
          Width: number;
        };
        Medium?: {
          URL: string;
          Height: number;
          Width: number;
        };
      };
      Variants?: Array<{
        Large?: {
          URL: string;
          Height: number;
          Width: number;
        };
        Medium?: {
          URL: string;
          Height: number;
          Width: number;
        };
      }>;
    };
    TechnicalInfo?: {
      Formats?: {
        DisplayValues: string[];
      };
      Label?: {
        DisplayValue: string;
      };
    };
    TradesInfo?: {
        IsEligibleForTradeIn?: {
            DisplayValue: string;
        };
    };
    VolumeInfo?: {
      VolumeCapacity?: {
        DisplayValue: string;
      };
    };
  };
  Offers?: {
    Listings?: Array<{
      ID: string;
      Price?: {
        DisplayAmount?: string;
        Amount?: number;
        Currency?: string;
      };
      ShippingCharges?: {
        List?: Array<{
          Amount?: number;
          Currency?: string;
        }>;
      };
      AvailabilityInfo?: {
        AvailabilityType?: string;
        MaxOrderQuantity?: number;
        MinOrderQuantity?: number;
        Quantity?: number;
        MerchantInfo?: {
          Name?: string;
        };
      };
      Condition?: {
        DisplayValue?: string;
        SubCondition?: {
          DisplayValue?: string;
        };
      };
      DeliveryInfo?: {
        IsAmazonFulfilled?: boolean;
        IsFreeShippingEligible?: boolean;
        IsPrimeEligible?: boolean;
        ShippingTime?: string;
      };
      ProgramEligibility?: {
        IsPrimeExclusive?: boolean;
        IsPrimePantry?: boolean;
      };
      ViolatesMap?: boolean;
    }>;
    Summaries?: Array<{
      HighestPrice?: {
        DisplayAmount?: string;
        Amount?: number;
        Currency?: string;
      };
      LowestPrice?: {
        DisplayAmount?: string;
        Amount?: number;
        Currency?: string;
      };
      OfferCount?: number;
      Condition?: {
        DisplayValue?: string;
      };
    }>;
  };
  BrowseNodeInfo?: {
    BrowseNodes?: Array<{
      Id: string;
      DisplayName: string;
      Ancestors?: Array<{
        DisplayName: string;
        Id: string;
      }>;
    }>;
  };
  CustomerReviews?: {
    StarRating?: string;
    Count?: number;
  };
}

export class AmazonIntegration extends BasePlatformIntegration {
  private amazonConfig: AmazonConfig;

  constructor(config: any) {
    super(config);

    this.amazonConfig = {
      accessKey: process.env.AMAZON_ACCESS_KEY || config.accessKey,
      secretKey: process.env.AMAZON_SECRET_KEY || config.secretKey,
      associateTag: process.env.AMAZON_ASSOCIATE_TAG || config.associateTag || 'yabaii-22',
      marketplace: process.env.AMAZON_MARKETPLACE || config.marketplace || 'A1VC38T7YXB528', // Japan
      region: process.env.AMAZON_REGION || config.region || 'us-west-2',
    };

    if (!this.amazonConfig.accessKey || !this.amazonConfig.secretKey) {
      throw new IntegrationError(
        'Amazon API credentials not configured',
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

      const params = new URLSearchParams({
        Keywords: query,
        SearchIndex: this.mapCategoryToAmazonIndex(filters?.category),
        MarketplaceId: this.amazonConfig.marketplace,
        PartnerTag: this.amazonConfig.associateTag,
        PartnerType: 'Associates',
        Condition: filters?.condition?.[0] || 'New',
        SortBy: this.mapSortBy(filters?.sortBy),
        LanguagesOfPublication: 'ja_JP',
        Resources: [
          'BrowseNodeInfo.BrowseNodes',
          'BrowseNodeInfo.BrowseNodes.Ancestors',
          'BrowseNodeInfo.BrowseNodes.SalesRank',
          'Images.Primary.Medium',
          'Images.Primary.Large',
          'Images.Variants.Medium',
          'Images.Variants.Large',
          'ItemInfo.Title',
          'ItemInfo.Features',
          'ItemInfo.ByLineInfo',
          'ItemInfo.ProductInfo',
          'ItemInfo.Classification',
          'ItemInfo.ExternalIds',
          'ItemInfo.ManufactureInfo',
          'ItemInfo.TechnicalInfo',
          'ItemInfo.ContentInfo',
          'ItemInfo.TradesInfo',
          'ItemInfo.VolumeInfo',
          'Offers.Listings.Price',
          'Offers.Listings.MerchantInfo',
          'Offers.Listings.DeliveryInfo',
          'Offers.Listings.Condition',
          'Offers.Summaries.LowestPrice',
          'Offers.Summaries.HighestPrice',
          'Offers.Summaries.OfferCount',
          'CustomerReviews.StarRating',
          'CustomerReviews.Count',
        ].join(','),
      });

      if (filters?.minPrice || filters?.maxPrice) {
        params.append('MinPrice', filters.minPrice?.toString() || '1');
        params.append('MaxPrice', filters.maxPrice?.toString() || '999999');
      }

      if (filters?.brand?.length) {
        params.append('Brand', filters.brand[0]); // Amazon API supports single brand
      }

      // Add pagination
      const page = filters?.page || 1;
      if (page > 1) {
        params.append('ItemPage', page.toString());
      }

      const response = await this.makeRequest<AmazonSearchResponse>({
        method: 'GET',
        url: `/paapi5/searchitems`,
        params,
      }, cacheKey, 300); // 5-minute cache for search results

      const products = this.transformAmazonItems(response.SearchResult.Items);
      const totalCount = products.length;

      return {
        success: true,
        data: {
          products,
          totalCount,
          currentPage: page,
          totalPages: Math.ceil(totalCount / (filters?.limit || 10)),
          hasNextPage: products.length === (filters?.limit || 10),
          hasPreviousPage: page > 1,
          searchQuery: query,
          filters,
          platform: 'amazon',
          searchTime: Date.now() - startTime,
        },
        metadata: {
          requestId,
          platform: 'amazon',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Amazon search failed', {
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
          platform: 'amazon',
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

      const response = await this.makeRequest<AmazonItemResponse>({
        method: 'GET',
        url: '/paapi5/getitems',
        params: {
          ItemIds: productId,
          MarketplaceId: this.amazonConfig.marketplace,
          PartnerTag: this.amazonConfig.associateTag,
          PartnerType: 'Associates',
          Condition: 'New',
          LanguagesOfPublication: 'ja_JP',
          Resources: [
            'BrowseNodeInfo.BrowseNodes',
            'BrowseNodeInfo.BrowseNodes.Ancestors',
            'Images.Primary.Medium',
            'Images.Primary.Large',
            'Images.Variants.Medium',
            'Images.Variants.Large',
            'ItemInfo.Title',
            'ItemInfo.Features',
            'ItemInfo.ByLineInfo',
            'ItemInfo.ProductInfo',
            'ItemInfo.Classification',
            'ItemInfo.ExternalIds',
            'ItemInfo.ManufactureInfo',
            'ItemInfo.TechnicalInfo',
            'ItemInfo.ContentInfo',
            'ItemInfo.TradesInfo',
            'ItemInfo.VolumeInfo',
            'Offers.Listings.Price',
            'Offers.Listings.MerchantInfo',
            'Offers.Listings.DeliveryInfo',
            'Offers.Listings.Condition',
            'Offers.Summaries.LowestPrice',
            'Offers.Summaries.HighestPrice',
            'Offers.Summaries.OfferCount',
            'CustomerReviews.StarRating',
            'CustomerReviews.Count',
          ].join(','),
        },
      }, cacheKey, 1800); // 30-minute cache for product details

      if (!response.ItemResult.Items.length) {
        return {
          success: false,
          error: 'Product not found',
          metadata: {
            requestId,
            platform: 'amazon',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = this.transformAmazonItem(response.ItemResult.Items[0]);

      return {
        success: true,
        data: product,
        metadata: {
          requestId,
          platform: 'amazon',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Amazon get product failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'amazon',
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
            platform: 'amazon',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const product = productResponse.data;
      const offers = product.metadata?.offers?.[0];

      if (!offers) {
        return {
          success: false,
          error: 'No pricing information available',
          metadata: {
            requestId,
            platform: 'amazon',
            responseTime: Date.now() - startTime,
          },
        };
      }

      const price: Price = {
        id: `${productId}-amazon-current`,
        productId,
        platform: 'amazon',
        currentPrice: offers.currentPrice,
        currency: offers.currency,
        seller: offers.seller,
        condition: offers.condition,
        shippingCost: offers.shippingCost,
        availability: offers.availability,
        url: product.url,
        recordedAt: new Date(),
      };

      return {
        success: true,
        data: price,
        metadata: {
          requestId,
          platform: 'amazon',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Amazon get current price failed', {
        requestId,
        productId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'amazon',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getPriceHistory(productId: string, days: number = 90): Promise<IntegrationResponse<PriceHistory>> {
    // Amazon doesn't provide price history via API
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
            platform: 'amazon',
            responseTime: Date.now() - startTime,
            cached: true,
          },
        };
      }

      // Return mock data for now
      const mockPriceHistory: PriceHistory = {
        productId,
        platform: 'amazon',
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
          platform: 'amazon',
          responseTime: Date.now() - startTime,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Amazon get price history failed', {
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
          platform: 'amazon',
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
        url: '/paapi5/searchitems',
        params: {
          Keywords: 'test',
          SearchIndex: 'All',
          MarketplaceId: this.amazonConfig.marketplace,
          PartnerTag: this.amazonConfig.associateTag,
          PartnerType: 'Associates',
          Condition: 'New',
          LanguagesOfPublication: 'ja_JP',
          Resources: 'ItemInfo.Title',
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
          platform: 'amazon',
          responseTime: latency,
          cached: false,
        },
      };
    } catch (error) {
      logger.error('Amazon health check failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          requestId,
          platform: 'amazon',
          responseTime: Date.now() - startTime,
        },
      };
    }
  }

  async getMetrics(): Promise<IntegrationResponse<PlatformMetrics>> {
    try {
      const metrics: PlatformMetrics = {
        platform: 'amazon',
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
      logger.error('Failed to get Amazon metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Helper methods
  private transformAmazonItems(items: AmazonItem[]): Product[] {
    return items.map(item => this.transformAmazonItem(item));
  }

  private transformAmazonItem(item: AmazonItem): Product {
    const title = item.ItemInfo.Title?.DisplayValue || '';
    const brand = item.ItemInfo.ByLineInfo?.Brand?.DisplayValue ||
                  item.ItemInfo.ProductInfo?.ByLineInfo?.Brand?.DisplayValue || '';

    const primaryImage = item.ItemInfo.ProductImages?.Primary?.Large;
    const variantImages = item.ItemInfo.ProductImages?.Variants || [];

    const images: ProductImage[] = [];

    if (primaryImage) {
      images.push({
        url: primaryImage.URL,
        width: primaryImage.Width,
        height: primaryImage.Height,
        isPrimary: true,
      });
    }

    variantImages.forEach((variant, index) => {
      if (variant.Large) {
        images.push({
          url: variant.Large.URL,
          width: variant.Large.Width,
          height: variant.Large.Height,
          isPrimary: false,
        });
      }
    });

    // Extract category from browse node
    const browseNode = item.BrowseNodeInfo?.BrowseNodes?.[0];
    const category = browseNode?.DisplayName || '';
    const subcategory = browseNode?.Ancestors?.[0]?.DisplayName;

    // Extract offers
    const listing = item.Offers?.Listings?.[0];
    const offers = listing ? {
      currentPrice: listing.Price?.Amount || 0,
      originalPrice: listing.Price?.Amount || 0,
      currency: listing.Price?.Currency || 'JPY',
      seller: listing.MerchantInfo?.Name || 'Amazon',
      condition: listing.Condition?.SubCondition?.DisplayValue?.toLowerCase() as any || 'new',
      shippingCost: listing.ShippingCharges?.List?.[0]?.Amount || 0,
      availability: this.mapAmazonAvailability(listing.AvailabilityInfo?.AvailabilityType),
      isPrime: listing.DeliveryInfo?.IsPrimeEligible || false,
      isFulfilledByAmazon: listing.DeliveryInfo?.IsAmazonFulfilled || false,
    } : undefined;

    return {
      id: item.ASIN,
      title,
      description: item.ItemInfo.Features?.DisplayValues?.join('\n'),
      brand,
      category,
      subcategory,
      images,
      url: `https://www.amazon.co.jp/dp/${item.ASIN}?tag=${this.amazonConfig.associateTag}`,
      platform: 'amazon',
      availability: offers?.availability || 'unknown',
      rating: item.CustomerReviews?.StarRating ? parseFloat(item.CustomerReviews.StarRating) : undefined,
      reviewCount: item.CustomerReviews?.Count,
      specs: {
        features: item.ItemInfo.Features?.DisplayValues,
        externalIds: {
          eans: item.ItemInfo.ExternalIds?.EANs?.DisplayValues,
          upcs: item.ItemInfo.ExternalIds?.UPCs?.DisplayValues,
          isbns: item.ItemInfo.ExternalIds?.ISBNs?.DisplayValues,
        },
        manufactureInfo: {
          model: item.ItemInfo.ManufactureInfo?.Model?.DisplayValue,
          partNumber: item.ItemInfo.ManufactureInfo?.ItemPartNumber?.DisplayValue,
        },
        contentInfo: {
          pagesCount: item.ItemInfo.ContentInfo?.PagesCount?.DisplayValue,
          publicationDate: item.ItemInfo.ContentInfo?.PublicationDate?.DisplayValue,
        },
      },
      metadata: { offers },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private mapCategoryToAmazonIndex(category?: string): string {
    const categoryMap: Record<string, string> = {
      'electronics': 'Electronics',
      'books': 'Books',
      'fashion': 'Fashion',
      'home': 'HomeGarden',
      'beauty': 'Beauty',
      'sports': 'SportsOutdoors',
      'toys': 'Toys',
      'automotive': 'Automotive',
      'health': 'HealthPersonalCare',
      'food': 'Food',
      'kitchen': 'Kitchen',
      'pets': 'PetSupplies',
      'office': 'OfficeProducts',
      'software': 'Software',
      'games': 'VideoGames',
      'music': 'Music',
      'movies': 'MoviesAndTV',
    };

    return categoryMap[category?.toLowerCase() || ''] || 'All';
  }

  private mapSortBy(sortBy?: string): string {
    const sortMap: Record<string, string> = {
      'price_low': 'Price:LowToHigh',
      'price_high': 'Price:HighToLow',
      'rating': 'AvgCustomerReviews',
      'newest': 'NewestArrivals',
      'popularity': 'Relevance',
    };

    return sortMap[sortBy || ''] || 'Relevance';
  }

  private mapAmazonAvailability(availability?: string): 'in_stock' | 'out_of_stock' | 'limited' | 'unknown' {
    if (!availability) return 'unknown';

    const availabilityMap: Record<string, 'in_stock' | 'out_of_stock' | 'limited' | 'unknown'> = {
      'NOW': 'in_stock',
      'NOW_WITH_QUANTITY': 'in_stock',
      'FUTURE': 'limited',
      'BACKORDER': 'limited',
      'PREORDER': 'limited',
      'UNAVAILABLE': 'out_of_stock',
      'DISCONTINUED': 'out_of_stock',
    };

    return availabilityMap[availability] || 'unknown';
  }
}