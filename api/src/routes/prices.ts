/**
 * Price Routes
 *
 * Handles price history, statistics, tracking, and price comparison.
 * Integrates with multiple e-commerce platforms for comprehensive price data.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { PriceService } from '../services/price_service';

// Initialize Hono app for price routes
const prices = new Hono();

// Validation schemas
const GetPriceHistorySchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  platform: z.enum(['amazon', 'rakuten', 'yahoo', 'kakaku', 'mercari', 'all']).default('all'),
  days: z.number().int().positive().max(365).default(90),
  currency: z.string().length(3).default('JPY'),
  includeStatistics: z.string().transform(val => val === 'true').default(true),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
});

const GetPriceStatisticsSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  platforms: z.string().optional()
    .transform(val => val ? val.split(',').map(p => p.trim()) : undefined),
  periodDays: z.number().int().positive().max(365).default(30),
  currency: z.string().length(3).default('JPY'),
  includeHistoricalLow: z.string().transform(val => val === 'true').default(true),
  includeForecast: z.string().transform(val => val === 'true').default(false),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
});

const GetPriceComparisonSchema = z.object({
  productIds: z.string().min(1, 'Product IDs required')
    .transform(val => val.split(',').map(id => id.trim())),
  platforms: z.string().optional()
    .transform(val => val ? val.split(',').map(p => p.trim()) : undefined),
  condition: z.enum(['new', 'used', 'refurbished', 'any']).default('any'),
  includeShipping: z.string().transform(val => val === 'true').default(true),
  currency: z.string().length(3).default('JPY'),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
});

const TrackProductPricesSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  platforms: z.array(z.string()).default(['amazon', 'rakuten', 'yahoo']),
  frequency: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
  alertThreshold: z.number().nonnegative().default(5), // percentage
  notifyOnChanges: z.boolean().default(true),
  userId: z.string().uuid().optional(),
});

const CreatePriceAlertSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  userId: z.string().uuid('User ID is required'),
  type: z.enum(['price_drop', 'historical_low', 'price_target', 'percentage_drop']),
  targetPrice: z.number().positive().optional(),
  percentageDrop: z.number().nonnegative().max(100).optional(),
  platforms: z.array(z.string()).default(['amazon', 'rakuten', 'yahoo']),
  condition: z.enum(['new', 'used', 'refurbished', 'any']).default('any'),
  active: z.boolean().default(true),
  expiresAt: z.string().datetime().optional(),
  channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).default(['push']),
});

const GetPriceAlertsSchema = z.object({
  userId: z.string().uuid('User ID is required'),
  status: z.enum(['active', 'triggered', 'expired', 'all']).default('active'),
  type: z.enum(['price_drop', 'historical_low', 'price_target', 'percentage_drop', 'all']).default('all'),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

const UpdatePriceAlertSchema = z.object({
  targetPrice: z.number().positive().optional(),
  percentageDrop: z.number().nonnegative().max(100).optional(),
  platforms: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
  channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).optional(),
});

// Initialize services
const priceService = new PriceService();

// Middleware for price access validation
const validatePriceAccess = async (c: any, next: any) => {
  const productId = c.req.param('productId') || c.req.param('id') || c.req.query('productId');

  if (productId && !isValidUUID(productId)) {
    return c.json({
      success: false,
      error: 'Bad request',
      message: 'Invalid product ID format'
    }, 400);
  }

  await next();
};

// GET /prices/:productId/history - Get price history for a product
prices.get('/:productId/history', validatePriceAccess, zValidator('query', GetPriceHistorySchema), async (c) => {
  try {
    const productId = c.req.param('productId');
    const query = c.req.valid('query');

    // Get price history
    const history = await priceService.getPriceHistory(productId, {
      platforms: query.platform === 'all' ? undefined : [query.platform],
      days: query.days,
      currency: query.currency,
    });

    let statistics = null;
    if (query.includeStatistics) {
      statistics = await priceService.calculatePriceStatistics(productId, {
        productId,
        platforms: query.platform === 'all' ? undefined : [query.platform],
        periodDays: query.days,
        currency: query.currency,
      });
    }

    return c.json({
      success: true,
      data: {
        productId,
        history: history,
        statistics,
        metadata: {
          platform: query.platform,
          days: query.days,
          currency: query.currency,
          totalRecords: history.length,
          generatedAt: new Date().toISOString(),
        },
      }
    });

  } catch (error: any) {
    console.error('Get price history error:', error);
    return c.json({
      success: false,
      error: 'Failed to get price history',
      message: error.message || 'An error occurred while fetching price history'
    }, 500);
  }
});

// GET /prices/:productId/statistics - Get price statistics for a product
prices.get('/:productId/statistics', validatePriceAccess, zValidator('query', GetPriceStatisticsSchema), async (c) => {
  try {
    const productId = c.req.param('productId');
    const query = c.req.valid('query');

    // Get price statistics
    const statistics = await priceService.calculatePriceStatistics(productId, {
      productId,
      platforms: query.platforms,
      periodDays: query.periodDays,
      currency: query.currency,
    });

    if (!statistics) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'No price data available for this product'
      }, 404);
    }

    let historicalLow = null;
    if (query.includeHistoricalLow) {
      historicalLow = await priceService.findHistoricalLow(productId, {
        platforms: query.platforms,
        days: Math.max(query.periodDays, 90), // At least 90 days for historical low
      });
    }

    let forecast = null;
    if (query.includeForecast) {
      forecast = await generatePriceForecast(productId, {
        platforms: query.platforms,
        periodDays: query.periodDays,
      });
    }

    return c.json({
      success: true,
      data: {
        productId,
        statistics,
        historicalLow,
        forecast,
        metadata: {
          platforms: query.platforms,
          periodDays: query.periodDays,
          currency: query.currency,
          generatedAt: new Date().toISOString(),
        },
      }
    });

  } catch (error: any) {
    console.error('Get price statistics error:', error);
    return c.json({
      success: false,
      error: 'Failed to get price statistics',
      message: error.message || 'An error occurred while fetching price statistics'
    }, 500);
  }
});

// GET /prices/compare - Compare prices across products
prices.get('/compare', zValidator('query', GetPriceComparisonSchema), async (c) => {
  try {
    const query = c.req.valid('query');

    if (query.productIds.length === 0 || query.productIds.length > 10) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Please provide 1-10 product IDs for comparison'
      }, 400);
    }

    // Compare prices for multiple products
    const comparisons = await Promise.all(
      query.productIds.map(productId =>
        priceService.comparePrices({
          productId,
          platforms: query.platforms,
          condition: query.condition,
          includeShipping: query.includeShipping,
          currency: query.currency,
        })
      )
    );

    return c.json({
      success: true,
      data: {
        comparisons,
        summary: generateComparisonSummary(comparisons),
        filters: {
          condition: query.condition,
          includeShipping: query.includeShipping,
          platforms: query.platforms,
          currency: query.currency,
        },
        metadata: {
          totalProducts: query.productIds.length,
          generatedAt: new Date().toISOString(),
        },
      }
    });

  } catch (error: any) {
    console.error('Compare prices error:', error);
    return c.json({
      success: false,
      error: 'Price comparison failed',
      message: error.message || 'An error occurred while comparing prices'
    }, 500);
  }
});

// POST /prices/track - Track product prices
prices.post('/track', zValidator('json', TrackProductPricesSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    // Track product prices
    const results = await priceService.trackProductPrices(body.productId, {
      platforms: body.platforms,
      force: false,
    });

    // Set up scheduled tracking if frequency is specified
    if (body.frequency && body.frequency !== 'daily') {
      await priceService.scheduleAlertCheck(body.productId, getFrequencyMs(body.frequency));
    }

    return c.json({
      success: true,
      message: 'Price tracking started',
      data: {
        productId: body.productId,
        results,
        configuration: {
          platforms: body.platforms,
          frequency: body.frequency,
          alertThreshold: body.alertThreshold,
          notifyOnChanges: body.notifyOnChanges,
        },
        nextUpdate: new Date(Date.now() + getFrequencyMs(body.frequency)).toISOString(),
      }
    }, 201);

  } catch (error: any) {
    console.error('Track prices error:', error);
    return c.json({
      success: false,
      error: 'Failed to track prices',
      message: error.message || 'An error occurred while tracking prices'
    }, 500);
  }
});

// POST /prices/alerts - Create price alert
prices.post('/alerts', zValidator('json', CreatePriceAlertSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    // Create price alert
    const alertConfig = {
      productId: body.productId,
      userId: body.userId,
      type: body.type,
      targetPrice: body.targetPrice,
      percentageDrop: body.percentageDrop,
      platforms: body.platforms,
      condition: body.condition,
      active: body.active,
      channels: body.channels,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    };

    const alert = await createPriceAlert(alertConfig);

    return c.json({
      success: true,
      message: 'Price alert created successfully',
      data: alert
    }, 201);

  } catch (error: any) {
    console.error('Create price alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to create price alert',
      message: error.message || 'An error occurred while creating price alert'
    }, 500);
  }
});

// GET /prices/alerts - Get user price alerts
prices.get('/alerts', zValidator('query', GetPriceAlertsSchema), async (c) => {
  try {
    const query = c.req.valid('query');

    // Get user price alerts
    const alerts = await getUserPriceAlerts(query.userId, {
      status: query.status,
      type: query.type,
      page: query.page,
      limit: query.limit,
    });

    return c.json({
      success: true,
      data: alerts
    });

  } catch (error: any) {
    console.error('Get price alerts error:', error);
    return c.json({
      success: false,
      error: 'Failed to get price alerts',
      message: error.message || 'An error occurred while fetching price alerts'
    }, 500);
  }
});

// PUT /prices/alerts/:alertId - Update price alert
prices.put('/alerts/:alertId', zValidator('json', UpdatePriceAlertSchema), async (c) => {
  try {
    const alertId = c.req.param('alertId');
    const body = c.req.valid('json');

    if (!isValidUUID(alertId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid alert ID format'
      }, 400);
    }

    // Update price alert
    const updatedAlert = await updatePriceAlert(alertId, body);

    if (!updatedAlert) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Price alert not found'
      }, 404);
    }

    return c.json({
      success: true,
      message: 'Price alert updated successfully',
      data: updatedAlert
    });

  } catch (error: any) {
    console.error('Update price alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to update price alert',
      message: error.message || 'An error occurred while updating price alert'
    }, 500);
  }
});

// DELETE /prices/alerts/:alertId - Delete price alert
prices.delete('/alerts/:alertId', async (c) => {
  try {
    const alertId = c.req.param('alertId');

    if (!isValidUUID(alertId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid alert ID format'
      }, 400);
    }

    // Delete price alert
    const success = await deletePriceAlert(alertId);

    if (!success) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Price alert not found'
      }, 404);
    }

    return c.json({
      success: true,
      message: 'Price alert deleted successfully'
    });

  } catch (error: any) {
    console.error('Delete price alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to delete price alert',
      message: error.message || 'An error occurred while deleting price alert'
    }, 500);
  }
});

// GET /prices/:productId/range - Get price range for a product
prices.get('/:productId/range', validatePriceAccess, async (c) => {
  try {
    const productId = c.req.param('productId');
    const platforms = c.req.query('platforms') ? c.req.query('platforms').split(',') : undefined;
    const days = parseInt(c.req.query('days') || '90');
    const currency = c.req.query('currency') || 'JPY';

    // Get price range
    const range = await priceService.getProductPriceRange(productId, {
      platforms,
      days,
      currency,
    });

    if (!range) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'No price data available for this product'
      }, 404);
    }

    return c.json({
      success: true,
      data: {
        productId,
        range,
        metadata: {
          platforms,
          days,
          currency,
          generatedAt: new Date().toISOString(),
        },
      }
    });

  } catch (error: any) {
    console.error('Get price range error:', error);
    return c.json({
      success: false,
      error: 'Failed to get price range',
      message: error.message || 'An error occurred while fetching price range'
    }, 500);
  }
});

// GET /prices/:productId/best-platform - Get best platform for a product
prices.get('/:productId/best-platform', validatePriceAccess, async (c) => {
  try {
    const productId = c.req.param('productId');
    const criteria = c.req.query('criteria') as 'lowest_price' | 'fastest_shipping' | 'best_rating' || 'lowest_price';
    const platforms = c.req.query('platforms') ? c.req.query('platforms').split(',') : undefined;

    // Get best platform
    const bestPlatform = await priceService.getBestPlatformForProduct(productId, criteria, {
      platforms,
    });

    if (!bestPlatform) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'No platform data available for this product'
      }, 404);
    }

    return c.json({
      success: true,
      data: {
        productId,
        bestPlatform,
        criteria,
        metadata: {
          platforms,
          generatedAt: new Date().toISOString(),
        },
      }
    });

  } catch (error: any) {
    console.error('Get best platform error:', error);
    return c.json({
      success: false,
      error: 'Failed to get best platform',
      message: error.message || 'An error occurred while fetching best platform'
    }, 500);
  }
});

// GET /prices/trends - Get overall price trends
prices.get('/trends', async (c) => {
  try {
    const category = c.req.query('category');
    const platform = c.req.query('platform');
    const days = parseInt(c.req.query('days') || '30');
    const limit = parseInt(c.req.query('limit') || '10');

    // Get price trends
    const trends = await getPriceTrends({
      category,
      platform,
      days,
      limit,
    });

    return c.json({
      success: true,
      data: {
        trends,
        metadata: {
          category,
          platform,
          days,
          limit,
          generatedAt: new Date().toISOString(),
        },
      }
    });

  } catch (error: any) {
    console.error('Get price trends error:', error);
    return c.json({
      success: false,
      error: 'Failed to get price trends',
      message: error.message || 'An error occurred while fetching price trends'
    }, 500);
  }
});

// Helper functions (mock implementations)
async function createPriceAlert(config: any) {
  // Mock implementation
  return {
    id: crypto.randomUUID(),
    ...config,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function getUserPriceAlerts(userId: string, options: any) {
  // Mock implementation
  return {
    alerts: [],
    pagination: {
      currentPage: options.page,
      totalPages: 0,
      totalResults: 0,
    },
  };
}

async function updatePriceAlert(alertId: string, updates: any) {
  // Mock implementation
  return {
    id: alertId,
    ...updates,
    updatedAt: new Date(),
  };
}

async function deletePriceAlert(alertId: string) {
  // Mock implementation
  return true;
}

async function generatePriceForecast(productId: string, options: any) {
  // Mock implementation
  return {
    productId,
    forecast: [],
    confidence: 0.5,
    generatedAt: new Date(),
  };
}

function generateComparisonSummary(comparisons: any[]) {
  // Mock implementation
  return {
    totalProducts: comparisons.length,
    lowestPrice: 0,
    highestPrice: 0,
    averagePrice: 0,
    bestSavings: 0,
  };
}

function getFrequencyMs(frequency: string): number {
  switch (frequency) {
    case 'hourly': return 60 * 60 * 1000;
    case 'daily': return 24 * 60 * 60 * 1000;
    case 'weekly': return 7 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

async function getPriceTrends(options: any) {
  // Mock implementation
  return {
    trends: [],
    summary: {
      totalProducts: 0,
      averagePriceChange: 0,
      biggestDrop: 0,
      biggestIncrease: 0,
    },
  };
}

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export default prices;