import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, generateText } from 'ai';

// Model configuration
const AI_CONFIG = {
  // OpenAI models
  openai: {
    'gpt-4-turbo': {
      provider: 'openai',
      model: 'gpt-4-turbo-preview',
      maxTokens: 4096,
      temperature: 0.7,
    },
    'gpt-3.5-turbo': {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      maxTokens: 2048,
      temperature: 0.7,
    },
  },
  // Anthropic models
  anthropic: {
    'claude-3-opus': {
      provider: 'anthropic',
      model: 'claude-3-opus-20240229',
      maxTokens: 4096,
      temperature: 0.7,
    },
    'claude-3-sonnet': {
      provider: 'anthropic',
      model: 'claude-3-sonnet-20240229',
      maxTokens: 4096,
      temperature: 0.7,
    },
  },
  // Google models
  google: {
    'gemini-pro': {
      provider: 'google',
      model: 'gemini-pro',
      maxTokens: 2048,
      temperature: 0.7,
    },
  },
};

// Initialize AI providers
const openai = createOpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY || '',
});

const anthropic = createAnthropic({
  apiKey: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '',
});

const google = createGoogleGenerativeAI({
  apiKey: process.env.EXPO_PUBLIC_GOOGLE_API_KEY || '',
});

// Provider mapping
const providers = {
  openai,
  anthropic,
  google,
};

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  maxTokens: number;
  costPerToken: number;
}

export const AVAILABLE_MODELS: AIModel[] = [
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    capabilities: ['text-generation', 'analysis', 'summarization'],
    maxTokens: 4096,
    costPerToken: 0.00001,
  },
  {
    id: 'claude-3-sonnet',
    name: 'Claude 3 Sonnet',
    provider: 'anthropic',
    capabilities: ['text-generation', 'analysis', 'summarization'],
    maxTokens: 4096,
    costPerToken: 0.000003,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    provider: 'google',
    capabilities: ['text-generation', 'analysis'],
    maxTokens: 2048,
    costPerToken: 0.0000005,
  },
];

export interface AIRequest {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AIResponse {
  text: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class AIService {
  private static instance: AIService;
  private modelConfig: typeof AI_CONFIG;

  private constructor() {
    this.modelConfig = AI_CONFIG;
  }

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  private getModelConfig(modelId: string) {
    for (const providerConfig of Object.values(this.modelConfig)) {
      if (modelId in providerConfig) {
        return providerConfig[modelId as keyof typeof providerConfig];
      }
    }
    throw new Error(`Model ${modelId} not found`);
  }

  private getProvider(providerName: string) {
    return providers[providerName as keyof typeof providers];
  }

  async generateText(request: AIRequest): Promise<AIResponse> {
    try {
      const config = this.getModelConfig(request.model);
      const provider = this.getProvider(config.provider);

      const result = await generateText({
        model: provider(request.model),
        prompt: request.prompt,
        system: request.system,
        temperature: request.temperature ?? config.temperature,
        maxTokens: request.maxTokens ?? config.maxTokens,
      });

      return {
        text: result.text,
        model: request.model,
        usage: {
          promptTokens: result.usage?.promptTokens || 0,
          completionTokens: result.usage?.completionTokens || 0,
          totalTokens: result.usage?.totalTokens || 0,
        },
      };
    } catch (error) {
      console.error('AI Service Error:', error);
      throw new Error(`AI generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async streamText(request: AIRequest) {
    try {
      const config = this.getModelConfig(request.model);
      const provider = this.getProvider(config.provider);

      const result = await streamText({
        model: provider(request.model),
        prompt: request.prompt,
        system: request.system,
        temperature: request.temperature ?? config.temperature,
        maxTokens: request.maxTokens ?? config.maxTokens,
      });

      return result;
    } catch (error) {
      console.error('AI Service Error:', error);
      throw new Error(`AI streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Model-specific methods for common use cases

  async summarizeReviews(reviews: string[], model = 'claude-3-sonnet'): Promise<{
    summary: string;
    pros: string[];
    cons: string[];
    rating: number;
  }> {
    const prompt = `Analyze the following product reviews and provide a comprehensive summary:

Reviews:
${reviews.join('\n\n')}

Please respond with a JSON object containing:
1. summary: A concise summary of overall sentiment (max 100 words)
2. pros: Array of 3-5 key positive points
3. cons: Array of 3-5 key negative points
4. rating: Overall rating from 1-5 based on sentiment analysis

Format your response as valid JSON.`;

    const response = await this.generateText({
      model,
      prompt,
      system: 'You are a product review analyst. Provide objective, helpful insights based on customer reviews.',
      temperature: 0.3,
    });

    try {
      return JSON.parse(response.text);
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return {
        summary: 'Unable to generate summary',
        pros: [],
        cons: [],
        rating: 3,
      };
    }
  }

  async generateRecommendations(
    userPreferences: any,
    productHistory: any[],
    model = 'gpt-4-turbo'
  ): Promise<string[]> {
    const prompt = `Based on the user's preferences and product history, recommend 5 relevant products:

User Preferences:
${JSON.stringify(userPreferences, null, 2)}

Recent Product Views:
${productHistory.map(p => `${p.name} - ${p.category}`).join('\n')}

Provide 5 product recommendations with brief reasoning for each. Format as a numbered list.`;

    const response = await this.generateText({
      model,
      prompt,
      system: 'You are a personalized shopping assistant. Recommend products based on user preferences and behavior.',
      temperature: 0.7,
    });

    return response.text.split('\n').filter(line => line.trim().length > 0);
  }

  async moderateContent(content: string, model = 'claude-3-sonnet'): Promise<{
    approved: boolean;
    reason?: string;
    category?: string;
  }> {
    const prompt = `Moderate the following content for community guidelines:

Content: "${content}"

Check for: spam, hate speech, inappropriate content, personal information, etc.

Respond with JSON: { "approved": boolean, "reason": "string if not approved", "category": "spam/offensive/inappropriate/other" }`;

    const response = await this.generateText({
      model,
      prompt,
      system: 'You are a content moderator. Ensure community guidelines are followed.',
      temperature: 0.1,
    });

    try {
      return JSON.parse(response.text);
    } catch (error) {
      console.error('Failed to parse moderation response:', error);
      return { approved: false, reason: 'Moderation error', category: 'other' };
    }
  }
}

// Export singleton instance
export const aiService = AIService.getInstance();

// Model routing utilities
export function getBestModelForTask(task: 'summarization' | 'recommendation' | 'moderation'): string {
  switch (task) {
    case 'summarization':
      return 'claude-3-sonnet'; // Best at analysis and summarization
    case 'recommendation':
      return 'gpt-4-turbo'; // Best at understanding context
    case 'moderation':
      return 'claude-3-sonnet'; // Best at nuanced content understanding
    default:
      return 'gpt-4-turbo';
  }
}

export function isModelAvailable(modelId: string): boolean {
  return AVAILABLE_MODELS.some(model => model.id === modelId);
}

export default aiService;