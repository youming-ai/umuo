/**
 * Notification service tests
 * Tests for multi-channel notification functionality
 */

import { NotificationService, pushNotificationSchema, emailNotificationSchema, smsNotificationSchema, inAppNotificationSchema } from '../../../src/services/notification_service';
import { alertSchema, type Alert, type NotificationChannel } from '../../../src/models/alert';

// Mock the notification methods to avoid actual service calls
jest.mock('../../../src/services/notification_service', () => {
  const originalModule = jest.requireActual('../../../src/services/notification_service');
  return {
    ...originalModule,
    NotificationService: {
      ...originalModule.NotificationService,
      sendPushNotifications: jest.fn(),
      sendEmail: jest.fn(),
      sendSms: jest.fn(),
      saveInAppNotification: jest.fn()
    }
  };
});

describe('NotificationService', () => {
  const mockAlert: Alert = {
    id: 'alert_123',
    userId: 'user_123',
    productId: 'prod_123',
    type: 'price_drop',
    priority: 'high',
    status: 'pending',
    title: 'Price Drop Alert',
    message: 'The price of iPhone 15 Pro has dropped by 20%!',
    channels: ['push', 'email'],
    alertData: {
      productName: 'iPhone 15 Pro',
      oldPrice: 120000,
      newPrice: 96000,
      platform: 'Amazon',
      productImage: 'https://example.com/image.jpg'
    },
    createdAt: '2024-01-01T00:00:00Z'
  };

  const mockPreferences = {
    userId: 'user_123',
    enabledChannels: ['push', 'email'],
    typePreferences: {},
    quietHours: { enabled: false },
    maxNotificationsPerDay: 50,
    maxNotificationsPerHour: 10,
    updatedAt: '2024-01-01T00:00:00Z'
  };

  const mockDeviceTokens = {
    push: ['token1', 'token2'],
    email: 'user@example.com',
    phone: '+819012345678'
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Schema Validation', () => {
    describe('pushNotificationSchema', () => {
      it('should validate valid push notification', () => {
        const validPush = {
          title: 'Price Drop Alert',
          body: 'Product price has dropped!',
          icon: 'https://example.com/icon.png',
          data: { productId: 'prod_123' },
          actions: [{
            action: 'view_product',
            title: 'View Product'
          }]
        };

        expect(() => pushNotificationSchema.parse(validPush)).not.toThrow();
      });

      it('should reject push notification with empty title', () => {
        const invalidPush = { title: '', body: 'Message' };
        expect(() => pushNotificationSchema.parse(invalidPush)).toThrow();
      });

      it('should reject push notification with invalid URL', () => {
        const invalidPush = {
          title: 'Title',
          body: 'Message',
          icon: 'invalid-url'
        };
        expect(() => pushNotificationSchema.parse(invalidPush)).toThrow();
      });

      it('should accept minimal push notification', () => {
        const minimalPush = {
          title: 'Title',
          body: 'Message'
        };

        expect(() => pushNotificationSchema.parse(minimalPush)).not.toThrow();
      });
    });

    describe('emailNotificationSchema', () => {
      it('should validate valid email notification', () => {
        const validEmail = {
          to: 'user@example.com',
          subject: 'Price Alert',
          htmlBody: '<h1>Price Drop!</h1>',
          textBody: 'Price Drop!',
          from: 'noreply@example.com',
          replyTo: 'support@example.com'
        };

        expect(() => emailNotificationSchema.parse(validEmail)).not.toThrow();
      });

      it('should reject email with invalid address', () => {
        const invalidEmail = {
          to: 'invalid-email',
          subject: 'Subject',
          htmlBody: '<p>Content</p>'
        };

        expect(() => emailNotificationSchema.parse(invalidEmail)).toThrow();
      });

      it('should reject email with empty subject', () => {
        const invalidEmail = {
          to: 'user@example.com',
          subject: '',
          htmlBody: '<p>Content</p>'
        };

        expect(() => emailNotificationSchema.parse(invalidEmail)).toThrow();
      });

      it('should accept email with attachments', () => {
        const emailWithAttachments = {
          to: 'user@example.com',
          subject: 'Subject',
          htmlBody: '<p>Content</p>',
          attachments: [{
            filename: 'report.pdf',
            content: 'PDF content',
            contentType: 'application/pdf'
          }]
        };

        expect(() => emailNotificationSchema.parse(emailWithAttachments)).not.toThrow();
      });
    });

    describe('smsNotificationSchema', () => {
      it('should validate valid SMS notification', () => {
        const validSms = {
          to: '+819012345678',
          body: 'Price drop alert!',
          priority: 'high' as const
        };

        expect(() => smsNotificationSchema.parse(validSms)).not.toThrow();
      });

      it('should reject SMS with invalid phone number', () => {
        const invalidSms = {
          to: '123-456-7890',
          body: 'Message'
        };

        expect(() => smsNotificationSchema.parse(invalidSms)).toThrow();
      });

      it('should reject SMS with empty body', () => {
        const invalidSms = {
          to: '+819012345678',
          body: ''
        };

        expect(() => smsNotificationSchema.parse(invalidSms)).toThrow();
      });

      it('should reject SMS with body too long', () => {
        const invalidSms = {
          to: '+819012345678',
          body: 'a'.repeat(1601)
        };

        expect(() => smsNotificationSchema.parse(invalidSms)).toThrow();
      });
    });

    describe('inAppNotificationSchema', () => {
      it('should validate valid in-app notification', () => {
        const validInApp = {
          userId: 'user_123',
          title: 'Price Alert',
          message: 'Product price has dropped!',
          type: 'success' as const,
          priority: 'high' as const,
          actionUrl: 'https://example.com/product/123',
          actionText: 'View Product'
        };

        expect(() => inAppNotificationSchema.parse(validInApp)).not.toThrow();
      });

      it('should reject in-app notification with invalid UUID', () => {
        const invalidInApp = {
          userId: 'invalid-uuid',
          title: 'Title',
          message: 'Message'
        };

        expect(() => inAppNotificationSchema.parse(invalidInApp)).toThrow();
      });

      it('should reject in-app notification with invalid action URL', () => {
        const invalidInApp = {
          userId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Title',
          message: 'Message',
          actionUrl: 'invalid-url'
        };

        expect(() => inAppNotificationSchema.parse(invalidInApp)).toThrow();
      });

      it('should accept in-app notification with expiration', () => {
        const inAppWithExpiry = {
          userId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'Title',
          message: 'Message',
          expiresAt: '2024-12-31T23:59:59Z'
        };

        expect(() => inAppNotificationSchema.parse(inAppWithExpiry)).not.toThrow();
      });
    });
  });

  describe('Notification Service Methods', () => {
    describe('sendNotification method', () => {
      it('should send notifications to all enabled channels', async () => {
        // Mock the channel-specific methods
        const mockPushResult = {
          alertId: mockAlert.id,
          channel: 'push' as const,
          result: { success: true, deliveryTime: 100 },
          sentAt: new Date().toISOString()
        };

        const mockEmailResult = {
          alertId: mockAlert.id,
          channel: 'email' as const,
          result: { success: true, deliveryTime: 200 },
          sentAt: new Date().toISOString()
        };

        jest.spyOn(NotificationService as any, 'sendNotificationToChannel')
          .mockResolvedValueOnce(mockPushResult)
          .mockResolvedValueOnce(mockEmailResult);

        const results = await NotificationService.sendNotification(
          mockAlert,
          mockPreferences,
          mockDeviceTokens
        );

        expect(results).toHaveLength(2);
        expect(results[0].channel).toBe('push');
        expect(results[1].channel).toBe('email');
        expect(results.every(r => r.result.success)).toBe(true);
      });

      it('should handle failed notifications gracefully', async () => {
        jest.spyOn(NotificationService as any, 'sendNotificationToChannel')
          .mockRejectedValue(new Error('Service unavailable'));

        const results = await NotificationService.sendNotification(
          mockAlert,
          mockPreferences,
          mockDeviceTokens
        );

        expect(results).toHaveLength(2);
        expect(results.every(r => r.result.success === false)).toBe(true);
        expect(results.every(r => r.result.error)).toBe(true);
      });

      it('should filter channels based on user preferences', async () => {
        const preferencesWithPushOnly = {
          ...mockPreferences,
          enabledChannels: ['push']
        };

        const mockResult = {
          alertId: mockAlert.id,
          channel: 'push' as const,
          result: { success: true, deliveryTime: 100 },
          sentAt: new Date().toISOString()
        };

        jest.spyOn(NotificationService as any, 'sendNotificationToChannel')
          .mockResolvedValue(mockResult);

        const results = await NotificationService.sendNotification(
          mockAlert,
          preferencesWithPushOnly,
          mockDeviceTokens
        );

        expect(results).toHaveLength(1);
        expect(results[0].channel).toBe('push');
      });
    });

    describe('retryFailedNotification method', () => {
      it('should retry failed notifications with exponential backoff', async () => {
        const mockResult = {
          alertId: mockAlert.id,
          channel: 'push' as const,
          result: { success: true, deliveryTime: 100 },
          sentAt: new Date().toISOString()
        };

        jest.spyOn(NotificationService as any, 'sendNotificationToChannel')
          .mockResolvedValue(mockResult);

        const startTime = Date.now();
        const result = await NotificationService.retryFailedNotification(mockAlert, 'push');
        const endTime = Date.now();

        expect(result.result.success).toBe(true);
        // Should have some delay (exponential backoff)
        expect(endTime - startTime).toBeGreaterThan(0);
      });

      it('should throw error after maximum retry attempts', async () => {
        jest.spyOn(NotificationService as any, 'sendNotificationToChannel')
          .mockRejectedValue(new Error('Service unavailable'));

        await expect(
          NotificationService.retryFailedNotification(mockAlert, 'push')
        ).rejects.toThrow('Maximum retry attempts (3) exceeded');
      });
    });

    describe('getNotificationStats method', () => {
      it('should return notification statistics', async () => {
        const stats = await NotificationService.getNotificationStats('user_123', 'week');

        expect(stats).toHaveProperty('sent');
        expect(stats).toHaveProperty('delivered');
        expect(stats).toHaveProperty('failed');
        expect(stats).toHaveProperty('byChannel');
        expect(typeof stats.sent).toBe('number');
        expect(typeof stats.delivered).toBe('number');
        expect(typeof stats.failed).toBe('number');
      });
    });
  });

  describe('Notification Content Generation', () => {
    describe('Email template generation', () => {
      it('should generate proper email HTML', () => {
        // Access private method through prototype for testing
        const emailHtml = (NotificationService as any).generateEmailTemplate(mockAlert);

        expect(emailHtml).toContain(mockAlert.title);
        expect(emailHtml).toContain(mockAlert.message);
        expect(emailHtml).toContain('iPhone 15 Pro');
        expect(emailHtml).toContain('¥120,000');
        expect(emailHtml).toContain('¥96,000');
        expect(emailHtml).toContain('20.0%');
        expect(emailHtml).toContain('yabaii.day');
      });

      it('should generate email without product image', () => {
        const alertWithoutImage = {
          ...mockAlert,
          alertData: { ...mockAlert.alertData, productImage: undefined }
        };

        const emailHtml = (NotificationService as any).generateEmailTemplate(alertWithoutImage);

        expect(emailHtml).not.toContain('<img');
      });

      it('should generate email with different alert types', () => {
        const stockAlert = {
          ...mockAlert,
          type: 'stock_available' as const,
          title: 'Back in Stock!',
          alertData: { productName: 'Nintendo Switch', availability: 'In Stock' }
        };

        const emailHtml = (NotificationService as any).generateEmailTemplate(stockAlert);

        expect(emailHtml).toContain('Back in Stock!');
        expect(emailHtml).toContain('Nintendo Switch');
        expect(emailHtml).toContain('In Stock');
      });
    });

    describe('Action URL and text generation', () => {
      it('should generate correct action URLs', () => {
        const priceDropUrl = (NotificationService as any).getActionUrl(mockAlert);
        expect(priceDropUrl).toBe('https://yabaii.day/product/prod_123');

        const priceTargetAlert = {
          ...mockAlert,
          type: 'price_target' as const,
          alertData: { productName: 'iPhone 15' }
        };
        const targetUrl = (NotificationService as any).getActionUrl(priceTargetAlert);
        expect(targetUrl).toBe('https://yabaii.day/search?q=iPhone%2015');
      });

      it('should generate appropriate action text', () => {
        expect((NotificationService as any).getActionText(mockAlert)).toBe('View Deal');

        const stockAlert = { ...mockAlert, type: 'stock_available' as const };
        expect((NotificationService as any).getActionText(stockAlert)).toBe('Buy Now');

        const targetAlert = { ...mockAlert, type: 'price_target' as const };
        expect((NotificationService as any).getActionText(targetAlert)).toBe('View Product');
      });
    });

    describe('Notification type mapping', () => {
      it('should map alert types to notification types correctly', () => {
        expect((NotificationService as any).getNotificationType('historical_low')).toBe('success');
        expect((NotificationService as any).getNotificationType('price_drop')).toBe('success');
        expect((NotificationService as any).getNotificationType('stock_available')).toBe('info');
        expect((NotificationService as any).getNotificationType('back_in_stock')).toBe('info');
        expect((NotificationService as any).getNotificationType('unknown_type')).toBe('info');
      });
    });

    describe('Expiration time calculation', () => {
      it('should calculate expiration time based on priority', () => {
        const urgentAlert = { ...mockAlert, priority: 'urgent' as const };
        const urgentExpiry = (NotificationService as any).calculateExpirationTime(urgentAlert);

        const normalAlert = { ...mockAlert, priority: 'medium' as const };
        const normalExpiry = (NotificationService as any).calculateExpirationTime(normalAlert);

        const urgentDate = new Date(urgentExpiry);
        const normalDate = new Date(normalExpiry);
        const now = new Date();

        // Urgent should expire in 7 days, normal in 30 days
        const urgentDaysDiff = Math.floor((urgentDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const normalDaysDiff = Math.floor((normalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        expect(urgentDaysDiff).toBe(7);
        expect(normalDaysDiff).toBe(30);
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing device tokens gracefully', async () => {
      const results = await NotificationService.sendNotification(
        mockAlert,
        mockPreferences,
        {} // No device tokens
      );

      expect(results).toHaveLength(2);
      expect(results.every(r => r.result.success === false)).toBe(true);
      expect(results.every(r => r.result.error?.includes('No'))).toBe(true);
    });

    it('should handle invalid alert data gracefully', () => {
      const invalidAlert = { ...mockAlert, alertData: null };
      const emailHtml = (NotificationService as any).generateEmailTemplate(invalidAlert);

      expect(emailHtml).toContain(invalidAlert.title);
      expect(emailHtml).toContain(invalidAlert.message);
      // Should not throw error even with null alertData
    });

    it('should handle very long messages in SMS', () => {
      const longMessageAlert = {
        ...mockAlert,
        message: 'a'.repeat(200) // Very long message
      };

      const smsPayload = (NotificationService as any).createSmsNotification(
        longMessageAlert,
        '+819012345678'
      );

      // SMS should be truncated to 160 characters
      expect(smsPayload.body.length).toBeLessThanOrEqual(160);
      expect(smsPayload.body.endsWith('...')).toBe(true);
    });
  });
});