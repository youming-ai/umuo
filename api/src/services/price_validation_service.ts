import { ProductOffer, PriceHistory, Platform } from '../models';

export interface PriceValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  normalizedPrice?: number;
  confidence: number;
}

export interface ValidationError {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

export interface PriceData {
  productId: string;
  platformId: string;
  price: number;
  currency: string;
  originalPrice?: number;
  discountPercentage?: number;
  timestamp: Date;
  source: 'api' | 'scrape' | 'manual';
}

export class PriceValidationService {
  private static instance: PriceValidationService;
  private priceHistory: Map<string, PriceHistory[]> = new Map();
  private platformConfig: Map<string, PlatformConfig> = new Map();

  private constructor() {
    this.initializePlatformConfigs();
  }

  static getInstance(): PriceValidationService {
    if (!PriceValidationService.instance) {
      PriceValidationService.instance = new PriceValidationService();
    }
    return PriceValidationService.instance;
  }

  /**
   * Validate price data from various sources
   */
  async validatePriceData(priceData: PriceData): Promise<PriceValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let normalizedPrice = priceData.price;

    try {
      // Basic price validation
      this.validateBasicPrice(priceData, errors, warnings);

      // Currency validation
      this.validateCurrency(priceData, errors);

      // Price range validation
      this.validatePriceRange(priceData, errors, warnings);

      // Historical price validation
      await this.validateAgainstHistory(priceData, errors, warnings);

      // Platform-specific validation
      this.validateForPlatform(priceData, errors, warnings);

      // Discount validation
      this.validateDiscount(priceData, errors, warnings);

      // Normalize price if needed
      if (errors.length === 0) {
        normalizedPrice = this.normalizePrice(priceData);
      }

      const confidence = this.calculateConfidence(errors, warnings, priceData);

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        normalizedPrice,
        confidence,
      };

    } catch (error) {
      console.error('Price validation failed:', error);
      return {
        isValid: false,
        errors: [{
          code: 'VALIDATION_ERROR',
          message: 'Validation process failed',
          severity: 'error',
        }],
        warnings: [],
        confidence: 0,
      };
    }
  }

  /**
   * Validate batch of price data
   */
  async validateBatch(priceDataArray: PriceData[]): Promise<PriceValidationResult[]> {
    return Promise.all(
      priceDataArray.map(data => this.validatePriceData(data))
    );
  }

  /**
   * Clean and normalize price data
   */
  async cleanPriceData(priceData: PriceData): Promise<PriceData> {
    const cleaned = { ...priceData };

    // Remove common formatting issues
    cleaned.price = this.cleanPriceValue(priceData.price);

    if (cleaned.originalPrice) {
      cleaned.originalPrice = this.cleanPriceValue(cleaned.originalPrice);
    }

    // Recalculate discount percentage if needed
    if (cleaned.originalPrice && cleaned.originalPrice > cleaned.price) {
      cleaned.discountPercentage = Math.round(
        ((cleaned.originalPrice - cleaned.price) / cleaned.originalPrice) * 100
      );
    }

    // Validate timestamp
    if (!cleaned.timestamp || isNaN(cleaned.timestamp.getTime())) {
      cleaned.timestamp = new Date();
    }

    return cleaned;
  }

  /**
   * Get price anomaly detection
   */
  async detectAnomalies(productId: string, newPrice: number): Promise<{
    isAnomaly: boolean;
    anomalyType: 'spike' | 'drop' | 'unusual';
    significance: number;
    explanation: string;
  }> {
    const history = this.priceHistory.get(productId) || [];

    if (history.length < 3) {
      return {
        isAnomaly: false,
        anomalyType: 'unusual',
        significance: 0,
        explanation: 'Insufficient historical data',
      };
    }

    const recentPrices = history.slice(-10).map(h => h.price);
    const meanPrice = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
    const stdDev = Math.sqrt(
      recentPrices.reduce((sum, p) => sum + Math.pow(p - meanPrice, 2), 0) / recentPrices.length
    );

    const zScore = Math.abs((newPrice - meanPrice) / stdDev);
    const isAnomaly = zScore > 2; // 2 standard deviations

    let anomalyType: 'spike' | 'drop' | 'unusual' = 'unusual';
    if (isAnomaly) {
      if (newPrice > meanPrice * 1.5) {
        anomalyType = 'spike';
      } else if (newPrice < meanPrice * 0.5) {
        anomalyType = 'drop';
      }
    }

    return {
      isAnomaly,
      anomalyType,
      significance: Math.min(zScore / 3, 1), // Normalize to 0-1
      explanation: isAnomaly
        ? `Price is ${zScore.toFixed(1)} standard deviations from recent average`
        : 'Price within normal range',
    };
  }

  /**
   * Update price history for validation context
   */
  updatePriceHistory(productId: string, priceHistory: PriceHistory[]): void {
    this.priceHistory.set(productId, priceHistory);
  }

  /**
   * Basic price validation
   */
  private validateBasicPrice(
    priceData: PriceData,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (priceData.price <= 0) {
      errors.push({
        code: 'INVALID_PRICE',
        message: 'Price must be greater than 0',
        severity: 'error',
        field: 'price',
      });
    }

    if (priceData.price > 999999999) {
      errors.push({
        code: 'PRICE_TOO_HIGH',
        message: 'Price exceeds maximum allowed value',
        severity: 'error',
        field: 'price',
      });
    }

    if (priceData.price < 1) {
      warnings.push({
        code: 'VERY_LOW_PRICE',
        message: 'Price is unusually low, please verify',
        suggestion: 'Check for missing decimal or currency conversion',
      });
    }
  }

  /**
   * Validate currency
   */
  private validateCurrency(
    priceData: PriceData,
    errors: ValidationError[]
  ): void {
    const validCurrencies = ['JPY', 'USD', 'EUR', 'GBP', 'CNY'];

    if (!validCurrencies.includes(priceData.currency)) {
      errors.push({
        code: 'INVALID_CURRENCY',
        message: `Invalid currency: ${priceData.currency}`,
        severity: 'error',
        field: 'currency',
      });
    }
  }

  /**
   * Validate price range based on product category and platform
   */
  private validatePriceRange(
    priceData: PriceData,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const platformConfig = this.platformConfig.get(priceData.platformId);

    if (!platformConfig) return;

    const { minPrice, maxPrice } = platformConfig;

    if (priceData.price < minPrice) {
      warnings.push({
        code: 'BELOW_MIN_PRICE',
        message: `Price is below platform minimum of ${minPrice} ${priceData.currency}`,
        suggestion: 'Verify price accuracy and platform fees',
      });
    }

    if (priceData.price > maxPrice) {
      warnings.push({
        code: 'ABOVE_MAX_PRICE',
        message: `Price is above platform maximum of ${maxPrice} ${priceData.currency}`,
        suggestion: 'Check for luxury goods or price errors',
      });
    }
  }

  /**
   * Validate against historical price data
   */
  private async validateAgainstHistory(
    priceData: PriceData,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    const history = this.priceHistory.get(priceData.productId) || [];

    if (history.length === 0) return;

    const recentPrices = history.slice(-5).map(h => h.price);
    const avgRecentPrice = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;

    // Check for significant price changes
    const percentChange = Math.abs((priceData.price - avgRecentPrice) / avgRecentPrice) * 100;

    if (percentChange > 50) {
      warnings.push({
        code: 'LARGE_PRICE_CHANGE',
        message: `Price changed by ${percentChange.toFixed(1)}% compared to recent data`,
        suggestion: 'Verify sale, discount, or price error',
      });
    }

    // Check for price persistence
    const samePriceCount = recentPrices.filter(p => p === priceData.price).length;
    if (samePriceCount === recentPrices.length) {
      warnings.push({
        code: 'STABLE_PRICE',
        message: 'Price unchanged for recent entries',
        suggestion: 'Verify if price data is being updated regularly',
      });
    }
  }

  /**
   * Platform-specific validation
   */
  private validateForPlatform(
    priceData: PriceData,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const platformConfig = this.platformConfig.get(priceData.platformId);

    if (!platformConfig) return;

    // Validate price formatting for platform
    if (platformConfig.priceFormatting) {
      const { decimalPlaces, allowFractions } = platformConfig.priceFormatting;

      if (!allowFractions && priceData.price % 1 !== 0) {
        warnings.push({
          code: 'FRACTIONAL_PRICE',
          message: 'Platform typically uses whole number prices',
          suggestion: 'Verify price accuracy for this platform',
        });
      }

      const decimalPart = priceData.price.toString().split('.')[1];
      if (decimalPart && decimalPart.length > decimalPlaces) {
        warnings.push({
          code: 'EXCESS_DECIMALS',
          message: `Price has more than ${decimalPlaces} decimal places`,
          suggestion: 'Round price to appropriate precision',
        });
      }
    }
  }

  /**
   * Validate discount information
   */
  private validateDiscount(
    priceData: PriceData,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (priceData.originalPrice) {
      if (priceData.originalPrice <= priceData.price) {
        errors.push({
          code: 'INVALID_ORIGINAL_PRICE',
          message: 'Original price must be greater than current price',
          severity: 'error',
          field: 'originalPrice',
        });
      }

      // Recalculate discount percentage
      const calculatedDiscount = Math.round(
        ((priceData.originalPrice - priceData.price) / priceData.originalPrice) * 100
      );

      if (priceData.discountPercentage &&
          Math.abs(priceData.discountPercentage - calculatedDiscount) > 5) {
        warnings.push({
          code: 'DISCOUNT_MISMATCH',
          message: `Discount percentage (${priceData.discountPercentage}%) doesn't match calculated (${calculatedDiscount}%)`,
          suggestion: 'Update discount percentage for accuracy',
        });
      }

      // Warn about unrealistic discounts
      if (calculatedDiscount > 90) {
        warnings.push({
          code: 'UNREALISTIC_DISCOUNT',
          message: 'Discount percentage seems unusually high',
          suggestion: 'Verify original price accuracy',
        });
      }
    }
  }

  /**
   * Normalize price value
   */
  private normalizePrice(priceData: PriceData): number {
    let normalizedPrice = priceData.price;

    // Apply platform-specific rounding rules
    const platformConfig = this.platformConfig.get(priceData.platformId);

    if (platformConfig?.priceFormatting) {
      const { decimalPlaces } = platformConfig.priceFormatting;
      const factor = Math.pow(10, decimalPlaces);
      normalizedPrice = Math.round(normalizedPrice * factor) / factor;
    }

    return normalizedPrice;
  }

  /**
   * Clean price value from common formatting issues
   */
  private cleanPriceValue(price: number): number {
    // Remove floating point precision errors
    return Math.round(price * 100) / 100;
  }

  /**
   * Calculate validation confidence score
   */
  private calculateConfidence(
    errors: ValidationError[],
    warnings: ValidationWarning[],
    priceData: PriceData
  ): number {
    let confidence = 1.0;

    // Reduce confidence based on errors
    confidence -= errors.length * 0.3;

    // Reduce confidence based on warnings
    confidence -= warnings.length * 0.1;

    // Adjust based on data source
    switch (priceData.source) {
      case 'api':
        confidence += 0.1;
        break;
      case 'scrape':
        confidence -= 0.1;
        break;
      case 'manual':
        confidence -= 0.2;
        break;
    }

    // Ensure confidence is within bounds
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Initialize platform configurations
   */
  private initializePlatformConfigs(): void {
    // Amazon
    this.platformConfig.set('amazon', {
      minPrice: 1,
      maxPrice: 10000000,
      priceFormatting: {
        decimalPlaces: 2,
        allowFractions: true,
      },
    });

    // Rakuten
    this.platformConfig.set('rakuten', {
      minPrice: 1,
      maxPrice: 10000000,
      priceFormatting: {
        decimalPlaces: 0,
        allowFractions: false,
      },
    });

    // Yahoo Shopping
    this.platformConfig.set('yahoo', {
      minPrice: 1,
      maxPrice: 10000000,
      priceFormatting: {
        decimalPlaces: 0,
        allowFractions: false,
      },
    });

    // Kakaku
    this.platformConfig.set('kakaku', {
      minPrice: 1,
      maxPrice: 1000000,
      priceFormatting: {
        decimalPlaces: 0,
        allowFractions: false,
      },
    });

    // Mercari
    this.platformConfig.set('mercari', {
      minPrice: 1,
      maxPrice: 500000,
      priceFormatting: {
        decimalPlaces: 0,
        allowFractions: false,
      },
    });
  }
}

interface PlatformConfig {
  minPrice: number;
  maxPrice: number;
  priceFormatting: {
    decimalPlaces: number;
    allowFractions: boolean;
  };
}

// Export singleton instance
export const priceValidationService = PriceValidationService.getInstance();

export default priceValidationService;