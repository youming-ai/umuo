/**
 * Deal Service
 *
 * Manages promotional deals, community content, and user submissions.
 * Handles deal validation, moderation, voting, and community features.
 */

import { z } from 'zod';
import {
  DealSchema,
  DealTypeSchema,
  DealStatusSchema,
  DiscountTypeSchema,
  CommunityScoreSchema,
  DealSubmissionSchema,
  DealVoteSchema,
  DealCommentSchema,
  DealStatisticsSchema,
  type Deal,
  type DealType,
  type DealStatus,
  type DiscountType,
  type CommunityScore,
  type DealSubmission,
  type DealVote,
  type DealComment,
  type DealStatistics
} from '../models/deal';

// Deal creation configuration
export const DealCreationConfigSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: DealTypeSchema,
  discount: z.object({
    type: DiscountTypeSchema,
    value: z.number().nonnegative(),
    originalPrice: z.number().positive().optional(),
    conditions: z.array(z.string()).optional(),
  }),
  products: z.array(z.object({
    productId: z.string().uuid(),
    platformId: z.string(),
    originalPrice: z.number().positive(),
    discountedPrice: z.number().positive(),
    url: z.string().url(),
  })).min(1),
  platforms: z.array(z.string()).min(1),
  url: z.string().url(),
  images: z.array(z.object({
    url: z.string().url(),
    width: z.number().positive(),
    height: z.number().positive(),
    order: z.number().nonnegative(),
  })).optional(),
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  couponCode: z.string().optional(),
  restrictions: z.array(z.string()).optional(),
  submittedBy: z.string().uuid().optional(),
});

// Deal filter configuration
export const DealFilterSchema = z.object({
  status: DealStatusSchema.optional(),
  type: DealTypeSchema.optional(),
  platforms: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  minSavings: z.number().nonnegative().optional(),
  maxSavings: z.number().nonnegative().optional(),
  hasCouponCode: z.boolean().optional(),
  submittedBy: z.string().uuid().optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  page: z.number().positive().default(1),
  limit: z.number().positive().max(100).default(20),
  sortBy: z.enum(['newest', 'oldest', 'popular', 'trending', 'ending_soon', 'savings']).default('newest'),
});

// Deal vote configuration
export const DealVoteConfigSchema = z.object({
  dealId: z.string().uuid(),
  userId: z.string().uuid(),
  value: z.enum(['up', 'down']),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

// Deal comment configuration
export const DealCommentConfigSchema = z.object({
  dealId: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.string().min(1).max(1000),
  parentId: z.string().uuid().optional(),
});

// Deal moderation configuration
export const DealModerationConfigSchema = z.object({
  dealId: z.string().uuid(),
  moderatedBy: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'flag', 'feature']),
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  flagReason: z.string().optional(),
});

// TypeScript types
export type DealCreationConfig = z.infer<typeof DealCreationConfigSchema>;
export type DealFilter = z.infer<typeof DealFilterSchema>;
export type DealVoteConfig = z.infer<typeof DealVoteConfigSchema>;
export type DealCommentConfig = z.infer<typeof DealCommentConfigSchema>;
export type DealModerationConfig = z.infer<typeof DealModerationConfigSchema>;

// Deal statistics result
export interface DealStatisticsResult {
  totalDeals: number;
  activeDeals: number;
  expiredDeals: number;
  pendingDeals: number;
  totalSavings: number;
  averageSavings: number;
  mostVotedDeal: Deal | null;
  mostCommentedDeal: Deal | null;
  dealsByType: Record<DealType, number>;
  dealsByPlatform: Record<string, number>;
  communityEngagement: {
    totalVotes: number;
    totalComments: number;
    activeUsers: number;
  };
}

// Deal service class
export class DealService {
  private moderationQueue: string[] = [];
  private spamFilters: Map<string, (deal: Deal) => boolean> = new Map();

  constructor() {
    this.initializeSpamFilters();
  }

  private initializeSpamFilters(): void {
    // Initialize spam detection filters
    this.spamFilters.set('titleTooLong', (deal) => deal.title.length > 150);
    this.spamFilters.set('descriptionTooShort', (deal) => !deal.description || deal.description.length < 50);
    this.spamFilters.set('unrealisticDiscount', (deal) => {
      if (deal.products.length === 0) return false;
      const maxSavings = Math.max(...deal.products.map(p => p.originalPrice - p.discountedPrice));
      return maxSavings > deal.products[0].originalPrice * 0.9; // More than 90% off
    });
    this.spamFilters.set('suspiciousUrl', (deal) => {
      const suspiciousDomains = ['bit.ly', 'tinyurl.com', 'short.link'];
      return suspiciousDomains.some(domain => deal.url.includes(domain));
    });
  }

  // Core deal management methods
  async createDeal(config: DealCreationConfig): Promise<Deal> {
    // Validate deal configuration
    await this.validateDealConfig(config);

    const now = new Date();
    const products = config.products.map(product => ({
      ...product,
      savings: product.originalPrice - product.discountedPrice,
      savingsPercentage: Math.round(((product.originalPrice - product.discountedPrice) / product.originalPrice) * 100),
    }));

    const deal: Deal = {
      id: crypto.randomUUID(),
      title: config.title,
      description: config.description,
      type: config.type,
      discount: {
        type: config.discount.type,
        value: config.discount.value,
        originalPrice: config.discount.originalPrice,
        conditions: config.discount.conditions,
      },
      products,
      platforms: config.platforms,
      url: config.url,
      images: config.images || [],
      startDate: config.startDate || now,
      endDate: config.endDate,
      status: 'pending', // New deals start as pending
      communityScore: {
        upvotes: 0,
        downvotes: 0,
        totalScore: 0,
        voteCount: 0,
        reportCount: 0,
      },
      tags: config.tags,
      categories: config.categories,
      restrictions: config.restrictions,
      couponCode: config.couponCode,
      submission: {
        submittedBy: config.submittedBy,
        moderatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    // Run spam detection
    const spamScore = this.calculateSpamScore(deal);
    if (spamScore > 0.7) {
      deal.status = 'flagged';
      deal.submission!.flagReason = 'High spam score detected';
    }

    // Save to database (mock implementation)
    await this.saveDeal(deal);

    // Add to moderation queue if pending
    if (deal.status === 'pending') {
      this.moderationQueue.push(deal.id);
    }

    return deal;
  }

  async updateDeal(dealId: string, updates: Partial<Deal>): Promise<Deal | null> {
    const existingDeal = await this.getDeal(dealId);
    if (!existingDeal) return null;

    const updatedDeal: Deal = {
      ...existingDeal,
      ...updates,
      updatedAt: new Date(),
    };

    await this.saveDeal(updatedDeal);
    return updatedDeal;
  }

  async deleteDeal(dealId: string): Promise<boolean> {
    const deal = await this.getDeal(dealId);
    if (!deal) return false;

    // Soft delete by marking as expired
    await this.updateDeal(dealId, {
      status: 'expired',
      endDate: new Date(),
    });

    return true;
  }

  async getDeal(dealId: string): Promise<Deal | null> {
    // In real implementation, this would query the database
    return null;
  }

  async getDeals(filter: DealFilter): Promise<{
    deals: Deal[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    // In real implementation, this would query the database with filters
    const mockDeals: Deal[] = [];
    const total = mockDeals.length;
    const totalPages = Math.ceil(total / filter.limit);

    // Apply sorting
    const sortedDeals = this.sortDeals(mockDeals, filter.sortBy);

    // Apply pagination
    const startIndex = (filter.page - 1) * filter.limit;
    const paginatedDeals = sortedDeals.slice(startIndex, startIndex + filter.limit);

    return {
      deals: paginatedDeals,
      total,
      page: filter.page,
      totalPages,
    };
  }

  // Deal voting and community features
  async voteOnDeal(config: DealVoteConfig): Promise<{
    success: boolean;
    dealId: string;
    newScore: number;
    userVote: 'up' | 'down' | null;
    error?: string;
  }> {
    const deal = await this.getDeal(config.dealId);
    if (!deal) {
      return {
        success: false,
        dealId: config.dealId,
        newScore: deal?.communityScore.totalScore || 0,
        userVote: null,
        error: 'Deal not found',
      };
    }

    // Check if user can vote
    if (!this.canUserVote(deal, config.userId)) {
      return {
        success: false,
        dealId: config.dealId,
        newScore: deal.communityScore.totalScore,
        userVote: null,
        error: 'User cannot vote on this deal',
      };
    }

    // Check if user already voted
    const existingVote = await this.getUserVote(config.dealId, config.userId);
    if (existingVote) {
      return {
        success: false,
        dealId: config.dealId,
        newScore: deal.communityScore.totalScore,
        userVote: existingVote.value,
        error: 'User has already voted',
      };
    }

    // Create vote
    const vote: DealVote = {
      id: crypto.randomUUID(),
      dealId: config.dealId,
      userId: config.userId,
      value: config.value,
      ipAddress: config.ipAddress,
      userAgent: config.userAgent,
      createdAt: new Date(),
    };

    await this.saveVote(vote);

    // Update community score
    const newScore = this.updateCommunityScore(deal, config.value, true);

    await this.updateDeal(config.dealId, {
      communityScore: newScore,
    });

    return {
      success: true,
      dealId: config.dealId,
      newScore: newScore.totalScore,
      userVote: config.value,
    };
  }

  async addComment(config: DealCommentConfig): Promise<{
    success: boolean;
    commentId?: string;
    error?: string;
  }> {
    const deal = await this.getDeal(config.dealId);
    if (!deal) {
      return {
        success: false,
        error: 'Deal not found',
      };
    }

    // Validate comment content
    if (!this.isValidComment(config.content)) {
      return {
        success: false,
        error: 'Invalid comment content',
      };
    }

    const comment: DealComment = {
      id: crypto.randomUUID(),
      dealId: config.dealId,
      userId: config.userId,
      parentId: config.parentId,
      content: config.content,
      status: 'active',
      moderationStatus: 'approved',
      upvotes: 0,
      downvotes: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.saveComment(comment);

    return {
      success: true,
      commentId: comment.id,
    };
  }

  async getDealComments(dealId: string, options: {
    page?: number;
    limit?: number;
    sortBy?: 'newest' | 'oldest' | 'popular';
  } = {}): Promise<{
    comments: DealComment[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    // In real implementation, this would query the database
    const mockComments: DealComment[] = [];
    const total = mockComments.length;
    const page = options.page || 1;
    const limit = options.limit || 20;
    const totalPages = Math.ceil(total / limit);

    return {
      comments: mockComments,
      total,
      page,
      totalPages,
    };
  }

  // Deal moderation
  async moderateDeal(config: DealModerationConfig): Promise<{
    success: boolean;
    dealId: string;
    previousStatus: DealStatus;
    newStatus: DealStatus;
    error?: string;
  }> {
    const deal = await this.getDeal(config.dealId);
    if (!deal) {
      return {
        success: false,
        dealId: config.dealId,
        previousStatus: 'pending',
        newStatus: 'pending',
        error: 'Deal not found',
      };
    }

    const previousStatus = deal.status;
    let newStatus: DealStatus = previousStatus;

    switch (config.action) {
      case 'approve':
        newStatus = 'active';
        break;
      case 'reject':
        newStatus = 'rejected';
        break;
      case 'flag':
        newStatus = 'flagged';
        break;
      case 'feature':
        newStatus = 'active';
        // Add featured status
        await this.updateDeal(config.dealId, {
          featuredUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        });
        break;
    }

    const updatedDeal = await this.updateDeal(config.dealId, {
      status: newStatus,
      submission: {
        ...deal.submission!,
        moderatedBy: config.moderatedBy,
        moderatedAt: new Date(),
        moderationNotes: config.notes,
        flagReason: config.flagReason,
      },
    });

    if (updatedDeal) {
      // Remove from moderation queue if approved/rejected
      if (['approved', 'rejected'].includes(config.action)) {
        this.moderationQueue = this.moderationQueue.filter(id => id !== config.dealId);
      }

      return {
        success: true,
        dealId: config.dealId,
        previousStatus,
        newStatus,
      };
    }

    return {
      success: false,
      dealId: config.dealId,
      previousStatus,
      newStatus,
      error: 'Failed to update deal',
    };
  }

  async getModerationQueue(): Promise<Deal[]> {
    // In real implementation, this would query for pending deals
    const queueDeals: Deal[] = [];

    for (const dealId of this.moderationQueue) {
      const deal = await this.getDeal(dealId);
      if (deal && deal.status === 'pending') {
        queueDeals.push(deal);
      }
    }

    return queueDeals.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // Deal validation and spam detection
  private async validateDealConfig(config: DealCreationConfig): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // Validate title
    if (config.title.length < 5) {
      errors.push('Title must be at least 5 characters long');
    }

    // Validate discount
    if (config.products.length > 0) {
      for (const product of config.products) {
        if (product.discountedPrice >= product.originalPrice) {
          errors.push(`Discounted price must be less than original price for product ${product.productId}`);
        }
      }
    }

    // Validate dates
    if (config.endDate && config.startDate && config.endDate <= config.startDate) {
      errors.push('End date must be after start date');
    }

    // Validate URL
    if (!this.isValidUrl(config.url)) {
      errors.push('Invalid deal URL');
    }

    // Validate coupon code format
    if (config.couponCode && !this.isValidCouponCode(config.couponCode)) {
      errors.push('Invalid coupon code format');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private calculateSpamScore(deal: Deal): number {
    let spamScore = 0;
    const filterCount = this.spamFilters.size;

    for (const [name, filter] of this.spamFilters) {
      if (filter(deal)) {
        spamScore += 1 / filterCount;
      }
    }

    // Additional heuristics
    if (deal.title.includes('FREE') && deal.products.length === 0) {
      spamScore += 0.2;
    }

    if (deal.description && deal.description.length < 30) {
      spamScore += 0.1;
    }

    return Math.min(1, spamScore);
  }

  private canUserVote(deal: Deal, userId: string): boolean {
    // Check if deal is active
    if (deal.status !== 'active') return false;

    // Check if deal has expired
    if (deal.endDate && new Date() > deal.endDate) return false;

    // Additional business rules can be added here
    return true;
  }

  // Sorting and filtering
  private sortDeals(deals: Deal[], sortBy: string): Deal[] {
    switch (sortBy) {
      case 'newest':
        return [...deals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      case 'oldest':
        return [...deals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      case 'popular':
        return [...deals].sort((a, b) => b.communityScore.totalScore - a.communityScore.totalScore);
      case 'trending':
        return [...deals].sort((a, b) => {
          const scoreA = this.calculateTrendingScore(a);
          const scoreB = this.calculateTrendingScore(b);
          return scoreB - scoreA;
        });
      case 'ending_soon':
        return [...deals]
          .filter(deal => deal.endDate)
          .sort((a, b) => a.endDate!.getTime() - b.endDate!.getTime());
      case 'savings':
        return [...deals].sort((a, b) => {
          const savingsA = Math.max(...a.products.map(p => p.savings || 0));
          const savingsB = Math.max(...b.products.map(p => p.savings || 0));
          return savingsB - savingsA;
        });
      default:
        return deals;
    }
  }

  private calculateTrendingScore(deal: Deal): number {
    const now = new Date();
    const daysSinceCreation = (now.getTime() - deal.createdAt.getTime()) / (1000 * 60 * 60 * 24);

    // Decay older deals
    const timeDecay = Math.exp(-daysSinceCreation / 7); // 7-day half-life

    // Combine score and time factors
    return deal.communityScore.totalScore * timeDecay;
  }

  // Analytics and reporting
  async getDealStatistics(options: {
    startDate?: Date;
    endDate?: Date;
    platforms?: string[];
  } = {}): Promise<DealStatisticsResult> {
    // In real implementation, this would query database for analytics
    return {
      totalDeals: 0,
      activeDeals: 0,
      expiredDeals: 0,
      pendingDeals: 0,
      totalSavings: 0,
      averageSavings: 0,
      mostVotedDeal: null,
      mostCommentedDeal: null,
      dealsByType: {
        coupon: 0,
        sale: 0,
        bundle: 0,
        clearance: 0,
        limited_time: 0,
        flash_sale: 0,
        price_match: 0,
      },
      dealsByPlatform: {},
      communityEngagement: {
        totalVotes: 0,
        totalComments: 0,
        activeUsers: 0,
      },
    };
  }

  // Utility methods
  private updateCommunityScore(deal: Deal, voteValue: 'up' | 'down', isAdding: boolean = true): CommunityScore {
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

  private async getUserVote(dealId: string, userId: string): Promise<DealVote | null> {
    // In real implementation, this would query the database
    return null;
  }

  private isValidComment(content: string): boolean {
    return content.length >= 1 && content.length <= 1000 &&
           !content.includes('http') && // Basic spam protection
           !content.match(/[A-Z]{10,}/); // No excessive capitalization
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private isValidCouponCode(code: string): boolean {
    return code.length >= 3 && code.length <= 50 &&
           /^[A-Z0-9-_]+$/i.test(code);
  }

  // Database operations (mock implementations)
  private async saveDeal(deal: Deal): Promise<void> {
    console.log(`Saving deal ${deal.id}: ${deal.title}`);
  }

  private async saveVote(vote: DealVote): Promise<void> {
    console.log(`Saving vote for deal ${vote.dealId} by user ${vote.userId}: ${vote.value}`);
  }

  private async saveComment(comment: DealComment): Promise<void> {
    console.log(`Saving comment for deal ${comment.dealId} by user ${comment.userId}`);
  }

  // Deal recommendations
  async getRecommendedDeals(userId: string, options: {
    limit?: number;
    categories?: string[];
    platforms?: string[];
  } = {}): Promise<Deal[]> {
    // In real implementation, this would use ML algorithms for personalization
    const { limit = 10, categories, platforms } = options;

    const filter: DealFilter = {
      status: 'active',
      categories,
      platforms,
      limit,
      sortBy: 'trending',
    };

    const { deals } = await this.getDeals(filter);
    return deals;
  }

  // Deal discovery
  async searchDeals(query: string, options: {
    limit?: number;
    platforms?: string[];
    categories?: string[];
  } = {}): Promise<{
    deals: Deal[];
    total: number;
    suggestions: string[];
  }> {
    // In real implementation, this would use full-text search
    const filter: DealFilter = {
      limit: options.limit || 20,
      platforms: options.platforms,
      categories: options.categories,
      sortBy: 'popular',
    };

    const { deals, total } = await this.getDeals(filter);

    // Filter deals based on search query (simple implementation)
    const filteredDeals = deals.filter(deal =>
      deal.title.toLowerCase().includes(query.toLowerCase()) ||
      (deal.description && deal.description.toLowerCase().includes(query.toLowerCase())) ||
      deal.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
    );

    return {
      deals: filteredDeals,
      total: filteredDeals.length,
      suggestions: this.generateSearchSuggestions(query),
    };
  }

  private generateSearchSuggestions(query: string): string[] {
    // In real implementation, this would use actual search analytics
    const commonSearches = [
      'electronics',
      'fashion',
      'home',
      'beauty',
      'sports',
      'books',
      'toys',
      'food',
    ];

    return commonSearches.filter(suggestion =>
      suggestion.toLowerCase().includes(query.toLowerCase())
    );
  }
}

// Export schemas for validation
export {
  DealCreationConfigSchema,
  DealFilterSchema,
  DealVoteConfigSchema,
  DealCommentConfigSchema,
  DealModerationConfigSchema,
};

// Utility functions
export const createDefaultDealConfig = (): Partial<DealCreationConfig> => ({
  type: 'sale',
  tags: [],
  categories: [],
  startDate: new Date(),
});

export const validateDealType = (type: string): type is DealType => {
  return ['coupon', 'sale', 'bundle', 'clearance', 'limited_time', 'flash_sale', 'price_match'].includes(type);
};

export const calculateDealScore = (deal: Deal): number => {
  const { communityScore, products } = deal;
  const maxSavings = Math.max(...products.map(p => p.savings || 0));
  const voteRatio = communityScore.voteCount > 0 ? communityScore.upvotes / communityScore.voteCount : 0;

  return communityScore.totalScore * 0.6 + // Community votes
         maxSavings * 0.001 + // Savings amount (normalized)
         voteRatio * 20; // Vote ratio
};

export const isDealEndingSoon = (deal: Deal, hoursThreshold: number = 24): boolean => {
  if (!deal.endDate) return false;
  const timeRemaining = deal.endDate.getTime() - new Date().getTime();
  return timeRemaining > 0 && timeRemaining <= hoursThreshold * 60 * 60 * 1000;
};