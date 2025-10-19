/**
 * Platform Integration Factory
 * Creates and manages instances of platform integrations
 */

import {
  Platform,
  PlatformConfig,
  PlatformIntegration
} from './types';
import { AmazonIntegration } from './amazon';
import { RakutenIntegration } from './rakuten';
import { YahooShoppingIntegration } from './yahoo-shopping';
import { KakakuIntegration } from './kakaku';
import { MercariIntegration } from './mercari';
import { logger } from '@/utils/logger';

class PlatformIntegrationFactory {
  private static instance: PlatformIntegrationFactory;
  private integrations: Map<Platform, PlatformIntegration> = new Map();
  private configs: Map<Platform, PlatformConfig> = new Map();

  private constructor() {
    this.initializeConfigs();
  }

  static getInstance(): PlatformIntegrationFactory {
    if (!PlatformIntegrationFactory.instance) {
      PlatformIntegrationFactory.instance = new PlatformIntegrationFactory();
    }
    return PlatformIntegrationFactory.instance;
  }

  private initializeConfigs(): void {
    const platforms: Platform[] = ['amazon', 'rakuten', 'yahoo', 'kakaku', 'mercari'];

    platforms.forEach(platform => {
      const config = this.getConfigForPlatform(platform);
      if (config) {
        this.configs.set(platform, config);
      }
    });
  }

  private getConfigForPlatform(platform: Platform): PlatformConfig | null {
    const envPrefix = platform.toUpperCase();

    const baseConfig: PlatformConfig = {
      platform,
      baseUrl: this.getBaseUrl(platform),
      rateLimit: this.getRateLimitConfig(platform),
      timeout: 30000,
      retryAttempts: 3,
      enabled: this.isPlatformEnabled(platform),
    };

    // Add platform-specific configuration
    switch (platform) {
      case 'amazon':
        return {
          ...baseConfig,
          apiKey: process.env.AMAZON_ACCESS_KEY,
          apiSecret: process.env.AMAZON_SECRET_KEY,
          affiliateId: process.env.AMAZON_ASSOCIATE_TAG,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        };

      case 'rakuten':
        return {
          ...baseConfig,
          apiKey: process.env.RAKUTEN_APP_ID,
          affiliateId: process.env.RAKUTEN_AFFILIATE_ID,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        };

      case 'yahoo':
        return {
          ...baseConfig,
          apiKey: process.env.YAHOO_CLIENT_ID,
          apiSecret: process.env.YAHOO_CLIENT_SECRET,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        };

      case 'kakaku':
        return {
          ...baseConfig,
          apiKey: process.env.KAKAKU_API_KEY,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        };

      case 'mercari':
        return {
          ...baseConfig,
          apiKey: process.env.MERCARI_CLIENT_ID,
          apiSecret: process.env.MERCARI_CLIENT_SECRET,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        };

      default:
        return null;
    }
  }

  private getBaseUrl(platform: Platform): string {
    const urlMap: Record<Platform, string> = {
      amazon: 'https://webservices.amazon.com',
      rakuten: 'https://app.rakuten.co.jp',
      yahoo: 'https://shopping.yahooapis.jp',
      kakaku: 'https://kakaku.com',
      mercari: 'https://api.mercari.jp',
    };

    return urlMap[platform] || '';
  }

  private getRateLimitConfig(platform: Platform) {
    const rateLimitMap: Record<Platform, any> = {
      amazon: {
        requestsPerSecond: 1,
        requestsPerMinute: 60,
        requestsPerHour: 3600,
      },
      rakuten: {
        requestsPerSecond: 1,
        requestsPerMinute: 60,
        requestsPerHour: 3600,
      },
      yahoo: {
        requestsPerSecond: 5,
        requestsPerMinute: 300,
        requestsPerHour: 18000,
      },
      kakaku: {
        requestsPerSecond: 2,
        requestsPerMinute: 120,
        requestsPerHour: 7200,
      },
      mercari: {
        requestsPerSecond: 3,
        requestsPerMinute: 180,
        requestsPerHour: 10800,
      },
    };

    return rateLimitMap[platform] || {
      requestsPerSecond: 1,
      requestsPerMinute: 60,
      requestsPerHour: 3600,
    };
  }

  private isPlatformEnabled(platform: Platform): boolean {
    const envVar = `${platform.toUpperCase()}_ENABLED`;
    const envValue = process.env[envVar];

    // Default to enabled for development, but require explicit enable for production
    if (process.env.NODE_ENV === 'production') {
      return envValue === 'true';
    }

    return envValue !== 'false'; // Default to true in development unless explicitly disabled
  }

  /**
   * Get integration instance for a platform
   */
  getIntegration(platform: Platform): PlatformIntegration | null {
    // Check if integration already exists
    if (this.integrations.has(platform)) {
      return this.integrations.get(platform)!;
    }

    // Check if platform is enabled
    const config = this.configs.get(platform);
    if (!config || !config.enabled) {
      logger.warn(`Platform ${platform} is not enabled or configured`);
      return null;
    }

    // Create new integration instance
    try {
      const integration = this.createIntegration(platform, config);
      this.integrations.set(platform, integration);

      logger.info(`Created ${platform} integration instance`);
      return integration;
    } catch (error) {
      logger.error(`Failed to create ${platform} integration`, {
        platform,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private createIntegration(platform: Platform, config: PlatformConfig): PlatformIntegration {
    switch (platform) {
      case 'amazon':
        return new AmazonIntegration(config);
      case 'rakuten':
        return new RakutenIntegration(config);
      case 'yahoo':
        return new YahooShoppingIntegration(config);
      case 'kakaku':
        return new KakakuIntegration(config);
      case 'mercari':
        return new MercariIntegration(config);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Get all enabled integrations
   */
  getAllIntegrations(): Map<Platform, PlatformIntegration> {
    const enabledIntegrations = new Map<Platform, PlatformIntegration>();

    for (const [platform, config] of this.configs) {
      if (config.enabled) {
        const integration = this.getIntegration(platform);
        if (integration) {
          enabledIntegrations.set(platform, integration);
        }
      }
    }

    return enabledIntegrations;
  }

  /**
   * Get integration by platform name (string)
   */
  getIntegrationByName(platformName: string): PlatformIntegration | null {
    const platform = platformName.toLowerCase() as Platform;
    return this.getIntegration(platform);
  }

  /**
   * Check if platform is enabled
   */
  isPlatformEnabled(platform: Platform): boolean {
    const config = this.configs.get(platform);
    return config?.enabled || false;
  }

  /**
   * Get platform configuration
   */
  getPlatformConfig(platform: Platform): PlatformConfig | null {
    return this.configs.get(platform) || null;
  }

  /**
   * Reload platform configuration
   */
  reloadConfig(): void {
    this.configs.clear();
    this.integrations.clear();
    this.initializeConfigs();

    logger.info('Platform integration configurations reloaded');
  }

  /**
   * Perform health check on all enabled integrations
   */
  async performHealthChecks(): Promise<Map<Platform, { status: string; latency?: number; error?: string }>> {
    const results = new Map<Platform, { status: string; latency?: number; error?: string }>();

    const integrations = this.getAllIntegrations();

    for (const [platform, integration] of integrations) {
      try {
        const healthResult = await integration.healthCheck();
        if (healthResult.success && healthResult.data) {
          results.set(platform, {
            status: healthResult.data.status,
            latency: healthResult.data.latency,
          });
        } else {
          results.set(platform, {
            status: 'unhealthy',
            error: healthResult.error,
          });
        }
      } catch (error) {
        results.set(platform, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Get platform-specific metrics
   */
  async getMetrics(): Promise<Map<Platform, any>> {
    const metrics = new Map<Platform, any>();

    const integrations = this.getAllIntegrations();

    for (const [platform, integration] of integrations) {
      try {
        const metricsResult = await integration.getMetrics();
        if (metricsResult.success) {
          metrics.set(platform, metricsResult.data);
        }
      } catch (error) {
        logger.error(`Failed to get metrics for ${platform}`, {
          platform,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return metrics;
  }

  /**
   * Get available platforms
   */
  getAvailablePlatforms(): Platform[] {
    return Array.from(this.configs.keys()).filter(platform =>
      this.isPlatformEnabled(platform)
    );
  }

  /**
   * Clear integration cache
   */
  clearCache(): void {
    // This would need to be implemented by each integration
    logger.info('Integration cache cleared');
  }
}

export { PlatformIntegrationFactory };
export default PlatformIntegrationFactory;