/**
 * Product validation utilities for mobile app
 * Handles barcode validation, product code verification, and error messaging
 */

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  normalizedCode?: string;
  suggestions?: string[];
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
  severity: 'error' | 'warning';
}

export interface ValidationWarning {
  code: string;
  message: string;
  suggestion?: string;
}

export interface ProductCodeInfo {
  type: 'JAN' | 'UPC' | 'EAN' | 'ISBN' | 'UNKNOWN';
  code: string;
  country?: string;
  isValid: boolean;
  checkDigit?: string;
}

export class ProductValidator {
  private static instance: ProductValidator;

  private constructor() {}

  static getInstance(): ProductValidator {
    if (!ProductValidator.instance) {
      ProductValidator.instance = new ProductValidator();
    }
    return ProductValidator.instance;
  }

  /**
   * Validate product barcode/UPC/JAN code
   */
  validateProductCode(code: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let normalizedCode = this.normalizeProductCode(code);

    try {
      // Basic format validation
      if (!normalizedCode) {
        errors.push({
          code: 'EMPTY_CODE',
          message: 'Product code cannot be empty',
          severity: 'error',
        });
        return { isValid: false, errors, warnings };
      }

      // Remove common prefixes and separators
      normalizedCode = this.cleanProductCode(normalizedCode);

      // Length validation
      if (normalizedCode.length < 8) {
        errors.push({
          code: 'CODE_TOO_SHORT',
          message: 'Product code is too short (minimum 8 digits)',
          severity: 'error',
        });
      } else if (normalizedCode.length > 18) {
        errors.push({
          code: 'CODE_TOO_LONG',
          message: 'Product code is too long (maximum 18 digits)',
          severity: 'error',
        });
      }

      // Digit validation
      if (!/^\d+$/.test(normalizedCode)) {
        errors.push({
          code: 'INVALID_CHARACTERS',
          message: 'Product code must contain only digits',
          severity: 'error',
        });
      }

      // Check digit validation for known formats
      const codeInfo = this.identifyCodeType(normalizedCode);
      if (codeInfo.type !== 'UNKNOWN' && !codeInfo.isValid) {
        errors.push({
          code: 'INVALID_CHECK_DIGIT',
          message: `Invalid ${codeInfo.type} check digit`,
          severity: 'error',
        });

        // Suggest possible corrections
        const suggestions = this.suggestCodeCorrections(normalizedCode, codeInfo.type);
        if (suggestions.length > 0) {
          errors[errors.length - 1].message += `. Possible correct codes: ${suggestions.join(', ')}`;
        }
      }

      // Warnings for uncommon formats
      if (codeInfo.type === 'UNKNOWN') {
        warnings.push({
          code: 'UNKNOWN_FORMAT',
          message: 'Unrecognized product code format',
          suggestion: 'Verify the code or try manual entry',
        });
      }

      const isValid = errors.length === 0;
      const suggestions = this.generateSuggestions(normalizedCode, codeInfo, errors, warnings);

      return {
        isValid,
        errors,
        warnings,
        normalizedCode: isValid ? normalizedCode : undefined,
        suggestions,
      };

    } catch (error) {
      console.error('Product validation failed:', error);
      return {
        isValid: false,
        errors: [{
          code: 'VALIDATION_ERROR',
          message: 'Validation process failed',
          severity: 'error',
        }],
        warnings: [],
      };
    }
  }

  /**
   * Validate search query for product search
   */
  validateSearchQuery(query: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!query || query.trim().length === 0) {
      errors.push({
        code: 'EMPTY_QUERY',
        message: 'Search query cannot be empty',
        severity: 'error',
      });
      return { isValid: false, errors, warnings };
    }

    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      errors.push({
        code: 'QUERY_TOO_SHORT',
        message: 'Search query must be at least 2 characters',
        severity: 'error',
      });
    }

    if (trimmedQuery.length > 100) {
      warnings.push({
        code: 'QUERY_TOO_LONG',
        message: 'Search query is quite long, consider being more specific',
        suggestion: 'Use more specific terms for better results',
      });
    }

    // Check for common non-product terms
    const nonProductTerms = ['test', 'asdf', '1234', 'qwerty'];
    if (nonProductTerms.some(term => trimmedQuery.toLowerCase().includes(term))) {
      warnings.push({
        code: 'NON_PRODUCT_QUERY',
        message: 'Query appears to be a test or non-product term',
        suggestion: 'Enter an actual product name or barcode',
      });
    }

    // Check for only numbers (might be a product code)
    if (/^\d+$/.test(trimmedQuery)) {
      const codeValidation = this.validateProductCode(trimmedQuery);
      if (!codeValidation.isValid) {
        warnings.push({
          code: 'POSSIBLE_PRODUCT_CODE',
          message: 'Query appears to be a product code but validation failed',
          suggestion: 'Verify the product code or try product name search',
        });
      }
    }

    const isValid = errors.length === 0;
    const suggestions = this.generateSearchSuggestions(trimmedQuery, errors, warnings);

    return {
      isValid,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * Get user-friendly error message
   */
  getErrorMessage(error: ValidationError): string {
    const messages: Record<string, string> = {
      'EMPTY_CODE': 'Please enter a product code or barcode',
      'CODE_TOO_SHORT': 'The product code is too short. Please check the code and try again.',
      'CODE_TOO_LONG': 'The product code is too long. Please check the code and try again.',
      'INVALID_CHARACTERS': 'Product codes should only contain numbers. Please remove any letters or symbols.',
      'INVALID_CHECK_DIGIT': 'The product code appears to be incorrect. Please verify all digits.',
      'EMPTY_QUERY': 'Please enter a product name or code to search',
      'QUERY_TOO_SHORT': 'Please enter at least 2 characters to search',
      'VALIDATION_ERROR': 'Unable to validate the input. Please try again.',
    };

    return messages[error.code] || error.message;
  }

  /**
   * Get help message based on validation errors
   */
  getHelpMessage(validationResult: ValidationResult): string | null {
    const { errors, warnings } = validationResult;

    if (errors.length > 0) {
      const firstError = errors[0];

      switch (firstError.code) {
        case 'INVALID_CHECK_DIGIT':
          return 'Tip: Make sure you\'ve entered all digits correctly, including the last check digit.';
        case 'INVALID_CHARACTERS':
          return 'Tip: Product barcodes should only contain numbers. Avoid letters and symbols.';
        case 'CODE_TOO_SHORT':
        case 'CODE_TOO_LONG':
          return 'Tip: Standard barcodes are 8, 12, 13, or 14 digits long.';
        default:
          return 'Please check the product code and try scanning again.';
      }
    }

    if (warnings.length > 0) {
      const firstWarning = warnings[0];

      switch (firstWarning.code) {
        case 'UNKNOWN_FORMAT':
          return 'This code format isn\'t recognized. Try searching by product name instead.';
        case 'POSSIBLE_PRODUCT_CODE':
          return 'This looks like a product code. Try using the barcode scanner for better results.';
        default:
          return firstWarning.suggestion || null;
      }
    }

    return null;
  }

  /**
   * Identify the type of product code
   */
  identifyProductCode(code: string): ProductCodeInfo {
    const cleanCode = code.replace(/\D/g, '');

    // JAN (Japanese Article Number) - 13 digits, starts with 45-49
    if (cleanCode.length === 13 && /^[45]/.test(cleanCode)) {
      return {
        type: 'JAN',
        code: cleanCode,
        country: 'Japan',
        isValid: this.validateJANCheckDigit(cleanCode),
        checkDigit: cleanCode.slice(-1),
      };
    }

    // EAN-13 - 13 digits
    if (cleanCode.length === 13) {
      return {
        type: 'EAN',
        code: cleanCode,
        isValid: this.validateEANCheckDigit(cleanCode),
        checkDigit: cleanCode.slice(-1),
      };
    }

    // UPC-A - 12 digits
    if (cleanCode.length === 12) {
      return {
        type: 'UPC',
        code: cleanCode,
        country: 'US/Canada',
        isValid: this.validateUPCCheckDigit(cleanCode),
        checkDigit: cleanCode.slice(-1),
      };
    }

    // EAN-8 - 8 digits
    if (cleanCode.length === 8) {
      return {
        type: 'EAN',
        code: cleanCode,
        isValid: this.validateEAN8CheckDigit(cleanCode),
        checkDigit: cleanCode.slice(-1),
      };
    }

    // ISBN-13 - 13 digits, starts with 978 or 979
    if (cleanCode.length === 13 && /^(978|979)/.test(cleanCode)) {
      return {
        type: 'ISBN',
        code: cleanCode,
        isValid: this.validateEANCheckDigit(cleanCode),
        checkDigit: cleanCode.slice(-1),
      };
    }

    return {
      type: 'UNKNOWN',
      code: cleanCode,
      isValid: false,
    };
  }

  /**
   * Normalize product code
   */
  private normalizeProductCode(code: string): string {
    if (!code) return '';

    // Remove common prefixes, spaces, and separators
    return code
      .replace(/^(0+)?/, '') // Remove leading zeros
      .replace(/[\s-]/g, '') // Remove spaces and hyphens
      .toUpperCase()
      .trim();
  }

  /**
   * Clean product code
   */
  private cleanProductCode(code: string): string {
    return code.replace(/\D/g, ''); // Keep only digits
  }

  /**
   * Validate JAN check digit
   */
  private validateJANCheckDigit(code: string): boolean {
    return this.validateEANCheckDigit(code); // Same algorithm as EAN-13
  }

  /**
   * Validate EAN-13 check digit
   */
  private validateEANCheckDigit(code: string): boolean {
    if (code.length !== 13) return false;

    const digits = code.slice(0, 12).split('').map(Number);
    const checkDigit = parseInt(code.slice(-1));

    let sum = 0;
    digits.forEach((digit, index) => {
      sum += digit * (index % 2 === 0 ? 1 : 3);
    });

    const calculatedCheckDigit = (10 - (sum % 10)) % 10;
    return checkDigit === calculatedCheckDigit;
  }

  /**
   * Validate UPC check digit
   */
  private validateUPCCheckDigit(code: string): boolean {
    if (code.length !== 12) return false;

    const digits = code.slice(0, 11).split('').map(Number);
    const checkDigit = parseInt(code.slice(-1));

    let sum = 0;
    digits.forEach((digit, index) => {
      sum += digit * (index % 2 === 0 ? 3 : 1);
    });

    const calculatedCheckDigit = (10 - (sum % 10)) % 10;
    return checkDigit === calculatedCheckDigit;
  }

  /**
   * Validate EAN-8 check digit
   */
  private validateEAN8CheckDigit(code: string): boolean {
    if (code.length !== 8) return false;

    const digits = code.slice(0, 7).split('').map(Number);
    const checkDigit = parseInt(code.slice(-1));

    let sum = 0;
    digits.forEach((digit, index) => {
      sum += digit * (index % 2 === 0 ? 3 : 1);
    });

    const calculatedCheckDigit = (10 - (sum % 10)) % 10;
    return checkDigit === calculatedCheckDigit;
  }

  /**
   * Suggest possible corrections for invalid codes
   */
  private suggestCodeCorrections(code: string, type: string): string[] {
    const suggestions: string[] = [];

    if (type === 'JAN' || type === 'EAN') {
      // Try common digit transpositions
      for (let i = 0; i < code.length - 1; i++) {
        const corrected = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
        if (this.validateEANCheckDigit(corrected)) {
          suggestions.push(corrected);
        }
      }
    }

    return suggestions.slice(0, 3); // Limit to 3 suggestions
  }

  /**
   * Generate suggestions based on validation results
   */
  private generateSuggestions(
    code: string,
    codeInfo: ProductCodeInfo,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): string[] {
    const suggestions: string[] = [];

    if (errors.some(e => e.code === 'INVALID_CHECK_DIGIT')) {
      suggestions.push('Double-check all digits, especially the last one');
      suggestions.push('Try scanning the barcode again');
    }

    if (warnings.some(w => w.code === 'UNKNOWN_FORMAT')) {
      suggestions.push('Try searching by product name instead');
      suggestions.push('Check if this is a store-specific code');
    }

    if (codeInfo.type === 'UNKNOWN') {
      suggestions.push('Ensure this is a standard product barcode');
      suggestions.push('Some store products use internal codes that won\'t work here');
    }

    return suggestions;
  }

  /**
   * Generate search suggestions
   */
  private generateSearchSuggestions(
    query: string,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): string[] {
    const suggestions: string[] = [];

    if (errors.some(e => e.code === 'QUERY_TOO_SHORT')) {
      suggestions.push('Try adding more specific terms');
      suggestions.push('Include brand name or product type');
    }

    if (warnings.some(w => w.code === 'POSSIBLE_PRODUCT_CODE')) {
      suggestions.push('Use the barcode scanner for product codes');
      suggestions.push('Enter product name instead of numbers');
    }

    return suggestions;
  }
}

// Export singleton instance
export const productValidator = ProductValidator.getInstance();

export default productValidator;