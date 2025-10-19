/**
 * Analytics Service
 * Comprehensive analytics and user behavior tracking service
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

export interface AnalyticsEvent {
  name: string;
  parameters?: Record<string, any>;
  timestamp?: number;
}

export interface UserProperties {
  userId?: string;
  version?: string;
  buildNumber?: string;
  platform?: string;
  osVersion?: string;
  deviceModel?: string;
  language?: string;
  timezone?: string;
  [key: string]: any;
}

interface ScreenView {
  screenName: string;
  screenClass?: string;
  parameters?: Record<string, any>;
}

interface EcommerceEvent {
  type: 'purchase' | 'view_item' | 'add_to_cart' | 'begin_checkout' | 'search' | 'select_item';
  parameters: {
    transaction_id?: string;
    value?: number;
    currency?: string;
    items?: Array<{
      item_id?: string;
      item_name?: string;
      category?: string;
      quantity?: number;
      price?: number;
      brand?: string;
      variant?: string;
    }>;
    search_term?: string;
    [key: string]: any;
  };
}

class AnalyticsService {
  private static instance: AnalyticsService;
  private isInitialized = false;
  private userId: string | null = null;
  private userProperties: UserProperties = {};
  private eventQueue: AnalyticsEvent[] = [];
  private maxQueueSize = 100;
  private flushInterval: NodeJS.Timeout | null = null;

  static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  /**
   * Initialize analytics service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize platform-specific analytics
      await this.initializePlatformAnalytics();

      // Set default user properties
      this.setDefaultUserProperties();

      // Start periodic flush
      this.startPeriodicFlush();

      this.isInitialized = true;
      console.log('Analytics service initialized');
    } catch (error) {
      console.error('Failed to initialize analytics service:', error);
    }
  }

  /**
   * Initialize platform-specific analytics providers
   */
  private async initializePlatformAnalytics(): Promise<void> {
    // This would integrate with analytics providers like:
    // - Firebase Analytics
    // - Amplitude
    // - Mixpanel
    // - Segment
    // - Custom analytics API

    // Example for Firebase Analytics:
    // import { initializeApp } from 'firebase/app';
    // import { getAnalytics } from 'firebase/analytics';
    // const app = initializeApp(firebaseConfig);
    // const analytics = getAnalytics(app);

    // Example for Amplitude:
    // import * as amplitude from '@amplitude/analytics-react-native';
    // await amplitude.init(amplitudeApiKey);

    console.log('Platform analytics initialized');
  }

  /**
   * Set default user properties
   */
  private setDefaultUserProperties(): void {
    this.userProperties = {
      platform: Platform.OS,
      osVersion: Platform.Version as string,
      version: Constants.expoConfig?.version || 'unknown',
      buildNumber: Constants.expoConfig?.android?.versionCode || Constants.expoConfig?.ios?.buildNumber,
      deviceModel: Platform.select({
        ios: Constants.platform?.ios?.model,
        android: Constants.deviceName,
        default: 'unknown',
      }),
      language: Platform.select({
        ios: Constants.platform?.ios?.locale,
        android: Constants.platform?.android?.locale,
        default: 'unknown',
      }),
    };

    // Set user properties in analytics providers
    this.setUserProperties(this.userProperties);
  }

  /**
   * Set user ID for analytics
   */
  setUserId(userId: string): void {
    this.userId = userId;
    this.userProperties.userId = userId;

    // Set user ID in analytics providers
    // setUserId(userId); // Firebase
    // amplitude.setUserId(userId); // Amplitude
  }

  /**
   * Clear user ID
   */
  clearUserId(): void {
    this.userId = null;
    delete this.userProperties.userId;

    // Clear user ID in analytics providers
    // setUserId(null); // Firebase
    // amplitude.setUserId(null); // Amplitude
  }

  /**
   * Set user properties
   */
  setUserProperties(properties: Partial<UserProperties>): void {
    this.userProperties = { ...this.userProperties, ...properties };

    // Set user properties in analytics providers
    // setUserProperties(properties); // Firebase
    // amplitude.setUserProperties(properties); // Amplitude
  }

  /**
   * Track custom event
   */
  async trackEvent(eventName: string, parameters?: Record<string, any>): Promise<void> {
    const event: AnalyticsEvent = {
      name: eventName,
      parameters: {
        ...parameters,
        timestamp: Date.now(),
        userId: this.userId,
        platform: Platform.OS,
      },
    };

    if (!this.isInitialized) {
      this.queueEvent(event);
      return;
    }

    try {
      await this.sendEvent(event);
    } catch (error) {
      console.error('Failed to track event:', error);
      this.queueEvent(event);
    }
  }

  /**
   * Track screen view
   */
  async trackScreen(screenName: string, screenClass?: string, parameters?: Record<string, any>): Promise<void> {
    const event: AnalyticsEvent = {
      name: 'screen_view',
      parameters: {
        screen_name: screenName,
        screen_class: screenClass || screenName,
        ...parameters,
      },
    };

    await this.trackEvent(event.name, event.parameters);
  }

  /**
   * Track user engagement
   */
  async trackEngagement(type: string, target?: string, parameters?: Record<string, any>): Promise<void> {
    await this.trackEvent('user_engagement', {
      engagement_type: type,
      target,
      ...parameters,
    });
  }

  /**
   * Track search events
   */
  async trackSearch(query: string, resultsCount: number, filters?: Record<string, any>): Promise<void> {
    await this.trackEvent('search', {
      search_term: query,
      results_count: resultsCount,
      filters: JSON.stringify(filters || {}),
    });
  }

  /**
   * Track product interactions
   */
  async trackProductEvent(eventName: string, productId: string, productInfo?: Record<string, any>): Promise<void> {
    await this.trackEvent(eventName, {
      product_id: productId,
      ...productInfo,
    });
  }

  /**
   * Track price interactions
   */
  async trackPriceEvent(eventName: string, productId: string, price: number, currency: string = 'JPY'): Promise<void> {
    await this.trackEvent(eventName, {
      product_id: productId,
      price,
      currency,
    });
  }

  /**
   * Track barcode scanning
   */
  async trackBarcodeScan(barcode: string, barcodeType: string, success: boolean, productFound?: boolean): Promise<void> {
    await this.trackEvent('barcode_scan', {
      barcode,
      barcode_type: barcodeType,
      success,
      product_found: productFound,
    });
  }

  /**
   * Track notification interactions
   */
  async trackNotification(action: string, type: string, data?: Record<string, any>): Promise<void> {
    await this.trackEvent('notification_interaction', {
      action,
      type,
      data: JSON.stringify(data || {}),
    });
  }

  /**
   * Track error events
   */
  async trackError(error: Error, context?: Record<string, any>): Promise<void> {
    await this.trackEvent('app_error', {
      error_message: error.message,
      error_stack: error.stack,
      context: JSON.stringify(context || {}),
    });
  }

  /**
   * Track performance metrics
   */
  async trackPerformance(metric: string, value: number, unit?: string): Promise<void> {
    await this.trackEvent('performance_metric', {
      metric_name: metric,
      value,
      unit,
    });
  }

  /**
   * E-commerce event tracking
   */
  async trackEcommerceEvent(event: EcommerceEvent): Promise<void> {
    await this.trackEvent(`ecommerce_${event.type}`, event.parameters);
  }

  /**
   * Track product view
   */
  async trackProductView(productId: string, productName: string, category?: string, price?: number): Promise<void> {
    await this.trackEcommerceEvent({
      type: 'view_item',
      parameters: {
        items: [{
          item_id: productId,
          item_name: productName,
          category,
          price,
        }],
      },
    });
  }

  /**
   * Track add to cart
   */
  async trackAddToCart(productId: string, productName: string, price: number, quantity: number = 1): Promise<void> {
    await this.trackEcommerceEvent({
      type: 'add_to_cart',
      parameters: {
        currency: 'JPY',
        value: price * quantity,
        items: [{
          item_id: productId,
          item_name: productName,
          price,
          quantity,
        }],
      },
    });
  }

  /**
   * Track purchase
   */
  async trackPurchase(transactionId: string, items: Array<{
    productId: string;
    productName: string;
    price: number;
    quantity: number;
  }>): Promise<void> {
    const totalValue = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    await this.trackEcommerceEvent({
      type: 'purchase',
      parameters: {
        transaction_id: transactionId,
        currency: 'JPY',
        value: totalValue,
        items: items.map(item => ({
          item_id: item.productId,
          item_name: item.productName,
          price: item.price,
          quantity: item.quantity,
        })),
      },
    });
  }

  /**
   * Queue event for later sending
   */
  private queueEvent(event: AnalyticsEvent): void {
    this.eventQueue.push(event);

    // Remove oldest events if queue is too large
    if (this.eventQueue.length > this.maxQueueSize) {
      this.eventQueue.shift();
    }
  }

  /**
   * Send event to analytics providers
   */
  private async sendEvent(event: AnalyticsEvent): Promise<void> {
    // Send to Firebase Analytics
    // logEvent(getAnalytics(), event.name, event.parameters);

    // Send to Amplitude
    // amplitude.track(event.name, event.parameters);

    // Send to custom API
    // await fetch('https://api.yabaii.day/analytics/events', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify(event),
    // });

    console.log('Analytics event tracked:', event);
  }

  /**
   * Start periodic flush of queued events
   */
  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flushEvents();
    }, 30000); // Flush every 30 seconds
  }

  /**
   * Flush queued events
   */
  async flushEvents(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return;
    }

    const events = [...this.eventQueue];
    this.eventQueue = [];

    for (const event of events) {
      try {
        await this.sendEvent(event);
      } catch (error) {
        console.error('Failed to send queued event:', error);
      }
    }
  }

  /**
   * Get analytics session info
   */
  getSessionInfo(): {
    userId: string | null;
    userProperties: UserProperties;
    queuedEventsCount: number;
    isInitialized: boolean;
  } {
    return {
      userId: this.userId,
      userProperties: this.userProperties,
      queuedEventsCount: this.eventQueue.length,
      isInitialized: this.isInitialized,
    };
  }

  /**
   * Enable/disable analytics collection
   */
  setAnalyticsCollectionEnabled(enabled: boolean): void {
    // This would control analytics collection in providers
    // setAnalyticsCollectionEnabled(enabled); // Firebase
    // amplitude.setTrackingEnabled(enabled); // Amplitude

    if (!enabled) {
      // Clear queued events when disabled
      this.eventQueue = [];
    }
  }

  /**
   * Opt out of analytics collection
   */
  optOut(): void {
    this.setAnalyticsCollectionEnabled(false);
    this.clearUserId();
    this.userProperties = {};
  }

  /**
   * Opt in to analytics collection
   */
  optIn(): void {
    this.setAnalyticsCollectionEnabled(true);
    this.setDefaultUserProperties();
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Flush remaining events
    await this.flushEvents();

    this.isInitialized = false;
    this.userId = null;
    this.userProperties = {};
    this.eventQueue = [];
  }
}

export default AnalyticsService.getInstance();