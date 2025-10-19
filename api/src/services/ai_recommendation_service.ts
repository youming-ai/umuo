import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { User, Product, Recommendation, RecommendationType } from '../models';
import { userActivityService } from './user_activity_service';

export interface RecommendationRequest {
  userId: string;
  context?: {
    currentProduct?: string;
    category?: string;
    priceRange?: { min: number; max: number };
    searchQuery?: string;
  };
  limit?: number;
  types?: RecommendationType[];
  excludeSeen?: boolean;
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  metadata: {
    totalProcessed: number;
    processingTimeMs: number;
    modelUsed: string;
    confidence: number;
  };
}

export class AIRecommendationService {
  private static instance: AIRecommendationService;

  private constructor() {}

  static getInstance(): AIRecommendationService {
    if (!AIRecommendationService.instance) {
      AIRecommendationService.instance = new AIRecommendationService();
    }
    return AIRecommendationService.instance;
  }

  /**
   * Generate personalized product recommendations using AI
   */
  async generateRecommendations(request: RecommendationRequest): Promise<RecommendationResult> {
    const startTime = Date.now();
    const limit = request.limit || 10;

    try {
      // Get user data and behavior
      const userData = await this.getUserData(request.userId);

      // Get candidate products
      const candidates = await this.getCandidateProducts(userData, request);

      // Generate AI recommendations
      const recommendations = await this.generateAIRecommendations(
        userData,
        candidates,
        request
      );

      const processingTime = Date.now() - startTime;

      return {
        recommendations: recommendations.slice(0, limit),
        metadata: {
          totalProcessed: candidates.length,
          processingTimeMs: processingTime,
          modelUsed: 'ai-multi-model',
          confidence: this.calculateOverallConfidence(recommendations),
        },
      };

    } catch (error) {
      console.error('AI recommendation generation failed:', error);
      throw new Error(`Failed to generate recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate similar product recommendations
   */
  async getSimilarProducts(productId: string, limit: number = 5): Promise<Recommendation[]> {
    try {
      // Get product details
      const product = await this.getProductById(productId);
      if (!product) {
        throw new Error('Product not found');
      }

      // Find similar products based on attributes
      const similarProducts = await this.findSimilarProducts(product, limit * 2);

      // Use AI to rank and filter
      const rankedRecommendations = await this.rankSimilarProducts(product, similarProducts);

      return rankedRecommendations.slice(0, limit).map((item, index) => ({
        id: `rec_sim_${productId}_${index}`,
        userId: '', // Will be filled when assigned to user
        productId: item.id,
        type: 'similar_products' as RecommendationType,
        score: item.score,
        reason: {
          type: 'similarity',
          explanation: item.reason,
          confidence: item.confidence,
        },
        metadata: {
          similarityFactors: item.factors,
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      }));

    } catch (error) {
      console.error('Failed to generate similar products:', error);
      return [];
    }
  }

  /**
   * Get trending products recommendations
   */
  async getTrendingProducts(category?: string, limit: number = 10): Promise<Recommendation[]> {
    try {
      // Get trending data from activity logs
      const trendingData = await this.getTrendingData(category);

      // Use AI to analyze trends and provide insights
      const insights = await this.analyzeTrendsWithAI(trendingData);

      return insights.map((item, index) => ({
        id: `rec_trending_${category || 'all'}_${index}`,
        userId: '',
        productId: item.productId,
        type: 'trending' as RecommendationType,
        score: item.trendScore,
        reason: {
          type: 'trending',
          explanation: item.explanation,
          confidence: item.confidence,
        },
        metadata: {
          trendData: item.trendData,
          category: item.category,
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours
      }));

    } catch (error) {
      console.error('Failed to get trending products:', error);
      return [];
    }
  }

  /**
   * Get user data for recommendations
   */
  private async getUserData(userId: string) {
    // Get user profile
    const user = await this.getUserById(userId);

    // Get user activity and preferences
    const activities = await userActivityService.getUserActivities(userId, 100); // Last 100 activities
    const preferences = await this.getUserPreferences(userId);

    return {
      user,
      activities,
      preferences,
      profile: this.buildUserProfile(activities, preferences),
    };
  }

  /**
   * Get candidate products for recommendations
   */
  private async getCandidateProducts(userData: any, request: RecommendationRequest): Promise<any[]> {
    // This would typically query your product database
    // For now, returning mock data structure

    const candidates = [];

    // Get products from user's preferred categories
    if (userData.preferences.favoriteCategories.length > 0) {
      const categoryProducts = await this.getProductsByCategories(
        userData.preferences.favoriteCategories,
        50
      );
      candidates.push(...categoryProducts);
    }

    // Get products based on browsing history
    const historyBased = await this.getProductsFromHistory(userData.activities, 30);
    candidates.push(...historyBased);

    // Get popular products as fallback
    const popularProducts = await this.getPopularProducts(50);
    candidates.push(...popularProducts);

    // Remove duplicates and already seen products
    if (request.excludeSeen) {
      const seenProductIds = this.getSeenProductIds(userData.activities);
      return candidates.filter(p => !seenProductIds.includes(p.id));
    }

    return candidates.filter((product, index, array) =>
      array.findIndex(p => p.id === product.id) === index
    );
  }

  /**
   * Generate AI recommendations with detailed reasoning
   */
  private async generateAIRecommendations(
    userData: any,
    candidates: any[],
    request: RecommendationRequest
  ): Promise<Recommendation[]> {
    if (candidates.length === 0) {
      return [];
    }

    // Prepare data for AI
    const prompt = this.createRecommendationPrompt(userData, candidates, request);

    let aiResponse;
    let modelUsed = '';

    try {
      // Try Claude for nuanced recommendations
      aiResponse = await generateText({
        model: anthropic('claude-3-sonnet-20240229'),
        prompt,
        system: this.getRecommendationSystemPrompt(),
        temperature: 0.4,
        maxTokens: 2000,
      });
      modelUsed = 'claude-3-sonnet';
    } catch (claudeError) {
      console.warn('Claude failed, trying GPT-4:', claudeError);

      try {
        aiResponse = await generateText({
          model: openai('gpt-4-turbo-preview'),
          prompt,
          system: this.getRecommendationSystemPrompt(),
          temperature: 0.4,
          maxTokens: 2000,
        });
        modelUsed = 'gpt-4-turbo';
      } catch (gptError) {
        console.warn('AI models failed, using fallback logic:', gptError);
        return this.generateFallbackRecommendations(userData, candidates);
      }
    }

    return this.parseAIRecommendations(aiResponse.text, request.userId, modelUsed);
  }

  /**
   * Create recommendation prompt
   */
  private createRecommendationPrompt(userData: any, candidates: any[], request: RecommendationRequest): string {
    const userProfile = userData.profile;
    const recentActivity = userData.activities.slice(0, 10);

    return `
Generate personalized product recommendations for this user:

USER PROFILE:
${JSON.stringify(userProfile, null, 2)}

RECENT ACTIVITY:
${recentActivity.map(a => `${a.type}: ${a.targetId || a.metadata.query || 'N/A'}`).join('\n')}

CANDIDATE PRODUCTS:
${candidates.slice(0, 20).map(p => `
ID: ${p.id}
Name: ${p.name}
Category: ${p.category}
Price: ${p.price}
Rating: ${p.rating || 'N/A'}
Description: ${p.description || 'N/A'}
`).join('\n')}

RECOMMENDATION CONTEXT:
${request.context ? JSON.stringify(request.context, null, 2) : 'None'}

Please provide a JSON response with an array of recommendations. Each recommendation should include:
- productId: The product ID
- score: Confidence score (0-1)
- reason: Explanation for recommendation
- type: recommendation type (similar_products, price_drop, trending, personalized, alternative)
- metadata: Any additional relevant factors

Focus on personalization and relevance to the user's demonstrated interests and behavior patterns.`;
  }

  /**
   * Get system prompt for recommendations
   */
  private getRecommendationSystemPrompt(): string {
    return 'You are an expert e-commerce recommendation system. Analyze user behavior and preferences to provide highly relevant product recommendations. Consider price sensitivity, category preferences, brand loyalty, and seasonal trends. Always respond in valid JSON format.';
  }

  /**
   * Parse AI recommendations response
   */
  private parseAIRecommendations(responseText: string, userId: string, modelUsed: string): Recommendation[] {
    try {
      const parsed = JSON.parse(responseText);
      const recommendations = Array.isArray(parsed) ? parsed : parsed.recommendations || [];

      return recommendations.map((rec: any, index: number) => ({
        id: rec.id || `rec_${userId}_${index}_${Date.now()}`,
        userId,
        productId: rec.productId,
        type: rec.type || 'personalized',
        score: Math.max(0, Math.min(1, rec.score || 0.5)),
        reason: {
          type: rec.reasonType || 'personalization',
          explanation: rec.reason || 'Recommended based on your preferences',
          confidence: rec.confidence || 0.5,
        },
        metadata: rec.metadata || {},
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      }));

    } catch (error) {
      console.error('Failed to parse AI recommendations:', error);
      return [];
    }
  }

  /**
   * Generate fallback recommendations without AI
   */
  private generateFallbackRecommendations(userData: any, candidates: any[]): Recommendation[] {
    // Simple scoring based on user preferences
    const scored = candidates.map(product => {
      let score = 0.5; // Base score

      // Boost for preferred categories
      if (userData.preferences.favoriteCategories.includes(product.category)) {
        score += 0.3;
      }

      // Boost for preferred price range
      const avgPrice = userData.preferences.preferredPriceRange ||
                      { min: 1000, max: 10000 };
      if (product.price >= avgPrice.min && product.price <= avgPrice.max) {
        score += 0.2;
      }

      // Boost for highly rated products
      if (product.rating && product.rating >= 4) {
        score += 0.2;
      }

      return {
        product,
        score: Math.min(1, score),
      };
    });

    // Sort by score and take top recommendations
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((item, index) => ({
        id: `rec_fallback_${Date.now()}_${index}`,
        userId: userData.user.id,
        productId: item.product.id,
        type: 'personalized' as RecommendationType,
        score: item.score,
        reason: {
          type: 'personalization',
          explanation: 'Recommended based on your preferences',
          confidence: 0.3, // Lower confidence for fallback
        },
        metadata: {
          fallbackMethod: 'preference_scoring',
        },
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }));
  }

  /**
   * Calculate overall confidence for recommendations
   */
  private calculateOverallConfidence(recommendations: Recommendation[]): number {
    if (recommendations.length === 0) return 0;

    const totalConfidence = recommendations.reduce((sum, rec) => sum + rec.reason.confidence, 0);
    return totalConfidence / recommendations.length;
  }

  // Helper methods (would be implemented with actual database queries)
  private async getUserById(userId: string) {
    // Implementation would query user database
    return { id: userId, preferences: {}, language: 'en' };
  }

  private async getUserPreferences(userId: string) {
    // Implementation would query user preferences
    return {
      favoriteCategories: ['electronics', 'books'],
      preferredPriceRange: { min: 1000, max: 10000 },
      preferredPlatforms: ['amazon', 'rakuten'],
    };
  }

  private buildUserProfile(activities: any[], preferences: any) {
    // Analyze activities to build user profile
    return {
      interests: [],
      priceSensitivity: 'medium',
      brandAffinity: [],
      activityLevel: activities.length,
    };
  }

  private async getProductsByCategories(categories: string[], limit: number) {
    // Implementation would query product database
    return [];
  }

  private async getProductsFromHistory(activities: any[], limit: number) {
    // Implementation would find similar products based on history
    return [];
  }

  private async getPopularProducts(limit: number) {
    // Implementation would query popular products
    return [];
  }

  private getSeenProductIds(activities: any[]) {
    return activities
      .filter(a => a.type === 'view_product' && a.targetId)
      .map(a => a.targetId);
  }

  private async getProductById(productId: string) {
    // Implementation would query product database
    return { id: productId, name: 'Sample Product' };
  }

  private async findSimilarProducts(product: any, limit: number) {
    // Implementation would find similar products
    return [];
  }

  private async rankSimilarProducts(baseProduct: any, similarProducts: any[]) {
    // Implementation would use AI to rank similar products
    return similarProducts.map(p => ({
      ...p,
      score: Math.random(),
      reason: 'Similar to viewed product',
      confidence: 0.7,
      factors: {},
    }));
  }

  private async getTrendingData(category?: string) {
    // Implementation would get trending data from activity logs
    return [];
  }

  private async analyzeTrendsWithAI(trendingData: any[]) {
    // Implementation would use AI to analyze trends
    return [];
  }
}

// Export singleton instance
export const aiRecommendationService = AIRecommendationService.getInstance();

export default aiRecommendationService;