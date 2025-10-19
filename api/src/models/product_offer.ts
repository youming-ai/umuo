/**
 * ProductOffer Model
 *
 * Specific product offer from a platform. Represents platform-specific
 * product listings with pricing, availability, and seller information.
 */

import { z } from 'zod';
import { ProductSchema, ProductImageSchema } from './product';

// Platform schema
export const PlatformSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  icon: z.string().url().optional(),
  supportedRegions: z.array(z.string()).default(['JP']),
  affiliateProgram: z.boolean().default(false),
});

// Price schema
export const PriceSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default('JPY'),
  originalPrice: z.number().positive().optional(),
  discountPercentage: z.number().nonnegative().max(100).optional(),
  validUntil: z.date().optional(),
});

// Availability schema
export const AvailabilitySchema = z.object({
  inStock: z.boolean(),
  quantity: z.number().nonnegative().optional(),
  estimatedDelivery: z.string().optional(),
  stockStatus: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'pre_order', 'discontinued']),
});

// Seller schema
export const SellerSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  rating: z.number().min(1).max(5).optional(),
  reviewCount: z.number().nonnegative().optional(),
  url: z.string().url().optional(),
  isOfficial: z.boolean().default(false),
});

// Shipping information schema
export const ShippingInfoSchema = z.object({
  free: z.boolean(),
  cost: z.number().nonnegative().optional(),
  estimatedDays: z.number().positive().optional(),
  methods: z.array(z.string()).default([]),
  availableRegions: z.array(z.string()).default(['JP']),
});

// Affiliate information schema
export const AffiliateInfoSchema = z.object({
  enabled: z.boolean(),
  trackingCode: z.string().optional(),
  commission: z.number().nonnegative().optional(),
  affiliateUrl: z.string().url().optional(),
});

// Review summary schema
export const ReviewSummarySchema = z.object({
  averageRating: z.number().min(1).max(5).optional(),
  totalReviews: z.number().nonnegative().optional(),
  ratingDistribution: z.object({
    5: z.number().nonnegative().default(0),
    4: z.number().nonnegative().default(0),
    3: z.number().nonnegative().default(0),
    2: z.number().nonnegative().default(0),
    1: z.number().nonnegative().default(0),
  }).optional(),
});

// ProductOffer schema
export const ProductOfferSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  platform: PlatformSchema,
  platformProductId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: PriceSchema,
  availability: AvailabilitySchema,
  seller: SellerSchema,
  shipping: ShippingInfoSchema,
  condition: z.enum(['new', 'used', 'refurbished']).default('new'),
  url: z.string().url(),
  images: z.array(ProductImageSchema).default([]),
  reviews: ReviewSummarySchema.optional(),
  affiliateInfo: AffiliateInfoSchema.optional(),
  firstSeenAt: z.date(),
  lastUpdatedAt: z.date(),
  metadata: z.record(z.unknown()).optional(),
});

// TypeScript types
export type Platform = z.infer<typeof PlatformSchema>;
export type Price = z.infer<typeof PriceSchema>;
export type Availability = z.infer<typeof AvailabilitySchema>;
export type Seller = z.infer<typeof SellerSchema>;
export type ShippingInfo = z.infer<typeof ShippingInfoSchema>;
export type AffiliateInfo = z.infer<typeof AffiliateInfoSchema>;
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;
export type ProductOffer = z.infer<typeof ProductOfferSchema>;

// Predefined platforms for Japanese market
export const JAPANESE_PLATFORMS = {
  AMAZON: {
    id: 'amazon',
    name: 'Amazon Japan',
    domain: 'amazon.co.jp',
    icon: 'https://images-na.ssl-images-amazon.com/images/G/09/amazon-icons/global-favicon.png',
    supportedRegions: ['JP'],
    affiliateProgram: true,
  } as Platform,
  RAKUTEN: {
    id: 'rakuten',
    name: '楽天市場',
    domain: 'rakuten.co.jp',
    icon: 'https://r.r10s.jp/com/img/home/rakuten.ico',
    supportedRegions: ['JP'],
    affiliateProgram: true,
  } as Platform,
  YAHOO_SHOPPING: {
    id: 'yahoo',
    name: 'Yahoo Shopping',
    domain: 'shopping.yahoo.co.jp',
    icon: 'https://s.yimg.jp/c/i/s-ico-20240123.png',
    supportedRegions: ['JP'],
    affiliateProgram: true,
  } as Platform,
  KAKAKU: {
    id: 'kakaku',
    name: '価格.com',
    domain: 'kakaku.com',
    icon: 'https://img.kakaku.com/images/logo/kakaku_com_header_pc.png',
    supportedRegions: ['JP'],
    affiliateProgram: true,
  } as Platform,
  MERCARI: {
    id: 'mercari',
    name: 'Mercari',
    domain: 'mercari.com',
    icon: 'https://assets.mercari.com/assets/icons/favicon-32x32.png',
    supportedRegions: ['JP'],
    affiliateProgram: false,
  } as Platform,
} as const;

// ProductOffer model class
export class ProductOfferModel {
  static create(offerData: Omit<ProductOffer, 'id' | 'firstSeenAt' | 'lastUpdatedAt'>): ProductOffer {
    const now = new Date();
    return {
      ...offerData,
      id: crypto.randomUUID(),
      firstSeenAt: now,
      lastUpdatedAt: now,
    };
  }

  static validate(offer: unknown): ProductOffer {
    return ProductOfferSchema.parse(offer);
  }

  static sanitizeTitle(title: string): string {
    return title.trim().substring(0, 200);
  }

  static sanitizeDescription(description?: string): string | undefined {
    if (!description) return undefined;
    return description.trim().substring(0, 2000);
  }

  // Business logic methods
  static isAvailable(offer: ProductOffer): boolean {
    return offer.availability.inStock &&
           offer.availability.stockStatus !== 'discontinued';
  }

  static isLowStock(offer: ProductOffer): boolean {
    return offer.availability.stockStatus === 'low_stock' ||
           (offer.availability.quantity !== undefined && offer.availability.quantity <= 5);
  }

  static hasDiscount(offer: ProductOffer): boolean {
    return offer.price.originalPrice !== undefined &&
           offer.price.originalPrice > offer.price.amount;
  }

  static getDiscountPercentage(offer: ProductOffer): number {
    if (!offer.price.originalPrice || offer.price.originalPrice <= offer.price.amount) {
      return 0;
    }
    return Math.round(((offer.price.originalPrice - offer.price.amount) / offer.price.originalPrice) * 100);
  }

  static getTotalPrice(offer: ProductOffer): number {
    const shipping = offer.shipping.cost || 0;
    return offer.price.amount + shipping;
  }

  static isOfficialSeller(offer: ProductOffer): boolean {
    return offer.seller.isOfficial ||
           offer.seller.name.toLowerCase().includes('official');
  }

  static hasValidRating(offer: ProductOffer): boolean {
    return offer.reviews !== undefined &&
           offer.reviews.averageRating !== undefined &&
           offer.reviews.totalReviews !== undefined &&
           offer.reviews.totalReviews > 0;
  }

  static getPlatformInfo(platformId: string): Platform | null {
    const platform = Object.values(JAPANESE_PLATFORMS).find(p => p.id === platformId);
    return platform || null;
  }

  static isJapanesePlatform(offer: ProductOffer): boolean {
    return JAPANESE_PLATFORMS[offer.platform.id.toUpperCase() as keyof typeof JAPANESE_PLATFORMS] !== undefined;
  }

  static supportsAffiliateTracking(offer: ProductOffer): boolean {
    return offer.platform.affiliateProgram &&
           offer.affiliateInfo?.enabled;
  }

  static getAffiliateUrl(offer: ProductOffer): string | null {
    if (!this.supportsAffiliateTracking(offer)) {
      return null;
    }
    return offer.affiliateInfo?.affiliateUrl || offer.url;
  }

  static needsUpdate(offer: ProductOffer, maxAgeHours: number = 24): boolean {
    const now = new Date();
    const ageInHours = (now.getTime() - offer.lastUpdatedAt.getTime()) / (1000 * 60 * 60);
    return ageInHours > maxAgeHours;
  }

  static getEstimatedDeliveryDate(offer: ProductOffer): Date | null {
    if (!offer.shipping.estimatedDays || !offer.shipping.estimatedDays) {
      return null;
    }

    const now = new Date();
    const estimatedDate = new Date(now.getTime() + (offer.shipping.estimatedDays * 24 * 60 * 60 * 1000));
    return estimatedDate;
  }

  static isGoodDeal(offer: ProductOffer, averagePrice?: number): boolean {
    if (!averagePrice) return false;

    const discount = this.getDiscountPercentage(offer);
    const priceDifference = ((averagePrice - offer.price.amount) / averagePrice) * 100;

    return discount > 10 || priceDifference > 15;
  }

  static sortOffersByPrice(offers: ProductOffer[], ascending: boolean = true): ProductOffer[] {
    return [...offers].sort((a, b) => {
      const totalA = this.getTotalPrice(a);
      const totalB = this.getTotalPrice(b);
      return ascending ? totalA - totalB : totalB - totalA;
    });
  }

  static sortOffersByRating(offers: ProductOffer[]): ProductOffer[] {
    return [...offers].sort((a, b) => {
      const ratingA = a.reviews?.averageRating || 0;
      const ratingB = b.reviews?.averageRating || 0;
      return ratingB - ratingA; // Highest rating first
    });
  }

  static filterByCondition(offers: ProductOffer[], condition: 'new' | 'used' | 'refurbished'): ProductOffer[] {
    return offers.filter(offer => offer.condition === condition);
  }

  static filterAvailableOffers(offers: ProductOffer[]): ProductOffer[] {
    return offers.filter(offer => this.isAvailable(offer));
  }

  static filterOffersWithDiscount(offers: ProductOffer[]): ProductOffer[] {
    return offers.filter(offer => this.hasDiscount(offer));
  }

  // Validation helpers
  static validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  static validatePrice(amount: number): boolean {
    return amount > 0 && amount <= 99999999; // Reasonable price limits
  }

  static validateRating(rating: number): boolean {
    return rating >= 1 && rating <= 5;
  }
}

// Export schemas for validation
export {
  PlatformSchema,
  PriceSchema,
  AvailabilitySchema,
  SellerSchema,
  ShippingInfoSchema,
  AffiliateInfoSchema,
  ReviewSummarySchema,
  ProductOfferSchema,
};

// Utility functions
export const createDefaultAvailability = (): Availability => ({
  inStock: true,
  stockStatus: 'in_stock',
});

export const createDefaultShipping = (): ShippingInfo => ({
  free: false,
  methods: ['standard'],
  availableRegions: ['JP'],
});

export const createDefaultAffiliateInfo = (): AffiliateInfo => ({
  enabled: false,
});

export const isValidJapanesePlatform = (platformId: string): boolean => {
  return Object.keys(JAPANESE_PLATFORMS).includes(platformId.toUpperCase());
};