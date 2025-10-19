import { aiService, AIRequest, AIResponse, getBestModelForTask, isModelAvailable } from './vercel_config';

export type TaskType = 'summarization' | 'recommendation' | 'moderation' | 'general';

export interface RoutingConfig {
  preferredModel?: string;
  fallbackModels?: string[];
  maxRetries?: number;
  timeout?: number;
}

export interface RoutingResult {
  response: AIResponse;
  modelUsed: string;
  attempts: number;
  success: boolean;
  error?: string;
}

export class AIModelRouter {
  private static instance: AIModelRouter;
  private defaultConfig: RoutingConfig = {
    maxRetries: 3,
    timeout: 30000, // 30 seconds
    fallbackModels: ['gpt-3.5-turbo', 'gemini-pro'], // Cheaper fallbacks
  };

  private constructor() {}

  static getInstance(): AIModelRouter {
    if (!AIModelRouter.instance) {
      AIModelRouter.instance = new AIModelRouter();
    }
    return AIModelRouter.instance;
  }

  /**
   * Execute AI request with automatic model routing and fallback
   */
  async executeRequest(
    request: AIRequest,
    taskType: TaskType = 'general',
    config: RoutingConfig = {}
  ): Promise<RoutingResult> {
    const finalConfig = { ...this.defaultConfig, ...config };
    let attempts = 0;
    let lastError: Error | undefined;

    // Determine model priority
    const modelPriority = this.getModelPriority(request.model, taskType, finalConfig);

    for (const modelId of modelPriority) {
      attempts++;

      try {
        const response = await this.executeWithTimeout(
          { ...request, model: modelId },
          finalConfig.timeout || 30000
        );

        return {
          response,
          modelUsed: modelId,
          attempts,
          success: true,
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        console.warn(`Model ${modelId} failed (attempt ${attempts}):`, lastError.message);

        // Continue to next model if this wasn't the last one
        if (attempts < modelPriority.length) {
          continue;
        }
      }
    }

    // All models failed
    return {
      response: { text: '', model: request.model },
      modelUsed: request.model,
      attempts,
      success: false,
      error: lastError?.message || 'All models failed',
    };
  }

  /**
   * Stream AI request with model routing
   */
  async streamRequest(
    request: AIRequest,
    taskType: TaskType = 'general',
    config: RoutingConfig = {}
  ) {
    const finalConfig = { ...this.defaultConfig, ...config };
    const modelPriority = this.getModelPriority(request.model, taskType, finalConfig);

    let lastError: Error | undefined;

    for (const modelId of modelPriority) {
      try {
        const stream = await aiService.streamText({
          ...request,
          model: modelId,
        });

        return { stream, modelUsed: modelId };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        console.warn(`Streaming model ${modelId} failed:`, lastError.message);
      }
    }

    throw lastError || new Error('All models failed for streaming');
  }

  /**
   * Get model priority based on availability and task requirements
   */
  private getModelPriority(
    requestedModel: string,
    taskType: TaskType,
    config: RoutingConfig
  ): string[] {
    const priority: string[] = [];

    // If specific model requested and available, try it first
    if (requestedModel && isModelAvailable(requestedModel)) {
      priority.push(requestedModel);
    }

    // Add best model for task if not already included
    const bestModel = getBestModelForTask(taskType);
    if (!priority.includes(bestModel)) {
      priority.push(bestModel);
    }

    // Add fallback models
    if (config.fallbackModels) {
      for (const fallback of config.fallbackModels) {
        if (isModelAvailable(fallback) && !priority.includes(fallback)) {
          priority.push(fallback);
        }
      }
    }

    // Ensure we have at least one model
    if (priority.length === 0) {
      priority.push('gpt-4-turbo'); // Default fallback
    }

    return priority;
  }

  /**
   * Execute request with timeout
   */
  private async executeWithTimeout(
    request: AIRequest,
    timeoutMs: number
  ): Promise<AIResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      aiService.generateText(request)
        .then((response) => {
          clearTimeout(timer);
          resolve(response);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Health check for available models
   */
  async checkModelHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};
    const models = ['gpt-4-turbo', 'claude-3-sonnet', 'gemini-pro'];

    const checkPromises = models.map(async (modelId) => {
      try {
        await aiService.generateText({
          model: modelId,
          prompt: 'Hello',
          maxTokens: 10,
        });
        health[modelId] = true;
      } catch (error) {
        health[modelId] = false;
        console.warn(`Health check failed for ${modelId}:`, error);
      }
    });

    await Promise.all(checkPromises);
    return health;
  }

  /**
   * Get model statistics
   */
  getModelStats(): {
    available: string[];
    unavailable: string[];
    recommended: Record<TaskType, string>;
  } {
    const allModels = ['gpt-4-turbo', 'claude-3-sonnet', 'gemini-pro', 'gpt-3.5-turbo'];
    const available = allModels.filter(isModelAvailable);
    const unavailable = allModels.filter(model => !isModelAvailable(model));

    return {
      available,
      unavailable,
      recommended: {
        summarization: getBestModelForTask('summarization'),
        recommendation: getBestModelForTask('recommendation'),
        moderation: getBestModelForTask('moderation'),
        general: getBestModelForTask('general' as any),
      },
    };
  }
}

// Export singleton instance
export const modelRouter = AIModelRouter.getInstance();

// Convenience methods for common tasks
export class AIHelper {
  /**
   * Summarize product reviews with automatic fallback
   */
  static async summarizeReviews(
    reviews: string[],
    config?: RoutingConfig
  ): Promise<RoutingResult> {
    return modelRouter.executeRequest(
      {
        model: getBestModelForTask('summarization'),
        prompt: reviews.join('\n\n'),
        system: 'You are a product review analyst. Provide objective insights.',
      },
      'summarization',
      config
    );
  }

  /**
   * Generate product recommendations
   */
  static async generateRecommendations(
    userPreferences: any,
    productHistory: any[],
    config?: RoutingConfig
  ): Promise<RoutingResult> {
    const prompt = `Generate recommendations based on user preferences and history.`;

    return modelRouter.executeRequest(
      {
        model: getBestModelForTask('recommendation'),
        prompt,
        system: 'You are a personalized shopping assistant.',
      },
      'recommendation',
      config
    );
  }

  /**
   * Moderate user-generated content
   */
  static async moderateContent(
    content: string,
    config?: RoutingConfig
  ): Promise<RoutingResult> {
    return modelRouter.executeRequest(
      {
        model: getBestModelForTask('moderation'),
        prompt: content,
        system: 'You are a content moderator ensuring community safety.',
        temperature: 0.1, // Lower temperature for consistent moderation
      },
      'moderation',
      config
    );
  }
}

export default modelRouter;