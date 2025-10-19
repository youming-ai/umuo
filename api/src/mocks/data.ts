/**
 * Mock Data for Japanese E-commerce Platforms
 * 模拟日本电商平台的真实商品数据
 */

import {
  MockProduct,
  MockCategory,
  MockBrand,
  MockPriceHistory,
  MockDeal,
  PlatformProduct,
  ProductImage,
  PriceInfo,
  RatingInfo,
  AvailabilityStatus
} from './types';

// Mock Categories
export const mockCategories: MockCategory[] = [
  { id: 'electronics', name: '電化製品', level: 1 },
  { id: 'smartphones', name: 'スマートフォン', parentId: 'electronics', level: 2 },
  { id: 'laptops', name: 'ノートPC', parentId: 'electronics', level: 2 },
  { id: 'cameras', name: 'カメラ', parentId: 'electronics', level: 2 },
  { id: 'home-appliances', name: '家電', level: 1 },
  { id: 'kitchen', name: 'キッチン', parentId: 'home-appliances', level: 2 },
  { id: 'beauty', name: '美容・化粧品', level: 1 },
  { id: 'skincare', name: 'スキンケア', parentId: 'beauty', level: 2 },
  { id: 'makeup', name: 'メイクアップ', parentId: 'beauty', level: 2 },
];

// Mock Brands
export const mockBrands: MockBrand[] = [
  { id: 'apple', name: 'Apple', website: 'https://www.apple.com' },
  { id: 'sony', name: 'Sony', website: 'https://www.sony.co.jp' },
  { id: 'panasonic', name: 'Panasonic', website: 'https://panasonic.jp' },
  { id: 'shiseido', name: 'Shiseido', website: 'https://www.shiseido.co.jp' },
  { id: 'kao', name: 'Kao', website: 'https://www.kao.com' },
  { id: 'canon', name: 'Canon', website: 'https://canon.jp' },
  { id: 'nintendo', name: 'Nintendo', website: 'https://www.nintendo.co.jp' },
];

// Helper functions
const generateProductImages = (productName: string): ProductImage[] => [
  {
    url: `https://picsum.photos/seed/${productName}-main/400/400`,
    width: 400,
    height: 400,
    alt: `${productName} - 主画像`
  },
  {
    url: `https://picsum.photos/seed/${productName}-thumb/200/200`,
    width: 200,
    height: 200,
    alt: `${productName} - サムネイル`
  }
];

const generatePriceInfo = (basePrice: number): PriceInfo => ({
  amount: basePrice,
  currency: 'JPY',
  formattedPrice: `¥${basePrice.toLocaleString()}`
});

const generateRatingInfo = (): RatingInfo => ({
  score: Math.random() * 2 + 3, // 3-5星
  count: Math.floor(Math.random() * 1000) + 10,
  maxScore: 5
});

const generateAvailability = (): AvailabilityStatus => {
  const rand = Math.random();
  if (rand < 0.7) {
    return {
      status: 'in_stock',
      message: '在庫あり',
      quantity: Math.floor(Math.random() * 100) + 1
    };
  } else if (rand < 0.9) {
    return {
      status: 'limited_stock',
      message: '残りわずか',
      quantity: Math.floor(Math.random() * 5) + 1
    };
  } else {
    return {
      status: 'out_of_stock',
      message: '在庫切れ'
    };
  }
};

// Mock Products
export const mockProducts: MockProduct[] = [
  {
    id: 'prod-001',
    spuId: 'iPhone-15-Pro-128GB-Black',
    title: 'iPhone 15 Pro 128GB ブラック',
    description: 'A17 Proチップを搭載した最新のiPhone。チタニウムデザインと強力なカメラシステム。',
    category: 'smartphones',
    brand: 'apple',
    images: generateProductImages('iPhone-15-Pro-Black'),
    platforms: [
      {
        platform: 'amazon',
        platformProductId: 'B0CHX2YQ23',
        url: 'https://www.amazon.co.jp/dp/B0CHX2YQ23?tag=yabaii-22',
        price: generatePriceInfo(149800),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          asin: 'B0CHX2YQ23',
          primeEligible: true,
          deliveryOptions: ['翌日配送', '当日配送']
        }
      },
      {
        platform: 'rakuten',
        platformProductId: '10001478',
        url: 'https://item.rakuten.co.jp/shop/iphone15pro/10001478/',
        price: generatePriceInfo(148900),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          shopName: '楽天モバイル',
          points: 1489,
          shippingCost: 0
        }
      },
      {
        platform: 'yahoo',
        platformProductId: 'zjyy_001',
        url: 'https://store.shopping.yahoo.co.jp/zjyy/iphone15pro.html',
        price: generatePriceInfo(147800),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          storeName: 'Yahoo!ストア',
          paymentOptions: ['クレジットカード', '銀行振込', 'コンビニ払い']
        }
      }
    ],
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-10-16T12:30:00Z'
  },
  {
    id: 'prod-002',
    spuId: 'Sony-WH-1000XM5-Black',
    title: 'Sony WH-1000XM5 ワイヤレスノイズキャンセリングヘッドホン ブラック',
    description: '業界最高レベルのノイズキャンセリングと高品質なサウンドを提供するフラグシップモデル。',
    category: 'electronics',
    brand: 'sony',
    images: generateProductImages('Sony-WH-1000XM5'),
    platforms: [
      {
        platform: 'amazon',
        platformProductId: 'B0BQKJW2L1',
        url: 'https://www.amazon.co.jp/dp/B0BQKJW2L1?tag=yabaii-22',
        price: generatePriceInfo(42900),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          asin: 'B0BQKJW2L1',
          primeEligible: true,
          color: 'ブラック'
        }
      },
      {
        platform: 'rakuten',
        platformProductId: 'sony-wh1000xm5-bk',
        url: 'https://item.rakuten.co.jp/sonystore/sony-wh1000xm5-bk/',
        price: generatePriceInfo(41800),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          shopName: 'ソニーストア',
          warranty: '2年保証',
          accessories: ['キャリングケース', 'オーディオケーブル']
        }
      }
    ],
    createdAt: '2024-02-01T09:00:00Z',
    updatedAt: '2024-10-15T15:20:00Z'
  },
  {
    id: 'prod-003',
    spuId: 'Nintendo-Switch-OLED-White',
    title: 'Nintendo Switch (OLEDモデル) ホワイト',
    description: '7インチOLEDスクリーンを搭載したNintendo Switch。より鮮やかな色彩とコントラスト。',
    category: 'electronics',
    brand: 'nintendo',
    images: generateProductImages('Nintendo-Switch-OLED'),
    platforms: [
      {
        platform: 'amazon',
        platformProductId: 'B098RTJHY2',
        url: 'https://www.amazon.co.jp/dp/B098RTJHY2?tag=yabaii-22',
        price: generatePriceInfo(37980),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          asin: 'B098RTJHY2',
          primeEligible: true,
          color: 'ホワイト'
        }
      },
      {
        platform: 'yahoo',
        platformProductId: 'nintendo-switch-oled',
        url: 'https://store.shopping.yahoo.co.jp/chara-ani/nintendo-switch-oled.html',
        price: generatePriceInfo(36800),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          storeName: 'キャラアニ',
          bonusItems: ['クリアケース', '画面保護フィルム']
        }
      }
    ],
    createdAt: '2024-03-10T14:00:00Z',
    updatedAt: '2024-10-14T11:45:00Z'
  },
  {
    id: 'prod-004',
    spuId: 'Shiseido-Ultimune-Power-50ml',
    title: 'SHISEIDO アルティムーン パワifying セラム 50ml',
    description: '肌の内在パワーを引き出し、ハリと弾力のある肌へ導く化粧水。',
    category: 'skincare',
    brand: 'shiseido',
    images: generateProductImages('Shiseido-Ultimune'),
    platforms: [
      {
        platform: 'amazon',
        platformProductId: 'B09Q8XK7L2',
        url: 'https://www.amazon.co.jp/dp/B09Q8XK7L2?tag=yabaii-22',
        price: generatePriceInfo(13200),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          asin: 'B09Q8XK7L2',
          primeEligible: true,
          size: '50ml',
          skinType: 'すべての肌質'
        }
      },
      {
        platform: 'rakuten',
        platformProductId: 'shiseido-ultimune-50ml',
        url: 'https://item.rakuten.co.jp/shiseido/ultimune-50ml/',
        price: generatePriceInfo(11880),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          shopName: '資生堂公式ストア',
          points: 237,
          samples: ['サンプル化粧品3点']
        }
      }
    ],
    createdAt: '2024-04-05T16:00:00Z',
    updatedAt: '2024-10-16T09:30:00Z'
  },
  {
    id: 'prod-005',
    spuId: 'Canon-EOS-R6-Mark-II',
    title: 'Canon EOS R6 Mark II ミラーレスカメラ ボディ',
    description: '約2420万画素のCMOSセンサーを搭載した高性能ミラーレスカメラ。',
    category: 'cameras',
    brand: 'canon',
    images: generateProductImages('Canon-EOS-R6-M2'),
    platforms: [
      {
        platform: 'amazon',
        platformProductId: 'B0BGYJQJ4M',
        url: 'https://www.amazon.co.jp/dp/B0BGYJQJ4M?tag=yabaii-22',
        price: generatePriceInfo(458000),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          asin: 'B0BGYJQJ4M',
          primeEligible: false,
          warranty: '1年間保証'
        }
      },
      {
        platform: 'rakuten',
        platformProductId: 'canon-eos-r6m2-body',
        url: 'https://item.rakuten.co.jp/canon-store/eos-r6m2-body/',
        price: generatePriceInfo(439800),
        availability: generateAvailability(),
        rating: generateRatingInfo(),
        platformSpecific: {
          shopName: 'キヤノンストア',
          points: 8796,
          bonus: '32GB SDカード付き'
        }
      }
    ],
    createdAt: '2024-05-12T13:00:00Z',
    updatedAt: '2024-10-15T14:15:00Z'
  }
];

// Mock Price History
export const generatePriceHistory = (): MockPriceHistory[] => {
  const history: MockPriceHistory[] = [];

  mockProducts.forEach(product => {
    product.platforms.forEach(platform => {
      const platformHistory: MockPriceHistory = {
        productId: product.id,
        platformProductId: platform.platformProductId,
        platform: platform.platform,
        history: []
      };

      // 過去90日間の価格履歴を生成
      for (let i = 90; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        // 基本価格からの変動（±10%）
        const basePrice = platform.price.amount;
        const variation = (Math.random() - 0.5) * 0.2; // ±10%
        const price = Math.round(basePrice * (1 + variation));

        platformHistory.history.push({
          price,
          currency: 'JPY',
          date: date.toISOString().split('T')[0],
          source: 'api'
        });
      }

      history.push(platformHistory);
    });
  });

  return history;
};

// Mock Deals
export const mockDeals: MockDeal[] = [
  {
    id: 'deal-001',
    productId: 'prod-001',
    platform: 'amazon',
    title: 'iPhone 15 Pro タイムセール',
    description: '期間限定5%OFF！さらにポイント5倍',
    originalPrice: 149800,
    dealPrice: 142310,
    discountPercentage: 5,
    startDate: '2024-10-15T00:00:00Z',
    endDate: '2024-10-22T23:59:59Z',
    url: 'https://www.amazon.co.jp/dp/B0CHX2YQ23?tag=yabaii-22',
    images: generateProductImages('iPhone-15-Pro-Deal'),
    voting: {
      worthIt: 156,
      notWorthIt: 23,
      total: 179
    },
    createdAt: '2024-10-15T10:00:00Z'
  },
  {
    id: 'deal-002',
    productId: 'prod-002',
    platform: 'rakuten',
    title: 'Sony ヘッドホン 楽天スーパーセール',
    description: '最大15%OFF + 楽天ポイント10倍',
    originalPrice: 42900,
    dealPrice: 36465,
    discountPercentage: 15,
    startDate: '2024-10-14T00:00:00Z',
    endDate: '2024-10-20T23:59:59Z',
    url: 'https://item.rakuten.co.jp/sonystore/sony-wh1000xm5-bk/',
    images: generateProductImages('Sony-Headphone-Deal'),
    voting: {
      worthIt: 89,
      notWorthIt: 12,
      total: 101
    },
    createdAt: '2024-10-14T09:00:00Z'
  },
  {
    id: 'deal-003',
    productId: 'prod-003',
    platform: 'yahoo',
    title: 'Nintendo Switch OLED Yahoo!ストア限定',
    description: '専用ケース付きセットでお得',
    originalPrice: 37980,
    dealPrice: 34980,
    discountPercentage: 8,
    startDate: '2024-10-13T00:00:00Z',
    endDate: '2024-10-27T23:59:59Z',
    url: 'https://store.shopping.yahoo.co.jp/chara-ani/nintendo-switch-oled.html',
    images: generateProductImages('Nintendo-Switch-Deal'),
    voting: {
      worthIt: 203,
      notWorthIt: 31,
      total: 234
    },
    createdAt: '2024-10-13T11:00:00Z'
  }
];

// JANコードデータの例（バーコードスキャン用）
export const mockJanCodes = [
  {
    janCode: '4905524038230',
    productId: 'prod-004',
    name: '資生堂 アルティムーン パワifying セラム'
  },
  {
    janCode: '4562215330216',
    productId: 'prod-005',
    name: 'Canon EOS R6 Mark II'
  },
  {
    janCode: '4987020678125',
    productId: 'prod-003',
    name: 'Nintendo Switch OLED ホワイト'
  },
  {
    janCode: '4582417780689',
    productId: 'prod-001',
    name: 'iPhone 15 Pro 128GB ブラック'
  },
  {
    janCode: '4582699105684',
    productId: 'prod-002',
    name: 'Sony WH-1000XM5 ブラック'
  }
];

// Export all mock data
export const mockData = {
  products: mockProducts,
  categories: mockCategories,
  brands: mockBrands,
  priceHistory: generatePriceHistory(),
  deals: mockDeals,
  janCodes: mockJanCodes
};