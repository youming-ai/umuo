#!/usr/bin/env bun

/**
 * Database seeding script
 * Populates the database with sample data for development and testing
 */

import { initDatabase, getDatabase, closeDatabase } from '@/config/database';
import { logger } from '@/utils/logger';
import bcrypt from 'bcryptjs';

async function seedTestData() {
  logger.info('🌱 Starting database seeding...');

  try {
    const db = initDatabase();
    logger.info('✅ Database connection established');

    // Seed test users
    await seedUsers(db);

    // Seed test categories
    await seedAdditionalCategories(db);

    // Seed test products
    await seedTestProducts(db);

    logger.info('🎉 Database seeding completed successfully');
  } catch (error) {
    logger.error('❌ Database seeding failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

async function seedUsers(db: any) {
  logger.info('Seeding test users...');

  const testUsers = [
    {
      email: 'test@example.com',
      password_hash: await bcrypt.hash('password123', 12),
      preferences: {
        language: 'ja',
        currency: 'JPY',
        notifications: {
          priceAlerts: true,
          stockAlerts: true,
          dealAlerts: false,
        },
        categories: ['electronics', 'smartphones'],
        brands: ['Apple', 'Sony'],
        priceRange: { min: 1000, max: 100000 },
      },
      subscription: {
        tier: 'free',
        features: ['basic_search', 'price_alerts'],
        autoRenew: false,
      },
      email_verified: true,
    },
    {
      email: 'premium@example.com',
      password_hash: await bcrypt.hash('password123', 12),
      preferences: {
        language: 'ja',
        currency: 'JPY',
        notifications: {
          priceAlerts: true,
          stockAlerts: true,
          dealAlerts: true,
        },
        categories: ['electronics', 'fashion', 'beauty'],
        brands: ['Apple', 'Uniqlo', 'Shiseido'],
        priceRange: { min: 500, max: 200000 },
      },
      subscription: {
        tier: 'premium',
        features: ['basic_search', 'price_alerts', 'ai_recommendations', 'export_data'],
        autoRenew: true,
      },
      email_verified: true,
    },
  ];

  try {
    await db`
      INSERT INTO users ${db(testUsers)}
      ON CONFLICT (email) DO NOTHING
    `;
    logger.info('✅ Test users seeded');
  } catch (error) {
    logger.error('❌ Failed to seed users:', error);
    throw error;
  }
}

async function seedAdditionalCategories(db: any) {
  logger.info('Seeding additional categories...');

  const categories = [
    { name: { en: 'Computers', ja: 'パソコン' }, slug: 'computers', level: 1, parent_id: null },
    { name: { en: 'Cameras', ja: 'カメラ' }, slug: 'cameras', level: 1, parent_id: null },
    { name: { en: 'Audio', ja: 'オーディオ' }, slug: 'audio', level: 1, parent_id: null },
    { name: { en: 'Gaming', ja: 'ゲーム' }, slug: 'gaming', level: 0, parent_id: null },
    { name: { en: 'Health', ja: '健康' }, slug: 'health', level: 0, parent_id: null },
  ];

  try {
    await db`
      INSERT INTO categories ${db(categories)}
      ON CONFLICT (slug) DO NOTHING
    `;
    logger.info('✅ Additional categories seeded');
  } catch (error) {
    logger.error('❌ Failed to seed categories:', error);
    throw error;
  }
}

async function seedTestProducts(db: any) {
  logger.info('Seeding test products...');

  // First, get category IDs
  const categories = await db`SELECT id, slug FROM categories WHERE slug IN ('smartphones', 'laptops', 'computers')`;
  const categoryMap = new Map(categories.map((cat: any) => [cat.slug, cat.id]));

  // Get platform IDs
  const platforms = await db`SELECT id, slug FROM platforms WHERE slug IN ('amazon', 'rakuten', 'yahoo')`;
  const platformMap = new Map(platforms.map((plat: any) => [plat.slug, plat.id]));

  const testProducts = [
    {
      name: 'iPhone 15 Pro',
      description: 'Latest Apple smartphone with A17 Pro chip',
      brand: 'Apple',
      category_id: categoryMap.get('smartphones'),
      images: [
        { url: 'https://example.com/iphone15pro-1.jpg', alt: { en: 'iPhone 15 Pro front view', ja: 'iPhone 15 Pro 正面' }, width: 800, height: 600, order: 1 },
      ],
      specifications: {
        display: '6.1-inch Super Retina XDR',
        processor: 'A17 Pro chip',
        storage: '128GB',
        camera: '48MP main camera',
        battery: 'Up to 23 hours video playback',
      },
      identifiers: {
        jan: '4905524038230',
        upc: '194253672906',
        model: 'A3108',
      },
      tags: ['smartphone', 'apple', '5g', 'pro'],
      status: 'active',
      popularity_score: 0.95,
    },
    {
      name: 'MacBook Air M2',
      description: 'Ultra-thin laptop with M2 chip',
      brand: 'Apple',
      category_id: categoryMap.get('laptops'),
      images: [
        { url: 'https://example.com/macbook-air-m2-1.jpg', alt: { en: 'MacBook Air M2', ja: 'MacBook Air M2' }, width: 800, height: 600, order: 1 },
      ],
      specifications: {
        display: '13.6-inch Liquid Retina',
        processor: 'Apple M2 chip',
        memory: '8GB unified memory',
        storage: '256GB SSD',
        battery: 'Up to 18 hours',
      },
      identifiers: {
        jan: '4562215330216',
        model: 'MLY33',
      },
      tags: ['laptop', 'apple', 'm2', 'ultrabook'],
      status: 'active',
      popularity_score: 0.88,
    },
    {
      name: 'Sony WH-1000XM5',
      description: 'Industry-leading noise canceling headphones',
      brand: 'Sony',
      category_id: null, // Will be set to audio category later
      images: [
        { url: 'https://example.com/sony-wh1000xm5-1.jpg', alt: { en: 'Sony WH-1000XM5 headphones', ja: 'Sony WH-1000XM5 ヘッドホン' }, width: 800, height: 600, order: 1 },
      ],
      specifications: {
        type: 'Over-ear wireless headphones',
        driver: '30mm',
        frequency: '4Hz - 40,000Hz',
        battery: 'Up to 30 hours',
        features: ['Active Noise Canceling', 'Speak-to-Chat', 'Multipoint connection'],
      },
      identifiers: {
        jan: '4987020678125',
        model: 'WH-1000XM5',
      },
      tags: ['headphones', 'sony', 'noise-canceling', 'wireless'],
      status: 'active',
      popularity_score: 0.82,
    },
  ];

  try {
    // Insert products
    const insertedProducts = await db`
      INSERT INTO products ${db(testProducts)}
      RETURNING id, name
    `;
    logger.info('✅ Test products seeded');

    // Seed product offers for each product
    for (const product of insertedProducts) {
      await seedProductOffers(db, product.id, platformMap);
    }

    logger.info('✅ Product offers seeded');
  } catch (error) {
    logger.error('❌ Failed to seed products:', error);
    throw error;
  }
}

async function seedProductOffers(db: any, productId: string, platformMap: Map<string, string>) {
  const offers = [
    {
      product_id: productId,
      platform_id: platformMap.get('amazon'),
      platform_product_id: `AMZ_${productId.substring(0, 8)}`,
      title: 'Amazon Special Deal',
      price: Math.floor(Math.random() * 50000) + 10000, // Random price between 10,000-60,000
      currency: 'JPY',
      availability: { inStock: true, quantity: Math.floor(Math.random() * 100) + 1 },
      seller: { name: 'Amazon Japan', rating: 4.8, reviewCount: 15234 },
      shipping: { free: true, cost: 0, estimatedDays: 2 },
      condition: 'new',
      url: `https://amazon.co.jp/dp/${productId.substring(0, 8)}`,
      reviews: { averageRating: 4.5, totalReviews: 234 },
      affiliate_info: { enabled: true, trackingCode: 'yabaii-20', commission: 2.5 },
    },
    {
      product_id: productId,
      platform_id: platformMap.get('rakuten'),
      platform_product_id: `RAK_${productId.substring(0, 8)}`,
      title: 'Rakuten Ichiba',
      price: Math.floor(Math.random() * 50000) + 10000,
      currency: 'JPY',
      availability: { inStock: true, quantity: Math.floor(Math.random() * 50) + 1 },
      seller: { name: 'Rakuten Store', rating: 4.6, reviewCount: 8976 },
      shipping: { free: false, cost: 550, estimatedDays: 3 },
      condition: 'new',
      url: `https://item.rakuten.co.jp/item/${productId.substring(0, 8)}`,
      reviews: { averageRating: 4.3, totalReviews: 156 },
      affiliate_info: { enabled: true, trackingCode: 'rakuten_yabaii', commission: 2.0 },
    },
    {
      product_id: productId,
      platform_id: platformMap.get('yahoo'),
      platform_product_id: `YAH_${productId.substring(0, 8)}`,
      title: 'Yahoo Shopping',
      price: Math.floor(Math.random() * 50000) + 10000,
      currency: 'JPY',
      availability: { inStock: true, quantity: Math.floor(Math.random() * 75) + 1 },
      seller: { name: 'Yahoo Store', rating: 4.4, reviewCount: 5432 },
      shipping: { free: true, cost: 0, estimatedDays: 4 },
      condition: 'new',
      url: `https://shopping.yahoo.co.jp/item/${productId.substring(0, 8)}`,
      reviews: { averageRating: 4.2, totalReviews: 89 },
      affiliate_info: { enabled: false },
    },
  ].filter(offer => offer.platform_id); // Filter out offers for platforms that don't exist

  if (offers.length > 0) {
    await db`INSERT INTO product_offers ${db(offers)}`;
  }
}

// Run seeding if this script is executed directly
if (import.meta.main) {
  seedTestData();
}

export { seedTestData };