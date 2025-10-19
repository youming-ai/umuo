import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

export interface ModerationRequest {
  content: string;
  contentType: 'comment' | 'deal' | 'review' | 'user_message';
  userId?: string;
  context?: {
    productId?: string;
    dealId?: string;
    platform?: string;
  };
  language?: 'ja' | 'en' | 'zh' | 'auto';
}

export interface ModerationResult {
  approved: boolean;
  category?: ModerationCategory;
  confidence: number;
  reason?: string;
  filteredContent?: string;
  requiresManualReview: boolean;
  metadata: {
    processingTimeMs: number;
    modelUsed: string;
    detectedIssues: string[];
  };
}

export type ModerationCategory =
  | 'spam'
  | 'offensive'
  | 'inappropriate'
  | 'misinformation'
  | 'personal_info'
  | 'promotion'
  | 'off_topic'
  | 'duplicate'
  | 'safe';

export interface ContentFilter {
  patterns: RegExp[];
  keywords: string[];
  severity: 'low' | 'medium' | 'high';
}

export class AIModerationService {
  private static instance: AIModerationService;
  private contentFilters: Map<ModerationCategory, ContentFilter>;

  private constructor() {
    this.initializeContentFilters();
  }

  static getInstance(): AIModerationService {
    if (!AIModerationService.instance) {
      AIModerationService.instance = new AIModerationService();
    }
    return AIModerationService.instance;
  }

  /**
   * Moderate content using AI and rule-based filters
   */
  async moderateContent(request: ModerationRequest): Promise<ModerationResult> {
    const startTime = Date.now();

    try {
      // Detect language if auto
      const detectedLanguage = await this.detectLanguage(request.content);

      // Quick rule-based checks first
      const ruleBasedResult = await this.performRuleBasedModeration(request, detectedLanguage);

      // If clearly unsafe or spam, return immediately
      if (ruleBasedResult.confidence > 0.9) {
        return {
          ...ruleBasedResult,
          metadata: {
            processingTimeMs: Date.now() - startTime,
            modelUsed: 'rule_based',
            detectedIssues: [ruleBasedResult.category || 'unknown'],
          },
        };
      }

      // Use AI for nuanced analysis
      const aiResult = await this.performAIModeration(request, detectedLanguage);

      // Combine results
      const finalResult = this.combineModerationResults(ruleBasedResult, aiResult);

      return {
        ...finalResult,
        metadata: {
          processingTimeMs: Date.now() - startTime,
          modelUsed: 'hybrid',
          detectedIssues: this.getDetectedIssues(ruleBasedResult, aiResult),
        },
      };

    } catch (error) {
      console.error('Content moderation failed:', error);

      // Fail safely - approve but flag for review
      return {
        approved: true,
        requiresManualReview: true,
        confidence: 0.1,
        reason: 'Moderation service error',
        category: 'safe',
        metadata: {
          processingTimeMs: Date.now() - startTime,
          modelUsed: 'error_fallback',
          detectedIssues: ['moderation_error'],
        },
      };
    }
  }

  /**
   * Batch moderate multiple content items
   */
  async moderateBatch(requests: ModerationRequest[]): Promise<ModerationResult[]> {
    const results = await Promise.allSettled(
      requests.map(request => this.moderateContent(request))
    );

    return results.map(result =>
      result.status === 'fulfilled' ? result.value : {
        approved: true,
        requiresManualReview: true,
        confidence: 0.1,
        reason: 'Batch processing error',
        category: 'safe' as ModerationCategory,
        metadata: {
          processingTimeMs: 0,
          modelUsed: 'batch_error',
          detectedIssues: ['batch_error'],
        },
      }
    );
  }

  /**
   * Filter and clean content
   */
  async filterContent(content: string, filters: ModerationCategory[]): Promise<string> {
    let filteredContent = content;

    for (const category of filters) {
      const filter = this.contentFilters.get(category);
      if (filter) {
        filteredContent = this.applyFilter(filteredContent, filter);
      }
    }

    return filteredContent;
  }

  /**
   * Perform rule-based moderation for quick detection
   */
  private async performRuleBasedModeration(
    request: ModerationRequest,
    language: string
  ): Promise<Partial<ModerationResult>> {
    const content = request.content.toLowerCase();
    let maxSeverity = 0;
    let detectedCategory: ModerationCategory | undefined;
    let detectedIssues: string[] = [];

    // Check each category filter
    for (const [category, filter] of this.contentFilters) {
      const severityScore = this.checkAgainstFilter(content, filter);
      if (severityScore > maxSeverity) {
        maxSeverity = severityScore;
        detectedCategory = category;
      }

      if (severityScore > 0) {
        detectedIssues.push(category);
      }
    }

    // Check length constraints
    if (content.length < 1 || content.length > 1000) {
      return {
        approved: false,
        category: 'inappropriate',
        confidence: 0.9,
        reason: 'Content length violates guidelines',
        requiresManualReview: false,
      };
    }

    // Check for repeated patterns (spam indicator)
    if (this.hasRepeatedPatterns(request.content)) {
      return {
        approved: false,
        category: 'spam',
        confidence: 0.8,
        reason: 'Repeated patterns detected',
        requiresManualReview: false,
      };
    }

    const isApproved = maxSeverity < 0.7;
    const severityScore = Math.min(maxSeverity, 1);

    return {
      approved: isApproved,
      category: detectedCategory || 'safe',
      confidence: isApproved ? 1 - severityScore : severityScore,
      requiresManualReview: severityScore > 0.5 && severityScore < 0.8,
    };
  }

  /**
   * Perform AI-powered moderation for nuanced content
   */
  private async performAIModeration(
    request: ModerationRequest,
    language: string
  ): Promise<Partial<ModerationResult>> {
    const prompt = this.createModerationPrompt(request, language);

    let aiResponse;
    let modelUsed = '';

    try {
      // Try Claude for nuanced understanding
      aiResponse = await generateText({
        model: anthropic('claude-3-sonnet-20240229'),
        prompt,
        system: this.getModerationSystemPrompt(language),
        temperature: 0.1, // Low temperature for consistent moderation
        maxTokens: 500,
      });
      modelUsed = 'claude-3-sonnet';
    } catch (claudeError) {
      console.warn('Claude moderation failed, trying GPT-4:', claudeError);

      try {
        aiResponse = await generateText({
          model: openai('gpt-4-turbo-preview'),
          prompt,
          system: this.getModerationSystemPrompt(language),
          temperature: 0.1,
          maxTokens: 500,
        });
        modelUsed = 'gpt-4-turbo';
      } catch (gptError) {
        console.warn('AI moderation failed, using safe default:', gptError);
        return {
          approved: true,
          category: 'safe',
          confidence: 0.5,
          requiresManualReview: true,
          reason: 'AI moderation unavailable',
        };
      }
    }

    return this.parseAIModerationResponse(aiResponse.text, modelUsed);
  }

  /**
   * Create moderation prompt for AI
   */
  private createModerationPrompt(request: ModerationRequest, language: string): string {
    const content = request.content;
    const contentType = request.contentType;
    const context = request.context || {};

    const prompts = {
      en: `
Moderate this ${contentType} for community guidelines:

CONTENT: "${content}"

CONTEXT: ${JSON.stringify(context)}

Analyze for:
1. Spam or promotional content
2. Offensive or inappropriate language
3. Personal information sharing
4. Misinformation
5. Relevance to the context

Respond with JSON:
{
  "approved": boolean,
  "category": "spam/offensive/inappropriate/misinformation/personal_info/promotion/off_topic/safe",
  "confidence": number (0-1),
  "reason": "brief explanation",
  "requiresManualReview": boolean
}`,

      ja: `
この${contentType}をコミュニティガイドラインについて審査してください：

コンテンツ: "${content}"

コンテキスト: ${JSON.stringify(context)}

以下について分析してください：
1. スパムまたは宣伝コンテンツ
2. 攻撃的または不適切な言語
3. 個人情報の共有
4. 誤情報
5. コンテキストとの関連性

JSON形式で応答してください：
{
  "approved": boolean,
  "category": "spam/offensive/inappropriate/misinformation/personal_info/promotion/off_topic/safe",
  "confidence": number (0-1),
  "reason": "簡単な説明",
  "requiresManualReview": boolean
}`,

      zh: `
审核此${contentType}是否符合社区准则：

内容: "${content}"

上下文: ${JSON.stringify(context)}

分析：
1. 垃圾信息或推广内容
2. 冒犯性或不当语言
3. 个人信息分享
4. 错误信息
5. 与上下文的关联性

请用JSON格式回复：
{
  "approved": boolean,
  "category": "spam/offensive/inappropriate/misinformation/personal_info/promotion/off_topic/safe",
  "confidence": number (0-1),
  "reason": "简要说明",
  "requiresManualReview": boolean
}`
    };

    return prompts[language as keyof typeof prompts] || prompts.en;
  }

  /**
   * Get system prompt for moderation
   */
  private getModerationSystemPrompt(language: string): string {
    const systemPrompts = {
      en: 'You are a content moderator for a Japanese e-commerce platform. Ensure content is safe, respectful, and relevant. Consider cultural context. Always respond in valid JSON format.',
      ja: 'あなたは日本のEコマースプラットフォームのコンテンツ審査担当者です。コンテンツが安全、敬意に満ち、関連性があることを確認してください。文化的背景を考慮してください。常に有効なJSON形式で応答してください。',
      zh: '您是日本电商平台的内容审核员。确保内容安全、尊重他人且相关。考虑文化背景。请始终以有效的JSON格式回复。'
    };

    return systemPrompts[language as keyof typeof systemPrompts] || systemPrompts.en;
  }

  /**
   * Parse AI moderation response
   */
  private parseAIModerationResponse(responseText: string, modelUsed: string): Partial<ModerationResult> {
    try {
      const parsed = JSON.parse(responseText);

      return {
        approved: Boolean(parsed.approved),
        category: parsed.category,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        reason: parsed.reason,
        requiresManualReview: Boolean(parsed.requiresManualReview),
      };

    } catch (error) {
      console.error('Failed to parse AI moderation response:', error);
      return {
        approved: true, // Fail safe
        category: 'safe',
        confidence: 0.3,
        requiresManualReview: true,
        reason: 'Failed to parse AI response',
      };
    }
  }

  /**
   * Combine rule-based and AI moderation results
   */
  private combineModerationResults(
    ruleBased: Partial<ModerationResult>,
    aiResult: Partial<ModerationResult>
  ): ModerationResult {
    // If either strongly rejects, reject
    if (ruleBased.confidence && ruleBased.confidence > 0.9 && !ruleBased.approved) {
      return {
        approved: false,
        category: ruleBased.category,
        confidence: ruleBased.confidence,
        reason: ruleBased.reason,
        requiresManualReview: false,
        metadata: {
          processingTimeMs: 0,
          modelUsed: 'hybrid',
          detectedIssues: [],
        },
      };
    }

    if (aiResult.confidence && aiResult.confidence > 0.9 && !aiResult.approved) {
      return {
        approved: false,
        category: aiResult.category,
        confidence: aiResult.confidence,
        reason: aiResult.reason,
        requiresManualReview: aiResult.requiresManualReview || false,
        metadata: {
          processingTimeMs: 0,
          modelUsed: 'hybrid',
          detectedIssues: [],
        },
      };
    }

    // Weighted confidence calculation
    const ruleBasedWeight = 0.3;
    const aiWeight = 0.7;

    const finalConfidence = ruleBased.confidence && aiResult.confidence
      ? (ruleBased.confidence * ruleBasedWeight) + (aiResult.confidence * aiWeight)
      : aiResult.confidence || ruleBased.confidence || 0.5;

    const finalApproved = finalConfidence < 0.6;

    return {
      approved: finalApproved,
      category: aiResult.category || ruleBased.category || 'safe',
      confidence: finalConfidence,
      reason: aiResult.reason || ruleBased.reason,
      requiresManualReview: (aiResult.requiresManualReview || ruleBased.requiresManualReview || false) && !finalApproved,
      metadata: {
        processingTimeMs: 0,
        modelUsed: 'hybrid',
        detectedIssues: [],
      },
    };
  }

  /**
   * Detect content language
   */
  private async detectLanguage(content: string): Promise<'ja' | 'en' | 'zh'> {
    // Simple language detection based on character sets
    const japaneseChars = content.match(/[\u3040-\u309f\u30a0-\u30ff]/g);
    const chineseChars = content.match(/[\u4e00-\u9fff]/g);
    const englishWords = content.match(/[a-zA-Z]+/g);

    if (japaneseChars && japaneseChars.length > 0) return 'ja';
    if (chineseChars && chineseChars.length > (englishWords?.length || 0)) return 'zh';
    return 'en';
  }

  /**
   * Initialize content filters for different categories
   */
  private initializeContentFilters(): void {
    this.contentFilters = new Map([
      ['spam', {
        patterns: [
          /(buy now|order now|limited time|act now|click here)/gi,
          /(http[s]?:\/\/[^\s]+)/gi,
          /(\b\d{3,}\b|\$\d+\b|¥\d+\b)/gi,
        ],
        keywords: ['free', 'win', 'prize', 'lottery', 'guarantee', 'risk free'],
        severity: 'high',
      }],
      ['offensive', {
        patterns: [
          /\b(swear|curse|damn|hell)\b/gi,
        ],
        keywords: ['inappropriate', 'offensive', 'vulgar'],
        severity: 'high',
      }],
      ['personal_info', {
        patterns: [
          /\b\d{3}-\d{3}-\d{4}\b/g, // Phone numbers
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Emails
          /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, // Credit cards
        ],
        keywords: ['phone', 'email', 'address', 'ssn', 'credit card'],
        severity: 'high',
      }],
    ]);
  }

  /**
   * Check content against a filter
   */
  private checkAgainstFilter(content: string, filter: ContentFilter): number {
    let score = 0;

    // Check patterns
    for (const pattern of filter.patterns) {
      if (pattern.test(content)) {
        score += filter.severity === 'high' ? 0.3 : filter.severity === 'medium' ? 0.2 : 0.1;
      }
    }

    // Check keywords
    for (const keyword of filter.keywords) {
      if (content.includes(keyword.toLowerCase())) {
        score += filter.severity === 'high' ? 0.2 : filter.severity === 'medium' ? 0.1 : 0.05;
      }
    }

    return Math.min(score, 1);
  }

  /**
   * Apply filter to content (censor)
   */
  private applyFilter(content: string, filter: ContentFilter): string {
    let filtered = content;

    // Replace patterns with asterisks
    for (const pattern of filter.patterns) {
      filtered = filtered.replace(pattern, match => '*'.repeat(match.length));
    }

    // Replace keywords with asterisks
    for (const keyword of filter.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      filtered = filtered.replace(regex, match => '*'.repeat(match.length));
    }

    return filtered;
  }

  /**
   * Check for repeated patterns (spam detection)
   */
  private hasRepeatedPatterns(content: string): boolean {
    // Check for excessive repetition
    const words = content.split(/\s+/);
    const wordFreq = new Map<string, number>();

    for (const word of words) {
      if (word.length > 2) { // Ignore very short words
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    // If any word appears more than 30% of the time, it's likely spam
    const maxFreq = Math.max(...wordFreq.values());
    return maxFreq > words.length * 0.3;
  }

  /**
   * Get detected issues from both moderation methods
   */
  private getDetectedIssues(
    ruleBased: Partial<ModerationResult>,
    aiResult: Partial<ModerationResult>
  ): string[] {
    const issues = new Set<string>();

    if (ruleBased.category) issues.add(ruleBased.category);
    if (aiResult.category && aiResult.category !== ruleBased.category) {
      issues.add(aiResult.category);
    }

    return Array.from(issues);
  }
}

// Export singleton instance
export const aiModerationService = AIModerationService.getInstance();

export default aiModerationService;