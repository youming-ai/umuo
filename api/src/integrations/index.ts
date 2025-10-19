/**
 * External service integrations for Japanese e-commerce platforms
 * Provides unified interface for Amazon Japan, Rakuten, Yahoo Shopping, Kakaku, and Mercari
 */

export { AmazonIntegration } from './amazon';
export { RakutenIntegration } from './rakuten';
export { YahooShoppingIntegration } from './yahoo-shopping';
export { KakakuIntegration } from './kakaku';
export { MercariIntegration } from './mercari';
export { PlatformIntegrationFactory } from './factory';
export { IntegrationError, RateLimitError, AuthenticationError } from './types';

// Re-export common types
export type {
  Product,
  Price,
  ProductSearchResult,
  PlatformConfig,
  IntegrationResponse,
  SearchFilters,
  PriceHistory
} from './types';