/**
 * Database schema definitions for Yabaii API
 * PostgreSQL table structures and relationships
 */

import { logger } from '@/utils/logger';

export const SCHEMA = {
  // Users table
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      preferences JSONB DEFAULT '{}',
      subscription JSONB DEFAULT '{"tier": "free", "features": ["basic_search"], "autoRenew": false}',
      language VARCHAR(10) DEFAULT 'ja',
      currency VARCHAR(3) DEFAULT 'JPY',
      timezone VARCHAR(50) DEFAULT 'Asia/Tokyo',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      last_login_at TIMESTAMP WITH TIME ZONE,
      is_active BOOLEAN DEFAULT true,
      email_verified BOOLEAN DEFAULT false
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
    CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
  `,

  // Categories table
  categories: `
    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name JSONB NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      parent_id UUID REFERENCES categories(id),
      level INTEGER NOT NULL DEFAULT 0,
      image_url VARCHAR(500),
      is_active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
    CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
    CREATE INDEX IF NOT EXISTS idx_categories_level ON categories(level);
    CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active);
  `,

  // Platforms table
  platforms: `
    CREATE TABLE IF NOT EXISTS platforms (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(50) UNIQUE NOT NULL,
      domain VARCHAR(255) NOT NULL,
      icon VARCHAR(500),
      supported_regions TEXT[] DEFAULT ARRAY['JP'],
      affiliate_program BOOLEAN DEFAULT false,
      affiliate_config JSONB DEFAULT '{}',
      rate_limit_config JSONB DEFAULT '{"requests_per_minute": 60, "requests_per_hour": 1000}',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_platforms_slug ON platforms(slug);
    CREATE INDEX IF NOT EXISTS idx_platforms_active ON platforms(is_active);
  `,

  // Products table (SPU - Standard Product Unit)
  products: `
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(500) NOT NULL,
      description TEXT,
      brand VARCHAR(200),
      category_id UUID REFERENCES categories(id),
      images JSONB DEFAULT '[]',
      specifications JSONB DEFAULT '{}',
      identifiers JSONB DEFAULT '{}',
      tags TEXT[] DEFAULT ARRAY[],
      status VARCHAR(50) DEFAULT 'active',
      popularity_score DECIMAL(3,2) DEFAULT 0.0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_name ON products USING gin(to_tsvector('english', name));
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
    CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_products_popularity ON products(popularity_score DESC);
    CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);
  `,

  // Product offers from platforms
  product_offers: `
    CREATE TABLE IF NOT EXISTS product_offers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      platform_id UUID NOT NULL REFERENCES platforms(id),
      platform_product_id VARCHAR(255) NOT NULL,
      title VARCHAR(1000) NOT NULL,
      description TEXT,
      price DECIMAL(12,2) NOT NULL,
      original_price DECIMAL(12,2),
      currency VARCHAR(3) DEFAULT 'JPY',
      availability JSONB DEFAULT '{"inStock": true, "quantity": null}',
      seller JSONB DEFAULT '{}',
      shipping JSONB DEFAULT '{"free": false, "cost": null}',
      condition VARCHAR(50) DEFAULT 'new',
      url VARCHAR(1000) NOT NULL,
      images JSONB DEFAULT '[]',
      reviews JSONB DEFAULT '{"averageRating": 0, "totalReviews": 0}',
      affiliate_info JSONB DEFAULT '{"enabled": false}',
      first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(product_id, platform_id, platform_product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_product_offers_product_id ON product_offers(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_offers_platform_id ON product_offers(platform_id);
    CREATE INDEX IF NOT EXISTS idx_product_offers_price ON product_offers(price);
    CREATE INDEX IF NOT EXISTS idx_product_offers_updated_at ON product_offers(last_updated_at);
    CREATE INDEX IF NOT EXISTS idx_product_offers_availability ON product_offers USING gin((availability->>'inStock'));
  `,

  // Price history
  price_history: `
    CREATE TABLE IF NOT EXISTS price_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      platform_id UUID NOT NULL REFERENCES platforms(id),
      price DECIMAL(12,2) NOT NULL,
      currency VARCHAR(3) DEFAULT 'JPY',
      recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      source VARCHAR(50) DEFAULT 'api'
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_product_platform ON price_history(product_id, platform_id);
    CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at ON price_history(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_price_history_price ON price_history(price);
  `,

  // User alerts
  alerts: `
    CREATE TABLE IF NOT EXISTS alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      platform_id UUID REFERENCES platforms(id),
      type VARCHAR(50) NOT NULL,
      condition JSONB DEFAULT '{}',
      channels TEXT[] DEFAULT ARRAY['push'],
      active BOOLEAN DEFAULT true,
      triggered BOOLEAN DEFAULT false,
      triggered_at TIMESTAMP WITH TIME ZONE,
      expires_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      last_notification_at TIMESTAMP WITH TIME ZONE
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_product_id ON alerts(product_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active);
    CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON alerts(triggered);
    CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
  `,

  // Deals submitted by community
  deals: `
    CREATE TABLE IF NOT EXISTS deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(500) NOT NULL,
      description TEXT,
      type VARCHAR(50) NOT NULL,
      discount JSONB DEFAULT '{}',
      products JSONB DEFAULT '[]',
      platforms TEXT[] DEFAULT ARRAY[],
      url VARCHAR(1000),
      images JSONB DEFAULT '[]',
      start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      end_date TIMESTAMP WITH TIME ZONE,
      submitted_by UUID REFERENCES users(id),
      status VARCHAR(50) DEFAULT 'pending',
      community_score JSONB DEFAULT '{"upvotes": 0, "downvotes": 0}',
      moderation_data JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
    CREATE INDEX IF NOT EXISTS idx_deals_start_date ON deals(start_date);
    CREATE INDEX IF NOT EXISTS idx_deals_end_date ON deals(end_date);
    CREATE INDEX IF NOT EXISTS idx_deals_submitted_by ON deals(submitted_by);
    CREATE INDEX IF NOT EXISTS idx_deals_type ON deals(type);
  `,

  // Reviews from platforms
  reviews: `
    CREATE TABLE IF NOT EXISTS reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      platform_id UUID NOT NULL REFERENCES platforms(id),
      platform_review_id VARCHAR(255) NOT NULL,
      title VARCHAR(500),
      content TEXT NOT NULL,
      rating INTEGER CHECK (rating >= 1 AND rating <= 5),
      reviewer JSONB DEFAULT '{}',
      verified BOOLEAN DEFAULT false,
      helpful_votes INTEGER DEFAULT 0,
      total_votes INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(product_id, platform_id, platform_review_id)
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_platform_id ON reviews(platform_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
    CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);
  `,

  // User activities for recommendations
  user_activities: `
    CREATE TABLE IF NOT EXISTS user_activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(100) NOT NULL,
      target_type VARCHAR(50),
      target_id UUID,
      metadata JSONB DEFAULT '{}',
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_activities_type ON user_activities(type);
    CREATE INDEX IF NOT EXISTS idx_user_activities_target ON user_activities(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_user_activities_timestamp ON user_activities(timestamp DESC);
  `,

  // Community votes and comments
  votes: `
    CREATE TABLE IF NOT EXISTS votes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type VARCHAR(50) NOT NULL,
      target_id UUID NOT NULL,
      value VARCHAR(10) CHECK (value IN ('up', 'down')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_votes_target ON votes(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);
    CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes(created_at);
  `,

  comments: `
    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type VARCHAR(50) NOT NULL,
      target_id UUID NOT NULL,
      content TEXT NOT NULL,
      parent_id UUID REFERENCES comments(id),
      status VARCHAR(50) DEFAULT 'active',
      moderation_status VARCHAR(50) DEFAULT 'approved',
      community_score JSONB DEFAULT '{"upvotes": 0, "downvotes": 0}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
    CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
    CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);
  `,
} as const;

/**
 * Database migration functions
 */
export const migrations = {
  // Create all tables
  createTables: async (sql: any) => {
    logger.info('Creating database tables...');

    const tableOrder = [
      'users',
      'categories',
      'platforms',
      'products',
      'product_offers',
      'price_history',
      'alerts',
      'deals',
      'reviews',
      'user_activities',
      'votes',
      'comments',
    ];

    for (const tableName of tableOrder) {
      try {
        await sql.unsafe(SCHEMA[tableName as keyof typeof SCHEMA]);
        logger.info(`✅ Created ${tableName} table`);
      } catch (error) {
        logger.error(`❌ Failed to create ${tableName} table:`, error);
        throw error;
      }
    }

    logger.info('All database tables created successfully');
  },

  // Insert default data
  seedData: async (sql: any) => {
    logger.info('Seeding default data...');

    // Insert default platforms
    const platforms = [
      {
        name: 'Amazon Japan',
        slug: 'amazon',
        domain: 'amazon.co.jp',
        icon: 'https://example.com/icons/amazon.png',
        supported_regions: ['JP'],
        affiliate_program: true,
        is_active: true,
      },
      {
        name: 'Rakuten',
        slug: 'rakuten',
        domain: 'rakuten.co.jp',
        icon: 'https://example.com/icons/rakuten.png',
        supported_regions: ['JP'],
        affiliate_program: true,
        is_active: true,
      },
      {
        name: 'Yahoo Shopping',
        slug: 'yahoo',
        domain: 'shopping.yahoo.co.jp',
        icon: 'https://example.com/icons/yahoo.png',
        supported_regions: ['JP'],
        affiliate_program: false,
        is_active: true,
      },
      {
        name: 'Kakaku.com',
        slug: 'kakaku',
        domain: 'kakaku.com',
        icon: 'https://example.com/icons/kakaku.png',
        supported_regions: ['JP'],
        affiliate_program: false,
        is_active: true,
      },
      {
        name: 'Mercari',
        slug: 'mercari',
        domain: 'mercari.com',
        icon: 'https://example.com/icons/mercari.png',
        supported_regions: ['JP'],
        affiliate_program: false,
        is_active: true,
      },
    ];

    try {
      await sql`
        INSERT INTO platforms ${sql(platforms)}
        ON CONFLICT (slug) DO NOTHING
      `;
      logger.info('✅ Default platforms seeded');
    } catch (error) {
      logger.error('❌ Failed to seed platforms:', error);
      throw error;
    }

    // Insert default categories
    const categories = [
      { name: { en: 'Electronics', ja: '電化製品' }, slug: 'electronics', level: 0 },
      { name: { en: 'Smartphones', ja: 'スマートフォン' }, slug: 'smartphones', level: 1 },
      { name: { en: 'Laptops', ja: 'ノートPC' }, slug: 'laptops', level: 1 },
      { name: { en: 'Home Appliances', ja: '家電' }, slug: 'home-appliances', level: 0 },
      { name: { en: 'Fashion', ja: 'ファッション' }, slug: 'fashion', level: 0 },
      { name: { en: 'Beauty', ja: 'ビューティー' }, slug: 'beauty', level: 0 },
      { name: { en: 'Books', ja: '本' }, slug: 'books', level: 0 },
      { name: { en: 'Food', ja: '食品' }, slug: 'food', level: 0 },
    ];

    try {
      await sql`
        INSERT INTO categories (name, slug, level) ${sql(categories)}
        ON CONFLICT (slug) DO NOTHING
      `;
      logger.info('✅ Default categories seeded');
    } catch (error) {
      logger.error('❌ Failed to seed categories:', error);
      throw error;
    }

    logger.info('Default data seeded successfully');
  },
};