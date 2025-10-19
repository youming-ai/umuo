/**
 * Notification service for handling multi-channel notifications
 * Supports push, email, SMS, and in-app notifications
 */

import { z } from 'zod';
import { alertSchema, type Alert, notificationPreferencesSchema, type NotificationPreferences } from '../models/alert';

// Notification channel types
export type NotificationChannel = 'push' | 'email' | 'sms' | 'in_app';

// Push notification payload
export const pushNotificationSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
  icon: z.string().url().optional(),
  image: z.string().url().optional(),
  badge: z.number().nonnegative().optional(),
  tag: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  actions: z.array(z.object({
    action: z.string(),
    title: z.string(),
    icon: z.string().url().optional()
  })).optional()
});

export type PushNotification = z.infer<typeof pushNotificationSchema>;

// Email notification
export const emailNotificationSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  htmlBody: z.string().min(1),
  textBody: z.string().min(1).optional(),
  from: z.string().email().optional(),
  replyTo: z.string().email().optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    content: z.union([z.string(), z.instanceof(Uint8Array)]),
    contentType: z.string()
  })).optional(),
  headers: z.record(z.string()).optional()
});

export type EmailNotification = z.infer<typeof emailNotificationSchema>;

// SMS notification
export const smsNotificationSchema = z.object({
  to: z.string().regex(/^\+?[1-9]\d{1,14}$/), // E.164 format
  body: z.string().min(1).max(1600), // SMS limit
  from: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal')
});

export type SmsNotification = z.infer<typeof smsNotificationSchema>;

// In-app notification
export const inAppNotificationSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  type: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  data: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
  readAt: z.string().datetime().optional(),
  actionUrl: z.string().url().optional(),
  actionText: z.string().max(50).optional()
});

export type InAppNotification = z.infer<typeof inAppNotificationSchema>;

// Notification delivery result
export const deliveryResultSchema = z.object({
  success: z.boolean(),
  messageId: z.string().optional(),
  error: z.string().optional(),
  deliveryTime: z.number().nonnegative(), // in milliseconds
  metadata: z.record(z.unknown()).optional()
});

export type DeliveryResult = z.infer<typeof deliveryResultSchema>;

// Multi-channel notification result
export const notificationResultSchema = z.object({
  alertId: z.string().uuid(),
  channel: z.enum(['push', 'email', 'sms', 'in_app']),
  result: deliveryResultSchema,
  sentAt: z.string().datetime(),
  deliveredAt: z.string().datetime().optional()
});

export type NotificationResult = z.infer<typeof notificationResultSchema>;

export class NotificationService {
  private static readonly MAX_RETRY_ATTEMPTS = 3;
  private static readonly RETRY_DELAY_MS = 5000; // 5 seconds

  /**
   * Send notification through specified channels
   */
  static async sendNotification(
    alert: Alert,
    preferences: NotificationPreferences,
    userDeviceTokens?: { push?: string[]; email?: string; phone?: string }
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    // Filter channels based on user preferences
    const enabledChannels = alert.channels.filter(channel =>
      preferences.enabledChannels.includes(channel)
    );

    for (const channel of enabledChannels) {
      try {
        const result = await this.sendNotificationToChannel(
          alert,
          channel,
          userDeviceTokens
        );
        results.push(result);
      } catch (error) {
        console.error(`Failed to send ${channel} notification:`, error);
        results.push({
          alertId: alert.id,
          channel,
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            deliveryTime: 0
          },
          sentAt: new Date().toISOString()
        });
      }
    }

    return results;
  }

  /**
   * Send notification to specific channel
   */
  private static async sendNotificationToChannel(
    alert: Alert,
    channel: NotificationChannel,
    userDeviceTokens?: { push?: string[]; email?: string; phone?: string }
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    switch (channel) {
      case 'push':
        return await this.sendPushNotification(alert, userDeviceTokens?.push || []);
      case 'email':
        return await this.sendEmailNotification(alert, userDeviceTokens?.email);
      case 'sms':
        return await this.sendSmsNotification(alert, userDeviceTokens?.phone);
      case 'in_app':
        return await this.sendInAppNotification(alert);
      default:
        throw new Error(`Unsupported notification channel: ${channel}`);
    }
  }

  /**
   * Send push notification
   */
  private static async sendPushNotification(
    alert: Alert,
    deviceTokens: string[]
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    if (deviceTokens.length === 0) {
      return {
        alertId: alert.id,
        channel: 'push',
        result: {
          success: false,
          error: 'No device tokens available',
          deliveryTime: 0
        },
        sentAt: new Date().toISOString()
      };
    }

    try {
      const pushPayload = this.createPushNotification(alert);

      // This would integrate with FCM, APNS, or other push services
      const deliveryResults = await this.sendPushNotifications(deviceTokens, pushPayload);

      const successCount = deliveryResults.filter(r => r.success).length;
      const deliveryTime = Date.now() - startTime;

      return {
        alertId: alert.id,
        channel: 'push',
        result: {
          success: successCount > 0,
          messageId: `push_${alert.id}_${Date.now()}`,
          deliveryTime,
          metadata: {
            totalTokens: deviceTokens.length,
            successfulDeliveries: successCount
          }
        },
        sentAt: new Date().toISOString(),
        deliveredAt: successCount > 0 ? new Date().toISOString() : undefined
      };
    } catch (error) {
      return {
        alertId: alert.id,
        channel: 'push',
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          deliveryTime: Date.now() - startTime
        },
        sentAt: new Date().toISOString()
      };
    }
  }

  /**
   * Send email notification
   */
  private static async sendEmailNotification(
    alert: Alert,
    userEmail?: string
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    if (!userEmail) {
      return {
        alertId: alert.id,
        channel: 'email',
        result: {
          success: false,
          error: 'No email address available',
          deliveryTime: 0
        },
        sentAt: new Date().toISOString()
      };
    }

    try {
      const emailPayload = this.createEmailNotification(alert, userEmail);
      const messageId = await this.sendEmail(emailPayload);
      const deliveryTime = Date.now() - startTime;

      return {
        alertId: alert.id,
        channel: 'email',
        result: {
          success: true,
          messageId,
          deliveryTime
        },
        sentAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        alertId: alert.id,
        channel: 'email',
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          deliveryTime: Date.now() - startTime
        },
        sentAt: new Date().toISOString()
      };
    }
  }

  /**
   * Send SMS notification
   */
  private static async sendSmsNotification(
    alert: Alert,
    userPhone?: string
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    if (!userPhone) {
      return {
        alertId: alert.id,
        channel: 'sms',
        result: {
          success: false,
          error: 'No phone number available',
          deliveryTime: 0
        },
        sentAt: new Date().toISOString()
      };
    }

    try {
      const smsPayload = this.createSmsNotification(alert, userPhone);
      const messageId = await this.sendSms(smsPayload);
      const deliveryTime = Date.now() - startTime;

      return {
        alertId: alert.id,
        channel: 'sms',
        result: {
          success: true,
          messageId,
          deliveryTime
        },
        sentAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        alertId: alert.id,
        channel: 'sms',
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          deliveryTime: Date.now() - startTime
        },
        sentAt: new Date().toISOString()
      };
    }
  }

  /**
   * Send in-app notification
   */
  private static async sendInAppNotification(
    alert: Alert
  ): Promise<NotificationResult> {
    const startTime = Date.now();

    try {
      const inAppPayload = this.createInAppNotification(alert);
      const messageId = await this.saveInAppNotification(inAppPayload);
      const deliveryTime = Date.now() - startTime;

      return {
        alertId: alert.id,
        channel: 'in_app',
        result: {
          success: true,
          messageId,
          deliveryTime
        },
        sentAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        alertId: alert.id,
        channel: 'in_app',
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          deliveryTime: Date.now() - startTime
        },
        sentAt: new Date().toISOString()
      };
    }
  }

  /**
   * Create push notification payload
   */
  private static createPushNotification(alert: Alert): PushNotification {
    return {
      title: alert.title,
      body: alert.message,
      tag: alert.id,
      data: {
        alertId: alert.id,
        productId: alert.productId,
        type: alert.type,
        ...alert.alertData
      },
      actions: this.getNotificationActions(alert)
    };
  }

  /**
   * Create email notification payload
   */
  private static createEmailNotification(alert: Alert, userEmail: string): EmailNotification {
    const htmlBody = this.generateEmailTemplate(alert);
    const textBody = alert.message; // Simple text version

    return {
      to: userEmail,
      subject: alert.title,
      htmlBody,
      textBody,
      from: 'noreply@yabaii.day',
      replyTo: 'support@yabaii.day'
    };
  }

  /**
   * Create SMS notification payload
   */
  private static createSmsNotification(alert: Alert, userPhone: string): SmsNotification {
    // Truncate message for SMS if needed
    const body = alert.message.length > 160
      ? alert.message.substring(0, 157) + '...'
      : alert.message;

    return {
      to: userPhone,
      body,
      priority: alert.priority === 'urgent' ? 'high' : 'normal'
    };
  }

  /**
   * Create in-app notification payload
   */
  private static createInAppNotification(alert: Alert): InAppNotification {
    return {
      userId: alert.userId,
      title: alert.title,
      message: alert.message,
      type: this.getNotificationType(alert.type),
      priority: alert.priority,
      data: alert.alertData,
      expiresAt: this.calculateExpirationTime(alert),
      actionUrl: this.getActionUrl(alert),
      actionText: this.getActionText(alert)
    };
  }

  /**
   * Get notification actions for push notifications
   */
  private static getNotificationActions(alert: Alert) {
    const actions = [];

    if (alert.type === 'price_drop' || alert.type === 'historical_low') {
      actions.push({
        action: 'view_product',
        title: 'View Product',
        icon: 'https://yabaii.day/icons/view.png'
      });
    }

    if (alert.type === 'stock_available') {
      actions.push({
        action: 'buy_now',
        title: 'Buy Now',
        icon: 'https://yabaii.day/icons/buy.png'
      });
    }

    return actions;
  }

  /**
   * Generate email template
   */
  private static generateEmailTemplate(alert: Alert): string {
    const brandColor = '#FF6B35';
    const productName = alert.alertData?.productName || 'Product';
    const productImage = alert.alertData?.productImage;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${alert.title}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <header style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: ${brandColor}; margin: 0;">Yabaii</h1>
            <p style="margin: 5px 0; color: #666;">Price Comparison & Alerts</p>
          </header>

          <main style="background: #f9f9f9; padding: 30px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: ${brandColor}; margin-top: 0;">${alert.title}</h2>

            ${productImage ? `
              <div style="text-align: center; margin: 20px 0;">
                <img src="${productImage}" alt="${productName}" style="max-width: 200px; border-radius: 4px;">
              </div>
            ` : ''}

            <p style="font-size: 16px; margin-bottom: 20px;">${alert.message}</p>

            ${alert.alertData ? this.generateAlertDetails(alert.alertData) : ''}

            <div style="text-align: center; margin: 30px 0;">
              <a href="${this.getActionUrl(alert)}"
                 style="background: ${brandColor}; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 4px; font-weight: bold;
                        display: inline-block;">
                ${this.getActionText(alert)}
              </a>
            </div>
          </main>

          <footer style="text-align: center; color: #666; font-size: 12px;">
            <p>This alert was sent to you because you subscribed to price notifications on Yabaii.</p>
            <p>You can <a href="https://yabaii.day/settings/notifications" style="color: ${brandColor};">manage your notification preferences</a> at any time.</p>
            <p>© 2024 Yabaii. All rights reserved.</p>
          </footer>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate alert details for email template
   */
  private static generateAlertDetails(alertData: any): string {
    let details = '<div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">';
    details += '<h3 style="margin-top: 0; color: #333;">Details:</h3>';

    if (alertData.oldPrice && alertData.newPrice) {
      const discount = ((alertData.oldPrice - alertData.newPrice) / alertData.oldPrice * 100).toFixed(1);
      details += `
        <p><strong>Price Change:</strong> ¥${alertData.oldPrice.toLocaleString()} → ¥${alertData.newPrice.toLocaleString()} (${discount}% off)</p>
      `;
    }

    if (alertData.platform) {
      details += `<p><strong>Platform:</strong> ${alertData.platform}</p>`;
    }

    if (alertData.availability) {
      details += `<p><strong>Availability:</strong> ${alertData.availability}</p>`;
    }

    details += '</div>';
    return details;
  }

  /**
   * Get notification type for in-app notifications
   */
  private static getNotificationType(alertType: string): InAppNotification['type'] {
    switch (alertType) {
      case 'historical_low':
      case 'price_drop':
        return 'success';
      case 'stock_available':
      case 'back_in_stock':
        return 'info';
      default:
        return 'info';
    }
  }

  /**
   * Calculate expiration time for in-app notifications
   */
  private static calculateExpirationTime(alert: Alert): string {
    const now = new Date();
    const expirationDays = alert.priority === 'urgent' ? 7 : 30;
    now.setDate(now.getDate() + expirationDays);
    return now.toISOString();
  }

  /**
   * Get action URL for alert
   */
  private static getActionUrl(alert: Alert): string {
    const baseUrl = 'https://yabaii.day';

    switch (alert.type) {
      case 'price_drop':
      case 'historical_low':
      case 'stock_available':
      case 'back_in_stock':
        return `${baseUrl}/product/${alert.productId}`;
      case 'price_target':
        return `${baseUrl}/search?q=${alert.alertData?.productName || ''}`;
      default:
        return `${baseUrl}/alerts`;
    }
  }

  /**
   * Get action text for alert
   */
  private static getActionText(alert: Alert): string {
    switch (alert.type) {
      case 'price_drop':
      case 'historical_low':
        return 'View Deal';
      case 'stock_available':
      case 'back_in_stock':
        return 'Buy Now';
      case 'price_target':
        return 'View Product';
      default:
        return 'View Details';
    }
  }

  // Mock implementation methods (would integrate with actual services)
  private static async sendPushNotifications(
    deviceTokens: string[],
    payload: PushNotification
  ): Promise<Array<{ success: boolean; error?: string }>> {
    // Mock implementation - would integrate with FCM, APNS, etc.
    await new Promise(resolve => setTimeout(resolve, 100));
    return deviceTokens.map(() => ({ success: true }));
  }

  private static async sendEmail(email: EmailNotification): Promise<string> {
    // Mock implementation - would integrate with SendGrid, AWS SES, etc.
    await new Promise(resolve => setTimeout(resolve, 200));
    return `email_${Date.now()}`;
  }

  private static async sendSms(sms: SmsNotification): Promise<string> {
    // Mock implementation - would integrate with Twilio, AWS SNS, etc.
    await new Promise(resolve => setTimeout(resolve, 150));
    return `sms_${Date.now()}`;
  }

  private static async saveInAppNotification(notification: InAppNotification): Promise<string> {
    // Mock implementation - would save to database
    await new Promise(resolve => setTimeout(resolve, 50));
    return `inapp_${Date.now()}`;
  }

  /**
   * Retry failed notifications
   */
  static async retryFailedNotification(
    alert: Alert,
    channel: NotificationChannel,
    attempt: number = 1
  ): Promise<NotificationResult> {
    if (attempt > this.MAX_RETRY_ATTEMPTS) {
      throw new Error(`Maximum retry attempts (${this.MAX_RETRY_ATTEMPTS}) exceeded`);
    }

    // Exponential backoff
    const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      return await this.sendNotificationToChannel(alert, channel);
    } catch (error) {
      return await this.retryFailedNotification(alert, channel, attempt + 1);
    }
  }

  /**
   * Get notification statistics
   */
  static async getNotificationStats(
    userId: string,
    period: 'day' | 'week' | 'month' = 'week'
  ): Promise<{
    sent: number;
    delivered: number;
    failed: number;
    byChannel: Record<NotificationChannel, number>;
  }> {
    // Mock implementation - would fetch from analytics
    return {
      sent: 10,
      delivered: 8,
      failed: 2,
      byChannel: {
        push: 6,
        email: 3,
        sms: 1,
        in_app: 0
      }
    };
  }
}