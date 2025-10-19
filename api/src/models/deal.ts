/**
 * Deal Model
 *
 * Promotional deals and special offers from various platforms.
 * Includes community-driven deals with voting and scoring.
 */

import { z } from 'zod';
import { ProductImageSchema } from './product';

// Deal types
export const DealTypeSchema = z.enum(['coupon', 'sale', 'bundle', 'clearance', 'limited_time', 'flash_sale', 'price_match']);
export type DealType = z.infer<typeof DealTypeSchema>;

// Deal status
export const DealStatusSchema = z.enum(['active', 'pending', 'expired', 'rejected', 'flagged']);
export type DealStatus = z.infer<typeof DealStatusSchema>;

// Discount types
export const DiscountTypeSchema = z.enum(['percentage', 'fixed', 'buy_one_get_one', 'free_shipping', 'gift']);
export type DiscountType = z.infer<typeof DiscountTypeSchema>;

// Discount schema
export const DiscountSchema = z.object({
  type: DiscountTypeSchema,
  value: z.number().nonnegative(),
  originalPrice: z.number().positive().optional(),
  conditions: z.array(z.string()).optional(),
  minimumPurchase: z.number().nonnegative().optional(),
  maxDiscount: z.number().nonnegative().optional(),
  applicableProducts: z.array(z.string().uuid()).optional(),
});

// Deal product schema
export const DealProductSchema = z.object({
  productId: z.string().uuid(),
  platformId: z.string(),
  originalPrice: z.number().positive(),
  discountedPrice: z.number().positive(),
  savings: z.number().nonnegative(),
  savingsPercentage: z.number().nonnegative(),
  url: z.string().url(),
});

// Community score schema
export const CommunityScoreSchema = z.object({
  upvotes: z.number().nonnegative().default(0),
  downvotes: z.number().nonnegative().default(0),
  totalScore: z.number().default(0),
  userVote: z.enum(['up', 'down']).optional(),
  voteCount: z.number().nonnegative().default(0),
  reportCount: z.number().nonnegative().default(0),
});

// Deal submission schema
export const DealSubmissionSchema = z.object({
  submittedBy: z.string().uuid().optional(),
  submitterName: z.string().optional(),
  submitterEmail: z.string().email().optional(),
  submitterNotes: z.string().max(500).optional(),
  moderationNotes: z.string().max(500).optional(),
  moderatedBy: z.string().uuid().optional(),
  moderatedAt: z.date().optional(),
  flagReason: z.string().optional(),
});

// Main Deal schema
export const DealSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: DealTypeSchema,
  discount: DiscountSchema,
  products: z.array(DealProductSchema).min(1),
  platforms: z.array(z.string()).min(1),
  url: z.string().url(),
  images: z.array(ProductImageSchema).default([]),

  // Deal timing
  startDate: z.date(),
  endDate: z.date().optional(),
  featuredUntil: z.date().optional(),

  // Deal status and scoring
  status: DealStatusSchema.default('pending'),
  communityScore: CommunityScoreSchema.default({}),

  // Submission metadata
  submission: DealSubmissionSchema.optional(),

  // Additional metadata
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  restrictions: z.array(z.string()).optional(),
  couponCode: z.string().optional(),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  lastViewedAt: z.date().optional(),
  expiresAt: z.date().optional(),
});

// Deal statistics schema
export const DealStatisticsSchema = z.object({
  dealId: z.string().uuid(),
  viewCount: z.number().nonnegative().default(0),
  clickCount: z.number().nonnegative().default(0),
  conversionCount: z.number().nonnegative().default(0),
  totalSavings: z.number().nonnegative().default(0),
  averageRating: z.number().min(1).max(5).optional(),
  shareCount: z.number().nonnegative().default(0),
  reportCount: z.number().nonnegative().default(0),
});

// Deal vote schema
export const DealVoteSchema = z.object({
  id: z.string().uuid(),
  dealId: z.string().uuid(),
  userId: z.string().uuid(),
  value: z.enum(['up', 'down']),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.date(),
});

// Deal comment schema
export const DealCommentSchema = z.object({
  id: z.string().uuid(),
  dealId: z.string().uuid(),
  userId: z.string().uuid(),
  parentId: z.string().uuid().optional(), // For replies
  content: z.string().min(1).max(1000),
  status: z.enum(['active', 'hidden', 'deleted', 'flagged']).default('active'),
  moderationStatus: z.enum(['approved', 'pending', 'rejected']).default('approved'),
  upvotes: z.number().nonnegative().default(0),
  downvotes: z.number().nonnegative().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().optional(),
});

// TypeScript types
export type Deal = z.infer<typeof DealSchema>;
export type DealType = z.infer<typeof DealTypeSchema>;
export type DealStatus = z.infer<typeof DealStatusSchema>;
export type Discount = z.infer<typeof DiscountSchema>;
export type DealProduct = z.infer<typeof DealProductSchema>;
export type CommunityScore = z.infer<typeof CommunityScoreSchema>;
export type DealSubmission = z.infer<typeof DealSubmissionSchema>;
export type DealStatistics = z.infer<typeof DealStatisticsSchema>;
export type DealVote = z.infer<typeof DealVoteSchema>;
export type DealComment = z.infer<typeof DealCommentSchema>;

// Deal model class
export class DealModel {
  static create(dealData: Omit<Deal, 'id' | 'createdAt' | 'updatedAt'>): Deal {
    const now = new Date();
    return {
      ...dealData,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
  }

  static validate(deal: unknown): Deal {
    return DealSchema.parse(deal);
  }

  static sanitizeTitle(title: string): string {
    return title.trim().substring(0, 200);
  }

  static sanitizeDescription(description?: string): string | undefined {
    if (!description) return undefined;
    return description.trim().substring(0, 2000);
  }

  // Business logic methods
  static isActive(deal: Deal): boolean {
    const now = new Date();
    const isActiveStatus = deal.status === 'active';
    const hasStarted = now >= deal.startDate;
    const hasNotEnded = !deal.endDate || now <= deal.endDate;

    return isActiveStatus && hasStarted && hasNotEnded;
  }

  static isExpired(deal: Deal): boolean {
    if (!deal.endDate) return false;
    return new Date() > deal.endDate;
  }

  static isUpcoming(deal: Deal): boolean {
    return new Date() < deal.startDate && deal.status === 'active';
  }

  static isFlashSale(deal: Deal): boolean {
    return deal.type === 'flash_sale' ||
           (deal.endDate && deal.startDate &&
            (deal.endDate.getTime() - deal.startDate.getTime()) <= 24 * 60 * 60 * 1000); // 24 hours or less
  }

  static isFeatured(deal: Deal): boolean {
    return !!deal.featuredUntil && new Date() <= deal.featuredUntil;
  }

  static getTimeRemaining(deal: Deal): number | null {
    if (!deal.endDate) return null;
    return Math.max(0, deal.endDate.getTime() - new Date().getTime());
  }

  static getTimeRemainingText(deal: Deal): string {
    const timeRemaining = this.getTimeRemaining(deal);
    if (!timeRemaining || timeRemaining <= 0) return 'Ended';

    const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
    const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  }

  static getTotalSavings(deal: Deal): number {
    return deal.products.reduce((total, product) => total + product.savings, 0);
  }

  static getMaxSavingsPercentage(deal: Deal): number {
    return Math.max(...deal.products.map(product => product.savingsPercentage));
  }

  static getBestDealProduct(deal: Deal): DealProduct | null {
    if (deal.products.length === 0) return null;
    return deal.products.reduce((best, current) =>
      current.savingsPercentage > best.savingsPercentage ? current : best
    );
  }

  static hasValidCouponCode(deal: Deal): boolean {
    return !!deal.couponCode && deal.couponCode.length > 0;
  }

  static requiresCouponCode(deal: Deal): boolean {
    return deal.type === 'coupon' && this.hasValidCouponCode(deal);
  }

  static isGoodDeal(deal: Deal): boolean {
    const maxSavings = this.getMaxSavingsPercentage(deal);
    const totalSavings = this.getTotalSavings(deal);
    const score = deal.communityScore.totalScore;

    return maxSavings >= 20 || totalSavings >= 1000 || score >= 10;
  }

  static isTrending(deal: Deal): boolean {
    const score = deal.communityScore.totalScore;
    const upvoteRatio = this.getUpvoteRatio(deal);
    return score >= 5 && upvoteRatio >= 0.7;
  }

  static getUpvoteRatio(deal: Deal): number {
    const { upvotes, downvotes } = deal.communityScore;
    const totalVotes = upvotes + downvotes;
    return totalVotes > 0 ? upvotes / totalVotes : 0;
  }

  static hasValidImages(deal: Deal): boolean {
    return deal.images.length > 0 &&
           deal.images.every(img => img.url && img.width > 0 && img.height > 0);
  }

  static getPrimaryImage(deal: Deal) {
    const sortedImages = [...deal.images].sort((a, b) => a.order - b.order);
    return sortedImages[0] || null;
  }

  // Voting methods
  static canUserVote(deal: Deal, userId: string, existingVote?: DealVote): boolean {
    // Check if deal is active
    if (!this.isActive(deal)) return false;

    // Check if user already voted
    if (existingVote) return false;

    // Additional business rules can be added here
    return true;
  }

  static updateCommunityScore(deal: Deal, voteValue: 'up' | 'down', isAdding: boolean = true): CommunityScore {
    const { upvotes, downvotes } = deal.communityScore;
    const multiplier = isAdding ? 1 : -1;

    return {
      upvotes: Math.max(0, upvotes + (voteValue === 'up' ? multiplier : 0)),
      downvotes: Math.max(0, downvotes + (voteValue === 'down' ? multiplier : 0)),
      totalScore: Math.max(0, deal.communityScore.totalScore + (voteValue === 'up' ? multiplier : -multiplier)),
      voteCount: Math.max(0, deal.communityScore.voteCount + (isAdding ? 1 : -1)),
      reportCount: deal.communityScore.reportCount,
    };
  }

  // Sorting methods
  static sortByPopularity(deals: Deal[]): Deal[] {
    return [...deals].sort((a, b) => {
      const scoreA = a.communityScore.totalScore;
      const scoreB = b.communityScore.totalScore;
      return scoreB - scoreA;
    });
  }

  static sortBySavings(deals: Deal[]): Deal[] {
    return [...deals].sort((a, b) => {
      const savingsA = this.getMaxSavingsPercentage(a);
      const savingsB = this.getMaxSavingsPercentage(b);
      return savingsB - savingsA;
    });
  }

  static sortByNewest(deals: Deal[]): Deal[] {
    return [...deals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  static sortByExpiringSoon(deals: Deal[]): Deal[] {
    return [...deals]
      .filter(deal => deal.endDate)
      .sort((a, b) => {
        const timeA = a.endDate!.getTime();
        const timeB = b.endDate!.getTime();
        return timeA - timeB;
      });
  }

  // Filtering methods
  static filterActive(deals: Deal[]): Deal[] {
    return deals.filter(deal => this.isActive(deal));
  }

  static filterByType(deals: Deal[], type: DealType): Deal[] {
    return deals.filter(deal => deal.type === type);
  }

  static filterByPlatform(deals: Deal[], platformId: string): Deal[] {
    return deals.filter(deal => deal.platforms.includes(platformId));
  }

  static filterByMinimumSavings(deals: Deal[], minSavingsPercentage: number): Deal[] {
    return deals.filter(deal => this.getMaxSavingsPercentage(deal) >= minSavingsPercentage);
  }

  static filterWithCouponCode(deals: Deal[]): Deal[] {
    return deals.filter(deal => this.hasValidCouponCode(deal));
  }

  static filterTrending(deals: Deal[]): Deal[] {
    return deals.filter(deal => this.isTrending(deal));
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

  static validateDiscount(discount: Discount): boolean {
    if (discount.type === 'percentage') {
      return discount.value >= 0 && discount.value <= 100;
    }
    return discount.value >= 0;
  }

  static validateCouponCode(code: string): boolean {
    return code.length >= 3 && code.length <= 50 && /^[A-Z0-9-_]+$/i.test(code);
  }
}

// Export schemas for validation
export {
  DealTypeSchema,
  DealStatusSchema,
  DiscountTypeSchema,
  DiscountSchema,
  DealProductSchema,
  CommunityScoreSchema,
  DealSubmissionSchema,
  DealSchema,
  DealStatisticsSchema,
  DealVoteSchema,
  DealCommentSchema,
};

// Utility functions
export const createDefaultCommunityScore = (): CommunityScore => ({
  upvotes: 0,
  downvotes: 0,
  totalScore: 0,
  voteCount: 0,
  reportCount: 0,
});

export const createDefaultDealSubmission = (): DealSubmission => ({
  moderatedAt: new Date(),
});

export const calculateSavingsPercentage = (originalPrice: number, discountedPrice: number): number => {
  if (originalPrice <= discountedPrice) return 0;
  return Math.round(((originalPrice - discountedPrice) / originalPrice) * 100);
};

export const isValidDealType = (type: string): boolean => {
  return ['coupon', 'sale', 'bundle', 'clearance', 'limited_time', 'flash_sale', 'price_match'].includes(type);
};