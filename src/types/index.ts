// Product types
export interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  originalPrice?: number;
  discount?: number;
  platform: string;
  rating: number;
  reviewCount: number;
  images: string[];
  category?: string;
  brand?: string;
  model?: string;
  janCode?: string;
  specifications?: Record<string, any>;
  priceHistory?: PriceHistoryPoint[];
  retailers?: Retailer[];
  availability: 'in_stock' | 'out_of_stock' | 'limited';
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceHistoryPoint {
  date: string;
  price: number;
  platform: string;
}

export interface Retailer {
  platform: string;
  price: number;
  url: string;
  availability: 'in_stock' | 'out_of_stock' | 'limited';
  shipping?: {
    cost: number;
    estimatedDelivery: string;
  };
  lastUpdated: string;
}

// Search types
export interface SearchQuery {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  platform?: string;
  sort?: 'relevance' | 'price_low' | 'price_high' | 'rating' | 'newest';
  page?: number;
  limit?: number;
}

export interface SearchResult {
  products: Product[];
  total: number;
  hasMore: boolean;
  facets?: {
    categories: { name: string; count: number }[];
    platforms: { name: string; count: number }[];
    priceRanges: { range: string; count: number }[];
  };
}

export interface SearchSuggestion {
  text: string;
  category?: string;
  type?: 'product' | 'category' | 'brand';
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// Alert types
export interface Alert {
  id: string;
  userId: string;
  productId: string;
  type: 'price_drop' | 'back_in_stock' | 'target_price';
  targetPrice?: number;
  threshold?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// User types
export interface User {
  id: string;
  email: string;
  name?: string;
  preferences: UserPreferences;
  alerts: string[];
  watchlist: string[];
  createdAt: string;
  lastLogin?: string;
}

export interface UserPreferences {
  notifications: {
    email: boolean;
    push: boolean;
    priceAlerts: boolean;
    restockAlerts: boolean;
    dealAlerts: boolean;
  };
  currency: 'JPY';
  language: 'ja';
  favoritePlatforms: string[];
  defaultSort: 'relevance' | 'price_low' | 'price_high' | 'rating' | 'newest';
}

// Comparison types
export interface Comparison {
  id: string;
  userId?: string;
  products: string[];
  name?: string;
  createdAt: string;
  updatedAt: string;
  isPublic: boolean;
}

// Deal types
export interface Deal {
  id: string;
  title: string;
  description: string;
  productId?: string;
  discount: number;
  originalPrice: number;
  currentPrice: number;
  platform: string;
  url: string;
  image: string;
  category?: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  featured: boolean;
  clickCount: number;
  createdAt: string;
}

// Analytics types
export interface AnalyticsEvent {
  type:
    | 'search'
    | 'product_view'
    | 'click'
    | 'alert_created'
    | 'comparison_created';
  data: Record<string, any>;
  timestamp: string;
  userId?: string;
  sessionId: string;
  userAgent: string;
  ip?: string;
}

// Component Props types
export interface ProductCardProps {
  product: Product;
  showComparison?: boolean;
  showPlatform?: boolean;
  compact?: boolean;
}

export interface SearchBarProps {
  placeholder?: string;
  compact?: boolean;
  onSearch?: (query: string) => void;
  initialValue?: string;
}

export interface FilterPanelProps {
  filters: {
    category?: string;
    platform?: string;
    minPrice?: number;
    maxPrice?: number;
    rating?: number;
    availability?: string;
  };
  onFilterChange: (filters: any) => void;
  availableFilters: {
    categories: string[];
    platforms: string[];
    priceRanges: string[];
  };
}

// Error types
export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

export interface ValidationError {
  field: string;
  message: string;
}

// Utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
