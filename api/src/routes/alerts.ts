/**
 * Alert Routes
 *
 * Handles user alerts, notifications, and alert management.
 * Integrates with multiple notification channels and supports alert automation.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AlertService } from '../services/alert_service';

// Initialize Hono app for alert routes
const alerts = new Hono();

// Validation schemas
const CreateAlertSchema = z.object({
  userId: z.string().uuid('User ID is required'),
  productId: z.string().uuid('Product ID is required'),
  type: z.enum(['price_drop', 'historical_low', 'stock_available', 'back_in_stock', 'price_target']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).default(['push']),
  conditions: z.object({
    targetPrice: z.number().positive().optional(),
    percentageDrop: z.number().nonnegative().max(100).optional(),
    historicalLow: z.boolean().default(false),
    platforms: z.array(z.string()).optional(),
    minRating: z.number().min(1).max(5).optional(),
    stockStatus: z.enum(['in_stock', 'out_of_stock', 'back_in_stock']).optional(),
    minSavings: z.number().nonnegative().optional(),
  }),
  schedule: z.object({
    active: z.boolean().default(true),
    quietHours: z.object({
      start: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
      end: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    }).optional(),
    maxAlertsPerDay: z.number().positive().default(10),
    cooldownMinutes: z.number().nonnegative().default(60),
  }).optional(),
  expiresAt: z.string().datetime().optional(),
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(1000).optional(),
});

const GetAlertsSchema = z.object({
  userId: z.string().uuid('User ID is required'),
  status: z.enum(['pending', 'sent', 'delivered', 'failed', 'cancelled', 'active', 'expired', 'all']).default('active'),
  type: z.enum(['price_drop', 'historical_low', 'stock_available', 'back_in_stock', 'price_target', 'all']).default('all'),
  priority: z.enum(['low', 'medium', 'high', 'urgent', 'all']).default('all'),
  productId: z.string().uuid().optional(),
  platform: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['created', 'updated', 'priority', 'type']).default('created'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const UpdateAlertSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).optional(),
  conditions: z.object({
    targetPrice: z.number().positive().optional(),
    percentageDrop: z.number().nonnegative().max(100).optional(),
    historicalLow: z.boolean().optional(),
    platforms: z.array(z.string()).optional(),
    minRating: z.number().min(1).max(5).optional(),
    stockStatus: z.enum(['in_stock', 'out_of_stock', 'back_in_stock']).optional(),
    minSavings: z.number().nonnegative().optional(),
  }).optional(),
  schedule: z.object({
    active: z.boolean().optional(),
    quietHours: z.object({
      start: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
      end: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    }).optional(),
    maxAlertsPerDay: z.number().positive().optional(),
    cooldownMinutes: z.number().nonnegative().optional(),
  }).optional(),
  expiresAt: z.string().datetime().optional(),
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(1000).optional(),
  active: z.boolean().optional(),
});

const VoteOnAlertSchema = z.object({
  userId: z.string().uuid('User ID is required'),
  value: z.enum(['up', 'down']),
});

const TestAlertSchema = z.object({
  alertId: z.string().uuid('Alert ID is required'),
  channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).default(['push']),
  force: z.boolean().default(false),
});

const GetAlertHistorySchema = z.object({
  alertId: z.string().uuid('Alert ID is required'),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
  includeFailed: z.boolean().default(false),
});

const BatchProcessAlertsSchema = z.object({
  alertIds: z.array(z.string().uuid()).min(1).max(100),
  dryRun: z.boolean().default(false),
});

// Initialize services
const alertService = new AlertService();

// Middleware for alert access validation
const requireAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  const userId = c.req.header('X-User-ID');

  if (!authHeader && !userId) {
    return c.json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required'
    }, 401);
  }

  // In real implementation, verify JWT token or validate user ID
  c.set('userId', userId);
  await next();
};

// POST /alerts - Create new alert
alerts.post('/', requireAuth, zValidator('json', CreateAlertSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // Ensure user can only create alerts for themselves
    if (body.userId !== userId) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot create alerts for other users'
      }, 403);
    }

    // Create alert
    const alert = await alertService.createAlert({
      userId: body.userId,
      productId: body.productId,
      type: body.type,
      priority: body.priority,
      channels: body.channels,
      conditions: body.conditions,
      schedule: body.schedule,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });

    // Set custom title and message if provided
    if (body.title || body.message) {
      await alertService.updateAlert(alert.id, {
        title: body.title,
        message: body.message,
      });
    }

    return c.json({
      success: true,
      message: 'Alert created successfully',
      data: alert
    }, 201);

  } catch (error: any) {
    console.error('Create alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to create alert',
      message: error.message || 'An error occurred while creating alert'
    }, 500);
  }
});

// GET /alerts - Get user alerts
alerts.get('/', requireAuth, zValidator('query', GetAlertsSchema), async (c) => {
  try {
    const query = c.req.valid('query');

    // Get user alerts
    const alerts = await alertService.getUserAlerts({
      userId: query.userId,
      status: query.status === 'all' ? undefined : query.status,
      type: query.type === 'all' ? undefined : query.type,
      priority: query.priority === 'all' ? undefined : query.priority,
      productId: query.productId,
      page: query.page,
      limit: query.limit,
    });

    // Apply additional filtering
    let filteredAlerts = alerts.alerts;

    if (query.platform) {
      filteredAlerts = filteredAlerts.filter(alert =>
        alert.alertData?.platforms?.includes(query.platform) ||
        alert.alertData?.platforms?.includes('all')
      );
    }

    if (query.startDate) {
      const startDate = new Date(query.startDate);
      filteredAlerts = filteredAlerts.filter(alert =>
        new Date(alert.createdAt) >= startDate
      );
    }

    if (query.endDate) {
      const endDate = new Date(query.endDate);
      filteredAlerts = filteredAlerts.filter(alert =>
        new Date(alert.createdAt) <= endDate
      );
    }

    // Apply sorting
    filteredAlerts.sort((a, b) => {
      const aValue = a[query.sortBy as keyof typeof a];
      const bValue = b[query.sortBy as keyof typeof b];
      const comparison = aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      return query.sortOrder === 'desc' ? -comparison : comparison;
    });

    // Apply pagination
    const startIndex = (query.page - 1) * query.limit;
    const paginatedAlerts = filteredAlerts.slice(startIndex, startIndex + query.limit);

    return c.json({
      success: true,
      data: {
        alerts: paginatedAlerts,
        pagination: {
          currentPage: query.page,
          totalPages: Math.ceil(filteredAlerts.length / query.limit),
          totalResults: filteredAlerts.length,
          hasNext: startIndex + query.limit < filteredAlerts.length,
          hasPrev: query.page > 1,
          limit: query.limit,
        },
        filters: {
          status: query.status,
          type: query.type,
          priority: query.priority,
          productId: query.productId,
          platform: query.platform,
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
          startDate: query.startDate,
          endDate: query.endDate,
        },
      }
    });

  } catch (error: any) {
    console.error('Get alerts error:', error);
    return c.json({
      success: false,
      error: 'Failed to get alerts',
      message: error.message || 'An error occurred while fetching alerts'
    }, 500);
  }
});

// GET /alerts/:alertId - Get specific alert
alerts.get('/:alertId', requireAuth, async (c) => {
  try {
    const alertId = c.req.param('alertId');
    const userId = c.get('userId');

    if (!isValidUUID(alertId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid alert ID format'
      }, 400);
    }

    // Get alert
    const alert = await alertService.getAlert(alertId);

    if (!alert) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Alert not found'
      }, 404);
    }

    // Check if user owns this alert
    if (alert.userId !== userId) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Access denied'
      }, 403);
    }

    return c.json({
      success: true,
      data: alert
    });

  } catch (error: any) {
    console.error('Get alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to get alert',
      message: error.message || 'An error occurred while fetching alert'
    }, 500);
  }
});

// PUT /alerts/:alertId - Update alert
alerts.put('/:alertId', requireAuth, zValidator('json', UpdateAlertSchema), async (c) => {
  try {
    const alertId = c.req.param('alertId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (!isValidUUID(alertId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid alert ID format'
      }, 400);
    }

    // Get existing alert to verify ownership
    const existingAlert = await alertService.getAlert(alertId);
    if (!existingAlert) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Alert not found'
      }, 404);
    }

    if (existingAlert.userId !== userId) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot modify alerts for other users'
      }, 403);
    }

    // Update alert
    const updatedAlert = await alertService.updateAlert(alertId, body);

    if (!updatedAlert) {
      return c.json({
        success: false,
        error: 'Update failed',
        message: 'Failed to update alert'
      }, 500);
    }

    return c.json({
      success: true,
      message: 'Alert updated successfully',
      data: updatedAlert
    });

  } catch (error: any) {
    console.error('Update alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to update alert',
      message: error.message || 'An error occurred while updating alert'
    }, 500);
  }
});

// DELETE /alerts/:alertId - Delete alert
alerts.delete('/:alertId', requireAuth, async (c) => {
  try {
    const alertId = c.req.param('alertId');
    const userId = c.get('userId');

    if (!isValidUUID(alertId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid alert ID format'
      }, 400);
    }

    // Get existing alert to verify ownership
    const existingAlert = await alertService.getAlert(alertId);
    if (!existingAlert) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Alert not found'
      }, 404);
    }

    if (existingAlert.userId !== userId) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot delete alerts for other users'
      }, 403);
    }

    // Delete alert
    const success = await alertService.deleteAlert(alertId);

    if (!success) {
      return c.json({
        success: false,
        error: 'Delete failed',
        message: 'Failed to delete alert'
      }, 500);
    }

    return c.json({
      success: true,
      message: 'Alert deleted successfully'
    });

  } catch (error: any) {
    console.error('Delete alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to delete alert',
      message: error.message || 'An error occurred while deleting alert'
    }, 500);
  }
});

// POST /alerts/:alertId/vote - Vote on alert (community feature)
alerts.post('/:alertId/vote', requireAuth, zValidator('json', VoteOnAlertSchema), async (c) => {
  try {
    const alertId = c.req.param('alertId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (!isValidUUID(alertId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid alert ID format'
      }, 400);
    }

    // Vote on alert
    const result = await voteOnAlert(alertId, {
      userId,
      value: body.value,
    });

    if (!result.success) {
      return c.json({
        success: false,
        error: result.error || 'Vote failed',
        message: result.message || 'Failed to vote on alert'
      }, 400);
    }

    return c.json({
      success: true,
      message: 'Vote recorded successfully',
      data: {
        alertId,
        userVote: result.userVote,
        newScore: result.newScore,
      }
    });

  } catch (error: any) {
    console.error('Vote on alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to vote on alert',
      message: error.message || 'An error occurred while voting on alert'
    }, 500);
  }
});

// GET /alerts/:alertId/history - Get alert history
alerts.get('/:alertId/history', requireAuth, zValidator('query', GetAlertHistorySchema), async (c) => {
  try {
    const alertId = c.req.param('alertId');
    const userId = c.get('userId');
    const query = c.req.valid('query');

    if (!isValidUUID(alertId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid alert ID format'
      }, 400);
    }

    // Get alert history
    const history = await getAlertHistory(alertId, {
      page: query.page,
      limit: query.limit,
      includeFailed: query.includeFailed,
    });

    return c.json({
      success: true,
      data: history
    });

  } catch (error: any) {
    console.error('Get alert history error:', error);
    return c.json({
      success: false,
      error: 'Failed to get alert history',
      message: error.message || 'An error occurred while fetching alert history'
    }, 500);
  }
});

// POST /alerts/:alertId/test - Test alert delivery
alerts.post('/:alertId/test', requireAuth, zValidator('json', TestAlertSchema), async (c) => {
  try {
    const alertId = c.req.param('alertId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (!isValidUUID(alertId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid alert ID format'
      }, 400);
    }

    // Get alert to verify ownership
    const alert = await alertService.getAlert(alertId);
    if (!alert) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Alert not found'
      }, 404);
    }

    if (alert.userId !== userId) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot test alerts for other users'
      }, 403);
    }

    // Test alert delivery
    const results = await testAlertDelivery(alertId, {
      channels: body.channels,
      force: body.force,
    });

    return c.json({
      success: true,
      message: 'Alert test completed',
      data: {
        alertId,
        results,
        summary: {
          totalDeliveries: results.length,
          successfulDeliveries: results.filter(r => r.success).length,
          failedDeliveries: results.filter(r => !r.success).length,
        },
      }
    });

  } catch (error: any) {
    console.error('Test alert error:', error);
    return c.json({
      success: false,
      error: 'Failed to test alert',
      message: error.message || 'An error occurred while testing alert'
    }, 500);
  }
});

// POST /alerts/batch-process - Process multiple alerts
alerts.post('/batch-process', requireAuth, zValidator('json', BatchProcessAlertsSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // Verify user owns all alerts
    const userAlerts = await alertService.getUserAlerts({
      userId,
      limit: 1000, // Get all user alerts
    });

    const userAlertIds = new Set(userAlerts.alerts.map(alert => alert.id));
    const unauthorizedAlerts = body.alertIds.filter(id => !userAlertIds.has(id));

    if (unauthorizedAlerts.length > 0) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot process alerts for other users',
        unauthorizedAlerts,
      }, 403);
    }

    // Process alerts in batch
    const results = body.dryRun
      ? await simulateBatchProcessing(body.alertIds)
      : await alertService.processBatchAlerts(body.alertIds);

    return c.json({
      success: true,
      message: body.dryRun ? 'Batch processing simulated' : 'Batch processing completed',
      data: {
        alertIds: body.alertIds,
        results,
        summary: {
          totalAlerts: body.alertIds.length,
          successfulDeliveries: results.filter(r => r.success).length,
          failedDeliveries: results.filter(r => !r.success).length,
          dryRun: body.dryRun,
        },
      }
    });

  } catch (error: any) {
    console.error('Batch process alerts error:', error);
    return c.json({
      success: false,
      error: 'Batch processing failed',
      message: error.message || 'An error occurred during batch processing'
    }, 500);
  }
});

// GET /alerts/statistics - Get alert statistics
alerts.get('/statistics', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const period = c.req.query('period') || '7d';

    // Get alert statistics
    const statistics = await alertService.getAlertStatistics(userId);

    return c.json({
      success: true,
      data: {
        statistics,
        period,
        generatedAt: new Date().toISOString(),
      }
    });

  } catch (error: any) {
    console.error('Get alert statistics error:', error);
    return c.json({
      success: false,
      error: 'Failed to get alert statistics',
      message: error.message || 'An error occurred while fetching alert statistics'
    }, 500);
  }
});

// PUT /alerts/preferences - Update notification preferences
alerts.put('/preferences', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json();

    const UpdatePreferencesSchema = z.object({
      channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).optional(),
      quietHours: z.object({
        start: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
        end: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
      }).optional(),
      maxAlertsPerDay: z.number().positive().optional(),
      categories: z.array(z.string()).optional(),
    });

    const validatedBody = UpdatePreferencesSchema.parse(body);

    // Update notification preferences
    await alertService.updateUserNotificationPreferences(userId, validatedBody);

    return c.json({
      success: true,
      message: 'Notification preferences updated successfully',
      data: validatedBody
    });

  } catch (error: any) {
    console.error('Update preferences error:', error);
    return c.json({
      success: false,
      error: 'Failed to update preferences',
      message: error.message || 'An error occurred while updating preferences'
    }, 500);
  }
});

// GET /alerts/preferences - Get notification preferences
alerts.get('/preferences', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');

    // Get notification preferences
    const preferences = await alertService.getUserNotificationPreferences(userId);

    return c.json({
      success: true,
      data: preferences
    });

  } catch (error: any) {
    console.error('Get preferences error:', error);
    return c.json({
      success: false,
      error: 'Failed to get preferences',
      message: error.message || 'An error occurred while fetching preferences'
    }, 500);
  }
});

// Helper functions (mock implementations)
async function voteOnAlert(alertId: string, options: any) {
  // Mock implementation
  return {
    success: true,
    userVote: options.value,
    newScore: Math.floor(Math.random() * 100),
  };
}

async function getAlertHistory(alertId: string, options: any) {
  // Mock implementation
  return {
    history: [],
    pagination: {
      currentPage: options.page,
      totalPages: 0,
      totalResults: 0,
    },
  };
}

async function testAlertDelivery(alertId: string, options: any) {
  // Mock implementation
  return options.channels.map(channel => ({
    alertId,
    channel,
    success: Math.random() > 0.2, // 80% success rate
    deliveredAt: new Date(),
    error: Math.random() > 0.8 ? 'Simulated delivery error' : undefined,
  }));
}

async function simulateBatchProcessing(alertIds: string[]) {
  // Mock implementation for dry run
  return alertIds.map(alertId => ({
    alertId,
    success: true,
    channel: 'push',
    deliveredAt: new Date(),
  }));
}

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export default alerts;