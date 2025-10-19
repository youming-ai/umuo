import { z } from 'zod';

export const UserPreferencesSchema = z.object({
  notifications: z.object({
    priceAlerts: z.boolean().default(true),
    dealAlerts: z.boolean().default(true),
    communityUpdates: z.boolean().default(false),
    marketingEmails: z.boolean().default(false),
    quietHours: z.object({
      start: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
      end: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    }).optional(),
  }),
  privacy: z.object({
    analyticsEnabled: z.boolean().default(true),
    personalizationEnabled: z.boolean().default(true),
    locationTracking: z.boolean().default(false),
    affiliateDisclosure: z.boolean().default(true),
  }),
  search: z.object({
    preferredCategories: z.array(z.string()).default([]),
    priceSensitivity: z.enum(['low', 'medium', 'high']).default('medium'),
    showExpired: z.boolean().default(false),
  }),
  display: z.object({
    language: z.enum(['ja', 'en', 'zh']).default('ja'),
    currency: z.literal('JPY'),
    theme: z.enum(['light', 'dark', 'auto']).default('auto'),
  }),
});

export const UserSubscriptionSchema = z.object({
  type: z.enum(['free', 'premium']).default('free'),
  status: z.enum(['active', 'canceled', 'expired']).default('active'),
  expiresAt: z.date().optional(),
  features: z.object({
    advancedAlerts: z.boolean().default(false),
    personalizedRecommendations: z.boolean().default(false),
    adFree: z.boolean().default(false),
    prioritySupport: z.boolean().default(false),
  }).optional(),
});

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  displayName: z.string().min(1).max(50),
  avatar: z.string().url().optional(),
  language: z.enum(['ja', 'en', 'zh']).default('ja'),
  currency: z.literal('JPY'),
  timezone: z.literal('Asia/Tokyo'),
  preferences: UserPreferencesSchema,
  subscription: UserSubscriptionSchema.optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastActiveAt: z.date(),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type UserSubscription = z.infer<typeof UserSubscriptionSchema>;
export type User = z.infer<typeof UserSchema>;

export class UserModel {
  static create(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): User {
    const now = new Date();
    return {
      ...userData,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
    };
  }

  static validate(user: unknown): User {
    return UserSchema.parse(user);
  }

  static sanitizeDisplayName(displayName: string): string {
    return displayName.trim().substring(0, 50);
  }

  static getDefaultPreferences(language: 'ja' | 'en' | 'zh' = 'ja'): UserPreferences {
    return {
      notifications: {
        priceAlerts: true,
        dealAlerts: true,
        communityUpdates: false,
        marketingEmails: false,
      },
      privacy: {
        analyticsEnabled: true,
        personalizationEnabled: true,
        locationTracking: false,
        affiliateDisclosure: true,
      },
      search: {
        preferredCategories: [],
        priceSensitivity: 'medium',
        showExpired: false,
      },
      display: {
        language,
        currency: 'JPY',
        theme: 'auto',
      },
    };
  }

  static isActive(user: User): boolean {
    return user.lastActiveAt &&
           (Date.now() - user.lastActiveAt.getTime()) < 30 * 24 * 60 * 60 * 1000; // 30 days
  }

  static isPremium(user: User): boolean {
    return user.subscription?.type === 'premium' &&
           user.subscription?.status === 'active' &&
           (!user.subscription.expiresAt || user.subscription.expiresAt > new Date());
  }
}