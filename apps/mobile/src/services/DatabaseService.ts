/**
 * Database Service
 * Handles SQLite database for offline price history and user data
 */

import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { storageService } from './StorageService';

export interface ProductRecord {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  image?: string;
  platforms: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceRecord {
  id: string;
  productId: string;
  platform: string;
  price: number;
  currency: string;
  seller?: string;
  condition?: string;
  availability: string;
  recordedAt: string;
  syncedAt?: string;
}

export interface AlertRecord {
  id: string;
  userId?: string;
  productId: string;
  platform?: string;
  type: string;
  threshold?: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SearchRecord {
  id: string;
  userId?: string;
  query: string;
  filters?: string;
  resultCount: number;
  timestamp: string;
}

export class DatabaseService {
  private static instance: DatabaseService;
  private db: SQLite.SQLiteDatabase | null = null;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  /**
   * Initialize database
   */
  async initialize(): Promise<void> {
    try {
      // Open database
      this.db = await SQLite.openDatabaseAsync('yabaii.db');

      // Enable foreign keys
      await this.db.execAsync('PRAGMA foreign_keys = ON;');

      // Create tables
      await this.createTables();

      // Create indexes
      await this.createIndexes();

      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const tables = [
      // Products table
      `CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        brand TEXT,
        category TEXT,
        image TEXT,
        platforms TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );`,

      // Price history table
      `CREATE TABLE IF NOT EXISTS price_history (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        price REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'JPY',
        seller TEXT,
        condition TEXT,
        availability TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        synced_at TEXT,
        FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      );`,

      // Alerts table
      `CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        product_id TEXT NOT NULL,
        platform TEXT,
        type TEXT NOT NULL,
        threshold REAL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      );`,

      // Search history table
      `CREATE TABLE IF NOT EXISTS search_history (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        query TEXT NOT NULL,
        filters TEXT,
        result_count INTEGER NOT NULL,
        timestamp TEXT NOT NULL
      );`,

      // Watchlist table
      `CREATE TABLE IF NOT EXISTS watchlist (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        product_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      );`,

      // Sync status table
      `CREATE TABLE IF NOT EXISTS sync_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        last_sync TEXT NOT NULL,
        sync_count INTEGER NOT NULL DEFAULT 0
      );`,
    ];

    for (const table of tables) {
      await this.db.execAsync(table);
    }
  }

  /**
   * Create database indexes
   */
  private async createIndexes(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON price_history(product_id);',
      'CREATE INDEX IF NOT EXISTS idx_price_history_platform ON price_history(platform);',
      'CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at ON price_history(recorded_at);',
      'CREATE INDEX IF NOT EXISTS idx_alerts_product_id ON alerts(product_id);',
      'CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active);',
      'CREATE INDEX IF NOT EXISTS idx_search_history_timestamp ON search_history(timestamp);',
      'CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);',
    ];

    for (const index of indexes) {
      await this.db.execAsync(index);
    }
  }

  /**
   * Add or update product
   */
  async upsertProduct(product: Omit<ProductRecord, 'createdAt' | 'updatedAt'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();

    await this.db.runAsync(
      `INSERT OR REPLACE INTO products (
        id, name, brand, category, image, platforms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id,
        product.name,
        product.brand,
        product.category,
        product.image,
        product.platforms,
        now,
        now,
      ]
    );
  }

  /**
   * Get product by ID
   */
  async getProduct(id: string): Promise<ProductRecord | null> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.getFirstAsync<{
      id: string;
      name: string;
      brand: string;
      category: string;
      image: string;
      platforms: string;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT * FROM products WHERE id = ?',
      [id]
    );

    if (result) {
      return {
        id: result.id,
        name: result.name,
        brand: result.brand,
        category: result.category,
        image: result.image,
        platforms: result.platforms,
        createdAt: result.created_at,
        updatedAt: result.updated_at,
      };
    }

    return null;
  }

  /**
   * Add price record
   */
  async addPrice(price: Omit<PriceRecord, 'id' | 'recordedAt'>): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const id = this.generateId();
    const recordedAt = new Date().toISOString();

    await this.db.runAsync(
      `INSERT INTO price_history (
        id, product_id, platform, price, currency, seller, condition, availability, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        price.productId,
        price.platform,
        price.price,
        price.currency,
        price.seller,
        price.condition,
        price.availability,
        recordedAt,
      ]
    );

    return id;
  }

  /**
   * Get price history for a product
   */
  async getPriceHistory(
    productId: string,
    platform?: string,
    days: number = 90
  ): Promise<PriceRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffString = cutoffDate.toISOString();

    let query = `
      SELECT * FROM price_history
      WHERE product_id = ? AND recorded_at >= ?
    `;
    const params: any[] = [productId, cutoffString];

    if (platform) {
      query += ' AND platform = ?';
      params.push(platform);
    }

    query += ' ORDER BY recorded_at DESC LIMIT 100';

    const results = await this.db.getAllAsync<{
      id: string;
      product_id: string;
      platform: string;
      price: number;
      currency: string;
      seller: string;
      condition: string;
      availability: string;
      recorded_at: string;
      synced_at: string;
    }>(query, params);

    return results.map(row => ({
      id: row.id,
      productId: row.product_id,
      platform: row.platform,
      price: row.price,
      currency: row.currency,
      seller: row.seller,
      condition: row.condition,
      availability: row.availability,
      recordedAt: row.recorded_at,
      syncedAt: row.synced_at,
    }));
  }

  /**
   * Get latest price for a product
   */
  async getLatestPrice(productId: string, platform?: string): Promise<PriceRecord | null> {
    if (!this.db) throw new Error('Database not initialized');

    let query = `
      SELECT * FROM price_history
      WHERE product_id = ?
    `;
    const params: any[] = [productId];

    if (platform) {
      query += ' AND platform = ?';
      params.push(platform);
    }

    query += ' ORDER BY recorded_at DESC LIMIT 1';

    const result = await this.db.getFirstAsync<{
      id: string;
      product_id: string;
      platform: string;
      price: number;
      currency: string;
      seller: string;
      condition: string;
      availability: string;
      recorded_at: string;
      synced_at: string;
    }>(query, params);

    if (result) {
      return {
        id: result.id,
        productId: result.product_id,
        platform: result.platform,
        price: result.price,
        currency: result.currency,
        seller: result.seller,
        condition: result.condition,
        availability: result.availability,
        recordedAt: result.recorded_at,
        syncedAt: result.synced_at,
      };
    }

    return null;
  }

  /**
   * Add alert
   */
  async addAlert(alert: Omit<AlertRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const id = this.generateId();
    const now = new Date().toISOString();

    await this.db.runAsync(
      `INSERT INTO alerts (
        id, user_id, product_id, platform, type, threshold, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        alert.userId,
        alert.productId,
        alert.platform,
        alert.type,
        alert.threshold,
        alert.active ? 1 : 0,
        now,
        now,
      ]
    );

    return id;
  }

  /**
   * Get user alerts
   */
  async getAlerts(userId: string, activeOnly: boolean = true): Promise<AlertRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    let query = 'SELECT * FROM alerts WHERE user_id = ?';
    const params: any[] = [userId];

    if (activeOnly) {
      query += ' AND active = 1';
    }

    query += ' ORDER BY updated_at DESC';

    const results = await this.db.getAllAsync<{
      id: string;
      user_id: string;
      product_id: string;
      platform: string;
      type: string;
      threshold: number;
      active: number;
      created_at: string;
      updated_at: string;
    }>(query, params);

    return results.map(row => ({
      id: row.id,
      userId: row.user_id,
      productId: row.product_id,
      platform: row.platform,
      type: row.type,
      threshold: row.threshold,
      active: Boolean(row.active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update alert status
   */
  async updateAlertStatus(id: string, active: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();

    await this.db.runAsync(
      'UPDATE alerts SET active = ?, updated_at = ? WHERE id = ?',
      [active ? 1 : 0, now, id]
    );
  }

  /**
   * Delete alert
   */
  async deleteAlert(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.runAsync('DELETE FROM alerts WHERE id = ?', [id]);
  }

  /**
   * Add search record
   */
  async addSearchRecord(search: Omit<SearchRecord, 'id' | 'timestamp'>): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');

    const id = this.generateId();
    const timestamp = new Date().toISOString();

    await this.db.runAsync(
      `INSERT INTO search_history (id, user_id, query, filters, result_count, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        search.userId,
        search.query,
        search.filters,
        search.resultCount,
        timestamp,
      ]
    );

    return id;
  }

  /**
   * Get search history
   */
  async getSearchHistory(userId?: string, limit: number = 50): Promise<SearchRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    let query = 'SELECT * FROM search_history';
    const params: any[] = [];

    if (userId) {
      query += ' WHERE user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const results = await this.db.getAllAsync<{
      id: string;
      user_id: string;
      query: string;
      filters: string;
      result_count: number;
      timestamp: string;
    }>(query, params);

    return results.map(row => ({
      id: row.id,
      userId: row.user_id,
      query: row.query,
      filters: row.filters,
      resultCount: row.result_count,
      timestamp: row.timestamp,
    }));
  }

  /**
   * Clear search history
   */
  async clearSearchHistory(userId?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    if (userId) {
      await this.db.runAsync('DELETE FROM search_history WHERE user_id = ?', [userId]);
    } else {
      await this.db.runAsync('DELETE FROM search_history');
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    products: number;
    priceRecords: number;
    alerts: number;
    searchRecords: number;
    databaseSize: number;
  }> {
    if (!this.db) throw new Error('Database not initialized');

    const [products, priceRecords, alerts, searchRecords] = await Promise.all([
      this.db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM products'),
      this.db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM price_history'),
      this.db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM alerts'),
      this.db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM search_history'),
    ]);

    return {
      products: products?.count || 0,
      priceRecords: priceRecords?.count || 0,
      alerts: alerts?.count || 0,
      searchRecords: searchRecords?.count || 0,
      databaseSize: await this.getDatabaseSize(),
    };
  }

  /**
   * Get database size (approximate)
   */
  private async getDatabaseSize(): Promise<number> {
    try {
      // This is an approximation - actual size would require platform-specific APIs
      const stats = await this.getStats();
      return (stats.products + stats.priceRecords + stats.alerts + stats.searchRecords) * 1000; // Rough estimate
    } catch {
      return 0;
    }
  }

  /**
   * Clean old data
   */
  async cleanupOldData(daysToKeep: number = 90): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffString = cutoffDate.toISOString();

    // Clean old price history
    await this.db.runAsync(
      'DELETE FROM price_history WHERE recorded_at < ?',
      [cutoffString]
    );

    // Clean old search history
    await this.db.runAsync(
      'DELETE FROM search_history WHERE timestamp < ?',
      [cutoffString]
    );

    console.log(`Database cleanup completed - removed data older than ${daysToKeep} days`);
  }

  /**
   * Close database
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      console.log('Database closed');
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Export data for debugging
   */
  async exportData(): Promise<{
    stats: any;
    recentProducts: ProductRecord[];
    recentPrices: PriceRecord[];
  }> {
    const stats = await this.getStats();

    const [recentProducts, recentPrices] = await Promise.all([
      this.db?.getAllAsync('SELECT * FROM products ORDER BY updated_at DESC LIMIT 10') || [],
      this.db?.getAllAsync('SELECT * FROM price_history ORDER BY recorded_at DESC LIMIT 20') || [],
    ]);

    return {
      stats,
      recentProducts: recentProducts.map((row: any) => ({
        id: row.id,
        name: row.name,
        brand: row.brand,
        category: row.category,
        image: row.image,
        platforms: row.platforms,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      recentPrices: recentPrices.map((row: any) => ({
        id: row.id,
        productId: row.product_id,
        platform: row.platform,
        price: row.price,
        currency: row.currency,
        seller: row.seller,
        condition: row.condition,
        availability: row.availability,
        recordedAt: row.recorded_at,
        syncedAt: row.synced_at,
      })),
    };
  }
}

// Export singleton instance
export const databaseService = DatabaseService.getInstance();
export default databaseService;