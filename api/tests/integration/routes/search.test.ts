/**
 * Search API route integration tests
 * Tests for /api/v1/search endpoints
 */

import request from 'supertest';
import { Hono } from 'hono';
import { routes } from '../../../src/routes';
import { searchQuerySchema } from '../../../src/services/search_service';

// Mock the search service
jest.mock('../../../src/services/search_service');
import { SearchService } from '../../../src/services/search_service';

const app = new Hono();
app.route('/api/v1', routes);

describe('Search API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/search', () => {
    const mockSearchResult = {
      products: [
        {
          id: 'prod_123',
          name: 'iPhone 15 Pro',
          description: 'Latest iPhone model',
          brand: 'Apple',
          category: {
            id: 'cat_123',
            name: { ja: 'スマートフォン', en: 'Smartphones' },
            level: 1
          },
          images: [],
          specifications: [],
          identifiers: {},
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      total: 1,
      page: 1,
      limit: 20,
      hasMore: false,
      facets: {
        categories: [{ name: 'スマートフォン', count: 1 }],
        brands: [{ name: 'Apple', count: 1 }],
        priceRanges: [{ range: '¥100,000-¥150,000', count: 1 }],
        platforms: [{ name: 'Amazon', count: 1 }]
      },
      searchTime: 150,
      suggestions: ['iPhone 15 Pro Max', 'iPhone 15 case']
    };

    it('should return search results for valid query', async () => {
      (SearchService.search as jest.Mock).mockResolvedValue(mockSearchResult);

      const response = await request(app)
        .get('/api/v1/search')
        .query({
          q: 'iPhone 15',
          page: 1,
          limit: 20,
          sort: 'relevance'
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockSearchResult);
      expect(SearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'iPhone 15',
          page: 1,
          limit: 20,
          sort: 'relevance'
        })
      );
    });

    it('should handle query with filters', async () => {
      const filteredResult = { ...mockSearchResult, total: 5 };
      (SearchService.search as jest.Mock).mockResolvedValue(filteredResult);

      const response = await request(app)
        .get('/api/v1/search')
        .query({
          q: 'iPhone',
          category: 'smartphones',
          brand: 'Apple',
          minPrice: 100000,
          maxPrice: 200000,
          platforms: 'amazon,rakuten',
          condition: 'new',
          sort: 'price_asc'
        });

      expect(response.status).toBe(200);
      expect(SearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'iPhone',
          filters: {
            category: 'smartphones',
            brand: 'Apple',
            minPrice: 100000,
            maxPrice: 200000,
            platforms: ['amazon', 'rakuten'],
            condition: 'new'
          },
          sort: 'price_asc'
        })
      );
    });

    it('should handle pagination correctly', async () => {
      (SearchService.search as jest.Mock).mockResolvedValue(mockSearchResult);

      const response = await request(app)
        .get('/api/v1/search')
        .query({
          q: 'iPhone',
          page: 2,
          limit: 10
        });

      expect(response.status).toBe(200);
      expect(SearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'iPhone',
          page: 2,
          limit: 10
        })
      );
    });

    it('should return 400 for missing query parameter', async () => {
      const response = await request(app)
        .get('/api/v1/search');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('query');
    });

    it('should return 400 for empty query', async () => {
      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: '' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for invalid page number', async () => {
      const response = await request(app)
        .get('/api/v1/search')
        .query({
          q: 'iPhone',
          page: -1
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('page');
    });

    it('should return 400 for invalid limit', async () => {
      const response = await request(app)
        .get('/api/v1/search')
        .query({
          q: 'iPhone',
          limit: 101
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('limit');
    });

    it('should return 400 for invalid sort parameter', async () => {
      const response = await request(app)
        .get('/api/v1/search')
        .query({
          q: 'iPhone',
          sort: 'invalid_sort'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('sort');
    });

    it('should handle search service errors', async () => {
      (SearchService.search as jest.Mock).mockRejectedValue(new Error('Service unavailable'));

      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: 'iPhone' });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Search operation failed');
    });

    it('should validate query parameter length', async () => {
      const longQuery = 'a'.repeat(501);
      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: longQuery });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('query');
    });
  });

  describe('GET /api/v1/search/suggestions', () => {
    const mockSuggestions = ['iPhone 15 Pro', 'iPhone 15 case', 'iPhone 15 Max'];

    it('should return search suggestions', async () => {
      (SearchService.getSuggestions as jest.Mock).mockResolvedValue(mockSuggestions);

      const response = await request(app)
        .get('/api/v1/search/suggestions')
        .query({ q: 'iPhone 15' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        suggestions: mockSuggestions
      });
      expect(SearchService.getSuggestions).toHaveBeenCalledWith('iPhone 15');
    });

    it('should handle empty query', async () => {
      (SearchService.getSuggestions as jest.Mock).mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/search/suggestions')
        .query({ q: '' });

      expect(response.status).toBe(200);
      expect(response.body.suggestions).toEqual([]);
    });

    it('should return 400 for missing query parameter', async () => {
      const response = await request(app)
        .get('/api/v1/search/suggestions');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/v1/search/popular', () => {
    const mockPopular = ['iPhone 15', 'PS5', 'Nintendo Switch', 'iPad Pro'];

    it('should return popular searches with default limit', async () => {
      (SearchService.getPopularSearches as jest.Mock).mockResolvedValue(mockPopular);

      const response = await request(app)
        .get('/api/v1/search/popular');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        popularSearches: mockPopular
      });
      expect(SearchService.getPopularSearches).toHaveBeenCalledWith(10);
    });

    it('should return popular searches with custom limit', async () => {
      const limitedPopular = mockPopular.slice(0, 5);
      (SearchService.getPopularSearches as jest.Mock).mockResolvedValue(limitedPopular);

      const response = await request(app)
        .get('/api/v1/search/popular')
        .query({ limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.popularSearches).toEqual(limitedPopular);
      expect(SearchService.getPopularSearches).toHaveBeenCalledWith(5);
    });

    it('should return 400 for invalid limit parameter', async () => {
      const response = await request(app)
        .get('/api/v1/search/popular')
        .query({ limit: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('limit');
    });

    it('should return 400 for limit over maximum', async () => {
      const response = await request(app)
        .get('/api/v1/search/popular')
        .query({ limit: 51 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('limit');
    });
  });

  describe('POST /api/v1/search/save', () => {
    it('should save search query for authenticated user', async () => {
      (SearchService.saveSearchQuery as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/v1/search/save')
        .set('Authorization', 'Bearer valid-token')
        .send({
          query: 'iPhone 15',
          resultsCount: 25
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Search query saved'
      });
      expect(SearchService.saveSearchQuery).toHaveBeenCalledWith(
        expect.any(String), // userId from token
        'iPhone 15',
        25
      );
    });

    it('should return 401 for unauthorized request', async () => {
      const response = await request(app)
        .post('/api/v1/search/save')
        .send({
          query: 'iPhone 15',
          resultsCount: 25
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for missing query in request body', async () => {
      const response = await request(app)
        .post('/api/v1/search/save')
        .set('Authorization', 'Bearer valid-token')
        .send({
          resultsCount: 25
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('query');
    });

    it('should return 400 for invalid resultsCount', async () => {
      const response = await request(app)
        .post('/api/v1/search/save')
        .set('Authorization', 'Bearer valid-token')
        .send({
          query: 'iPhone 15',
          resultsCount: -1
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('resultsCount');
    });

    it('should handle save errors gracefully', async () => {
      (SearchService.saveSearchQuery as jest.Mock).mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/search/save')
        .set('Authorization', 'Bearer valid-token')
        .send({
          query: 'iPhone 15',
          resultsCount: 25
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/v1/search/history', () => {
    const mockHistory = ['iPhone 15', 'PS5', 'iPad Pro', 'MacBook Air'];

    it('should return search history for authenticated user', async () => {
      (SearchService.getSearchHistory as jest.Mock).mockResolvedValue(mockHistory);

      const response = await request(app)
        .get('/api/v1/search/history')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        history: mockHistory
      });
      expect(SearchService.getSearchHistory).toHaveBeenCalledWith(
        expect.any(String),
        20 // default limit
      );
    });

    it('should return search history with custom limit', async () => {
      const limitedHistory = mockHistory.slice(0, 5);
      (SearchService.getSearchHistory as jest.Mock).mockResolvedValue(limitedHistory);

      const response = await request(app)
        .get('/api/v1/search/history')
        .set('Authorization', 'Bearer valid-token')
        .query({ limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.history).toEqual(limitedHistory);
      expect(SearchService.getSearchHistory).toHaveBeenCalledWith(
        expect.any(String),
        5
      );
    });

    it('should return 401 for unauthorized request', async () => {
      const response = await request(app)
        .get('/api/v1/search/history');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for invalid limit parameter', async () => {
      const response = await request(app)
        .get('/api/v1/search/history')
        .set('Authorization', 'Bearer valid-token')
        .query({ limit: -1 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('limit');
    });
  });

  describe('Search Performance and Rate Limiting', () => {
    it('should include search timing in response', async () => {
      const mockResultWithTiming = {
        ...mockSearchResult,
        searchTime: 150
      };
      (SearchService.search as jest.Mock).mockResolvedValue(mockResultWithTiming);

      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: 'iPhone 15' });

      expect(response.status).toBe(200);
      expect(response.body.searchTime).toBe(150);
      expect(typeof response.body.searchTime).toBe('number');
    });

    it('should handle concurrent search requests', async () => {
      (SearchService.search as jest.Mock).mockResolvedValue(mockSearchResult);

      const promises = Array(5).fill(null).map((_, i) =>
        request(app)
          .get('/api/v1/search')
          .query({ q: `iPhone ${i}` })
      );

      const responses = await Promise.all(promises);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockSearchResult);
      });

      expect(SearchService.search).toHaveBeenCalledTimes(5);
    });

    it('should handle special characters in search query', async () => {
      (SearchService.search as jest.Mock).mockResolvedValue(mockSearchResult);

      const specialQueries = [
        'iPhone 15 Pro Max',
        'ノートPC',
        'PlayStation®5',
        'MacBook Air (M2)'
      ];

      for (const query of specialQueries) {
        const response = await request(app)
          .get('/api/v1/search')
          .query({ q: query });

        expect(response.status).toBe(200);
        expect(SearchService.search).toHaveBeenCalledWith(
          expect.objectContaining({ query })
        );
      }
    });
  });
});