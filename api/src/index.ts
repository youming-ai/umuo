import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from '@/utils/logger';
import { routes } from '@/routes';
import { errorHandler } from '@/middleware/errorHandler';
import { securityMiddleware, apiRateLimits } from '@/middleware/security';
import { initDatabase, testConnection } from '@/config/database';
import { initRedis, testRedisConnection } from '@/config/redis';
import { initializeSentry, updateUserContext, performance } from '@/config/sentry';

const app = new Hono();

// Apply security middleware globally
app.use('*', ...securityMiddleware);

// Apply rate limiting to specific route groups
app.use('/api/v1/auth/*', apiRateLimits.auth);
app.use('/api/v1/search/*', apiRateLimits.search);
app.use('/api/v1/prices/*', apiRateLimits.priceTracking);
app.use('/api/v1/*', apiRateLimits.general);

// Error handling middleware
app.use('/api/v1/*', errorHandler);

// Routes
app.route('/api/v1', routes);

// Health check
app.get('/health', async (c) => {
  try {
    const dbConnected = await testConnection();
    const redisConnected = await testRedisConnection();
    const requestId = c.get('requestId');

    // Import Sentry health check
    const { getSentryMonitoringInfo } = await import('@/config/sentry');
    const sentryInfo = getSentryMonitoringInfo();

    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      requestId,
      services: {
        database: {
          status: dbConnected ? 'healthy' : 'unhealthy',
        },
        redis: {
          status: redisConnected ? 'healthy' : 'unhealthy',
        },
        sentry: {
          status: sentryInfo.enabled ? 'enabled' : 'disabled',
          configured: sentryInfo.health.configured,
          environment: sentryInfo.environment,
          release: sentryInfo.release,
        },
        security: {
          status: 'healthy',
          features: {
            cors: 'enabled',
            rateLimiting: 'enabled',
            securityHeaders: 'enabled',
            requestLogging: 'enabled',
            errorHandling: 'enabled',
          }
        }
      },
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      performance: {
        monitoring: sentryInfo.enabled,
        tracesSampleRate: sentryInfo.tracesSampleRate,
        profilesSampleRate: sentryInfo.profilesSampleRate,
      }
    };

    const overallStatus = dbConnected ? 'ok' : 'error';

    return c.json(healthData, dbConnected ? 200 : 503);
  } catch (error) {
    return c.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      requestId: c.get('requestId'),
    }, 503);
  }
});

// Error handling
app.onError((err, c) => {
  logger.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Performance monitoring middleware for all requests
app.use('*', async (c, next) => {
  const transaction = performance.startTransaction(
    `${c.req.method} ${c.req.path}`,
    'http.server'
  );

  try {
    await next();
    performance.finishTransaction(transaction, {
      code: c.res.status as Sentry.SpanStatus,
    });
  } catch (error) {
    performance.finishTransaction(transaction, {
      code: 'internal_error' as Sentry.SpanStatus,
    });
    throw error;
  }
});

// Initialize services and database connections
async function initializeApp() {
  try {
    // Initialize Sentry first to capture initialization errors
    initializeSentry();

    // Initialize database
    initDatabase();

    // Test database connection
    const isConnected = await testConnection();
    if (!isConnected) {
      logger.error('❌ Database connection failed');
      process.exit(1);
    }

    logger.info('✅ Database connection established');

    // Initialize Redis
    await initRedis();

    // Test Redis connection
    const redisConnected = await testRedisConnection();
    if (!redisConnected) {
      logger.warn('⚠️ Redis connection failed - caching will be disabled');
      // Don't exit if Redis fails, just log a warning
    } else {
      logger.info('✅ Redis connection established');
    }

    const port = process.env.PORT || 3000;

    console.log(`🚀 Yabaii API server starting on port ${port}`);

    return {
      port,
      fetch: serve({
        fetch: app.fetch,
        hostname: '0.0.0.0',
        port,
      }),
    };
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Start the application
initializeApp().then(server => {
  // Server is started, export for testing
  module.exports = server;
}).catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});