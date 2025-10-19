export interface NotificationSettings {
  priceAlerts: boolean;
  dealAlerts: boolean;
  communityUpdates: boolean;
  marketingEmails: boolean;
  quietHours?: {
    start: string; // HH:mm format
    end: string;   // HH:mm format
  };
}

export interface PrivacySettings {
  analyticsEnabled: boolean;
  personalizationEnabled: boolean;
  locationTracking: boolean;
  affiliateDisclosure: boolean;
}

export interface SearchSettings {
  preferredCategories: string[];
  priceSensitivity: 'low' | 'medium' | 'high';
  showExpired: boolean;
}

export interface DisplaySettings {
  language: 'ja' | 'en' | 'zh';
  currency: 'JPY';
  theme: 'light' | 'dark' | 'auto';
}

export interface UserPreferences {
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  search: SearchSettings;
  display: DisplaySettings;
}

export interface UserSubscription {
  type: 'free' | 'premium';
  status: 'active' | 'canceled' | 'expired';
  expiresAt?: Date;
  features?: {
    advancedAlerts: boolean;
    personalizedRecommendations: boolean;
    adFree: boolean;
    prioritySupport: boolean;
  };
}

export interface User {
  id: string;
  email?: string;
  displayName: string;
  avatar?: string;
  language: 'ja' | 'en' | 'zh';
  currency: 'JPY';
  timezone: 'Asia/Tokyo';
  preferences: UserPreferences;
  subscription?: UserSubscription;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date;
}