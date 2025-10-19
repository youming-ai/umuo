/**
 * Search Store - Zustand store for search state management
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { Product, SearchFilters, SortOption } from '@/types';

interface SearchState {
  // Search state
  query: string;
  filters: SearchFilters;
  sort: SortOption;
  results: Product[];
  loading: boolean;
  error: string | null;

  // Pagination
  page: number;
  hasMore: boolean;
  total: number;

  // Search history
  recentSearches: string[];
  popularSearches: string[];

  // Actions
  setQuery: (query: string) => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  setSort: (sort: SortOption) => void;
  setResults: (results: Product[], total: number, hasMore: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setPage: (page: number) => void;
  addToRecentSearches: (query: string) => void;
  clearSearch: () => void;
  clearRecentSearches: () => void;
}

export const useSearchStore = create<SearchState>()(
  devtools(
    (set, get) => ({
      // Initial state
      query: '',
      filters: {
        category: undefined,
        brand: undefined,
        minPrice: undefined,
        maxPrice: undefined,
        platforms: undefined,
        condition: undefined,
        availability: undefined,
      },
      sort: 'relevance',
      results: [],
      loading: false,
      error: null,
      page: 1,
      hasMore: false,
      total: 0,
      recentSearches: [],
      popularSearches: [
        'iPhone 15',
        'Nintendo Switch',
        'PS5',
        'iPad Pro',
        'AirPods Pro',
        'ソニー ヘッドホン',
        'Nintendo Switch',
      ],

      // Actions
      setQuery: (query: string) => {
        set({ query, page: 1 });
      },

      setFilters: (filters: Partial<SearchFilters>) => {
        set((state) => ({
          filters: { ...state.filters, ...filters },
          page: 1,
        }));
      },

      setSort: (sort: SortOption) => {
        set({ sort, page: 1 });
      },

      setResults: (results: Product[], total: number, hasMore: boolean) => {
        set({ results, total, hasMore });
      },

      setLoading: (loading: boolean) => {
        set({ loading });
      },

      setError: (error: string | null) => {
        set({ error });
      },

      setPage: (page: number) => {
        set({ page });
      },

      addToRecentSearches: (query: string) => {
        if (!query.trim()) return;

        set((state) => {
          const filtered = state.recentSearches.filter(item => item !== query);
          return {
            recentSearches: [query, ...filtered].slice(0, 10),
          };
        });
      },

      clearSearch: () => {
        set({
          query: '',
          filters: {
            category: undefined,
            brand: undefined,
            minPrice: undefined,
            maxPrice: undefined,
            platforms: undefined,
            condition: undefined,
            availability: undefined,
          },
          sort: 'relevance',
          results: [],
          page: 1,
          error: null,
        });
      },

      clearRecentSearches: () => {
        set({ recentSearches: [] });
      },
    }),
    {
      name: 'search-store',
    }
  )
);