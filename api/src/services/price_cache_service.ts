/**
 * Price caching service for Yabaii API
 * Implements Redis caching for price data to improve performance
 */

import { CacheKeys, CacheTTL, CacheService } from '@/config/redis';
import { logger } from '@/utils/logger';
import { PriceHistory, PriceStatistics } from '@/models/price_history';

interface PriceData {
  productId: string;
  platformId: string;
  price: number;
  currency: string;
  recordedAt: Date;
  source: string;
}

interface CurrentPrice {
  price: number;
  currency: string;
  platform: string;
  seller?: string;
  availability: boolean;
  lastUpdated: Date;
}

interface HistoricalLow {
  price: number;
  currency: string;
  platform: string;
  date: Date;
  daysSinceLow: number;
}

export class PriceCacheService {
  private cache: CacheService;

  constructor() {
    this.cache = new CacheService();
  }

  /**
   * Cache price history for a product
   */
  async cachePriceHistory(
    productId: string,
    priceHistory: PriceHistory[],
    platform: string = 'all'
  ): Promise<void> {
    try {
      const cacheKey = CacheKeys.priceHistory(productId, platform);
      await this.cache.set(cacheKey, priceHistory, CacheTTL.priceHistory);
      logger.debug(`Cached price history for product ${productId}, platform ${platform}`);
    } catch (error) {
      logger.error('Failed to cache price history:', error);
    }
  }

  /**
   * Get cached price history for a product
   */
  async getCachedPriceHistory(
    productId: string,
    platform: string = 'all'
  ): Promise<PriceHistory[] | null> {
    try {
      const cacheKey = CacheKeys.priceHistory(productId, platform);
      return await this.cache.get<PriceHistory[]>(cacheKey);
    } catch (error) {
      logger.error('Failed to get cached price history:', error);
      return null;
    }
  }

  /**
   * Cache current price for a product-platform combination
   */
  async cacheCurrentPrice(
    productId: string,
    platform: string,
    priceData: CurrentPrice
  ): Promise<void> {
    try {
      const cacheKey = CacheKeys.currentPrice(productId, platform);
      await this.cache.set(cacheKey, priceData, CacheTTL.currentPrice);
      logger.debug(`Cached current price for product ${productId}, platform ${platform}`);
    } catch (error) {
      logger.error('Failed to cache current price:', error);
    }
  }

  /**
   * Get cached current price for a product-platform combination
   */
  async getCachedCurrentPrice(
    productId: string,
    platform: string
  ): Promise<CurrentPrice | null> {
    try {
      const cacheKey = CacheKeys.currentPrice(productId, platform);
      return await this.cache.get<CurrentPrice>(cacheKey);
    } catch (error) {
      logger.error('Failed to get cached current price:', error);
      return null;
    }
  }

  /**
   * Cache price statistics for a product
   */
  async cachePriceStatistics(
    productId: string,
    statistics: PriceStatistics,
    period: number = 90
  ): Promise<void> {
    try {
      const cacheKey = CacheKeys.priceStats(productId, period);
      await this.cache.set(cacheKey, statistics, CacheTTL.priceStats);
      logger.debug(`Cached price statistics for product ${productId}, period ${period} days`);
    } catch (error) {
      logger.error('Failed to cache price statistics:', error);
    }
  }

  /**
   * Get cached price statistics for a product
   */
  async getCachedPriceStatistics(
    productId: string,
    period: number = 90
  ): Promise<PriceStatistics | null> {
    try {
      const cacheKey = CacheKeys.priceStats(productId, period);
      return await this.cache.get<PriceStatistics>(cacheKey);
    } catch (error) {
      logger.error('Failed to get cached price statistics:', error);
      return null;
    }
  }

  /**
   * Cache historical low price for a product
   */
  async cacheHistoricalLow(
    productId: string,
    historicalLow: HistoricalLow
  ): Promise<void> {
    try {
      const cacheKey = CacheKeys.historicalLow(productId);
      await this.cache.set(cacheKey, historicalLow, CacheTTL.historicalLow);
      logger.debug(`Cached historical low for product ${productId}`);
    } catch (error) {
      logger.error('Failed to cache historical low:', error);
    }
  }

  /**
   * Get cached historical low price for a product
   */
  async getCachedHistoricalLow(productId: string): Promise<HistoricalLow | null> {
    try {
      const cacheKey = CacheKeys.historicalLow(productId);
      return await this.cache.get<HistoricalLow>(cacheKey);
    } catch (error) {
      logger.error('Failed to get cached historical low:', error);
      return null;
    }
  }

  /**
   * Invalidate all price-related cache for a product
   */
  async invalidateProductPriceCache(productId: string): Promise<void> {
    try {
      const patterns = [
        CacheKeys.priceHistory(productId, '*').replace('*', ''),
        CacheKeys.currentPrice(productId, '*').replace('*', ''),
        CacheKeys.priceStats(productId, '*').replace('*', ''),
        CacheKeys.historicalLow(productId),
      ];

      for (const pattern of patterns) {
        await this.cache.clearPattern(pattern);
      }

      logger.info(`Invalidated price cache for product ${productId}`);
    } catch (error) {
      logger.error('Failed to invalidate product price cache:', error);
    }
  }

  /**
   * Batch cache price data for multiple products
   */
  async batchCachePriceHistory(priceDataArray: Array<{
    productId: string;
    platform: string;
    priceHistory: PriceHistory[];
  }>): Promise<void> {
    const cachePromises = priceDataArray.map(({ productId, platform, priceHistory }) =>
      this.cachePriceHistory(productId, priceHistory, platform)
    );

    try {
      await Promise.all(cachePromises);
      logger.debug(`Batch cached price history for ${priceDataArray.length} products`);
    } catch (error) {
      logger.error('Failed to batch cache price history:', error);
    }
  }

  /**
   * Cache price comparison data across platforms
   */
  async cachePriceComparison(
    productId: string,
    comparisonData: Array<{
      platform: string;
      price: number;
      currency: string;
      availability: boolean;
      seller?: string;
      lastUpdated: Date;
    }>
  ): Promise<void> {
    try {
      const cacheKey = CacheKeys.productOffers(productId);
      await this.cache.set(cacheKey, comparisonData, CacheTTL.productOffers);
      logger.debug(`Cached price comparison for product ${productId}`);
    } catch (error) {
      logger.error('Failed to cache price comparison:', error);
    }
  }

  /**
   * Get cached price comparison data
   */
  async getCachedPriceComparison(productId: string): Promise<any[] | null> {
    try {
      const cacheKey = CacheKeys.productOffers(productId);
      return await this.cache.get<any[]>(cacheKey);
    } catch (error) {
      logger.error('Failed to get cached price comparison:', error);
      return null;
    }
  }

  /**
   * Cache price drop alerts
   */
  async cachePriceDropAlerts(
    productId: string,
    alerts: Array<{
      platform: string;
      currentPrice: number;
      previousPrice: number;
      dropPercentage: number;
      dropAmount: number;
      timestamp: Date;
    }>
  ): Promise<void> {
    try {
      const cacheKey = `alerts:price_drop:${productId}`;
      await this.cache.set(cacheKey, alerts, CacheTTL.priceStats);
      logger.debug(`Cached price drop alerts for product ${productId}`);
    } catch (error) {
      logger.error('Failed to cache price drop alerts:', error);
    }
  }

  /**
   * Get cached price drop alerts
   */
  async getCachedPriceDropAlerts(productId: string): Promise<any[] | null> {
    try {
      const cacheKey = `alerts:price_drop:${productId}`;
      return await this.cache.get<any[]>(cacheKey);
    } catch (error) {
      logger.error('Failed to get cached price drop alerts:', error);
      return null;
    }
  }

  /**
   * Cache trending products based on price drops
   */
  async cacheTrendingPriceDrops(
    trendingData: Array<{
      productId: string;
      productName: string;
      biggestDrop: number;
      dropPercentage: number;
      platforms: string[];
      lastUpdated: Date;
    }>,
    category: string = 'all'
  ): Promise<void> {
    try {
      const cacheKey = `trending:price_drops:${category}`;
      await this.cache.set(cacheKey, trendingData, CacheTTL.trendingDeals);
      logger.debug(`Cached trending price drops for category ${category}`);
    } catch (error) {
      logger.error('Failed to cache trending price drops:', error);
    }
  }

  /**
   * Get cached trending products with price drops
   */
  async getCachedTrendingPriceDrops(category: string = 'all'): Promise<any[] | null> {
    try {
      const cacheKey = `trending:price_drops:${category}`;
      return await this.cache.get<any[]>(cacheKey);
    } catch (error) {
      logger.error('Failed to get cached trending price drops:', error);
      return null;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalKeys: number;
    memoryUsage: string;
    hitRate?: number;
  }> {
    try {
      const redis = this.cache['redis'];
      const info = await redis.info('memory');
      const keyspaceInfo = await redis.info('keyspace');

      return {
        totalKeys: this.parseKeyspaceInfo(keyspaceInfo),
        memoryUsage: this.parseMemoryInfo(info),
      };
    } catch (error) {
      logger.error('Failed to get cache stats:', error);
      return {
        totalKeys: 0,
        memoryUsage: 'Unknown',
      };
    }
  }

  private parseMemoryInfo(info: string): string {
    const lines = info.split('\r\n');
    const usedMemoryLine = lines.find(line => line.startsWith('used_memory_human:'));
    return usedMemoryLine ? usedMemoryLine.split(':')[1] : 'Unknown';
  }

  private parseKeyspaceInfo(info: string): number {
    const lines = info.split('\r\n');
    let totalKeys = 0;

    for (const line of lines) {
      if (line.startsWith('db')) {
        const match = line.match(/keys=(\d+)/);
        if (match) {
          totalKeys += parseInt(match[1]);
        }
      }
    }

    return totalKeys;
  }

  /**
   * Clear all price-related cache (use with caution)
   */
  async clearAllPriceCache(): Promise<void> {
    try {
      const patterns = [
        'price:*',
        'alerts:price_drop:*',
        'trending:price_drops:*',
      ];

      for (const pattern of patterns) {
        await this.cache.clearPattern(pattern);
      }

      logger.warn('Cleared all price cache');
    } catch (error) {
      logger.error('Failed to clear all price cache:', error);
    }
  }
}

export const priceCacheService = new PriceCacheService();
export default priceCacheService;