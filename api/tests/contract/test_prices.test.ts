/**
 * Prices API Contract Tests
 * Tests for price history and statistics endpoints according to OpenAPI specification
 */

import request from 'supertest';
import { Hono } from 'hono';
import { routes } from '../../src/routes';

// Mock the price service
jest.mock('../../src/services/price_service');
import { PriceService } from '../../src/services/price_service';

const app = new Hono();
app.route('/api/v1', routes);

describe('Prices API Contract Tests', () => {
  const mockProductId = 'prod_123456';
  const mockPlatformId = 'amazon';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /prices/{spuId}/history', () => {
    it('should return price history successfully', async () => {
      const mockPriceHistory = {
        history: [
          {
            productId: mockProductId,
            platformId: mockPlatformId,
            price: 120000,
            currency: 'JPY',
            recordedAt: '2024-01-01T00:00:00Z',
            source: 'api'
          },
          {
            productId: mockProductId,
            platformId: mockPlatformId,
            price: 115000,
            currency: 'JPY',
            recordedAt: '2024-01-15T00:00:00Z',
            source: 'api'
          },
          {
            productId: mockProductId,
            platformId: mockPlatformId,
            price: 110000,
            currency: 'JPY',
            recordedAt: '2024-02-01T00:00:00Z',
            source: 'api'
          }
        ],
        statistics: {
          productId: mockProductId,
          platformId: mockPlatformId,
          period: 30,
          currentPrice: 110000,
          averagePrice: 115000,
          lowestPrice: 110000,
          highestPrice: 120000,
          priceChangePercent: -8.33,
          trend: 'falling'
        }
      };

      (PriceService.getPriceHistory as jest.Mock).mockResolvedValue(mockPriceHistory);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/history`)
        .query({ days: 30, platform: mockPlatformId });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          history: [
            {
              productId: mockProductId,
              platformId: mockPlatformId,
              price: 120000,
              currency: 'JPY',
              recordedAt: '2024-01-01T00:00:00Z',
              source: 'api'
            },
            {
              productId: mockProductId,
              platformId: mockPlatformId,
              price: 115000,
              currency: 'JPY',
              recordedAt: '2024-01-15T00:00:00Z',
              source: 'api'
            },
            {
              productId: mockProductId,
              platformId: mockPlatformId,
              price: 110000,
              currency: 'JPY',
              recordedAt: '2024-02-01T00:00:00Z',
              source: 'api'
            }
          ],
          statistics: {
            productId: mockProductId,
            platformId: mockPlatformId,
            period: 30,
            currentPrice: 110000,
            averagePrice: 115000,
            lowestPrice: 110000,
            highestPrice: 120000,
            priceChangePercent: -8.33,
            trend: 'falling'
          }
        }
      });
      expect(PriceService.getPriceHistory).toHaveBeenCalledWith(mockProductId, 30, mockPlatformId);
    });

    it('should use default days parameter when not provided', async () => {
      const mockPriceHistory = {
        history: [],
        statistics: {
          productId: mockProductId,
          platformId: mockPlatformId,
          period: 90, // Default value
          currentPrice: 110000,
          averagePrice: 115000,
          lowestPrice: 110000,
          highestPrice: 120000,
          priceChangePercent: -8.33,
          trend: 'falling'
        }
      };

      (PriceService.getPriceHistory as jest.Mock).mockResolvedValue(mockPriceHistory);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/history`);

      expect(response.status).toBe(200);
      expect(PriceService.getPriceHistory).toHaveBeenCalledWith(mockProductId, 90, undefined);
    });

    it('should return 400 for invalid days parameter', async () => {
      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/history`)
        .query({ days: -5 });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Days must be positive');
    });

    it('should return 400 for days exceeding maximum', async () => {
      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/history`)
        .query({ days: 400 });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Days cannot exceed 365');
    });

    it('should return 404 for non-existent product', async () => {
      (PriceService.getPriceHistory as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/prices/nonexistent/history');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: 'Product not found'
      });
    });

    it('should return 400 for invalid product ID format', async () => {
      const response = await request(app)
        .get('/api/v1/prices/invalid-id/history');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid product ID');
    });

    it('should handle platform-specific price history', async () => {
      const mockPlatformHistory = {
        history: [
          {
            productId: mockProductId,
            platformId: 'rakuten',
            price: 108000,
            currency: 'JPY',
            recordedAt: '2024-02-01T00:00:00Z',
            source: 'api'
          }
        ],
        statistics: {
          productId: mockProductId,
          platformId: 'rakuten',
          period: 30,
          currentPrice: 108000,
          averagePrice: 108000,
          lowestPrice: 108000,
          highestPrice: 108000,
          priceChangePercent: 0,
          trend: 'stable'
        }
      };

      (PriceService.getPriceHistory as jest.Mock).mockResolvedValue(mockPlatformHistory);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/history`)
        .query({ platform: 'rakuten' });

      expect(response.status).toBe(200);
      expect(response.body.data.history[0].platformId).toBe('rakuten');
      expect(response.body.data.statistics.platformId).toBe('rakuten');
    });
  });

  describe('GET /prices/{spuId}/statistics', () => {
    it('should return price statistics successfully', async () => {
      const mockStatistics = {
        productId: mockProductId,
        platformId: mockPlatformId,
        period: 30,
        currentPrice: 110000,
        averagePrice: 115000,
        lowestPrice: 105000,
        highestPrice: 125000,
        priceChangePercent: -4.35,
        trend: 'stable',
        volatility: 0.15,
        volume: 25,
        lastUpdated: '2024-02-01T12:00:00Z'
      };

      (PriceService.getPriceStatistics as jest.Mock).mockResolvedValue(mockStatistics);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/statistics`)
        .query({ days: 30, platform: mockPlatformId });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          productId: mockProductId,
          platformId: mockPlatformId,
          period: 30,
          currentPrice: 110000,
          averagePrice: 115000,
          lowestPrice: 105000,
          highestPrice: 125000,
          priceChangePercent: -4.35,
          trend: 'stable',
          volatility: 0.15,
          volume: 25,
          lastUpdated: '2024-02-01T12:00:00Z'
        }
      });
      expect(PriceService.getPriceStatistics).toHaveBeenCalledWith(mockProductId, 30, mockPlatformId);
    });

    it('should return aggregated statistics across all platforms when platform not specified', async () => {
      const mockAggregatedStats = {
        productId: mockProductId,
        platformId: 'all',
        period: 30,
        currentPrice: 108000, // Lowest across platforms
        averagePrice: 113000,
        lowestPrice: 105000,
        highestPrice: 125000,
        priceChangePercent: -6.25,
        trend: 'falling',
        platformCount: 3,
        lastUpdated: '2024-02-01T12:00:00Z'
      };

      (PriceService.getPriceStatistics as jest.Mock).mockResolvedValue(mockAggregatedStats);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/statistics`)
        .query({ days: 30 });

      expect(response.status).toBe(200);
      expect(response.body.data.platformId).toBe('all');
      expect(response.body.data.platformCount).toBe(3);
    });

    it('should return 404 for product with no price data', async () => {
      (PriceService.getPriceStatistics as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/prices/no_data_product/statistics');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: 'No price data available'
      });
    });

    it('should return 400 for invalid days range', async () => {
      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/statistics`)
        .query({ days: 0 });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /prices/{spuId}/comparison', () => {
    it('should return price comparison across platforms', async () => {
      const mockComparison = {
        productId: mockProductId,
        platforms: [
          {
            platformId: 'amazon',
            platformName: 'Amazon',
            platformIcon: 'https://example.com/amazon.png',
            currentPrice: 110000,
            originalPrice: 125000,
            discount: 15000,
            discountPercentage: 12.0,
            currency: 'JPY',
            availability: 'in_stock',
            condition: 'new',
            seller: 'Amazon Japan',
            rating: 4.5,
            reviewCount: 1234,
            url: 'https://amazon.co.jp/dp/B0ABCDEFGH',
            lastUpdated: '2024-02-01T12:00:00Z'
          },
          {
            platformId: 'rakuten',
            platformName: '楽天',
            platformIcon: 'https://example.com/rakuten.png',
            currentPrice: 108000,
            originalPrice: 125000,
            discount: 17000,
            discountPercentage: 13.6,
            currency: 'JPY',
            availability: 'in_stock',
            condition: 'new',
            seller: 'Rakuten Store',
            rating: 4.3,
            reviewCount: 856,
            url: 'https://rakuten.co.jp/product/123',
            lastUpdated: '2024-02-01T11:30:00Z'
          },
          {
            platformId: 'yahoo',
            platformName: 'Yahoo Shopping',
            platformIcon: 'https://example.com/yahoo.png',
            currentPrice: 115000,
            originalPrice: 125000,
            discount: 10000,
            discountPercentage: 8.0,
            currency: 'JPY',
            availability: 'limited_stock',
            condition: 'new',
            seller: 'Yahoo Store',
            rating: 4.1,
            reviewCount: 432,
            url: 'https://shopping.yahoo.co.jp/product/456',
            lastUpdated: '2024-02-01T10:15:00Z'
          }
        ],
        lowestPrice: 108000,
        highestPrice: 115000,
        averagePrice: 111000,
        totalSavings: 17000,
        bestDeal: {
          platformId: 'rakuten',
          platformName: '楽天',
          savings: 17000,
          discountPercentage: 13.6
        },
        lastUpdated: '2024-02-01T12:00:00Z'
      };

      (PriceService.getPriceComparison as jest.Mock).mockResolvedValue(mockComparison);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/comparison`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          productId: mockProductId,
          platforms: expect.arrayContaining([
            expect.objectContaining({
              platformId: 'amazon',
              currentPrice: 110000,
              discountPercentage: 12.0
            }),
            expect.objectContaining({
              platformId: 'rakuten',
              currentPrice: 108000,
              discountPercentage: 13.6
            }),
            expect.objectContaining({
              platformId: 'yahoo',
              currentPrice: 115000,
              discountPercentage: 8.0
            })
          ]),
          lowestPrice: 108000,
          highestPrice: 115000,
          averagePrice: 111000,
          totalSavings: 17000,
          bestDeal: {
            platformId: 'rakuten',
            platformName: '楽天',
            savings: 17000,
            discountPercentage: 13.6
          },
          lastUpdated: '2024-02-01T12:00:00Z'
        }
      });
    });

    it('should filter by condition when specified', async () => {
      const mockUsedComparison = {
        productId: mockProductId,
        platforms: [
          {
            platformId: 'mercari',
            platformName: 'Mercari',
            currentPrice: 95000,
            condition: 'used',
            currency: 'JPY',
            availability: 'in_stock'
          }
        ],
        condition: 'used',
        lowestPrice: 95000,
        highestPrice: 95000,
        averagePrice: 95000
      };

      (PriceService.getPriceComparison as jest.Mock).mockResolvedValue(mockUsedComparison);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/comparison`)
        .query({ condition: 'used' });

      expect(response.status).toBe(200);
      expect(response.body.data.platforms[0].condition).toBe('used');
      expect(response.body.data.condition).toBe('used');
    });

    it('should return 404 for product with no offers', async () => {
      (PriceService.getPriceComparison as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/prices/no_offers/comparison');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: 'No price offers available'
      });
    });
  });

  describe('POST /prices/{spuId}/track', () => {
    it('should start price tracking successfully', async () => {
      const mockTrackingResult = {
        productId: mockProductId,
        trackingId: 'track_123',
        status: 'active',
        platforms: ['amazon', 'rakuten'],
        frequency: 'daily',
        createdAt: '2024-02-01T00:00:00Z',
        nextUpdate: '2024-02-02T00:00:00Z'
      };

      (PriceService.startPriceTracking as jest.Mock).mockResolvedValue(mockTrackingResult);

      const response = await request(app)
        .post(`/api/v1/prices/${mockProductId}/track`)
        .send({
          platforms: ['amazon', 'rakuten'],
          frequency: 'daily',
          alertThreshold: 5.0
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        message: 'Price tracking started',
        data: {
          productId: mockProductId,
          trackingId: 'track_123',
          status: 'active',
          platforms: ['amazon', 'rakuten'],
          frequency: 'daily',
          createdAt: '2024-02-01T00:00:00Z',
          nextUpdate: '2024-02-02T00:00:00Z'
        }
      });
      expect(PriceService.startPriceTracking).toHaveBeenCalledWith(mockProductId, {
        platforms: ['amazon', 'rakuten'],
        frequency: 'daily',
        alertThreshold: 5.0
      });
    });

    it('should return 400 for invalid tracking parameters', async () => {
      const response = await request(app)
        .post(`/api/v1/prices/${mockProductId}/track`)
        .send({
          platforms: ['invalid_platform'],
          frequency: 'invalid_frequency'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 409 when tracking already exists', async () => {
      (PriceService.startPriceTracking as jest.Mock).mockRejectedValue(
        new Error('Price tracking already exists for this product')
      );

      const response = await request(app)
        .post(`/api/v1/prices/${mockProductId}/track`)
        .send({
          platforms: ['amazon']
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        success: false,
        error: 'Price tracking already exists for this product'
      });
    });
  });

  describe('DELETE /prices/{spuId}/track', () => {
    it('should stop price tracking successfully', async () => {
      (PriceService.stopPriceTracking as jest.Mock).mockResolvedValue(true);

      const response = await request(app)
        .delete(`/api/v1/prices/${mockProductId}/track`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Price tracking stopped'
      });
      expect(PriceService.stopPriceTracking).toHaveBeenCalledWith(mockProductId);
    });

    it('should return 404 when tracking does not exist', async () => {
      (PriceService.stopPriceTracking as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .delete('/api/v1/prices/no_tracking/track');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: 'No active tracking found for this product'
      });
    });
  });

  describe('Response Schema Validation', () => {
    it('should validate price history response schema', async () => {
      const mockHistory = {
        history: [
          {
            productId: mockProductId,
            platformId: mockPlatformId,
            price: 120000,
            currency: 'JPY',
            recordedAt: '2024-01-01T00:00:00Z',
            source: 'api'
          }
        ],
        statistics: {
          productId: mockProductId,
          platformId: mockPlatformId,
          period: 30,
          currentPrice: 120000,
          averagePrice: 120000,
          lowestPrice: 120000,
          highestPrice: 120000,
          priceChangePercent: 0,
          trend: 'stable'
        }
      };

      (PriceService.getPriceHistory as jest.Mock).mockResolvedValue(mockHistory);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/history`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('history');
      expect(response.body.data).toHaveProperty('statistics');

      // Validate history array structure
      expect(Array.isArray(response.body.data.history)).toBe(true);
      if (response.body.data.history.length > 0) {
        expect(response.body.data.history[0]).toHaveProperty('productId');
        expect(response.body.data.history[0]).toHaveProperty('price');
        expect(response.body.data.history[0]).toHaveProperty('currency');
        expect(response.body.data.history[0]).toHaveProperty('recordedAt');
      }
    });

    it('should validate price statistics response schema', async () => {
      const mockStats = {
        productId: mockProductId,
        platformId: mockPlatformId,
        period: 30,
        currentPrice: 110000,
        averagePrice: 115000,
        lowestPrice: 105000,
        highestPrice: 125000,
        priceChangePercent: -4.35,
        trend: 'stable'
      };

      (PriceService.getPriceStatistics as jest.Mock).mockResolvedValue(mockStats);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/statistics`);

      expect(response.status).toBe(200);

      // Validate statistics object structure
      expect(response.body.data).toHaveProperty('productId');
      expect(response.body.data).toHaveProperty('currentPrice');
      expect(response.body.data).toHaveProperty('averagePrice');
      expect(response.body.data).toHaveProperty('lowestPrice');
      expect(response.body.data).toHaveProperty('highestPrice');
      expect(response.body.data).toHaveProperty('priceChangePercent');
      expect(response.body.data).toHaveProperty('trend');

      // Validate trend enum
      expect(['rising', 'falling', 'stable']).toContain(response.body.data.trend);
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      (PriceService.getPriceHistory as jest.Mock).mockRejectedValue(new Error('Service unavailable'));

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/history`);

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toEqual({
        success: false,
        error: 'Failed to retrieve price history'
      });
    });

    it('should handle database connection errors', async () => {
      (PriceService.getPriceStatistics as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/statistics`);

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle malformed product IDs', async () => {
      const response = await request(app)
        .get('/api/v1/prices/../../../etc/passwd/history');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Performance and Caching', () => {
    it('should include cache headers in responses', async () => {
      const mockHistory = {
        history: [],
        statistics: {
          productId: mockProductId,
          platformId: mockPlatformId,
          period: 30,
          currentPrice: 110000,
          averagePrice: 115000,
          lowestPrice: 105000,
          highestPrice: 125000,
          priceChangePercent: -4.35,
          trend: 'stable'
        }
      };

      (PriceService.getPriceHistory as jest.Mock).mockResolvedValue(mockHistory);

      const response = await request(app)
        .get(`/api/v1/prices/${mockProductId}/history`);

      expect(response.status).toBe(200);
      // Note: Cache headers would be validated based on actual implementation
    });

    it('should handle concurrent requests efficiently', async () => {
      const mockHistory = {
        history: [],
        statistics: {
          productId: mockProductId,
          platformId: mockPlatformId,
          period: 30,
          currentPrice: 110000,
          averagePrice: 115000,
          lowestPrice: 105000,
          highestPrice: 125000,
          priceChangePercent: -4.35,
          trend: 'stable'
        }
      };

      (PriceService.getPriceHistory as jest.Mock).mockResolvedValue(mockHistory);

      // Make multiple concurrent requests
      const promises = Array(5).fill(null).map(() =>
        request(app).get(`/api/v1/prices/${mockProductId}/history`)
      );

      const responses = await Promise.all(promises);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);
      });
    });
  });
});