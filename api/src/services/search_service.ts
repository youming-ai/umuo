/**
 * Search service for product search across multiple platforms
 * Handles search queries, filtering, and ranking
 */

import { z } from 'zod';
import { ProductSchema, type Product } from '../models/product';
import { priceEntrySchema, type PriceEntry } from '../models/price_history';

// Search query schema
export const searchQuerySchema = z.object({
  query: z.string().min(1).max(500),
  filters: z.object({
    category: z.string().optional(),
    brand: z.string().optional(),
    minPrice: z.number().positive().optional(),
    maxPrice: z.number().positive().optional(),
    platforms: z.array(z.enum(['amazon', 'rakuten', 'yahoo', 'kakaku', 'mercari'])).optional(),
    condition: z.enum(['new', 'used', 'refurbished']).optional(),
    availability: z.enum(['in_stock', 'out_of_stock', 'limited_stock']).optional()
  }).optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating', 'newest']).default('relevance'),
  page: z.number().positive().default(1),
  limit: z.number().positive().max(100).default(20),
  includeUnavailable: z.boolean().default(false)
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

// Search result schema
export const searchResultSchema = z.object({
  products: z.array(ProductSchema),
  total: z.number().nonnegative(),
  page: z.number().positive(),
  limit: z.number().positive(),
  hasMore: z.boolean(),
  facets: z.object({
    categories: z.array(z.object({
      name: z.string(),
      count: z.number()
    })),
    brands: z.array(z.object({
      name: z.string(),
      count: z.number()
    })),
    priceRanges: z.array(z.object({
      range: z.string(),
      count: z.number()
    })),
    platforms: z.array(z.object({
      name: z.string(),
      count: z.number()
    }))
  }).optional(),
  searchTime: z.number().nonnegative(), // in milliseconds
  suggestions: z.array(z.string()).optional()
});

export type SearchResult = z.infer<typeof searchResultSchema>;

// Platform-specific search parameters
export interface PlatformSearchParams {
  platform: 'amazon' | 'rakuten' | 'yahoo' | 'kakaku' | 'mercari';
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
  sort?: string;
}

// Platform search result
export interface PlatformSearchResult {
  platform: string;
  products: Product[];
  total: number;
  hasMore: boolean;
  searchTime: number;
  error?: string;
}

// Search suggestion
export const searchSuggestionSchema = z.object({
  text: z.string().min(1).max(200),
  type: z.enum(['query', 'category', 'brand', 'product']),
  popularity: z.number().nonnegative(),
  metadata: z.record(z.unknown()).optional()
});

export type SearchSuggestion = z.infer<typeof searchSuggestionSchema>;

export class SearchService {
  private static readonly MAX_CONCURRENT_SEARCHES = 5;
  private static readonly SEARCH_TIMEOUT = 30000; // 30 seconds

  /**
   * Search products across multiple platforms
   */
  static async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();

    try {
      // Validate search query
      const validatedQuery = searchQuerySchema.parse(query);

      // Determine which platforms to search
      const platforms = validatedQuery.filters?.platforms || ['amazon', 'rakuten', 'yahoo', 'kakaku', 'mercari'];

      // Create platform-specific search parameters
      const platformSearches = platforms.map(platform =>
        this.createPlatformSearch(platform, validatedQuery)
      );

      // Execute searches concurrently with limit
      const results = await this.executeConcurrentSearches(platformSearches);

      // Combine and rank results
      const combinedResults = this.combineResults(results, validatedQuery);

      // Calculate facets
      const facets = this.calculateFacets(combinedResults.products);

      const searchTime = Date.now() - startTime;

      return {
        ...combinedResults,
        facets,
        searchTime,
        suggestions: await this.getSuggestions(validatedQuery.query)
      };
    } catch (error) {
      console.error('Search failed:', error);
      throw new Error('Search operation failed');
    }
  }

  /**
   * Create platform-specific search parameters
   */
  private static createPlatformSearch(platform: string, query: SearchQuery): PlatformSearchParams {
    return {
      platform: platform as any,
      query: query.query,
      category: query.filters?.category,
      minPrice: query.filters?.minPrice,
      maxPrice: query.filters?.maxPrice,
      page: query.page,
      limit: query.limit,
      sort: this.mapSortOrder(query.sort, platform)
    };
  }

  /**
   * Map generic sort order to platform-specific sort
   */
  private static mapSortOrder(sort: string, platform: string): string {
    const sortMapping: Record<string, Record<string, string>> = {
      amazon: {
        relevance: 'relevancerank',
        price_asc: 'price',
        price_desc: '-price',
        rating: 'review_rank',
        newest: 'date'
      },
      rakuten: {
        relevance: 'standard',
        price_asc: '1', // Price ascending
        price_desc: '2', // Price descending
        rating: 'review_count',
        newest: 'release_date'
      },
      yahoo: {
        relevance: 'relevance',
        price_asc: 'price',
        price_desc: '-price',
        rating: 'rating',
        newest: 'created_time'
      },
      kakaku: {
        relevance: 'score',
        price_asc: 'price_asc',
        price_desc: 'price_desc',
        rating: 'review_count',
        newest: 'create_date'
      },
      mercari: {
        relevance: 'relevance',
        price_asc: 'price_asc',
        price_desc: 'price_desc',
        rating: 'score',
        newest: 'created_desc'
      }
    };

    return sortMapping[platform]?.[sort] || sortMapping[platform]?.relevance || 'relevance';
  }

  /**
   * Execute platform searches with concurrency control
   */
  private static async executeConcurrentSearches(searches: PlatformSearchParams[]): Promise<PlatformSearchResult[]> {
    const chunks = this.chunkArray(searches, this.MAX_CONCURRENT_SEARCHES);
    const allResults: PlatformSearchResult[] = [];

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(search => this.searchPlatform(search));
      const chunkResults = await Promise.allSettled(chunkPromises);

      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          allResults.push(result.value);
        } else {
          console.error('Platform search failed:', result.reason);
          // Add empty result for failed platform
          allResults.push({
            platform: '',
            products: [],
            total: 0,
            hasMore: false,
            searchTime: 0,
            error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
          });
        }
      }
    }

    return allResults;
  }

  /**
   * Search a single platform
   */
  private static async searchPlatform(params: PlatformSearchParams): Promise<PlatformSearchResult> {
    const startTime = Date.now();

    try {
      // This would integrate with actual platform APIs
      // For now, we'll simulate the search
      await this.simulatePlatformDelay(params.platform);

      const mockProducts = this.generateMockProducts(params);
      const searchTime = Date.now() - startTime;

      return {
        platform: params.platform,
        products: mockProducts,
        total: mockProducts.length,
        hasMore: false,
        searchTime
      };
    } catch (error) {
      const searchTime = Date.now() - startTime;
      return {
        platform: params.platform,
        products: [],
        total: 0,
        hasMore: false,
        searchTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Combine results from multiple platforms
   */
  private static combineResults(
    platformResults: PlatformSearchResult[],
    query: SearchQuery
  ): Omit<SearchResult, 'facets' | 'searchTime' | 'suggestions'> {
    // Flatten all products
    const allProducts = platformResults.flatMap(result => result.products);

    // Apply additional filtering
    let filteredProducts = this.applyFilters(allProducts, query.filters);

    // Sort results
    filteredProducts = this.sortResults(filteredProducts, query.sort);

    // Apply pagination
    const startIndex = (query.page - 1) * query.limit;
    const endIndex = startIndex + query.limit;
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

    return {
      products: paginatedProducts,
      total: filteredProducts.length,
      page: query.page,
      limit: query.limit,
      hasMore: endIndex < filteredProducts.length
    };
  }

  /**
   * Apply filters to products
   */
  private static applyFilters(products: Product[], filters?: SearchQuery['filters']): Product[] {
    if (!filters) return products;

    return products.filter(product => {
      // Category filter
      if (filters.category && !product.category.name['ja'].includes(filters.category)) {
        return false;
      }

      // Brand filter
      if (filters.brand && product.brand !== filters.brand) {
        return false;
      }

      // Price filter (would need to check actual current prices)
      if (filters.minPrice || filters.maxPrice) {
        // This would involve checking current prices from price history
        // For now, skip price filtering
      }

      // Availability filter
      if (filters.availability && !this.checkAvailability(product, filters.availability)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Check product availability
   */
  private static checkAvailability(product: Product, availability: string): boolean {
    // This would check actual stock status
    // For now, assume active products are in stock
    return product.status === 'active';
  }

  /**
   * Sort search results
   */
  private static sortResults(products: Product[], sort: string): Product[] {
    const sorted = [...products];

    switch (sort) {
      case 'price_asc':
        // Would sort by current lowest price
        return sorted.sort((a, b) => 0); // Placeholder
      case 'price_desc':
        // Would sort by current highest price
        return sorted.sort((a, b) => 0); // Placeholder
      case 'rating':
        // Would sort by average rating
        return sorted.sort((a, b) => 0); // Placeholder
      case 'newest':
        return sorted.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      case 'relevance':
      default:
        // Would use relevance scoring algorithm
        return sorted;
    }
  }

  /**
   * Calculate search facets
   */
  private static calculateFacets(products: Product[]) {
    const categories = new Map<string, number>();
    const brands = new Map<string, number>();
    const priceRanges = new Map<string, number>();

    products.forEach(product => {
      // Count categories
      const categoryName = product.category.name['ja'];
      categories.set(categoryName, (categories.get(categoryName) || 0) + 1);

      // Count brands
      if (product.brand) {
        brands.set(product.brand, (brands.get(product.brand) || 0) + 1);
      }

      // Count price ranges (would use actual prices)
      const priceRange = '¥0-¥5000'; // Placeholder
      priceRanges.set(priceRange, (priceRanges.get(priceRange) || 0) + 1);
    });

    return {
      categories: Array.from(categories.entries()).map(([name, count]) => ({ name, count })),
      brands: Array.from(brands.entries()).map(([name, count]) => ({ name, count })),
      priceRanges: Array.from(priceRanges.entries()).map(([range, count]) => ({ range, count })),
      platforms: [] // Would be populated from actual platform results
    };
  }

  /**
   * Get search suggestions
   */
  static async getSuggestions(query: string): Promise<string[]> {
    // This would integrate with a suggestion service or database
    // For now, return mock suggestions
    const mockSuggestions = [
      `${query} の価格比較`,
      `${query} 最安値`,
      `${query} 口コミ`,
      `${query} ランキング`,
      `人気 ${query}`
    ];

    return mockSuggestions.slice(0, 5);
  }

  /**
   * Get popular searches
   */
  static async getPopularSearches(limit: number = 10): Promise<string[]> {
    // This would fetch from analytics database
    const mockPopular = [
      'iPhone 15',
      'PS5',
      'Switch',
      'AirPods',
      'iPad',
      'MacBook',
      'Nintendo Switch',
      'Nintendo Switch Lite',
      'PlayStation 5',
      'Xbox Series X'
    ];

    return mockPopular.slice(0, limit);
  }

  /**
   * Save search query for analytics
   */
  static async saveSearchQuery(userId: string, query: string, resultsCount: number): Promise<void> {
    // This would save to analytics database
    console.log(`Saving search query: ${query} for user ${userId}, results: ${resultsCount}`);
  }

  /**
   * Get search history for user
   */
  static async getSearchHistory(userId: string, limit: number = 20): Promise<string[]> {
    // This would fetch from user's search history
    return [];
  }

  // Utility methods
  private static chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private static async simulatePlatformDelay(platform: string): Promise<void> {
    // Simulate different response times for different platforms
    const delays: Record<string, number> = {
      amazon: 800,
      rakuten: 1200,
      yahoo: 1000,
      kakaku: 600,
      mercari: 1500
    };

    const delay = delays[platform] || 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private static generateMockProducts(params: PlatformSearchParams): Product[] {
    // This would generate actual mock products based on the search
    // For now, return empty array
    return [];
  }
}