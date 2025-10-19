/**
 * Validation Utilities
 * Input validation and sanitization functions for the Yabaii mobile app
 */

/**
 * Validate product barcode/JAN code
 */
export function validateProductCode(barcode: string | null | undefined): boolean {
  if (!barcode || typeof barcode !== 'string') {
    return false;
  }

  // Remove any non-digit characters
  const cleanBarcode = barcode.replace(/[^0-9]/g, '');

  if (cleanBarcode.length === 0) {
    return false;
  }

  // Check length based on barcode type
  switch (cleanBarcode.length) {
    case 8: // EAN-8
      return validateEAN8(cleanBarcode);
    case 12: // UPC-A
      return validateUPCA(cleanBarcode);
    case 13: // EAN-13 / JAN
      return validateEAN13(cleanBarcode);
    case 14: // ITF-14
      return validateITF14(cleanBarcode);
    default:
      return false;
  }
}

/**
 * Validate EAN-13 checksum
 */
function validateEAN13(barcode: string): boolean {
  if (barcode.length !== 13) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(barcode[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }

  const checksum = (10 - (sum % 10)) % 10;
  return checksum === parseInt(barcode[12]);
}

/**
 * Validate EAN-8 checksum
 */
function validateEAN8(barcode: string): boolean {
  if (barcode.length !== 8) return false;

  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(barcode[i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }

  const checksum = (10 - (sum % 10)) % 10;
  return checksum === parseInt(barcode[7]);
}

/**
 * Validate UPC-A checksum
 */
function validateUPCA(barcode: string): boolean {
  if (barcode.length !== 12) return false;

  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const digit = parseInt(barcode[i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }

  const checksum = (10 - (sum % 10)) % 10;
  return checksum === parseInt(barcode[11]);
}

/**
 * Validate ITF-14 checksum
 */
function validateITF14(barcode: string): boolean {
  if (barcode.length !== 14) return false;

  // ITF-14 validation is more complex, for now just check length and digits
  return /^\d{14}$/.test(barcode);
}

/**
 * Validate price input
 */
export function validatePriceInput(price: string | null | undefined): boolean {
  if (!price || typeof price !== 'string') {
    return false;
  }

  const cleanPrice = price
    .replace(/[¥￥]/g, '') // Remove Japanese yen symbols
    .replace(/,/g, '') // Remove commas
    .trim();

  if (cleanPrice.length === 0) {
    return false;
  }

  // Check if it's a valid number
  const parsedPrice = parseFloat(cleanPrice);

  if (isNaN(parsedPrice)) {
    return false;
  }

  // Check price range
  return parsedPrice > 0 && parsedPrice <= 9999999; // Maximum 9,999,999 yen
}

/**
 * Validate email address
 */
export function validateEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return false;
  }

  // Check length constraints
  if (email.length > 254) {
    return false;
  }

  // Check local part length
  const localPart = email.split('@')[0];
  if (localPart.length > 64) {
    return false;
  }

  return true;
}

/**
 * Validate Japanese text
 */
export function validateJapaneseText(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  const trimmedText = text.trim();

  if (trimmedText.length === 0) {
    return false;
  }

  // Check maximum length
  if (trimmedText.length > 200) {
    return false;
  }

  return true;
}

/**
 * Validate English text (alias for Japanese text validation)
 */
export function validateEnglishText(text: string | null | undefined): boolean {
  return validateJapaneseText(text);
}

/**
 * Validate search query
 */
export function validateSearchQuery(query: string | null | undefined): boolean {
  if (!query || typeof query !== 'string') {
    return false;
  }

  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    return false;
  }

  // Check minimum length
  if (trimmedQuery.length < 1) {
    return false;
  }

  // Check maximum length
  if (trimmedQuery.length > 100) {
    return false;
  }

  // Check for too many special characters
  const specialCharCount = (trimmedQuery.match(/[!@#$%^&*()_+=\-\[\]{};':"\\|,.<>\/?]/g) || []).length;
  if (specialCharCount > trimmedQuery.length * 0.5) {
    return false;
  }

  return true;
}

/**
 * Validate barcode with type
 */
export function validateBarcode(barcode: string | null | undefined, type?: string): boolean {
  if (!barcode || typeof barcode !== 'string') {
    return false;
  }

  const cleanBarcode = barcode.replace(/[^0-9]/g, '');

  if (cleanBarcode.length === 0) {
    return false;
  }

  // If type is specified, validate against that type
  if (type) {
    switch (type.toLowerCase()) {
      case 'ean13':
      case 'jan':
        return cleanBarcode.length === 13 && validateEAN13(cleanBarcode);
      case 'ean8':
        return cleanBarcode.length === 8 && validateEAN8(cleanBarcode);
      case 'upc_a':
        return cleanBarcode.length === 12 && validateUPCA(cleanBarcode);
      case 'upc_e':
        return validateUPCE(cleanBarcode);
      default:
        return false;
    }
  }

  // Auto-detect type and validate
  return validateProductCode(barcode);
}

/**
 * Validate UPC-E checksum
 */
function validateUPCE(barcode: string): boolean {
  if (barcode.length !== 8) return false;

  // Convert UPC-E to UPC-A for checksum validation
  const lastDigit = barcode[7];
  let upca = '';

  if (barcode[6] === '0') {
    upca = barcode.substring(0, 6) + '00000' + barcode[6] + lastDigit;
  } else if (barcode[6] === '1') {
    upca = barcode.substring(0, 6) + '10000' + barcode[6] + lastDigit;
  } else if (barcode[6] === '2') {
    upca = barcode.substring(0, 6) + '20000' + barcode[6] + lastDigit;
  } else if (barcode[6] === '3') {
    upca = barcode.substring(0, 4) + barcode[6] + '0000' + barcode[5] + lastDigit;
  } else if (barcode[6] === '4') {
    upca = barcode.substring(0, 4) + barcode[6] + '10000' + barcode[5] + lastDigit;
  } else if (barcode[6] === '5') {
    upca = barcode.substring(0, 4) + barcode[6] + '20000' + barcode[5] + lastDigit;
  } else if (barcode[6] === '6') {
    upca = barcode.substring(0, 5) + '00000' + lastDigit;
  } else if (barcode[6] === '7') {
    upca = barcode.substring(0, 5) + '10000' + lastDigit;
  } else if (barcode[6] === '8') {
    upca = barcode.substring(0, 5) + '20000' + lastDigit;
  } else {
    return false;
  }

  return validateUPCA(upca);
}

/**
 * Format price with Japanese yen symbol
 */
export function formatPrice(price: number): string {
  if (isNaN(price) || price < 0) {
    return '¥0';
  }

  // Round to 2 decimal places
  const roundedPrice = Math.round(price * 100) / 100;

  // Format with Japanese thousands separator
  const formattedPrice = roundedPrice.toLocaleString('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    minimumFractionDigits: roundedPrice % 1 === 0 ? 0 : 2,
  });

  return formattedPrice;
}

/**
 * Sanitize Japanese text
 */
export function sanitizeJapaneseText(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .trim()
    .replace(/[\r\n\t]/g, ' ') // Replace line breaks and tabs with spaces
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[^\w\s\u3040-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF]/g, '') // Keep Japanese characters, basic Latin, and spaces
    .substring(0, 200); // Limit length
}

/**
 * Validate alert configuration
 */
export function validateAlertConfiguration(config: any): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const { type, threshold, enabled } = config;

  // Check required fields
  if (!type || typeof type !== 'string') {
    return false;
  }

  if (enabled === undefined || typeof enabled !== 'boolean') {
    return false;
  }

  // Validate type
  const validTypes = ['price_drop', 'historical_low', 'stock_available', 'any_change'];
  if (!validTypes.includes(type)) {
    return false;
  }

  // For price-based alerts, check threshold
  if (type === 'price_drop' || type === 'historical_low') {
    if (threshold === undefined || typeof threshold !== 'number') {
      return false;
    }

    if (threshold < 0 || threshold > 100) {
      return false;
    }
  }

  return true;
}

/**
 * Validate Japanese zip code
 */
export function isValidJapaneseZipCode(zipCode: string | null | undefined): boolean {
  if (!zipCode || typeof zipCode !== 'string') {
    return false;
  }

  // Japanese zip code format: XXX-XXXX
  const zipCodeRegex = /^\d{3}-\d{4}$/;
  return zipCodeRegex.test(zipCode);
}

/**
 * Validate Japanese phone number
 */
export function isValidJapanesePhoneNumber(phoneNumber: string | null | undefined): boolean {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false;
  }

  // Remove any non-digit characters
  const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');

  if (cleanPhone.length < 10 || cleanPhone.length > 11) {
    return false;
  }

  // Check if it starts with valid Japanese mobile prefix or area code
  const validPrefixes = [
    '070', '080', '090', // Mobile
    '0120', // Tokyo
    '03',    // Tokyo
    '06',    // Osaka
    '052',   // Nagoya
    '011',   // Sapporo
    '092',   // Fukuoka
    '098'    // Okinawa
  ];

  // Check if it starts with a valid prefix (considering both with and without hyphens)
  const hasValidPrefix = validPrefixes.some(prefix =>
    cleanPhone.startsWith(prefix) || phoneNumber.startsWith(prefix)
  );

  return hasValidPrefix;
}

/**
 * Validate product name
 */
export function validateProductName(name: string | null | undefined): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  const trimmedName = name.trim();

  if (trimmedName.length === 0) {
    return false;
  }

  // Check minimum and maximum length
  if (trimmedName.length < 1 || trimmedName.length > 200) {
    return false;
  }

  // Check for invalid characters
  const invalidChars = /[<>{}[\]\\|\\^`]/;
  if (invalidChars.test(trimmedName)) {
    return false;
  }

  return true;
}

/**
 * Validate brand name
 */
export function validateBrandName(brand: string | null | undefined): boolean {
  if (!brand || typeof brand !== 'string') {
    return true; // Brand is optional
  }

  const trimmedBrand = brand.trim();

  if (trimmedBrand.length === 0) {
    return true; // Empty brand is acceptable
  }

  // Check maximum length
  if (trimmedBrand.length > 100) {
    return false;
  }

  // Check for invalid characters
  const invalidChars = /[<>{}[\]\\|\\^`]/;
  if (invalidChars.test(trimmedBrand)) {
    return false;
  }

  return true;
}

/**
 * Validate category
 */
export function validateCategory(category: string | null | undefined): boolean {
  if (!category || typeof category !== 'string') {
    return true; // Category is optional
  }

  const trimmedCategory = category.trim();

  if (trimmedCategory.length === 0) {
    return true; // Empty category is acceptable
  }

  // Check maximum length
  if (trimmedCategory.length > 100) {
    return false;
  }

  // Check for invalid characters
  const invalidChars = /[<>{}[\]\\|\\^`]/;
  if (invalidChars.test(trimmedCategory)) {
    return false;
  }

  return true;
}

/**
 * Validate rating (1-5 stars)
 */
export function validateRating(rating: number | null | undefined): boolean {
  if (rating === null || rating === undefined) {
    return true; // Rating is optional
  }

  if (typeof rating !== 'number' || isNaN(rating)) {
    return false;
  }

  return rating >= 1 && rating <= 5;
}

/**
 * Validate discount percentage
 */
export function validateDiscountPercentage(discount: number | null | undefined): boolean {
  if (discount === null || discount === undefined) {
    return true; // Discount is optional
  }

  if (typeof discount !== 'number' || isNaN(discount)) {
    return false;
  }

  return discount >= 0 && discount <= 100;
}

/**
 * Validate stock quantity
 */
export function validateStockQuantity(quantity: number | null | undefined): boolean {
  if (quantity === null || quantity === undefined) {
    return true; // Quantity is optional
  }

  if (typeof quantity !== 'number' || isNaN(quantity)) {
    return false;
  }

  return quantity >= 0 && quantity <= 999999;
}

/**
 * Validate URL
 */
export function validateUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate date string
 */
export function validateDateString(dateString: string | null | undefined): boolean {
  if (!dateString || typeof dateString !== 'string') {
    return false;
  }

  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * Validate color hex code
 */
export function validateHexColor(color: string | null | undefined): boolean {
  if (!color || typeof color !== 'string') {
    return false;
  }

  const hexColorRegex = /^#([A-Fa-f0-9]{6})$/;
  return hexColorRegex.test(color);
}

/**
 * Validate file size (in bytes)
 */
export function validateFileSize(size: number | null | undefined, maxSizeMB: number = 10): boolean {
  if (size === null || size === undefined || typeof size !== 'number') {
    return true;
  }

  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return size >= 0 && size <= maxSizeBytes;
}

export default {
  validateProductCode,
  validatePriceInput,
  validateEmail,
  validateJapaneseText,
  validateSearchQuery,
  validateBarcode,
  formatPrice,
  sanitizeJapaneseText,
  validateAlertConfiguration,
  isValidJapaneseZipCode,
  isValidJapanesePhoneNumber,
  validateProductName,
  validateBrandName,
  validateCategory,
  validateRating,
  validateDiscountPercentage,
  validateStockQuantity,
  validateUrl,
  validateDateString,
  validateHexColor,
  validateFileSize,
};