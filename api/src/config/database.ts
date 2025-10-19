/**
 * Database configuration and connection management
 * Handles PostgreSQL database connection for Yabaii API
 */

import postgres from 'postgres';
import { logger } from '@/utils/logger';

// Database configuration
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'yabaii',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // max connections
  idle_timeout: 20,
  connect_timeout: 10,
};

// Connection singleton
let sql: postgres.Sql | null = null;

/**
 * Initialize database connection
 */
export function initDatabase(): postgres.Sql {
  if (sql) {
    return sql;
  }

  try {
    const connectionString = process.env.DATABASE_URL;

    if (connectionString) {
      // Use connection string if provided (production)
      sql = postgres(connectionString, {
        max: config.max,
        idle_timeout: config.idle_timeout,
        connect_timeout: config.connect_timeout,
        ssl: config.ssl,
        onnotice: (notice) => {
          logger.info('Database notice:', notice);
        },
        debug: process.env.NODE_ENV === 'development',
      });
    } else {
      // Use individual config parameters (development)
      sql = postgres({
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        ssl: config.ssl,
        max: config.max,
        idle_timeout: config.idle_timeout,
        connect_timeout: config.connect_timeout,
        onnotice: (notice) => {
          logger.info('Database notice:', notice);
        },
        debug: process.env.NODE_ENV === 'development',
      });
    }

    logger.info('Database connection initialized successfully');
    return sql;
  } catch (error) {
    logger.error('Failed to initialize database connection:', error);
    throw new Error('Database connection failed');
  }
}

/**
 * Get database connection instance
 */
export function getDatabase(): postgres.Sql {
  if (!sql) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return sql;
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const db = getDatabase();
    const result = await db`SELECT 1 as test`;
    return result.length > 0 && result[0]?.test === 1;
  } catch (error) {
    logger.error('Database connection test failed:', error);
    return false;
  }
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    logger.info('Database connection closed');
  }
}

/**
 * Database health check
 */
export async function healthCheck(): Promise<{
  status: 'healthy' | 'unhealthy';
  responseTime?: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    const db = getDatabase();
    await db`SELECT 1`;
    const responseTime = Date.now() - startTime;

    return {
      status: 'healthy',
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      status: 'unhealthy',
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get database pool statistics
 */
export async function getPoolStats(): Promise<{
  totalConnections: number;
  idleConnections: number;
  waitingConnections: number;
}> {
  try {
    const db = getDatabase();
    // Note: postgres.js doesn't expose detailed pool stats directly
    // This is a simplified implementation
    return {
      totalConnections: 1,
      idleConnections: 1,
      waitingConnections: 0,
    };
  } catch (error) {
    logger.error('Failed to get pool stats:', error);
    return {
      totalConnections: 0,
      idleConnections: 0,
      waitingConnections: 0,
    };
  }
}

export default {
  initDatabase,
  getDatabase,
  testConnection,
  closeDatabase,
  healthCheck,
  getPoolStats,
};