/**
 * Deep Link Service
 * Handles deep linking for the Yabaii mobile app
 */

import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

export interface DeepLinkData {
  type: 'product' | 'search' | 'deal' | 'alert' | 'profile' | 'scan' | 'compare';
  params: Record<string, any>;
  originalUrl: string;
}

export interface LinkingConfig {
  prefixes: string[];
  config: {
    screens: Record<string, string | ((params: any) => string)>;
  };
}

export class DeepLinkService {
  private static instance: DeepLinkService;
  private linkingConfig: LinkingConfig;

  private constructor() {
    this.linkingConfig = this.getLinkingConfig();
  }

  static getInstance(): DeepLinkService {
    if (!DeepLinkService.instance) {
      DeepLinkService.instance = new DeepLinkService();
    }
    return DeepLinkService.instance;
  }

  /**
   * Get linking configuration
   */
  private getLinkingConfig(): LinkingConfig {
    const appDomain = __DEV__
      ? 'localhost:8081'
      : 'yabaii.day';

    return {
      prefixes: [
        `https://${appDomain}`,
        `http://${appDomain}`,
        'yabaii://',
        'yabaii-app://',
      ],
      config: {
        screens: {
          // Product screens
          '/product/[spuId]': '/product/:spuId',
          '/compare': '/compare',

          // Search screens
          '/search': '/search',
          '/scan': '/scan',

          // Feature screens
          '/deals': '/deals',
          '/alerts': '/alerts',
          '/profile': '/profile',

          // Root tabs
          '/': '/',
          '/(tabs)/': '/(tabs)/',
          '/(tabs)/index': '/(tabs)/',
          '/(tabs)/compare': '/(tabs)/compare',
          '/(tabs)/deals': '/(tabs)/deals',
          '/(tabs)/alerts': '/(tabs)/alerts',
          '/(tabs)/profile': '/(tabs)/profile',
        },
      },
    };
  }

  /**
   * Initialize deep linking
   */
  async initialize(): Promise<void> {
    try {
      // Get initial URL
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        console.log('Initial deep link URL:', initialUrl);
        await this.handleDeepLink(initialUrl);
      }

      // Listen for incoming deep links
      Linking.addEventListener('url', (event) => {
        console.log('Deep link received:', event.url);
        this.handleDeepLink(event.url);
      });

      console.log('Deep linking initialized successfully');
    } catch (error) {
      console.error('Failed to initialize deep linking:', error);
      throw error;
    }
  }

  /**
   * Handle deep link URL
   */
  async handleDeepLink(url: string): Promise<void> {
    try {
      const deepLinkData = this.parseDeepLink(url);
      if (deepLinkData) {
        await this.navigateToScreen(deepLinkData);
      }
    } catch (error) {
      console.error('Failed to handle deep link:', url, error);
    }
  }

  /**
   * Parse deep link URL into structured data
   */
  parseDeepLink(url: string): DeepLinkData | null {
    try {
      // Create URL object
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const params = new URLSearchParams(urlObj.search);

      // Parse path and determine type
      const pathSegments = pathname.split('/').filter(Boolean);

      if (pathSegments.length === 0) {
        return {
          type: 'profile',
          params: {},
          originalUrl: url,
        };
      }

      // Product deep links
      if (pathSegments[0] === 'product' && pathSegments[1]) {
        return {
          type: 'product',
          params: {
            spuId: pathSegments[1],
            source: params.get('source') || 'deep_link',
          },
          originalUrl: url,
        };
      }

      // Search deep links
      if (pathSegments[0] === 'search') {
        return {
          type: 'search',
          params: {
            query: params.get('q') || params.get('query') || '',
            category: params.get('category'),
            minPrice: params.get('min_price') ? parseFloat(params.get('min_price')!) : undefined,
            maxPrice: params.get('max_price') ? parseFloat(params.get('max_price')!) : undefined,
            brand: params.get('brand'),
            source: params.get('source') || 'deep_link',
          },
          originalUrl: url,
        };
      }

      // Scan deep link
      if (pathSegments[0] === 'scan') {
        return {
          type: 'scan',
          params: {
            autoStart: params.get('auto_start') === 'true',
            source: params.get('source') || 'deep_link',
          },
          originalUrl: url,
        };
      }

      // Compare deep link
      if (pathSegments[0] === 'compare') {
        const productIds = params.getAll('product_id') || params.getAll('productId') || [];

        return {
          type: 'compare',
          params: {
            productIds: productIds.length > 0 ? productIds : [],
            categoryId: params.get('category_id') || params.get('categoryId'),
            source: params.get('source') || 'deep_link',
          },
          originalUrl: url,
        };
      }

      // Deal deep link
      if (pathSegments[0] === 'deals' && pathSegments[1]) {
        return {
          type: 'deal',
          params: {
            dealId: pathSegments[1],
            source: params.get('source') || 'deep_link',
          },
          originalUrl: url,
        };
      }

      // Alert deep link
      if (pathSegments[0] === 'alerts' && pathSegments[1]) {
        return {
          type: 'alert',
          params: {
            alertId: pathSegments[1],
            source: params.get('source') || 'deep_link',
          },
          originalUrl: url,
        };
      }

      // Profile deep link
      if (pathSegments[0] === 'profile') {
        return {
          type: 'profile',
          params: {
            userId: pathSegments[1],
            tab: params.get('tab') || 'settings',
            source: params.get('source') || 'deep_link',
          },
          originalUrl: url,
        };
      }

      // Default to home
      return {
        type: 'profile',
        params: {
          source: params.get('source') || 'deep_link',
        },
        originalUrl: url,
      };
    } catch (error) {
      console.error('Failed to parse deep link:', url, error);
      return null;
    }
  }

  /**
   * Navigate to appropriate screen based on deep link data
   */
  async navigateToScreen(deepLinkData: DeepLinkData): Promise<void> {
    try {
      // This would typically use your navigation library
      // For now, we'll just log the navigation intent
      console.log('Navigate to screen:', deepLinkData);

      switch (deepLinkData.type) {
        case 'product':
          console.log(`Navigate to product: ${deepLinkData.params.spuId}`);
          // Example: router.push(`/product/${deepLinkData.params.spuId}`);
          break;

        case 'search':
          console.log(`Navigate to search with query: ${deepLinkData.params.query}`);
          // Example: router.push({
          //   pathname: '/search',
          //   params: deepLinkData.params
          // });
          break;

        case 'scan':
          console.log('Navigate to scan screen');
          // Example: router.push('/scan');
          break;

        case 'compare':
          console.log(`Navigate to compare with products: ${deepLinkData.params.productIds}`);
          // Example: router.push({
          //   pathname: '/compare',
          //   params: deepLinkData.params
          // });
          break;

        case 'deal':
          console.log(`Navigate to deal: ${deepLinkData.params.dealId}`);
          break;

        case 'alert':
          console.log(`Navigate to alert: ${deepLinkData.params.alertId}`);
          break;

        case 'profile':
          console.log(`Navigate to profile with tab: ${deepLinkData.params.tab}`);
          break;
      }

      // Track deep link usage for analytics
      this.trackDeepLinkUsage(deepLinkData);
    } catch (error) {
      console.error('Failed to navigate to screen:', deepLinkData, error);
    }
  }

  /**
   * Generate deep link URL
   */
  generateDeepLink(type: DeepLinkData['type'], params: Record<string, any> = {}): string {
    const baseUrl = this.linkingConfig.prefixes[0]; // Use first prefix

    switch (type) {
      case 'product':
        if (params.spuId) {
          return `${baseUrl}/product/${params.spuId}${this.paramsToQueryString(params)}`;
        }
        break;

      case 'search':
        return `${baseUrl}/search${this.paramsToQueryString(params)}`;

      case 'scan':
        return `${baseUrl}/scan${this.paramsToQueryString(params)}`;

      case 'compare':
        return `${baseUrl}/compare${this.paramsToQueryString(params)}`;

      case 'deal':
        if (params.dealId) {
          return `${baseUrl}/deals/${params.dealId}${this.paramsToQueryString(params)}`;
        }
        break;

      case 'alert':
        if (params.alertId) {
          return `${baseUrl}/alerts/${params.alertId}${this.paramsToQueryString(params)}`;
        }
        break;

      case 'profile':
        const userId = params.userId ? `/${params.userId}` : '';
        return `${baseUrl}/profile${userId}${this.paramsToQueryString(params)}`;

      default:
        return baseUrl;
    }

    return baseUrl;
  }

  /**
   * Convert params object to query string
   */
  private paramsToQueryString(params: Record<string, any>): string {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        if (Array.isArray(value)) {
          value.forEach(item => searchParams.append(key, String(item)));
        } else {
          searchParams.append(key, String(value));
        }
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  /**
   * Track deep link usage for analytics
   */
  private async trackDeepLinkUsage(deepLinkData: DeepLinkData): Promise<void> {
    try {
      // This would typically send data to your analytics service
      console.log('Deep link tracked:', {
        type: deepLinkData.type,
        params: deepLinkData.params,
        url: deepLinkData.originalUrl,
        timestamp: new Date().toISOString(),
      });

      // Store in local storage for offline analytics
      const trackingData = {
        type: deepLinkData.type,
        params: deepLinkData.params,
        url: deepLinkData.originalUrl,
        timestamp: new Date().toISOString(),
      };

      // Use existing storage service
      const existingData = await this.getStoredTrackingData();
      existingData.push(trackingData);

      // Keep only last 100 entries
      const limitedData = existingData.slice(-100);

      await this.setStoredTrackingData(limitedData);
    } catch (error) {
      console.error('Failed to track deep link usage:', error);
    }
  }

  /**
   * Get stored tracking data
   */
  private async getStoredTrackingData(): Promise<any[]> {
    try {
      // This would use your storage service
      return []; // Placeholder
    } catch (error) {
      console.error('Failed to get stored tracking data:', error);
      return [];
    }
  }

  /**
   * Set stored tracking data
   */
  private async setStoredTrackingData(data: any[]): Promise<void> {
    try {
      // This would use your storage service
      console.log('Storing tracking data:', data.length, 'entries');
    } catch (error) {
      console.error('Failed to set stored tracking data:', error);
    }
  }

  /**
   * Check if app was opened from deep link
   */
  async wasOpenedFromDeepLink(): Promise<boolean> {
    try {
      const initialUrl = await Linking.getInitialURL();
      return !!initialUrl && initialUrl !== 'exp://';
    } catch (error) {
      console.error('Failed to check if opened from deep link:', error);
      return false;
    }
  }

  /**
   * Create shareable product link
   */
  createProductLink(productId: string, productName?: string): string {
    const link = this.generateDeepLink('product', { spuId: productId });

    if (productName) {
      return `${link}&name=${encodeURIComponent(productName)}`;
    }

    return link;
  }

  /**
   * Create shareable search link
   */
  createSearchLink(query: string, filters?: Record<string, any>): string {
    return this.generateDeepLink('search', { query, ...filters });
  }

  /**
   * Create shareable comparison link
   */
  createComparisonLink(productIds: string[], categoryId?: string): string {
    return this.generateDeepLink('compare', {
      productIds,
      categoryId
    });
  }

  /**
   * Create shareable deal link
   */
  createDealLink(dealId: string): string {
    return this.generateDeepLink('deal', { dealId });
  }

  /**
   * Create shareable alert link
   */
  createAlertLink(alertId: string): string {
    return this.generateDeepLink('alert', { alertId });
  }

  /**
   * Test deep linking functionality
   */
  async testDeepLinking(): Promise<void> {
    if (!__DEV__) return;

    const testLinks = [
      this.generateDeepLink('product', { spuId: 'test-123' }),
      this.generateDeepLink('search', { query: 'iPhone', category: 'electronics' }),
      this.generateDeepLink('scan'),
      this.generateDeepLink('compare', { productIds: ['p1', 'p2'] }),
    ];

    console.log('Test deep links:', testLinks);

    for (const link of testLinks) {
      console.log(`Testing deep link: ${link}`);
      await this.handleDeepLink(link);
    }
  }

  /**
   * Get linking configuration for expo-router
   */
  getLinkingConfig(): LinkingConfig {
    return this.linkingConfig;
  }

  /**
   * Cleanup deep linking resources
   */
  cleanup(): void {
    // Remove event listeners if needed
    console.log('Deep linking service cleaned up');
  }
}

// Export singleton instance
export const deepLinkService = DeepLinkService.getInstance();
export default deepLinkService;