/**
 * Custom hooks for API calls with React Query
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { Product, PriceHistory, PriceAlert, User, SearchResult } from '@/types';

// Generic API hook for GET requests
export function useApiQuery<T>(
  key: string[],
  url: string,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    cacheTime?: number;
  }
) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const response = await apiClient.get(url);
      return response.data as T;
    },
    ...options,
  });
}

// Generic API hook for POST/PUT/DELETE requests
export function useApiMutation<TData, TVariables>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST',
  options?: {
    onSuccess?: (data: TData) => void;
    onError?: (error: Error) => void;
  }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: TVariables) => {
      const response = await apiClient.request({
        url,
        method,
        data: variables,
      });
      return response.data as TData;
    },
    onSuccess: (data) => {
      options?.onSuccess?.(data);
      queryClient.invalidateQueries();
    },
    onError: options?.onError,
  });
}

// Specific hooks for common API operations
export function useSearchProducts() {
  return useMutation({
    mutationFn: async ({ query, filters, page = 1 }: {
      query: string;
      filters?: any;
      page?: number;
    }) => {
      const response = await apiClient.get('/search', {
        params: { q: query, ...filters, page },
      });
      return response.data as SearchResult;
    },
  });
}

export function useProductDetails(productId: string) {
  return useApiQuery<Product>(
    ['product', productId],
    `/products/${productId}`,
    { enabled: !!productId }
  );
}

export function usePriceHistory(productId: string) {
  return useApiQuery<PriceHistory[]>(
    ['price-history', productId],
    `/products/${productId}/prices`,
    { enabled: !!productId }
  );
}

export function usePriceAlerts() {
  return useApiQuery<PriceAlert[]>(['alerts'], '/alerts');
}

export function useCreatePriceAlert() {
  return useApiMutation<PriceAlert, Partial<PriceAlert>>('/alerts');
}

export function useUpdatePriceAlert() {
  return useApiMutation<PriceAlert, { id: string; updates: Partial<PriceAlert> }>(
    '/alerts',
    'PUT'
  );
}

export function useDeletePriceAlert() {
  return useApiMutation<void, string>('/alerts', 'DELETE');
}

export function useUserProfile() {
  return useApiQuery<User>(['user', 'profile'], '/user/profile');
}

export function useUpdateUserProfile() {
  return useApiMutation<User, Partial<User>>('/user/profile', 'PUT');
}