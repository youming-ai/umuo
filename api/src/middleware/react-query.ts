/**
 * React Query Optimization Middleware
 * Provides API responses optimized for React Query consumption
 */

import { Context, Next } from 'hono';
import { getCacheService } from '@/config/redis';
import { logger } from '@/utils/logger';

/**
 * Cache control headers for React Query
 */
export const reactQueryCacheHeaders = {
  // No caching for real-time data
  noCache: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',

  // Short-term caching for frequently accessed data
  shortTerm: 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',

  // Medium-term caching for static data
  mediumTerm: 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',

  // Long-term caching for rarely changing data
  longTerm: 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=300',
};

/**
 * React Query friendly response format
 */
export interface ReactQueryResponse<T> {
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

/**
 * React Query optimization middleware
 */
export const reactQueryOptimizationMiddleware = async (c: Context, next: Next) => {
  const startTime = Date.now();
  const requestId = c.get('requestId');

  try {
    await next();

    const duration = Date.now() - startTime;
    const statusCode = c.res.status;

    // Add React Query specific headers
    addReactQueryHeaders(c, duration, statusCode);

    // Optimize response format for React Query
    optimizeResponseForReactQuery(c);

    // Log performance for monitoring
    if (duration > 1000) {
      logger.warn('Slow React Query endpoint', {
        path: c.req.path,
        method: c.req.method,
        duration,
        requestId,
      });
    }

  } catch (error) {
    // Add error headers for React Query
    addReactQueryErrorHeaders(c);
    throw error;
  }
};

/**
 * Add React Query specific headers
 */
function addReactQueryHeaders(c: Context, duration: number, statusCode: number): void {
  // Add request duration header
  c.header('X-Response-Time', `${duration}ms`);

  // Add React Query specific headers
  c.header('X-React-Query-Enabled', 'true');
  c.header('X-React-Query-Version', '5.0.0');

  // Add cache headers based on endpoint type
  const cacheHeader = getCacheHeaderForEndpoint(c.req.path, c.req.method, statusCode);
  if (cacheHeader) {
    c.header('Cache-Control', cacheHeader);
  }

  // Add ETag for caching
  if (c.res.headers.get('Content-Length')) {
    const etag = generateETag(c.res.headers.get('Content-Length')!, c.req.path);
    c.header('ETag', etag);
  }
}

/**
 * Add error headers for React Query
 */
function addReactQueryErrorHeaders(c: Context): void {
  c.header('X-React-Query-Error', 'true');
  c.header('X-React-Query-Retry-After', '5'); // Suggest retry after 5 seconds
}

/**
 * Optimize response format for React Query
 */
function optimizeResponseForReactQuery(c: Context): void {
  const contentType = c.res.headers.get('Content-Type');

  if (contentType?.includes('application/json')) {
    try {
      const response = c.res.clone().json();
      const optimized = optimizeJsonResponse(response, c);

      // Update response with optimized format
      c.res.body = JSON.stringify(optimized);
      c.res.headers.set('Content-Length', Buffer.byteLength(c.res.body as string).toString());
    } catch (error) {
      // If response parsing fails, continue with original response
      logger.debug('Failed to optimize React Query response:', error);
    }
  }
}

/**
 * Optimize JSON response for React Query
 */
function optimizeJsonResponse(response: any, c: Context): ReactQueryResponse<any> {
  const requestId = c.get('requestId');

  // If response is already in React Query format, return as-is
  if (response?.data !== undefined && response?.success !== undefined) {
    return {
      ...response,
      requestId,
      timestamp: new Date().toISOString(),
    };
  }

  // Wrap response in React Query format
  return {
    data: response,
    success: true,
    requestId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get appropriate cache header for endpoint
 */
function getCacheHeaderForEndpoint(path: string, method: string, statusCode: number): string {
  // Don't cache error responses
  if (statusCode >= 400) {
    return reactQueryCacheHeaders.noCache;
  }

  // Don't cache write operations
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return reactQueryCacheHeaders.noCache;
  }

  // Cache headers based on endpoint patterns
  if (path.includes('/health')) {
    return reactQueryCacheHeaders.shortTerm;
  }

  if (path.includes('/search') || path.includes('/products')) {
    return reactQueryCacheHeaders.shortTerm;
  }

  if (path.includes('/categories') || path.includes('/platforms')) {
    return reactQueryCacheHeaders.longTerm;
  }

  if (path.includes('/prices/')) {
    return reactQueryCacheHeaders.mediumTerm;
  }

  // Default to short-term caching
  return reactQueryCacheHeaders.shortTerm;
}

/**
 * Generate ETag for caching
 */
function generateETag(contentLength: string, path: string): string {
  const hash = Buffer.from(`${path}:${contentLength}:${Date.now()}`).toString('base64');
  return `"${hash.substring(0, 32)}"`;
}

/**
 * Check if request supports conditional caching
 */
export function supportsConditionalCaching(c: Context): boolean {
  return !!(c.req.header('If-None-Match') || c.req.header('If-Modified-Since'));
}

/**
 * Handle conditional requests for React Query
 */
export const conditionalCachingMiddleware = async (c: Context, next: Next) => {
  const ifNoneMatch = c.req.header('If-None-Match');
  const ifModifiedSince = c.req.header('If-Modified-Since');

  try {
    await next();

    const responseETag = c.res.headers.get('ETag');
    const lastModified = c.res.headers.get('Last-Modified');

    // Check if we can return 304 Not Modified
    if ((ifNoneMatch && ifNoneMatch === responseETag) ||
        (ifModifiedSince && lastModified &&
         new Date(ifModifiedSince).getTime() >= new Date(lastModified).getTime())) {

      c.status(304);
      c.res.body = '';
      c.res.headers.set('Content-Length', '0');

      return c.body(null);
    }

  } catch (error) {
    // If error occurs, continue with normal error handling
    throw error;
  }
};

/**
 * React Query specific rate limiting
 */
export const reactQueryRateLimitMiddleware = async (c: Context, next: Next) => {
  const clientIP = getClientIP(c);
  const endpoint = `${c.req.method}:${c.req.path}`;

  try {
    // Check Redis cache for rate limiting
    const cache = getCacheService();
    const rateLimitKey = `react_query_rate:${endpoint}:${clientIP}`;

    const currentCount = await cache.get(rateLimitKey);
    const count = parseInt(currentCount || '0');

    // React Query specific rate limits
    const limits = getReactQueryRateLimits(endpoint);

    if (count >= limits.maxRequests) {
      c.header('X-React-Query-Rate-Limited', 'true');
      c.header('Retry-After', limits.windowSeconds.toString());

      return c.json({
        success: false,
        error: 'Rate limit exceeded',
        message: 'Too many requests',
        requestId: c.get('requestId'),
      }, 429);
    }

    // Increment rate limit counter
    await cache.set(rateLimitKey, (count + 1).toString(), limits.windowSeconds);

    // Add rate limit headers
    c.header('X-React-Query-Rate-Limit-Limit', limits.maxRequests.toString());
    c.header('X-React-Query-Rate-Limit-Remaining', Math.max(0, limits.maxRequests - count - 1).toString());
    c.header('X-React-Query-Rate-Limit-Reset', new Date(Date.now() + limits.windowMs).toISOString());

    await next();

  } catch (error) {
    logger.error('React Query rate limiting error:', error);
    await next(); // Fail open if Redis is down
  }
};

/**
 * Get rate limits for React Query endpoints
 */
function getReactQueryRateLimits(endpoint: string): {
  maxRequests: number;
  windowSeconds: number;
  windowMs: number;
} {
  // Default limits
  const defaults = {
    maxRequests: 100,
    windowSeconds: 60,
    windowMs: 60000,
  };

  // More restrictive limits for expensive operations
  if (endpoint.includes('/search') || endpoint.includes('/prices/')) {
    return {
      maxRequests: 30,
      windowSeconds: 60,
      windowMs: 60000,
    };
  }

  // Less restrictive for read-only operations
  if (endpoint.includes('/categories') || endpoint.includes('/platforms')) {
    return {
      maxRequests: 200,
      windowSeconds: 60,
      windowMs: 60000,
    };
  }

  return defaults;
}

/**
 * Get client IP address
 */
function getClientIP(c: Context): string {
  return c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
         c.req.header('X-Real-IP') ||
         c.req.header('CF-Connecting-IP') ||
         'unknown';
}

/**
 * React Query health check endpoint
 */
export const reactQueryHealthCheck = async (c: Context) => {
  try {
    const cache = getCacheService();

    // Test cache connectivity
    const testKey = 'react_query_health_test';
    await cache.set(testKey, 'ok', 10);
    const testResult = await cache.get(testKey);
    await cache.del(testKey);

    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      requestId: c.get('requestId'),
      features: {
        cacheControl: 'enabled',
        rateLimiting: 'enabled',
        conditionalCaching: 'enabled',
        optimization: 'enabled',
      },
      cache: {
        status: testResult === 'ok' ? 'connected' : 'disconnected',
        type: 'redis',
      },
      headers: {
        'X-Response-Time': 'enabled',
        'X-React-Query-Enabled': 'enabled',
        'X-React-Query-Version': '5.0.0',
        'ETag': 'enabled',
      },
      performance: {
        maxRequestDuration: '1000ms',
        cacheHeaders: 'enabled',
        conditionalRequests: 'enabled',
      }
    };

    return c.json(healthData);

  } catch (error) {
    logger.error('React Query health check failed:', error);

    return c.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      requestId: c.get('requestId'),
    }, 503);
  }
};

export {
  reactQueryOptimizationMiddleware,
  conditionalCachingMiddleware,
  reactQueryRateLimitMiddleware,
  reactQueryHealthCheck,
  reactQueryCacheHeaders,
};