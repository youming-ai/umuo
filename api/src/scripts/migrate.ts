#!/usr/bin/env bun

/**
 * Database migration script
 * Creates tables and seeds initial data for Yabaii API
 */

import { initDatabase, getDatabase, closeDatabase } from '@/config/database';
import { migrations } from '@/config/schema';
import { logger } from '@/utils/logger';

async function runMigrations() {
  logger.info('🚀 Starting database migration...');

  try {
    // Initialize database connection
    const db = initDatabase();
    logger.info('✅ Database connection established');

    // Test connection
    const isConnected = await db`SELECT 1 as test`;
    if (isConnected.length === 0) {
      throw new Error('Database connection test failed');
    }
    logger.info('✅ Database connection test passed');

    // Create tables
    await migrations.createTables(db);
    logger.info('✅ All tables created successfully');

    // Seed default data
    await migrations.seedData(db);
    logger.info('✅ Default data seeded successfully');

    logger.info('🎉 Database migration completed successfully');
  } catch (error) {
    logger.error('❌ Database migration failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

// Run migrations if this script is executed directly
if (import.meta.main) {
  runMigrations();
}

export { runMigrations };