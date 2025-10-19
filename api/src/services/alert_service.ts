/**
 * Alert Service
 *
 * Manages user alerts, notifications, and automated price monitoring.
 * Integrates with various notification channels and supports multiple alert types.
 */

import { z } from 'zod';
import {
  AlertSchema,
  alertTypeSchema,
  alertStatusSchema,
  alertPrioritySchema,
  notificationChannelSchema,
  type Alert,
  type AlertType,
  type AlertStatus,
  type AlertPriority,
  type NotificationChannel
} from '../models/alert';

// Alert creation configuration
export const AlertCreationConfigSchema = z.object({
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  type: alertTypeSchema,
  priority: alertPrioritySchema.default('medium'),
  channels: z.array(notificationChannelSchema).default(['push']),
  conditions: z.object({
    targetPrice: z.number().positive().optional(),
    percentageDrop: z.number().nonnegative().max(100).optional(),
    historicalLow: z.boolean().default(false),
    platforms: z.array(z.string()).optional(),
    minRating: z.number().min(1).max(5).optional(),
    stockStatus: z.enum(['in_stock', 'out_of_stock', 'back_in_stock']).optional(),
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
  expiresAt: z.date().optional(),
});

// Alert filter configuration
export const AlertFilterSchema = z.object({
  userId: z.string().uuid(),
  status: alertStatusSchema.optional(),
  type: alertTypeSchema.optional(),
  priority: alertPrioritySchema.optional(),
  productId: z.string().uuid().optional(),
  active: z.boolean().optional(),
  page: z.number().positive().default(1),
  limit: z.number().positive().max(100).default(20),
});

// Alert notification request
export const AlertNotificationSchema = z.object({
  alertId: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  channels: z.array(notificationChannelSchema),
  data: z.record(z.unknown()).optional(),
  priority: alertPrioritySchema.default('medium'),
  scheduledAt: z.date().optional(),
});

// Alert batch processing configuration
export const AlertBatchConfigSchema = z.object({
  batchSize: z.number().positive().max(1000).default(100),
  maxRetries: z.number().nonnegative().default(3),
  retryDelayMs: z.number().positive().default(1000),
  timeoutMs: z.number().positive().default(30000),
});

// TypeScript types
export type AlertCreationConfig = z.infer<typeof AlertCreationConfigSchema>;
export type AlertFilter = z.infer<typeof AlertFilterSchema>;
export type AlertNotification = z.infer<typeof AlertNotificationSchema>;
export type AlertBatchConfig = z.infer<typeof AlertBatchConfigSchema>;

// Alert delivery result
export interface AlertDeliveryResult {
  alertId: string;
  channel: NotificationChannel;
  success: boolean;
  deliveredAt?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

// Alert statistics
export interface AlertStatistics {
  totalAlerts: number;
  activeAlerts: number;
  sentToday: number;
  deliveredToday: number;
  failedToday: number;
  byType: Record<AlertType, number>;
  byChannel: Record<NotificationChannel, number>;
  averageDeliveryTime: number;
}

// Alert service class
export class AlertService {
  private batchConfig: AlertBatchConfig;
  private notificationQueue: Map<string, AlertNotification[]> = new Map();
  private deliveryStats: Map<string, AlertDeliveryResult[]> = new Map();

  constructor(batchConfig: Partial<AlertBatchConfig> = {}) {
    this.batchConfig = AlertBatchConfigSchema.parse(batchConfig);
  }

  // Core alert management methods
  async createAlert(config: AlertCreationConfig): Promise<Alert> {
    // Validate user doesn't exceed alert limits
    await this.validateUserAlertLimits(config.userId);

    const now = new Date();
    const alert: Alert = {
      id: crypto.randomUUID(),
      userId: config.userId,
      productId: config.productId,
      type: config.type,
      priority: config.priority,
      status: 'pending',
      title: this.generateAlertTitle(config.type, config.productId),
      message: this.generateAlertMessage(config.type, config.conditions),
      alertData: {
        conditions: config.conditions,
        schedule: config.schedule,
        channels: config.channels,
      },
      createdAt: now.toISOString(),
      scheduledAt: now.toISOString(),
      deliveryAttempts: 0,
      maxDeliveryAttempts: 3,
    };

    // Save alert to database (mock implementation)
    await this.saveAlert(alert);

    return alert;
  }

  async updateAlert(alertId: string, updates: Partial<Alert>): Promise<Alert | null> {
    const existingAlert = await this.getAlert(alertId);
    if (!existingAlert) return null;

    const updatedAlert: Alert = {
      ...existingAlert,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.saveAlert(updatedAlert);
    return updatedAlert;
  }

  async deleteAlert(alertId: string): Promise<boolean> {
    const alert = await this.getAlert(alertId);
    if (!alert) return false;

    // Mark as cancelled rather than hard delete
    await this.updateAlert(alertId, { status: 'cancelled' });
    return true;
  }

  async getAlert(alertId: string): Promise<Alert | null> {
    // In real implementation, this would query the database
    // For now, return mock data
    return null;
  }

  async getUserAlerts(filter: AlertFilter): Promise<{
    alerts: Alert[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    // In real implementation, this would query the database with filters
    const mockAlerts: Alert[] = [];
    const total = mockAlerts.length;
    const totalPages = Math.ceil(total / filter.limit);

    return {
      alerts: mockAlerts,
      total,
      page: filter.page,
      totalPages,
    };
  }

  // Alert processing and delivery
  async processAlerts(): Promise<AlertDeliveryResult[]> {
    const pendingAlerts = await this.getPendingAlerts();
    const results: AlertDeliveryResult[] = [];

    for (const alert of pendingAlerts) {
      const deliveryResults = await this.processAlert(alert);
      results.push(...deliveryResults);
    }

    return results;
  }

  private async getPendingAlerts(): Promise<Alert[]> {
    // In real implementation, this would query for alerts ready to be sent
    return [];
  }

  private async processAlert(alert: Alert): Promise<AlertDeliveryResult[]> {
    const results: AlertDeliveryResult[] = [];
    const channels = alert.alertData?.channels as NotificationChannel[] || ['push'];

    // Check quiet hours
    if (this.isQuietHours(alert)) {
      return [{
        alertId: alert.id,
        channel: 'push',
        success: false,
        error: 'Quiet hours - delivery postponed',
      }];
    }

    // Check cooldown
    if (await this.isInCooldown(alert.userId, alert.productId)) {
      return [{
        alertId: alert.id,
        channel: 'push',
        success: false,
        error: 'Cooldown period active',
      }];
    }

    for (const channel of channels) {
      const result = await this.deliverAlert(alert, channel);
      results.push(result);
    }

    // Update alert status
    const allSuccessful = results.every(r => r.success);
    await this.updateAlert(alert.id, {
      status: allSuccessful ? 'sent' : 'failed',
      deliveryAttempts: alert.deliveryAttempts + 1,
      sentAt: allSuccessful ? new Date().toISOString() : undefined,
    });

    return results;
  }

  private async deliverAlert(alert: Alert, channel: NotificationChannel): Promise<AlertDeliveryResult> {
    const startTime = Date.now();

    try {
      let delivered = false;
      let error: string | undefined;

      switch (channel) {
        case 'push':
          delivered = await this.deliverPushNotification(alert);
          break;
        case 'email':
          delivered = await this.deliverEmailNotification(alert);
          break;
        case 'sms':
          delivered = await this.deliverSMSNotification(alert);
          break;
        case 'in_app':
          delivered = await this.deliverInAppNotification(alert);
          break;
        default:
          throw new Error(`Unsupported notification channel: ${channel}`);
      }

      const deliveryTime = Date.now() - startTime;

      return {
        alertId: alert.id,
        channel,
        success: delivered,
        deliveredAt: delivered ? new Date() : undefined,
        error: delivered ? undefined : error,
        metadata: { deliveryTime },
      };

    } catch (error) {
      return {
        alertId: alert.id,
        channel,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown delivery error',
        metadata: { deliveryTime: Date.now() - startTime },
      };
    }
  }

  // Notification channel implementations
  private async deliverPushNotification(alert: Alert): Promise<boolean> {
    // In real implementation, this would use FCM, APNs, or Expo Push
    console.log(`Sending push notification for alert ${alert.id}: ${alert.title}`);
    return true;
  }

  private async deliverEmailNotification(alert: Alert): Promise<boolean> {
    // In real implementation, this would use SendGrid, AWS SES, etc.
    console.log(`Sending email notification for alert ${alert.id}: ${alert.title}`);
    return true;
  }

  private async deliverSMSNotification(alert: Alert): Promise<boolean> {
    // In real implementation, this would use Twilio, AWS SNS, etc.
    console.log(`Sending SMS notification for alert ${alert.id}: ${alert.title}`);
    return true;
  }

  private async deliverInAppNotification(alert: Alert): Promise<boolean> {
    // In real implementation, this would store in database for app to fetch
    console.log(`Creating in-app notification for alert ${alert.id}: ${alert.title}`);
    return true;
  }

  // Alert validation and business logic
  private async validateUserAlertLimits(userId: string): Promise<void> {
    const userAlerts = await this.getUserAlerts({
      userId,
      active: true,
      page: 1,
      limit: 1,
    });

    // In real implementation, check against user subscription limits
    const maxAlerts = 50; // Free tier limit
    if (userAlerts.total >= maxAlerts) {
      throw new Error(`Maximum number of alerts (${maxAlerts}) exceeded`);
    }
  }

  private isQuietHours(alert: Alert): boolean {
    const quietHours = alert.alertData?.schedule?.quietHours;
    if (!quietHours) return false;

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return currentTime >= quietHours.start && currentTime <= quietHours.end;
  }

  private async isInCooldown(userId: string, productId: string): Promise<boolean> {
    // In real implementation, this would check recent alert history
    const cooldownMinutes = 60; // Default cooldown
    const recentAlerts = await this.getRecentAlerts(userId, productId, cooldownMinutes);
    return recentAlerts.length > 0;
  }

  private async getRecentAlerts(userId: string, productId: string, minutes: number): Promise<Alert[]> {
    // In real implementation, this would query recent alerts for the same product
    return [];
  }

  // Alert content generation
  private generateAlertTitle(type: AlertType, productId: string): string {
    const titles: Record<AlertType, string> = {
      price_drop: 'Price Drop Alert',
      historical_low: 'Historical Low Price',
      stock_available: 'Back in Stock',
      back_in_stock: 'Available Again',
      price_target: 'Target Price Reached',
    };

    return titles[type] || 'Price Alert';
  }

  private generateAlertMessage(type: AlertType, conditions: any): string {
    const messages: Record<AlertType, string> = {
      price_drop: `Price has dropped! Check out the new pricing for this product.`,
      historical_low: `This product is at its lowest price in 90 days!`,
      stock_available: `Good news! This product is now available.`,
      back_in_stock: `This product is back in stock and ready to order.`,
      price_target: `Target price reached for this product!`,
    };

    return messages[type] || 'Price alert for your watched product.';
  }

  // Alert scheduling and automation
  async scheduleAlertCheck(productId: string, checkInterval: number = 3600000): Promise<void> {
    // In real implementation, this would set up automated price checking
    console.log(`Scheduling alert checks for product ${productId} every ${checkInterval}ms`);
  }

  async cancelScheduledCheck(productId: string): Promise<void> {
    // In real implementation, this would cancel the scheduled check
    console.log(`Cancelling scheduled checks for product ${productId}`);
  }

  // Batch processing
  async processBatchAlerts(alertIds: string[]): Promise<AlertDeliveryResult[]> {
    const batchSize = this.batchConfig.batchSize;
    const results: AlertDeliveryResult[] = [];

    for (let i = 0; i < alertIds.length; i += batchSize) {
      const batch = alertIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (alertId) => {
          const alert = await this.getAlert(alertId);
          return alert ? this.processAlert(alert) : [];
        })
      );

      results.push(...batchResults.flat());
    }

    return results;
  }

  // Alert analytics and reporting
  async getAlertStatistics(userId?: string): Promise<AlertStatistics> {
    // In real implementation, this would query database for analytics
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return {
      totalAlerts: 0,
      activeAlerts: 0,
      sentToday: 0,
      deliveredToday: 0,
      failedToday: 0,
      byType: {
        price_drop: 0,
        historical_low: 0,
        stock_available: 0,
        back_in_stock: 0,
        price_target: 0,
      },
      byChannel: {
        push: 0,
        email: 0,
        sms: 0,
        in_app: 0,
      },
      averageDeliveryTime: 0,
    };
  }

  async getAlertDeliveryReport(alertId: string): Promise<{
    alert: Alert | null;
    deliveries: AlertDeliveryResult[];
    summary: {
      totalDeliveries: number;
      successfulDeliveries: number;
      failedDeliveries: number;
      averageDeliveryTime: number;
    };
  }> {
    const alert = await this.getAlert(alertId);
    const deliveries = this.deliveryStats.get(alertId) || [];

    const summary = {
      totalDeliveries: deliveries.length,
      successfulDeliveries: deliveries.filter(d => d.success).length,
      failedDeliveries: deliveries.filter(d => !d.success).length,
      averageDeliveryTime: deliveries.length > 0
        ? deliveries.reduce((sum, d) => sum + (d.metadata?.deliveryTime as number || 0), 0) / deliveries.length
        : 0,
    };

    return { alert, deliveries, summary };
  }

  // Alert preferences management
  async updateUserNotificationPreferences(
    userId: string,
    preferences: {
      channels: NotificationChannel[];
      quietHours: { start: string; end: string } | null;
      maxAlertsPerDay: number;
      categories: string[];
    }
  ): Promise<void> {
    // In real implementation, this would update user preferences in database
    console.log(`Updating notification preferences for user ${userId}`, preferences);
  }

  async getUserNotificationPreferences(userId: string): Promise<{
    channels: NotificationChannel[];
    quietHours: { start: string; end: string } | null;
    maxAlertsPerDay: number;
    categories: string[];
  }> {
    // In real implementation, this would fetch from database
    return {
      channels: ['push', 'email'],
      quietHours: null,
      maxAlertsPerDay: 10,
      categories: ['price_drop', 'stock_available'],
    };
  }

  // Utility methods
  private async saveAlert(alert: Alert): Promise<void> {
    // In real implementation, this would save to database
    console.log(`Saving alert ${alert.id} for user ${alert.userId}`);
  }

  async validateAlertConfig(config: AlertCreationConfig): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Validate target price
    if (config.conditions.targetPrice && config.conditions.targetPrice <= 0) {
      errors.push('Target price must be positive');
    }

    // Validate percentage drop
    if (config.conditions.percentageDrop !== undefined &&
        (config.conditions.percentageDrop < 0 || config.conditions.percentageDrop > 100)) {
      errors.push('Percentage drop must be between 0 and 100');
    }

    // Validate quiet hours
    if (config.schedule?.quietHours) {
      const { start, end } = config.schedule.quietHours;
      if (start >= end) {
        errors.push('Quiet hours start time must be before end time');
      }
    }

    // Validate expiration
    if (config.expiresAt && config.expiresAt <= new Date()) {
      errors.push('Expiration date must be in the future');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  formatAlertMessage(alert: Alert, locale: string = 'ja'): string {
    // In real implementation, this would use i18n
    const localizedMessages: Record<string, Record<AlertType, string>> = {
      ja: {
        price_drop: '価格が下がりました！新しい価格をチェックしてください。',
        historical_low: 'この商品は90日間で最安値になっています！',
        stock_available: '良いお知らせ！この商品が利用可能になりました。',
        back_in_stock: 'この商品が再び入荷され、注文できます。',
        price_target: 'この商品の目標価格に達しました！',
      },
      en: {
        price_drop: 'Price has dropped! Check out the new pricing.',
        historical_low: 'This product is at its lowest price in 90 days!',
        stock_available: 'Good news! This product is now available.',
        back_in_stock: 'This product is back in stock and ready to order.',
        price_target: 'Target price reached for this product!',
      },
    };

    return localizedMessages[locale]?.[alert.type] || alert.message;
  }
}

// Export schemas for validation
export {
  AlertCreationConfigSchema,
  AlertFilterSchema,
  AlertNotificationSchema,
  AlertBatchConfigSchema,
};

// Utility functions
export const createDefaultAlertConfig = (): Partial<AlertCreationConfig> => ({
  priority: 'medium',
  channels: ['push'],
  conditions: {
    historicalLow: false,
  },
  schedule: {
    active: true,
    maxAlertsPerDay: 10,
    cooldownMinutes: 60,
  },
});

export const validateAlertType = (type: string): type is AlertType => {
  return ['price_drop', 'historical_low', 'stock_available', 'back_in_stock', 'price_target'].includes(type);
};

export const validateNotificationChannel = (channel: string): channel is NotificationChannel => {
  return ['push', 'email', 'sms', 'in_app'].includes(channel);
};

export const calculateAlertPriority = (alert: Alert): AlertPriority => {
  // Priority calculation based on type and conditions
  switch (alert.type) {
    case 'historical_low':
      return 'high';
    case 'price_drop':
      const percentageDrop = (alert.alertData?.conditions as any)?.percentageDrop;
      return percentageDrop && percentageDrop >= 20 ? 'high' : 'medium';
    case 'stock_available':
      return 'medium';
    default:
      return 'medium';
  }
};