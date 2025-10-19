/**
 * Accessibility Service
 * Provides comprehensive accessibility utilities and helpers for the app
 */

import { Platform, Alert, Linking } from 'react-native';

export type AccessibilityRole =
  | 'button'
  | 'link'
  | 'header'
  | 'text'
  | 'image'
  | 'imagebutton'
  | 'adjustable'
  | 'search'
  | 'keyboardkey'
  | 'summary'
  | 'alert'
  | 'checkbox'
  | 'combobox'
  | 'menu'
  | 'menubar'
  | 'menuitem'
  | 'progressbar'
  | 'radiobutton'
  | 'scrollbar'
  | 'spinbutton'
  | 'switch'
  | 'tab'
  | 'tablist'
  | 'timer'
  | 'toolbar';

export type AccessibilityState = {
  disabled?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  busy?: boolean;
  expanded?: boolean;
};

export interface AccessibilityProps {
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  accessibilityValue?: {
    min?: number;
    max?: number;
    now?: number;
    text?: string;
  };
  accessibilityDescribedBy?: string;
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  accessibilityViewIsModal?: boolean;
  importantForAccessibility?: 'auto' | 'yes' | 'no' | 'no-hide-descendants';
}

class AccessibilityService {
  private static instance: AccessibilityService;

  static getInstance(): AccessibilityService {
    if (!AccessibilityService.instance) {
      AccessibilityService.instance = new AccessibilityService();
    }
    return AccessibilityService.instance;
  }

  /**
   * Check if accessibility features are enabled
   */
  async isAccessibilityEnabled(): Promise<boolean> {
    // On iOS, we can check if VoiceOver is running
    if (Platform.OS === 'ios') {
      // Note: There's no direct API to check VoiceOver status in React Native
      // This would require native module integration
      return false; // Placeholder
    }

    // On Android, we can check accessibility settings
    if (Platform.OS === 'android') {
      // This would require native module integration
      return false; // Placeholder
    }

    return false;
  }

  /**
   * Generate accessibility labels for price information
   */
  generatePriceLabel(price: number, currency: string = 'JPY', originalPrice?: number): string {
    const formattedPrice = this.formatPriceForScreenReader(price, currency);

    if (originalPrice && originalPrice > price) {
      const discount = Math.round(((originalPrice - price) / originalPrice) * 100);
      const formattedOriginal = this.formatPriceForScreenReader(originalPrice, currency);
      return `${formattedPrice}, was ${formattedOriginal}, ${discount} percent discount`;
    }

    return formattedPrice;
  }

  /**
   * Format price for screen readers
   */
  private formatPriceForScreenReader(price: number, currency: string): string {
    if (currency === 'JPY') {
      return `${price.toLocaleString('ja-JP')} yen`;
    } else if (currency === 'USD') {
      return `${price.toLocaleString('en-US')} dollars`;
    }

    return `${price.toLocaleString()} ${currency}`;
  }

  /**
   * Generate accessibility labels for product ratings
   */
  generateRatingLabel(rating: number, maxRating: number = 5, reviewCount?: number): string {
    const stars = this.numberToWords(Math.round(rating));
    const label = `Rated ${stars} out of ${maxRating} stars`;

    if (reviewCount) {
      return `${label} based on ${reviewCount} reviews`;
    }

    return label;
  }

  /**
   * Convert numbers to words for screen readers
   */
  private numberToWords(num: number): string {
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    return words[num] || num.toString();
  }

  /**
   * Generate accessibility labels for discount information
   */
  generateDiscountLabel(discountPercentage: number): string {
    return `${discountPercentage} percent discount`;
  }

  /**
   * Generate accessibility labels for stock information
   */
  generateStockLabel(inStock: boolean, quantity?: number): string {
    if (inStock) {
      if (quantity) {
        return `In stock, ${quantity} items available`;
      }
      return 'In stock';
    }
    return 'Out of stock';
  }

  /**
   * Generate accessibility labels for delivery information
   */
  generateDeliveryLabel(estimatedDays?: number, freeDelivery?: boolean): string {
    if (freeDelivery) {
      return 'Free delivery';
    }

    if (estimatedDays) {
      if (estimatedDays === 1) {
        return 'Delivery tomorrow';
      } else if (estimatedDays <= 3) {
        return `Delivery within ${estimatedDays} days`;
      } else {
        return `Delivery in ${estimatedDays} days`;
      }
    }

    return 'Delivery information not available';
  }

  /**
   * Announce message to screen readers
   */
  announceToScreenReader(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    // This would typically be implemented using a screen reader API
    // For now, we'll use Alert as a fallback
    if (__DEV__) {
      console.log(`Screen Reader Announcement (${politeness}): ${message}`);
    }

    // In a real implementation, this would use platform-specific APIs:
    // - iOS: UIAccessibility.post(notification:, argument:)
    // - Android: announceForAccessibility()
  }

  /**
   * Generate accessibility labels for search results
   */
  generateSearchResultLabel(query: string, resultCount: number, currentPage: number = 1): string {
    return `Found ${resultCount} results for ${query}, page ${currentPage}`;
  }

  /**
   * Generate accessibility labels for filter options
   */
  generateFilterLabel(filterName: string, filterValue: string, isActive: boolean): string {
    const status = isActive ? 'selected' : 'not selected';
    return `${filterName} filter: ${filterValue}, ${status}`;
  }

  /**
   * Generate accessibility labels for navigation items
   */
  generateNavigationLabel(label: string, isActive: boolean, badgeCount?: number): string {
    let navigationLabel = label;

    if (isActive) {
      navigationLabel += `, current page`;
    } else {
      navigationLabel += `, navigate to ${label}`;
    }

    if (badgeCount) {
      navigationLabel += `, ${badgeCount} notifications`;
    }

    return navigationLabel;
  }

  /**
   * Generate accessibility labels for form validation errors
   */
  generateValidationErrorLabel(fieldName: string, errorMessage: string): string {
    return `${fieldName} field error: ${errorMessage}`;
  }

  /**
   * Generate accessibility labels for loading states
   */
  generateLoadingLabel(context: string): string {
    return `Loading ${context}`;
  }

  /**
   * Generate accessibility labels for progress indicators
   */
  generateProgressLabel(current: number, total: number, context?: string): string {
    const percentage = Math.round((current / total) * 100);
    const contextLabel = context ? `${context} ` : '';
    return `${contextLabel}${current} of ${total}, ${percentage} percent complete`;
  }

  /**
   * Check if color contrast meets WCAG standards
   */
  checkColorContrast(foreground: string, background: string): {
    ratio: number;
    wcagAA: boolean;
    wcagAAA: boolean;
  } {
    // This is a simplified contrast calculation
    // In a real implementation, you'd use a proper color contrast library
    const getLuminance = (color: string): number => {
      // Simplified luminance calculation
      const hex = color.replace('#', '');
      const r = parseInt(hex.substr(0, 2), 16) / 255;
      const g = parseInt(hex.substr(2, 2), 16) / 255;
      const b = parseInt(hex.substr(4, 2), 16) / 255;

      const [lr, lg, lb] = [r, g, b].map(c => {
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });

      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };

    const l1 = getLuminance(foreground);
    const l2 = getLuminance(background);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

    return {
      ratio: Math.round(ratio * 100) / 100,
      wcagAA: ratio >= 4.5,
      wcagAAA: ratio >= 7,
    };
  }

  /**
   * Show accessibility settings
   */
  async showAccessibilitySettings(): Promise<void> {
    if (Platform.OS === 'ios') {
      // Open iOS accessibility settings
      Alert.alert(
        'Accessibility Settings',
        'To adjust accessibility settings, go to: Settings > Accessibility',
        [
          {
            text: 'Open Settings',
            onPress: () => Linking.openURL('app-settings:'),
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ]
      );
    } else if (Platform.OS === 'android') {
      // Open Android accessibility settings
      Alert.alert(
        'Accessibility Settings',
        'To adjust accessibility settings, go to: Settings > Accessibility',
        [
          {
            text: 'Open Settings',
            onPress: () => Linking.openSettings(),
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ]
      );
    }
  }

  /**
   * Validate accessibility props
   */
  validateAccessibilityProps(props: AccessibilityProps): {
    isValid: boolean;
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Check for missing accessibility label on accessible elements
    if (props.accessible !== false && !props.accessibilityLabel && !props.accessibilityRole) {
      warnings.push('Accessible element should have an accessibilityLabel or accessibilityRole');
    }

    // Check for missing accessibility hint on interactive elements
    if (
      ['button', 'link', 'imagebutton', 'search'].includes(props.accessibilityRole || '') &&
      !props.accessibilityHint
    ) {
      warnings.push(`Interactive element with role "${props.accessibilityRole}" should have an accessibilityHint`);
    }

    // Validate accessibility state
    if (props.accessibilityState) {
      Object.entries(props.accessibilityState).forEach(([key, value]) => {
        if (typeof value !== 'boolean' && value !== 'mixed') {
          errors.push(`Invalid accessibilityState for "${key}": must be boolean or "mixed"`);
        }
      });
    }

    // Validate accessibility value
    if (props.accessibilityValue) {
      const { min, max, now } = props.accessibilityValue;

      if (min !== undefined && (typeof min !== 'number' || min < 0)) {
        errors.push('accessibilityValue.min must be a non-negative number');
      }

      if (max !== undefined && (typeof max !== 'number' || max < 0)) {
        errors.push('accessibilityValue.max must be a non-negative number');
      }

      if (now !== undefined && (typeof now !== 'number' || now < 0)) {
        errors.push('accessibilityValue.now must be a non-negative number');
      }

      if (min !== undefined && max !== undefined && min > max) {
        errors.push('accessibilityValue.min cannot be greater than accessibilityValue.max');
      }

      if (now !== undefined && min !== undefined && now < min) {
        errors.push('accessibilityValue.now cannot be less than accessibilityValue.min');
      }

      if (now !== undefined && max !== undefined && now > max) {
        errors.push('accessibilityValue.now cannot be greater than accessibilityValue.max');
      }
    }

    return {
      isValid: errors.length === 0,
      warnings,
      errors,
    };
  }

  /**
   * Get accessibility testing tips
   */
  getAccessibilityTestingTips(): string[] {
    return [
      'Test with VoiceOver (iOS) or TalkBack (Android)',
      'Ensure all interactive elements are accessible via screen reader',
      'Check that all images have appropriate alt text',
      'Verify color contrast ratios meet WCAG 2.1 AA standards',
      'Test keyboard navigation and focus management',
      'Ensure form fields have proper labels and error messages',
      'Check that the app works with increased text size',
      'Test with high contrast mode enabled',
      'Verify that the app works when animation is reduced',
      'Check that all content is available without color alone',
    ];
  }
}

export default AccessibilityService.getInstance();