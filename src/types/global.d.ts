/**
 * Global type declarations for window object
 * Extends the global Window interface with custom properties used in the app
 */

import type { Product } from './index';
import type { Pagination } from './index';

interface AvailableFilters {
  categories: string[];
  platforms: string[];
  priceRanges: string[];
}

declare global {
  interface Window {
    /**
     * Initial products data passed from server to client
     * Used in InteractiveProductGrid component
     */
    __INITIAL_PRODUCTS__?: Product[];

    /**
     * Initial pagination state passed from server to client
     * Used in InteractiveProductGrid component
     */
    __INITIAL_PAGINATION__?: Pagination;

    /**
     * Available filter options for products
     * Used in FilterPanel and ProductListModule components
     */
    __AVAILABLE_FILTERS__?: AvailableFilters;

    /**
     * Initial search query passed from server to client
     * Used in search page to pre-populate search bar
     */
    __INITIAL_SEARCH_QUERY__?: string;

    /**
     * Initial category filter passed from server to client
     * Used in search page to pre-populate category filter
     */
    __INITIAL_CATEGORY__?: string;
  }
}
