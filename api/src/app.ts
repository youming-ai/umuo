/**
 * Main Application Entry Point
 * Integrates all middleware, routes, and external services
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';
import { compress } from 'hono/compress';

// Import middleware
import {
  securityMiddleware,
  apiRateLimits,
  apiKeyAuthMiddleware,
} from '@/middleware/security';
import { errorHandler } from '@/middleware/errorHandler';
import { requestId as customRequestId } from '@/middleware/requestId';

// Import configurations
import { initDatabase } from '@/config/database';
import { initRedis } from '@/config/redis';
import { initializeSentry } from '@/config/sentry';
import { logger } from '@/utils/logger';

// Import routes
import { routes } from '@/routes';

// Import integrations
import { PlatformIntegrationFactory } from '@/integrations/factory';

/**
 * Create Hono application with all middleware and routes
 */
export async function createApp(): Promise<Hono> {
  const app = new Hono();

  // Initialize Sentry first for error tracking
  initializeSentry();

  // Initialize external services
  await initDatabase();
  await initRedis();

  // Initialize platform integrations
  const integrationFactory = PlatformIntegrationFactory.getInstance();

  // Basic middleware (applied to all requests)
  app.use('*', prettyJSON());
  app.use('*', compress());
  app.use('*', customRequestId());
  app.use('*', requestId());

  // Hono logger for basic request logging
  app.use('*', honoLogger((message, ...rest) => {
    logger.info(message, ...rest);
  }));

  // Security headers
  app.use('*', secureHeaders());

  // CORS configuration
  app.use('*', cors({
    origin: ['http://localhost:8081', 'https://yabaii.day', 'https://www.yabaii.day', 'https://app.yabaii.day'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
      'X-API-Key',
      'X-Client-Version',
      'X-Request-ID'
    ],
    exposeHeaders: [
      'Content-Length',
      'Content-Range',
      'X-Total-Count',
      'X-Rate-Limit-Remaining',
      'X-Rate-Limit-Reset',
      'X-Request-ID'
    ],
    credentials: true,
    maxAge: 86400,
  }));

  // Custom security middleware
  app.use('*', ...securityMiddleware);

  // API key authentication for specific routes
  app.use('/api/v1/*', apiKeyAuthMiddleware);

  // Rate limiting by route
  app.use('/api/v1/auth/*', apiRateLimits.auth);
  app.use('/api/v1/search/*', apiRateLimits.search);
  app.use('/api/v1/prices/*', apiRateLimits.priceTracking);
  app.use('/api/v1/*', apiRateLimits.general);

  // Health check endpoint (no authentication required)
  app.get('/health', async (c) => {
    const startTime = Date.now();
    const requestId = c.get('requestId');

    try {
      // Check database health
      const { healthCheck: dbHealth } = await import('@/config/database');
      const dbStatus = await dbHealth();

      // Check Redis health
      const { redisHealthCheck } = await import('@/config/redis');
      const redisStatus = await redisHealthCheck();

      // Check platform integrations health
      const integrationHealth = await integrationFactory.performHealthChecks();

      // Check Sentry health
      const { checkSentryHealth } = await import('@/config/sentry');
      const sentryHealth = checkSentryHealth();

      const responseTime = Date.now() - startTime;

      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        responseTime,
        requestId,
        services: {
          database: dbStatus,
          redis: redisStatus,
          sentry: sentryHealth,
          integrations: Object.fromEntries(integrationHealth),
        },
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100,
        },
      };

      // Determine overall health status
      const hasFailures = [
        dbStatus.status === 'unhealthy',
        redisStatus.status === 'unhealthy',
        ...Array.from(integrationHealth.values()).map(h => h.status !== 'healthy')
      ].some(Boolean);

      if (hasFailures) {
        healthData.status = 'degraded';
        return c.json(healthData, 503);
      }

      return c.json(healthData);
    } catch (error) {
      logger.error('Health check failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - startTime,
      });

      return c.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - startTime,
      }, 503);
    }
  });

  // API info endpoint
  app.get('/api/v1/info', (c) => {
    return c.json({
      name: 'Yabaii API',
      version: process.env.npm_package_version || '1.0.0',
      description: 'Japanese price comparison API',
      environment: process.env.NODE_ENV || 'development',
      integrations: integrationFactory.getAvailablePlatforms(),
      supportedLanguages: ['ja', 'en', 'zh'],
      currency: 'JPY',
      timezone: 'Asia/Tokyo',
    });
  });

  // Metrics endpoint
  app.get('/api/v1/metrics', async (c) => {
    try {
      const integrationMetrics = await integrationFactory.getMetrics();

      return c.json({
        integrations: Object.fromEntries(integrationMetrics),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Metrics endpoint failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return c.json({ error: 'Failed to get metrics' }, 500);
    }
  });

  // Mount API routes
  app.route('/api/v1', routes);

  // Error handling middleware (must be last)
  app.onError(errorHandler);
  app.notFound((c) => {
    return c.json({
      success: false,
      error: 'Endpoint not found',
      path: c.req.path,
      method: c.req.method,
    }, 404);
  });

  logger.info('Application initialized successfully', {
    environment: process.env.NODE_ENV,
    integrations: integrationFactory.getAvailablePlatforms(),
    version: process.env.npm_package_version || '1.0.0',
  });

  return app;
}

/**
 * Graceful shutdown handler
 */
export async function gracefulShutdown(app: Hono): Promise<void> {
  logger.info('Starting graceful shutdown...');

  try {
    // Close database connections
    const { closeDatabase } = await import('@/config/database');
    await closeDatabase();

    // Close Redis connections
    const { closeRedis } = await import('@/config/redis');
    await closeRedis();

    // Clear integration caches
    const factory = PlatformIntegrationFactory.getInstance();
    factory.clearCache();

    logger.info('Graceful shutdown completed');
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Create and export default app instance
 */
export default createApp;