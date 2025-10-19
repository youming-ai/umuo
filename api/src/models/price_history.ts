/**
 * Price history model and related types
 * Defines the structure for tracking price changes over time
 */

import { z } from 'zod';
import { platformSchema } from './product';

// Price entry schema
export const priceEntrySchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  platformId: z.string(),
  platform: platformSchema,
  price: z.number().positive(),
  originalPrice: z.number().positive().optional(),
  currency: z.string().length(3).default('JPY'),
  availability: z.enum(['in_stock', 'out_of_stock', 'limited_stock', 'discontinued']),
  condition: z.enum(['new', 'used', 'refurbished']).default('new'),
  seller: z.string().optional(),
  shippingCost: z.number().nonnegative().optional(),
  productUrl: z.string().url(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).optional()
});

export type PriceEntry = z.infer<typeof priceEntrySchema>;

// Price trend analysis
export const priceTrendSchema = z.object({
  productId: z.string().uuid(),
  platform: platformSchema,
  currentPrice: z.number().positive(),
  averagePrice: z.number().positive(),
  lowestPrice: z.number().positive(),
  highestPrice: z.number().positive(),
  priceChange: z.number(), // Can be negative
  priceChangePercentage: z.number(),
  trendDirection: z.enum(['up', 'down', 'stable']),
  dataPoints: z.number().nonnegative(),
  periodDays: z.number().positive(),
  lastUpdated: z.string().datetime()
});

export type PriceTrend = z.infer<typeof priceTrendSchema>;

// Historical low calculation
export const historicalLowSchema = z.object({
  productId: z.string().uuid(),
  platform: platformSchema,
  lowestPrice: z.number().positive(),
  priceDate: z.string().datetime(),
  daysSinceLow: z.number().nonnegative(),
  currentPrice: z.number().positive(),
  isCurrentLow: z.boolean(),
  averagePrice: z.number().positive(),
  typicalPriceRange: z.object({
    min: z.number().positive(),
    max: z.number().positive()
  })
});

export type HistoricalLow = z.infer<typeof historicalLowSchema>;

// Price alert condition
export const priceAlertConditionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  platform: platformSchema.optional(),
  condition: z.enum(['below_target', 'historical_low', 'percentage_drop']),
  targetPrice: z.number().positive().optional(),
  percentage: z.number().positive().optional(), // For percentage_drop condition
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  triggeredAt: z.string().datetime().optional()
});

export type PriceAlertCondition = z.infer<typeof priceAlertConditionSchema>;

// Price statistics
export const priceStatisticsSchema = z.object({
  productId: z.string().uuid(),
  platform: platformSchema,
  totalDataPoints: z.number().nonnegative(),
  averagePrice: z.number().positive(),
  medianPrice: z.number().positive(),
  standardDeviation: z.number().nonnegative(),
  priceRange: z.object({
    min: z.number().positive(),
    max: z.number().positive(),
    spread: z.number().positive()
  }),
  recentVolatility: z.number().nonnegative(), // Price volatility in last 30 days
  availabilityRate: z.number().min(0).max(1), // Fraction of time item was in stock
  lastUpdated: z.string().datetime()
});

export type PriceStatistics = z.infer<typeof priceStatisticsSchema>;

export class PriceHistoryModel {
  /**
   * Create a new price entry
   */
  static create(priceData: Omit<PriceEntry, 'id' | 'timestamp'>): PriceEntry {
    return {
      ...priceData,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validate price entry data
   */
  static validate(priceData: unknown): PriceEntry {
    return priceEntrySchema.parse(priceData);
  }

  /**
   * Calculate price trend from price history
   */
  static calculateTrend(prices: PriceEntry[], periodDays: number = 30): PriceTrend | null {
    if (prices.length < 2) return null;

    const sortedPrices = prices.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const currentPrice = sortedPrices[sortedPrices.length - 1].price;
    const oldestPrice = sortedPrices[0].price;

    const priceChange = currentPrice - oldestPrice;
    const priceChangePercentage = (priceChange / oldestPrice) * 100;

    const averagePrice = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
    const lowestPrice = Math.min(...prices.map(p => p.price));
    const highestPrice = Math.max(...prices.map(p => p.price));

    // Determine trend direction
    let trendDirection: 'up' | 'down' | 'stable';
    if (Math.abs(priceChangePercentage) < 2) {
      trendDirection = 'stable';
    } else if (priceChangePercentage > 0) {
      trendDirection = 'up';
    } else {
      trendDirection = 'down';
    }

    return {
      productId: prices[0].productId,
      platform: prices[0].platform,
      currentPrice,
      averagePrice,
      lowestPrice,
      highestPrice,
      priceChange,
      priceChangePercentage,
      trendDirection,
      dataPoints: prices.length,
      periodDays,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Find historical low within specified period
   */
  static findHistoricalLow(
    prices: PriceEntry[],
    days: number = 90
  ): HistoricalLow | null {
    if (prices.length === 0) return null;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const recentPrices = prices.filter(p =>
      new Date(p.timestamp) >= cutoffDate
    );

    if (recentPrices.length === 0) return null;

    const lowestEntry = recentPrices.reduce((lowest, current) =>
      current.price < lowest.price ? current : lowest
    );

    const currentPrice = prices[prices.length - 1].price;
    const averagePrice = recentPrices.reduce((sum, p) => sum + p.price, 0) / recentPrices.length;
    const pricesSorted = [...recentPrices].sort((a, b) => a.price - b.price);
    const q1Index = Math.floor(pricesSorted.length * 0.25);
    const q3Index = Math.floor(pricesSorted.length * 0.75);
    const typicalPriceRange = {
      min: pricesSorted[q1Index]?.price || lowestEntry.price,
      max: pricesSorted[q3Index]?.price || lowestEntry.price
    };

    return {
      productId: lowestEntry.productId,
      platform: lowestEntry.platform,
      lowestPrice: lowestEntry.price,
      priceDate: lowestEntry.timestamp,
      daysSinceLow: Math.floor(
        (new Date().getTime() - new Date(lowestEntry.timestamp).getTime()) /
        (1000 * 60 * 60 * 24)
      ),
      currentPrice,
      isCurrentLow: currentPrice <= lowestEntry.price,
      averagePrice,
      typicalPriceRange
    };
  }

  /**
   * Calculate price statistics
   */
  static calculateStatistics(prices: PriceEntry[]): PriceStatistics | null {
    if (prices.length === 0) return null;

    const priceValues = prices.map(p => p.price);
    const averagePrice = priceValues.reduce((sum, price) => sum + price, 0) / priceValues.length;

    // Calculate median
    const sortedPrices = [...priceValues].sort((a, b) => a - b);
    const medianPrice = sortedPrices.length % 2 === 0
      ? (sortedPrices[sortedPrices.length / 2 - 1] + sortedPrices[sortedPrices.length / 2]) / 2
      : sortedPrices[Math.floor(sortedPrices.length / 2)];

    // Calculate standard deviation
    const variance = priceValues.reduce((sum, price) =>
      sum + Math.pow(price - averagePrice, 2), 0
    ) / priceValues.length;
    const standardDeviation = Math.sqrt(variance);

    const minPrice = Math.min(...priceValues);
    const maxPrice = Math.max(...priceValues);

    // Calculate recent volatility (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentPrices = prices.filter(p => new Date(p.timestamp) >= thirtyDaysAgo);

    let recentVolatility = 0;
    if (recentPrices.length >= 2) {
      const recentPriceValues = recentPrices.map(p => p.price);
      const recentAverage = recentPriceValues.reduce((sum, price) => sum + price, 0) / recentPriceValues.length;
      const recentVariance = recentPriceValues.reduce((sum, price) =>
        sum + Math.pow(price - recentAverage, 2), 0
      ) / recentPriceValues.length;
      recentVolatility = Math.sqrt(recentVariance);
    }

    // Calculate availability rate
    const inStockCount = prices.filter(p =>
      p.availability === 'in_stock' || p.availability === 'limited_stock'
    ).length;
    const availabilityRate = inStockCount / prices.length;

    return {
      productId: prices[0].productId,
      platform: prices[0].platform,
      totalDataPoints: prices.length,
      averagePrice,
      medianPrice,
      standardDeviation,
      priceRange: {
        min: minPrice,
        max: maxPrice,
        spread: maxPrice - minPrice
      },
      recentVolatility,
      availabilityRate,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Check if price matches alert condition
   */
  static checkAlertCondition(
    price: PriceEntry,
    condition: PriceAlertCondition,
    historicalLow?: HistoricalLow
  ): boolean {
    switch (condition.condition) {
      case 'below_target':
        return condition.targetPrice ? price.price <= condition.targetPrice : false;

      case 'historical_low':
        if (!historicalLow) return false;
        return price.price <= historicalLow.lowestPrice;

      case 'percentage_drop':
        if (!condition.percentage || !price.originalPrice) return false;
        const dropPercentage = ((price.originalPrice - price.price) / price.originalPrice) * 100;
        return dropPercentage >= condition.percentage;

      default:
        return false;
    }
  }

  /**
   * Get price changes between two dates
   */
  static getPriceChanges(
    prices: PriceEntry[],
    startDate: Date,
    endDate: Date
  ): PriceEntry[] {
    return prices.filter(p => {
      const priceDate = new Date(p.timestamp);
      return priceDate >= startDate && priceDate <= endDate;
    }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Detect significant price drops
   */
  static detectPriceDrops(
    prices: PriceEntry[],
    thresholdPercentage: number = 20
  ): Array<{price: PriceEntry, dropPercentage: number, previousPrice: number}> {
    const significantDrops: Array<{price: PriceEntry, dropPercentage: number, previousPrice: number}> = [];

    const sortedPrices = prices.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (let i = 1; i < sortedPrices.length; i++) {
      const currentPrice = sortedPrices[i];
      const previousPrice = sortedPrices[i - 1];

      if (previousPrice.originalPrice && previousPrice.originalPrice > currentPrice.price) {
        const dropPercentage = ((previousPrice.originalPrice - currentPrice.price) / previousPrice.originalPrice) * 100;

        if (dropPercentage >= thresholdPercentage) {
          significantDrops.push({
            price: currentPrice,
            dropPercentage,
            previousPrice: previousPrice.originalPrice
          });
        }
      }
    }

    return significantDrops;
  }
}