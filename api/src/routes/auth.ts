/**
 * Authentication Routes
 *
 * Handles user authentication, registration, and profile management.
 * Supports token-based authentication with JWT and refresh tokens.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { UserService } from '../services/user_service';
import { UserSchema, UserPreferencesSchema } from '../models/user';
import { authMiddleware, authRateLimitMiddleware, generateToken, generateRefreshToken, verifyRefreshToken } from '../middleware/auth';

// Initialize Hono app for auth routes
const auth = new Hono();

// Validation schemas
const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  displayName: z.string().min(1, 'Display name is required')
    .max(50, 'Display name too long'),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
  preferences: UserPreferencesSchema.optional(),
});

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  avatar: z.string().url().optional(),
  preferences: UserPreferencesSchema.optional(),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8).max(128)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
});

// Apply rate limiting to authentication endpoints
auth.use('/register', authRateLimitMiddleware);
auth.use('/login', authRateLimitMiddleware);
auth.use('/refresh', authRateLimitMiddleware);

// POST /auth/register - User registration
auth.post('/register', zValidator('json', RegisterSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    // Create new user using UserService.register which already handles token generation
    const authResult = await UserService.register({
      email: body.email,
      password: body.password,
      preferences: body.preferences,
    });

    // Return user data without sensitive information
    const userResponse = {
      id: authResult.user.id,
      email: authResult.user.email,
      preferences: authResult.user.preferences,
      subscription: authResult.user.subscription,
      language: authResult.user.language,
      currency: authResult.user.currency,
      createdAt: authResult.user.createdAt,
    };

    return c.json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: userResponse,
        accessToken: authResult.token,
        refreshToken: authResult.refreshToken,
        expiresIn: 3600, // 1 hour
      }
    }, 201);

  } catch (error: any) {
    console.error('Registration error:', error);
    return c.json({
      success: false,
      error: 'Registration failed',
      message: error.message || 'An error occurred during registration'
    }, 500);
  }
});

// POST /auth/login - User login
auth.post('/login', zValidator('json', LoginSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    // Authenticate user using UserService
    const authResult = await UserService.login({
      email: body.email,
      password: body.password
    });

    if (!authResult) {
      return c.json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid email or password'
      }, 401);
    }

    // Update last active timestamp
    await UserService.updateLastLogin(authResult.user.id);

    // Generate tokens using our JWT middleware functions
    const accessTokenResult = await generateToken(authResult.user.id, authResult.user.email);
    const refreshTokenResult = await generateRefreshToken(authResult.user.id);

    // Return user data
    const userResponse = {
      id: authResult.user.id,
      email: authResult.user.email,
      preferences: authResult.user.preferences,
      subscription: authResult.user.subscription,
      language: authResult.user.language,
      currency: authResult.user.currency,
      createdAt: authResult.user.createdAt,
      lastLoginAt: authResult.user.lastLoginAt,
    };

    return c.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse,
        accessToken: accessTokenResult.token,
        refreshToken: refreshTokenResult.refreshToken,
        expiresIn: 3600, // 1 hour
      }
    });

  } catch (error: any) {
    console.error('Login error:', error);
    return c.json({
      success: false,
      error: 'Login failed',
      message: error.message || 'An error occurred during login'
    }, 500);
  }
});

// POST /auth/refresh - Refresh access token
auth.post('/refresh', zValidator('json', RefreshTokenSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    // Verify refresh token using our proper JWT verification
    const payload = await verifyRefreshToken(body.refreshToken);

    if (!payload) {
      return c.json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid refresh token'
      }, 401);
    }

    // Get user using UserService
    const user = await UserService.getUserById(payload.userId);
    if (!user) {
      return c.json({
        success: false,
        error: 'Unauthorized',
        message: 'User not found'
      }, 401);
    }

    // Generate new access token
    const newAccessTokenResult = await generateToken(user.id, user.email);

    return c.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessTokenResult.token,
        expiresIn: 3600, // 1 hour
      }
    });

  } catch (error: any) {
    console.error('Token refresh error:', error);
    return c.json({
      success: false,
      error: 'Token refresh failed',
      message: error.message || 'An error occurred during token refresh'
    }, 500);
  }
});

// GET /auth/profile - Get user profile
auth.get('/profile', authMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const userEmail = c.get('userEmail');

    // Get user from database
    const user = await UserService.getUserById(userId);
    if (!user) {
      return c.json({
        success: false,
        error: 'User not found'
      }, 404);
    }

    const userResponse = {
      id: user.id,
      email: user.email,
      preferences: user.preferences,
      subscription: user.subscription,
      language: user.language,
      currency: user.currency,
      timezone: user.timezone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
    };

    return c.json({
      success: true,
      data: userResponse
    });

  } catch (error: any) {
    console.error('Get profile error:', error);
    return c.json({
      success: false,
      error: 'Failed to get profile',
      message: error.message || 'An error occurred while fetching profile'
    }, 500);
  }
});

// PUT /auth/profile - Update user profile
auth.put('/profile', authMiddleware, zValidator('json', UpdateProfileSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // Update user profile using UserService
    const updatedUser = await UserService.updateUser(userId, body);

    const userResponse = {
      id: updatedUser.id,
      email: updatedUser.email,
      preferences: updatedUser.preferences,
      subscription: updatedUser.subscription,
      language: updatedUser.language,
      currency: updatedUser.currency,
      timezone: updatedUser.timezone,
      updatedAt: updatedUser.updatedAt,
      lastLoginAt: updatedUser.lastLoginAt,
    };

    return c.json({
      success: true,
      message: 'Profile updated successfully',
      data: userResponse
    });

  } catch (error: any) {
    console.error('Update profile error:', error);
    return c.json({
      success: false,
      error: 'Failed to update profile',
      message: error.message || 'An error occurred while updating profile'
    }, 500);
  }
});

// POST /auth/change-password - Change password
auth.post('/change-password', authMiddleware, zValidator('json', ChangePasswordSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // Update password using UserService (handles verification internally)
    await UserService.changePassword(userId, {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword
    });

    return c.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error: any) {
    console.error('Change password error:', error);
    return c.json({
      success: false,
      error: 'Failed to change password',
      message: error.message || 'An error occurred while changing password'
    }, 500);
  }
});

// POST /auth/logout - Logout user
auth.post('/logout', authMiddleware, async (c) => {
  try {
    const user = c.get('user');

    // Invalidate refresh token (mock implementation)
    await invalidateMockRefreshToken(user.id);

    // Update last active timestamp
    await userService.updateLastActive(user.id);

    return c.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error: any) {
    console.error('Logout error:', error);
    return c.json({
      success: false,
      error: 'Logout failed',
      message: error.message || 'An error occurred during logout'
    }, 500);
  }
});

// POST /auth/forgot-password - Initiate password reset
auth.post('/forgot-password', zValidator('json', z.object({
  email: z.string().email('Invalid email address')
})), async (c) => {
  try {
    const body = c.req.valid('json');

    // Check if user exists
    const user = await userService.findByEmail(body.email);
    if (!user) {
      // Always return success to prevent email enumeration
      return c.json({
        success: true,
        message: 'If an account with this email exists, a password reset link has been sent'
      });
    }

    // Generate password reset token (mock implementation)
    const resetToken = generateMockPasswordResetToken(user.id);

    // Send password reset email (mock implementation)
    await sendPasswordResetEmail(user.email, resetToken);

    return c.json({
      success: true,
      message: 'If an account with this email exists, a password reset link has been sent'
    });

  } catch (error: any) {
    console.error('Forgot password error:', error);
    return c.json({
      success: true, // Always return success to prevent email enumeration
      message: 'If an account with this email exists, a password reset link has been sent'
    });
  }
});

// POST /auth/reset-password - Reset password with token
auth.post('/reset-password', zValidator('json', z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8).max(128)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter, one lowercase letter, and one number'),
})), async (c) => {
  try {
    const body = c.req.valid('json');

    // Verify reset token
    const payload = await verifyMockPasswordResetToken(body.token);
    if (!payload) {
      return c.json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid or expired reset token'
      }, 401);
    }

    // Update password
    const success = await userService.changePassword(payload.userId, body.newPassword);

    if (!success) {
      return c.json({
        success: false,
        error: 'Failed to reset password',
        message: 'Unable to reset password'
      }, 500);
    }

    // Invalidate reset token
    await invalidateMockPasswordResetToken(body.token);

    return c.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error: any) {
    console.error('Reset password error:', error);
    return c.json({
      success: false,
      error: 'Failed to reset password',
      message: error.message || 'An error occurred while resetting password'
    }, 500);
  }
});

// DELETE /auth/account - Delete user account
auth.delete('/account', authMiddleware, async (c) => {
  try {
    const user = c.get('user');

    // Delete user account (with soft delete for data retention)
    const success = await userService.deleteAccount(user.id);

    if (!success) {
      return c.json({
        success: false,
        error: 'Failed to delete account',
        message: 'Unable to delete account'
      }, 500);
    }

    return c.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error: any) {
    console.error('Delete account error:', error);
    return c.json({
      success: false,
      error: 'Failed to delete account',
      message: error.message || 'An error occurred while deleting account'
    }, 500);
  }
});

// Helper functions (mock implementations)
function generateMockAccessToken(userId: string): string {
  // In real implementation, use JWT
  return `mock_access_token_${userId}_${Date.now()}`;
}

function generateMockRefreshToken(userId: string): string {
  // In real implementation, use secure random string and store in database
  return `mock_refresh_token_${userId}_${Date.now()}`;
}

async function verifyMockRefreshToken(token: string): Promise<{ userId: string } | null> {
  // In real implementation, verify JWT signature and check database
  if (token.startsWith('mock_refresh_token_')) {
    const parts = token.split('_');
    return { userId: parts[3] };
  }
  return null;
}

async function invalidateMockRefreshToken(userId: string): Promise<void> {
  // In real implementation, remove token from database
  console.log(`Invalidating refresh tokens for user ${userId}`);
}

function generateMockPasswordResetToken(userId: string): string {
  // In real implementation, use secure random string and store in database with expiration
  return `mock_reset_token_${userId}_${Date.now()}`;
}

async function verifyMockPasswordResetToken(token: string): Promise<{ userId: string } | null> {
  // In real implementation, verify token exists in database and is not expired
  if (token.startsWith('mock_reset_token_')) {
    const parts = token.split('_');
    return { userId: parts[3] };
  }
  return null;
}

async function invalidateMockPasswordResetToken(token: string): Promise<void> {
  // In real implementation, remove token from database
  console.log(`Invalidating password reset token: ${token}`);
}

async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  // In real implementation, use email service to send reset link
  console.log(`Sending password reset email to ${email} with token ${token}`);
}

export default auth;