/**
 * Deal Routes
 *
 * Handles promotional deals, community content, and deal management.
 * Integrates with moderation, voting, and recommendation systems.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { DealService } from '../services/deal_service';

// Initialize Hono app for deal routes
const deals = new Hono();

// Validation schemas
const CreateDealSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(2000, 'Description too long').optional(),
  type: z.enum(['coupon', 'sale', 'bundle', 'clearance', 'limited_time', 'flash_sale', 'price_match']),
  discount: z.object({
    type: z.enum(['percentage', 'fixed', 'buy_one_get_one', 'free_shipping', 'gift']),
    value: z.number().nonnegative('Discount value must be non-negative'),
    originalPrice: z.number().positive('Original price must be positive').optional(),
    conditions: z.array(z.string()).optional(),
    minimumPurchase: z.number().nonnegative().optional(),
    maxDiscount: z.number().nonnegative().optional(),
  }),
  products: z.array(z.object({
    productId: z.string().uuid('Product ID is required'),
    platformId: z.string('Platform ID is required'),
    originalPrice: z.number().positive('Original price must be positive'),
    discountedPrice: z.number().positive('Discounted price must be positive'),
    url: z.string().url('Invalid product URL'),
  })).min(1, 'At least one product is required'),
  platforms: z.array(z.string()).min(1, 'At least one platform is required'),
  url: z.string().url('Deal URL is required'),
  images: z.array(z.object({
    url: z.string().url('Invalid image URL'),
    width: z.number().positive('Image width must be positive'),
    height: z.number().positive('Image height must be positive'),
    order: z.number().nonnegative('Image order must be non-negative'),
  })).optional(),
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  couponCode: z.string().optional(),
  restrictions: z.array(z.string()).optional(),
  submittedBy: z.string().uuid().optional(),
});

const GetDealsSchema = z.object({
  status: z.enum(['active', 'pending', 'expired', 'rejected', 'flagged', 'all']).default('active'),
  type: z.enum(['coupon', 'sale', 'bundle', 'clearance', 'limited_time', 'flash_sale', 'price_match', 'all']).default('all'),
  platforms: z.string().optional()
    .transform(val => val ? val.split(',').map(p => p.trim()) : undefined),
  categories: z.string().optional()
    .transform(val => val ? val.split(',').map(c => c.trim()) : undefined),
  tags: z.string().optional()
    .transform(val => val ? val.split(',').map(t => t.trim()) : undefined),
  minSavings: z.number().nonnegative().optional(),
  maxSavings: z.number().nonnegative().optional(),
  hasCouponCode: z.boolean().optional(),
  submittedBy: z.string().uuid().optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['newest', 'oldest', 'popular', 'trending', 'ending_soon', 'savings', 'discount']).default('newest'),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
});

const VoteOnDealSchema = z.object({
  value: z.enum(['up', 'down']),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

const CommentOnDealSchema = z.object({
  content: z.string().min(1, 'Comment content is required').max(1000, 'Comment too long'),
  parentId: z.string().uuid().optional(),
});

const ModerateDealSchema = z.object({
  action: z.enum(['approve', 'reject', 'flag', 'feature']),
  reason: z.string().max(500, 'Reason too long').optional(),
  notes: z.string().max(1000, 'Notes too long').optional(),
  flagReason: z.string().optional(),
});

const SearchDealsSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(100, 'Search query too long'),
  limit: z.number().int().min(1).max(50).default(20),
  platforms: z.string().optional()
    .transform(val => val ? val.split(',').map(p => p.trim()) : undefined),
  categories: z.string().optional()
    .transform(val => val ? val.split(',').map(c => c.trim()) : undefined),
  minDiscount: z.number().nonnegative().optional(),
  maxDiscount: z.number().nonnegative().optional(),
});

const SubmitDealReportSchema = z.object({
  dealId: z.string().uuid('Deal ID is required'),
  reason: z.string().min(1, 'Report reason is required').max(500, 'Report reason too long'),
  description: z.string().max(1000, 'Description too long').optional(),
});

// Initialize services
const dealService = new DealService();

// Middleware for deal access validation
const requireAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  const userId = c.req.header('X-User-ID');

  // Some endpoints are public, others require authentication
  const publicRoutes = ['/', '/search', '/popular', '/categories', '/statistics'];
  const isPublicRoute = publicRoutes.some(route => c.req.path === route || c.req.path.startsWith(route + '/'));

  if (!isPublicRoute && !authHeader && !userId) {
    return c.json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required'
    }, 401);
  }

  if (userId) {
    c.set('userId', userId);
  }

  await next();
};

// POST /deals - Create new deal
deals.post('/', requireAuth, zValidator('json', CreateDealSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // Create deal
    const deal = await dealService.createDeal({
      title: body.title,
      description: body.description,
      type: body.type,
      discount: body.discount,
      products: body.products,
      platforms: body.platforms,
      url: body.url,
      images: body.images,
      tags: body.tags,
      categories: body.categories,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      couponCode: body.couponCode,
      restrictions: body.restrictions,
      submittedBy: body.submittedBy || userId,
    });

    return c.json({
      success: true,
      message: 'Deal submitted successfully',
      data: deal
    }, 201);

  } catch (error: any) {
    console.error('Create deal error:', error);
    return c.json({
      success: false,
      error: 'Failed to create deal',
      message: error.message || 'An error occurred while creating deal'
    }, 500);
  }
});

// GET /deals - Get deals with filtering
deals.get('/', requireAuth, zValidator('query', GetDealsSchema), async (c) => {
  try {
    const query = c.req.valid('query');

    // Get deals
    const result = await dealService.getDeals({
      status: query.status,
      type: query.type,
      platforms: query.platforms,
      categories: query.categories,
      tags: query.tags,
      minSavings: query.minSavings,
      maxSavings: query.maxSavings,
      hasCouponCode: query.hasCouponCode,
      submittedBy: query.submittedBy,
      active: query.active,
      featured: query.featured,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
    });

    return c.json({
      success: true,
      data: {
        deals: result.deals,
        pagination: {
          currentPage: query.page,
          totalPages: result.totalPages,
          totalResults: result.total,
          hasNext: result.page < result.totalPages,
          hasPrev: query.page > 1,
          limit: query.limit,
        },
        filters: {
          status: query.status,
          type: query.type,
          platforms: query.platforms,
          categories: query.categories,
          tags: query.tags,
          minSavings: query.minSavings,
          maxSavings: query.maxSavings,
          hasCouponCode: query.hasCouponCode,
          featured: query.featured,
          sortBy: query.sortBy,
        },
        language: query.language,
      }
    });

  } catch (error: any) {
    console.error('Get deals error:', error);
    return c.json({
      success: false,
      error: 'Failed to get deals',
      message: error.message || 'An error occurred while fetching deals'
    }, 500);
  }
});

// GET /deals/:dealId - Get specific deal
deals.get('/:dealId', requireAuth, async (c) => {
  try {
    const dealId = c.req.param('dealId');

    if (!isValidUUID(dealId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid deal ID format'
      }, 400);
    }

    // Get deal
    const deal = await dealService.getDeal(dealId);

    if (!deal) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Deal not found'
      }, 404);
    }

    return c.json({
      success: true,
      data: deal
    });

  } catch (error: any) {
    console.error('Get deal error:', error);
    return c.json({
      success: false,
      error: 'Failed to get deal',
      message: error.message || 'An error occurred while fetching deal'
    }, 500);
  }
});

// PUT /deals/:dealId - Update deal
deals.put('/:dealId', requireAuth, async (c) => {
  try {
    const dealId = c.req.param('dealId');
    const userId = c.get('userId');

    if (!isValidUUID(dealId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid deal ID format'
      }, 400);
    }

    // Check if user owns this deal or is admin
    const existingDeal = await dealService.getDeal(dealId);
    if (!existingDeal) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Deal not found'
      }, 404);
    }

    const isAdmin = c.req.header('X-Admin-Key') === process.env.ADMIN_KEY;
    if (existingDeal.submission?.submittedBy !== userId && !isAdmin) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot modify deals submitted by other users'
      }, 403);
    }

    const body = await c.req.json();

    const UpdateDealSchema = z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      endDate: z.string().datetime().optional(),
      tags: z.array(z.string()).optional(),
      categories: z.array(z.string()).optional(),
      restrictions: z.array(z.string()).optional(),
      couponCode: z.string().optional(),
    });

    const validatedBody = UpdateDealSchema.parse(body);

    // Update deal
    const updatedDeal = await dealService.updateDeal(dealId, validatedBody);

    if (!updatedDeal) {
      return c.json({
        success: false,
        error: 'Update failed',
        message: 'Failed to update deal'
      }, 500);
    }

    return c.json({
      success: true,
      message: 'Deal updated successfully',
      data: updatedDeal
    });

  } catch (error: any) {
    console.error('Update deal error:', error);
    return c.json({
      success: false,
      error: 'Failed to update deal',
      message: error.message || 'An error occurred while updating deal'
    }, 500);
  }
});

// DELETE /deals/:dealId - Delete deal
deals.delete('/:dealId', requireAuth, async (c) => {
  try {
    const dealId = c.req.param('dealId');
    const userId = c.get('userId');

    if (!isValidUUID(dealId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid deal ID format'
      }, 400);
    }

    // Check if user owns this deal or is admin
    const existingDeal = await dealService.getDeal(dealId);
    if (!existingDeal) {
      return c.json({
        success: false,
        error: 'Not found',
        message: 'Deal not found'
      }, 404);
    }

    const isAdmin = c.req.header('X-Admin-Key') === process.env.ADMIN_KEY;
    if (existingDeal.submission?.submittedBy !== userId && !isAdmin) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Cannot delete deals submitted by other users'
      }, 403);
    }

    // Delete deal
    const success = await dealService.deleteDeal(dealId);

    if (!success) {
      return c.json({
        success: false,
        error: 'Delete failed',
        message: 'Failed to delete deal'
      }, 500);
    }

    return c.json({
      success: true,
      message: 'Deal deleted successfully'
    });

  } catch (error: any) {
    console.error('Delete deal error:', error);
    return c.json({
      success: false,
      error: 'Failed to delete deal',
      message: error.message || 'An error occurred while deleting deal'
    }, 500);
  }
});

// POST /deals/:dealId/vote - Vote on deal
deals.post('/:dealId/vote', requireAuth, zValidator('json', VoteOnDealSchema), async (c) => {
  try {
    const dealId = c.req.param('dealId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (!isValidUUID(dealId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid deal ID format'
      }, 400);
    }

    // Vote on deal
    const result = await dealService.voteOnDeal({
      dealId,
      userId,
      value: body.value,
      ipAddress: body.ipAddress,
      userAgent: body.userAgent,
    });

    if (!result.success) {
      return c.json({
        success: false,
        error: result.error || 'Vote failed',
        message: result.message || 'Failed to vote on deal'
      }, 400);
    }

    return c.json({
      success: true,
      message: 'Vote recorded successfully',
      data: {
        dealId,
        newScore: result.newScore,
        userVote: result.userVote,
      }
    });

  } catch (error: any) {
    console.error('Vote on deal error:', error);
    return c.json({
      success: false,
      error: 'Failed to vote on deal',
      message: error.message || 'An error occurred while voting on deal'
    }, 500);
  }
});

// POST /deals/:dealId/comments - Add comment to deal
deals.post('/:dealId/comments', requireAuth, zValidator('json', CommentOnDealSchema), async (c) => {
  try {
    const dealId = c.req.param('dealId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (!isValidUUID(dealId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid deal ID format'
      }, 400);
    }

    // Add comment
    const result = await dealService.addComment({
      dealId,
      userId,
      content: body.content,
      parentId: body.parentId,
    });

    if (!result.success) {
      return c.json({
        success: false,
        error: result.error || 'Comment failed',
        message: result.message || 'Failed to add comment'
      }, 400);
    }

    return c.json({
      success: true,
      message: 'Comment added successfully',
      data: {
        commentId: result.commentId,
      },
    }, 201);

  } catch (error: any) {
    console.error('Add comment error:', error);
    return c.json({
      success: false,
      error: 'Failed to add comment',
      message: error.message || 'An error occurred while adding comment'
    }, 500);
  }
});

// GET /deals/:dealId/comments - Get deal comments
deals.get('/:dealId/comments', requireAuth, async (c) => {
  try {
    const dealId = c.req.param('dealId');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const sortBy = c.req.query('sortBy') || 'newest';

    if (!isValidUUID(dealId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid deal ID format'
      }, 400);
    }

    // Get deal comments
    const comments = await dealService.getDealComments(dealId, {
      page,
      limit,
      sortBy,
    });

    return c.json({
      success: true,
      data: comments
    });

  } catch (error: any) {
    console.error('Get deal comments error:', error);
    return c.json({
      success: false,
      error: 'Failed to get deal comments',
      message: error.message || 'An error occurred while fetching deal comments'
    }, 500);
  }
});

// POST /deals/:dealId/moderate - Moderate deal (admin only)
deals.post('/:dealId/moderate', requireAuth, zValidator('json', ModerateDealSchema), async (c) => {
  try {
    const dealId = c.req.param('dealId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // Check admin authorization
    const isAdmin = c.req.header('X-Admin-Key') === process.env.ADMIN_KEY;
    if (!isAdmin) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Admin access required'
      }, 403);
    }

    if (!isValidUUID(dealId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid deal ID format'
      }, 400);
    }

    // Moderate deal
    const result = await dealService.moderateDeal({
      dealId,
      moderatedBy: userId,
      action: body.action,
      reason: body.reason,
      notes: body.notes,
      flagReason: body.flagReason,
    });

    if (!result.success) {
      return c.json({
        success: false,
        error: 'Moderation failed',
        message: result.error || 'Failed to moderate deal'
      }, 500);
    }

    return c.json({
      success: true,
      message: `Deal ${body.action}d successfully`,
      data: {
        dealId,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
      }
    });

  } catch (error: any) {
    console.error('Moderate deal error:', error);
    return c.json({
      success: false,
      error: 'Failed to moderate deal',
      message: error.message || 'An error occurred while moderating deal'
    }, 500);
  }
});

// GET /deals/search - Search deals
deals.get('/search', zValidator('query', SearchDealsSchema), async (c) => {
  try {
    const query = c.req.valid('query');

    // Search deals
    const searchResult = await dealService.searchDeals(query.query, {
      limit: query.limit,
      platforms: query.platforms,
      categories: query.categories,
      minDiscount: query.minDiscount,
      maxDiscount: query.maxDiscount,
    });

    return c.json({
      success: true,
      data: {
        query: query.query,
        deals: searchResult.deals,
        total: searchResult.total,
        suggestions: searchResult.suggestions,
        filters: {
          limit: query.limit,
          platforms: query.platforms,
          categories: query.categories,
          minDiscount: query.minDiscount,
          maxDiscount: query.maxDiscount,
        },
      }
    });

  } catch (error: any) {
    console.error('Search deals error:', error);
    return c.json({
      success: false,
      error: 'Search failed',
      message: error.message || 'An error occurred while searching deals'
    }, 500);
  }
});

// GET /deals/popular - Get popular deals
deals.get('/popular', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');
    const category = c.req.query('category');
    const platform = c.req.query('platform');

    // Get popular deals
    const popularDeals = await dealService.getPopularDeals({
      limit,
      category,
      platforms: platform ? [platform] : undefined,
    });

    return c.json({
      success: true,
      data: {
        popularDeals: popularDeals.deals,
        total: popularDeals.total,
        category,
        platform,
        updated: popularDeals.updated,
      }
    });

  } catch (error: any) {
    console.error('Get popular deals error:', error);
    return c.json({
      success: false,
      error: 'Failed to get popular deals',
      message: error.message || 'An error occurred while fetching popular deals'
    }, 500);
  }
});

// GET /deals/categories - Get deal categories
deals.get('/categories', async (c) => {
  try {
    const platform = c.req.query('platform');

    // Get categories
    const categories = await getDealCategories(platform);

    return c.json({
      success: true,
      data: {
        categories,
        platform,
      }
    });

  } catch (error: any) {
    console.error('Get categories error:', error);
    return c.json({
      success: false,
      error: 'Failed to get categories',
      message: error.message || 'An error occurred while fetching categories'
    }, 500);
  }
});

// GET /deals/statistics - Get deal statistics
deals.get('/statistics', async (c) => {
  try {
    const startDate = c.req.query('startDate') ? new Date(c.req.query('startDate')) : undefined;
    const endDate = c.req.query('endDate') ? new Date(c.req.query('endDate')) : undefined;
    const platforms = c.req.query('platforms') ? c.req.query('platforms').split(',') : undefined;

    // Get deal statistics
    const statistics = await dealService.getDealStatistics({
      startDate,
      endDate,
      platforms,
    });

    return c.json({
      success: true,
      data: statistics
    });

  } catch (error: any) {
    console.error('Get statistics error:', error);
    return c.json({
      success: false,
      error: 'Failed to get statistics',
      message: error.message || 'An error occurred while fetching statistics'
    }, 500);
  }
});

// GET /deals/moderation-queue - Get moderation queue (admin only)
deals.get('/moderation-queue', requireAuth, async (c) => {
  try {
    // Check admin authorization
    const isAdmin = c.req.header('X-Admin-Key') === process.env.ADMIN_KEY;
    if (!isAdmin) {
      return c.json({
        success: false,
        error: 'Forbidden',
        message: 'Admin access required'
      }, 403);
    }

    // Get moderation queue
    const queue = await dealService.getModerationQueue();

    return c.json({
      success: true,
      data: {
        queue,
        total: queue.length,
        updated: new Date().toISOString(),
      }
    });

  } catch (error: any) {
    console.error('Get moderation queue error:', error);
    return c.json({
      success: false,
      error: 'Failed to get moderation queue',
      message: error.message || 'An error occurred while fetching moderation queue'
    }, 500);
  }
});

// POST /deals/:dealId/report - Report deal
deals.post('/:dealId/report', requireAuth, zValidator('json', SubmitDealReportSchema), async (c) => {
  try {
    const dealId = c.req.param('dealId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    if (!isValidUUID(dealId)) {
      return c.json({
        success: false,
        error: 'Bad request',
        message: 'Invalid deal ID format'
      }, 400);
    }

    // Submit report
    const success = await submitDealReport(dealId, {
      userId,
      reason: body.reason,
      description: body.description,
    });

    if (!success) {
      return c.json({
        success: false,
        error: 'Report submission failed',
        message: 'Failed to submit deal report'
      }, 500);
    }

    return c.json({
      success: true,
      message: 'Deal report submitted successfully',
      data: {
        dealId,
        reportedAt: new Date().toISOString(),
      }
    }, 201);

  } catch (error: any) {
    console.error('Submit deal report error:', error);
    return c.json({
      success: false,
      error: 'Failed to submit report',
      message: error.message || 'An error occurred while submitting deal report'
    }, 500);
  }
});

// Helper functions (mock implementations)
async function getDealCategories(platform?: string) {
  // Mock implementation
  const categories = [
    { id: 'electronics', name: 'エレクトロニクス', count: 245 },
    { id: 'fashion', name: 'ファッション', count: 189 },
    { id: 'home', name: 'ホーム・キッチン', count: 156 },
    { id: 'beauty', name: '美容・コスメ', count: 134 },
    { id: 'sports', name: 'スポーツ・アウトドア', count: 98 },
    { id: 'toys', name: 'おもちゃ・ホビー', count: 76 },
    { id: 'food', name: '食品・飲料', count: 65 },
    { id: 'books', name: '本・雑誌', count: 54 },
  ];

  return categories;
}

async function submitDealReport(dealId: string, report: any) {
  // Mock implementation
  console.log(`Deal reported: ${dealId} by user ${report.userId} for reason: ${report.reason}`);
  return true;
}

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export default deals;