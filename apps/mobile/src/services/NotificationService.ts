/**
 * Notification Service
 * Handles push notifications for the Yabaii mobile app
 */

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../api/client';

// Storage keys
const PUSH_TOKEN_KEY = 'push_token';
const NOTIFICATION_PERMISSIONS_KEY = 'notification_permissions';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface NotificationData {
  type: 'price_drop' | 'product_available' | 'deal_expires' | 'price_alert' | 'general';
  productId?: string;
  productTitle?: string;
  currentPrice?: number;
  previousPrice?: number;
  discount?: number;
  platform?: string;
  alertId?: string;
  dealId?: string;
  message: string;
}

export class NotificationService {
  private static instance: NotificationService;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Initialize notification service
   */
  async initialize(): Promise<void> {
    try {
      // Request permissions
      const permissions = await this.requestPermissions();
      await AsyncStorage.setItem(NOTIFICATION_PERMISSIONS_KEY, JSON.stringify(permissions));

      // Register for push notifications
      if (permissions.granted) {
        const token = await this.registerForPushNotifications();
        if (token) {
          await this.savePushToken(token);
          await this.sendTokenToServer(token);
        }
      }

      // Set up notification listeners
      this.setupNotificationListeners();

      console.log('Notification service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize notification service:', error);
      throw error;
    }
  }

  /**
   * Request notification permissions
   */
  async requestPermissions(): Promise<Notifications.PermissionStatus> {
    if (Platform.OS === 'ios') {
      const { status } = await Notifications.requestPermissionsAsync();
      return status;
    } else {
      // Android permissions are granted at install time
      return Notifications.PermissionStatus.GRANTED;
    }
  }

  /**
   * Check notification permissions
   */
  async checkPermissions(): Promise<Notifications.PermissionStatus> {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  }

  /**
   * Register for push notifications
   */
  async registerForPushNotifications(): Promise<string | null> {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('price-alerts', {
          name: 'Price Alerts',
          description: 'Notifications for price drops and alerts',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: 'default',
        });

        await Notifications.setNotificationChannelAsync('deals', {
          name: 'Deals and Promotions',
          description: 'Notifications for new deals and promotions',
          importance: Notifications.AndroidImportance.DEFAULT,
          sound: 'default',
        });

        await Notifications.setNotificationChannelAsync('general', {
          name: 'General Notifications',
          description: 'General app notifications',
          importance: Notifications.AndroidImportance.LOW,
          sound: 'default',
        });
      }

      const token = await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig?.extra?.eas?.projectId,
      });

      return token.data;
    } catch (error) {
      console.error('Failed to register for push notifications:', error);
      return null;
    }
  }

  /**
   * Save push token locally
   */
  private async savePushToken(token: string): Promise<void> {
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  }

  /**
   * Get saved push token
   */
  async getPushToken(): Promise<string | null> {
    return AsyncStorage.getItem(PUSH_TOKEN_KEY);
  }

  /**
   * Send push token to server
   */
  private async sendTokenToServer(token: string): Promise<void> {
    try {
      await apiClient.post('/notifications/register', {
        token,
        platform: Platform.OS,
      });
      console.log('Push token sent to server successfully');
    } catch (error) {
      console.error('Failed to send push token to server:', error);
      // Don't throw error - app should still work without server registration
    }
  }

  /**
   * Set up notification listeners
   */
  private setupNotificationListeners(): void {
    // Handle notification received while app is foregrounded
    Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification received in foreground:', notification);
      this.handleForegroundNotification(notification);
    });

    // Handle notification response (user taps notification)
    Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('Notification response received:', response);
      this.handleNotificationResponse(response);
    });
  }

  /**
   * Handle foreground notifications
   */
  private handleForegroundNotification(notification: Notifications.Notification): void {
    const data = notification.request.content.data as NotificationData;

    // You could show an in-app notification here
    // For example, using a modal or toast notification
    console.log('Foreground notification:', data);
  }

  /**
   * Handle notification responses (user interaction)
   */
  private handleNotificationResponse(response: Notifications.NotificationResponse): void {
    const data = response.notification.request.content.data as NotificationData;

    // Navigate to appropriate screen based on notification type
    switch (data.type) {
      case 'price_drop':
      case 'product_available':
      case 'price_alert':
        if (data.productId) {
          // Navigate to product details
          // This would typically use your navigation library
          console.log('Navigate to product:', data.productId);
        }
        break;

      case 'deal_expires':
        if (data.dealId) {
          // Navigate to deal details
          console.log('Navigate to deal:', data.dealId);
        }
        break;

      case 'general':
        // Navigate to general notifications screen
        console.log('Navigate to notifications');
        break;
    }
  }

  /**
   * Schedule local notification
   */
  async scheduleLocalNotification(
    title: string,
    body: string,
    data: NotificationData,
    options?: {
      schedule?: Notifications.ScheduleInput;
      channelId?: string;
      sound?: string;
    }
  ): Promise<string | null> {
    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: options?.sound || 'default',
        },
        trigger: options?.schedule || null,
      });

      console.log('Local notification scheduled:', notificationId);
      return notificationId;
    } catch (error) {
      console.error('Failed to schedule local notification:', error);
      return null;
    }
  }

  /**
   * Cancel scheduled notification
   */
  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      console.log('Notification cancelled:', notificationId);
    } catch (error) {
      console.error('Failed to cancel notification:', error);
    }
  }

  /**
   * Get badge count
   */
  async getBadgeCount(): Promise<number> {
    return Notifications.getBadgeCountAsync();
  }

  /**
   * Set badge count
   */
  async setBadgeCount(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(count);
  }

  /**
   * Clear all notifications
   */
  async clearAllNotifications(): Promise<void> {
    await Notifications.dismissAllNotificationsAsync();
    await this.setBadgeCount(0);
  }

  /**
   * Send test notification (development only)
   */
  async sendTestNotification(): Promise<void> {
    if (!__DEV__) return;

    await this.scheduleLocalNotification(
      'Test Notification',
      'This is a test notification from Yabaii',
      {
        type: 'general',
        message: 'Test notification',
      }
    );
  }

  /**
   * Subscribe to price alerts for a product
   */
  async subscribeToPriceAlerts(productId: string): Promise<void> {
    try {
      await apiClient.post('/notifications/subscribe', {
        type: 'price_alert',
        productId,
      });
    } catch (error) {
      console.error('Failed to subscribe to price alerts:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from price alerts for a product
   */
  async unsubscribeFromPriceAlerts(productId: string): Promise<void> {
    try {
      await apiClient.post('/notifications/unsubscribe', {
        type: 'price_alert',
        productId,
      });
    } catch (error) {
      console.error('Failed to unsubscribe from price alerts:', error);
      throw error;
    }
  }

  /**
   * Get notification preferences
   */
  async getNotificationPreferences(): Promise<{
    priceAlerts: boolean;
    deals: boolean;
    general: boolean;
    quietHours: {
      enabled: boolean;
      start: string;
      end: string;
    };
  }> {
    try {
      const response = await apiClient.get('/notifications/preferences');
      return response.data;
    } catch (error) {
      console.error('Failed to get notification preferences:', error);
      throw error;
    }
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(preferences: {
    priceAlerts?: boolean;
    deals?: boolean;
    general?: boolean;
    quietHours?: {
      enabled: boolean;
      start: string;
      end: string;
    };
  }): Promise<void> {
    try {
      await apiClient.put('/notifications/preferences', preferences);
    } catch (error) {
      console.error('Failed to update notification preferences:', error);
      throw error;
    }
  }

  /**
   * Cleanup notification service
   */
  async cleanup(): Promise<void> {
    try {
      // Cancel all scheduled notifications
      await Notifications.dismissAllNotificationsAsync();

      // Clear local storage
      await AsyncStorage.multiRemove([PUSH_TOKEN_KEY, NOTIFICATION_PERMISSIONS_KEY]);

      console.log('Notification service cleaned up');
    } catch (error) {
      console.error('Failed to cleanup notification service:', error);
    }
  }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance();
export default notificationService;