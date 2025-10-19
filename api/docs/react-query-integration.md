# React Query Integration Guide

## Overview

This guide explains how to integrate the Yabaii API with React Query in the mobile application. The API is optimized for React Query with proper caching headers, response formats, and error handling.

## API Architecture

### React Query Optimized Responses

All API responses follow a consistent format optimized for React Query:

```typescript
interface ReactQueryResponse<T> {
  data: T;
  success: boolean;
  message?: string;
  timestamp: string;
  requestId: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
    nextPage?: number;
  };
  cache?: {
    ttl: number;
    key: string;
    stale: boolean;
  };
}
```

### Cache Headers

The API includes cache control headers optimized for React Query:

- **Search Results**: `public, max-age=300, s-maxage=300, stale-while-revalidate=30`
- **Product Details**: `public, max-age=900, s-maxage=900, stale-while-revalidate=60`
- **Price Data**: `public, max-age=120, s-maxage=120, stale-while-revalidate=30`
- **Suggestions**: `public, max-age=600, s-maxage=600, stale-while-revalidate=60`

## React Query Configuration

### Client Setup

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getReactQueryConfig } from '../config/react-query-client';

// Create client with optimized configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      ...getReactQueryConfig().defaultOptions.queries,
      // Enable stale-while-revalidate
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

// Wrap your app
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Your app components */}
    </QueryClientProvider>
  );
}
```

### Environment-Specific Configuration

```typescript
// Development
const devConfig = {
  baseURL: 'http://localhost:3000/api/v1',
  staleTime: 60 * 1000, // 1 minute
  cacheTime: 5 * 60 * 1000, // 5 minutes
};

// Production
const prodConfig = {
  baseURL: 'https://api.yabaii.day/api/v1',
  staleTime: 10 * 60 * 1000, // 10 minutes
  cacheTime: 30 * 60 * 1000, // 30 minutes
};
```

## API Client Setup

### HTTP Client with Axios

```typescript
import axios from 'axios';
import { getReactQueryConfig } from '../config/react-query-client';

const apiClient = axios.create({
  baseURL: getReactQueryConfig().baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for authentication
apiClient.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle React Query specific errors
    if (error.response?.status === 429) {
      // Rate limit error
      error.config.retry = true;
      error.config.retryDelay = error.response.headers['retry-after'] * 1000 || 5000;
    }
    return Promise.reject(error);
  }
);
```

## Query Hooks

### Search Queries

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, mutationKeys } from '../config/react-query-client';

// Search products
export function useSearchProducts(query: string, filters?: any) {
  return useQuery({
    queryKey: queryKeys.search.products(query, filters),
    queryFn: async () => {
      const params = new URLSearchParams({ q: query, ...filters });
      const response = await apiClient.get(`/search?${params}`);
      return response.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    cacheTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!query,
  });
}

// Search suggestions
export function useSearchSuggestions(query: string) {
  return useQuery({
    queryKey: queryKeys.search.suggestions(query),
    queryFn: async () => {
      const response = await apiClient.get(`/search/suggestions?q=${encodeURIComponent(query)}`);
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
    enabled: query.length > 2,
  });
}

// Popular searches
export function usePopularSearches() {
  return useQuery({
    queryKey: queryKeys.search.popular(),
    queryFn: async () => {
      const response = await apiClient.get('/search/popular');
      return response.data;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    cacheTime: 30 * 60 * 1000, // 30 minutes
  });
}
```

### Product Queries

```typescript
// Product details
export function useProductDetails(productId: string) {
  return useQuery({
    queryKey: queryKeys.products.details(productId),
    queryFn: async () => {
      const response = await apiClient.get(`/products/${productId}`);
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 15 * 60 * 1000, // 15 minutes
    enabled: !!productId,
  });
}

// Product offers
export function useProductOffers(productId: string) {
  return useQuery({
    queryKey: queryKeys.products.offers(productId),
    queryFn: async () => {
      const response = await apiClient.get(`/products/${productId}/offers`);
      return response.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!productId,
  });
}

// Barcode search
export function useBarcodeSearch(barcode: string) {
  return useQuery({
    queryKey: queryKeys.products.barcode(barcode),
    queryFn: async () => {
      const response = await apiClient.get(`/products/barcode/${barcode}`);
      return response.data;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    cacheTime: 60 * 60 * 1000, // 1 hour
    enabled: !!barcode,
  });
}
```

### Price Queries

```typescript
// Price history
export function usePriceHistory(productId: string, options?: {
  platform?: string;
  days?: number;
}) {
  return useQuery({
    queryKey: queryKeys.prices.history(productId, options),
    queryFn: async () => {
      const params = new URLSearchParams(options || {});
      const response = await apiClient.get(`/prices/${productId}/history?${params}`);
      return response.data;
    },
    staleTime: 1 * 60 * 1000, // 1 minute
    cacheTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 30 * 1000, // 30 seconds
    enabled: !!productId,
  });
}

// Current prices
export function useCurrentPrices(productId: string) {
  return useQuery({
    queryKey: queryKeys.prices.current(productId),
    queryFn: async () => {
      const response = await apiClient.get(`/prices/${productId}/current`);
      return response.data;
    },
    staleTime: 30 * 1000, // 30 seconds
    cacheTime: 1 * 60 * 1000, // 1 minute
    refetchInterval: 10 * 1000, // 10 seconds
    enabled: !!productId,
  });
}

// Price comparison
export function usePriceComparison(productId: string) {
  return useQuery({
    queryKey: queryKeys.prices.compare(productId),
    queryFn: async () => {
      const response = await apiClient.get(`/prices/${productId}/compare`);
      return response.data;
    },
    staleTime: 60 * 1000, // 1 minute
    cacheTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!productId,
  });
}
```

## Mutation Hooks

### Alert Management

```typescript
// Create alert
export function useCreateAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertData: {
      productId: string;
      type: 'price_drop' | 'historical_low' | 'stock_available';
      condition: any;
      channels: string[];
    }) => {
      const response = await apiClient.post('/alerts', alertData);
      return response.data;
    },
    onSuccess: (data, variables) => {
      // Invalidate alerts list
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.list() });

      // Show success notification
      showNotification('Alert created successfully', 'success');
    },
    onError: (error) => {
      showNotification('Failed to create alert', 'error');
    },
  });
}

// Update alert
export function useUpdateAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const response = await apiClient.put(`/alerts/${id}`, updates);
      return response.data;
    },
    onSuccess: (data, variables) => {
      // Invalidate specific alert
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.details(variables.id) });

      showNotification('Alert updated successfully', 'success');
    },
    onError: (error) => {
      showNotification('Failed to update alert', 'error');
    },
  });
}

// Delete alert
export function useDeleteAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/alerts/${id}`);
      return { success: true };
    },
    onSuccess: (data, variables) => {
      // Invalidate alerts list
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.list() });

      showNotification('Alert deleted successfully', 'success');
    },
    onError: (error) => {
      showNotification('Failed to delete alert', 'error');
    },
  });
}
```

### Search Management

```typescript
// Save search query
export function useSaveSearchQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (queryData: {
      query: string;
      resultsCount: number;
    }) => {
      const response = await apiClient.post('/search/history', queryData);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate search history
      queryClient.invalidateQueries({ queryKey: ['search', 'history'] });
    },
  });
}

// Clear search history
export function useClearSearchHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiClient.delete('/search/history');
      return { success: true };
    },
    onSuccess: () => {
      // Invalidate search history
      queryClient.invalidateQueries({ queryKey: ['search', 'history'] });

      showNotification('Search history cleared', 'success');
    },
  });
}
```

## Optimistic Updates

### Product Watchlist

```typescript
export function useToggleWatchlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ productId, isAdding }: {
      productId: string;
      isAdding: boolean;
    }) => {
      const endpoint = isAdding ? '/watchlist/add' : '/watchlist/remove';
      const response = await apiClient.post(endpoint, { productId });
      return response.data;
    },
    onMutate: async ({ productId, isAdding }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.products.details(productId) });

      // Get the current data
      const previousData = queryClient.getQueryData(queryKeys.products.details(productId));

      // Optimistically update
      if (previousData) {
        const updatedData = {
          ...previousData,
          isInWatchlist: isAdding,
        };
        queryClient.setQueryData(queryKeys.products.details(productId), updatedData);
      }
    },
    onError: (error, variables, previousData) => {
      // Rollback on error
      if (previousData) {
        queryClient.setQueryData(queryKeys.products.details(variables.productId), previousData);
      }
    },
    onSettled: () => {
      // Invalidate to get fresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.products.details(variables.productId) });
    },
  });
}
```

## Prefetching

### Smart Prefetching

```typescript
import { prefetchFunctions } from '../config/react-query-client';

// Prefetch related products when viewing a product
export function usePrefetchRelatedProducts() {
  const queryClient = useQueryClient();

  const prefetchRelated = async (productId: string) => {
    // Prefetch similar products
    await queryClient.prefetchQuery({
      queryKey: queryKeys.products.similar(productId),
      queryFn: () => apiClient.get(`/products/${productId}/similar`),
      staleTime: 5 * 60 * 1000,
    });

    // Prefetch current prices
    await queryClient.prefetchQuery({
      queryKey: queryKeys.prices.current(productId),
      queryFn: () => apiClient.get(`/prices/${productId}/current`),
      staleTime: 30 * 1000,
    });
  };

  return { prefetchRelated };
}

// Prefetch search results when typing
export function usePrefetchSearchResults() {
  const queryClient = useQueryClient();

  const prefetchSearch = async (query: string, filters?: any) => {
    if (query.length < 3) return; // Don't prefetch for short queries

    await queryClient.prefetchQuery({
      queryKey: queryKeys.search.products(query, filters),
      queryFn: () => {
        const params = new URLSearchParams({ q: query, ...filters });
        return apiClient.get(`/search?${params}`);
      },
      staleTime: 2 * 60 * 1000,
    });
  };

  return { prefetchSearch };
}
```

## Error Handling

### Custom Error Boundary

```typescript
import { useQueryErrorResetBoundary } from '@tanstack/react-query';

export function useQueryErrorBoundary() {
  const { reset } = useQueryErrorResetBoundary();

  const handleReset = () => {
    reset();
    // Additional reset logic if needed
  };

  return { handleReset };
}

// Error component
export function QueryErrorFallback({ error, reset }: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="error-fallback">
      <h2>Something went wrong</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

### Retry Logic

```typescript
// Custom retry hook
export function useRetryWithBackoff() {
  return {
    retry: (failureCount: number, error: any) => {
      // Don't retry on 4xx errors
      if (error?.response?.status >= 400 && error?.response?.status < 500) {
        return false;
      }

      // Retry up to 3 times with exponential backoff
      if (failureCount < 3) {
        return true;
      }

      return false;
    },
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
  };
}
```

## Performance Optimization

### Selective Fetching

```typescript
// Only fetch data that's needed
export function useMinimalProductData(productId: string) {
  return useQuery({
    queryKey: queryKeys.products.details(productId),
    queryFn: async () => {
      const response = await apiClient.get(`/products/${productId}?fields=id,name,price,image`);
      return response.data;
    },
    select: (data) => ({
      id: data.data.id,
      name: data.data.name,
      price: data.data.price,
      image: data.data.image,
    }),
    staleTime: 5 * 60 * 1000,
    cacheTime: 10 * 60 * 1000,
  });
}
```

### Background Refetching

```typescript
// Enable background refetching for critical data
export function useRealTimePrices(productId: string) {
  return useQuery({
    queryKey: queryKeys.prices.current(productId),
    queryFn: async () => {
      const response = await apiClient.get(`/prices/${productId}/current`);
      return response.data;
    },
    refetchInterval: 30 * 1000, // 30 seconds
    refetchIntervalInBackground: true,
    staleTime: 30 * 1000,
    cacheTime: 2 * 60 * 1000,
  });
}
```

## Testing

### Mock Queries for Testing

```typescript
import { renderHook, waitFor } from '@testing-library/react-hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueryClient as ReactQueryClient } from '@tanstack/react-query';

// Test wrapper
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

// Example test
describe('useSearchProducts', () => {
  it('should fetch search results', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useSearchProducts('iPhone'), { wrapper });

    await waitFor(() => result.current.isSuccess);

    expect(result.current.data).toBeDefined();
    expect(result.current.data.data).toHaveLength.toBeGreaterThan(0);
  });
});
```

## Best Practices

### 1. Query Key Design

```typescript
// Good: Specific and hierarchical
const queryKeys = {
  products: {
    details: (id: string) => ['products', 'details', id],
    list: (filters: any) => ['products', 'list', filters],
  },
};

// Bad: Generic and flat
const badQueryKeys = {
  products: (id: string) => ['products', id],
  productsList: (filters: any) => ['productsList', filters],
};
```

### 2. Cache Configuration

```typescript
// Good: Appropriate cache times for different data types
const searchConfig = {
  staleTime: 2 * 60 * 1000, // 2 minutes
  cacheTime: 5 * 60 * 1000, // 5 minutes
};

const productConfig = {
  staleTime: 10 * 60 * 1000, // 10 minutes
  cacheTime: 30 * 60 * 1000, // 30 minutes
};

const priceConfig = {
  staleTime: 1 * 60 * 1000, // 1 minute
  cacheTime: 5 * 60 * 1000, // 5 minutes
};
```

### 3. Error Handling

```typescript
// Good: Proper error handling and user feedback
export function useApiQuery(queryKey: any, queryFn: any) {
  return useQuery({
    queryKey,
    queryFn,
    onError: (error) => {
      console.error('Query failed:', error);
      // Show user-friendly error message
      showNotification('Failed to load data', 'error');
    },
    retry: (failureCount, error) => {
      // Retry on network errors, not on validation errors
      return !error.response || error.response.status >= 500;
    },
  });
}
```

### 4. Loading States

```typescript
// Good: Proper loading and error states
export function useProductDetails(productId: string) {
  const { data, isLoading, error, refetch } = useProductDetails(productId);

  if (isLoading) return <ProductDetailsSkeleton />;
  if (error) return <ProductDetailsError error={error} onRetry={refetch} />;
  if (!data) return <ProductDetailsEmpty />;

  return <ProductDetails product={data.data} />;
}
```

This comprehensive React Query integration provides optimal performance, caching, and user experience for the Yabaii mobile application.