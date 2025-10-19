/**
 * Price history model validation tests
 * Tests for price entry validation and business logic
 */

import { z } from 'zod';
import {
  priceEntrySchema,
  priceTrendSchema,
  historicalLowSchema,
  priceAlertConditionSchema,
  priceStatisticsSchema,
  PriceHistoryModel,
  type PriceEntry,
  type PriceAlertCondition,
  type HistoricalLow
} from '../../../src/models/price_history';
import { platformSchema } from '../../../src/models/product';

describe('Price History Model Validation', () => {
  const basePriceEntry = {
    productId: 'prod_123',
    platformId: 'amazon_123',
    platform: 'amazon' as const,
    price: 10000,
    originalPrice: 12000,
    currency: 'JPY',
    availability: 'in_stock' as const,
    condition: 'new' as const,
    seller: 'Amazon Japan',
    shippingCost: 0,
    productUrl: 'https://amazon.co.jp/dp/B0ABCDEFGH'
  };

  const samplePrices: PriceEntry[] = [
    {
      ...basePriceEntry,
      id: 'price_1',
      timestamp: '2024-01-01T00:00:00Z',
      price: 12000
    },
    {
      ...basePriceEntry,
      id: 'price_2',
      timestamp: '2024-01-15T00:00:00Z',
      price: 11000
    },
    {
      ...basePriceEntry,
      id: 'price_3',
      timestamp: '2024-02-01T00:00:00Z',
      price: 10000
    },
    {
      ...basePriceEntry,
      id: 'price_4',
      timestamp: '2024-02-15T00:00:00Z',
      price: 10500
    }
  ];

  describe('priceEntrySchema Validation', () => {
    it('should validate a valid price entry', () => {
      const validEntry = {
        ...basePriceEntry,
        id: 'price_123',
        timestamp: '2024-01-01T00:00:00Z'
      };
      expect(() => priceEntrySchema.parse(validEntry)).not.toThrow();
    });

    it('should reject entry with negative price', () => {
      const invalidEntry = { ...basePriceEntry, price: -1000 };
      expect(() => priceEntrySchema.parse(invalidEntry)).toThrow(z.ZodError);
    });

    it('should reject entry with invalid currency', () => {
      const invalidEntry = { ...basePriceEntry, currency: 'INVALID' };
      expect(() => priceEntrySchema.parse(invalidEntry)).toThrow(z.ZodError);
    });

    it('should reject entry with invalid URL', () => {
      const invalidEntry = { ...basePriceEntry, productUrl: 'invalid-url' };
      expect(() => priceEntrySchema.parse(invalidEntry)).toThrow(z.ZodError);
    });

    it('should reject entry with invalid availability status', () => {
      const invalidEntry = { ...basePriceEntry, availability: 'invalid_status' as any };
      expect(() => priceEntrySchema.parse(invalidEntry)).toThrow(z.ZodError);
    });

    it('should accept entry without optional fields', () => {
      const minimalEntry = {
        ...basePriceEntry,
        id: 'price_123',
        timestamp: '2024-01-01T00:00:00Z',
        originalPrice: undefined,
        seller: undefined,
        shippingCost: undefined
      };
      expect(() => priceEntrySchema.parse(minimalEntry)).not.toThrow();
    });
  });

  describe('priceTrendSchema Validation', () => {
    const validTrend = {
      productId: 'prod_123',
      platform: 'amazon' as const,
      currentPrice: 10000,
      averagePrice: 11000,
      lowestPrice: 9000,
      highestPrice: 13000,
      priceChange: -1000,
      priceChangePercentage: -9.09,
      trendDirection: 'down' as const,
      dataPoints: 30,
      periodDays: 30,
      lastUpdated: '2024-01-01T00:00:00Z'
    };

    it('should validate valid price trend', () => {
      expect(() => priceTrendSchema.parse(validTrend)).not.toThrow();
    });

    it('should reject trend with negative data points', () => {
      const invalidTrend = { ...validTrend, dataPoints: -1 };
      expect(() => priceTrendSchema.parse(invalidTrend)).toThrow(z.ZodError);
    });

    it('should reject trend with invalid trend direction', () => {
      const invalidTrend = { ...validTrend, trendDirection: 'invalid' as any };
      expect(() => priceTrendSchema.parse(invalidTrend)).toThrow(z.ZodError);
    });
  });

  describe('historicalLowSchema Validation', () => {
    const validHistoricalLow = {
      productId: 'prod_123',
      platform: 'amazon' as const,
      lowestPrice: 9000,
      priceDate: '2024-01-15T00:00:00Z',
      daysSinceLow: 15,
      currentPrice: 10000,
      isCurrentLow: false,
      averagePrice: 10500,
      typicalPriceRange: { min: 9500, max: 11500 }
    };

    it('should validate valid historical low', () => {
      expect(() => historicalLowSchema.parse(validHistoricalLow)).not.toThrow();
    });

    it('should reject historical low with negative days', () => {
      const invalidLow = { ...validHistoricalLow, daysSinceLow: -1 };
      expect(() => historicalLowSchema.parse(invalidLow)).toThrow(z.ZodError);
    });

    it('should reject historical low with invalid price range', () => {
      const invalidLow = {
        ...validHistoricalLow,
        typicalPriceRange: { min: 11500, max: 9500 } // min > max
      };
      expect(() => historicalLowSchema.parse(invalidLow)).toThrow(z.ZodError);
    });
  });

  describe('priceAlertConditionSchema Validation', () => {
    const validCondition = {
      id: 'alert_123',
      userId: 'user_123',
      productId: 'prod_123',
      condition: 'below_target' as const,
      targetPrice: 10000,
      isActive: true,
      createdAt: '2024-01-01T00:00:00Z'
    };

    it('should validate valid alert condition', () => {
      expect(() => priceAlertConditionSchema.parse(validCondition)).not.toThrow();
    });

    it('should accept condition without platform', () => {
      const conditionWithoutPlatform = { ...validCondition, platform: undefined };
      expect(() => priceAlertConditionSchema.parse(conditionWithoutPlatform)).not.toThrow();
    });

    it('should reject condition with invalid alert type', () => {
      const invalidCondition = { ...validCondition, condition: 'invalid_type' as any };
      expect(() => priceAlertConditionSchema.parse(invalidCondition)).toThrow(z.ZodError);
    });

    it('should reject condition with negative target price', () => {
      const invalidCondition = { ...validCondition, targetPrice: -1000 };
      expect(() => priceAlertConditionSchema.parse(invalidCondition)).toThrow(z.ZodError);
    });
  });

  describe('priceStatisticsSchema Validation', () => {
    const validStatistics = {
      productId: 'prod_123',
      platform: 'amazon' as const,
      totalDataPoints: 100,
      averagePrice: 10500,
      medianPrice: 10000,
      standardDeviation: 1500,
      priceRange: { min: 8000, max: 15000, spread: 7000 },
      recentVolatility: 500,
      availabilityRate: 0.95,
      lastUpdated: '2024-01-01T00:00:00Z'
    };

    it('should validate valid price statistics', () => {
      expect(() => priceStatisticsSchema.parse(validStatistics)).not.toThrow();
    });

    it('should reject statistics with availability rate outside 0-1 range', () => {
      const invalidStats = { ...validStatistics, availabilityRate: 1.5 };
      expect(() => priceStatisticsSchema.parse(invalidStats)).toThrow(z.ZodError);
    });

    it('should reject statistics with negative standard deviation', () => {
      const invalidStats = { ...validStatistics, standardDeviation: -100 };
      expect(() => priceStatisticsSchema.parse(invalidStats)).toThrow(z.ZodError);
    });
  });

  describe('PriceHistoryModel Business Logic', () => {
    describe('create method', () => {
      it('should create price entry with generated id and timestamp', () => {
        const priceData = {
          ...basePriceEntry,
          productId: 'prod_new'
        };

        const createdEntry = PriceHistoryModel.create(priceData);

        expect(createdEntry.id).toBeDefined();
        expect(createdEntry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(createdEntry.timestamp).toBeDefined();
        expect(() => new Date(createdEntry.timestamp)).not.toThrow();
      });
    });

    describe('validate method', () => {
      it('should validate correct price entry data', () => {
        const validEntry = {
          ...basePriceEntry,
          id: 'price_123',
          timestamp: '2024-01-01T00:00:00Z'
        };
        expect(() => PriceHistoryModel.validate(validEntry)).not.toThrow();
      });

      it('should throw error for invalid price entry data', () => {
        const invalidEntry = { ...basePriceEntry, price: -1000 };
        expect(() => PriceHistoryModel.validate(invalidEntry)).toThrow(z.ZodError);
      });
    });

    describe('calculateTrend method', () => {
      it('should calculate price trend correctly', () => {
        const trend = PriceHistoryModel.calculateTrend(samplePrices);

        expect(trend).not.toBeNull();
        expect(trend!.productId).toBe('prod_123');
        expect(trend!.platform).toBe('amazon');
        expect(trend!.currentPrice).toBe(10500); // Last price
        expect(trend!.averagePrice).toBeCloseTo(10875, 0); // Average of all prices
        expect(trend!.lowestPrice).toBe(10000);
        expect(trend!.highestPrice).toBe(12000);
        expect(trend!.dataPoints).toBe(4);
      });

      it('should return null for single price point', () => {
        const singlePrice = [samplePrices[0]];
        expect(PriceHistoryModel.calculateTrend(singlePrice)).toBeNull();
      });

      it('should identify upward trend', () => {
        const upwardPrices = [
          { ...samplePrices[0], price: 10000, timestamp: '2024-01-01T00:00:00Z' },
          { ...samplePrices[1], price: 12000, timestamp: '2024-01-15T00:00:00Z' }
        ];
        const trend = PriceHistoryModel.calculateTrend(upwardPrices);
        expect(trend!.trendDirection).toBe('up');
        expect(trend!.priceChange).toBePositive();
      });

      it('should identify stable trend for small changes', () => {
        const stablePrices = [
          { ...samplePrices[0], price: 10000, timestamp: '2024-01-01T00:00:00Z' },
          { ...samplePrices[1], price: 10150, timestamp: '2024-01-15T00:00:00Z' } // 1.5% change
        ];
        const trend = PriceHistoryModel.calculateTrend(stablePrices);
        expect(trend!.trendDirection).toBe('stable');
      });
    });

    describe('findHistoricalLow method', () => {
      it('should find historical low correctly', () => {
        const historicalLow = PriceHistoryModel.findHistoricalLow(samplePrices, 90);

        expect(historicalLow).not.toBeNull();
        expect(historicalLow!.productId).toBe('prod_123');
        expect(historicalLow!.lowestPrice).toBe(10000);
        expect(historicalLow!.priceDate).toBe('2024-02-01T00:00:00Z');
      });

      it('should return null for empty price array', () => {
        expect(PriceHistoryModel.findHistoricalLow([], 90)).toBeNull();
      });

      it('should filter prices by date range', () => {
        // Create prices outside 30-day range
        const oldPrices = [
          { ...samplePrices[0], price: 5000, timestamp: '2023-01-01T00:00:00Z' },
          ...samplePrices
        ];

        const historicalLow = PriceHistoryModel.findHistoricalLow(oldPrices, 30);
        expect(historicalLow!.lowestPrice).toBe(10000); // Should ignore the 5000 price from old date
      });

      it('should calculate typical price range correctly', () => {
        const historicalLow = PriceHistoryModel.findHistoricalLow(samplePrices, 90);
        expect(historicalLow!.typicalPriceRange.min).toBeDefined();
        expect(historicalLow!.typicalPriceRange.max).toBeDefined();
        expect(historicalLow!.typicalPriceRange.max).toBeGreaterThan(historicalLow!.typicalPriceRange.min);
      });
    });

    describe('calculateStatistics method', () => {
      it('should calculate comprehensive statistics', () => {
        const stats = PriceHistoryModel.calculateStatistics(samplePrices);

        expect(stats).not.toBeNull();
        expect(stats!.productId).toBe('prod_123');
        expect(stats!.totalDataPoints).toBe(4);
        expect(stats!.averagePrice).toBeCloseTo(10875, 0);
        expect(stats!.medianPrice).toBe(10750); // (10500 + 11000) / 2
        expect(stats!.priceRange.min).toBe(10000);
        expect(stats!.priceRange.max).toBe(12000);
        expect(stats!.priceRange.spread).toBe(2000);
      });

      it('should return null for empty price array', () => {
        expect(PriceHistoryModel.calculateStatistics([])).toBeNull();
      });

      it('should calculate availability rate correctly', () => {
        const mixedAvailability = [
          { ...samplePrices[0], availability: 'in_stock' as const },
          { ...samplePrices[1], availability: 'out_of_stock' as const },
          { ...samplePrices[2], availability: 'in_stock' as const },
          { ...samplePrices[3], availability: 'limited_stock' as const }
        ];

        const stats = PriceHistoryModel.calculateStatistics(mixedAvailability);
        expect(stats!.availabilityRate).toBeCloseTo(0.75, 2); // 3 out of 4 in stock
      });
    });

    describe('checkAlertCondition method', () => {
      const priceEntry: PriceEntry = {
        ...basePriceEntry,
        id: 'price_123',
        timestamp: '2024-01-01T00:00:00Z',
        price: 9500
      };

      it('should check below_target condition correctly', () => {
        const condition: PriceAlertCondition = {
          id: 'alert_1',
          userId: 'user_123',
          productId: 'prod_123',
          condition: 'below_target',
          targetPrice: 10000,
          isActive: true,
          createdAt: '2024-01-01T00:00:00Z'
        };

        expect(PriceHistoryModel.checkAlertCondition(priceEntry, condition)).toBe(true);
      });

      it('should check historical_low condition correctly', () => {
        const condition: PriceAlertCondition = {
          id: 'alert_2',
          userId: 'user_123',
          productId: 'prod_123',
          condition: 'historical_low',
          isActive: true,
          createdAt: '2024-01-01T00:00:00Z'
        };

        const historicalLow: HistoricalLow = {
          productId: 'prod_123',
          platform: 'amazon',
          lowestPrice: 10000,
          priceDate: '2024-01-15T00:00:00Z',
          daysSinceLow: 15,
          currentPrice: 11000,
          isCurrentLow: false,
          averagePrice: 10500,
          typicalPriceRange: { min: 9500, max: 11500 }
        };

        expect(PriceHistoryModel.checkAlertCondition(priceEntry, condition, historicalLow)).toBe(true);
      });

      it('should check percentage_drop condition correctly', () => {
        const condition: PriceAlertCondition = {
          id: 'alert_3',
          userId: 'user_123',
          productId: 'prod_123',
          condition: 'percentage_drop',
          percentage: 20,
          isActive: true,
          createdAt: '2024-01-01T00:00:00Z'
        };

        const priceWithOriginal = {
          ...priceEntry,
          originalPrice: 12000,
          price: 9500 // 20.83% drop
        };

        expect(PriceHistoryModel.checkAlertCondition(priceWithOriginal, condition)).toBe(true);
      });
    });

    describe('getPriceChanges method', () => {
      it('should filter prices by date range', () => {
        const startDate = new Date('2024-01-10T00:00:00Z');
        const endDate = new Date('2024-02-10T00:00:00Z');

        const filteredPrices = PriceHistoryModel.getPriceChanges(samplePrices, startDate, endDate);

        expect(filteredPrices).toHaveLength(2);
        expect(filteredPrices[0].timestamp).toBe('2024-01-15T00:00:00Z');
        expect(filteredPrices[1].timestamp).toBe('2024-02-01T00:00:00Z');
      });

      it('should return empty array for no matching dates', () => {
        const futureDate = new Date('2025-01-01T00:00:00Z');
        const endDate = new Date('2025-12-31T00:00:00Z');

        const filteredPrices = PriceHistoryModel.getPriceChanges(samplePrices, futureDate, endDate);
        expect(filteredPrices).toHaveLength(0);
      });
    });

    describe('detectPriceDrops method', () => {
      it('should detect significant price drops', () => {
        const pricesWithDrops = [
          { ...samplePrices[0], price: 12000, originalPrice: 12000, timestamp: '2024-01-01T00:00:00Z' },
          { ...samplePrices[1], price: 9500, originalPrice: 12000, timestamp: '2024-01-15T00:00:00Z' }, // 20.83% drop
          { ...samplePrices[2], price: 10000, originalPrice: 12000, timestamp: '2024-02-01T00:00:00Z' } // 16.67% drop
        ];

        const drops = PriceHistoryModel.detectPriceDrops(pricesWithDrops, 15);

        expect(drops).toHaveLength(2);
        expect(drops[0].dropPercentage).toBeCloseTo(20.83, 1);
        expect(drops[1].dropPercentage).toBeCloseTo(16.67, 1);
      });

      it('should return empty array for no significant drops', () => {
        const stablePrices = [
          { ...samplePrices[0], price: 12000, originalPrice: 12000, timestamp: '2024-01-01T00:00:00Z' },
          { ...samplePrices[1], price: 11500, originalPrice: 12000, timestamp: '2024-01-15T00:00:00Z' } // Only 4.17% drop
        ];

        const drops = PriceHistoryModel.detectPriceDrops(stablePrices, 10);
        expect(drops).toHaveLength(0);
      });
    });
  });
});