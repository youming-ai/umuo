/**
 * Authentication middleware
 * Handles JWT token validation and user authentication
 */

import { Context, Next } from 'hono';
import { logger } from '../utils/logger';
import { UserService } from '../services/user_service';
import { getDatabase } from '../config/database';
import { getRedisClient } from '../config/redis';

/**
 * JWT token payload interface
 */
interface JWTPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Authentication middleware
 * Validates JWT token and sets user context
 */
export const authMiddleware = async (c: Context, next: Next) => {
  try {
    // Get token from Authorization header
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({
        success: false,
        error: 'Authorization header is required'
      }, 401);
    }

    if (!authHeader.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: 'Invalid authorization header format. Expected: "Bearer <token>"'
      }, 401);
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      return c.json({
        success: false,
        error: 'Token is required'
      }, 401);
    }

    // Verify token
    const payload = await verifyToken(token);

    if (!payload) {
      return c.json({
        success: false,
        error: 'Invalid or expired token'
      }, 401);
    }

    // Check if token is not expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return c.json({
        success: false,
        error: 'Token has expired'
      }, 401);
    }

    // Set user context
    c.set('userId', payload.userId);
    c.set('userEmail', payload.email);

    await next();
  } catch (error) {
    logger.error('Authentication middleware error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: c.req.path,
      method: c.req.method
    });

    return c.json({
      success: false,
      error: 'Authentication failed'
    }, 401);
  }
};

/**
 * Optional authentication middleware
 * Sets user context if token is provided, but doesn't require authentication
 */
export const optionalAuthMiddleware = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      if (token) {
        const payload = await verifyToken(token);

        if (payload) {
          const now = Math.floor(Date.now() / 1000);
          if (!payload.exp || payload.exp >= now) {
            c.set('userId', payload.userId);
            c.set('userEmail', payload.email);
          }
        }
      }
    }

    await next();
  } catch (error) {
    logger.error('Optional authentication middleware error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Continue without authentication
    await next();
  }
};

/**
 * Admin authentication middleware
 * Requires authentication and admin privileges
 */
export const adminAuthMiddleware = async (c: Context, next: Next) => {
  try {
    // First run regular auth middleware
    await authMiddleware(c, async () => {});

    const userId = c.get('userId');

    // Check if user is admin (this would typically involve a database lookup)
    const isAdmin = await checkIfUserIsAdmin(userId);

    if (!isAdmin) {
      return c.json({
        success: false,
        error: 'Admin privileges required'
      }, 403);
    }

    await next();
  } catch (error) {
    logger.error('Admin authentication middleware error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return c.json({
      success: false,
      error: 'Admin authentication failed'
    }, 403);
  }
};

/**
 * Verify JWT token
 * Real implementation using jsonwebtoken
 */
async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { verify } = await import('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      logger.error('JWT_SECRET environment variable is not set');
      return null;
    }

    // Verify token with proper algorithm specification
    const payload = verify(token, jwtSecret, { algorithms: ['HS256'] }) as JWTPayload;

    // Validate required fields
    if (!payload.userId || !payload.email) {
      logger.error('Invalid token payload: missing required fields', { payload });
      return null;
    }

    return payload;
  } catch (error) {
    logger.error('Token verification failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tokenLength: token.length
    });
    return null;
  }
}

/**
 * Check if user has admin privileges
 * Real implementation using database
 */
async function checkIfUserIsAdmin(userId: string): Promise<boolean> {
  try {
    // Get user from database to check subscription tier or role
    const user = await UserService.getUserById(userId);

    if (!user) {
      logger.warn('User not found for admin check', { userId });
      return false;
    }

    // Check if user has premium subscription or admin role
    const isAdmin = user.subscription.tier === 'premium' ||
                   user.subscription.features.includes('admin_access');

    if (isAdmin) {
      logger.debug('Admin access granted', { userId, tier: user.subscription.tier });
    }

    return isAdmin;
  } catch (error) {
    logger.error('Admin check failed', { error, userId });
    return false;
  }
}

/**
 * Rate limiting middleware for authentication endpoints
 */
export const authRateLimitMiddleware = async (c: Context, next: Next) => {
  try {
    const clientIP = c.req.header('x-forwarded-for') ||
                     c.req.header('x-real-ip') ||
                     'unknown';

    const endpoint = c.req.path;

    // In production, this would use Redis or another rate limiting store
    const key = `auth_rate_limit:${endpoint}:${clientIP}`;

    // Mock rate limiting check
    const isRateLimited = await checkRateLimit(key, 5, 15 * 60 * 1000); // 5 requests per 15 minutes

    if (isRateLimited) {
      return c.json({
        success: false,
        error: 'Too many authentication attempts. Please try again later.'
      }, 429);
    }

    await next();
  } catch (error) {
    logger.error('Rate limiting middleware error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Continue without rate limiting if there's an error
    await next();
  }
};

/**
 * Real rate limiting check using Redis
 */
async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const windowSeconds = Math.ceil(windowMs / 1000);

    // Get current count
    const currentCount = await redis.get(key);
    const count = parseInt(currentCount || '0');

    if (count >= limit) {
      logger.warn('Rate limit exceeded', { key, count, limit });
      return true;
    }

    // Use Redis pipeline for atomic operations
    const pipeline = redis.multi();
    pipeline.incr(key);
    pipeline.expire(key, windowSeconds);
    await pipeline.exec();

    logger.debug('Rate limit check passed', { key, count: count + 1, limit });
    return false;
  } catch (error) {
    logger.error('Rate limit check failed', { error, key });
    // Fail open - don't block requests if Redis is down
    return false;
  }
}

/**
 * Extract user ID from token without full verification
 * Used in cases where we just need the user ID for caching or logging
 */
export function extractUserIdFromToken(token: string): string | null {
  try {
    // Simple extraction without verification (decode only)
    const parts = token.split('.');
    if (parts.length === 3) {
      // Decode the payload (middle part)
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return payload.userId || null;
    }

    // Fallback for mock tokens during development
    if (token.startsWith('jwt_token_')) {
      const tokenParts = token.split('_');
      if (tokenParts.length >= 4) {
        return tokenParts[2];
      }
    }

    return null;
  } catch (error) {
    logger.debug('Failed to extract user ID from token', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tokenLength: token.length
    });
    return null;
  }
}

/**
 * Generate JWT token for user
 * Real implementation using jsonwebtoken
 */
export async function generateToken(userId: string, email: string): Promise<{ token: string; expiresAt: Date }> {
  try {
    const { sign } = await import('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + (7 * 24 * 60 * 60); // 7 days

    const payload = {
      userId,
      email,
      iat: now,
      exp,
      type: 'access'
    };

    const token = sign(payload, jwtSecret, { algorithm: 'HS256' });

    return {
      token,
      expiresAt: new Date(exp * 1000)
    };
  } catch (error) {
    logger.error('Token generation failed', { error, userId });
    throw new Error('Failed to generate access token');
  }
}

/**
 * Generate refresh token
 * Real implementation using jsonwebtoken
 */
export async function generateRefreshToken(userId: string): Promise<{ refreshToken: string; expiresAt: Date }> {
  try {
    const { sign } = await import('jsonwebtoken');
    const refreshSecret = process.env.JWT_REFRESH_SECRET;

    if (!refreshSecret) {
      throw new Error('JWT_REFRESH_SECRET environment variable is not set');
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + (30 * 24 * 60 * 60); // 30 days

    const payload = {
      userId,
      type: 'refresh',
      iat: now,
      exp
    };

    const refreshToken = sign(payload, refreshSecret, { algorithm: 'HS256' });

    return {
      refreshToken,
      expiresAt: new Date(exp * 1000)
    };
  } catch (error) {
    logger.error('Refresh token generation failed', { error, userId });
    throw new Error('Failed to generate refresh token');
  }
}

/**
 * Verify refresh token
 * Real implementation using jsonwebtoken
 */
export async function verifyRefreshToken(refreshToken: string): Promise<{ userId: string } | null> {
  try {
    const { verify } = await import('jsonwebtoken');
    const refreshSecret = process.env.JWT_REFRESH_SECRET;

    if (!refreshSecret) {
      logger.error('JWT_REFRESH_SECRET environment variable is not set');
      return null;
    }

    const payload = verify(refreshToken, refreshSecret, { algorithms: ['HS256'] }) as any;

    if (payload.type !== 'refresh' || !payload.userId) {
      logger.error('Invalid refresh token payload', { payload });
      return null;
    }

    return { userId: payload.userId };
  } catch (error) {
    logger.error('Refresh token verification failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}