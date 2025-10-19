import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupTestServer, teardownTestServer } from '../utils/test-server';

describe('Alerts API Contract Tests', () => {
  let server: any;
  let userId: string;

  beforeAll(async () => {
    server = await setupTestServer();
    // Create a test user and get auth token
    const registerResponse = await server.inject({
      method: 'POST',
      url: '/api/register',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test-alerts@example.com',
        password: 'Test123456',
        name: 'Test Alerts User',
        language: 'ja',
      }),
    });

    const registerResult = JSON.parse(registerResponse.body);
    userId = registerResult.user.id;
  });

  afterAll(async () => {
    await teardownTestServer(server);
  });

  describe('POST /api/alerts', () => {
    test('should create price drop alert successfully', async () => {
      const alertRequest = {
        type: 'price_drop',
        productId: 'test-product-uuid',
        targetPrice: 2500,
        platforms: ['amazon', 'rakuten'],
        conditions: {
          minPercentageDrop: 10,
          timeWindow: 30, // days
        },
        notificationSettings: {
          channels: ['push', 'email'],
          frequency: 'immediate',
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(201);
      const alert = JSON.parse(response.body);

      // Validate alert structure
      expect(alert).toHaveProperty('id');
      expect(alert).toHaveProperty('userId', userId);
      expect(alert).toHaveProperty('type', 'price_drop');
      expect(alert).toHaveProperty('productId', 'test-product-uuid');
      expect(alert).toHaveProperty('targetPrice', 2500);
      expect(alert).toHaveProperty('platforms', ['amazon', 'rakuten']);
      expect(alert).toHaveProperty('conditions');
      expect(alert).toHaveProperty('notificationSettings');
      expect(alert).toHaveProperty('status', 'active');
      expect(alert).toHaveProperty('createdAt');
      expect(alert).toHaveProperty('updatedAt');

      // Validate conditions
      expect(alert.conditions).toEqual({
        minPercentageDrop: 10,
        timeWindow: 30,
      });

      // Validate notification settings
      expect(alert.notificationSettings).toEqual({
        channels: ['push', 'email'],
        frequency: 'immediate',
      });

      // Verify service was called correctly
      expect(server.alertService.createAlert).toHaveBeenCalledWith(userId, alertRequest);
    });

    test('should create historical low alert successfully', async () => {
      const alertRequest = {
        type: 'historical_low',
        productId: 'test-product-uuid-2',
        platforms: ['amazon'],
        conditions: {
          lookbackPeriod: 90, // days
          minDifferenceFromCurrent: 5, // percentage
        },
        notificationSettings: {
          channels: ['push'],
          frequency: 'immediate',
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(201);
      const alert = JSON.parse(response.body);

      expect(alert.type).toBe('historical_low');
      expect(alert.conditions).toEqual({
        lookbackPeriod: 90,
        minDifferenceFromCurrent: 5,
      });
    });

    test('should create stock alert successfully', async () => {
      const alertRequest = {
        type: 'stock',
        productId: 'test-product-uuid-3',
        platforms: ['amazon', 'yahoo'],
        conditions: {
          stockStatus: 'in_stock', // or 'any'
          notifyOnBackorder: true,
        },
        notificationSettings: {
          channels: ['push', 'email'],
          frequency: 'immediate',
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(201);
      const alert = JSON.parse(response.body);

      expect(alert.type).toBe('stock');
      expect(alert.conditions).toEqual({
        stockStatus: 'in_stock',
        notifyOnBackorder: true,
      });
    });

    test('should create percentage drop alert successfully', async () => {
      const alertRequest = {
        type: 'percentage_drop',
        productId: 'test-product-uuid-4',
        targetPercentage: 15, // 15% drop
        platforms: ['all'],
        conditions: {
          timeWindow: 60, // days
          minPriceDrop: 500, // minimum JPY amount
        },
        notificationSettings: {
          channels: ['email'],
          frequency: 'daily',
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(201);
      const alert = JSON.parse(response.body);

      expect(alert.type).toBe('percentage_drop');
      expect(alert.targetPercentage).toBe(15);
      expect(alert.platforms).toBe('all');
    });

    test('should validate alert creation request body', async () => {
      const invalidRequest = {
        // Missing required fields
        type: 'invalid_type',
        productId: '',
        targetPrice: -100, // Invalid negative price
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(invalidRequest),
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Validation error');
      expect(error).toHaveProperty('message');
    });

    test('should require authentication', async () => {
      const alertRequest = {
        type: 'price_drop',
        productId: 'test-product-uuid',
        targetPrice: 2500,
        platforms: ['amazon'],
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(401);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Unauthorized');
    });

    test('should validate alert types', async () => {
      const alertRequest = {
        type: 'invalid_alert_type',
        productId: 'test-product-uuid',
        targetPrice: 2500,
        platforms: ['amazon'],
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error.message).toContain('type');
    });

    test('should validate platform values', async () => {
      const alertRequest = {
        type: 'price_drop',
        productId: 'test-product-uuid',
        targetPrice: 2500,
        platforms: ['invalid_platform'],
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error.message).toContain('platforms');
    });

    test('should handle maximum alerts per user limit', async () => {
      // Mock user already has maximum alerts
      server.alertService.getUserAlerts = jest.fn().mockResolvedValue(
        Array(50).fill(null).map((_, i) => ({
          id: `alert-${i}`,
          userId: userId,
          status: 'active',
        }))
      );

      const alertRequest = {
        type: 'price_drop',
        productId: 'test-product-uuid',
        targetPrice: 2500,
        platforms: ['amazon'],
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error.message).toContain('maximum number of alerts');
    });

    test('should handle duplicate alert detection', async () => {
      // Mock existing similar alert
      server.alertService.findSimilarAlert = jest.fn().mockResolvedValue({
        id: 'existing-alert-id',
        type: 'price_drop',
        productId: 'test-product-uuid',
        platforms: ['amazon'],
      });

      const alertRequest = {
        type: 'price_drop',
        productId: 'test-product-uuid',
        targetPrice: 2500,
        platforms: ['amazon'],
      };

      const response = await server.inject({
        method: 'POST',
        url: '/api/alerts',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(alertRequest),
      });

      expect(response.statusCode).toBe(409);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Conflict');
      expect(error.message).toContain('similar alert already exists');
    });
  });

  describe('GET /api/alerts', () => {
    test('should get user alerts successfully', async () => {
      const mockAlerts = [
        {
          id: 'alert-1',
          userId: userId,
          type: 'price_drop',
          productId: 'test-product-uuid',
          targetPrice: 2500,
          platforms: ['amazon', 'rakuten'],
          status: 'active',
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T10:00:00Z',
          lastTriggered: null,
          triggerCount: 0,
          product: {
            id: 'test-product-uuid',
            name: 'テスト商品',
            imageUrl: 'https://example.com/image.jpg',
          },
        },
        {
          id: 'alert-2',
          userId: userId,
          type: 'historical_low',
          productId: 'test-product-uuid-2',
          platforms: ['amazon'],
          status: 'triggered',
          createdAt: '2024-01-10T15:30:00Z',
          updatedAt: '2024-01-14T09:15:00Z',
          lastTriggered: '2024-01-14T09:15:00Z',
          triggerCount: 1,
          product: {
            id: 'test-product-uuid-2',
            name: 'テスト商品2',
            imageUrl: 'https://example.com/image2.jpg',
          },
        },
      ];

      server.alertService.getUserAlerts = jest.fn().mockResolvedValue(mockAlerts);

      const response = await server.inject({
        method: 'GET',
        url: '/api/alerts?status=active&limit=20&offset=0',
        headers: {
          'Authorization': `Bearer ${server.authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      // Validate response structure
      expect(result).toHaveProperty('alerts');
      expect(result).toHaveProperty('pagination');
      expect(result).toHaveProperty('summary');

      // Validate alerts array
      expect(result.alerts).toHaveLength(2);
      result.alerts.forEach((alert: any) => {
        expect(alert).toHaveProperty('id');
        expect(alert).toHaveProperty('userId', userId);
        expect(alert).toHaveProperty('type');
        expect(alert).toHaveProperty('productId');
        expect(alert).toHaveProperty('platforms');
        expect(alert).toHaveProperty('status');
        expect(alert).toHaveProperty('createdAt');
        expect(alert).toHaveProperty('updatedAt');
        expect(alert).toHaveProperty('lastTriggered');
        expect(alert).toHaveProperty('triggerCount');
        expect(alert).toHaveProperty('product');

        // Validate product info
        expect(alert.product).toHaveProperty('id');
        expect(alert.product).toHaveProperty('name');
        expect(alert.product).toHaveProperty('imageUrl');

        // Validate alert type
        expect(['price_drop', 'historical_low', 'stock', 'percentage_drop']).toContain(alert.type);

        // Validate status
        expect(['active', 'paused', 'triggered', 'expired']).toContain(alert.status);
      });

      // Validate pagination
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: expect.any(Number),
        hasNext: expect.any(Boolean),
        hasPrev: false,
      });

      // Validate summary
      expect(result.summary).toEqual({
        totalAlerts: expect.any(Number),
        activeAlerts: expect.any(Number),
        triggeredAlerts: expect.any(Number),
        pausedAlerts: expect.any(Number),
      });

      // Verify service was called correctly
      expect(server.alertService.getUserAlerts).toHaveBeenCalledWith(userId, {
        status: 'active',
        limit: 20,
        offset: 0,
      });
    });

    test('should filter alerts by type', async () => {
      const mockPriceDropAlerts = [
        {
          id: 'price-alert-1',
          userId: userId,
          type: 'price_drop',
          productId: 'test-product-uuid',
          status: 'active',
        },
      ];

      server.alertService.getUserAlerts = jest.fn().mockResolvedValue(mockPriceDropAlerts);

      const response = await server.inject({
        method: 'GET',
        url: '/api/alerts?type=price_drop',
        headers: {
          'Authorization': `Bearer ${server.authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].type).toBe('price_drop');
    });

    test('should handle empty alerts list', async () => {
      server.alertService.getUserAlerts = jest.fn().mockResolvedValue([]);

      const response = await server.inject({
        method: 'GET',
        url: '/api/alerts',
        headers: {
          'Authorization': `Bearer ${server.authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      expect(result.alerts).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(result.summary.totalAlerts).toBe(0);
    });
  });

  describe('PUT /api/alerts/{id}', () => {
    test('should update alert successfully', async () => {
      const alertId = 'alert-1';
      const updateRequest = {
        targetPrice: 2200, // Updated from 2500
        platforms: ['amazon'], // Changed from ['amazon', 'rakuten']
        notificationSettings: {
          channels: ['push'], // Changed from ['push', 'email']
          frequency: 'daily', // Changed from 'immediate'
        },
      };

      const mockUpdatedAlert = {
        id: alertId,
        userId: userId,
        type: 'price_drop',
        productId: 'test-product-uuid',
        targetPrice: 2200,
        platforms: ['amazon'],
        status: 'active',
        conditions: {
          minPercentageDrop: 10,
          timeWindow: 30,
        },
        notificationSettings: {
          channels: ['push'],
          frequency: 'daily',
        },
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-16T14:30:00Z',
      };

      server.alertService.updateAlert = jest.fn().mockResolvedValue(mockUpdatedAlert);

      const response = await server.inject({
        method: 'PUT',
        url: `/api/alerts/${alertId}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(updateRequest),
      });

      expect(response.statusCode).toBe(200);
      const alert = JSON.parse(response.body);

      expect(alert.targetPrice).toBe(2200);
      expect(alert.platforms).toEqual(['amazon']);
      expect(alert.notificationSettings.channels).toEqual(['push']);
      expect(alert.notificationSettings.frequency).toBe('daily');
      expect(alert.updatedAt).toBe('2024-01-16T14:30:00Z');

      // Verify service was called correctly
      expect(server.alertService.updateAlert).toHaveBeenCalledWith(alertId, userId, updateRequest);
    });

    test('should pause alert successfully', async () => {
      const alertId = 'alert-1';
      const pauseRequest = {
        status: 'paused',
      };

      const mockPausedAlert = {
        id: alertId,
        userId: userId,
        type: 'price_drop',
        status: 'paused',
        updatedAt: '2024-01-16T15:00:00Z',
      };

      server.alertService.updateAlert = jest.fn().mockResolvedValue(mockPausedAlert);

      const response = await server.inject({
        method: 'PUT',
        url: `/api/alerts/${alertId}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(pauseRequest),
      });

      expect(response.statusCode).toBe(200);
      const alert = JSON.parse(response.body);

      expect(alert.status).toBe('paused');
    });

    test('should return 404 for non-existent alert', async () => {
      const nonExistentId = 'non-existent-alert';

      server.alertService.updateAlert = jest.fn().mockResolvedValue(null);

      const updateRequest = {
        targetPrice: 2200,
      };

      const response = await server.inject({
        method: 'PUT',
        url: `/api/alerts/${nonExistentId}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(updateRequest),
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Not found');
    });

    test('should validate update request body', async () => {
      const alertId = 'alert-1';
      const invalidRequest = {
        targetPrice: -100, // Invalid negative price
        platforms: ['invalid_platform'],
      };

      const response = await server.inject({
        method: 'PUT',
        url: `/api/alerts/${alertId}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${server.authToken}`,
        },
        body: JSON.stringify(invalidRequest),
      });

      expect(response.statusCode).toBe(400);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Validation error');
    });
  });

  describe('DELETE /api/alerts/{id}', () => {
    test('should delete alert successfully', async () => {
      const alertId = 'alert-1';

      server.alertService.deleteAlert = jest.fn().mockResolvedValue(true);

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/alerts/${alertId}`,
        headers: {
          'Authorization': `Bearer ${server.authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      expect(result).toEqual({
        success: true,
        message: 'Alert deleted successfully',
      });

      // Verify service was called correctly
      expect(server.alertService.deleteAlert).toHaveBeenCalledWith(alertId, userId);
    });

    test('should return 404 for non-existent alert', async () => {
      const nonExistentId = 'non-existent-alert';

      server.alertService.deleteAlert = jest.fn().mockResolvedValue(false);

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/alerts/${nonExistentId}`,
        headers: {
          'Authorization': `Bearer ${server.authToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const error = JSON.parse(response.body);
      expect(error).toHaveProperty('error', 'Not found');
    });
  });

  describe('GET /api/alerts/{id}/history', () => {
    test('should get alert trigger history successfully', async () => {
      const alertId = 'alert-1';

      const mockTriggerHistory = [
        {
          id: 'trigger-1',
          alertId: alertId,
          triggeredAt: '2024-01-14T09:15:00Z',
          triggerType: 'price_drop',
          triggerData: {
            originalPrice: 3000,
            newPrice: 2400,
            percentageDrop: 20,
            platform: 'amazon',
          },
          notificationSent: true,
          notificationChannels: ['push', 'email'],
        },
        {
          id: 'trigger-2',
          alertId: alertId,
          triggeredAt: '2024-01-12T14:30:00Z',
          triggerType: 'price_drop',
          triggerData: {
            originalPrice: 2800,
            newPrice: 2520,
            percentageDrop: 10,
            platform: 'rakuten',
          },
          notificationSent: true,
          notificationChannels: ['push'],
        },
      ];

      server.alertService.getAlertHistory = jest.fn().mockResolvedValue(mockTriggerHistory);

      const response = await server.inject({
        method: 'GET',
        url: `/api/alerts/${alertId}/history?limit=10`,
        headers: {
          'Authorization': `Bearer ${server.authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      // Validate response structure
      expect(result).toHaveProperty('alertId', alertId);
      expect(result).toHaveProperty('triggers');
      expect(result).toHaveProperty('summary');

      // Validate triggers array
      expect(result.triggers).toHaveLength(2);
      result.triggers.forEach((trigger: any) => {
        expect(trigger).toHaveProperty('id');
        expect(trigger).toHaveProperty('alertId', alertId);
        expect(trigger).toHaveProperty('triggeredAt');
        expect(trigger).toHaveProperty('triggerType');
        expect(trigger).toHaveProperty('triggerData');
        expect(trigger).toHaveProperty('notificationSent');
        expect(trigger).toHaveProperty('notificationChannels');

        // Validate trigger data
        expect(trigger.triggerData).toHaveProperty('originalPrice');
        expect(trigger.triggerData).toHaveProperty('newPrice');
        expect(trigger.triggerData).toHaveProperty('percentageDrop');
        expect(trigger.triggerData).toHaveProperty('platform');

        // Validate notification data
        expect(typeof trigger.notificationSent).toBe('boolean');
        expect(Array.isArray(trigger.notificationChannels)).toBe(true);
      });

      // Validate summary
      expect(result.summary).toEqual({
        totalTriggers: 2,
        successfulNotifications: 2,
        lastTriggered: '2024-01-14T09:15:00Z',
        mostCommonPlatform: 'amazon',
      });

      // Verify service was called correctly
      expect(server.alertService.getAlertHistory).toHaveBeenCalledWith(alertId, userId, {
        limit: 10,
      });
    });

    test('should handle empty trigger history', async () => {
      const alertId = 'alert-without-triggers';

      server.alertService.getAlertHistory = jest.fn().mockResolvedValue([]);

      const response = await server.inject({
        method: 'GET',
        url: `/api/alerts/${alertId}/history`,
        headers: {
          'Authorization': `Bearer ${server.authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);

      expect(result.triggers).toHaveLength(0);
      expect(result.summary.totalTriggers).toBe(0);
    });
  });
});