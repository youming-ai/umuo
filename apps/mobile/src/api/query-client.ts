/**
 * React Query Configuration
 * Provides centralized query client setup for the Yabaii mobile app
 */

import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { Platform } from 'react-native';

// Import API client and error handling
import { apiClient } from './client';
import { logger } from '../utils/logger';

/**
 * Default query configuration
 */
export const queryConfig = {
  // Default query options
  defaultOptions: {
    queries: {
      // Time in milliseconds
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error && typeof error === 'object' && 'status' in error) {
          const status = error.status as number;
          if (status >= 400 && status < 500) {
            return false;
          }
        }
        // Retry up to 3 times for other errors
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: Platform.OS === 'web', // Only refocus on web
      refetchOnReconnect: true,
      refetchOnMount: true,
      networkMode: 'online' as const,
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
      networkMode: 'online' as const,
    },
  },
};

/**
 * Create query client with custom error and success handlers
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    ...queryConfig,
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Log query errors
        logger.error('Query error:', {
          queryKey: query.queryKey,
          error: error.message,
          status: error.status,
        });

        // Handle specific error types
        if (error.status === 401) {
          // Unauthorized - redirect to login
          logger.warn('User unauthorized, should redirect to login');
        }
      },
      onSuccess: (data, query) => {
        // Log successful queries (debug level)
        logger.debug('Query success:', {
          queryKey: query.queryKey,
          dataSize: JSON.stringify(data).length,
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, variables, context, mutation) => {
        // Log mutation errors
        logger.error('Mutation error:', {
          mutationKey: mutation.options.mutationKey,
          error: error.message,
          status: error.status,
          variables,
        });
      },
      onSuccess: (data, variables, context, mutation) => {
        // Log successful mutations
        logger.info('Mutation success:', {
          mutationKey: mutation.options.mutationKey,
          dataSize: JSON.stringify(data).length,
        });
      },
    }),
  });
}

/**
 * Default query client instance
 */
export const queryClient = createQueryClient();

/**
 * Query keys factory for consistent key generation
 */
export const queryKeys = {
  // User related
  user: ['user'] as const,
  userProfile: (userId: string) => ['user', 'profile', userId] as const,
  userPreferences: (userId: string) => ['user', 'preferences', userId] as const,
  userAlerts: (userId: string) => ['user', 'alerts', userId] as const,

  // Products
  products: ['products'] as const,
  product: (id: string) => ['products', id] as const,
  productDetails: (id: string) => ['products', id, 'details'] as const,
  productOffers: (id: string) => ['products', id, 'offers'] as const,
  productReviews: (id: string) => ['products', id, 'reviews'] as const,
  productPriceHistory: (id: string, days?: number) => ['products', id, 'priceHistory', days] as const,

  // Search
  search: (query: string, filters?: any) => ['search', query, filters] as const,
  searchSuggestions: (query: string) => ['search', 'suggestions', query] as const,
  searchHistory: (userId: string) => ['search', 'history', userId] as const,

  // Prices
  prices: ['prices'] as const,
  priceComparison: (productId: string) => ['prices', 'comparison', productId] as const,
  priceAlerts: (productId: string) => ['prices', 'alerts', productId] as const,
  priceStatistics: (productId: string) => ['prices', 'stats', productId] as const,

  // Deals
  deals: ['deals'] as const,
  dealsByCategory: (category: string) => ['deals', 'category', category] as const,
  dealsByPlatform: (platform: string) => ['deals', 'platform', platform] as const,

  // Recommendations
  recommendations: (userId: string, type?: string) => ['recommendations', userId, type] as const,
  similarProducts: (productId: string) => ['recommendations', 'similar', productId] as const,
  trendingProducts: (category?: string) => ['recommendations', 'trending', category] as const,

  // Notifications
  notifications: (userId: string) => ['notifications', userId] as const,
  unreadNotifications: (userId: string) => ['notifications', userId, 'unread'] as const,

  // Watchlist
  watchlist: (userId: string) => ['watchlist', userId] as const,
  watchlistItem: (userId: string, productId: string) => ['watchlist', userId, productId] as const,

  // Settings
  settings: ['settings'] as const,
  appSettings: ['settings', 'app'] as const,
  userSettings: (userId: string) => ['settings', 'user', userId] as const,
};

/**
 * Query invalidation utilities
 */
export const queryInvalidation = {
  // Invalidate all user-related queries
  invalidateUser: (userId: string) => {
    queryClient.invalidateQueries({ queryKey: ['user'] });
    queryClient.invalidateQueries({ queryKey: ['user', 'profile', userId] });
    queryClient.invalidateQueries({ queryKey: ['user', 'preferences', userId] });
    queryClient.invalidateQueries({ queryKey: ['user', 'alerts', userId] });
  },

  // Invalidate product data
  invalidateProduct: (productId: string) => {
    queryClient.invalidateQueries({ queryKey: ['products', productId] });
    queryClient.invalidateQueries({ queryKey: ['products', productId, 'details'] });
    queryClient.invalidateQueries({ queryKey: ['products', productId, 'offers'] });
    queryClient.invalidateQueries({ queryKey: ['products', productId, 'reviews'] });
    queryClient.invalidateQueries({ queryKey: ['prices', 'comparison', productId] });
    queryClient.invalidateQueries({ queryKey: ['recommendations', 'similar', productId] });
  },

  // Invalidate search results
  invalidateSearch: () => {
    queryClient.invalidateQueries({ queryKey: ['search'] });
  },

  // Invalidate deals
  invalidateDeals: () => {
    queryClient.invalidateQueries({ queryKey: ['deals'] });
  },

  // Invalidate notifications
  invalidateNotifications: (userId: string) => {
    queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    queryClient.invalidateQueries({ queryKey: ['notifications', userId, 'unread'] });
  },

  // Invalidate watchlist
  invalidateWatchlist: (userId: string) => {
    queryClient.invalidateQueries({ queryKey: ['watchlist', userId] });
  },
};

/**
 * Prefetching utilities for better UX
 */
export const prefetchQueries = {
  // Prefetch product details when viewing a list
  prefetchProductDetails: async (productId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.productDetails(productId),
      queryFn: () => apiClient.get(`/api/v1/products/${productId}`),
      staleTime: 5 * 60 * 1000, // 5 minutes
    });
  },

  // Prefetch similar products
  prefetchSimilarProducts: async (productId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.similarProducts(productId),
      queryFn: () => apiClient.get(`/api/v1/recommendations/similar/${productId}`),
      staleTime: 10 * 60 * 1000, // 10 minutes
    });
  },

  // Prefetch user data on app start
  prefetchUserData: async (userId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.userProfile(userId),
      queryFn: () => apiClient.get(`/api/v1/users/${userId}/profile`),
      staleTime: 2 * 60 * 1000, // 2 minutes
    });

    queryClient.prefetchQuery({
      queryKey: queryKeys.userAlerts(userId),
      queryFn: () => apiClient.get(`/api/v1/alerts/user/${userId}`),
      staleTime: 1 * 60 * 1000, // 1 minute
    });
  },
};

/**
 * Query configuration for different data types
 */
export const queryConfigs = {
  // User data - relatively fresh
  user: {
    staleTime: 2 * 60 * 1000, // 2 minutes
    cacheTime: 5 * 60 * 1000, // 5 minutes
  },

  // Product data - cache longer
  products: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 15 * 60 * 1000, // 15 minutes
  },

  // Price data - very fresh
  prices: {
    staleTime: 1 * 60 * 1000, // 1 minute
    cacheTime: 5 * 60 * 1000, // 5 minutes
  },

  // Deals - moderate freshness
  deals: {
    staleTime: 3 * 60 * 1000, // 3 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
  },

  // Search results - short cache
  search: {
    staleTime: 30 * 1000, // 30 seconds
    cacheTime: 2 * 60 * 1000, // 2 minutes
  },

  // Recommendations - can be cached longer
  recommendations: {
    staleTime: 10 * 60 * 1000, // 10 minutes
    cacheTime: 30 * 60 * 1000, // 30 minutes
  },
};

export default queryClient;