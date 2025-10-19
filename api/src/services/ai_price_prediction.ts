import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { PriceHistory, Product, ProductOffer } from '../models';

export interface PricePredictionRequest {
  productId: string;
  platformId?: string;
  historicalData: PriceHistory[];
  currentPrice: number;
  predictionDays: number;
  seasonalityFactors?: {
    month: number;
    isHolidaySeason: boolean;
    isSaleSeason: boolean;
  };
  marketFactors?: {
    demand: 'high' | 'medium' | 'low';
    supply: 'high' | 'medium' | 'low';
    competition: 'high' | 'medium' | 'low';
  };
}

export interface PricePrediction {
  predictedPrice: number;
  confidence: number;
  trend: 'rising' | 'falling' | 'stable';
  priceRange: {
    min: number;
    max: number;
  };
  keyFactors: string[];
  recommendation: 'buy_now' | 'wait' | 'hold';
  reasoning: string;
  metadata: {
    modelUsed: string;
    dataPoints: number;
    timeHorizon: number;
  };
}

export interface PriceAlertSuggestion {
  targetPrice: number;
  confidence: number;
  expectedDays: number;
  reason: string;
}

export class AIPricePredictionService {
  private static instance: AIPricePredictionService;

  private constructor() {}

  static getInstance(): AIPricePredictionService {
    if (!AIPricePredictionService.instance) {
      AIPricePredictionService.instance = new AIPricePredictionService();
    }
    return AIPricePredictionService.instance;
  }

  /**
   * Generate price prediction using AI and statistical analysis
   */
  async predictPrice(request: PricePredictionRequest): Promise<PricePrediction> {
    try {
      // Validate input data
      this.validatePredictionRequest(request);

      // Perform statistical analysis first
      const statisticalAnalysis = this.performStatisticalAnalysis(request);

      // Generate AI prediction
      const aiPrediction = await this.generateAIPrediction(request, statisticalAnalysis);

      // Combine results
      const finalPrediction = this.combinePredictionResults(statisticalAnalysis, aiPrediction);

      return finalPrediction;

    } catch (error) {
      console.error('Price prediction failed:', error);
      throw new Error(`Failed to predict price: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate price alert suggestions
   */
  async generateAlertSuggestions(
    request: PricePredictionRequest,
    userThreshold?: number
  ): Promise<PriceAlertSuggestion[]> {
    try {
      const prediction = await this.predictPrice(request);
      const suggestions: PriceAlertSuggestion[] = [];

      // Suggest optimal alert prices based on prediction
      if (prediction.trend === 'falling') {
        // Suggest alert at predicted low point
        suggestions.push({
          targetPrice: prediction.priceRange.min,
          confidence: prediction.confidence * 0.8,
          expectedDays: Math.floor(request.predictionDays * 0.6),
          reason: 'Predicted price drop based on market trends',
        });
      }

      // Suggest alert slightly below current price for short-term drops
      const shortTermTarget = request.currentPrice * 0.95;
      suggestions.push({
        targetPrice: shortTermTarget,
        confidence: 0.6,
        expectedDays: 7,
        reason: 'Short-term price drop opportunity',
      });

      // If user has threshold, add custom suggestion
      if (userThreshold && userThreshold < request.currentPrice) {
        suggestions.push({
          targetPrice: userThreshold,
          confidence: 0.7,
          expectedDays: this.estimateDaysToPrice(request, userThreshold),
          reason: 'User-defined target price',
        });
      }

      return suggestions.sort((a, b) => b.confidence - a.confidence);

    } catch (error) {
      console.error('Failed to generate alert suggestions:', error);
      return [];
    }
  }

  /**
   * Analyze price patterns and anomalies
   */
  async analyzePricePatterns(productId: string, priceHistory: PriceHistory[]): Promise<{
    patterns: string[];
    anomalies: Array<{
      date: Date;
      price: number;
      type: 'spike' | 'drop' | 'unusual';
      significance: number;
    }>;
    seasonality: {
      detected: boolean;
      pattern: string;
      confidence: number;
    };
  }> {
    try {
      const patterns = this.detectPricePatterns(priceHistory);
      const anomalies = this.detectPriceAnomalies(priceHistory);
      const seasonality = this.analyzeSeasonality(priceHistory);

      return {
        patterns,
        anomalies,
        seasonality,
      };

    } catch (error) {
      console.error('Failed to analyze price patterns:', error);
      return {
        patterns: [],
        anomalies: [],
        seasonality: { detected: false, pattern: '', confidence: 0 },
      };
    }
  }

  /**
   * Perform statistical analysis on price data
   */
  private performStatisticalAnalysis(request: PricePredictionRequest) {
    const { historicalData, currentPrice, predictionDays } = request;

    if (historicalData.length < 2) {
      throw new Error('Insufficient historical data for prediction');
    }

    // Sort data by date
    const sortedData = [...historicalData].sort((a, b) =>
      new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );

    // Calculate basic statistics
    const prices = sortedData.map(d => d.price);
    const meanPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const stdDev = Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - meanPrice, 2), 0) / prices.length);

    // Calculate trend
    const trend = this.calculateTrend(sortedData);

    // Calculate volatility
    const volatility = stdDev / meanPrice;

    // Predict using simple linear regression
    const regressionPrediction = this.linearRegressionPrediction(sortedData, predictionDays);

    return {
      meanPrice,
      stdDev,
      volatility,
      trend,
      regressionPrediction,
      dataPoints: sortedData.length,
      priceRange: {
        min: Math.min(...prices),
        max: Math.max(...prices),
      },
    };
  }

  /**
   * Generate AI-powered prediction
   */
  private async generateAIPrediction(
    request: PricePredictionRequest,
    statisticalAnalysis: any
  ): Promise<any> {
    const prompt = this.createPredictionPrompt(request, statisticalAnalysis);

    let aiResponse;
    let modelUsed = '';

    try {
      // Try Claude for analytical reasoning
      aiResponse = await generateText({
        model: anthropic('claude-3-sonnet-20240229'),
        prompt,
        system: this.getPredictionSystemPrompt(),
        temperature: 0.2,
        maxTokens: 1000,
      });
      modelUsed = 'claude-3-sonnet';
    } catch (claudeError) {
      console.warn('Claude prediction failed, trying GPT-4:', claudeError);

      try {
        aiResponse = await generateText({
          model: openai('gpt-4-turbo-preview'),
          prompt,
          system: this.getPredictionSystemPrompt(),
          temperature: 0.2,
          maxTokens: 1000,
        });
        modelUsed = 'gpt-4-turbo';
      } catch (gptError) {
        console.warn('AI prediction failed, using statistical only:', gptError);
        return null;
      }
    }

    return this.parseAIPredictionResponse(aiResponse.text, modelUsed);
  }

  /**
   * Create prediction prompt for AI
   */
  private createPredictionPrompt(request: PricePredictionRequest, statisticalAnalysis: any): string {
    const { historicalData, currentPrice, predictionDays, seasonalityFactors, marketFactors } = request;

    return `
Predict the future price of this product based on historical data and market factors:

CURRENT SITUATION:
- Current Price: ¥${currentPrice.toLocaleString()}
- Prediction Horizon: ${predictionDays} days
- Historical Data Points: ${historicalData.length}

STATISTICAL ANALYSIS:
- Mean Price: ¥${statisticalAnalysis.meanPrice.toLocaleString()}
- Price Volatility: ${(statisticalAnalysis.volatility * 100).toFixed(1)}%
- Recent Trend: ${statisticalAnalysis.trend.direction} (${statisticalAnalysis.trend.percentChange.toFixed(1)}%)
- Price Range: ¥${statisticalAnalysis.priceRange.min.toLocaleString()} - ¥${statisticalAnalysis.priceRange.max.toLocaleString()}

RECENT PRICE HISTORY (last 10 points):
${historicalData.slice(-10).map(d =>
  `${new Date(d.recordedAt).toLocaleDateString()}: ¥${d.price.toLocaleString()}`
).join('\n')}

SEASONALITY FACTORS:
${seasonalityFactors ? `
- Month: ${seasonalityFactors.month}
- Holiday Season: ${seasonalityFactors.isHolidaySeason}
- Sale Season: ${seasonalityFactors.isSaleSeason}
` : 'Not provided'}

MARKET FACTORS:
${marketFactors ? `
- Demand: ${marketFactors.demand}
- Supply: ${marketFactors.supply}
- Competition: ${marketFactors.competition}
` : 'Not provided'}

Please provide a JSON response with:
{
  "predictedPrice": number,
  "confidence": number (0-1),
  "trend": "rising/falling/stable",
  "priceRange": {"min": number, "max": number},
  "keyFactors": ["factor1", "factor2", "factor3"],
  "recommendation": "buy_now/wait/hold",
  "reasoning": "detailed explanation of the prediction"
}

Consider seasonality, market trends, historical patterns, and current market conditions.`;
  }

  /**
   * Get system prompt for price prediction
   */
  private getPredictionSystemPrompt(): string {
    return 'You are an expert price prediction analyst specializing in e-commerce and Japanese market trends. Analyze historical data, seasonal patterns, and market conditions to provide accurate price forecasts. Consider factors like holidays, sales seasons, competition, and supply-demand dynamics. Always respond in valid JSON format with realistic predictions.';
  }

  /**
   * Parse AI prediction response
   */
  private parseAIPredictionResponse(responseText: string, modelUsed: string): any {
    try {
      return JSON.parse(responseText);
    } catch (error) {
      console.error('Failed to parse AI prediction response:', error);
      return null;
    }
  }

  /**
   * Combine statistical and AI predictions
   */
  private combinePredictionResults(statisticalAnalysis: any, aiPrediction: any): PricePrediction {
    // If AI prediction failed, use statistical only
    if (!aiPrediction) {
      return {
        predictedPrice: statisticalAnalysis.regressionPrediction,
        confidence: 0.5,
        trend: statisticalAnalysis.trend.direction,
        priceRange: {
          min: statisticalAnalysis.regressionPrediction * 0.9,
          max: statisticalAnalysis.regressionPrediction * 1.1,
        },
        keyFactors: ['Historical trend analysis'],
        recommendation: statisticalAnalysis.trend.direction === 'falling' ? 'wait' : 'hold',
        reasoning: 'Based on statistical analysis of historical price data',
        metadata: {
          modelUsed: 'statistical_only',
          dataPoints: statisticalAnalysis.dataPoints,
          timeHorizon: 30,
        },
      };
    }

    // Weight the predictions
    const statisticalWeight = 0.4;
    const aiWeight = 0.6;

    const combinedPrice = (statisticalAnalysis.regressionPrediction * statisticalWeight) +
                         (aiPrediction.predictedPrice * aiWeight);

    const combinedConfidence = (0.5 * statisticalWeight) + (aiPrediction.confidence * aiWeight);

    return {
      predictedPrice: combinedPrice,
      confidence: Math.max(0.1, Math.min(1, combinedConfidence)),
      trend: aiPrediction.trend || statisticalAnalysis.trend.direction,
      priceRange: aiPrediction.priceRange || {
        min: combinedPrice * 0.9,
        max: combinedPrice * 1.1,
      },
      keyFactors: aiPrediction.keyFactors || ['Statistical analysis'],
      recommendation: aiPrediction.recommendation || 'hold',
      reasoning: aiPrediction.reasoning || 'Combined statistical and AI analysis',
      metadata: {
        modelUsed: 'hybrid',
        dataPoints: statisticalAnalysis.dataPoints,
        timeHorizon: 30,
      },
    };
  }

  /**
   * Calculate price trend
   */
  private calculateTrend(sortedData: PriceHistory[]) {
    const recentData = sortedData.slice(-30); // Last 30 data points
    if (recentData.length < 2) {
      return { direction: 'stable', percentChange: 0 };
    }

    const firstPrice = recentData[0].price;
    const lastPrice = recentData[recentData.length - 1].price;
    const percentChange = ((lastPrice - firstPrice) / firstPrice) * 100;

    let direction: 'rising' | 'falling' | 'stable';
    if (percentChange > 5) {
      direction = 'rising';
    } else if (percentChange < -5) {
      direction = 'falling';
    } else {
      direction = 'stable';
    }

    return { direction, percentChange };
  }

  /**
   * Linear regression prediction
   */
  private linearRegressionPrediction(sortedData: PriceHistory[], predictionDays: number): number {
    if (sortedData.length < 2) return sortedData[0]?.price || 0;

    // Simple linear regression
    const n = sortedData.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    sortedData.forEach((data, index) => {
      const x = index;
      const y = data.price;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Predict future value
    const futureX = n + predictionDays;
    return slope * futureX + intercept;
  }

  /**
   * Detect price patterns
   */
  private detectPricePatterns(priceHistory: PriceHistory[]): string[] {
    const patterns = [];
    const prices = priceHistory.map(d => d.price);

    // Check for cyclical patterns
    if (this.hasCyclicalPattern(prices)) {
      patterns.push('Seasonal price variation detected');
    }

    // Check for step changes
    if (this.hasStepChanges(prices)) {
      patterns.push('Price step changes detected');
    }

    // Check for volatility clustering
    if (this.hasVolatilityClustering(prices)) {
      patterns.push('High volatility periods detected');
    }

    return patterns;
  }

  /**
   * Detect price anomalies
   */
  private detectPriceAnomalies(priceHistory: PriceHistory[]) {
    const anomalies = [];
    const prices = priceHistory.map(d => d.price);
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const stdDev = Math.sqrt(prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length);

    priceHistory.forEach((data, index) => {
      const zScore = Math.abs((data.price - mean) / stdDev);

      if (zScore > 2) {
        let type: 'spike' | 'drop' | 'unusual' = 'unusual';
        if (index > 0 && data.price > priceHistory[index - 1].price * 1.2) {
          type = 'spike';
        } else if (index > 0 && data.price < priceHistory[index - 1].price * 0.8) {
          type = 'drop';
        }

        anomalies.push({
          date: new Date(data.recordedAt),
          price: data.price,
          type,
          significance: Math.min(zScore / 3, 1), // Normalize to 0-1
        });
      }
    });

    return anomalies;
  }

  /**
   * Analyze seasonality
   */
  private analyzeSeasonality(priceHistory: PriceHistory[]) {
    // This is a simplified implementation
    // In production, you'd use more sophisticated time series analysis
    return {
      detected: false,
      pattern: '',
      confidence: 0,
    };
  }

  /**
   * Helper methods for pattern detection
   */
  private hasCyclicalPattern(prices: number[]): boolean {
    // Simplified cyclical pattern detection
    return false;
  }

  private hasStepChanges(prices: number[]): boolean {
    // Check for significant step changes
    for (let i = 1; i < prices.length; i++) {
      if (Math.abs(prices[i] - prices[i - 1]) > prices[i - 1] * 0.3) {
        return true;
      }
    }
    return false;
  }

  private hasVolatilityClustering(prices: number[]): boolean {
    // Check for periods of high volatility
    const changes = prices.slice(1).map((price, i) => Math.abs(price - prices[i]) / prices[i]);
    const avgChange = changes.reduce((sum, c) => sum + c, 0) / changes.length;
    return changes.some(c => c > avgChange * 2);
  }

  /**
   * Estimate days to reach target price
   */
  private estimateDaysToPrice(request: PricePredictionRequest, targetPrice: number): number {
    const trend = this.calculateTrend(request.historicalData);
    const dailyChangeRate = Math.abs(trend.percentChange) / 30; // Assume 30-day trend
    const priceDifference = Math.abs(request.currentPrice - targetPrice);
    const estimatedDays = priceDifference / (request.currentPrice * dailyChangeRate / 100);

    return Math.max(1, Math.min(90, Math.round(estimatedDays))); // Clamp between 1-90 days
  }

  /**
   * Validate prediction request
   */
  private validatePredictionRequest(request: PricePredictionRequest): void {
    if (!request.productId) {
      throw new Error('Product ID is required');
    }

    if (!request.historicalData || request.historicalData.length < 2) {
      throw new Error('At least 2 historical data points are required');
    }

    if (request.currentPrice <= 0) {
      throw new Error('Current price must be positive');
    }

    if (request.predictionDays <= 0 || request.predictionDays > 365) {
      throw new Error('Prediction days must be between 1 and 365');
    }
  }
}

// Export singleton instance
export const aiPricePredictionService = AIPricePredictionService.getInstance();

export default aiPricePredictionService;