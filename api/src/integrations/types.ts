/**
 * Common types and interfaces for platform integrations
 */

export interface Product {
  id: string;
  title: string;
  description?: string;
  brand?: string;
  category: string;
  subcategory?: string;
  images: ProductImage[];
  url: string;
  platform: Platform;
  availability: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';
  rating?: number;
  reviewCount?: number;
  specs?: Record<string, any>;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  isPrimary: boolean;
}

export interface Price {
  id: string;
  productId: string;
  platform: Platform;
  currentPrice: number;
  originalPrice?: number;
  currency: string;
  seller?: string;
  condition?: 'new' | 'used' | 'refurbished';
  shippingCost?: number;
  availability: 'in_stock' | 'out_of_stock' | 'limited' | 'unknown';
  url: string;
  metadata?: Record<string, any>;
  recordedAt: Date;
}

export interface ProductSearchResult {
  products: Product[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  searchQuery: string;
  filters?: SearchFilters;
  platform: Platform;
  searchTime: number;
}

export interface SearchFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  brand?: string[];
  condition?: ('new' | 'used' | 'refurbished')[];
  rating?: number;
  availability?: ('in_stock' | 'out_of_stock' | 'limited')[];
  shipping?: ('free' | 'paid')[];
  seller?: string[];
  sortBy?: 'price_low' | 'price_high' | 'rating' | 'newest' | 'popularity';
  page?: number;
  limit?: number;
}

export interface PriceHistory {
  productId: string;
  platform: Platform;
  prices: PricePoint[];
  currentPrice: number;
  highestPrice: number;
  lowestPrice: number;
  averagePrice: number;
  priceChange: number;
  priceChangePercentage: number;
  currency: string;
  startDate: Date;
  endDate: Date;
}

export interface PricePoint {
  price: number;
  currency: string;
  recordedAt: Date;
  source: string;
}

export interface PlatformConfig {
  platform: Platform;
  baseUrl: string;
  apiKey?: string;
  apiSecret?: string;
  affiliateId?: string;
  rateLimit: {
    requestsPerSecond: number;
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  timeout: number;
  retryAttempts: number;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface IntegrationResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    requestId: string;
    platform: Platform;
    responseTime: number;
    rateLimitRemaining?: number;
    cached?: boolean;
  };
}

export interface SearchResult {
  product: Product;
  price: Price;
  relevance: number;
  matchScore: number;
}

export interface PlatformMetrics {
  platform: Platform;
  totalProducts: number;
  lastSyncAt: Date;
  syncDuration: number;
  errorRate: number;
  averageResponseTime: number;
  rateLimitHits: number;
  cacheHitRate: number;
}

export type Platform = 'amazon' | 'rakuten' | 'yahoo' | 'kakaku' | 'mercari';

// Base interface for all platform integrations
export interface PlatformIntegration {
  readonly platform: Platform;
  readonly config: PlatformConfig;

  // Product search and retrieval
  searchProducts(query: string, filters?: SearchFilters): Promise<IntegrationResponse<ProductSearchResult>>;
  getProduct(productId: string): Promise<IntegrationResponse<Product>>;
  getProductByBarcode(barcode: string): Promise<IntegrationResponse<Product>>;

  // Price information
  getCurrentPrice(productId: string): Promise<IntegrationResponse<Price>>;
  getPriceHistory(productId: string, days?: number): Promise<IntegrationResponse<PriceHistory>>;

  // Recommendations and similar products
  getSimilarProducts(productId: string, limit?: number): Promise<IntegrationResponse<Product[]>>;
  getRecommendations(category?: string, limit?: number): Promise<IntegrationResponse<Product[]>>;

  // Health and status
  healthCheck(): Promise<IntegrationResponse<{ status: string; latency: number }>>;
  getMetrics(): Promise<IntegrationResponse<PlatformMetrics>>;
}

// Error classes
export class IntegrationError extends Error {
  constructor(
    message: string,
    public platform: Platform,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export class RateLimitError extends IntegrationError {
  constructor(
    platform: Platform,
    public retryAfter: number,
    message: string = 'Rate limit exceeded'
  ) {
    super(message, platform, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends IntegrationError {
  constructor(
    platform: Platform,
    message: string = 'Authentication failed'
  ) {
    super(message, platform, 'AUTH', 401);
    this.name = 'AuthenticationError';
  }
}

export class ConfigurationError extends IntegrationError {
  constructor(
    platform: Platform,
    message: string = 'Configuration error'
  ) {
    super(message, platform, 'CONFIG', 500);
    this.name = 'ConfigurationError';
  }
}

export class NetworkError extends IntegrationError {
  constructor(
    platform: Platform,
    message: string = 'Network error'
  ) {
    super(message, platform, 'NETWORK', 503);
    this.name = 'NetworkError';
  }
}

export class ValidationError extends IntegrationError {
  constructor(
    platform: Platform,
    message: string = 'Validation error'
  ) {
    super(message, platform, 'VALIDATION', 400);
    this.name = 'ValidationError';
  }
}