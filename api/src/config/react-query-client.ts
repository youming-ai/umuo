/**
 * React Query Client Configuration
 * Configuration and utilities for React Query client in mobile app
 */

export interface ReactQueryConfig {
  baseURL: string;
  defaultOptions: {
    queries: {
      staleTime: number;
      cacheTime: number;
      refetchOnWindowFocus: boolean;
      refetchOnReconnect: boolean;
      retry: number;
      retryDelay: ((attemptIndex: number) => number) | undefined;
      networkMode: 'online' | 'always' | 'offlineFirst';
    };
    mutations: {
      retry: number;
      networkMode: 'online' | 'always' | 'offlineFirst';
    };
  };
  endpoints: {
    search: {
      cacheTime: number;
      staleTime: number;
      refetchInterval: number | false;
    };
    products: {
      cacheTime: number;
      staleTime: number;
      refetchInterval: number | false;
    };
    prices: {
      cacheTime: number;
      staleTime: number;
      refetchInterval: number | false;
    };
    alerts: {
      cacheTime: number;
      staleTime: number;
      refetchInterval: number | false;
    };
    deals: {
      cacheTime: number;
      staleTime: number;
      refetchInterval: number | false;
    };
  };
}

/**
 * Default React Query configuration
 */
export const defaultReactQueryConfig: ReactQueryConfig = {
  baseURL: 'https://api.yabaii.day/api/v1',
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      networkMode: 'online',
    },
    mutations: {
      retry: 1,
      networkMode: 'online',
    },
  },
  endpoints: {
    search: {
      cacheTime: 5 * 60 * 1000, // 5 minutes
      staleTime: 2 * 60 * 1000, // 2 minutes
      refetchInterval: false,
    },
    products: {
      cacheTime: 15 * 60 * 1000, // 15 minutes
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchInterval: 10 * 60 * 1000, // 10 minutes
    },
    prices: {
      cacheTime: 2 * 60 * 1000, // 2 minutes
      staleTime: 1 * 60 * 1000, // 1 minute
      refetchInterval: 30 * 1000, // 30 seconds
    },
    alerts: {
      cacheTime: 60 * 1000, // 1 minute
      staleTime: 30 * 1000, // 30 seconds
      refetchInterval: 15 * 1000, // 15 seconds
    },
    deals: {
      cacheTime: 5 * 60 * 1000, // 5 minutes
      staleTime: 2 * 60 * 1000, // 2 minutes
      refetchInterval: false,
    },
  },
};

/**
 * Development-specific configuration
 */
export const developmentReactQueryConfig: ReactQueryConfig = {
  ...defaultReactQueryConfig,
  baseURL: 'http://localhost:3000/api/v1',
  defaultOptions: {
    ...defaultReactQueryConfig.defaultOptions,
    queries: {
      ...defaultReactQueryConfig.defaultOptions.queries,
      staleTime: 60 * 1000, // 1 minute for development
      cacheTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
      retryDelay: 1000,
      networkMode: 'always',
    },
  },
  endpoints: {
    ...defaultReactQueryConfig.endpoints,
    search: {
      cacheTime: 60 * 1000, // 1 minute
      staleTime: 30 * 1000, // 30 seconds
      refetchInterval: false,
    },
    products: {
      cacheTime: 5 * 60 * 1000, // 5 minutes
      staleTime: 2 * 60 * 1000, // 2 minutes
      refetchInterval: 30 * 1000, // 30 seconds
    },
    prices: {
      cacheTime: 60 * 1000, // 1 minute
      staleTime: 30 * 1000, // 30 seconds
      refetchInterval: 10 * 1000, // 10 seconds
    },
    alerts: {
      cacheTime: 30 * 1000, // 30 seconds
      staleTime: 15 * 1000, // 15 seconds
      refetchInterval: 5 * 1000, // 5 seconds
    },
    deals: {
      cacheTime: 2 * 60 * 1000, // 2 minutes
      staleTime: 60 * 1000, // 1 minute
      refetchInterval: false,
    },
  },
};

/**
 * Production-specific configuration
 */
export const productionReactQueryConfig: ReactQueryConfig = {
  ...defaultReactQueryConfig,
  baseURL: 'https://api.yabaii.day/api/v1',
  defaultOptions: {
    ...defaultReactQueryConfig.defaultOptions,
    queries: {
      ...defaultReactQueryConfig.defaultOptions.queries,
      staleTime: 10 * 60 * 1000, // 10 minutes
      cacheTime: 30 * 60 * 1000, // 30 minutes
      refetchOnWindowFocus: false, // Don't refetch on window focus in production
      refetchOnReconnect: true,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      networkMode: 'online',
    },
  },
  endpoints: {
    ...defaultReactQueryConfig.endpoints,
    search: {
      cacheTime: 10 * 60 * 1000, // 10 minutes
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchInterval: false,
    },
    products: {
      cacheTime: 30 * 60 * 1000, // 30 minutes
      staleTime: 10 * 60 * 1000, // 10 minutes
      refetchInterval: 15 * 60 * 1000, // 15 minutes
    },
    prices: {
      cacheTime: 5 * 60 * 1000, // 5 minutes
      staleTime: 2 * 60 * 1000, // 2 minutes
      refetchInterval: 60 * 1000, // 1 minute
    },
    alerts: {
      cacheTime: 2 * 60 * 1000, // 2 minutes
      staleTime: 60 * 1000, // 1 minute
      refetchInterval: 30 * 1000, // 30 seconds
    },
    deals: {
      cacheTime: 10 * 60 * 1000, // 10 minutes
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchInterval: false,
    },
  },
};

/**
 * Get React Query configuration based on environment
 */
export function getReactQueryConfig(): ReactQueryConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';

  switch (nodeEnv) {
    case 'production':
      return productionReactQueryConfig;
    case 'development':
      return developmentReactQueryConfig;
    default:
      return defaultReactQueryConfig;
  }
}

/**
 * React Query endpoint configurations
 */
export const reactQueryEndpoints = {
  // Search endpoints
  search: {
    products: '/search',
    suggestions: '/search/suggestions',
    popular: '/search/popular',
    history: '/search/history',
  },

  // Product endpoints
  products: {
    list: '/products',
    details: '/products/:id',
    offers: '/products/:id/offers',
    similar: '/products/:id/similar',
    barcode: '/products/barcode/:code',
  },

  // Price endpoints
  prices: {
    history: '/prices/:productId/history',
    current: '/prices/:productId/current',
    compare: '/prices/:productId/compare',
    statistics: '/prices/:productId/statistics',
    historicalLow: '/prices/:productId/historical-low',
  },

  // Alert endpoints
  alerts: {
    list: '/alerts',
    create: '/alerts',
    update: '/alerts/:id',
    delete: '/alerts/:id',
    test: '/alerts/:id/test',
  },

  // Deal endpoints
  deals: {
    list: '/deals',
    create: '/deals',
    vote: '/deals/:id/vote',
    comment: '/deals/:id/comments',
  },

  // User endpoints
  user: {
    profile: '/auth/profile',
    preferences: '/auth/preferences',
    stats: '/auth/stats',
  },
};

/**
 * Query key factories for React Query
 */
export const queryKeys = {
  // Search queries
  search: {
    products: (query: string, filters?: any) => ['search', 'products', query, filters],
    suggestions: (query: string) => ['search', 'suggestions', query],
    popular: () => ['search', 'popular'],
    history: (userId: string) => ['search', 'history', userId],
  },

  // Product queries
  products: {
    list: (filters?: any) => ['products', 'list', filters],
    details: (id: string) => ['products', 'details', id],
    offers: (id: string) => ['products', 'offers', id],
    similar: (id: string) => ['products', 'similar', id],
    barcode: (code: string) => ['products', 'barcode', code],
  },

  // Price queries
  prices: {
    history: (productId: string, options?: any) => ['prices', 'history', productId, options],
    current: (productId: string) => ['prices', 'current', productId],
    compare: (productId: string, options?: any) => ['prices', 'compare', productId, options],
    statistics: (productId: string) => ['prices', 'statistics', productId],
    historicalLow: (productId: string) => ['prices', 'historicalLow', productId],
  },

  // Alert queries
  alerts: {
    list: (userId: string) => ['alerts', 'list', userId],
    details: (id: string) => ['alerts', 'details', id],
  },

  // Deal queries
  deals: {
    list: (filters?: any) => ['deals', 'list', filters],
    details: (id: string) => ['deals', 'details', id],
    comments: (id: string) => ['deals', 'comments', id],
  },

  // User queries
  user: {
    profile: () => ['user', 'profile'],
    preferences: () => ['user', 'preferences'],
    stats: () => ['user', 'stats'],
  },
};

/**
 * Mutation key factories for React Query
 */
export const mutationKeys = {
  // Search mutations
  search: {
    saveQuery: (userId: string) => ['search', 'saveQuery', userId],
    clearHistory: (userId: string) => ['search', 'clearHistory', userId],
  },

  // Product mutations
  products: {
    addToWatchlist: (productId: string) => ['products', 'addToWatchlist', productId],
    removeFromWatchlist: (productId: string) => ['products', 'removeFromWatchlist', productId],
  },

  // Alert mutations
  alerts: {
    create: (userId: string) => ['alerts', 'create', userId],
    update: (id: string) => ['alerts', 'update', id],
    delete: (id: string) => ['alerts', 'delete', id],
    test: (id: string) => ['alerts', 'test', id],
  },

  // Deal mutations
  deals: {
    vote: (id: string, userId: string) => ['deals', 'vote', id, userId],
    comment: (id: string, userId: string) => ['deals', 'comment', id, userId],
    create: (userId: string) => ['deals', 'create', userId],
  },

  // User mutations
  user: {
    updateProfile: () => ['user', 'updateProfile'],
    updatePreferences: () => ['user', 'updatePreferences'],
  },
};

/**
 * React Query prefetch functions
 */
export const prefetchFunctions = {
  // Prefetch product details
  prefetchProductDetails: async (queryClient: any, productId: string) => {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.products.details(productId),
      queryFn: () => fetch(`${getReactQueryConfig().baseURL}${reactQueryEndpoints.products.details.replace(':id', productId)}`),
      staleTime: 5 * 60 * 1000, // 5 minutes
    });
  },

  // Prefetch search results
  prefetchSearchResults: async (queryClient: any, query: string, filters?: any) => {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.search.products(query, filters),
      queryFn: () => fetch(`${getReactQueryConfig().baseURL}${reactQueryEndpoints.search.products}?q=${encodeURIComponent(query)}${filters ? `&${new URLSearchParams(filters).toString()}` : ''}`),
      staleTime: 2 * 60 * 1000, // 2 minutes
    });
  },

  // Prefetch price history
  prefetchPriceHistory: async (queryClient: any, productId: string, options?: any) => {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.prices.history(productId, options),
      queryFn: () => fetch(`${getReactQueryConfig().baseURL}${reactQueryEndpoints.prices.history.replace(':productId', productId)}${options ? `?${new URLSearchParams(options).toString()}` : ''}`),
      staleTime: 1 * 60 * 1000, // 1 minute
    });
  },
};

/**
 * React Query error boundaries
 */
export const errorBoundaries = {
  // Error boundary for search queries
  search: {
    retry: 2,
    retryDelay: 1000,
    onError: (error: Error) => {
      console.error('Search query failed:', error);
      // Could send to error monitoring service here
    },
  },

  // Error boundary for product queries
  products: {
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * attemptIndex, 5000),
    onError: (error: Error) => {
      console.error('Product query failed:', error);
    },
  },

  // Error boundary for price queries
  prices: {
    retry: 2,
    retryDelay: 500,
    onError: (error: Error) => {
      console.error('Price query failed:', error);
    },
  },
};

/**
 * React Query debugging utilities
 */
export const debugging = {
  // Enable debug logging
  enableDebugLogging: process.env.NODE_ENV === 'development',

  // Log query cache hits
  logCacheHits: (queryKey: any, isHit: boolean) => {
    if (debugging.enableDebugLogging) {
      console.log(`Query ${JSON.stringify(queryKey)}: ${isHit ? 'HIT' : 'MISS'}`);
    }
  },

  // Log query performance
  logQueryPerformance: (queryKey: any, duration: number) => {
    if (debugging.enableDebugLogging && duration > 1000) {
      console.warn(`Slow query detected: ${JSON.stringify(queryKey)} took ${duration}ms`);
    }
  },
};

export default {
  getReactQueryConfig,
  defaultReactQueryConfig,
  developmentReactQueryConfig,
  productionReactQueryConfig,
  reactQueryEndpoints,
  queryKeys,
  mutationKeys,
  prefetchFunctions,
  errorBoundaries,
  debugging,
};