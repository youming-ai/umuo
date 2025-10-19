/**
 * User model validation tests
 * Tests for User schema validation and business logic
 */

import { z } from 'zod';
import {
  userSchema,
  userPreferencesSchema,
  userSubscriptionSchema,
  type User,
  type UserPreferences,
  type UserSubscription
} from '../../../src/models/user';

describe('User Model Validation', () => {
  describe('userSchema', () => {
    const validUser = {
      id: 'user_123',
      email: 'test@example.com',
      passwordHash: 'hashed_password_123',
      preferences: {
        language: 'ja',
        currency: 'JPY',
        notifications: {
          priceAlerts: true,
          stockAlerts: true,
          dealAlerts: false
        },
        categories: ['electronics', 'books'],
        brands: ['sony', 'apple'],
        priceRange: {
          min: 1000,
          max: 50000
        }
      },
      subscription: {
        tier: 'free',
        features: ['basic_search'],
        expiresAt: new Date().toISOString(),
        autoRenew: false
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    it('should validate a valid user object', () => {
      expect(() => userSchema.parse(validUser)).not.toThrow();
    });

    it('should reject user with invalid email', () => {
      const invalidUser = { ...validUser, email: 'invalid-email' };
      expect(() => userSchema.parse(invalidUser)).toThrow(z.ZodError);
    });

    it('should reject user without required fields', () => {
      const incompleteUser = { email: 'test@example.com' };
      expect(() => userSchema.parse(incompleteUser)).toThrow(z.ZodError);
    });

    it('should reject user with invalid language code', () => {
      const invalidUser = {
        ...validUser,
        preferences: {
          ...validUser.preferences,
          language: 'invalid'
        }
      };
      expect(() => userSchema.parse(invalidUser)).toThrow(z.ZodError);
    });

    it('should reject user with invalid price range', () => {
      const invalidUser = {
        ...validUser,
        preferences: {
          ...validUser.preferences,
          priceRange: {
            min: 50000,
            max: 1000 // min > max
          }
        }
      };
      expect(() => userSchema.parse(invalidUser)).toThrow(z.ZodError);
    });

    it('should accept user with minimal valid data', () => {
      const minimalUser = {
        id: 'user_123',
        email: 'test@example.com',
        passwordHash: 'hashed_password_123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      expect(() => userSchema.parse(minimalUser)).not.toThrow();
    });
  });

  describe('userPreferencesSchema', () => {
    const validPreferences = {
      language: 'ja',
      currency: 'JPY',
      notifications: {
        priceAlerts: true,
        stockAlerts: true,
        dealAlerts: false
      },
      categories: ['electronics', 'books'],
      brands: ['sony', 'apple'],
      priceRange: {
        min: 1000,
        max: 50000
      }
    };

    it('should validate valid preferences', () => {
      expect(() => userPreferencesSchema.parse(validPreferences)).not.toThrow();
    });

    it('should accept empty arrays for categories and brands', () => {
      const emptyArrays = {
        ...validPreferences,
        categories: [],
        brands: []
      };
      expect(() => userPreferencesSchema.parse(emptyArrays)).not.toThrow();
    });

    it('should reject invalid currency code', () => {
      const invalidCurrency = {
        ...validPreferences,
        currency: 'INVALID'
      };
      expect(() => userPreferencesSchema.parse(invalidCurrency)).toThrow(z.ZodError);
    });

    it('should reject negative price values', () => {
      const negativePrice = {
        ...validPreferences,
        priceRange: {
          min: -100,
          max: 50000
        }
      };
      expect(() => userPreferencesSchema.parse(negativePrice)).toThrow(z.ZodError);
    });
  });

  describe('userSubscriptionSchema', () => {
    const validSubscription = {
      tier: 'premium',
      features: ['advanced_search', 'price_alerts', 'ai_recommendations'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      autoRenew: true
    };

    it('should validate valid subscription', () => {
      expect(() => userSubscriptionSchema.parse(validSubscription)).not.toThrow();
    });

    it('should reject invalid subscription tier', () => {
      const invalidTier = {
        ...validSubscription,
        tier: 'invalid_tier'
      };
      expect(() => userSubscriptionSchema.parse(invalidTier)).toThrow(z.ZodError);
    });

    it('should reject invalid feature', () => {
      const invalidFeature = {
        ...validSubscription,
        features: ['invalid_feature']
      };
      expect(() => userSubscriptionSchema.parse(invalidFeature)).toThrow(z.ZodError);
    });

    it('should reject past expiration date', () => {
      const pastDate = {
        ...validSubscription,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      };
      expect(() => userSubscriptionSchema.parse(pastDate)).toThrow(z.ZodError);
    });
  });

  describe('Business Logic Validation', () => {
    it('should validate email uniqueness constraint (simulated)', () => {
      const existingEmails = ['test@example.com', 'user@example.com'];

      const newUser = {
        id: 'user_123',
        email: 'test@example.com', // Duplicate email
        passwordHash: 'hashed_password_123',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Simulate uniqueness check
      const isEmailUnique = !existingEmails.includes(newUser.email);
      expect(isEmailUnique).toBe(false);
    });

    it('should validate password strength requirements', () => {
      const validatePasswordStrength = (password: string) => {
        return password.length >= 8 &&
               /[A-Z]/.test(password) &&
               /[a-z]/.test(password) &&
               /[0-9]/.test(password);
      };

      expect(validatePasswordStrength('Password123')).toBe(true);
      expect(validatePasswordStrength('weak')).toBe(false);
      expect(validatePasswordStrength('alllowercase123')).toBe(false);
      expect(validatePasswordStrength('ALLUPPERCASE123')).toBe(false);
      expect(validatePasswordStrength('NoNumbers')).toBe(false);
    });

    it('should handle subscription tier upgrades correctly', () => {
      const canUpgrade = (fromTier: string, toTier: string) => {
        const tiers = ['free', 'basic', 'premium'];
        return tiers.indexOf(toTier) > tiers.indexOf(fromTier);
      };

      expect(canUpgrade('free', 'basic')).toBe(true);
      expect(canUpgrade('basic', 'premium')).toBe(true);
      expect(canUpgrade('free', 'premium')).toBe(true);
      expect(canUpgrade('premium', 'basic')).toBe(false);
      expect(canUpgrade('basic', 'free')).toBe(false);
    });
  });
});