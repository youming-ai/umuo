/**
 * Price Service
 *
 * Handles price tracking, history management, and price analysis.
 * Integrates with multiple platform APIs for price monitoring.
 */

import { z } from 'zod';
import {
  PriceEntrySchema,
  PriceTrendSchema,
  HistoricalLowSchema,
  type PriceEntry,
  type PriceTrend,
  type HistoricalLow
} from '../models/price_history';
import {
  ProductOfferSchema,
  type ProductOffer,
  type Platform
} from '../models/product_offer';
import { priceCacheService } from './price_cache_service';
import { getDatabase } from '@/config/database';
import { logger } from '@/utils/logger';

// Price tracking configuration
export const PriceTrackingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  updateFrequency: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
  maxHistoryDays: z.number().positive().default(365),
  platforms: z.array(z.string()).default(['amazon', 'rakuten', 'yahoo']),
  alertThresholdPercentage: z.number().nonnegative().default(5),
});

// Price comparison request
export const PriceComparisonRequestSchema = z.object({
  productId: z.string().uuid(),
  platforms: z.array(z.string()).optional(),
  condition: z.enum(['new', 'used', 'refurbished', 'any']).default('any'),
  includeShipping: z.boolean().default(true),
  currency: z.string().length(3).default('JPY'),
});

// Price statistics request
export const PriceStatisticsRequestSchema = z.object({
  productId: z.string().uuid(),
  platforms: z.array(z.string()).optional(),
  periodDays: z.number().positive().default(30),
  includeHistoricalLow: z.boolean().default(true),
  currency: z.string().length(3).default('JPY'),
});

// Price alert configuration
export const PriceAlertConfigSchema = z.object({
  productId: z.string().uuid(),
  userId: z.string().uuid(),
  targetPrice: z.number().positive().optional(),
  percentageDrop: z.number().nonnegative().optional(),
  platformIds: z.array(z.string()).optional(),
  active: z.boolean().default(true),
  notifyOnAnyChange: z.boolean().default(false),
});

// Price tracking result
export const PriceTrackingResultSchema = z.object({
  productId: z.string().uuid(),
  platformId: z.string(),
  success: z.boolean(),
  price: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  availability: z.enum(['in_stock', 'out_of_stock', 'limited_stock', 'discontinued']).optional(),
  error: z.string().optional(),
  timestamp: z.date(),
  metadata: z.record(z.unknown()).optional(),
});

// TypeScript types
export type PriceTrackingConfig = z.infer<typeof PriceTrackingConfigSchema>;
export type PriceComparisonRequest = z.infer<typeof PriceComparisonRequestSchema>;
export type PriceStatisticsRequest = z.infer<typeof PriceStatisticsRequestSchema>;
export type PriceAlertConfig = z.infer<typeof PriceAlertConfigSchema>;
export type PriceTrackingResult = z.infer<typeof PriceTrackingResultSchema>;

// Price service class
export class PriceService {
  private config: PriceTrackingConfig;
  private platformClients: Map<string, any>; // Platform-specific API clients

  constructor(config: Partial<PriceTrackingConfig> = {}) {
    this.config = PriceTrackingConfigSchema.parse(config);
    this.platformClients = new Map();
    this.initializePlatformClients();
  }

  private initializePlatformClients(): void {
    // Initialize platform-specific clients
    // In real implementation, these would be actual API client instances
    this.platformClients.set('amazon', { name: 'Amazon PA API', enabled: true });
    this.platformClients.set('rakuten', { name: 'Rakuten Ichiba API', enabled: true });
    this.platformClients.set('yahoo', { name: 'Yahoo Shopping API', enabled: true });
    this.platformClients.set('kakaku', { name: 'Kakaku.com API', enabled: true });
    this.platformClients.set('mercari', { name: 'Mercari API', enabled: true });
  }

  // Core price tracking methods
  async trackProductPrices(productId: string, options: {
    platforms?: string[];
    force?: boolean;
  } = {}): Promise<PriceTrackingResult[]> {
    const platforms = options.platforms || this.config.platforms;
    const results: PriceTrackingResult[] = [];

    for (const platformId of platforms) {
      const result = await this.trackPlatformPrice(productId, platformId, options.force);
      results.push(result);
    }

    return results;
  }

  private async trackPlatformPrice(
    productId: string,
    platformId: string,
    force: boolean = false
  ): Promise<PriceTrackingResult> {
    const client = this.platformClients.get(platformId);
    if (!client || !client.enabled) {
      return {
        productId,
        platformId,
        success: false,
        error: 'Platform not available',
        timestamp: new Date(),
      };
    }

    try {
      // In real implementation, this would call the actual platform API
      const priceData = await this.fetchPlatformPrice(productId, platformId);

      if (priceData) {
        await this.savePriceEntry({
          id: crypto.randomUUID(),
          productId,
          platformId,
          platform: this.getPlatformInfo(platformId)!,
          price: priceData.price,
          originalPrice: priceData.originalPrice,
          currency: priceData.currency || 'JPY',
          availability: priceData.availability,
          condition: priceData.condition || 'new',
          seller: priceData.seller,
          shippingCost: priceData.shippingCost,
          productUrl: priceData.productUrl,
          timestamp: new Date(),
          metadata: priceData.metadata,
        });

        return {
          productId,
          platformId,
          success: true,
          price: priceData.price,
          currency: priceData.currency || 'JPY',
          availability: priceData.availability,
          timestamp: new Date(),
          metadata: priceData.metadata,
        };
      }

      return {
        productId,
        platformId,
        success: false,
        error: 'No price data available',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        productId,
        platformId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  private async fetchPlatformPrice(productId: string, platformId: string): Promise<{
    price: number;
    originalPrice?: number;
    currency?: string;
    availability: string;
    condition?: string;
    seller?: string;
    shippingCost?: number;
    productUrl: string;
    metadata?: Record<string, unknown>;
  } | null> {
    // Mock implementation - in real code, this would call actual platform APIs
    const mockPrices: Record<string, any> = {
      amazon: {
        price: Math.floor(Math.random() * 50000) + 1000,
        originalPrice: Math.floor(Math.random() * 60000) + 1500,
        currency: 'JPY',
        availability: 'in_stock',
        condition: 'new',
        seller: 'Amazon Japan',
        shippingCost: 0,
        productUrl: `https://amazon.co.jp/dp/${productId}`,
        metadata: { isPrime: true, deliverySpeed: 'next_day' },
      },
      rakuten: {
        price: Math.floor(Math.random() * 48000) + 1200,
        originalPrice: Math.floor(Math.random() * 55000) + 1400,
        currency: 'JPY',
        availability: 'in_stock',
        condition: 'new',
        seller: 'Rakuten Store',
        shippingCost: 320,
        productUrl: `https://books.rakuten.co.jp/rb/${productId}/`,
        metadata: { storeRating: 4.5, deliveryDays: 2 },
      },
    };

    return mockPrices[platformId] || null;
  }

  // Price history methods
  async getPriceHistory(
    productId: string,
    options: {
      platforms?: string[];
      days?: number;
      currency?: string;
    } = {}
  ): Promise<PriceEntry[]> {
    const { platforms = this.config.platforms, days = 90, currency = 'JPY' } = options;

    // Check cache first
    const cacheKey = platforms.length === 1 ? platforms[0] : 'all';
    const cachedHistory = await priceCacheService.getCachedPriceHistory(productId, cacheKey);
    if (cachedHistory) {
      logger.debug(`Cache hit for price history: product ${productId}, platform ${cacheKey}`);
      return cachedHistory;
    }

    // Cache miss - fetch from database
    const history = await this.fetchPriceHistoryFromDatabase(productId, { platforms, days, currency });

    // Cache the result
    await priceCacheService.cachePriceHistory(productId, history, cacheKey);

    return history;
  }

  private async fetchPriceHistoryFromDatabase(
    productId: string,
    options: {
      platforms: string[];
      days: number;
      currency: string;
    }
  ): Promise<PriceEntry[]> {
    try {
      const db = getDatabase();
      const { platforms, days, currency } = options;

      let query = db`
        SELECT
          ph.id,
          ph.product_id,
          ph.platform_id,
          ph.price,
          ph.currency,
          ph.recorded_at as timestamp,
          ph.source,
          p.name as product_name,
          p.description as product_description,
          pl.name as platform_name,
          pl.domain as platform_domain,
          po.availability,
          po.condition as item_condition,
          po.seller,
          po.url as product_url,
          po.shipping
        FROM price_history ph
        JOIN products p ON ph.product_id = p.id
        JOIN platforms pl ON ph.platform_id = pl.id
        LEFT JOIN product_offers po ON ph.product_id = po.product_id AND ph.platform_id = po.platform_id
        WHERE ph.product_id = ${productId}
        AND ph.recorded_at >= NOW() - INTERVAL '${days} days'
        AND ph.currency = ${currency}
      `;

      if (platforms.length > 0 && !platforms.includes('all')) {
        query = query`AND ph.platform_id = ANY(${platforms})`;
      }

      query = query`ORDER BY ph.recorded_at DESC`;

      const results = await query;

      return results.map(row => ({
        id: row.id,
        productId: row.product_id,
        platformId: row.platform_id,
        platform: {
          id: row.platform_id,
          name: row.platform_name,
          domain: row.platform_domain,
          supportedRegions: ['JP'],
          affiliateProgram: true,
        } as Platform,
        price: parseFloat(row.price),
        currency: row.currency,
        timestamp: row.timestamp,
        availability: row.availability?.in_stock ? 'in_stock' : 'out_of_stock',
        condition: row.item_condition || 'new',
        seller: row.seller || 'Unknown Seller',
        productUrl: row.product_url || `https://${row.platform_domain}`,
        metadata: {
          productName: row.product_name,
          productDescription: row.product_description,
          shipping: row.shipping,
        },
      }));
    } catch (error) {
      logger.error('Error fetching price history from database:', error);
      // Fallback to mock data
      return this.generateMockPriceHistory(productId, options);
    }
  }

  private generateMockPriceHistory(
    productId: string,
    options: {
      platforms: string[];
      days: number;
      currency: string;
    }
  ): PriceEntry[] {
    const { platforms, days, currency } = options;
    const mockHistory: PriceEntry[] = [];
    const now = new Date();

    for (let i = 0; i < Math.min(days, 30); i++) { // Limit mock data to 30 days
      const date = new Date(now.getTime() - (i * 24 * 60 * 60 * 1000));

      for (const platformId of platforms) {
        const basePrice = Math.floor(Math.random() * 20000) + 5000;
        const price = basePrice + Math.floor(Math.random() * 5000) - 2500;

        mockHistory.push({
          id: crypto.randomUUID(),
          productId,
          platformId,
          platform: this.getPlatformInfo(platformId)!,
          price: Math.max(100, price),
          currency,
          availability: Math.random() > 0.1 ? 'in_stock' : 'out_of_stock',
          condition: 'new',
          seller: `${platformId} Store`,
          productUrl: `https://${platformId}.co.jp/product/${productId}`,
          timestamp: date,
          metadata: { mock: true, generatedAt: new Date().toISOString() },
        });
      }
    }

    return mockHistory.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Price analysis methods
  async calculatePriceStatistics(
    productId: string,
    options: PriceStatisticsRequest
  ): Promise<PriceTrend | null> {
    // Check cache first
    const cachedStats = await priceCacheService.getCachedPriceStatistics(productId, options.periodDays);
    if (cachedStats) {
      logger.debug(`Cache hit for price statistics: product ${productId}, period ${options.periodDays} days`);
      return cachedStats;
    }

    const history = await this.getPriceHistory(productId, {
      platforms: options.platforms,
      days: options.periodDays,
      currency: options.currency,
    });

    if (history.length === 0) return null;

    // Group by platform
    const platformData = new Map<string, PriceEntry[]>();
    history.forEach(entry => {
      if (!platformData.has(entry.platformId)) {
        platformData.set(entry.platformId, []);
      }
      platformData.get(entry.platformId)!.push(entry);
    });

    // Calculate statistics for each platform
    const platformStats: Array<{
      platformId: string;
      currentPrice: number;
      averagePrice: number;
      lowestPrice: number;
      highestPrice: number;
      trend: 'up' | 'down' | 'stable';
    }> = [];

    for (const [platformId, entries] of platformData) {
      const prices = entries.map(e => e.price);
      const currentPrice = prices[0]; // Most recent
      const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      const lowestPrice = Math.min(...prices);
      const highestPrice = Math.max(...prices);

      // Calculate trend
      const recentPrices = prices.slice(0, Math.min(7, prices.length));
      const olderPrices = prices.slice(7, 14);
      const recentAvg = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
      const olderAvg = olderPrices.length > 0
        ? olderPrices.reduce((sum, price) => sum + price, 0) / olderPrices.length
        : recentAvg;

      let trend: 'up' | 'down' | 'stable' = 'stable';
      const changePercentage = ((recentAvg - olderAvg) / olderAvg) * 100;
      if (changePercentage > 2) trend = 'up';
      else if (changePercentage < -2) trend = 'down';

      platformStats.push({
        platformId,
        currentPrice,
        averagePrice,
        lowestPrice,
        highestPrice,
        trend,
      });
    }

    // Return the platform with the most data points
    const bestPlatform = platformStats.reduce((best, current) =>
      (history.filter(e => e.platformId === current.platformId).length >
       history.filter(e => e.platformId === best.platformId).length) ? current : best
    );

    const statistics = {
      productId,
      platform: this.getPlatformInfo(bestPlatform.platformId)!,
      currentPrice: bestPlatform.currentPrice,
      averagePrice: bestPlatform.averagePrice,
      lowestPrice: bestPlatform.lowestPrice,
      highestPrice: bestPlatform.highestPrice,
      priceChange: bestPlatform.currentPrice - bestPlatform.averagePrice,
      priceChangePercentage: ((bestPlatform.currentPrice - bestPlatform.averagePrice) / bestPlatform.averagePrice) * 100,
      trendDirection: bestPlatform.trend === 'up' ? 'up' : bestPlatform.trend === 'down' ? 'down' : 'stable',
      dataPoints: history.filter(e => e.platformId === bestPlatform.platformId).length,
      periodDays: options.periodDays,
      lastUpdated: new Date(),
    };

    // Cache the statistics
    await priceCacheService.cachePriceStatistics(productId, statistics, options.periodDays);

    return statistics;
  }

  async findHistoricalLow(
    productId: string,
    options: {
      platforms?: string[];
      days?: number;
    } = {}
  ): Promise<HistoricalLow | null> {
    const history = await this.getPriceHistory(productId, {
      platforms: options.platforms,
      days: options.days || this.config.maxHistoryDays,
    });

    if (history.length === 0) return null;

    // Find the lowest price across all platforms
    const lowestEntry = history.reduce((lowest, current) =>
      current.price < lowest.price ? current : lowest
    );

    return {
      productId,
      platform: lowestEntry.platform,
      price: lowestEntry.price,
      currency: lowestEntry.currency,
      date: lowestEntry.timestamp,
      availability: lowestEntry.availability,
      condition: lowestEntry.condition,
      seller: lowestEntry.seller,
      url: lowestEntry.productUrl,
      metadata: lowestEntry.metadata,
    };
  }

  // Price comparison methods
  async comparePrices(request: PriceComparisonRequest): Promise<{
    productId: string;
    offers: ProductOffer[];
    lowestPrice: number;
    highestPrice: number;
    averagePrice: number;
    bestValue: ProductOffer | null;
    comparison: Array<{
      platform: string;
      price: number;
      totalPrice: number;
      savings: number;
      ranking: number;
    }>;
  }> {
    const currentOffers = await this.getCurrentOffers(request.productId, request.platforms);
    const filteredOffers = this.filterOffers(currentOffers, request);

    if (filteredOffers.length === 0) {
      return {
        productId: request.productId,
        offers: [],
        lowestPrice: 0,
        highestPrice: 0,
        averagePrice: 0,
        bestValue: null,
        comparison: [],
      };
    }

    const prices = filteredOffers.map(offer => offer.price.amount);
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;

    // Calculate total prices including shipping
    const comparison = filteredOffers.map((offer, index) => {
      const totalPrice = this.calculateTotalPrice(offer, request.includeShipping);
      const savings = Math.max(0, highestPrice - offer.price.amount);

      return {
        platform: offer.platform.id,
        price: offer.price.amount,
        totalPrice,
        savings,
        ranking: index + 1,
      };
    }).sort((a, b) => a.totalPrice - b.totalPrice);

    const bestValue = filteredOffers.find(offer =>
      this.calculateTotalPrice(offer, request.includeShipping) === Math.min(...comparison.map(c => c.totalPrice))
    ) || null;

    return {
      productId: request.productId,
      offers: filteredOffers,
      lowestPrice,
      highestPrice,
      averagePrice,
      bestValue,
      comparison,
    };
  }

  private async getCurrentOffers(productId: string, platforms?: string[]): Promise<ProductOffer[]> {
    // Check cache first
    const cachedOffers = await priceCacheService.getCachedPriceComparison(productId);
    if (cachedOffers) {
      logger.debug(`Cache hit for product offers: product ${productId}`);
      return cachedOffers;
    }

    // In real implementation, this would query current offers from database or APIs
    const mockOffers: ProductOffer[] = [];
    const now = new Date();

    const targetPlatforms = platforms || this.config.platforms;

    for (const platformId of targetPlatforms) {
      const priceData = await this.fetchPlatformPrice(productId, platformId);
      if (priceData) {
        mockOffers.push({
          id: crypto.randomUUID(),
          productId,
          platform: this.getPlatformInfo(platformId)!,
          platformProductId: `${platformId}_${productId}`,
          title: `Product ${productId}`,
          description: 'Mock product description',
          price: {
            amount: priceData.price,
            originalPrice: priceData.originalPrice,
            currency: priceData.currency || 'JPY',
            discountPercentage: priceData.originalPrice
              ? Math.round(((priceData.originalPrice - priceData.price) / priceData.originalPrice) * 100)
              : undefined,
          },
          availability: {
            inStock: priceData.availability === 'in_stock',
            stockStatus: priceData.availability as any,
          },
          seller: {
            id: `${platformId}_seller`,
            name: priceData.seller || `${platformId} Seller`,
            isOfficial: platformId === 'amazon',
          },
          shipping: {
            free: priceData.shippingCost === 0,
            cost: priceData.shippingCost,
            methods: ['standard'],
            availableRegions: ['JP'],
          },
          condition: priceData.condition as any || 'new',
          url: priceData.productUrl,
          images: [],
          firstSeenAt: now,
          lastUpdatedAt: now,
          metadata: priceData.metadata,
        });
      }
    }

    // Cache the offers
    await priceCacheService.cachePriceComparison(productId, mockOffers);

    return mockOffers;
  }

  private filterOffers(offers: ProductOffer[], request: PriceComparisonRequest): ProductOffer[] {
    let filtered = offers;

    // Filter by condition
    if (request.condition !== 'any') {
      filtered = filtered.filter(offer => offer.condition === request.condition);
    }

    // Filter by currency
    filtered = filtered.filter(offer => offer.price.currency === request.currency);

    // Filter by availability (only in-stock items)
    filtered = filtered.filter(offer => offer.availability.inStock);

    return filtered;
  }

  private calculateTotalPrice(offer: ProductOffer, includeShipping: boolean): number {
    let total = offer.price.amount;
    if (includeShipping && offer.shipping.cost) {
      total += offer.shipping.cost;
    }
    return total;
  }

  // Alert and notification methods
  async checkPriceAlerts(alertConfigs: PriceAlertConfig[]): Promise<Array<{
    config: PriceAlertConfig;
    triggered: boolean;
    currentPrice?: number;
    targetPrice?: number;
    percentageDrop?: number;
    message?: string;
  }>> {
    const results = [];

    for (const config of alertConfigs) {
      if (!config.active) continue;

      const result = await this.checkPriceAlert(config);
      results.push(result);
    }

    return results;
  }

  private async checkPriceAlert(config: PriceAlertConfig): Promise<{
    config: PriceAlertConfig;
    triggered: boolean;
    currentPrice?: number;
    targetPrice?: number;
    percentageDrop?: number;
    message?: string;
  }> {
    const statistics = await this.calculatePriceStatistics(config.productId, {
      productId: config.productId,
      periodDays: 7,
    });

    if (!statistics) {
      return {
        config,
        triggered: false,
      };
    }

    const currentPrice = statistics.currentPrice;
    let triggered = false;
    let message: string | undefined;

    // Check target price
    if (config.targetPrice && currentPrice <= config.targetPrice) {
      triggered = true;
      message = `Price dropped to ¥${currentPrice.toLocaleString()}, below your target of ¥${config.targetPrice.toLocaleString()}`;
    }

    // Check percentage drop
    if (config.percentageDrop && statistics.priceChangePercentage <= -config.percentageDrop) {
      triggered = true;
      message = `Price dropped by ${Math.abs(statistics.priceChangePercentage).toFixed(1)}% to ¥${currentPrice.toLocaleString()}`;
    }

    // Check for any change
    if (config.notifyOnAnyChange) {
      const historicalLow = await this.findHistoricalLow(config.productId, { days: 90 });
      if (historicalLow && currentPrice <= historicalLow.price * 1.02) { // Within 2% of historical low
        triggered = true;
        message = `Price (¥${currentPrice.toLocaleString()}) is at or near historical low (¥${historicalLow.price.toLocaleString()})`;
      }
    }

    return {
      config,
      triggered,
      currentPrice,
      targetPrice: config.targetPrice,
      percentageDrop: config.percentageDrop,
      message,
    };
  }

  // Utility methods
  private getPlatformInfo(platformId: string): Platform | null {
    const platforms: Record<string, Platform> = {
      amazon: {
        id: 'amazon',
        name: 'Amazon Japan',
        domain: 'amazon.co.jp',
        supportedRegions: ['JP'],
        affiliateProgram: true,
      },
      rakuten: {
        id: 'rakuten',
        name: '楽天市場',
        domain: 'rakuten.co.jp',
        supportedRegions: ['JP'],
        affiliateProgram: true,
      },
      yahoo: {
        id: 'yahoo',
        name: 'Yahoo Shopping',
        domain: 'shopping.yahoo.co.jp',
        supportedRegions: ['JP'],
        affiliateProgram: true,
      },
      kakaku: {
        id: 'kakaku',
        name: '価格.com',
        domain: 'kakaku.com',
        supportedRegions: ['JP'],
        affiliateProgram: true,
      },
      mercari: {
        id: 'mercari',
        name: 'Mercari',
        domain: 'mercari.com',
        supportedRegions: ['JP'],
        affiliateProgram: false,
      },
    };

    return platforms[platformId] || null;
  }

  private async savePriceEntry(entry: PriceEntry): Promise<void> {
    // In real implementation, this would save to database
    console.log(`Saving price entry for product ${entry.productId} on ${entry.platformId}: ¥${entry.price}`);
  }

  // Public utility methods
  async getProductPriceRange(
    productId: string,
    options: {
      platforms?: string[];
      days?: number;
    } = {}
  ): Promise<{
    lowest: number;
    highest: number;
    average: number;
    platforms: string[];
  } | null> {
    const history = await this.getPriceHistory(productId, options);
    if (history.length === 0) return null;

    const prices = history.map(entry => entry.price);
    const platforms = [...new Set(history.map(entry => entry.platformId))];

    return {
      lowest: Math.min(...prices),
      highest: Math.max(...prices),
      average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
      platforms,
    };
  }

  async getBestPlatformForProduct(
    productId: string,
    criteria: 'lowest_price' | 'fastest_shipping' | 'best_rating' = 'lowest_price',
    options: {
      platforms?: string[];
    } = {}
  ): Promise<{
    platformId: string;
    offer: ProductOffer;
    score: number;
  } | null> {
    const offers = await this.getCurrentOffers(productId, options.platforms);
    if (offers.length === 0) return null;

    let bestOffer = offers[0];
    let bestScore = 0;

    for (const offer of offers) {
      let score = 0;

      switch (criteria) {
        case 'lowest_price':
          score = 100000 / (offer.price.amount + (offer.shipping.cost || 0));
          break;
        case 'fastest_shipping':
          score = offer.shipping.free ? 100 : 50 - (offer.shipping.estimatedDays || 7);
          break;
        case 'best_rating':
          // This would require review data
          score = offer.seller.isOfficial ? 80 : 50;
          break;
      }

      if (score > bestScore) {
        bestScore = score;
        bestOffer = offer;
      }
    }

    return {
      platformId: bestOffer.platform.id,
      offer: bestOffer,
      score: bestScore,
    };
  }
}

// Export schemas for validation
export {
  PriceTrackingConfigSchema,
  PriceComparisonRequestSchema,
  PriceStatisticsRequestSchema,
  PriceAlertConfigSchema,
  PriceTrackingResultSchema,
};

// Utility functions
export const createDefaultPriceTrackingConfig = (): PriceTrackingConfig => ({
  enabled: true,
  updateFrequency: 'daily',
  maxHistoryDays: 365,
  platforms: ['amazon', 'rakuten', 'yahoo'],
  alertThresholdPercentage: 5,
});

export const calculateSavings = (originalPrice: number, currentPrice: number): number => {
  return Math.max(0, originalPrice - currentPrice);
};

export const calculateSavingsPercentage = (originalPrice: number, currentPrice: number): number => {
  if (originalPrice <= currentPrice) return 0;
  return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
};

export const formatPrice = (price: number, currency: string = 'JPY'): string => {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
};