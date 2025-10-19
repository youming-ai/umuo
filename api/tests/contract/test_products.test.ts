import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { ProductSchema } from '../../src/models/product';
import { mockPlatformClients } from '../utils/mock-platforms';
import { setupTestServer, teardownTestServer } from '../utils/test-server';

describe('Products API Contract Tests', () => {
  let server: any;
  let platforms: any;

  beforeAll(async () => {
    server = await setupTestServer();
    platforms = mockPlatformClients;
  });

  afterAll(async () => {
    await teardownTestServer(server);
  });

  describe('POST /api/products/search', () => {
    test('should search products by keyword successfully', async () => {
      // Mock platform responses
      platforms.amazon.searchByKeyword.mockResolvedValue([
        {
          id: 'test-amazon-product-1',
          name: 'テスト商品',
          price: 2980,
          currency: 'JPY',
          url: 'https://amazon.co.jp/dp/test-amazon-product-1',
          imageUrl: 'https://images.amazon.com/images/test.jpg',
          platform: 'amazon',
          availability: 'in_stock',
          rating: 4.5,
          reviewCount: 124,
        }
      ]);

      platforms.rakuten.searchByKeyword.mockResolvedValue([
        {
          id: 'test-rakuten-product-1',
          name: 'テスト商品',
          price: 2850,
          currency: 'JPY',
          url: 'https://books.rakuten.co.jp/rb/test-rakuten-product-1/',
          imageUrl: 'https://thumbnail.image.rakuten.co.jp/test.jpg',
          platform: 'rakuten',
          availability: 'in_stock',
          rating: 4.2,
          reviewCount: 89,
        }
      ]);

      const searchRequest = {
        query: 'テスト商品',
        filters: {
          categories: ['electronics'],
          priceRange: { min: 1000, max: 5000 },
          condition: 'new',
          brands: ['ソニー', 'パナソニック'],
          rating: 4.0,
        },
        sort: {
          field: 'price',
          order: 'asc',
        },
        pagination: {
          page: 1,
          limit: 20,
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/products/search',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchRequest),
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      // Validate response structure
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('pagination');
      expect(result).toHaveProperty('filters');
      expect(result).toHaveProperty('searchMeta');

      // Validate pagination
      expect(result.pagination).toEqual({
        currentPage: 1,
        totalPages: expect.any(Number),
        totalResults: expect.any(Number),
        hasNext: expect.any(Boolean),
        hasPrev: false,
        limit: 20,
      });

      // Validate search metadata
      expect(result.searchMeta).toEqual({
        query: 'テスト商品',
        searchTime: expect.any(Number),
        platformsSearched: ['amazon', 'rakuten'],
        resultsCount: expect.any(Number),
      });

      // Validate product results
      expect(result.results).toHaveLength(2);

      result.results.forEach((product: any) => {
        expect(() => ProductSchema.parse(product)).not.toThrow();
        expect(product.platform).toMatch(/^(amazon|rakuten)$/);
        expect(product.price).toBeGreaterThanOrEqual(1000);
        expect(product.price).toBeLessThanOrEqual(5000);
      });

      // Verify platform services were called correctly
      expect(platforms.amazon.searchByKeyword).toHaveBeenCalledWith('テスト商品', {
        category: 'electronics',
        priceRange: { min: 1000, max: 5000 },
        condition: 'new',
        brands: ['ソニー', 'パナソニック'],
        rating: 4.0,
        sort: { field: 'price', order: 'asc' },
        page: 1,
        limit: 20,
      });
    });

    test('should search products by JAN code successfully', async () => {
      platforms.amazon.searchByCode.mockResolvedValue([
        {
          id: 'test-jan-product',
          name: 'JANテスト商品',
          price: 1500,
          currency: 'JPY',
          url: 'https://amazon.co.jp/dp/test-jan-product',
          imageUrl: 'https://images.amazon.com/images/test-jan.jpg',
          platform: 'amazon',
          availability: 'in_stock',
          rating: 4.0,
          reviewCount: 56,
          jan: '4901085083126',
        }
      ]);

      const searchRequest = {
        query: '4901085083126',
        searchType: 'code',
        filters: {},
        pagination: {
          page: 1,
          limit: 20,
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/products/search',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchRequest),
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].identifiers.jan).toBe('4901085083126');

      // Verify correct platform service was called
      expect(platforms.amazon.searchByCode).toHaveBeenCalledWith('4901085083126', 'jan', {});
    });

    test('should handle empty search results gracefully', async () => {
      platforms.amazon.searchByKeyword.mockResolvedValue([]);
      platforms.rakuten.searchByKeyword.mockResolvedValue([]);

      const searchRequest = {
        query: '存在しない商品',
        filters: {},
        pagination: {
          page: 1,
          limit: 20,
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/products/search',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchRequest),
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      expect(result.results).toHaveLength(0);
      expect(result.pagination.totalResults).toBe(0);
      expect(result.searchMeta.resultsCount).toBe(0);
    });

    test('should validate search query is required', async () => {
      const searchRequest = {
        filters: {},
        pagination: {
          page: 1,
          limit: 20,
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/products/search',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchRequest),
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Validation error');
      expect(error).toHaveProperty('message');
    });

    test('should handle platform API errors gracefully', async () => {
      platforms.amazon.searchByKeyword.mockRejectedValue(new Error('Amazon API error'));
      platforms.rakuten.searchByKeyword.mockResolvedValue([
        {
          id: 'test-rakuten-product',
          name: 'テスト商品',
          price: 2850,
          currency: 'JPY',
          url: 'https://books.rakuten.co.jp/rb/test-rakuten-product/',
          imageUrl: 'https://thumbnail.image.rakuten.co.jp/test.jpg',
          platform: 'rakuten',
          availability: 'in_stock',
          rating: 4.2,
          reviewCount: 89,
        }
      ]);

      const searchRequest = {
        query: 'テスト商品',
        filters: {},
        pagination: {
          page: 1,
          limit: 20,
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/products/search',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchRequest),
      });

      expect(response.statusCode).toBe(200); // Still succeeds because Rakuten works
      const result = JSON.parse(response.body);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].platform).toBe('rakuten');
      expect(result.searchMeta.platformsSearched).toEqual(['amazon', 'rakuten']);
    });

    test('should handle pagination correctly', async () => {
      platforms.amazon.searchByKeyword.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({
        id: `test-amazon-product-${i}`,
        name: `テスト商品 ${i}`,
        price: 1000 + (i * 100),
        currency: 'JPY',
        url: `https://amazon.co.jp/dp/test-amazon-product-${i}`,
        imageUrl: `https://images.amazon.com/images/test-${i}.jpg`,
        platform: 'amazon',
        availability: 'in_stock',
        rating: 4.0 + (i % 2),
        reviewCount: 50 + i,
      })));

      const searchRequest = {
        query: 'テスト商品',
        filters: {},
        pagination: {
          page: 2,
          limit: 10,
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/products/search',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchRequest),
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      expect(result.pagination.currentPage).toBe(2);
      expect(result.pagination.hasPrev).toBe(true);
      expect(result.results).toHaveLength(10);
    });

    test('should validate pagination limits', async () => {
      const searchRequest = {
        query: 'テスト商品',
        filters: {},
        pagination: {
          page: 1,
          limit: 100, // Exceeds maximum
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/products/search',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchRequest),
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error.message).toContain('limit');
    });
  });

  describe('GET /api/products/{id}', () => {
    test('should get product details by ID successfully', async () => {
      const productId = 'test-product-uuid';

      // Mock the product repository response
      const mockProduct = {
        id: productId,
        name: '詳細テスト商品',
        description: 'これは詳細な商品説明です',
        brand: 'テストブランド',
        category: {
          id: 'electronics',
          name: { ja: '電子機器', en: 'Electronics' },
          level: 2,
        },
        images: [
          {
            url: 'https://example.com/image1.jpg',
            alt: { ja: 'メイン画像', en: 'Main image' },
            width: 800,
            height: 600,
            order: 0,
          }
        ],
        specifications: [
          { name: 'サイズ', value: 'L', unit: null },
          { name: '重量', value: '500', unit: 'g' },
        ],
        identifiers: {
          jan: '4901085083126',
          asin: 'B001TEST123',
        },
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock repository method
      server.productRepository.findById = jest.fn().mockResolvedValue(mockProduct);

      const response = await server.inject({
        method: 'GET',
        url: `/api/products/${productId}`,
      });

      expect(response.statusCode).toBe(200);
      const product = JSON.parse(response.body);

      expect(() => ProductSchema.parse(product)).not.toThrow();
      expect(product.id).toBe(productId);
      expect(product.name).toBe('詳細テスト商品');
      expect(product.identifiers.jan).toBe('4901085083126');
    });

    test('should return 404 for non-existent product', async () => {
      const nonExistentId = 'non-existent-uuid';

      server.productRepository.findById = jest.fn().mockResolvedValue(null);

      const response = await server.inject({
        method: 'GET',
        url: `/api/products/${nonExistentId}`,
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Not found');
    });

    test('should validate product ID format', async () => {
      const invalidId = 'invalid-uuid-format';

      const response = await server.inject({
        method: 'GET',
        url: `/api/products/${invalidId}`,
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Validation error');
    });
  });
});