/**
 * Review Model
 *
 * Product reviews and AI-generated summaries from various platforms.
 * Supports multiple languages and AI-powered sentiment analysis.
 */

import { z } from 'zod';

// Review sentiment schema
export const ReviewSentimentSchema = z.object({
  overall: z.enum(['positive', 'neutral', 'negative']),
  confidence: z.number().min(0).max(1),
  emotions: z.array(z.string()).optional(),
});

// Reviewer schema
export const ReviewerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  avatar: z.string().url().optional(),
  verified: z.boolean().default(false),
  rating: z.number().min(1).max(5).optional(),
  reviewCount: z.number().nonnegative().optional(),
  location: z.string().optional(),
  badges: z.array(z.string()).optional(),
});

// Rating distribution schema
export const RatingDistributionSchema = z.object({
  5: z.number().nonnegative().default(0),
  4: z.number().nonnegative().default(0),
  3: z.number().nonnegative().default(0),
  2: z.number().nonnegative().default(0),
  1: z.number().nonnegative().default(0),
});

// AI summary schema
export const AISummarySchema = z.object({
  summary: z.string().min(1).max(1000),
  pros: z.array(z.string()).max(10).default([]),
  cons: z.array(z.string()).max(10).default([]),
  confidence: z.number().min(0).max(1),
  generatedAt: z.date(),
  modelVersion: z.string(),
  language: z.string().length(2).default('ja'),
  reviewedCount: z.number().nonnegative().optional(),
  lastUpdated: z.date().optional(),
});

// Review validation schema
export const ReviewValidationSchema = z.object({
  isVerified: z.boolean(),
  authenticityScore: z.number().min(0).max(1).optional(),
  spamScore: z.number().min(0).max(1).default(0),
  moderationFlags: z.array(z.string()).default([]),
  lastModeratedAt: z.date().optional(),
});

// Main Review schema
export const ReviewSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  platformId: z.string(),
  platformReviewId: z.string(),
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(2000),
  rating: z.number().min(1).max(5),
  reviewer: ReviewerSchema,
  verified: z.boolean().default(false),
  helpfulVotes: z.number().nonnegative().default(0),
  totalVotes: z.number().nonnegative().default(0),

  // Review metadata
  sentiment: ReviewSentimentSchema.optional(),
  language: z.string().length(2).default('ja'),
  isTranslated: z.boolean().default(false),
  originalLanguage: z.string().length(2).optional(),

  // Product specifics
  variant: z.string().optional(),
  purchaseDate: z.date().optional(),
  purchaseVerified: z.boolean().default(false),

  // Platform-specific data
  platformMetadata: z.record(z.unknown()).optional(),

  // Validation and moderation
  validation: ReviewValidationSchema.optional(),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
  importedAt: z.date().optional(),
});

// Review summary schema (aggregated data)
export const ReviewSummarySchema = z.object({
  productId: z.string().uuid(),
  platformId: z.string(),
  averageRating: z.number().min(1).max(5),
  totalReviews: z.number().nonnegative(),
  ratingDistribution: RatingDistributionSchema,
  aiSummary: AISummarySchema.optional(),

  // Quality metrics
  verifiedReviewCount: z.number().nonnegative().default(0),
  averageReviewLength: z.number().nonnegative().optional(),
  sentimentDistribution: z.object({
    positive: z.number().nonnegative().default(0),
    neutral: z.number().nonnegative().default(0),
    negative: z.number().nonnegative().default(0),
  }).optional(),

  // Timestamps
  lastUpdated: z.date(),
  oldestReviewDate: z.date().optional(),
  newestReviewDate: z.date().optional(),
});

// Review analysis schema
export const ReviewAnalysisSchema = z.object({
  productId: z.string().uuid(),
  totalReviews: z.number().nonnegative(),
  averageRating: z.number().min(1).max(5),

  // Sentiment analysis
  sentimentScore: z.number().min(-1).max(1),
  positivePercentage: z.number().min(0).max(100),
  negativePercentage: z.number().min(0).max(100),

  // Common themes
  commonPros: z.array(z.string()).max(20).default([]),
  commonCons: z.array(z.string()).max(20).default([]),
  mentionedFeatures: z.array(z.string()).max(50).default([]),

  // Quality indicators
  verifiedPurchasePercentage: z.number().min(0).max(100),
  averageHelpfulVotes: z.number().nonnegative(),
  spamReviewPercentage: z.number().min(0).max(100),

  // Analysis metadata
  analyzedAt: z.date(),
  reviewSampleSize: z.number().nonnegative(),
  confidenceLevel: z.number().min(0).max(1),
});

// Review vote schema
export const ReviewVoteSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  userId: z.string().uuid(),
  value: z.enum(['helpful', 'not_helpful']),
  ipAddress: z.string().optional(),
  createdAt: z.date(),
});

// TypeScript types
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;
export type ReviewAnalysis = z.infer<typeof ReviewAnalysisSchema>;
export type ReviewVote = z.infer<typeof ReviewVoteSchema>;
export type ReviewSentiment = z.infer<typeof ReviewSentimentSchema>;
export type Reviewer = z.infer<typeof ReviewerSchema>;
export type RatingDistribution = z.infer<typeof RatingDistributionSchema>;
export type AISummary = z.infer<typeof AISummarySchema>;
export type ReviewValidation = z.infer<typeof ReviewValidationSchema>;

// Review model class
export class ReviewModel {
  static create(reviewData: Omit<Review, 'id' | 'createdAt' | 'updatedAt'>): Review {
    const now = new Date();
    return {
      ...reviewData,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
  }

  static validate(review: unknown): Review {
    return ReviewSchema.parse(review);
  }

  static sanitizeTitle(title?: string): string | undefined {
    if (!title) return undefined;
    return title.trim().substring(0, 200);
  }

  static sanitizeContent(content: string): string {
    return content.trim().substring(0, 2000);
  }

  static sanitizeReviewerName(name: string): string {
    return name.trim().substring(0, 100);
  }

  // Business logic methods
  static isRecent(review: Review, days: number = 30): boolean {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    return review.createdAt >= cutoffDate;
  }

  static isVerifiedPurchase(review: Review): boolean {
    return review.verified && review.purchaseVerified;
  }

  static isHighQuality(review: Review): boolean {
    return review.content.length >= 50 &&
           review.helpfulVotes > 0 &&
           review.validation?.spamScore !== undefined &&
           review.validation.spamScore < 0.3;
  }

  static isHelpful(review: Review): boolean {
    if (review.totalVotes === 0) return false;
    const helpfulRatio = review.helpfulVotes / review.totalVotes;
    return helpfulRatio >= 0.7; // 70% or more found it helpful
  }

  static hasSentiment(review: Review): boolean {
    return review.sentiment !== undefined;
  }

  static isPositive(review: Review): boolean {
    return review.sentiment?.overall === 'positive' || review.rating >= 4;
  }

  static isNegative(review: Review): boolean {
    return review.sentiment?.overall === 'negative' || review.rating <= 2;
  }

  static getReviewAge(review: Review): number {
    const now = new Date();
    return Math.floor((now.getTime() - review.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  }

  static getReadTime(review: Review): number {
    // Average reading speed: 200 words per minute
    const wordCount = review.content.split(/\s+/).length;
    return Math.max(1, Math.ceil(wordCount / 200));
  }

  // Summary calculation methods
  static calculateAverageRating(reviews: Review[]): number {
    if (reviews.length === 0) return 0;
    const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
    return Math.round((totalRating / reviews.length) * 100) / 100;
  }

  static calculateRatingDistribution(reviews: Review[]): RatingDistribution {
    const distribution: RatingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    reviews.forEach(review => {
      const rating = Math.floor(review.rating);
      if (rating >= 1 && rating <= 5) {
        distribution[rating as keyof RatingDistribution]++;
      }
    });

    return distribution;
  }

  static calculateVerifiedPercentage(reviews: Review[]): number {
    if (reviews.length === 0) return 0;
    const verifiedCount = reviews.filter(review => review.verified).length;
    return Math.round((verifiedCount / reviews.length) * 100);
  }

  static calculateSentimentDistribution(reviews: Review[]): { positive: number; neutral: number; negative: number } {
    const distribution = { positive: 0, neutral: 0, negative: 0 };

    reviews.forEach(review => {
      if (review.sentiment) {
        distribution[review.sentiment.overall]++;
      } else {
        // Fallback to rating-based sentiment
        if (review.rating >= 4) distribution.positive++;
        else if (review.rating <= 2) distribution.negative++;
        else distribution.neutral++;
      }
    });

    return distribution;
  }

  static findCommonThemes(reviews: Review[], options: {
    minMentions?: number;
    maxThemes?: number;
  } = {}): { pros: string[]; cons: string[]; features: string[] } {
    const { minMentions = 2, maxThemes = 10 } = options;

    // This would normally use NLP processing
    // For now, return placeholder data
    return {
      pros: [
        'Good quality',
        'Fast delivery',
        'Great value',
        'Easy to use',
        'Excellent customer service'
      ].slice(0, maxThemes),
      cons: [
        'Expensive',
        'Poor packaging',
        'Difficult setup',
        'Limited features',
        'Battery life issues'
      ].slice(0, maxThemes),
      features: [
        'Build quality',
        'Performance',
        'Design',
        'Price',
        'Usability',
        'Customer support',
        'Delivery speed',
        'Packaging'
      ].slice(0, maxThemes)
    };
  }

  // Filtering methods
  static filterByRating(reviews: Review[], rating: number): Review[] {
    return reviews.filter(review => Math.floor(review.rating) === rating);
  }

  static filterBySentiment(reviews: Review[], sentiment: 'positive' | 'neutral' | 'negative'): Review[] {
    return reviews.filter(review =>
      review.sentiment?.overall === sentiment ||
      (sentiment === 'positive' && review.rating >= 4) ||
      (sentiment === 'negative' && review.rating <= 2) ||
      (sentiment === 'neutral' && review.rating === 3)
    );
  }

  static filterVerified(reviews: Review[]): Review[] {
    return reviews.filter(review => review.verified);
  }

  static filterByLanguage(reviews: Review[], language: string): Review[] {
    return reviews.filter(review => review.language === language);
  }

  static filterRecent(reviews: Review[], days: number = 30): Review[] {
    return reviews.filter(review => this.isRecent(review, days));
  }

  static filterHelpful(reviews: Review[], minHelpfulVotes: number = 1): Review[] {
    return reviews.filter(review => review.helpfulVotes >= minHelpfulVotes);
  }

  // Sorting methods
  static sortByRating(reviews: Review[], descending: boolean = true): Review[] {
    return [...reviews].sort((a, b) =>
      descending ? b.rating - a.rating : a.rating - b.rating
    );
  }

  static sortByHelpfulness(reviews: Review[]): Review[] {
    return [...reviews].sort((a, b) => {
      const helpfulnessA = a.totalVotes > 0 ? a.helpfulVotes / a.totalVotes : 0;
      const helpfulnessB = b.totalVotes > 0 ? b.helpfulVotes / b.totalVotes : 0;
      return helpfulnessB - helpfulnessA;
    });
  }

  static sortByNewest(reviews: Review[]): Review[] {
    return [...reviews].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  static sortByOldest(reviews: Review[]): Review[] {
    return [...reviews].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // Review summary methods
  static createReviewSummary(
    reviews: Review[],
    productId: string,
    platformId: string,
    options: {
      includeAI?: boolean;
      language?: string;
    } = {}
  ): ReviewSummary {
    const now = new Date();
    const averageRating = this.calculateAverageRating(reviews);
    const ratingDistribution = this.calculateRatingDistribution(reviews);
    const verifiedCount = reviews.filter(review => review.verified).length;
    const averageLength = reviews.length > 0
      ? Math.round(reviews.reduce((sum, review) => sum + review.content.length, 0) / reviews.length)
      : undefined;

    const sentimentDistribution = this.calculateSentimentDistribution(reviews);

    const oldestDate = reviews.length > 0
      ? new Date(Math.min(...reviews.map(review => review.createdAt.getTime())))
      : undefined;
    const newestDate = reviews.length > 0
      ? new Date(Math.max(...reviews.map(review => review.createdAt.getTime())))
      : undefined;

    return {
      productId,
      platformId,
      averageRating,
      totalReviews: reviews.length,
      ratingDistribution,
      verifiedReviewCount: verifiedCount,
      averageReviewLength: averageLength,
      sentimentDistribution,
      lastUpdated: now,
      oldestReviewDate: oldestDate,
      newestReviewDate: newestDate,
    };
  }

  // AI Summary generation helpers
  static shouldGenerateAISummary(summary: ReviewSummary): boolean {
    const hasEnoughReviews = summary.totalReviews >= 5;
    const isRecentSummary = summary.lastUpdated &&
      (new Date().getTime() - summary.lastUpdated.getTime()) < 7 * 24 * 60 * 60 * 1000; // 7 days

    return hasEnoughReviews && !isRecentSummary;
  }

  static validateAISummary(summary: AISummary): boolean {
    return summary.summary.length > 0 &&
           summary.confidence >= 0.5 &&
           summary.pros.length <= 10 &&
           summary.cons.length <= 10;
  }

  // Validation helpers
  static validateRating(rating: number): boolean {
    return rating >= 1 && rating <= 5;
  }

  static validateContent(content: string): boolean {
    return content.length >= 1 && content.length <= 2000;
  }

  static validateReviewerName(name: string): boolean {
    return name.length >= 1 && name.length <= 100;
  }

  static detectSpam(content: string): number {
    // Simple spam detection - in real implementation would use ML
    const spamIndicators = [
      /buy now/i,
      /click here/i,
      /free money/i,
      /!!!{3,}/, // excessive exclamation marks
      /\$[0-9,]+/g, // multiple price mentions
    ];

    let spamScore = 0;
    spamIndicators.forEach(indicator => {
      if (indicator.test(content)) {
        spamScore += 0.2;
      }
    });

    return Math.min(1, spamScore);
  }
}

// Export schemas for validation
export {
  ReviewSentimentSchema,
  ReviewerSchema,
  RatingDistributionSchema,
  AISummarySchema,
  ReviewValidationSchema,
  ReviewSchema,
  ReviewSummarySchema,
  ReviewAnalysisSchema,
  ReviewVoteSchema,
};

// Utility functions
export const createDefaultReviewer = (name: string): Reviewer => ({
  id: crypto.randomUUID(),
  name: ReviewModel.sanitizeReviewerName(name),
  verified: false,
});

export const createDefaultAISummary = (
  summary: string,
  modelVersion: string = 'gpt-3.5-turbo'
): AISummary => ({
  summary,
  pros: [],
  cons: [],
  confidence: 0.5,
  generatedAt: new Date(),
  modelVersion,
  language: 'ja',
  reviewedCount: 0,
});

export const calculateReviewScore = (
  averageRating: number,
  totalReviews: number,
  verifiedPercentage: number
): number => {
  const ratingWeight = 0.6;
  const reviewCountWeight = 0.2;
  const verifiedWeight = 0.2;

  const reviewCountScore = Math.min(1, totalReviews / 100); // Normalize to 0-1
  const verifiedScore = verifiedPercentage / 100;

  return (averageRating / 5) * ratingWeight +
         reviewCountScore * reviewCountWeight +
         verifiedScore * verifiedWeight;
};