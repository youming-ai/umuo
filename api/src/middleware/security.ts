/**
 * Security middleware for Yabaii API
 * Handles CORS, security headers, rate limiting, and other security measures
 */

import { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { logger } from '@/utils/logger';
import { getRedisClient } from '@/config/redis';
import {
  getCorsConfig,
  getSecurityHeadersConfig,
  getMonitoringConfig
} from '@/config/security';

/**
 * Get CORS configuration from security config
 */
const getCorsMiddlewareConfig = () => {
  const corsConfig = getCorsConfig();

  return {
    ...corsConfig,
    exposeHeaders: [
      'Content-Length',
      'Content-Range',
      'X-Total-Count',
      'X-Rate-Limit-Remaining',
      'X-Rate-Limit-Reset',
      'X-Request-ID'
    ],
  };
};

/**
 * Security headers middleware
 * Sets comprehensive security headers for all responses
 */
export const securityHeadersMiddleware = async (c: Context, next: Next) => {
  try {
    const config = getSecurityHeadersConfig();

    if (!config.enabled) {
      await next();
      return;
    }

    // Standard security headers
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions Policy
    if (config.permissionsPolicy.enabled) {
      c.header('Permissions-Policy', config.permissionsPolicy.policy);
    }

    // Content Security Policy (CSP)
    if (config.contentSecurityPolicy.enabled) {
      c.header('Content-Security-Policy', config.contentSecurityPolicy.policy);
    }

    // Remove server information
    c.header('Server', 'Yabaii-API');
    c.header('X-Powered-By', 'Yabaii');

    // Request ID for tracing
    const requestId = crypto.randomUUID();
    c.header('X-Request-ID', requestId);
    c.set('requestId', requestId);

    await next();
  } catch (error) {
    logger.error('Security headers middleware error:', error);
    await next(); // Continue without security headers if there's an error
  }
};

/**
 * Rate limiting middleware
 * Uses Redis for distributed rate limiting
 */
export const rateLimitMiddleware = (options: {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (c: Context) => string;
  skipSuccessfulRequests?: boolean;
}) => {
  return async (c: Context, next: Next) => {
    try {
      const redis = getRedisClient();
      const key = options.keyGenerator
        ? options.keyGenerator(c)
        : `rate_limit:${c.req.method}:${c.req.path}:${getClientIP(c)}`;

      const windowSeconds = Math.ceil(options.windowMs / 1000);

      // Get current count
      const currentCount = await redis.get(key);
      const count = parseInt(currentCount || '0');

      // Add rate limit headers
      c.header('X-Rate-Limit-Limit', options.maxRequests.toString());
      c.header('X-Rate-Limit-Remaining', Math.max(0, options.maxRequests - count - 1).toString());
      c.header('X-Rate-Limit-Reset', new Date(Date.now() + options.windowMs).toISOString());

      if (count >= options.maxRequests) {
        c.header('Retry-After', windowSeconds.toString());

        logger.warn('Rate limit exceeded', {
          ip: getClientIP(c),
          path: c.req.path,
          method: c.req.method,
          count: count + 1,
          limit: options.maxRequests
        });

        return c.json({
          success: false,
          error: 'Rate limit exceeded',
          message: `Too many requests. Maximum ${options.maxRequests} requests per ${windowSeconds} seconds.`,
          retryAfter: windowSeconds
        }, 429);
      }

      // Increment counter using Redis pipeline for atomicity
      const pipeline = redis.multi();
      pipeline.incr(key);
      pipeline.expire(key, windowSeconds);
      await pipeline.exec();

      await next();

      // If skipSuccessfulRequests is true, decrement count on success
      if (options.skipSuccessfulRequests && c.res.status < 400) {
        await redis.decr(key);
      }

    } catch (error) {
      logger.error('Rate limiting middleware error:', error);
      // Fail open - don't block requests if Redis is down
      await next();
    }
  };
};

/**
 * API key authentication middleware for external API access
 */
export const apiKeyAuthMiddleware = async (c: Context, next: Next) => {
  try {
    const apiKey = c.req.header('X-API-Key');

    // Skip API key auth for health checks and public endpoints
    const publicPaths = ['/health', '/api/v1/search/public'];
    const isPublicPath = publicPaths.some(path => c.req.path.startsWith(path));

    if (isPublicPath) {
      await next();
      return;
    }

    if (!apiKey) {
      return c.json({
        success: false,
        error: 'API key required',
        message: 'Please provide an API key in the X-API-Key header'
      }, 401);
    }

    // Validate API key (in production, this would check against a database)
    const validApiKeys = process.env.VALID_API_KEYS?.split(',') || [];
    if (validApiKeys.length === 0 || !validApiKeys.includes(apiKey)) {
      logger.warn('Invalid API key attempt', {
        ip: getClientIP(c),
        path: c.req.path,
        apiKey: apiKey.substring(0, 8) + '...'
      });

      return c.json({
        success: false,
        error: 'Invalid API key',
        message: 'The provided API key is invalid or expired'
      }, 401);
    }

    // Add API key info to context
    c.set('apiKey', apiKey);
    c.set('apiAccessType', 'external');

    await next();
  } catch (error) {
    logger.error('API key auth middleware error:', error);
    return c.json({
      success: false,
      error: 'Authentication failed',
      message: 'Unable to verify API key'
    }, 500);
  }
};

/**
 * Request size limiting middleware
 */
export const requestSizeLimitMiddleware = (maxSizeBytes: number = 10 * 1024 * 1024) => { // 10MB default
  return async (c: Context, next: Next) => {
    try {
      const contentLength = c.req.header('Content-Length');

      if (contentLength && parseInt(contentLength) > maxSizeBytes) {
        return c.json({
          success: false,
          error: 'Request too large',
          message: `Request size exceeds maximum allowed size of ${maxSizeBytes} bytes`
        }, 413);
      }

      await next();
    } catch (error) {
      logger.error('Request size limit middleware error:', error);
      await next();
    }
  };
};

/**
 * Request logging middleware for security monitoring
 */
export const securityLoggingMiddleware = async (c: Context, next: Next) => {
  const config = getMonitoringConfig();

  if (!config.enabled) {
    await next();
    return;
  }

  const startTime = Date.now();
  const requestId = c.get('requestId');
  const clientIP = getClientIP(c);
  const userAgent = c.req.header('User-Agent') || 'Unknown';
  const logData: any = {
    requestId,
    method: c.req.method,
    path: c.req.path,
    ip: clientIP,
    userAgent,
    timestamp: new Date().toISOString()
  };

  // Add optional logging data based on configuration
  if (config.logHeaders) {
    logData.headers = {
      contentType: c.req.header('Content-Type'),
      contentLength: c.req.header('Content-Length'),
      authorization: c.req.header('Authorization') ? '[REDACTED]' : undefined,
      apiKey: c.req.header('X-API-Key') ? '[REDACTED]' : undefined,
    };
  }

  if (config.logBody && c.req.method !== 'GET') {
    try {
      const body = await c.req.text();
      logData.bodySize = body.length;
      // Don't log sensitive data, even in development
      if (!body.includes('password') && !body.includes('token') && body.length < 1000) {
        logData.body = body.substring(0, 200) + (body.length > 200 ? '...' : '');
      }
    } catch (error) {
      // Body parsing failed, skip body logging
    }
  }

  // Log request start
  logger[config.logLevel]('API Request', logData);

  try {
    await next();

    const duration = Date.now() - startTime;
    const statusCode = c.res.status;
    const responseLogData: any = {
      requestId,
      statusCode,
      duration,
      success: statusCode < 400
    };

    if (config.logResponses) {
      responseLogData.responseSize = c.res.headers.get('Content-Length');
    }

    // Log request completion
    logger[config.logLevel]('API Response', responseLogData);

    // Log suspicious activity
    if (statusCode >= 400) {
      logger.warn('API Request Error', {
        requestId,
        method: c.req.method,
        path: c.req.path,
        ip: clientIP,
        statusCode,
        duration,
        userAgent: userAgent.substring(0, 100) // Truncate for security
      });
    }

    // Log slow requests
    if (duration > 1000) { // > 1 second
      logger.warn('Slow API Request', {
        requestId,
        method: c.req.method,
        path: c.req.path,
        duration,
        statusCode
      });
    }

  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('API Request Exception', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      ip: clientIP,
      duration,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    throw error;
  }
};

/**
 * Helper function to get client IP address
 */
function getClientIP(c: Context): string {
  return c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
         c.req.header('X-Real-IP') ||
         c.req.header('CF-Connecting-IP') || // Cloudflare
         c.req.header('X-Client-IP') ||
         'unknown';
}

/**
 * Comprehensive security middleware bundle
 */
export const securityMiddleware = [
  cors(getCorsMiddlewareConfig()),
  securityHeadersMiddleware,
  securityLoggingMiddleware,
  requestSizeLimitMiddleware(10 * 1024 * 1024), // 10MB
];

/**
 * API rate limiting configurations
 */
export const apiRateLimits = {
  // General API rate limiting
  general: rateLimitMiddleware({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 1000, // 1000 requests per 15 minutes
  }),

  // Authentication endpoints - stricter rate limiting
  auth: rateLimitMiddleware({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10, // 10 requests per 15 minutes
    keyGenerator: (c: Context) => `auth:${getClientIP(c)}`
  }),

  // Search endpoints - moderate rate limiting
  search: rateLimitMiddleware({
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 60, // 60 requests per minute
    keyGenerator: (c: Context) => `search:${getClientIP(c)}`
  }),

  // Price tracking endpoints - strict rate limiting
  priceTracking: rateLimitMiddleware({
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 30, // 30 requests per minute
    keyGenerator: (c: Context) => `price:${getClientIP(c)}`
  })
};

export default {
  securityMiddleware,
  apiRateLimits,
  securityHeadersMiddleware,
  rateLimitMiddleware,
  apiKeyAuthMiddleware,
  requestSizeLimitMiddleware,
  securityLoggingMiddleware
};