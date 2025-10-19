/**
 * User service for user management and authentication
 * Handles user registration, authentication, and profile management
 */

import { z } from 'zod';
import postgres from 'postgres';
import {
  userSchema,
  userPreferencesSchema,
  userSubscriptionSchema,
  type User,
  type UserPreferences,
  type UserSubscription
} from '../models/user';
import { getDatabase } from '@/config/database';
import { logger } from '@/utils/logger';

// User registration data
export const userRegistrationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  preferences: userPreferencesSchema.optional(),
  subscription: userSubscriptionSchema.optional()
});

export type UserRegistration = z.infer<typeof userRegistrationSchema>;

// User login data
export const userLoginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export type UserLogin = z.infer<typeof userLoginSchema>;

// User update data
export const userUpdateSchema = z.object({
  email: z.string().email().optional(),
  preferences: userPreferencesSchema.optional(),
  subscription: userSubscriptionSchema.optional()
});

export type UserUpdate = z.infer<typeof userUpdateSchema>;

// Password change data
export const passwordChangeSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(128)
});

export type PasswordChange = z.infer<typeof passwordChangeSchema>;

// Authentication result
export const authResultSchema = z.object({
  user: userSchema,
  token: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime()
});

export type AuthResult = z.infer<typeof authResultSchema>;

export class UserService {
  private static readonly PASSWORD_SALT_ROUNDS = 12;
  private static readonly JWT_EXPIRES_IN = '7d';
  private static readonly REFRESH_TOKEN_EXPIRES_IN = '30d';

  /**
   * Register a new user
   */
  static async register(userData: UserRegistration): Promise<AuthResult> {
    try {
      // Validate input data
      const validatedData = userRegistrationSchema.parse(userData);

      // Check if user already exists
      const existingUser = await this.findUserByEmail(validatedData.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Hash password
      const passwordHash = await this.hashPassword(validatedData.password);

      // Create user object
      const newUser: Omit<User, 'id' | 'createdAt' | 'updatedAt'> = {
        email: validatedData.email,
        passwordHash,
        preferences: validatedData.preferences || this.getDefaultPreferences(),
        subscription: validatedData.subscription || this.getDefaultSubscription()
      };

      // Save user to database
      const savedUser = await this.saveUser(newUser);

      // Generate tokens
      const { token, refreshToken, expiresAt } = await this.generateTokens(savedUser);

      return {
        user: savedUser,
        token,
        refreshToken,
        expiresAt
      };
    } catch (error) {
      console.error('User registration failed:', error);
      throw error instanceof Error ? error : new Error('Registration failed');
    }
  }

  /**
   * Authenticate user login
   */
  static async login(loginData: UserLogin): Promise<AuthResult> {
    try {
      const validatedData = userLoginSchema.parse(loginData);

      // Find user by email
      const user = await this.findUserByEmail(validatedData.email);
      if (!user) {
        throw new Error('Invalid email or password');
      }

      // Verify password
      const isValidPassword = await this.verifyPassword(
        validatedData.password,
        user.passwordHash
      );
      if (!isValidPassword) {
        throw new Error('Invalid email or password');
      }

      // Update last login
      await this.updateLastLogin(user.id);

      // Generate tokens
      const { token, refreshToken, expiresAt } = await this.generateTokens(user);

      return {
        user,
        token,
        refreshToken,
        expiresAt
      };
    } catch (error) {
      console.error('User login failed:', error);
      throw error instanceof Error ? error : new Error('Login failed');
    }
  }

  /**
   * Refresh access token
   */
  static async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      // Verify refresh token
      const payload = await this.verifyRefreshToken(refreshToken);
      if (!payload) {
        throw new Error('Invalid refresh token');
      }

      // Find user
      const user = await this.findUserById(payload.userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Generate new tokens
      const tokens = await this.generateTokens(user);

      return {
        user,
        ...tokens
      };
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId: string): Promise<User | null> {
    try {
      return await this.findUserById(userId);
    } catch (error) {
      console.error('Failed to get user by ID:', error);
      return null;
    }
  }

  /**
   * Update user profile
   */
  static async updateUser(userId: string, updateData: UserUpdate): Promise<User> {
    try {
      const validatedData = userUpdateSchema.parse(updateData);

      // Find existing user
      const existingUser = await this.findUserById(userId);
      if (!existingUser) {
        throw new Error('User not found');
      }

      // Check email uniqueness if updating email
      if (validatedData.email && validatedData.email !== existingUser.email) {
        const emailExists = await this.findUserByEmail(validatedData.email);
        if (emailExists) {
          throw new Error('Email already exists');
        }
      }

      // Prepare update data
      const updateFields: Partial<User> = {
        ...validatedData,
        updatedAt: new Date()
      };

      // Update user in database
      const updatedUser = await this.updateUserInDatabase(userId, updateFields);

      return updatedUser;
    } catch (error) {
      console.error('User update failed:', error);
      throw error instanceof Error ? error : new Error('Update failed');
    }
  }

  /**
   * Change user password
   */
  static async changePassword(userId: string, passwordData: PasswordChange): Promise<void> {
    try {
      const validatedData = passwordChangeSchema.parse(passwordData);

      // Find user
      const user = await this.findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isValidPassword = await this.verifyPassword(
        validatedData.currentPassword,
        user.passwordHash
      );
      if (!isValidPassword) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const newPasswordHash = await this.hashPassword(validatedData.newPassword);

      // Update password in database
      await this.updateUserPassword(userId, newPasswordHash);
    } catch (error) {
      console.error('Password change failed:', error);
      throw error instanceof Error ? error : new Error('Password change failed');
    }
  }

  /**
   * Update user preferences
   */
  static async updatePreferences(userId: string, preferences: UserPreferences): Promise<User> {
    try {
      const validatedPreferences = userPreferencesSchema.parse(preferences);

      // Find user
      const user = await this.findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Update preferences
      const updatedUser = await this.updateUserInDatabase(userId, {
        preferences: validatedPreferences,
        updatedAt: new Date()
      });

      return updatedUser;
    } catch (error) {
      console.error('Preferences update failed:', error);
      throw error instanceof Error ? error : new Error('Preferences update failed');
    }
  }

  /**
   * Delete user account
   */
  static async deleteUser(userId: string, password: string): Promise<void> {
    try {
      // Find user
      const user = await this.findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify password
      const isValidPassword = await this.verifyPassword(password, user.passwordHash);
      if (!isValidPassword) {
        throw new Error('Invalid password');
      }

      // Delete user data (cascade delete for related records)
      await this.deleteUserFromDatabase(userId);
    } catch (error) {
      console.error('User deletion failed:', error);
      throw error instanceof Error ? error : new Error('Account deletion failed');
    }
  }

  // Helper methods

  private static getDefaultPreferences(): UserPreferences {
    return {
      language: 'ja',
      currency: 'JPY',
      notifications: {
        priceAlerts: true,
        stockAlerts: true,
        dealAlerts: false
      },
      categories: [],
      brands: [],
      priceRange: {
        min: 0,
        max: 1000000
      }
    };
  }

  private static getDefaultSubscription(): UserSubscription {
    return {
      tier: 'free',
      features: ['basic_search'],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      autoRenew: false
    };
  }

  private static async hashPassword(password: string): Promise<string> {
    // Use bcrypt for secure password hashing
    const bcrypt = await import('bcryptjs');
    return bcrypt.hash(password, this.PASSWORD_SALT_ROUNDS);
  }

  private static async verifyPassword(password: string, hash: string): Promise<boolean> {
    // Use bcrypt compare for secure password verification
    const bcrypt = await import('bcryptjs');
    return bcrypt.compare(password, hash);
  }

  private static async generateTokens(user: User): Promise<{
    token: string;
    refreshToken: string;
    expiresAt: string;
  }> {
    // Use JWT for secure token generation
    const { sign } = await import('jsonwebtoken');
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const refreshSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-change-in-production';

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const payload = {
      userId: user.id,
      email: user.email,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(expiresAt.getTime() / 1000),
    };

    const refreshPayload = {
      userId: user.id,
      type: 'refresh',
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(refreshExpiresAt.getTime() / 1000),
    };

    return {
      token: sign(payload, jwtSecret, { algorithm: 'HS256' }),
      refreshToken: sign(refreshPayload, refreshSecret, { algorithm: 'HS256' }),
      expiresAt: expiresAt.toISOString()
    };
  }

  private static async verifyRefreshToken(refreshToken: string): Promise<{ userId: string } | null> {
    try {
      const { verify } = await import('jsonwebtoken');
      const refreshSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-change-in-production';

      const payload = verify(refreshToken, refreshSecret, { algorithms: ['HS256'] }) as any;

      if (payload.type === 'refresh' && payload.userId) {
        return { userId: payload.userId };
      }
      return null;
    } catch (error) {
      logger.error('Refresh token verification failed:', error);
      return null;
    }
  }

  // Database methods (PostgreSQL implementations)

  private static async findUserByEmail(email: string): Promise<User | null> {
    try {
      const db = getDatabase();
      const users = await db`
        SELECT * FROM users WHERE email = ${email} AND is_active = true
      `;

      if (users.length === 0) {
        return null;
      }

      const user = users[0];
      return this.mapDbUserToUser(user);
    } catch (error) {
      logger.error('Error finding user by email:', error);
      return null;
    }
  }

  private static async findUserById(userId: string): Promise<User | null> {
    try {
      const db = getDatabase();
      const users = await db`
        SELECT * FROM users WHERE id = ${userId} AND is_active = true
      `;

      if (users.length === 0) {
        return null;
      }

      const user = users[0];
      return this.mapDbUserToUser(user);
    } catch (error) {
      logger.error('Error finding user by ID:', error);
      return null;
    }
  }

  private static async saveUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    try {
      const db = getDatabase();
      const now = new Date();

      const users = await db`
        INSERT INTO users ${db(userData)}
        RETURNING *
      `;

      const user = users[0];
      return this.mapDbUserToUser(user);
    } catch (error) {
      logger.error('Error saving user:', error);
      throw new Error('Failed to save user to database');
    }
  }

  private static async updateUserInDatabase(userId: string, updateFields: Partial<User>): Promise<User> {
    try {
      const db = getDatabase();
      const updateData = {
        ...updateFields,
        updated_at: new Date(),
      };

      const users = await db`
        UPDATE users ${db(updateData)}
        WHERE id = ${userId} AND is_active = true
        RETURNING *
      `;

      if (users.length === 0) {
        throw new Error('User not found');
      }

      const user = users[0];
      return this.mapDbUserToUser(user);
    } catch (error) {
      logger.error('Error updating user:', error);
      throw new Error('Failed to update user in database');
    }
  }

  private static async updateUserPassword(userId: string, newPasswordHash: string): Promise<void> {
    try {
      const db = getDatabase();
      await db`
        UPDATE users
        SET password_hash = ${newPasswordHash}, updated_at = ${new Date()}
        WHERE id = ${userId} AND is_active = true
      `;
    } catch (error) {
      logger.error('Error updating user password:', error);
      throw new Error('Failed to update password');
    }
  }

  private static async updateLastLogin(userId: string): Promise<void> {
    try {
      const db = getDatabase();
      await db`
        UPDATE users
        SET last_login_at = ${new Date()}, updated_at = ${new Date()}
        WHERE id = ${userId} AND is_active = true
      `;
    } catch (error) {
      logger.error('Error updating last login:', error);
      // Don't throw error here as it's not critical
    }
  }

  private static async deleteUserFromDatabase(userId: string): Promise<void> {
    try {
      const db = getDatabase();

      // Soft delete - mark as inactive rather than hard delete
      await db`
        UPDATE users
        SET is_active = false, updated_at = ${new Date()}
        WHERE id = ${userId}
      `;

      logger.info(`User ${userId} marked as inactive`);
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw new Error('Failed to delete user');
    }
  }

  private static mapDbUserToUser(dbUser: any): User {
    return {
      id: dbUser.id,
      email: dbUser.email,
      passwordHash: dbUser.password_hash,
      preferences: dbUser.preferences as UserPreferences,
      subscription: dbUser.subscription as UserSubscription,
      language: dbUser.language,
      currency: dbUser.currency,
      timezone: dbUser.timezone,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
      lastLoginAt: dbUser.last_login_at,
    };
  }

  /**
   * Validate user input
   */
  static validateRegistrationData(data: unknown): UserRegistration {
    return userRegistrationSchema.parse(data);
  }

  static validateLoginData(data: unknown): UserLogin {
    return userLoginSchema.parse(data);
  }

  static validateUpdateData(data: unknown): UserUpdate {
    return userUpdateSchema.parse(data);
  }

  static validatePasswordChangeData(data: unknown): PasswordChange {
    return passwordChangeSchema.parse(data);
  }

  /**
   * Get user statistics
   */
  static async getUserStats(userId: string): Promise<{
    totalSearches: number;
    totalAlerts: number;
    totalWatchlistItems: number;
    membershipDays: number;
    lastActiveAt: string;
  }> {
    try {
      const db = getDatabase();

      // Get user info
      const users = await db`
        SELECT created_at, last_login_at FROM users WHERE id = ${userId}
      `;
      if (users.length === 0) {
        throw new Error('User not found');
      }
      const user = users[0];

      // Count user activities (searches)
      const searchCount = await db`
        SELECT COUNT(*) as count FROM user_activities
        WHERE user_id = ${userId} AND type = 'search_query'
      `;

      // Count alerts
      const alertCount = await db`
        SELECT COUNT(*) as count FROM alerts WHERE user_id = ${userId} AND active = true
      `;

      // Count watchlist items (activities with watchlist_add type)
      const watchlistCount = await db`
        SELECT COUNT(*) as count FROM user_activities
        WHERE user_id = ${userId} AND type = 'wishlist_add'
      `;

      const membershipDays = Math.floor(
        (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        totalSearches: parseInt(searchCount[0].count),
        totalAlerts: parseInt(alertCount[0].count),
        totalWatchlistItems: parseInt(watchlistCount[0].count),
        membershipDays,
        lastActiveAt: user.last_login_at || user.created_at,
      };
    } catch (error) {
      logger.error('Error getting user stats:', error);
      throw new Error('Failed to get user statistics');
    }
  }

  /**
   * Export user data
   */
  static async exportUserData(userId: string): Promise<{
    user: User;
    searches: Array<{ query: string; timestamp: string }>;
    alerts: Array<{ type: string; createdAt: string }>;
    watchlist: Array<{ productId: string; addedAt: string }>;
  }> {
    try {
      const db = getDatabase();

      // Get user
      const user = await this.findUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get user searches
      const searches = await db`
        SELECT metadata->>'query' as query, timestamp
        FROM user_activities
        WHERE user_id = ${userId} AND type = 'search_query'
        ORDER BY timestamp DESC
        LIMIT 100
      `;

      // Get user alerts
      const alerts = await db`
        SELECT type, created_at
        FROM alerts
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;

      // Get watchlist items
      const watchlist = await db`
        SELECT target_id as product_id, timestamp
        FROM user_activities
        WHERE user_id = ${userId} AND type = 'wishlist_add'
        ORDER BY timestamp DESC
      `;

      return {
        user,
        searches: searches.map(s => ({
          query: s.query,
          timestamp: s.timestamp,
        })),
        alerts: alerts.map(a => ({
          type: a.type,
          createdAt: a.created_at,
        })),
        watchlist: watchlist.map(w => ({
          productId: w.product_id,
          addedAt: w.timestamp,
        })),
      };
    } catch (error) {
      logger.error('Error exporting user data:', error);
      throw new Error('Failed to export user data');
    }
  }
}