/**
 * Base class for all platform integrations
 * Provides common functionality and utilities
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { logger } from '@/utils/logger';
import { getRedisClient, CacheKeys, CacheTTL } from '@/config/redis';
import {
  Platform,
  PlatformConfig,
  IntegrationResponse,
  Product,
  ProductSearchResult,
  Price,
  PriceHistory,
  SearchFilters,
  PlatformMetrics,
  IntegrationError,
  RateLimitError,
  NetworkError,
  ConfigurationError,
  ValidationError
} from './types';

export abstract class BasePlatformIntegration {
  protected client: AxiosInstance;
  protected redis = getRedisClient();
  protected metrics: Map<string, number> = new Map();

  constructor(public readonly config: PlatformConfig) {
    if (!config.enabled) {
      throw new ConfigurationError(config.platform, 'Platform integration is disabled');
    }

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'User-Agent': 'Yabaii-API/1.0',
        'Accept': 'application/json',
        'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
        ...config.headers,
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const requestId = crypto.randomUUID();
        config.headers['X-Request-ID'] = requestId;

        logger.debug('API Request', {
          platform: this.config.platform,
          method: config.method?.toUpperCase(),
          url: config.url,
          requestId,
        });

        return config;
      },
      (error) => {
        logger.error('API Request Error', {
          platform: this.config.platform,
          error: error.message,
        });
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('API Response', {
          platform: this.config.platform,
          status: response.status,
          url: response.config.url,
          requestId: response.config.headers['X-Request-ID'],
        });

        return response;
      },
      (error) => {
        this.handleApiError(error);
        return Promise.reject(error);
      }
    );
  }

  protected handleApiError(error: any): void {
    const platform = this.config.platform;
    const url = error.config?.url;
    const status = error.response?.status;

    logger.error('API Error', {
      platform,
      url,
      status,
      message: error.message,
      data: error.response?.data,
    });

    // Update error metrics
    this.incrementMetric('errors');

    if (status === 429) {
      const retryAfter = error.response?.headers?.['retry-after'] || 60;
      throw new RateLimitError(platform, retryAfter);
    }

    if (status === 401 || status === 403) {
      throw new IntegrationError('Authentication failed', platform, 'AUTH', status);
    }

    if (status >= 500) {
      throw new NetworkError(platform, 'External service error');
    }

    if (status >= 400) {
      throw new ValidationError(platform, 'Invalid request');
    }

    throw new IntegrationError(error.message, platform, 'UNKNOWN');
  }

  protected async makeRequest<T>(
    config: AxiosRequestConfig,
    cacheKey?: string,
    cacheTTL: number = CacheTTL.externalApi
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Check cache first
      if (cacheKey) {
        const cached = await this.getFromCache<T>(cacheKey);
        if (cached) {
          this.incrementMetric('cache_hits');
          return cached;
        }
      }

      // Check rate limiting
      await this.checkRateLimit();

      // Make request
      const response = await this.client.request<T>(config);
      const data = response.data;

      // Cache successful responses
      if (cacheKey && data) {
        await this.setCache(cacheKey, data, cacheTTL);
      }

      // Update metrics
      const responseTime = Date.now() - startTime;
      this.incrementMetric('requests');
      this.setMetric('avg_response_time', responseTime);

      return data;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('Request failed', {
        platform: this.config.platform,
        url: config.url,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  protected async checkRateLimit(): Promise<void> {
    const key = CacheKeys.externalApi(
      this.config.platform,
      'rate_limit',
      'minute'
    );

    const current = await this.redis.get(key);
    const count = parseInt(current || '0');
    const limit = this.config.rateLimit.requestsPerMinute;

    if (count >= limit) {
      const ttl = await this.redis.ttl(key);
      throw new RateLimitError(this.config.platform, ttl || 60);
    }

    // Increment counter
    const pipeline = this.redis.multi();
    pipeline.incr(key);
    pipeline.expire(key, 60);
    await pipeline.exec();
  }

  protected async getFromCache<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Cache get error', { key, error });
      return null;
    }
  }

  protected async setCache(key: string, value: any, ttl: number): Promise<void> {
    try {
      await this.redis.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
      logger.error('Cache set error', { key, error });
    }
  }

  protected getCacheKey(type: string, params: Record<string, any>): string {
    const paramString = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    return `${this.config.platform}:${type}:${Buffer.from(paramString).toString('base64')}`;
  }

  protected incrementMetric(name: string): void {
    const current = this.metrics.get(name) || 0;
    this.metrics.set(name, current + 1);
  }

  protected setMetric(name: string, value: number): void {
    this.metrics.set(name, value);
  }

  protected getMetric(name: string): number {
    return this.metrics.get(name) || 0;
  }

  protected generateRequestId(): string {
    return crypto.randomUUID();
  }

  protected sanitizeString(str: string): string {
    return str
      .trim()
      .replace(/[^\w\s\-\.]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 1000);
  }

  protected sanitizePrice(price: any): number | null {
    if (typeof price === 'number' && !isNaN(price) && price > 0) {
      return Math.round(price * 100) / 100; // Round to 2 decimal places
    }

    if (typeof price === 'string') {
      const parsed = parseFloat(price.replace(/[^\d\.]/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        return Math.round(parsed * 100) / 100;
      }
    }

    return null;
  }

  protected parseJapaneseDate(dateString: string): Date | null {
    if (!dateString) return null;

    try {
      // Handle Japanese date formats
      const clean = dateString.replace(/[年月]/g, '-').replace(/日/g, '').trim();
      return new Date(clean);
    } catch {
      return null;
    }
  }

  protected extractJapaneseNumber(text: string): number | null {
    if (!text) return null;

    // Extract numbers from Japanese text
    const match = text.match(/[0-9]+/);
    return match ? parseInt(match[0]) : null;
  }

  protected convertJapaneseToArabicNumerals(text: string): string {
    const numeralMap: Record<string, string> = {
      '〇': '0',
      '一': '1',
      '二': '2',
      '三': '3',
      '四': '4',
      '五': '5',
      '六': '6',
      '七': '7',
      '八': '8',
      '九': '9',
      '十': '10',
      '百': '100',
      '千': '1000',
      '万': '10000',
    };

    let result = text;
    Object.entries(numeralMap).forEach(([japanese, arabic]) => {
      result = result.replace(new RegExp(japanese, 'g'), arabic);
    });

    return result;
  }

  abstract searchProducts(query: string, filters?: SearchFilters): Promise<IntegrationResponse<ProductSearchResult>>;
  abstract getProduct(productId: string): Promise<IntegrationResponse<Product>>;
  abstract getCurrentPrice(productId: string): Promise<IntegrationResponse<Price>>;
  abstract getPriceHistory(productId: string, days?: number): Promise<IntegrationResponse<PriceHistory>>;
  abstract healthCheck(): Promise<IntegrationResponse<{ status: string; latency: number }>>;
  abstract getMetrics(): Promise<IntegrationResponse<PlatformMetrics>>;

  // Optional methods with default implementations
  async getProductByBarcode(barcode: string): Promise<IntegrationResponse<Product>> {
    throw new IntegrationError(
      'Barcode search not supported',
      this.config.platform,
      'NOT_IMPLEMENTED',
      501
    );
  }

  async getSimilarProducts(productId: string, limit: number = 10): Promise<IntegrationResponse<Product[]>> {
    throw new IntegrationError(
      'Similar products not supported',
      this.config.platform,
      'NOT_IMPLEMENTED',
      501
    );
  }

  async getRecommendations(category?: string, limit: number = 10): Promise<IntegrationResponse<Product[]>> {
    throw new IntegrationError(
      'Recommendations not supported',
      this.config.platform,
      'NOT_IMPLEMENTED',
      501
    );
  }
}