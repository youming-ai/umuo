/**
 * Security configuration for Yabaii API
 * Environment-specific security settings and policies
 */

import { z } from 'zod';

/**
 * Security configuration schema
 */
const SecurityConfigSchema = z.object({
  // CORS settings
  cors: z.object({
    allowedOrigins: z.array(z.string()).default([
      'http://localhost:8081',
      'https://yabaii.day',
      'https://www.yabaii.day',
      'https://app.yabaii.day'
    ]),
    allowedMethods: z.array(z.string()).default([
      'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'
    ]),
    allowedHeaders: z.array(z.string()).default([
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
      'X-API-Key',
      'X-Client-Version'
    ]),
    credentials: z.boolean().default(true),
    maxAge: z.number().default(86400), // 24 hours
  }),

  // Rate limiting settings
  rateLimiting: z.object({
    // General API limits
    general: z.object({
      windowMs: z.number().default(15 * 60 * 1000), // 15 minutes
      maxRequests: z.number().default(1000),
    }),

    // Authentication endpoints
    auth: z.object({
      windowMs: z.number().default(15 * 60 * 1000), // 15 minutes
      maxRequests: z.number().default(10),
    }),

    // Search endpoints
    search: z.object({
      windowMs: z.number().default(1 * 60 * 1000), // 1 minute
      maxRequests: z.number().default(60),
    }),

    // Price tracking endpoints
    priceTracking: z.object({
      windowMs: z.number().default(1 * 60 * 1000), // 1 minute
      maxRequests: z.number().default(30),
    }),

    // External API endpoints
    external: z.object({
      windowMs: z.number().default(1 * 60 * 1000), // 1 minute
      maxRequests: z.number().default(100),
    }),
  }),

  // Security headers
  securityHeaders: z.object({
    enabled: z.boolean().default(true),
    contentSecurityPolicy: z.object({
      enabled: z.boolean().default(true),
      policy: z.string().default(
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "font-src 'self'; " +
        "connect-src 'self' https://api.yabaii.day; " +
        "frame-ancestors 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'"
      ),
    }),
    permissionsPolicy: z.object({
      enabled: z.boolean().default(true),
      policy: z.string().default(
        'geolocation=(), ' +
        'microphone=(), ' +
        'camera=(), ' +
        'payment=(), ' +
        'usb=(), ' +
        'magnetometer=(), ' +
        'gyroscope=(), ' +
        'accelerometer=()'
      ),
    }),
  }),

  // Request size limits
  requestLimits: z.object({
    maxRequestSize: z.number().default(10 * 1024 * 1024), // 10MB
    maxFileSize: z.number().default(5 * 1024 * 1024), // 5MB
    maxUrlLength: z.number().default(2048),
  }),

  // API key settings
  apiKeys: z.object({
    enabled: z.boolean().default(true),
    headerName: z.string().default('X-API-Key'),
    validKeys: z.array(z.string()).default([]),
    requireHttps: z.boolean().default(true),
  }),

  // IP-based security
  ipSecurity: z.object({
    enabled: z.boolean().default(false),
    whitelist: z.array(z.string()).default([]),
    blacklist: z.array(z.string()).default([]),
    trustProxy: z.boolean().default(true),
  }),

  // JWT settings
  jwt: z.object({
    algorithm: z.enum(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512']).default('HS256'),
    expiresIn: z.string().default('7d'),
    refreshExpiresIn: z.string().default('30d'),
    issuer: z.string().default('yabaii-api'),
    audience: z.string().default('yabaii-client'),
  }),

  // Monitoring and logging
  monitoring: z.object({
    enabled: z.boolean().default(true),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    logRequests: z.boolean().default(true),
    logResponses: z.boolean().default(false),
    logHeaders: z.boolean().default(false),
    logBody: z.boolean().default(false),
  }),
});

/**
 * Environment-specific security configurations
 */
const getEnvironmentConfig = () => {
  const nodeEnv = process.env.NODE_ENV || 'development';

  const baseConfig = {
    cors: {
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:8081',
        'https://yabaii.day'
      ],
    },
    apiKeys: {
      validKeys: process.env.VALID_API_KEYS?.split(',') || [],
    },
    jwt: {
      algorithm: 'HS256' as const,
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    }
  };

  switch (nodeEnv) {
    case 'production':
      return {
        ...baseConfig,
        cors: {
          ...baseConfig.cors,
          allowedOrigins: [
            'https://yabaii.day',
            'https://www.yabaii.day',
            'https://app.yabaii.day'
          ],
        },
        securityHeaders: {
          enabled: true,
          contentSecurityPolicy: {
            enabled: true,
            policy: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.yabaii.day; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
          },
          permissionsPolicy: {
            enabled: true,
            policy: 'geolocation=(); microphone=(); camera=(); payment=(); usb=(); magnetometer=(); gyroscope=(); accelerometer=()'
          }
        },
        monitoring: {
          enabled: true,
          logLevel: 'warn' as const,
          logRequests: true,
          logResponses: false,
          logHeaders: false,
          logBody: false,
        },
        rateLimiting: {
          general: { windowMs: 15 * 60 * 1000, maxRequests: 1000 },
          auth: { windowMs: 15 * 60 * 1000, maxRequests: 10 },
          search: { windowMs: 1 * 60 * 1000, maxRequests: 60 },
          priceTracking: { windowMs: 1 * 60 * 1000, maxRequests: 30 },
          external: { windowMs: 1 * 60 * 1000, maxRequests: 100 },
        },
        apiKeys: {
          ...baseConfig.apiKeys,
          requireHttps: true,
        },
        ipSecurity: {
          enabled: true,
          trustProxy: true,
          whitelist: [],
          blacklist: [],
        }
      };

    case 'staging':
      return {
        ...baseConfig,
        cors: {
          ...baseConfig.cors,
          allowedOrigins: [
            'https://staging.yabaii.day',
            'https://yabaii-staging.day',
            'http://localhost:8081'
          ],
        },
        securityHeaders: {
          enabled: true,
          contentSecurityPolicy: {
            enabled: true,
            policy: "default-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://staging-api.yabaii.day"
          }
        },
        monitoring: {
          enabled: true,
          logLevel: 'info' as const,
          logRequests: true,
          logResponses: true,
          logHeaders: true,
          logBody: false,
        },
        rateLimiting: {
          general: { windowMs: 15 * 60 * 1000, maxRequests: 2000 },
          auth: { windowMs: 15 * 60 * 1000, maxRequests: 20 },
          search: { windowMs: 1 * 60 * 1000, maxRequests: 120 },
          priceTracking: { windowMs: 1 * 60 * 1000, maxRequests: 60 },
          external: { windowMs: 1 * 60 * 1000, maxRequests: 200 },
        }
      };

    case 'development':
    default:
      return {
        ...baseConfig,
        cors: {
          ...baseConfig.cors,
          allowedOrigins: [
            'http://localhost:3000',
            'http://localhost:8081',
            'http://localhost:19006', // Expo development
            'https://yabaii.day'
          ],
        },
        securityHeaders: {
          enabled: true,
          contentSecurityPolicy: {
            enabled: false, // Disabled in development for easier debugging
          },
          permissionsPolicy: {
            enabled: false,
          }
        },
        monitoring: {
          enabled: true,
          logLevel: 'debug' as const,
          logRequests: true,
          logResponses: true,
          logHeaders: true,
          logBody: true, // Enable body logging in development
        },
        rateLimiting: {
          general: { windowMs: 15 * 60 * 1000, maxRequests: 5000 }, // Higher limits for development
          auth: { windowMs: 15 * 60 * 1000, maxRequests: 100 },
          search: { windowMs: 1 * 60 * 1000, maxRequests: 300 },
          priceTracking: { windowMs: 1 * 60 * 1000, maxRequests: 150 },
          external: { windowMs: 1 * 60 * 1000, maxRequests: 500 },
        },
        apiKeys: {
          ...baseConfig.apiKeys,
          requireHttps: false, // Allow HTTP in development
        }
      };
  }
};

/**
 * Validate and get security configuration
 */
export const getSecurityConfig = () => {
  const config = getEnvironmentConfig();
  return SecurityConfigSchema.parse(config);
};

/**
 * Get CORS configuration for the current environment
 */
export const getCorsConfig = () => {
  const config = getSecurityConfig();
  return {
    origin: config.cors.allowedOrigins,
    allowMethods: config.cors.allowedMethods,
    allowHeaders: config.cors.allowedHeaders,
    credentials: config.cors.credentials,
    maxAge: config.cors.maxAge,
  };
};

/**
 * Get rate limiting configuration for a specific type
 */
export const getRateLimitConfig = (type: keyof typeof config.rateLimiting) => {
  const config = getSecurityConfig();
  return config.rateLimiting[type];
};

/**
 * Get security headers configuration
 */
export const getSecurityHeadersConfig = () => {
  const config = getSecurityConfig();
  return config.securityHeaders;
};

/**
 * Get JWT configuration
 */
export const getJwtConfig = () => {
  const config = getSecurityConfig();
  return config.jwt;
};

/**
 * Get monitoring configuration
 */
export const getMonitoringConfig = () => {
  const config = getSecurityConfig();
  return config.monitoring;
};

/**
 * Validate API key against configuration
 */
export const isValidApiKey = (apiKey: string): boolean => {
  const config = getSecurityConfig();
  return config.apiKeys.enabled && config.apiKeys.validKeys.includes(apiKey);
};

/**
 * Check if request is from allowed origin
 */
export const isAllowedOrigin = (origin: string): boolean => {
  const config = getSecurityConfig();
  return config.cors.allowedOrigins.includes(origin);
};

/**
 * Check if IP is blocked or not whitelisted
 */
export const isIpAllowed = (ip: string): boolean => {
  const config = getSecurityConfig();

  if (!config.ipSecurity.enabled) {
    return true;
  }

  // Check blacklist first
  if (config.ipSecurity.blacklist.includes(ip)) {
    return false;
  }

  // If whitelist is enabled, check if IP is in whitelist
  if (config.ipSecurity.whitelist.length > 0) {
    return config.ipSecurity.whitelist.includes(ip);
  }

  return true;
};

export default {
  getSecurityConfig,
  getCorsConfig,
  getRateLimitConfig,
  getSecurityHeadersConfig,
  getJwtConfig,
  getMonitoringConfig,
  isValidApiKey,
  isAllowedOrigin,
  isIpAllowed,
};