/**
 * Product Routes
 *
 * Handles product details, offers, and product management.
 * Integrates with multiple e-commerce platforms for comprehensive product information.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ProductSchema, ProductIdentifiersSchema } from '../models/product';
import { ProductOfferSchema } from '../models/product_offer';

// Initialize Hono app for product routes
const products = new Hono();

// Validation schemas
const GetProductSchema = z.object({
  id: z.string().uuid('Invalid product ID'),
  includeOffers: z.string().transform(val => val === 'true').default(true),
  includePriceHistory: z.string().transform(val => val === 'true').default(false),
  includeReviews: z.string().transform(val => val === 'true').default(true),
  includeRecommendations: z.string().transform(val => val === 'true').default(false),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
});

const GetProductOffersSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  platform: z.enum(['amazon', 'rakuten', 'yahoo', 'kakaku', 'mercari', 'all']).default('all'),
  condition: z.enum(['new', 'used', 'refurbished', 'any']).default('any'),
  includeShipping: z.string().transform(val => val === 'true').default(true),
  minRating: z.number().min(1).max(5).optional(),
  sortBy: z.enum(['price', 'rating', 'availability', 'seller_rating']).default('price'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(50).default(20),
});

const SearchProductsByCodeSchema = z.object({
  code: z.string().min(8, 'Product code is required').max(20, 'Product code too long'),
  codeType: z.enum(['JAN', 'UPC', 'EAN', 'ASIN', 'SKU']).default('JAN'),
  platform: z.string().optional(),
  includeAlternatives: z.string().transform(val => val === 'true').default(true),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
});

const GetProductComparisonSchema = z.object({
  productIds: z.string().min(1, 'Product IDs required')
    .transform(val => val.split(',').map(id => id.trim())),
  platforms: z.string().optional()
    .transform(val => val ? val.split(',').map(p => p.trim()) : undefined),
  includeShipping: z.string().transform(val => val === 'true').default(true),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
});

const GetSimilarProductsSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  limit: z.number().int().min(1).max(20).default(10),
  category: z.string().optional(),
  priceRange: z.object({
    min: z.number().positive().optional(),
    max: z.number().positive().optional(),
  }).optional(),
  platforms: z.string().optional()
    .transform(val => val ? val.split(',').map(p => p.trim()) : undefined),
});

const UpdateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  brand: z.string().optional(),
  category: z.object({
    id: z.string(),
    name: z.record(z.string()),
    parentId: z.string().optional(),
    level: z.number().positive(),
  }).optional(),
  images: z.array(z.object({
    url: z.string().url(),
    alt: z.record(z.string()),
    width: z.number().positive(),
    height: z.number().positive(),
    order: z.number().nonnegative(),
  })).optional(),
  specifications: z.array(z.object({
    name: z.string(),
    value: z.string(),
    unit: z.string().optional(),
  })).optional(),
  identifiers: ProductIdentifiersSchema.optional(),
  status: z.enum(['active', 'discontinued', 'out_of_stock']).optional(),
});

// Mock data and functions (in real implementation, these would use actual services)
const mockProducts = new Map();
const mockProductOffers = new Map();

// Middleware for product access validation
const validateProductAccess = async (c: any, next: any) => {
  const productId = c.req.param('id') || c.req.query('productId') || c.req.query('id');

  if (productId && !isValidUUID(productId)) {
    return c.json({
      success: false,
      error: 'Bad request',
      message: 'Invalid product ID format'
    }, 400);
  }

  await next();
};

// GET /products/:id - Get product details
products.get('/:id', validateProductAccess, zValidator('query', GetProductSchema), async (c) => {
  try {
    const productId = c.req.param('id');
    const query = c.req.valid('query');

    // Get product details
    const product = await getProductById(productId, query.language);
    if (!product) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Product not found'
      }, 404);
    }

    const result: any = {
      product,
    };

    // Include offers if requested
    if (query.includeOffers) {
      const offers = await getProductOffers(productId, {
        platform: 'all',
        condition: 'any',
        includeShipping: true,
        language: query.language,
      });
      result.offers = offers.offers;
      result.offerSummary = offers.summary;
    }

    // Include price history if requested
    if (query.includePriceHistory) {
      const priceHistory = await getProductPriceHistory(productId, {
        days: 90,
        language: query.language,
      });
      result.priceHistory = priceHistory;
    }

    // Include reviews if requested
    if (query.includeReviews) {
      const reviews = await getProductReviews(productId, {
        language: query.language,
        limit: 10,
      });
      result.reviews = reviews;
    }

    // Include recommendations if requested
    if (query.includeRecommendations) {
      const recommendations = await getProductRecommendations(productId, {
        limit: 5,
        language: query.language,
      });
      result.recommendations = recommendations;
    }

    return c.json({
      success: true,
      data: result
    });

  } catch (error: any) {
    console.error('Get product error:', error);
    return c.json({
      success: false,
      error: 'Failed to get product',
      message: error.message || 'An error occurred while fetching product'
    }, 500);
  }
});

// GET /products/:id/offers - Get product offers from all platforms
products.get('/:id/offers', validateProductAccess, zValidator('query', GetProductOffersSchema), async (c) => {
  try {
    const productId = c.req.param('id');
    const query = c.req.valid('query');

    // Get product offers
    const offers = await getProductOffers(productId, {
      platform: query.platform,
      condition: query.condition,
      includeShipping: query.includeShipping,
      minRating: query.minRating,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page: query.page,
      limit: query.limit,
    });

    return c.json({
      success: true,
      data: {
        productId,
        offers: offers.offers,
        pagination: offers.pagination,
        summary: offers.summary,
        filters: {
          platform: query.platform,
          condition: query.condition,
          includeShipping: query.includeShipping,
          minRating: query.minRating,
        },
      }
    });

  } catch (error: any) {
    console.error('Get product offers error:', error);
    return c.json({
      success: false,
      error: 'Failed to get product offers',
      message: error.message || 'An error occurred while fetching product offers'
    }, 500);
  }
});

// GET /products/search/code - Search products by barcode/product code
products.get('/search/code', zValidator('query', SearchProductsByCodeSchema), async (c) => {
  try {
    const query = c.req.valid('query');

    // Search for product by code
    const searchResult = await searchProductByCode({
      code: query.code,
      codeType: query.codeType,
      platform: query.platform,
      includeAlternatives: query.includeAlternatives,
      language: query.language,
    });

    if (!searchResult.product) {
      return c.json({
        success: false,
        error: 'Not found',
        message: `No product found for ${query.codeType} code: ${query.code}`,
        suggestions: searchResult.suggestions,
      }, 404);
    }

    return c.json({
      success: true,
      data: {
        product: searchResult.product,
        alternatives: searchResult.alternatives,
        codeType: query.codeType,
        confidence: searchResult.confidence,
      }
    });

  } catch (error: any) {
    console.error('Search by code error:', error);
    return c.json({
      success: false,
      error: 'Search failed',
      message: error.message || 'An error occurred while searching by code'
    }, 500);
  }
});

// GET /products/compare - Compare multiple products
products.get('/compare', zValidator('query', GetProductComparisonSchema), async (c) => {
  try {
    const query = c.req.valid('query');

    if (query.productIds.length === 0 || query.productIds.length > 5) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Please provide 1-5 product IDs for comparison'
      }, 400);
    }

    // Compare products
    const comparison = await compareProducts({
      productIds: query.productIds,
      platforms: query.platforms,
      includeShipping: query.includeShipping,
      language: query.language,
    });

    return c.json({
      success: true,
      data: comparison
    });

  } catch (error: any) {
    console.error('Compare products error:', error);
    return c.json({
      success: false,
      error: 'Comparison failed',
      message: error.message || 'An error occurred while comparing products'
    }, 500);
  }
});

// GET /products/:id/similar - Get similar products
products.get('/:id/similar', validateProductAccess, zValidator('query', GetSimilarProductsSchema), async (c) => {
  try {
    const productId = c.req.param('id');
    const query = c.req.valid('query');

    // Get similar products
    const similarProducts = await getSimilarProducts(productId, {
      limit: query.limit,
      category: query.category,
      priceRange: query.priceRange,
      platforms: query.platforms,
    });

    return c.json({
      success: true,
      data: {
        productId,
        similarProducts: similarProducts.products,
        total: similarProducts.total,
        criteria: {
          category: query.category,
          priceRange: query.priceRange,
          platforms: query.platforms,
        },
      }
    });

  } catch (error: any) {
    console.error('Get similar products error:', error);
    return c.json({
      success: false,
      error: 'Failed to get similar products',
      message: error.message || 'An error occurred while fetching similar products'
    }, 500);
  }
});

// GET /products/:id/reviews - Get product reviews
products.get('/:id/reviews', validateProductAccess, async (c) => {
  try {
    const productId = c.req.param('id');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const platform = c.req.query('platform');
    const language = c.req.query('language') || 'ja';
    const sortBy = c.req.query('sortBy') || 'newest';
    const rating = c.req.query('rating') ? parseInt(c.req.query('rating')) : undefined;

    // Get product reviews
    const reviews = await getProductReviews(productId, {
      page,
      limit,
      platform,
      language,
      sortBy,
      rating,
    });

    return c.json({
      success: true,
      data: reviews
    });

  } catch (error: any) {
    console.error('Get product reviews error:', error);
    return c.json({
      success: false,
      error: 'Failed to get product reviews',
      message: error.message || 'An error occurred while fetching product reviews'
    }, 500);
  }
});

// GET /products/:id/specifications - Get product specifications
products.get('/:id/specifications', validateProductAccess, async (c) => {
  try {
    const productId = c.req.param('id');
    const language = c.req.query('language') || 'ja';

    // Get product specifications
    const specifications = await getProductSpecifications(productId, language);

    return c.json({
      success: true,
      data: {
        productId,
        specifications: specifications.specifications,
        categories: specifications.categories,
        lastUpdated: specifications.lastUpdated,
      }
    });

  } catch (error: any) {
    console.error('Get product specifications error:', error);
    return c.json({
      success: false,
      error: 'Failed to get product specifications',
      message: error.message || 'An error occurred while fetching product specifications'
    }, 500);
  }
});

// GET /products/:id/availability - Get product availability across platforms
products.get('/:id/availability', validateProductAccess, async (c) => {
  try {
    const productId = c.req.param('id');
    const platforms = c.req.query('platforms') ? c.req.query('platforms').split(',') : undefined;

    // Get product availability
    const availability = await getProductAvailability(productId, {
      platforms,
    });

    return c.json({
      success: true,
      data: {
        productId,
        availability: availability.availability,
        summary: availability.summary,
        lastChecked: availability.lastChecked,
      }
    });

  } catch (error: any) {
    console.error('Get product availability error:', error);
    return c.json({
      success: false,
      error: 'Failed to get product availability',
      message: error.message || 'An error occurred while fetching product availability'
    }, 500);
  }
});

// POST /products/:id/track - Track product for price updates
products.post('/:id/track', validateProductAccess, async (c) => {
  try {
    const productId = c.req.param('id');
    const body = await c.req.json();

    const TrackProductSchema = z.object({
      userId: z.string().uuid(),
      platforms: z.array(z.string()).default(['amazon', 'rakuten']),
      frequency: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
      alertThreshold: z.number().nonnegative().default(5), // percentage
    });

    const validatedBody = TrackProductSchema.parse(body);

    // Track product
    const tracking = await trackProduct(productId, {
      userId: validatedBody.userId,
      platforms: validatedBody.platforms,
      frequency: validatedBody.frequency,
      alertThreshold: validatedBody.alertThreshold,
    });

    return c.json({
      success: true,
      message: 'Product tracking started',
      data: tracking
    }, 201);

  } catch (error: any) {
    console.error('Track product error:', error);
    return c.json({
      success: false,
      error: 'Failed to track product',
      message: error.message || 'An error occurred while tracking product'
    }, 500);
  }
});

// DELETE /products/:id/track - Stop tracking product
products.delete('/:id/track', validateProductAccess, async (c) => {
  try {
    const productId = c.req.param('id');
    const userId = c.req.header('X-User-ID');

    if (!userId) {
      return c.json({
        success: false,
        error: 'Unauthorized',
        message: 'User ID required'
      }, 401);
    }

    // Stop tracking
    const success = await stopTrackingProduct(productId, userId);

    if (!success) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'No active tracking found for this product'
      }, 404);
    }

    return c.json({
      success: true,
      message: 'Product tracking stopped'
    });

  } catch (error: any) {
    console.error('Stop tracking product error:', error);
    return c.json({
      success: false,
      error: 'Failed to stop tracking',
      message: error.message || 'An error occurred while stopping tracking'
    }, 500);
  }
});

// Helper functions (mock implementations)
async function getProductById(productId: string, language: string = 'ja') {
  // Mock implementation - would fetch from database
  return {
    id: productId,
    name: 'Sample Product',
    description: 'This is a sample product description',
    brand: 'Sample Brand',
    category: {
      id: 'electronics',
      name: { ja: 'エレクトロニクス', en: 'Electronics' },
      level: 1,
    },
    images: [],
    specifications: [],
    identifiers: {
      jan: '4901085083126',
    },
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function getProductOffers(productId: string, options: any) {
  // Mock implementation
  return {
    offers: [],
    pagination: {
      currentPage: 1,
      totalPages: 0,
      totalResults: 0,
      hasNext: false,
      hasPrev: false,
      limit: options.limit,
    },
    summary: {
      lowestPrice: 0,
      highestPrice: 0,
      averagePrice: 0,
      platformCount: 0,
    },
  };
}

async function searchProductByCode(options: any) {
  // Mock implementation
  return {
    product: null,
    alternatives: [],
    suggestions: [],
    confidence: 0,
  };
}

async function compareProducts(options: any) {
  // Mock implementation
  return {
    products: [],
    comparison: [],
    bestValue: null,
    lowestPrice: 0,
    highestPrice: 0,
    averagePrice: 0,
  };
}

async function getSimilarProducts(productId: string, options: any) {
  // Mock implementation
  return {
    products: [],
    total: 0,
  };
}

async function getProductReviews(productId: string, options: any) {
  // Mock implementation
  return {
    reviews: [],
    pagination: {
      currentPage: options.page,
      totalPages: 0,
      totalResults: 0,
    },
    summary: {
      averageRating: 0,
      totalReviews: 0,
    },
  };
}

async function getProductSpecifications(productId: string, language: string) {
  // Mock implementation
  return {
    specifications: [],
    categories: [],
    lastUpdated: new Date(),
  };
}

async function getProductAvailability(productId: string, options: any) {
  // Mock implementation
  return {
    availability: [],
    summary: {
      totalPlatforms: 0,
      inStockCount: 0,
      outOfStockCount: 0,
    },
    lastChecked: new Date(),
  };
}

async function trackProduct(productId: string, options: any) {
  // Mock implementation
  return {
    productId,
    trackingId: crypto.randomUUID(),
    status: 'active',
    platforms: options.platforms,
    frequency: options.frequency,
    createdAt: new Date(),
  };
}

async function stopTrackingProduct(productId: string, userId: string) {
  // Mock implementation
  return true;
}

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export default products;