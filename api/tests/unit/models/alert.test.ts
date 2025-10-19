/**
 * Alert model validation tests
 * Tests for alert validation and business logic
 */

import { z } from 'zod';
import {
  alertSchema,
  priceAlertConditionSchema,
  stockAlertConditionSchema,
  notificationTemplateSchema,
  notificationPreferencesSchema,
  alertDeliveryResultSchema,
  alertStatisticsSchema,
  AlertModel,
  type Alert,
  type AlertType,
  type PriceAlertCondition,
  type StockAlertCondition,
  type NotificationPreferences,
  type AlertDeliveryResult
} from '../../../src/models/alert';

describe('Alert Model Validation', () => {
  const baseAlert = {
    userId: 'user_123',
    productId: 'prod_123',
    type: 'price_drop' as AlertType,
    priority: 'high' as const,
    status: 'pending' as const,
    title: 'Price Drop Alert',
    message: 'The price of your watched item has dropped!',
    channels: ['push' as const],
    alertData: {
      oldPrice: 12000,
      newPrice: 10000,
      percentageDrop: 16.67
    }
  };

  describe('alertSchema Validation', () => {
    it('should validate a complete alert', () => {
      const validAlert = {
        ...baseAlert,
        id: 'alert_123',
        createdAt: '2024-01-01T00:00:00Z'
      };
      expect(() => alertSchema.parse(validAlert)).not.toThrow();
    });

    it('should reject alert with empty title', () => {
      const invalidAlert = { ...baseAlert, title: '' };
      expect(() => alertSchema.parse(invalidAlert)).toThrow(z.ZodError);
    });

    it('should reject alert with title too long', () => {
      const invalidAlert = { ...baseAlert, title: 'a'.repeat(201) };
      expect(() => alertSchema.parse(invalidAlert)).toThrow(z.ZodError);
    });

    it('should reject alert with invalid type', () => {
      const invalidAlert = { ...baseAlert, type: 'invalid_type' as any };
      expect(() => alertSchema.parse(invalidAlert)).toThrow(z.ZodError);
    });

    it('should accept alert with minimal required fields', () => {
      const minimalAlert = {
        userId: 'user_123',
        productId: 'prod_123',
        type: 'price_drop' as AlertType,
        title: 'Test Alert',
        message: 'Test message',
        id: 'alert_123',
        createdAt: '2024-01-01T00:00:00Z'
      };
      expect(() => alertSchema.parse(minimalAlert)).not.toThrow();
    });

    it('should accept alert with scheduled delivery', () => {
      const alertWithSchedule = {
        ...baseAlert,
        id: 'alert_123',
        createdAt: '2024-01-01T00:00:00Z',
        scheduledAt: '2024-01-02T12:00:00Z'
      };
      expect(() => alertSchema.parse(alertWithSchedule)).not.toThrow();
    });
  });

  describe('priceAlertConditionSchema Validation', () => {
    const validPriceCondition = {
      userId: 'user_123',
      productId: 'prod_123',
      type: 'below_target' as const,
      targetPrice: 10000,
      isActive: true,
      createdAt: '2024-01-01T00:00:00Z'
    };

    it('should validate valid price alert condition', () => {
      expect(() => priceAlertConditionSchema.parse(validPriceCondition)).not.toThrow();
    });

    it('should reject condition with negative target price', () => {
      const invalidCondition = { ...validPriceCondition, targetPrice: -1000 };
      expect(() => priceAlertConditionSchema.parse(invalidCondition)).toThrow(z.ZodError);
    });

    it('should reject condition with invalid type', () => {
      const invalidCondition = { ...validPriceCondition, type: 'invalid_type' as any };
      expect(() => priceAlertConditionSchema.parse(invalidCondition)).toThrow(z.ZodError);
    });

    it('should accept percentage drop condition', () => {
      const percentageCondition = {
        ...validPriceCondition,
        type: 'percentage_drop' as const,
        targetPrice: undefined,
        percentage: 20
      };
      expect(() => priceAlertConditionSchema.parse(percentageCondition)).not.toThrow();
    });

    it('should accept condition with expiration date', () => {
      const conditionWithExpiry = {
        ...validPriceCondition,
        expiresAt: '2024-12-31T23:59:59Z'
      };
      expect(() => priceAlertConditionSchema.parse(conditionWithExpiry)).not.toThrow();
    });
  });

  describe('stockAlertConditionSchema Validation', () => {
    const validStockCondition = {
      userId: 'user_123',
      productId: 'prod_123',
      type: 'back_in_stock' as const,
      isActive: true,
      createdAt: '2024-01-01T00:00:00Z'
    };

    it('should validate valid stock alert condition', () => {
      expect(() => stockAlertConditionSchema.parse(validStockCondition)).not.toThrow();
    });

    it('should accept low stock condition with threshold', () => {
      const lowStockCondition = {
        ...validStockCondition,
        type: 'low_stock' as const,
        threshold: 5
      };
      expect(() => stockAlertConditionSchema.parse(lowStockCondition)).not.toThrow();
    });

    it('should reject condition with negative threshold', () => {
      const invalidCondition = {
        ...validStockCondition,
        type: 'low_stock' as const,
        threshold: -5
      };
      expect(() => stockAlertConditionSchema.parse(invalidCondition)).toThrow(z.ZodError);
    });
  });

  describe('notificationTemplateSchema Validation', () => {
    const validTemplate = {
      type: 'price_drop' as AlertType,
      language: 'ja',
      titleTemplate: '価格が{{percentageDrop}}%下がりました！',
      messageTemplate: '{{productName}}の価格が{{oldPrice}}円から{{newPrice}}円に下がりました。',
      requiredVariables: ['percentageDrop', 'productName', 'oldPrice', 'newPrice'],
      isActive: true,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    };

    it('should validate valid notification template', () => {
      expect(() => notificationTemplateSchema.parse(validTemplate)).not.toThrow();
    });

    it('should accept template with channel-specific content', () => {
      const templateWithChannels = {
        ...validTemplate,
        channelTemplates: {
          push: {
            title: 'Price Drop!',
            message: 'Price dropped by {{percentageDrop}}%',
            actionUrl: 'https://example.com/product/{{productId}}',
            actionText: 'View Product'
          },
          email: {
            title: 'Price Alert: {{productName}}',
            message: 'Full email content here...'
          }
        }
      };
      expect(() => notificationTemplateSchema.parse(templateWithChannels)).not.toThrow();
    });

    it('should reject template with empty title', () => {
      const invalidTemplate = { ...validTemplate, titleTemplate: '' };
      expect(() => notificationTemplateSchema.parse(invalidTemplate)).toThrow(z.ZodError);
    });
  });

  describe('notificationPreferencesSchema Validation', () => {
    const validPreferences = {
      userId: 'user_123',
      enabledChannels: ['push', 'email' as const],
      typePreferences: {
        price_drop: {
          enabled: true,
          priority: 'high' as const,
          quietHours: {
            enabled: true,
            start: '22:00',
            end: '08:00'
          }
        }
      },
      quietHours: {
        enabled: true,
        start: '23:00',
        end: '07:00',
        timezone: 'Asia/Tokyo'
      },
      maxNotificationsPerDay: 50,
      maxNotificationsPerHour: 10,
      updatedAt: '2024-01-01T00:00:00Z'
    };

    it('should validate valid notification preferences', () => {
      expect(() => notificationPreferencesSchema.parse(validPreferences)).not.toThrow();
    });

    it('should accept preferences without quiet hours', () => {
      const preferencesWithoutQuietHours = {
        ...validPreferences,
        quietHours: { enabled: false }
      };
      expect(() => notificationPreferencesSchema.parse(preferencesWithoutQuietHours)).not.toThrow();
    });

    it('should reject preferences with invalid time format', () => {
      const invalidPreferences = {
        ...validPreferences,
        quietHours: {
          ...validPreferences.quietHours,
          start: '25:00' // Invalid time
        }
      };
      expect(() => notificationPreferencesSchema.parse(invalidPreferences)).toThrow(z.ZodError);
    });

    it('should reject preferences with negative limits', () => {
      const invalidPreferences = {
        ...validPreferences,
        maxNotificationsPerDay: -10
      };
      expect(() => notificationPreferencesSchema.parse(invalidPreferences)).toThrow(z.ZodError);
    });
  });

  describe('alertDeliveryResultSchema Validation', () => {
    const validDeliveryResult = {
      alertId: 'alert_123',
      channel: 'push' as const,
      status: 'success' as const,
      messageId: 'msg_123',
      deliveredAt: '2024-01-01T00:01:00Z',
      responseTime: 1500
    };

    it('should validate successful delivery result', () => {
      expect(() => alertDeliveryResultSchema.parse(validDeliveryResult)).not.toThrow();
    });

    it('should validate failed delivery result', () => {
      const failedResult = {
        ...validDeliveryResult,
        status: 'failed' as const,
        error: 'Device token not found',
        messageId: undefined,
        deliveredAt: undefined,
        responseTime: undefined
      };
      expect(() => alertDeliveryResultSchema.parse(failedResult)).not.toThrow();
    });

    it('should reject result with negative response time', () => {
      const invalidResult = { ...validDeliveryResult, responseTime: -100 };
      expect(() => alertDeliveryResultSchema.parse(invalidResult)).toThrow(z.ZodError);
    });
  });

  describe('alertStatisticsSchema Validation', () => {
    const validStatistics = {
      userId: 'user_123',
      period: 'daily' as const,
      totalSent: 100,
      totalDelivered: 95,
      totalFailed: 5,
      byType: {
        price_drop: { sent: 60, delivered: 58, failed: 2 },
        stock_available: { sent: 40, delivered: 37, failed: 3 }
      },
      byChannel: {
        push: { sent: 80, delivered: 78, failed: 2 },
        email: { sent: 20, delivered: 17, failed: 3 }
      },
      averageDeliveryTime: 1200,
      deliveryRate: 0.95,
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-01-01T23:59:59Z',
      generatedAt: '2024-01-01T23:59:59Z'
    };

    it('should validate valid alert statistics', () => {
      expect(() => alertStatisticsSchema.parse(validStatistics)).not.toThrow();
    });

    it('should reject statistics with delivery rate outside 0-1 range', () => {
      const invalidStats = { ...validStatistics, deliveryRate: 1.5 };
      expect(() => alertStatisticsSchema.parse(invalidStats)).toThrow(z.ZodError);
    });

    it('should reject statistics with negative counts', () => {
      const invalidStats = { ...validStatistics, totalSent: -10 };
      expect(() => alertStatisticsSchema.parse(invalidStats)).toThrow(z.ZodError);
    });
  });

  describe('AlertModel Business Logic', () => {
    describe('create method', () => {
      it('should create alert with generated id and timestamp', () => {
        const alertData = {
          ...baseAlert,
          userId: 'user_new'
        };

        const createdAlert = AlertModel.create(alertData);

        expect(createdAlert.id).toBeDefined();
        expect(createdAlert.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(createdAlert.createdAt).toBeDefined();
        expect(createdAlert.deliveryAttempts).toBe(0);
      });
    });

    describe('createPriceCondition method', () => {
      it('should create price alert condition with generated fields', () => {
        const conditionData = {
          userId: 'user_123',
          productId: 'prod_123',
          type: 'below_target' as const,
          targetPrice: 10000
        };

        const createdCondition = AlertModel.createPriceCondition(conditionData);

        expect(createdCondition.id).toBeDefined();
        expect(createdCondition.createdAt).toBeDefined();
        expect(createdCondition.totalTriggers).toBe(0);
      });
    });

    describe('canSendAlert method', () => {
      let alert: Alert;
      let preferences: NotificationPreferences;

      beforeEach(() => {
        alert = AlertModel.create({
          ...baseAlert,
          id: 'alert_123',
          createdAt: '2024-01-01T00:00:00Z'
        });

        preferences = {
          userId: 'user_123',
          enabledChannels: ['push'],
          typePreferences: {},
          quietHours: { enabled: false },
          maxNotificationsPerDay: 50,
          maxNotificationsPerHour: 10,
          updatedAt: '2024-01-01T00:00:00Z'
        };
      });

      it('should allow sending alert when conditions are met', () => {
        expect(AlertModel.canSendAlert(alert, preferences, 5)).toBe(true);
      });

      it('should block alert if status is not pending', () => {
        alert.status = 'sent';
        expect(AlertModel.canSendAlert(alert, preferences, 5)).toBe(false);
      });

      it('should block alert during quiet hours', () => {
        preferences.quietHours = {
          enabled: true,
          start: '22:00',
          end: '08:00'
        };

        // Mock current time to be during quiet hours
        const mockDate = new Date('2024-01-01T23:00:00Z');
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

        expect(AlertModel.canSendAlert(alert, preferences, 5)).toBe(false);

        jest.restoreAllMocks();
      });

      it('should block alert if hourly limit exceeded', () => {
        expect(AlertModel.canSendAlert(alert, preferences, 10)).toBe(false);
        expect(AlertModel.canSendAlert(alert, preferences, 11)).toBe(false);
      });
    });

    describe('formatMessage method', () => {
      it('should replace template variables correctly', () => {
        const template = 'Price dropped from {{oldPrice}} to {{newPrice}} ({{percentage}}% off)';
        const variables = {
          oldPrice: '12,000',
          newPrice: '10,000',
          percentage: '16.67'
        };

        const formatted = AlertModel.formatMessage(template, variables);
        expect(formatted).toBe('Price dropped from 12,000 to 10,000 (16.67% off)');
      });

      it('should handle missing variables gracefully', () => {
        const template = 'Price is {{price}}';
        const variables = {};

        const formatted = AlertModel.formatMessage(template, variables);
        expect(formatted).toBe('Price is {{price}}');
      });
    });

    describe('shouldRetry method', () => {
      it('should return true for failed alerts within retry limit', () => {
        const alert = AlertModel.create({
          ...baseAlert,
          id: 'alert_123',
          createdAt: '2024-01-01T00:00:00Z'
        });
        alert.status = 'failed';
        alert.deliveryAttempts = 2;
        alert.maxDeliveryAttempts = 3;

        expect(AlertModel.shouldRetry(alert)).toBe(true);
      });

      it('should return false for alerts at retry limit', () => {
        const alert = AlertModel.create({
          ...baseAlert,
          id: 'alert_123',
          createdAt: '2024-01-01T00:00:00Z'
        });
        alert.status = 'failed';
        alert.deliveryAttempts = 3;
        alert.maxDeliveryAttempts = 3;

        expect(AlertModel.shouldRetry(alert)).toBe(false);
      });

      it('should return false for non-failed alerts', () => {
        const alert = AlertModel.create({
          ...baseAlert,
          id: 'alert_123',
          createdAt: '2024-01-01T00:00:00Z'
        });
        alert.status = 'delivered';

        expect(AlertModel.shouldRetry(alert)).toBe(false);
      });
    });

    describe('calculateNextRetryTime method', () => {
      it('should calculate exponential backoff', () => {
        const alert = AlertModel.create({
          ...baseAlert,
          id: 'alert_123',
          createdAt: '2024-01-01T00:00:00Z'
        });
        alert.deliveryAttempts = 2;

        const retryTime = AlertModel.calculateNextRetryTime(alert);
        const expectedDelay = 5 * 60 * 1000 * Math.pow(2, 2); // 5min * 2^2 = 20min
        const expectedTime = new Date('2024-01-01T00:00:00Z').getTime() + expectedDelay;

        expect(retryTime.getTime()).toBeCloseTo(expectedTime, -3);
      });

      it('should cap delay at maximum', () => {
        const alert = AlertModel.create({
          ...baseAlert,
          id: 'alert_123',
          createdAt: '2024-01-01T00:00:00Z'
        });
        alert.deliveryAttempts = 10; // Very high attempt count

        const retryTime = AlertModel.calculateNextRetryTime(alert);
        const maxDelay = 24 * 60 * 60 * 1000; // 24 hours
        const expectedTime = new Date('2024-01-01T00:00:00Z').getTime() + maxDelay;

        expect(retryTime.getTime()).toBeCloseTo(expectedTime, -3);
      });
    });

    describe('determinePriority method', () => {
      it('should assign urgent priority to historical low alerts', () => {
        const priority = AlertModel.determinePriority('historical_low');
        expect(priority).toBe('urgent');
      });

      it('should assign high priority to large price drops', () => {
        const priority = AlertModel.determinePriority('price_drop', { percentageDrop: 35 });
        expect(priority).toBe('urgent');
      });

      it('should assign medium priority to small price drops', () => {
        const priority = AlertModel.determinePriority('price_drop', { percentageDrop: 10 });
        expect(priority).toBe('medium');
      });

      it('should assign high priority to stock alerts', () => {
        const priority = AlertModel.determinePriority('stock_available');
        expect(priority).toBe('high');
      });
    });

    describe('getDefaultChannels method', () => {
      it('should return appropriate channels for different alert types', () => {
        expect(AlertModel.getDefaultChannels('historical_low')).toEqual(['push', 'email']);
        expect(AlertModel.getDefaultChannels('price_drop')).toEqual(['push', 'email']);
        expect(AlertModel.getDefaultChannels('back_in_stock')).toEqual(['push']);
        expect(AlertModel.getDefaultChannels('price_target')).toEqual(['push']);
      });
    });

    describe('createStatistics method', () => {
      it('should create comprehensive alert statistics', () => {
        const alerts: Alert[] = [
          AlertModel.create({ ...baseAlert, userId: 'user_123', type: 'price_drop' }),
          AlertModel.create({ ...baseAlert, userId: 'user_123', type: 'stock_available' }),
          AlertModel.create({ ...baseAlert, userId: 'user_456', type: 'price_drop' }) // Different user
        ];

        const deliveryResults: AlertDeliveryResult[] = [
          {
            alertId: alerts[0].id,
            channel: 'push',
            status: 'success',
            messageId: 'msg_1',
            deliveredAt: '2024-01-01T00:01:00Z',
            responseTime: 1000
          },
          {
            alertId: alerts[1].id,
            channel: 'email',
            status: 'failed',
            error: 'Bounce'
          }
        ];

        const stats = AlertModel.createStatistics('user_123', 'daily', alerts, deliveryResults);

        expect(stats.userId).toBe('user_123');
        expect(stats.period).toBe('daily');
        expect(stats.totalSent).toBe(2); // Only user_123's alerts
        expect(stats.totalDelivered).toBe(1);
        expect(stats.totalFailed).toBe(1);
        expect(stats.byType['price_drop'].sent).toBe(1);
        expect(stats.byType['stock_available'].sent).toBe(1);
      });
    });
  });
});