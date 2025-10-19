/**
 * Storage Service
 * Handles local storage using MMKV for fast key-value caching
 */

import { MMKV } from 'react-native-mmkv';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage instances
const userStorage = new MMKV({
  id: 'user-data',
  encryptionKey: 'yabaii-user-key',
});

const cacheStorage = new MMKV({
  id: 'cache-data',
  encryptionKey: 'yabaii-cache-key',
});

const secureStorage = new MMKV({
  id: 'secure-data',
  encryptionKey: 'yabaii-secure-key',
});

export interface StorageOptions {
  encrypt?: boolean;
  persist?: boolean;
  ttl?: number; // Time to live in milliseconds
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number;
}

export class StorageService {
  private static instance: StorageService;

  private constructor() {}

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  /**
   * Store data with optional encryption and TTL
   */
  async set<T>(key: string, value: T, options: StorageOptions = {}): Promise<void> {
    try {
      const { encrypt = false, persist = true, ttl } = options;

      let storageInstance = this.getStorageInstance(encrypt);

      if (ttl) {
        // Store with TTL
        const cacheEntry: CacheEntry<T> = {
          data: value,
          timestamp: Date.now(),
          ttl,
        };

        if (persist) {
          storageInstance.set(key, JSON.stringify(cacheEntry));
        } else {
          // For non-persistent data, use memory storage
          memoryStorage.set(key, cacheEntry);
        }
      } else {
        // Store without TTL
        if (persist) {
          if (typeof value === 'string') {
            storageInstance.set(key, value);
          } else if (typeof value === 'number') {
            storageInstance.set(key, value);
          } else if (typeof value === 'boolean') {
            storageInstance.set(key, value);
          } else {
            storageInstance.set(key, JSON.stringify(value));
          }
        } else {
          memoryStorage.set(key, value);
        }
      }

      console.debug(`Storage: Stored ${key} with encryption: ${encrypt}`);
    } catch (error) {
      console.error('Failed to store data:', key, error);
      throw error;
    }
  }

  /**
   * Retrieve data
   */
  async get<T>(key: string, defaultValue?: T, options: StorageOptions = {}): Promise<T | null> {
    try {
      const { encrypt = false, persist = true } = options;

      let storageInstance = this.getStorageInstance(encrypt);

      if (persist) {
        // Try persistent storage first
        if (storageInstance.contains(key)) {
          const value = storageInstance.getString(key);

          if (value) {
            try {
              const parsed = JSON.parse(value);

              // Check if it's a cache entry with TTL
              if (parsed && typeof parsed === 'object' && 'timestamp' in parsed) {
                const cacheEntry = parsed as CacheEntry<T>;

                // Check if cache entry is expired
                if (cacheEntry.ttl && Date.now() - cacheEntry.timestamp > cacheEntry.ttl) {
                  // Remove expired entry
                  storageInstance.delete(key);
                  console.debug(`Storage: Expired cache entry removed: ${key}`);
                  return defaultValue || null;
                }

                return cacheEntry.data;
              }

              return parsed;
            } catch {
              // Return as string if JSON parsing fails
              return value as T;
            }
          }
        }

        // Try number
        if (storageInstance.contains(key)) {
          const numberValue = storageInstance.getNumber(key);
          if (!isNaN(numberValue)) {
            return numberValue as T;
          }
        }

        // Try boolean
        if (storageInstance.contains(key)) {
          return storageInstance.getBoolean(key) as T;
        }
      } else {
        // Try memory storage
        const memoryValue = memoryStorage.get(key);
        if (memoryValue !== undefined) {
          // Check TTL for memory storage
          if (memoryValue && typeof memoryValue === 'object' && 'timestamp' in memoryValue) {
            const cacheEntry = memoryValue as CacheEntry<T>;

            if (cacheEntry.ttl && Date.now() - cacheEntry.timestamp > cacheEntry.ttl) {
              memoryStorage.delete(key);
              return defaultValue || null;
            }

            return cacheEntry.data;
          }

          return memoryValue as T;
        }
      }

      return defaultValue || null;
    } catch (error) {
      console.error('Failed to retrieve data:', key, error);
      return defaultValue || null;
    }
  }

  /**
   * Remove data
   */
  async remove(key: string, options: StorageOptions = {}): Promise<void> {
    try {
      const { encrypt = false, persist = true } = options;

      if (persist) {
        const storageInstance = this.getStorageInstance(encrypt);
        storageInstance.delete(key);
      } else {
        memoryStorage.delete(key);
      }

      console.debug(`Storage: Removed ${key}`);
    } catch (error) {
      console.error('Failed to remove data:', key, error);
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async contains(key: string, options: StorageOptions = {}): Promise<boolean> {
    try {
      const { encrypt = false, persist = true } = options;

      if (persist) {
        const storageInstance = this.getStorageInstance(encrypt);
        return storageInstance.contains(key);
      } else {
        return memoryStorage.has(key);
      }
    } catch (error) {
      console.error('Failed to check if key exists:', key, error);
      return false;
    }
  }

  /**
   * Clear all data
   */
  async clear(encrypt = false): Promise<void> {
    try {
      const storageInstance = this.getStorageInstance(encrypt);
      storageInstance.clearAll();
      console.debug(`Storage: Cleared ${encrypt ? 'encrypted' : 'regular'} storage`);
    } catch (error) {
      console.error('Failed to clear storage:', error);
      throw error;
    }
  }

  /**
   * Get all keys
   */
  async getAllKeys(encrypt = false): Promise<string[]> {
    try {
      const storageInstance = this.getStorageInstance(encrypt);
      return storageInstance.getAllKeys();
    } catch (error) {
      console.error('Failed to get all keys:', error);
      return [];
    }
  }

  /**
   * Get storage size in bytes
   */
  async getSize(encrypt = false): Promise<number> {
    try {
      const storageInstance = this.getStorageInstance(encrypt);
      const keys = storageInstance.getAllKeys();
      let size = 0;

      for (const key of keys) {
        const value = storageInstance.getString(key);
        if (value) {
          size += key.length + value.length;
        }
      }

      return size;
    } catch (error) {
      console.error('Failed to get storage size:', error);
      return 0;
    }
  }

  /**
   * Cleanup expired cache entries
   */
  async cleanupExpiredCache(): Promise<void> {
    try {
      const keys = await this.getAllKeys(false); // Cache storage is not encrypted

      for (const key of keys) {
        if (key.startsWith('cache_')) {
          const value = await this.get<string>(key);
          if (value) {
            try {
              const parsed = JSON.parse(value);
              if (parsed && typeof parsed === 'object' && 'timestamp' in parsed) {
                const cacheEntry = parsed as CacheEntry<any>;

                if (cacheEntry.ttl && Date.now() - cacheEntry.timestamp > cacheEntry.ttl) {
                  await this.remove(key);
                }
              }
            } catch {
              // Invalid cache entry, remove it
              await this.remove(key);
            }
          }
        }
      }

      console.debug('Storage: Cleanup expired cache entries completed');
    } catch (error) {
      console.error('Failed to cleanup expired cache:', error);
    }
  }

  /**
   * Get appropriate storage instance
   */
  private getStorageInstance(encrypt: boolean): MMKV {
    if (encrypt) {
      return secureStorage;
    } else {
      return cacheStorage;
    }
  }

  /**
   * Cache API response with TTL
   */
  async cacheApiResponse<T>(
    endpoint: string,
    data: T,
    ttl: number = 5 * 60 * 1000 // 5 minutes default
  ): Promise<void> {
    const cacheKey = `cache_api_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
    await this.set(cacheKey, data, { ttl });
  }

  /**
   * Get cached API response
   */
  async getCachedApiResponse<T>(endpoint: string): Promise<T | null> {
    const cacheKey = `cache_api_${endpoint.replace(/[^a-zA-Z0-9]/g, '_')}`;
    return this.get<T>(cacheKey);
  }

  /**
   * Cache image data
   */
  async cacheImage(url: string, data: string, ttl: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cacheKey = `cache_image_${Buffer.from(url).toString('base64').substring(0, 20)}`;
    await this.set(cacheKey, data, { ttl });
  }

  /**
   * Get cached image
   */
  async getCachedImage(url: string): Promise<string | null> {
    const cacheKey = `cache_image_${Buffer.from(url).toString('base64').substring(0, 20)}`;
    return this.get<string>(cacheKey);
  }

  /**
   * Store user preferences
   */
  async setUserPreferences(preferences: Record<string, any>): Promise<void> {
    await this.set('user_preferences', preferences, { encrypt: true });
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(): Promise<Record<string, any>> {
    return this.get('user_preferences', {}, { encrypt: true });
  }

  /**
   * Store authentication tokens
   */
  async setAuthTokens(tokens: { accessToken: string; refreshToken?: string }): Promise<void> {
    await this.set('access_token', tokens.accessToken, { encrypt: true });
    if (tokens.refreshToken) {
      await this.set('refresh_token', tokens.refreshToken, { encrypt: true });
    }
  }

  /**
   * Get authentication tokens
   */
  async getAuthTokens(): Promise<{ accessToken?: string; refreshToken?: string }> {
    const accessToken = await this.get<string>('access_token', undefined, { encrypt: true });
    const refreshToken = await this.get<string>('refresh_token', undefined, { encrypt: true });

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Clear authentication tokens
   */
  async clearAuthTokens(): Promise<void> {
    await this.remove('access_token', { encrypt: true });
    await this.remove('refresh_token', { encrypt: true });
  }

  /**
   * Store search history
   */
  async addToSearchHistory(query: string): Promise<void> {
    const history = await this.get<string[]>('search_history', []);
    const updatedHistory = [query, ...history.filter(item => item !== query)].slice(0, 50);
    await this.set('search_history', updatedHistory);
  }

  /**
   * Get search history
   */
  async getSearchHistory(): Promise<string[]> {
    return this.get<string[]>('search_history', []);
  }

  /**
   * Clear search history
   */
  async clearSearchHistory(): Promise<void> {
    await this.remove('search_history');
  }

  /**
   * Store user watchlist
   */
  async setWatchlist(productIds: string[]): Promise<void> {
    await this.set('user_watchlist', productIds, { encrypt: true });
  }

  /**
   * Get user watchlist
   */
  async getWatchlist(): Promise<string[]> {
    return this.get<string[]>('user_watchlist', [], { encrypt: true });
  }

  /**
   * Add to watchlist
   */
  async addToWatchlist(productId: string): Promise<void> {
    const watchlist = await this.getWatchlist();
    if (!watchlist.includes(productId)) {
      watchlist.push(productId);
      await this.setWatchlist(watchlist);
    }
  }

  /**
   * Remove from watchlist
   */
  async removeFromWatchlist(productId: string): Promise<void> {
    const watchlist = await this.getWatchlist();
    const updatedWatchlist = watchlist.filter(id => id !== productId);
    await this.setWatchlist(updatedWatchlist);
  }

  /**
   * Export storage data (for debugging)
   */
  async exportData(): Promise<Record<string, any>> {
    const data: Record<string, any> = {};

    try {
      // User data
      data.userPreferences = await this.getUserPreferences();
      data.searchHistory = await this.getSearchHistory();
      data.watchlist = await this.getWatchlist();

      // Storage stats
      data.cacheSize = await this.getSize(false);
      data.secureSize = await this.getSize(true);
      data.cacheKeys = await this.getAllKeys(false);
      data.secureKeys = await this.getAllKeys(true);

      return data;
    } catch (error) {
      console.error('Failed to export storage data:', error);
      return data;
    }
  }
}

// Memory storage for non-persistent data
const memoryStorage = new Map<string, any>();

// Export singleton instance
export const storageService = StorageService.getInstance();
export default storageService;