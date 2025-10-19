/**
 * Redis configuration and connection management
 * Handles Redis caching for Yabaii API
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from '@/utils/logger';

// Redis configuration
const config = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB || '0'),
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
  keyPrefix: 'yabaii:',
};

// Connection singleton
let client: RedisClientType | null = null;

/**
 * Initialize Redis connection
 */
export async function initRedis(): Promise<RedisClientType> {
  if (client && client.isOpen) {
    return client;
  }

  try {
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      // Use connection string if provided
      client = createClient({
        url: redisUrl,
        socket: {
          connectTimeout: config.connectTimeout,
          lazyConnect: config.lazyConnect,
          keepAlive: config.keepAlive,
        },
        command_timeout: config.commandTimeout,
      });
    } else {
      // Use individual config parameters
      client = createClient({
        socket: {
          host: config.host,
          port: config.port,
          connectTimeout: config.connectTimeout,
          lazyConnect: config.lazyConnect,
          keepAlive: config.keepAlive,
        },
        password: config.password,
        database: config.database,
        command_timeout: config.commandTimeout,
      });
    }

    // Event handlers
    client.on('error', (error) => {
      logger.error('Redis connection error:', error);
    });

    client.on('connect', () => {
      logger.info('Redis client connected');
    });

    client.on('ready', () => {
      logger.info('Redis client ready');
    });

    client.on('end', () => {
      logger.info('Redis client disconnected');
    });

    client.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });

    // Connect to Redis
    await client.connect();
    logger.info('Redis connection initialized successfully');

    return client;
  } catch (error) {
    logger.error('Failed to initialize Redis connection:', error);
    throw new Error('Redis connection failed');
  }
}

/**
 * Get Redis client instance
 */
export function getRedisClient(): RedisClientType {
  if (!client || !client.isOpen) {
    throw new Error('Redis not connected. Call initRedis() first.');
  }
  return client;
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const result = await redis.ping();
    return result === 'PONG';
  } catch (error) {
    logger.error('Redis connection test failed:', error);
    return false;
  }
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (client && client.isOpen) {
    await client.quit();
    client = null;
    logger.info('Redis connection closed');
  }
}

/**
 * Redis health check
 */
export async function redisHealthCheck(): Promise<{
  status: 'healthy' | 'unhealthy';
  responseTime?: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    const redis = getRedisClient();
    await redis.ping();
    const responseTime = Date.now() - startTime;

    return {
      status: 'healthy',
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      status: 'unhealthy',
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Cache key utilities
 */
export const CacheKeys = {
  // Price data caching
  priceHistory: (productId: string, platform: string = 'all') =>
    `price:history:${productId}:${platform}`,

  currentPrice: (productId: string, platform: string) =>
    `price:current:${productId}:${platform}`,

  priceStats: (productId: string, period: number) =>
    `price:stats:${productId}:${period}d`,

  historicalLow: (productId: string) =>
    `price:low:${productId}`,

  // Product data caching
  productDetails: (productId: string) =>
    `product:details:${productId}`,

  productOffers: (productId: string) =>
    `product:offers:${productId}`,

  similarProducts: (productId: string) =>
    `product:similar:${productId}`,

  // Search results caching
  searchResults: (query: string, filters: string) =>
    `search:results:${Buffer.from(query + filters).toString('base64')}`,

  searchSuggestions: (query: string) =>
    `search:suggestions:${query}`,

  // User data caching
  userProfile: (userId: string) =>
    `user:profile:${userId}`,

  userPreferences: (userId: string) =>
    `user:preferences:${userId}`,

  userAlerts: (userId: string) =>
    `user:alerts:${userId}`,

  // Deals and recommendations
  trendingDeals: (category: string = 'all') =>
    `deals:trending:${category}`,

  recommendations: (userId: string, type: string) =>
    `recommendations:${userId}:${type}`,

  // External API responses
  externalApi: (platform: string, endpoint: string, params: string) =>
    `api:${platform}:${endpoint}:${Buffer.from(params).toString('base64')}`,
} as const;

/**
 * TTL (Time To Live) configurations in seconds
 */
export const CacheTTL = {
  // Price data - frequently accessed but changes often
  priceHistory: 3600, // 1 hour
  currentPrice: 300,  // 5 minutes
  priceStats: 1800,    // 30 minutes
  historicalLow: 7200, // 2 hours

  // Product data - changes less frequently
  productDetails: 1800,  // 30 minutes
  productOffers: 600,     // 10 minutes
  similarProducts: 3600,  // 1 hour

  // Search results - short cache to ensure freshness
  searchResults: 300,     // 5 minutes
  searchSuggestions: 1800, // 30 minutes

  // User data - moderate cache
  userProfile: 600,       // 10 minutes
  userPreferences: 1800,  // 30 minutes
  userAlerts: 300,        // 5 minutes

  // Deals and recommendations - moderate cache
  trendingDeals: 900,     // 15 minutes
  recommendations: 1800,  // 30 minutes

  // External API responses - longer cache to reduce API calls
  externalApi: 1800,      // 30 minutes
} as const;

/**
 * Cache utilities
 */
export class CacheService {
  private redis: RedisClientType;

  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Set cache value with TTL
   */
  async set(key: string, value: any, ttlSeconds: number = CacheTTL.priceHistory): Promise<void> {
    try {
      const serializedValue = JSON.stringify(value);
      await this.redis.setEx(key, ttlSeconds, serializedValue);
    } catch (error) {
      logger.error('Cache set error:', { key, error });
      // Don't throw error - cache failures shouldn't break the application
    }
  }

  /**
   * Get cache value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      if (value === null) {
        return null;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      logger.error('Cache get error:', { key, error });
      return null;
    }
  }

  /**
   * Delete cache key
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error('Cache delete error:', { key, error });
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result > 0;
    } catch (error) {
      logger.error('Cache exists error:', { key, error });
      return false;
    }
  }

  /**
   * Set cache only if key doesn't exist
   */
  async setIfNotExists(key: string, value: any, ttlSeconds: number): Promise<boolean> {
    try {
      const serializedValue = JSON.stringify(value);
      const result = await this.redis.setNX(key, serializedValue);
      if (result) {
        await this.redis.expire(key, ttlSeconds);
      }
      return result;
    } catch (error) {
      logger.error('Cache setIfNotExists error:', { key, error });
      return false;
    }
  }

  /**
   * Increment counter
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      logger.error('Cache increment error:', { key, error });
      return 0;
    }
  }

  /**
   * Get TTL for key
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(key);
    } catch (error) {
      logger.error('Cache TTL error:', { key, error });
      return -1;
    }
  }

  /**
   * Clear all cache with pattern
   */
  async clearPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(keys);
      }
    } catch (error) {
      logger.error('Cache clear pattern error:', { pattern, error });
    }
  }

  /**
   * Get Redis info and statistics
   */
  async getInfo(): Promise<any> {
    try {
      const info = await this.redis.info();
      return info;
    } catch (error) {
      logger.error('Redis info error:', error);
      return null;
    }
  }
}

export default {
  initRedis,
  getRedisClient,
  testRedisConnection,
  closeRedis,
  redisHealthCheck,
  CacheKeys,
  CacheTTL,
  CacheService,
};