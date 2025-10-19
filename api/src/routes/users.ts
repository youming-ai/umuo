/**
 * User management routes
 * Handles user registration, authentication, and profile management
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { UserService } from '../services/user_service';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

const users = new Hono();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must be less than 128 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  preferences: z.object({
    language: z.enum(['ja', 'en', 'zh']).default('ja'),
    currency: z.string().length(3).default('JPY'),
    notifications: z.object({
      priceAlerts: z.boolean().default(true),
      stockAlerts: z.boolean().default(true),
      dealAlerts: z.boolean().default(false)
    }).default({}),
    categories: z.array(z.string()).default([]),
    brands: z.array(z.string()).default([]),
    priceRange: z.object({
      min: z.number().nonnegative().default(0),
      max: z.number().positive().default(1000000)
    }).default({})
  }).optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

const updateProfileSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  preferences: z.object({
    language: z.enum(['ja', 'en', 'zh']),
    currency: z.string().length(3),
    notifications: z.object({
      priceAlerts: z.boolean(),
      stockAlerts: z.boolean(),
      dealAlerts: z.boolean()
    }),
    categories: z.array(z.string()),
    brands: z.array(z.string()),
    priceRange: z.object({
      min: z.number().nonnegative(),
      max: z.number().positive()
    })
  }).optional()
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must be less than 128 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase letter, one uppercase letter, and one number')
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
});

/**
 * POST /users/register
 * Register a new user
 */
users.post('/register', zValidator('json', registerSchema), async (c) => {
  try {
    const userData = c.req.valid('json');
    const result = await UserService.register(userData);

    logger.info('User registered successfully', { userId: result.user.id });

    return c.json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          preferences: result.user.preferences,
          subscription: result.user.subscription,
          createdAt: result.user.createdAt
        },
        token: result.token,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt
      }
    }, 201);
  } catch (error) {
    logger.error('User registration failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    if (error instanceof Error) {
      if (error.message.includes('already exists')) {
        return c.json({
          success: false,
          error: 'User with this email already exists'
        }, 409);
      }
      if (error.message.includes('Invalid')) {
        return c.json({
          success: false,
          error: error.message
        }, 400);
      }
    }

    return c.json({
      success: false,
      error: 'Registration failed. Please try again.'
    }, 500);
  }
});

/**
 * POST /users/login
 * Authenticate user login
 */
users.post('/login', zValidator('json', loginSchema), async (c) => {
  try {
    const loginData = c.req.valid('json');
    const result = await UserService.login(loginData);

    logger.info('User logged in successfully', { userId: result.user.id });

    return c.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          preferences: result.user.preferences,
          subscription: result.user.subscription
        },
        token: result.token,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt
      }
    });
  } catch (error) {
    logger.error('User login failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    if (error instanceof Error && error.message.includes('Invalid email or password')) {
      return c.json({
        success: false,
        error: 'Invalid email or password'
      }, 401);
    }

    return c.json({
      success: false,
      error: 'Login failed. Please try again.'
    }, 500);
  }
});

/**
 * POST /users/refresh
 * Refresh access token
 */
users.post('/refresh', zValidator('json', refreshTokenSchema), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json');
    const result = await UserService.refreshToken(refreshToken);

    logger.info('Token refreshed successfully', { userId: result.user.id });

    return c.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          preferences: result.user.preferences,
          subscription: result.user.subscription
        },
        token: result.token,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt
      }
    });
  } catch (error) {
    logger.error('Token refresh failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    if (error instanceof Error && error.message.includes('Invalid refresh token')) {
      return c.json({
        success: false,
        error: 'Invalid or expired refresh token'
      }, 401);
    }

    return c.json({
      success: false,
      error: 'Token refresh failed'
    }, 500);
  }
});

/**
 * GET /users/me
 * Get current user profile
 */
users.get('/me', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const user = await UserService.getUserById(userId);

    if (!user) {
      return c.json({
        success: false,
        error: 'User not found'
      }, 404);
    }

    return c.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          preferences: user.preferences,
          subscription: user.subscription,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      }
    });
  } catch (error) {
    logger.error('Get user profile failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    return c.json({
      success: false,
      error: 'Failed to get user profile'
    }, 500);
  }
});

/**
 * PUT /users/me
 * Update current user profile
 */
users.put('/me', authMiddleware, zValidator('json', updateProfileSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const updateData = c.req.valid('json');
    const updatedUser = await UserService.updateUser(userId, updateData);

    logger.info('User profile updated successfully', { userId });

    return c.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          preferences: updatedUser.preferences,
          subscription: updatedUser.subscription,
          updatedAt: updatedUser.updatedAt
        }
      }
    });
  } catch (error) {
    logger.error('Update user profile failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return c.json({
          success: false,
          error: 'User not found'
        }, 404);
      }
      if (error.message.includes('already exists')) {
        return c.json({
          success: false,
          error: 'Email already exists'
        }, 409);
      }
    }

    return c.json({
      success: false,
      error: 'Failed to update profile'
    }, 500);
  }
});

/**
 * POST /users/me/change-password
 * Change user password
 */
users.post('/me/change-password', authMiddleware, zValidator('json', changePasswordSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const passwordData = c.req.valid('json');
    await UserService.changePassword(userId, passwordData);

    logger.info('Password changed successfully', { userId });

    return c.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    logger.error('Password change failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return c.json({
          success: false,
          error: 'User not found'
        }, 404);
      }
      if (error.message.includes('incorrect')) {
        return c.json({
          success: false,
          error: 'Current password is incorrect'
        }, 400);
      }
    }

    return c.json({
      success: false,
      error: 'Failed to change password'
    }, 500);
  }
});

/**
 * GET /users/me/stats
 * Get user statistics
 */
users.get('/me/stats', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const stats = await UserService.getUserStats(userId);

    return c.json({
      success: true,
      data: { stats }
    });
  } catch (error) {
    logger.error('Get user stats failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    return c.json({
      success: false,
      error: 'Failed to get user statistics'
    }, 500);
  }
});

/**
 * GET /users/me/export
 * Export user data
 */
users.get('/me/export', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const exportData = await UserService.exportUserData(userId);

    logger.info('User data exported successfully', { userId });

    return c.json({
      success: true,
      message: 'User data exported successfully',
      data: exportData
    });
  } catch (error) {
    logger.error('Export user data failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    if (error instanceof Error && error.message.includes('not found')) {
      return c.json({
        success: false,
        error: 'User not found'
      }, 404);
    }

    return c.json({
      success: false,
      error: 'Failed to export user data'
    }, 500);
  }
});

/**
 * DELETE /users/me
 * Delete user account
 */
users.delete('/me', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const { password } = await c.req.json();

    if (!password) {
      return c.json({
        success: false,
        error: 'Password is required to delete account'
      }, 400);
    }

    await UserService.deleteUser(userId, password);

    logger.info('User account deleted successfully', { userId });

    return c.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    logger.error('Delete user account failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return c.json({
          success: false,
          error: 'User not found'
        }, 404);
      }
      if (error.message.includes('Invalid password')) {
        return c.json({
          success: false,
          error: 'Invalid password'
        }, 401);
      }
    }

    return c.json({
      success: false,
      error: 'Failed to delete account'
    }, 500);
  }
});

/**
 * POST /users/logout
 * Logout user (invalidate tokens)
 */
users.post('/logout', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');

    // In a real implementation, you would invalidate the token
    // by adding it to a blacklist or using a token store
    logger.info('User logged out successfully', { userId });

    return c.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    logger.error('Logout failed', { error: error instanceof Error ? error.message : 'Unknown error' });

    return c.json({
      success: false,
      error: 'Logout failed'
    }, 500);
  }
});

export { users as userRoutes };