import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { Review, ReviewSummary, AISummary } from '../models/review';

export interface SummaryRequest {
  productId: string;
  platformId: string;
  reviews: Review[];
  language?: 'ja' | 'en' | 'zh';
  maxSummaryLength?: number;
}

export interface SummaryResult {
  summary: AISummary;
  processedReviews: number;
  processingTimeMs: number;
}

export class AISummaryService {
  private static instance: AISummaryService;

  private constructor() {}

  static getInstance(): AISummaryService {
    if (!AISummaryService.instance) {
      AISummaryService.instance = new AISummaryService();
    }
    return AISummaryService.instance;
  }

  /**
   * Generate AI-powered review summary for a product
   */
  async generateReviewSummary(request: SummaryRequest): Promise<SummaryResult> {
    const startTime = Date.now();

    try {
      // Filter and prepare reviews
      const validReviews = request.reviews.filter(review =>
        review.content && review.content.trim().length > 0
      );

      if (validReviews.length === 0) {
        throw new Error('No valid reviews to summarize');
      }

      // Group reviews by rating to understand sentiment distribution
      const reviewsByRating = this.groupReviewsByRating(validReviews);

      // Generate summary using AI
      const aiSummary = await this.generateSummaryWithAI(validReviews, reviewsByRating, request);

      const processingTime = Date.now() - startTime;

      return {
        summary: aiSummary,
        processedReviews: validReviews.length,
        processingTimeMs: processingTime,
      };

    } catch (error) {
      console.error('AI Summary generation failed:', error);
      throw new Error(`Failed to generate AI summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update existing review summary with new reviews
   */
  async updateReviewSummary(
    existingSummary: ReviewSummary,
    newReviews: Review[],
    language: string = 'en'
  ): Promise<AISummary> {
    try {
      // Combine existing reviews with new ones
      const allReviews = [...newReviews];

      // Generate updated summary
      const result = await this.generateReviewSummary({
        productId: existingSummary.productId,
        platformId: existingSummary.platformId,
        reviews: allReviews,
        language: language as 'ja' | 'en' | 'zh',
      });

      return result.summary;

    } catch (error) {
      console.error('Failed to update AI summary:', error);
      throw new Error(`Failed to update AI summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate summary using AI models
   */
  private async generateSummaryWithAI(
    reviews: Review[],
    reviewsByRating: Record<number, Review[]>,
    request: SummaryRequest
  ): Promise<AISummary> {
    const language = request.language || 'en';
    const maxLength = request.maxSummaryLength || 300;

    // Prepare reviews text for AI
    const reviewsText = this.prepareReviewsText(reviews, language);

    // Create prompt based on language
    const prompt = this.createSummaryPrompt(reviewsText, reviewsByRating, language, maxLength);

    // Try different models for best result
    let aiResponse;
    let modelUsed = '';

    try {
      // Try Claude first (best at analysis)
      aiResponse = await generateText({
        model: anthropic('claude-3-sonnet-20240229'),
        prompt,
        system: this.getSystemPrompt(language),
        temperature: 0.3,
        maxTokens: 1000,
      });
      modelUsed = 'claude-3-sonnet';
    } catch (claudeError) {
      console.warn('Claude failed, trying GPT-4:', claudeError);

      try {
        // Fallback to GPT-4
        aiResponse = await generateText({
          model: openai('gpt-4-turbo-preview'),
          prompt,
          system: this.getSystemPrompt(language),
          temperature: 0.3,
          maxTokens: 1000,
        });
        modelUsed = 'gpt-4-turbo';
      } catch (gptError) {
        console.warn('GPT-4 failed, using fallback logic:', gptError);
        return this.generateFallbackSummary(reviews, language);
      }
    }

    // Parse AI response
    return this.parseAIResponse(aiResponse.text, modelUsed, language);
  }

  /**
   * Prepare reviews text for AI processing
   */
  private prepareReviewsText(reviews: Review[], language: string): string {
    const maxReviews = 50; // Limit to avoid token limits
    const selectedReviews = reviews
      .sort((a, b) => b.helpfulVotes - a.helpfulVotes) // Prioritize helpful reviews
      .slice(0, maxReviews);

    return selectedReviews.map(review => {
      const rating = review.rating;
      const content = review.content.trim();
      const helpfulVotes = review.helpfulVotes;

      return `[${rating}/5] (${helpfulVotes} helpful): ${content}`;
    }).join('\n\n');
  }

  /**
   * Create language-specific prompt for review summarization
   */
  private createSummaryPrompt(
    reviewsText: string,
    reviewsByRating: Record<number, Review[]>,
    language: string,
    maxLength: number
  ): string {
    const prompts = {
      en: `
Analyze these product reviews and provide a comprehensive summary:

${reviewsText}

Rating distribution:
${Object.entries(reviewsByRating).map(([rating, reviews]) =>
  `${rating} stars: ${reviews.length} reviews`
).join('\n')}

Please provide a JSON response with:
1. summary: Brief overall summary (${maxLength} chars max)
2. pros: Array of 3-5 key positive points
3. cons: Array of 3-5 key negative points

Focus on the most frequently mentioned themes and consensus points.`,

      ja: `
この製品レビューを分析し、包括的な要約を提供してください：

${reviewsText}

評価分布：
${Object.entries(reviewsByRating).map(([rating, reviews]) =>
  `${rating}星: ${reviews.length}件のレビュー`
).join('\n')}

以下の形式でJSONレスポンスを提供してください：
1. summary: 簡潔な全体要約（最大${maxLength}文字）
2. pros: 3-5つの主要な肯定的な点
3. cons: 3-5つの主要な否定的な点

最も頻繁に言及されているテーマとコンセンサスポイントに焦点を当ててください。`,

      zh: `
分析这些产品评论并提供全面总结：

${reviewsText}

评分分布：
${Object.entries(reviewsByRating).map(([rating, reviews]) =>
  `${rating}星: ${reviews.length}条评论`
).join('\n')}

请提供JSON格式的回复：
1. summary: 简要的总体总结（最多${maxLength}字符）
2. pros: 3-5个关键优点
3. cons: 3-5个关键缺点

专注于最常提到的主题和共识点。`
    };

    return prompts[language as keyof typeof prompts] || prompts.en;
  }

  /**
   * Get system prompt based on language
   */
  private getSystemPrompt(language: string): string {
    const systemPrompts = {
      en: 'You are an expert product review analyst. Provide objective, helpful insights based on customer reviews. Always respond in valid JSON format.',
      ja: 'あなたは製品レビュー分析の専門家です。顧客レビューに基づいて客観的で有用な洞察を提供してください。常に有効なJSON形式で応答してください。',
      zh: '您是专业的产品评论分析师。根据客户评论提供客观、有用的见解。请始终以有效的JSON格式回复。'
    };

    return systemPrompts[language as keyof typeof systemPrompts] || systemPrompts.en;
  }

  /**
   * Parse AI response into structured summary
   */
  private parseAIResponse(responseText: string, modelUsed: string, language: string): AISummary {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(responseText);

      return {
        summary: parsed.summary || '',
        pros: Array.isArray(parsed.pros) ? parsed.pros : [],
        cons: Array.isArray(parsed.cons) ? parsed.cons : [],
        confidence: this.calculateConfidence(parsed),
        generatedAt: new Date(),
        modelVersion: modelUsed,
      };

    } catch (error) {
      console.warn('Failed to parse AI response as JSON, using fallback parsing:', error);

      // Fallback parsing for non-JSON responses
      return this.parseTextResponse(responseText, modelUsed, language);
    }
  }

  /**
   * Parse non-JSON AI response
   */
  private parseTextResponse(responseText: string, modelUsed: string, language: string): AISummary {
    // Simple text parsing logic
    const lines = responseText.split('\n').filter(line => line.trim());

    return {
      summary: lines[0] || responseText.substring(0, 300),
      pros: lines.filter(line => line.toLowerCase().includes('pro') || line.toLowerCase().includes('good')).slice(0, 3),
      cons: lines.filter(line => line.toLowerCase().includes('con') || line.toLowerCase().includes('bad')).slice(0, 3),
      confidence: 0.5, // Lower confidence for fallback parsing
      generatedAt: new Date(),
      modelVersion: modelUsed,
    };
  }

  /**
   * Calculate confidence score based on summary quality
   */
  private calculateConfidence(parsedSummary: any): number {
    let confidence = 0.5; // Base confidence

    if (parsedSummary.summary && parsedSummary.summary.length > 50) confidence += 0.2;
    if (Array.isArray(parsedSummary.pros) && parsedSummary.pros.length >= 3) confidence += 0.15;
    if (Array.isArray(parsedSummary.cons) && parsedSummary.cons.length >= 3) confidence += 0.15;

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate fallback summary without AI
   */
  private generateFallbackSummary(reviews: Review[], language: string): AISummary {
    // Simple statistical analysis
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    const positiveReviews = reviews.filter(r => r.rating >= 4);
    const negativeReviews = reviews.filter(r => r.rating <= 2);

    // Extract common keywords (simplified)
    const positiveKeywords = this.extractKeywords(positiveReviews.map(r => r.content));
    const negativeKeywords = this.extractKeywords(negativeReviews.map(r => r.content));

    const summaryTexts = {
      en: `Average rating: ${avgRating.toFixed(1)}/5 based on ${reviews.length} reviews.`,
      ja: `平均評価: ${avgRating.toFixed(1)}/5（${reviews.length}件のレビュー基準）`,
      zh: `平均评分：${avgRating.toFixed(1)}/5（基于${reviews.length}条评论）`
    };

    return {
      summary: summaryTexts[language as keyof typeof summaryTexts] || summaryTexts.en,
      pros: positiveKeywords.slice(0, 3),
      cons: negativeKeywords.slice(0, 3),
      confidence: 0.3, // Low confidence for fallback
      generatedAt: new Date(),
      modelVersion: 'fallback',
    };
  }

  /**
   * Simple keyword extraction (placeholder implementation)
   */
  private extractKeywords(texts: string[]): string[] {
    // This is a simplified implementation
    // In production, you'd use proper NLP libraries
    const commonWords = ['good', 'great', 'excellent', 'bad', 'poor', 'terrible'];
    return commonWords.slice(0, 5);
  }

  /**
   * Group reviews by rating
   */
  private groupReviewsByRating(reviews: Review[]): Record<number, Review[]> {
    return reviews.reduce((groups, review) => {
      const rating = review.rating;
      if (!groups[rating]) {
        groups[rating] = [];
      }
      groups[rating].push(review);
      return groups;
    }, {} as Record<number, Review[]>);
  }
}

// Export singleton instance
export const aiSummaryService = AISummaryService.getInstance();

export default aiSummaryService;