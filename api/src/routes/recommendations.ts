import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { recommendationService } from '../services/recommendation.service.js'

const recommendations = new Hono()

// Validation schemas
const GetRecommendationsSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  type: z.enum(['similar_products', 'price_drop', 'trending', 'personalized', 'alternative']).optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(50)).default('10'),
  offset: z.string().transform(Number).pipe(z.number().int().min(0)).default('0'),
  categories: z.string().optional().transform(val => val ? val.split(',') : []),
  priceRange: z.string().optional().transform(val => val ? val.split(',').map(Number) : undefined),
  excludeOwned: z.string().transform(val => val === 'true').default(true),
})

const GetPersonalizedRecommendationsSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  context: z.enum(['homepage', 'product_detail', 'search_results', 'category_page']).optional(),
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(20)).default('10'),
})

const RecordInteractionSchema = z.object({
  userId: z.string().uuid('User ID is required'),
  productId: z.string().uuid('Product ID is required'),
  type: z.enum(['view', 'like', 'dislike', 'purchase', 'wishlist_add', 'share']),
  context: z.object({
    source: z.enum(['recommendation', 'search', 'category', 'direct']),
    position: z.number().int().optional(),
    recommendationId: z.string().uuid().optional(),
  }).optional(),
  metadata: z.record(z.any()).optional(),
})

const UpdatePreferencesSchema = z.object({
  userId: z.string().uuid('User ID is required'),
  preferences: z.object({
    favoriteCategories: z.array(z.string()).optional(),
    preferredPlatforms: z.array(z.string()).optional(),
    priceSensitivity: z.enum(['low', 'medium', 'high']).optional(),
    preferredBrands: z.array(z.string()).optional(),
    excludedBrands: z.array(z.string()).optional(),
    enablePersonalized: z.boolean().optional(),
    enableTrending: z.boolean().optional(),
    enablePriceAlerts: z.boolean().optional(),
  }),
})

const GetRecommendationStatsSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  period: z.enum(['day', 'week', 'month', 'year']).default('month'),
})

const GetSimilarProductsSchema = z.object({
  productId: z.string().uuid('Product ID is required'),
  userId: z.string().uuid('User ID is required').optional(),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(20)).default('5'),
  criteria: z.enum(['price', 'features', 'brand', 'category', 'popularity']).default('features'),
  includeAlternatives: z.string().transform(val => val === 'true').default(false),
})

const GetTrendingProductsSchema = z.object({
  category: z.string().optional(),
  platform: z.enum(['amazon', 'rakuten', 'yahoo', 'kakaku', 'mercari', 'all']).default('all'),
  timeframe: z.enum(['hour', 'day', 'week', 'month']).default('day'),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(50)).default('20'),
  priceRange: z.string().optional().transform(val => val ? val.split(',').map(Number) : undefined),
})

const GetPriceDropRecommendationsSchema = z.object({
  userId: z.string().uuid('User ID is required'),
  minDropPercentage: z.string().transform(Number).pipe(z.number().int().min(5).max(90)).default('20'),
  categories: z.string().optional().transform(val => val ? val.split(',') : []),
  platforms: z.enum(['amazon', 'rakuten', 'yahoo', 'kakaku', 'mercari', 'all']).default('all'),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(30)).default('15'),
})

// GET /recommendations - Get general recommendations
recommendations.get('/', zValidator('query', GetRecommendationsSchema), async (c) => {
  try {
    const { userId, type, limit, offset, categories, priceRange, excludeOwned } = c.req.valid('query')

    const filters = {
      type,
      categories: categories as string[],
      priceRange: priceRange as [number, number] | undefined,
      excludeOwned,
    }

    const recommendations = await recommendationService.getRecommendations(
      userId,
      filters,
      { limit, offset }
    )

    return c.json({
      success: true,
      data: recommendations,
      pagination: {
        limit,
        offset,
        total: recommendations.length,
      },
    })
  } catch (error) {
    console.error('Error fetching recommendations:', error)
    return c.json(
      { success: false, error: 'Failed to fetch recommendations' },
      500
    )
  }
})

// GET /recommendations/personalized - Get personalized recommendations
recommendations.get('/personalized', zValidator('query', GetPersonalizedRecommendationsSchema), async (c) => {
  try {
    const { userId, context, productId, categoryId, limit } = c.req.valid('query')

    const personalizedRecommendations = await recommendationService.getPersonalizedRecommendations(
      userId,
      {
        context,
        productId,
        categoryId,
      },
      { limit }
    )

    return c.json({
      success: true,
      data: personalizedRecommendations,
      context: {
        userId,
        recommendationContext: context,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Error fetching personalized recommendations:', error)
    return c.json(
      { success: false, error: 'Failed to fetch personalized recommendations' },
      500
    )
  }
})

// POST /recommendations/interaction - Record user interaction with recommendations
recommendations.post('/interaction', zValidator('json', RecordInteractionSchema), async (c) => {
  try {
    const interaction = c.req.valid('json')

    await recommendationService.recordInteraction(interaction)

    return c.json({
      success: true,
      message: 'Interaction recorded successfully',
      data: {
        interactionId: interaction.userId + Date.now(),
        recordedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Error recording interaction:', error)
    return c.json(
      { success: false, error: 'Failed to record interaction' },
      500
    )
  }
})

// PUT /recommendations/preferences - Update recommendation preferences
recommendations.put('/preferences', zValidator('json', UpdatePreferencesSchema), async (c) => {
  try {
    const { userId, preferences } = c.req.valid('json')

    await recommendationService.updatePreferences(userId, preferences)

    return c.json({
      success: true,
      message: 'Recommendation preferences updated successfully',
      data: {
        userId,
        preferences,
        updatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Error updating preferences:', error)
    return c.json(
      { success: false, error: 'Failed to update preferences' },
      500
    )
  }
})

// GET /recommendations/preferences/:userId - Get user preferences
recommendations.get('/preferences/:userId', async (c) => {
  try {
    const userId = c.req.param('userId')

    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return c.json(
        { success: false, error: 'Invalid user ID' },
        400
      )
    }

    const preferences = await recommendationService.getPreferences(userId)

    return c.json({
      success: true,
      data: preferences,
    })
  } catch (error) {
    console.error('Error fetching preferences:', error)
    return c.json(
      { success: false, error: 'Failed to fetch preferences' },
      500
    )
  }
})

// GET /recommendations/stats/:userId - Get recommendation statistics
recommendations.get('/stats/:userId', zValidator('query', GetRecommendationStatsSchema), async (c) => {
  try {
    const userId = c.req.param('userId')
    const { period } = c.req.valid('query')

    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return c.json(
        { success: false, error: 'Invalid user ID' },
        400
      )
    }

    const stats = await recommendationService.getRecommendationStats(userId, period)

    return c.json({
      success: true,
      data: stats,
      period,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching recommendation stats:', error)
    return c.json(
      { success: false, error: 'Failed to fetch recommendation statistics' },
      500
    )
  }
})

// GET /recommendations/similar/:productId - Get similar products
recommendations.get('/similar/:productId', zValidator('query', GetSimilarProductsSchema), async (c) => {
  try {
    const productId = c.req.param('productId')
    const { userId, limit, criteria, includeAlternatives } = c.req.valid('query')

    if (!productId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
      return c.json(
        { success: false, error: 'Invalid product ID' },
        400
      )
    }

    const similarProducts = await recommendationService.getSimilarProducts(
      productId,
      {
        userId,
        criteria,
        includeAlternatives,
      },
      { limit }
    )

    return c.json({
      success: true,
      data: similarProducts,
      criteria: {
        productId,
        similarityCriteria: criteria,
        includeAlternatives,
      },
    })
  } catch (error) {
    console.error('Error fetching similar products:', error)
    return c.json(
      { success: false, error: 'Failed to fetch similar products' },
      500
    )
  }
})

// GET /recommendations/trending - Get trending products
recommendations.get('/trending', zValidator('query', GetTrendingProductsSchema), async (c) => {
  try {
    const { category, platform, timeframe, limit, priceRange } = c.req.valid('query')

    const trendingProducts = await recommendationService.getTrendingProducts(
      {
        category,
        platform,
        timeframe,
        priceRange: priceRange as [number, number] | undefined,
      },
      { limit }
    )

    return c.json({
      success: true,
      data: trendingProducts,
      filters: {
        category,
        platform,
        timeframe,
        priceRange,
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching trending products:', error)
    return c.json(
      { success: false, error: 'Failed to fetch trending products' },
      500
    )
  }
})

// GET /recommendations/price-drops - Get price drop recommendations
recommendations.get('/price-drops', zValidator('query', GetPriceDropRecommendationsSchema), async (c) => {
  try {
    const { userId, minDropPercentage, categories, platforms, limit } = c.req.valid('query')

    const priceDropRecommendations = await recommendationService.getPriceDropRecommendations(
      userId,
      {
        minDropPercentage,
        categories: categories as string[],
        platforms,
      },
      { limit }
    )

    return c.json({
      success: true,
      data: priceDropRecommendations,
      filters: {
        minDropPercentage,
        categories,
        platforms,
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching price drop recommendations:', error)
    return c.json(
      { success: false, error: 'Failed to fetch price drop recommendations' },
      500
    )
  }
})

// POST /recommendations/feedback - Submit feedback on recommendations
recommendations.post('/feedback', async (c) => {
  try {
    const body = await c.req.json()

    const feedbackSchema = z.object({
      userId: z.string().uuid('User ID is required'),
      recommendationId: z.string().uuid('Recommendation ID is required'),
      productId: z.string().uuid('Product ID is required'),
      feedback: z.enum(['helpful', 'not_helpful', 'not_relevant', 'inappropriate']),
      reason: z.string().optional(),
      comment: z.string().max(500).optional(),
    })

    const feedback = feedbackSchema.parse(body)

    await recommendationService.submitFeedback(feedback)

    return c.json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        feedbackId: `${feedback.userId}-${feedback.recommendationId}`,
        submittedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Error submitting feedback:', error)
    return c.json(
      { success: false, error: 'Failed to submit feedback' },
      500
    )
  }
})

// DELETE /recommendations/:recommendationId - Dismiss/hide a recommendation
recommendations.delete('/:recommendationId', async (c) => {
  try {
    const recommendationId = c.req.param('recommendationId')
    const userId = c.req.query('userId')

    if (!recommendationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recommendationId)) {
      return c.json(
        { success: false, error: 'Invalid recommendation ID' },
        400
      )
    }

    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return c.json(
        { success: false, error: 'User ID is required' },
        400
      )
    }

    await recommendationService.dismissRecommendation(recommendationId, userId)

    return c.json({
      success: true,
      message: 'Recommendation dismissed successfully',
      data: {
        recommendationId,
        dismissedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Error dismissing recommendation:', error)
    return c.json(
      { success: false, error: 'Failed to dismiss recommendation' },
      500
    )
  }
})

export { recommendations }