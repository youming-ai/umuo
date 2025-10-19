/**
 * Products API route integration tests
 * Tests for /api/v1/products endpoints
 */

import request from 'supertest';
import { Hono } from 'hono';
import { routes } from '../../../src/routes';

// Mock the products service
jest.mock('../../../src/services/products_service');
import { ProductsService } from '../../../src/services/products_service';

const app = new Hono();
app.route('/api/v1', routes);

describe('Products API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/products/:id', () => {
    const mockProduct = {
      id: 'prod_123',
      name: 'iPhone 15 Pro',
      description: 'Latest iPhone with A17 Pro chip',
      brand: 'Apple',
      category: {
        id: 'cat_123',
        name: { ja: 'スマートフォン', en: 'Smartphones' },
        level: 1
      },
      images: [
        {
          url: 'https://example.com/iphone15pro.jpg',
          alt: { ja: 'iPhone 15 Pro', en: 'iPhone 15 Pro' },
          width: 800,
          height: 600,
          order: 0
        }
      ],
      specifications: [
        {
          name: 'Display',
          value: '6.1 inches',
          unit: 'inches'
        },
        {
          name: 'Storage',
          value: '128',
          unit: 'GB'
        }
      ],
      identifiers: {
        jan: '4901234567890',
        asin: 'B0C2XYZ123'
      },
      status: 'active',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-15')
    };

    it('should return product details for valid ID', async () => {
      (ProductsService.getProductById as jest.Mock).mockResolvedValue(mockProduct);

      const response = await request(app)
        .get('/api/v1/products/prod_123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockProduct);
      expect(ProductsService.getProductById).toHaveBeenCalledWith('prod_123');
    });

    it('should return 404 for non-existent product', async () => {
      (ProductsService.getProductById as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/products/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Product not found');
    });

    it('should return 400 for invalid product ID format', async () => {
      const response = await request(app)
        .get('/api/v1/products/invalid-id');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid product ID');
    });

    it('should handle service errors gracefully', async () => {
      (ProductsService.getProductById as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/products/prod_123');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/v1/products/:id/prices', () => {
    const mockPrices = [
      {
        id: 'price_1',
        productId: 'prod_123',
        platformId: 'amazon_123',
        platform: 'amazon',
        price: 120000,
        originalPrice: 140000,
        currency: 'JPY',
        availability: 'in_stock',
        condition: 'new',
        seller: 'Amazon Japan',
        productUrl: 'https://amazon.co.jp/dp/B0C2XYZ123',
        timestamp: '2024-01-15T10:00:00Z'
      },
      {
        id: 'price_2',
        productId: 'prod_123',
        platformId: 'rakuten_123',
        platform: 'rakuten',
        price: 125000,
        originalPrice: 140000,
        currency: 'JPY',
        availability: 'in_stock',
        condition: 'new',
        seller: 'Rakuten',
        productUrl: 'https://rakuten.co.jp/product/123',
        timestamp: '2024-01-15T10:05:00Z'
      }
    ];

    it('should return price comparison for product', async () => {
      (ProductsService.getProductPrices as jest.Mock).mockResolvedValue(mockPrices);

      const response = await request(app)
        .get('/api/v1/products/prod_123/prices');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        productId: 'prod_123',
        prices: mockPrices,
        total: 2,
        lowestPrice: 120000,
        highestPrice: 125000,
        averagePrice: 122500,
        lastUpdated: '2024-01-15T10:05:00Z'
      });
    });

    it('should return prices for specific platforms only', async () => {
      const filteredPrices = mockPrices.filter(p => p.platform === 'amazon');
      (ProductsService.getProductPrices as jest.Mock).mockResolvedValue(filteredPrices);

      const response = await request(app)
        .get('/api/v1/products/prod_123/prices')
        .query({ platforms: 'amazon' });

      expect(response.status).toBe(200);
      expect(ProductsService.getProductPrices).toHaveBeenCalledWith(
        'prod_123',
        ['amazon']
      );
    });

    it('should return prices for multiple platforms', async () => {
      (ProductsService.getProductPrices as jest.Mock).mockResolvedValue(mockPrices);

      const response = await request(app)
        .get('/api/v1/products/prod_123/prices')
        .query({ platforms: 'amazon,rakuten' });

      expect(response.status).toBe(200);
      expect(ProductsService.getProductPrices).toHaveBeenCalledWith(
        'prod_123',
        ['amazon', 'rakuten']
      );
    });

    it('should return 404 for non-existent product', async () => {
      (ProductsService.getProductPrices as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/products/nonexistent/prices');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('Product not found');
    });

    it('should return 400 for invalid platform parameters', async () => {
      const response = await request(app)
        .get('/api/v1/products/prod_123/prices')
        .query({ platforms: 'invalid_platform' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid platform');
    });
  });

  describe('GET /api/v1/products/:id/price-history', () => {
    const mockPriceHistory = {
      productId: 'prod_123',
      platform: 'amazon',
      currentPrice: 120000,
      averagePrice: 125000,
      lowestPrice: 110000,
      highestPrice: 140000,
      priceChange: -5000,
      priceChangePercentage: -4.0,
      trendDirection: 'down',
      dataPoints: 30,
      periodDays: 30,
      historicalLows: [
        {
          lowestPrice: 110000,
          priceDate: '2024-01-10T00:00:00Z',
          daysSinceLow: 5,
          isCurrentLow: false
        }
      ],
      lastUpdated: '2024-01-15T10:00:00Z'
    };

    it('should return price history for product', async () => {
      (ProductsService.getProductPriceHistory as jest.Mock).mockResolvedValue(mockPriceHistory);

      const response = await request(app)
        .get('/api/v1/products/prod_123/price-history');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockPriceHistory);
      expect(ProductsService.getProductPriceHistory).toHaveBeenCalledWith(
        'prod_123',
        30, // default days
        undefined // default platform
      );
    });

    it('should return price history for specific period', async () => {
      (ProductsService.getProductPriceHistory as jest.Mock).mockResolvedValue(mockPriceHistory);

      const response = await request(app)
        .get('/api/v1/products/prod_123/price-history')
        .query({ days: 90 });

      expect(response.status).toBe(200);
      expect(ProductsService.getProductPriceHistory).toHaveBeenCalledWith(
        'prod_123',
        90,
        undefined
      );
    });

    it('should return price history for specific platform', async () => {
      (ProductsService.getProductPriceHistory as jest.Mock).mockResolvedValue(mockPriceHistory);

      const response = await request(app)
        .get('/api/v1/products/prod_123/price-history')
        .query({ platform: 'amazon' });

      expect(response.status).toBe(200);
      expect(ProductsService.getProductPriceHistory).toHaveBeenCalledWith(
        'prod_123',
        30,
        'amazon'
      );
    });

    it('should return 400 for invalid days parameter', async () => {
      const response = await request(app)
        .get('/api/v1/products/prod_123/price-history')
        .query({ days: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('days');
    });

    it('should return 400 for days over maximum', async () => {
      const response = await request(app)
        .get('/api/v1/products/prod_123/price-history')
        .query({ days: 366 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('days');
    });
  });

  describe('GET /api/v1/products/:id/reviews', () => {
    const mockReviews = {
      productId: 'prod_123',
      platform: 'amazon',
      overallRating: 4.5,
      totalReviews: 1250,
      aiSummary: 'Users praise the excellent camera performance and battery life, but some find the price high.',
      pros: [
        'Excellent camera quality',
        'Fast performance with A17 chip',
        'Good battery life',
        'Premium build quality'
      ],
      cons: [
        'Expensive price point',
        'Limited changes from previous model',
        'USB-C port only on Pro models'
      ],
      ratingDistribution: {
        5: 800,
        4: 300,
        3: 100,
        2: 30,
        1: 20
      },
      lastUpdated: '2024-01-15T10:00:00Z'
    };

    it('should return review summary for product', async () => {
      (ProductsService.getProductReviews as jest.Mock).mockResolvedValue(mockReviews);

      const response = await request(app)
        .get('/api/v1/products/prod_123/reviews');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockReviews);
      expect(ProductsService.getProductReviews).toHaveBeenCalledWith(
        'prod_123',
        'amazon' // default platform
      );
    });

    it('should return reviews for specific platform', async () => {
      (ProductsService.getProductReviews as jest.Mock).mockResolvedValue(mockReviews);

      const response = await request(app)
        .get('/api/v1/products/prod_123/reviews')
        .query({ platform: 'rakuten' });

      expect(response.status).toBe(200);
      expect(ProductsService.getProductReviews).toHaveBeenCalledWith(
        'prod_123',
        'rakuten'
      );
    });

    it('should return 404 when no reviews found', async () => {
      (ProductsService.getProductReviews as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/products/prod_123/reviews');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('No reviews found');
    });
  });

  describe('POST /api/v1/products/:id/watchlist', () => {
    it('should add product to user watchlist', async () => {
      (ProductsService.addToWatchlist as jest.Mock).mockResolvedValue({
        id: 'watch_123',
        userId: 'user_123',
        productId: 'prod_123',
        createdAt: '2024-01-15T10:00:00Z'
      });

      const response = await request(app)
        .post('/api/v1/products/prod_123/watchlist')
        .set('Authorization', 'Bearer valid-token')
        .send({ notes: 'Interested in buying when price drops' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.productId).toBe('prod_123');
      expect(ProductsService.addToWatchlist).toHaveBeenCalledWith(
        expect.any(String), // userId from token
        'prod_123',
        'Interested in buying when price drops'
      );
    });

    it('should return 401 for unauthorized request', async () => {
      const response = await request(app)
        .post('/api/v1/products/prod_123/watchlist')
        .send({ notes: 'Test note' });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for product already in watchlist', async () => {
      (ProductsService.addToWatchlist as jest.Mock).mockRejectedValue(
        new Error('Product already in watchlist')
      );

      const response = await request(app)
        .post('/api/v1/products/prod_123/watchlist')
        .set('Authorization', 'Bearer valid-token')
        .send({ notes: 'Test note' });

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already in watchlist');
    });

    it('should validate notes length', async () => {
      const response = await request(app)
        .post('/api/v1/products/prod_123/watchlist')
        .set('Authorization', 'Bearer valid-token')
        .send({ notes: 'a'.repeat(501) }); // Over 500 character limit

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('notes');
    });
  });

  describe('DELETE /api/v1/products/:id/watchlist', () => {
    it('should remove product from user watchlist', async () => {
      (ProductsService.removeFromWatchlist as jest.Mock).mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/v1/products/prod_123/watchlist')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Product removed from watchlist'
      });
      expect(ProductsService.removeFromWatchlist).toHaveBeenCalledWith(
        expect.any(String), // userId from token
        'prod_123'
      );
    });

    it('should return 401 for unauthorized request', async () => {
      const response = await request(app)
        .delete('/api/v1/products/prod_123/watchlist');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 when product not in watchlist', async () => {
      (ProductsService.removeFromWatchlist as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .delete('/api/v1/products/prod_123/watchlist')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found in watchlist');
    });
  });

  describe('GET /api/v1/products/:id/alternatives', () => {
    const mockAlternatives = [
      {
        id: 'prod_456',
        name: 'iPhone 15',
        brand: 'Apple',
        category: { id: 'cat_123', name: { ja: 'スマートフォン' }, level: 1 },
        currentPrice: 98000,
        similarity: 0.85,
        reasons: ['Same brand', 'Similar features', 'Lower price']
      },
      {
        id: 'prod_789',
        name: 'Galaxy S24',
        brand: 'Samsung',
        category: { id: 'cat_123', name: { ja: 'スマートフォン' }, level: 1 },
        currentPrice: 95000,
        similarity: 0.75,
        reasons: ['Competing flagship', 'Similar performance', 'Good value']
      }
    ];

    it('should return alternative products', async () => {
      (ProductsService.getProductAlternatives as jest.Mock).mockResolvedValue(mockAlternatives);

      const response = await request(app)
        .get('/api/v1/products/prod_123/alternatives');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        productId: 'prod_123',
        alternatives: mockAlternatives,
        total: 2
      });
      expect(ProductsService.getProductAlternatives).toHaveBeenCalledWith(
        'prod_123',
        5, // default limit
        undefined // default category filter
      );
    });

    it('should return limited number of alternatives', async () => {
      (ProductsService.getProductAlternatives as jest.Mock).mockResolvedValue(mockAlternatives);

      const response = await request(app)
        .get('/api/v1/products/prod_123/alternatives')
        .query({ limit: 3 });

      expect(response.status).toBe(200);
      expect(ProductsService.getProductAlternatives).toHaveBeenCalledWith(
        'prod_123',
        3,
        undefined
      );
    });

    it('should return alternatives filtered by category', async () => {
      (ProductsService.getProductAlternatives as jest.Mock).mockResolvedValue(mockAlternatives);

      const response = await request(app)
        .get('/api/v1/products/prod_123/alternatives')
        .query({ category: 'smartphones' });

      expect(response.status).toBe(200);
      expect(ProductsService.getProductAlternatives).toHaveBeenCalledWith(
        'prod_123',
        5,
        'smartphones'
      );
    });

    it('should return 400 for invalid limit parameter', async () => {
      const response = await request(app)
        .get('/api/v1/products/prod_123/alternatives')
        .query({ limit: 0 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('limit');
    });
  });

  describe('Product Search and Filters', () => {
    it('should handle JAN code lookup', async () => {
      const mockProductByJan = {
        ...mockProduct,
        identifiers: { jan: '4901234567890' }
      };
      (ProductsService.getProductByJan as jest.Mock).mockResolvedValue(mockProductByJan);

      const response = await request(app)
        .get('/api/v1/products/lookup')
        .query({ jan: '4901234567890' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockProductByJan);
      expect(ProductsService.getProductByJan).toHaveBeenCalledWith('4901234567890');
    });

    it('should handle ASIN lookup', async () => {
      const mockProductByAsin = {
        ...mockProduct,
        identifiers: { asin: 'B0C2XYZ123' }
      };
      (ProductsService.getProductByAsin as jest.Mock).mockResolvedValue(mockProductByAsin);

      const response = await request(app)
        .get('/api/v1/products/lookup')
        .query({ asin: 'B0C2XYZ123' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockProductByAsin);
      expect(ProductsService.getProductByAsin).toHaveBeenCalledWith('B0C2XYZ123');
    });

    it('should return 400 for missing lookup parameters', async () => {
      const response = await request(app)
        .get('/api/v1/products/lookup');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('jan or asin');
    });

    it('should validate JAN code format', async () => {
      const response = await request(app)
        .get('/api/v1/products/lookup')
        .query({ jan: 'invalid-jan' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid JAN format');
    });

    it('should validate ASIN format', async () => {
      const response = await request(app)
        .get('/api/v1/products/lookup')
        .query({ asin: 'invalid-asin' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid ASIN format');
    });
  });
});