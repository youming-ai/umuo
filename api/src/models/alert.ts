/**
 * Alert model and related types
 * Defines the structure for price alerts and notifications
 */

import { z } from 'zod';

// Alert types
export const alertTypeSchema = z.enum(['price_drop', 'historical_low', 'stock_available', 'back_in_stock', 'price_target']);
export type AlertType = z.infer<typeof alertTypeSchema>;

// Alert priorities
export const alertPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type AlertPriority = z.infer<typeof alertPrioritySchema>;

// Alert statuses
export const alertStatusSchema = z.enum(['pending', 'sent', 'delivered', 'failed', 'cancelled']);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

// Notification channels
export const notificationChannelSchema = z.enum(['push', 'email', 'sms', 'in_app']);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

// Base alert schema
export const alertSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  type: alertTypeSchema,
  priority: alertPrioritySchema.default('medium'),
  status: alertStatusSchema.default('pending'),

  // Alert content
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),

  // Alert data
  alertData: z.record(z.unknown()).optional(),

  // Timestamps
  createdAt: z.string().datetime(),
  scheduledAt: z.string().datetime().optional(),
  sentAt: z.string().datetime().optional(),
  deliveredAt: z.string().datetime().optional(),

  // Delivery tracking
  deliveryAttempts: z.number().nonnegative().default(0),
  maxDeliveryAttempts: z.number().positive().default(3),
  lastDeliveryAttempt: z.string().datetime().optional(),

  // Channels
  channels: z.array(notificationChannelSchema).default(['push']),

  // Metadata
  metadata: z.record(z.unknown()).optional()
});

export type Alert = z.infer<typeof alertSchema>;

// Price alert condition
export const priceAlertConditionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  type: z.enum(['below_target', 'above_target', 'historical_low', 'percentage_drop']),

  // Condition parameters
  targetPrice: z.number().positive().optional(),
  percentage: z.number().positive().optional(),

  // Activation
  isActive: z.boolean().default(true),

  // Timestamps
  createdAt: z.string().datetime(),
  triggeredAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),

  // Metadata
  lastTriggeredPrice: z.number().positive().optional(),
  totalTriggers: z.number().nonnegative().default(0)
});

export type PriceAlertCondition = z.infer<typeof priceAlertConditionSchema>;

// Stock alert condition
export const stockAlertConditionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  productId: z.string().uuid(),
  type: z.enum(['back_in_stock', 'low_stock', 'out_of_stock']),

  // Activation
  isActive: z.boolean().default(true),

  // Timestamps
  createdAt: z.string().datetime(),
  triggeredAt: z.string().datetime().optional(),

  // Stock thresholds (for low_stock alerts)
  threshold: z.number().positive().optional(),

  // Metadata
  lastKnownStock: z.number().nonnegative().optional(),
  totalTriggers: z.number().nonnegative().default(0)
});

export type StockAlertCondition = z.infer<typeof stockAlertConditionSchema>;

// Notification template
export const notificationTemplateSchema = z.object({
  id: z.string().uuid(),
  type: alertTypeSchema,
  language: z.string().length(2).default('ja'),

  // Template content
  titleTemplate: z.string().min(1).max(200),
  messageTemplate: z.string().min(1).max(1000),

  // Template variables (for validation)
  requiredVariables: z.array(z.string()).default([]),
  optionalVariables: z.array(z.string()).default([]),

  // Channel-specific templates
  channelTemplates: z.record(z.object({
    title: z.string().max(200),
    message: z.string().max(1000),
    actionUrl: z.string().url().optional(),
    actionText: z.string().max(50).optional()
  })).default({}),

  // Metadata
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

// User notification preferences
export const notificationPreferencesSchema = z.object({
  userId: z.string().uuid(),

  // Channel preferences
  enabledChannels: z.array(notificationChannelSchema).default(['push']),

  // Type preferences
  typePreferences: z.record(z.object({
    enabled: z.boolean(),
    priority: alertPrioritySchema.default('medium'),
    quietHours: z.object({
      enabled: z.boolean().default(false),
      start: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
      end: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional()
    }).default({}),
    maxPerDay: z.number().positive().optional()
  })).default({}),

  // Global settings
  quietHours: z.object({
    enabled: z.boolean().default(false),
    start: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    end: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
    timezone: z.string().optional()
  }).default({}),

  // Frequency controls
  maxNotificationsPerDay: z.number().positive().default(50),
  maxNotificationsPerHour: z.number().positive().default(10),

  // Metadata
  updatedAt: z.string().datetime()
});

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

// Alert delivery result
export const alertDeliveryResultSchema = z.object({
  alertId: z.string().uuid(),
  channel: notificationChannelSchema,
  status: z.enum(['success', 'failed', 'retry_later']),
  messageId: z.string().optional(),
  error: z.string().optional(),
  deliveredAt: z.string().datetime().optional(),
  responseTime: z.number().nonnegative().optional() // in milliseconds
});

export type AlertDeliveryResult = z.infer<typeof alertDeliveryResultSchema>;

// Alert statistics
export const alertStatisticsSchema = z.object({
  userId: z.string().uuid(),
  period: z.enum(['daily', 'weekly', 'monthly']),

  // Counts
  totalSent: z.number().nonnegative(),
  totalDelivered: z.number().nonnegative(),
  totalFailed: z.number().nonnegative(),

  // By type
  byType: z.record(z.object({
    sent: z.number().nonnegative(),
    delivered: z.number().nonnegative(),
    failed: z.number().nonnegative()
  })).default({}),

  // By channel
  byChannel: z.record(z.object({
    sent: z.number().nonnegative(),
    delivered: z.number().nonnegative(),
    failed: z.number().nonnegative()
  })).default({}),

  // Performance metrics
  averageDeliveryTime: z.number().nonnegative(), // in milliseconds
  deliveryRate: z.number().min(0).max(1),

  // Period
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),

  // Generated at
  generatedAt: z.string().datetime()
});

export type AlertStatistics = z.infer<typeof alertStatisticsSchema>;

export class AlertModel {
  /**
   * Create a new alert
   */
  static create(alertData: Omit<Alert, 'id' | 'createdAt' | 'deliveryAttempts'>): Alert {
    return {
      ...alertData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      deliveryAttempts: 0
    };
  }

  /**
   * Validate alert data
   */
  static validate(alertData: unknown): Alert {
    return alertSchema.parse(alertData);
  }

  /**
   * Create price alert condition
   */
  static createPriceCondition(conditionData: Omit<PriceAlertCondition, 'id' | 'createdAt' | 'totalTriggers'>): PriceAlertCondition {
    return {
      ...conditionData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      totalTriggers: 0
    };
  }

  /**
   * Create stock alert condition
   */
  static createStockCondition(conditionData: Omit<StockAlertCondition, 'id' | 'createdAt' | 'totalTriggers'>): StockAlertCondition {
    return {
      ...conditionData,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      totalTriggers: 0
    };
  }

  /**
   * Check if alert can be sent (within quiet hours and limits)
   */
  static canSendAlert(
    alert: Alert,
    preferences: NotificationPreferences,
    recentAlertsCount: number = 0
  ): boolean {
    // Check if alert is still pending
    if (alert.status !== 'pending') return false;

    // Check quiet hours
    if (preferences.quietHours.enabled && this.isInQuietHours(preferences.quietHours)) {
      return false;
    }

    // Check type-specific quiet hours
    const typePreference = preferences.typePreferences[alert.type];
    if (typePreference?.quietHours?.enabled && this.isInQuietHours(typePreference.quietHours)) {
      return false;
    }

    // Check frequency limits
    if (recentAlertsCount >= preferences.maxNotificationsPerHour) {
      return false;
    }

    return true;
  }

  /**
   * Check if current time is within quiet hours
   */
  private static isInQuietHours(quietHours: {
    start?: string;
    end?: string;
    timezone?: string;
  }): boolean {
    if (!quietHours.start || !quietHours.end) return false;

    const now = new Date();
    const currentTime = this.getTimeInTimezone(now, quietHours.timezone || 'UTC');
    const currentHour = currentTime.getHours();
    const currentMinute = currentTime.getMinutes();
    const currentMinutes = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = quietHours.start.split(':').map(Number);
    const [endHour, endMinute] = quietHours.end.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    if (startMinutes <= endMinutes) {
      // Same day range (e.g., 22:00 - 06:00)
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Overnight range (e.g., 22:00 - 06:00 next day)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  }

  /**
   * Get time in specified timezone
   */
  private static getTimeInTimezone(date: Date, timezone: string): Date {
    try {
      return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    } catch {
      return date; // Fallback to UTC if timezone is invalid
    }
  }

  /**
   * Format alert message with template variables
   */
  static formatMessage(
    template: string,
    variables: Record<string, any>
  ): string {
    let formatted = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      formatted = formatted.replace(new RegExp(placeholder, 'g'), String(value));
    }

    return formatted;
  }

  /**
   * Check if alert should be retried
   */
  static shouldRetry(alert: Alert): boolean {
    return alert.status === 'failed' &&
           alert.deliveryAttempts < alert.maxDeliveryAttempts;
  }

  /**
   * Calculate next retry time with exponential backoff
   */
  static calculateNextRetryTime(alert: Alert): Date {
    const baseDelayMs = 5 * 60 * 1000; // 5 minutes
    const maxDelayMs = 24 * 60 * 60 * 1000; // 24 hours

    const exponentialDelay = Math.min(
      baseDelayMs * Math.pow(2, alert.deliveryAttempts),
      maxDelayMs
    );

    const nextRetry = new Date();
    nextRetry.setTime(nextRetry.getTime() + exponentialDelay);

    return nextRetry;
  }

  /**
   * Determine alert priority based on type and data
   */
  static determinePriority(type: AlertType, alertData?: Record<string, any>): AlertPriority {
    switch (type) {
      case 'historical_low':
        return 'urgent';
      case 'price_drop':
        const percentage = alertData?.percentageDrop || 0;
        if (percentage >= 30) return 'urgent';
        if (percentage >= 15) return 'high';
        return 'medium';
      case 'stock_available':
        return 'high';
      case 'back_in_stock':
        return 'high';
      case 'price_target':
        return 'medium';
      default:
        return 'medium';
    }
  }

  /**
   * Get default channels for alert type
   */
  static getDefaultChannels(type: AlertType): NotificationChannel[] {
    switch (type) {
      case 'historical_low':
      case 'price_drop':
        return ['push', 'email'];
      case 'stock_available':
      case 'back_in_stock':
        return ['push'];
      case 'price_target':
        return ['push'];
      default:
        return ['push'];
    }
  }

  /**
   * Create alert statistics for a period
   */
  static createStatistics(
    userId: string,
    period: 'daily' | 'weekly' | 'monthly',
    alerts: Alert[],
    deliveryResults: AlertDeliveryResult[]
  ): AlertStatistics {
    const filteredAlerts = alerts.filter(alert => alert.userId === userId);

    // Determine date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'weekly':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const periodAlerts = filteredAlerts.filter(alert =>
      new Date(alert.createdAt) >= startDate
    );

    const periodResults = deliveryResults.filter(result =>
      new Date(result.deliveredAt || 0) >= startDate
    );

    // Calculate statistics
    const totalSent = periodAlerts.length;
    const totalDelivered = periodResults.filter(r => r.status === 'success').length;
    const totalFailed = periodResults.filter(r => r.status === 'failed').length;

    // Group by type
    const byType: Record<string, { sent: number; delivered: number; failed: number }> = {};
    for (const alert of periodAlerts) {
      if (!byType[alert.type]) {
        byType[alert.type] = { sent: 0, delivered: 0, failed: 0 };
      }
      byType[alert.type].sent++;
    }

    for (const result of periodResults) {
      const alert = periodAlerts.find(a => a.id === result.alertId);
      if (alert && byType[alert.type]) {
        if (result.status === 'success') {
          byType[alert.type].delivered++;
        } else if (result.status === 'failed') {
          byType[alert.type].failed++;
        }
      }
    }

    // Group by channel
    const byChannel: Record<string, { sent: number; delivered: number; failed: number }> = {};
    for (const result of periodResults) {
      if (!byChannel[result.channel]) {
        byChannel[result.channel] = { sent: 0, delivered: 0, failed: 0 };
      }

      const alert = periodAlerts.find(a => a.id === result.alertId);
      if (alert && alert.channels.includes(result.channel)) {
        byChannel[result.channel].sent++;
        if (result.status === 'success') {
          byChannel[result.channel].delivered++;
        } else if (result.status === 'failed') {
          byChannel[result.channel].failed++;
        }
      }
    }

    // Calculate average delivery time
    const successfulDeliveries = periodResults.filter(r => r.status === 'success' && r.responseTime);
    const averageDeliveryTime = successfulDeliveries.length > 0
      ? successfulDeliveries.reduce((sum, r) => sum + (r.responseTime || 0), 0) / successfulDeliveries.length
      : 0;

    const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : 0;

    return {
      userId,
      period,
      totalSent,
      totalDelivered,
      totalFailed,
      byType,
      byChannel,
      averageDeliveryTime,
      deliveryRate,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      generatedAt: now.toISOString()
    };
  }
}