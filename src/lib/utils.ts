import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as Japanese Yen currency
 * @param price - The price to format (number or string)
 * @returns Formatted price string (e.g., "1,000")
 */
export function formatPrice(price: number | string): string {
  return parseInt(String(price || 0), 10).toLocaleString('ja-JP');
}

/**
 * Calculate discount percentage
 * @param originalPrice - Original price before discount
 * @param currentPrice - Current price after discount
 * @returns Discount percentage (e.g., 20 for 20% off)
 */
export function calculateDiscountPercentage(
  originalPrice: number,
  currentPrice: number,
): number {
  if (!originalPrice || originalPrice <= currentPrice) return 0;
  return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
}
