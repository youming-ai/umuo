/**
 * Search routes
 * Handles product search, suggestions, and search history
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { SearchService } from '../services/search_service';
import { optionalAuthMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import { createReactQueryResponse, createPaginatedResponse } from '@/utils/react-query';
import { cacheControl, reactQueryHeaders } from '@/utils/react-query';

const search = new Hono();

// Validation schemas
const searchQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required').max(500, 'Search query too long'),
  category: z.string().optional(),
  brand: z.string().optional(),
  minPrice: z.number().positive('Minimum price must be positive').optional(),
  maxPrice: z.number().positive('Maximum price must be positive').optional(),
  platforms: z.string().optional().transform(val => {
    if (!val) return undefined;
    return val.split(',').map(p => p.trim().toLowerCase());
  }),
  condition: z.enum(['new', 'used', 'refurbished']).optional(),
  availability: z.enum(['in_stock', 'out_of_stock', 'limited_stock']).optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating', 'newest']).default('relevance'),
  page: z.string().transform(Number).pipe(z.number().positive().default(1)),
  limit: z.string().transform(Number).pipe(z.number().positive().max(100).default(20)),
  includeUnavailable: z.string().transform(val => val === 'true').default(false)
});

const suggestionsQuerySchema = z.object({
  q: z.string().min(1, 'Query is required').max(200, 'Query too long'),
  limit: z.string().transform(Number).pipe(z.number().positive().max(20).default(5))
});

const popularSearchesQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().positive().max(50).default(10))
});

const saveSearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(500, 'Query too long'),
  resultsCount: z.number().nonnegative('Results count must be non-negative')
});

const searchHistoryQuerySchema = z.object({
  limit: z.string().transform(Number).pipe(z.number().positive().max(100).default(20))
});

/**
 * GET /search
 * Search products across multiple platforms
 */
search.get('/', zValidator('query', searchQuerySchema), optionalAuthMiddleware, async (c) => {
  try {
    const queryParams = c.req.valid('query');
    const userId = c.get('userId');
    const requestId = c.get('requestId');

    // Convert to SearchService format
    const searchQuery = {
      query: queryParams.q,
      filters: {
        category: queryParams.category,
        brand: queryParams.brand,
        minPrice: queryParams.minPrice,
        maxPrice: queryParams.maxPrice,
        platforms: queryParams.platforms,
        condition: queryParams.condition,
        availability: queryParams.availability
      },
      sort: queryParams.sort,
      page: queryParams.page,
      limit: queryParams.limit,
      includeUnavailable: queryParams.includeUnavailable
    };

    const startTime = Date.now();
    const result = await SearchService.search(searchQuery);
    const searchTime = Date.now() - startTime;

    // Log search query for analytics
    if (userId) {
      SearchService.saveSearchQuery(userId, queryParams.q, result.total).catch(error => {
        logger.error('Failed to save search query', { error, userId, query: queryParams.q });
      });
    }

    logger.info('Search completed', {
      query: queryParams.q,
      resultsCount: result.total,
      searchTime,
      userId: userId || 'anonymous',
      requestId,
    });

    // Create React Query optimized response
    const response = createPaginatedResponse(
      result.items,
      queryParams.page,
      queryParams.limit,
      result.total,
      {
        message: `Found ${result.total} products`,
        cache: {
          ttl: 300, // 5 minutes cache for search results
          key: `search:${queryParams.q}:${JSON.stringify(searchQuery.filters)}`,
          stale: false,
        },
      }
    );

    // Add React Query specific headers
    const finalResponse = createReactQueryResponse(response.data, {
      pagination: response.pagination,
      cache: response.cache,
      message: response.message,
    });

    // Set cache control headers for search results
    const headers = cacheControl.shortTerm(300); // 5 minutes
    Object.entries(headers).forEach(([key, value]) => {
      c.header(key, value as string);
    });

    return c.json(finalResponse);

  } catch (error) {
    logger.error('Search failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      query: c.req.query('q'),
      requestId: c.get('requestId'),
    });

    return c.json({
      success: false,
      error: 'Search failed. Please try again.',
      requestId: c.get('requestId'),
    }, 500);
  }
});

/**
 * GET /search/suggestions
 * Get search suggestions based on query
 */
search.get('/suggestions', zValidator('query', suggestionsQuerySchema), async (c) => {
  try {
    const { q: query, limit } = c.req.valid('query');
    const requestId = c.get('requestId');

    const suggestions = await SearchService.getSuggestions(query);
    const limitedSuggestions = suggestions.slice(0, limit);

    // Create React Query optimized response
    const response = createReactQueryResponse(
      { suggestions: limitedSuggestions },
      {
        message: `Found ${limitedSuggestions.length} suggestions`,
        cache: {
          ttl: 600, // 10 minutes cache for suggestions
          key: `suggestions:${query}`,
          stale: false,
        },
      }
    );

    // Set cache control headers for suggestions
    const headers = cacheControl.mediumTerm(600); // 10 minutes
    Object.entries(headers).forEach(([key, value]) => {
      c.header(key, value as string);
    });

    return c.json(response);

  } catch (error) {
    logger.error('Get suggestions failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      query: c.req.query('q'),
      requestId: c.get('requestId'),
    });

    return c.json({
      success: false,
      error: 'Failed to get suggestions',
      requestId: c.get('requestId'),
    }, 500);
  }
});

/**
 * GET /search/popular
 * Get popular search terms
 */
search.get('/popular', zValidator('query', popularSearchesQuerySchema), async (c) => {
  try {
    const { limit } = c.req.valid('query');

    const popularSearches = await SearchService.getPopularSearches(limit);

    return c.json({
      success: true,
      data: {
        popularSearches
      }
    });
  } catch (error) {
    logger.error('Get popular searches failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return c.json({
      success: false,
      error: 'Failed to get popular searches'
    }, 500);
  }
});

/**
 * POST /search/save
 * Save search query for authenticated user
 */
search.post('/save', optionalAuthMiddleware, zValidator('json', saveSearchSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const { query, resultsCount } = c.req.valid('json');

    if (!userId) {
      return c.json({
        success: false,
        error: 'Authentication required to save search'
      }, 401);
    }

    await SearchService.saveSearchQuery(userId, query, resultsCount);

    logger.info('Search query saved', { userId, query, resultsCount });

    return c.json({
      success: true,
      message: 'Search query saved successfully'
    });
  } catch (error) {
    logger.error('Save search query failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: c.get('userId')
    });

    return c.json({
      success: false,
      error: 'Failed to save search query'
    }, 500);
  }
});

/**
 * GET /search/history
 * Get search history for authenticated user
 */
search.get('/history', optionalAuthMiddleware, zValidator('query', searchHistoryQuerySchema), async (c) => {
  try {
    const userId = c.get('userId');
    const { limit } = c.req.valid('query');

    if (!userId) {
      return c.json({
        success: false,
        error: 'Authentication required to view search history'
      }, 401);
    }

    const history = await SearchService.getSearchHistory(userId, limit);

    return c.json({
      success: true,
      data: {
        history
      }
    });
  } catch (error) {
    logger.error('Get search history failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: c.get('userId')
    });

    return c.json({
      success: false,
      error: 'Failed to get search history'
    }, 500);
  }
});

/**
 * GET /search/trending
 * Get trending searches in the last 24 hours
 */
search.get('/trending', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');

    // Mock implementation - would fetch from analytics database
    const trendingSearches = [
      'iPhone 15 Pro',
      'PS5 Slim',
      'Nintendo Switch OLED',
      'AirPods Pro 2',
      'iPad Pro 2024',
      'MacBook Air M3',
      'Samsung Galaxy S24',
      'Sony WH-1000XM5',
      'Nintendo Switch games',
      'iPhone 15 cases'
    ].slice(0, limit);

    return c.json({
      success: true,
      data: {
        trendingSearches,
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Get trending searches failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return c.json({
      success: false,
      error: 'Failed to get trending searches'
    }, 500);
  }
});

/**
 * GET /search/categories
 * Get available search categories with counts
 */
search.get('/categories', async (c) => {
  try {
    // Mock implementation - would fetch from database
    const categories = [
      { name: 'エレクトロニクス', count: 15420 },
      { name: '家電', count: 12350 },
      { name: '本・雑誌', count: 8930 },
      { name: 'ファッション', count: 7650 },
      { name: 'スポーツ・アウトドア', count: 5420 },
      { name: 'ホーム・キッチン', count: 4890 },
      { name: '美容・コスメ', count: 3670 },
      { name: 'おもちゃ・ホビー', count: 2890 },
      { name: '食品・飲料', count: 2340 },
      { name: 'ペット用品', count: 1560 }
    ];

    return c.json({
      success: true,
      data: {
        categories
      }
    });
  } catch (error) {
    logger.error('Get search categories failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return c.json({
      success: false,
      error: 'Failed to get categories'
    }, 500);
  }
});

/**
 * GET /search/brands
 * Get popular brands with counts
 */
search.get('/brands', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50');
    const category = c.req.query('category');

    // Mock implementation - would fetch from database with optional category filter
    const allBrands = [
      { name: 'Apple', count: 12450 },
      { name: 'Sony', count: 8920 },
      { name: 'Nintendo', count: 7650 },
      { name: 'Samsung', count: 6780 },
      { name: 'Panasonic', count: 5430 },
      { name: 'Sharp', count: 4560 },
      { name: 'Canon', count: 3890 },
      { name: 'Nike', count: 3450 },
      { name: 'Adidas', count: 3120 },
      { name: 'UNIQLO', count: 2890 }
    ];

    const brands = allBrands.slice(0, limit);

    return c.json({
      success: true,
      data: {
        brands
      }
    });
  } catch (error) {
    logger.error('Get search brands failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return c.json({
      success: false,
      error: 'Failed to get brands'
    }, 500);
  }
});

/**
 * GET /search/facets
 * Get search facets for filters
 */
search.get('/facets', async (c) => {
  try {
    const query = c.req.query('q');

    // Mock implementation - would generate facets based on actual search results
    const facets = {
      priceRanges: [
        { range: '¥0-¥5,000', count: 12450 },
        { range: '¥5,000-¥10,000', count: 8920 },
        { range: '¥10,000-¥20,000', count: 7650 },
        { range: '¥20,000-¥50,000', count: 5430 },
        { range: '¥50,000-¥100,000', count: 3210 },
        { range: '¥100,000+', count: 1890 }
      ],
      platforms: [
        { name: 'Amazon', count: 15420 },
        { name: 'Rakuten', count: 12350 },
        { name: 'Yahoo Shopping', count: 9870 },
        { name: 'Kakaku', count: 7650 },
        { name: 'Mercari', count: 5430 }
      ],
      conditions: [
        { name: 'new', count: 28930 },
        { name: 'used', count: 8960 },
        { name: 'refurbished', count: 2340 }
      ],
      availability: [
        { name: 'in_stock', count: 35670 },
        { name: 'limited_stock', count: 3450 },
        { name: 'out_of_stock', count: 2110 }
      ]
    };

    return c.json({
      success: true,
      data: {
        facets,
        query: query || null
      }
    });
  } catch (error) {
    logger.error('Get search facets failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return c.json({
      success: false,
      error: 'Failed to get search facets'
    }, 500);
  }
});

/**
 * DELETE /search/history
 * Clear search history for authenticated user
 */
search.delete('/history', optionalAuthMiddleware, async (c) => {
  try {
    const userId = c.get('userId');

    if (!userId) {
      return c.json({
        success: false,
        error: 'Authentication required to clear search history'
      }, 401);
    }

    // Mock implementation - would clear from database
    logger.info('Search history cleared', { userId });

    return c.json({
      success: true,
      message: 'Search history cleared successfully'
    });
  } catch (error) {
    logger.error('Clear search history failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: c.get('userId')
    });

    return c.json({
      success: false,
      error: 'Failed to clear search history'
    }, 500);
  }
});

export { search as searchRoutes };