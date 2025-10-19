/**
 * Mock Platform Adapter
 * 模拟平台适配器，用于开发阶段
 */

import {
  MockSearchResponse,
  MockProduct,
  PlatformProduct,
  MockDeal
} from './types';
import { mockData, mockJanCodes } from './data';

export class MockPlatformAdapter {
  private platform: 'amazon' | 'rakuten' | 'yahoo';

  constructor(platform: 'amazon' | 'rakuten' | 'yahoo') {
    this.platform = platform;
  }

  /**
   * 商品検索
   */
  async searchProducts(query: string, options: {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    page?: number;
    pageSize?: number;
    sort?: 'price' | 'rating' | 'relevance';
  } = {}): Promise<MockSearchResponse> {
    // 模拟API延迟
    await this.simulateDelay(300, 800);

    const {
      category,
      minPrice,
      maxPrice,
      page = 1,
      pageSize = 20,
      sort = 'relevance'
    } = options;

    // 过滤商品
    let filteredProducts = mockData.products.filter(product => {
      // 检查是否有该平台的商品
      const platformProduct = product.platforms.find(p => p.platform === this.platform);
      if (!platformProduct) return false;

      // 搜索关键词匹配
      const queryMatch = !query ||
        product.title.toLowerCase().includes(query.toLowerCase()) ||
        product.description.toLowerCase().includes(query.toLowerCase());

      // 分类匹配
      const categoryMatch = !category || product.category === category;

      // 价格范围匹配
      const priceMatch = (!minPrice || platformProduct.price.amount >= minPrice) &&
                        (!maxPrice || platformProduct.price.amount <= maxPrice);

      return queryMatch && categoryMatch && priceMatch;
    });

    // 排序
    filteredProducts = this.sortProducts(filteredProducts, sort);

    // 分页
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

    // 构建搜索结果
    const searchResults: MockSearchResponse = {
      products: paginatedProducts,
      totalResults: filteredProducts.length,
      pageSize,
      currentPage: page,
      totalPages: Math.ceil(filteredProducts.length / pageSize),
      searchTime: Math.random() * 0.5 + 0.1, // 0.1-0.6秒
      facets: this.generateFacets(filteredProducts)
    };

    return searchResults;
  }

  /**
   * 商品詳細取得
   */
  async getProductDetails(productId: string): Promise<MockProduct | null> {
    await this.simulateDelay(100, 300);

    const product = mockData.products.find(p => p.id === productId);
    if (!product) return null;

    // 检查是否有该平台的商品
    const platformProduct = product.platforms.find(p => p.platform === this.platform);
    if (!platformProduct) return null;

    return product;
  }

  /**
   * JANコードで商品検索
   */
  async searchByJanCode(janCode: string): Promise<MockProduct[]> {
    await this.simulateDelay(200, 500);

    const janData = mockJanCodes.find(j => j.janCode === janCode);
    if (!janData) return [];

    const product = mockData.products.find(p => p.id === janData.productId);
    if (!product) return [];

    // 检查是否有该平台的商品
    const platformProduct = product.platforms.find(p => p.platform === this.platform);
    if (!platformProduct) return [];

    return [product];
  }

  /**
   * お得な商品一覧
   */
  async getDeals(options: {
    category?: string;
    minDiscount?: number;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ deals: MockDeal[], total: number }> {
    await this.simulateDelay(200, 400);

    const {
      category,
      minDiscount = 5,
      page = 1,
      pageSize = 20
    } = options;

    // 过滤该平台的deals
    let filteredDeals = mockData.deals.filter(deal => {
      if (deal.platform !== this.platform) return false;
      if (deal.discountPercentage < minDiscount) return false;

      if (category) {
        const product = mockData.products.find(p => p.id === deal.productId);
        if (!product || product.category !== category) return false;
      }

      return true;
    });

    // 按折扣率排序
    filteredDeals.sort((a, b) => b.discountPercentage - a.discountPercentage);

    // 分页
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedDeals = filteredDeals.slice(startIndex, endIndex);

    return {
      deals: paginatedDeals,
      total: filteredDeals.length
    };
  }

  /**
   * 価格履歴取得
   */
  async getPriceHistory(platformProductId: string): Promise<any> {
    await this.simulateDelay(100, 200);

    const history = mockData.priceHistory.find(h =>
      h.platformProductId === platformProductId && h.platform === this.platform
    );

    if (!history) return null;

    return {
      productId: history.productId,
      platformProductId: history.platformProductId,
      platform: history.platform,
      currentPrice: history.history[history.history.length - 1].price,
      history: history.history.slice(-30), // 過去30日分
      statistics: this.calculatePriceStats(history.history)
    };
  }

  /**
   * 商品レビュー取得
   */
  async getReviews(platformProductId: string, options: {
    page?: number;
    pageSize?: number;
    rating?: number;
  } = {}): Promise<any> {
    await this.simulateDelay(200, 400);

    const { page = 1, pageSize = 10, rating } = options;

    // 模拟レビューデータ
    const mockReviews = this.generateMockReviews(platformProductId);

    let filteredReviews = mockReviews;
    if (rating) {
      filteredReviews = mockReviews.filter(review => review.rating === rating);
    }

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedReviews = filteredReviews.slice(startIndex, endIndex);

    return {
      reviews: paginatedReviews,
      total: filteredReviews.length,
      averageRating: this.calculateAverageRating(mockReviews),
      ratingDistribution: this.calculateRatingDistribution(mockReviews)
    };
  }

  /**
   * 商品をソート
   */
  private sortProducts(products: MockProduct[], sort: string): MockProduct[] {
    const sorted = [...products];

    switch (sort) {
      case 'price':
        return sorted.sort((a, b) => {
          const aPrice = a.platforms.find(p => p.platform === this.platform)?.price.amount || 0;
          const bPrice = b.platforms.find(p => p.platform === this.platform)?.price.amount || 0;
          return aPrice - bPrice;
        });

      case 'rating':
        return sorted.sort((a, b) => {
          const aRating = a.platforms.find(p => p.platform === this.platform)?.rating?.score || 0;
          const bRating = b.platforms.find(p => p.platform === this.platform)?.rating?.score || 0;
          return bRating - aRating;
        });

      case 'relevance':
      default:
        return sorted; // 保持原始順序（相關度）
    }
  }

  /**
   * 検索ファセット生成
   */
  private generateFacets(products: MockProduct[]): any {
    const categories: Record<string, number> = {};
    const brands: Record<string, number> = {};
    const priceRanges: Record<string, number> = {};
    const ratings: Record<string, number> = {};

    products.forEach(product => {
      // 分类统计
      categories[product.category] = (categories[product.category] || 0) + 1;

      // 品牌统计
      brands[product.brand] = (brands[product.brand] || 0) + 1;

      // 价格范围统计
      const platformProduct = product.platforms.find(p => p.platform === this.platform);
      if (platformProduct) {
        const price = platformProduct.price.amount;
        const range = this.getPriceRange(price);
        priceRanges[range] = (priceRanges[range] || 0) + 1;

        // 评分统计
        if (platformProduct.rating) {
          const rating = Math.floor(platformProduct.rating.score);
          ratings[`${rating}星`] = (ratings[`${rating}星`] || 0) + 1;
        }
      }
    });

    return {
      categories: Object.entries(categories).map(([id, count]) => ({ id, name: id, count })),
      brands: Object.entries(brands).map(([id, count]) => ({ id, name: id, count })),
      priceRanges: Object.entries(priceRanges).map(([range, count]) => {
        const [min, max] = range.split('-').map(Number);
        return { min, max, count };
      }),
      ratings: Object.entries(ratings).map(([name, count]) => {
        const score = parseInt(name);
        return { score, count };
      })
    };
  }

  /**
   * 価格範囲を取得
   */
  private getPriceRange(price: number): string {
    if (price < 1000) return '0-1000';
    if (price < 5000) return '1000-5000';
    if (price < 10000) return '5000-10000';
    if (price < 30000) return '10000-30000';
    if (price < 50000) return '30000-50000';
    if (price < 100000) return '50000-100000';
    return '100000+';
  }

  /**
   * 価格統計計算
   */
  private calculatePriceStats(history: any[]): any {
    const prices = history.map(h => h.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;

    // 计算90天最低价
    const ninetyDayLow = Math.min(...prices.slice(-90));

    return {
      min,
      max,
      average: Math.round(average),
      ninetyDayLow,
      currentPrice: prices[prices.length - 1],
      trend: this.calculateTrend(prices.slice(-7)) // 过去7天趋势
    };
  }

  /**
   * 価格トレンド計算
   */
  private calculateTrend(prices: number[]): 'up' | 'down' | 'stable' {
    if (prices.length < 2) return 'stable';

    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const change = (lastPrice - firstPrice) / firstPrice;

    if (change > 0.05) return 'up';
    if (change < -0.05) return 'down';
    return 'stable';
  }

  /**
   * モックレビュー生成
   */
  private generateMockReviews(platformProductId: string): any[] {
    const reviewCount = Math.floor(Math.random() * 50) + 10;
    const reviews = [];

    for (let i = 0; i < reviewCount; i++) {
      reviews.push({
        id: `review-${platformProductId}-${i}`,
        platformProductId,
        rating: Math.floor(Math.random() * 3) + 3, // 3-5星
        title: this.generateReviewTitle(),
        content: this.generateReviewContent(),
        reviewer: `ユーザー${i + 1}`,
        date: this.generateRandomDate(),
        helpful: Math.floor(Math.random() * 20),
        verified: Math.random() > 0.3
      });
    }

    return reviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private generateReviewTitle(): string {
    const titles = [
      '大満足です！',
      '期待通りでした',
      'もう少しの期待でした',
      '最高の製品です',
      'コストパフォーマンスgood',
      'おすすめです',
      '使いやすいです',
      '品質は良好'
    ];
    return titles[Math.floor(Math.random() * titles.length)];
  }

  private generateReviewContent(): string {
    const contents = [
      '購入してよかったです。使い心地も良好で、満足しています。',
      '期待通りの性能で、コストパフォーマンスも良いと思います。',
      '友人にもおすすめしたい商品です。',
      '毎日使っていますが、特に不満はありません。',
      '少し高めですが、その価値はあると思います。'
    ];
    return contents[Math.floor(Math.random() * contents.length)];
  }

  private generateRandomDate(): string {
    const daysAgo = Math.floor(Math.random() * 365);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().split('T')[0];
  }

  private calculateAverageRating(reviews: any[]): number {
    if (reviews.length === 0) return 0;
    const sum = reviews.reduce((total, review) => total + review.rating, 0);
    return Math.round((sum / reviews.length) * 10) / 10;
  }

  private calculateRatingDistribution(reviews: any[]): Record<number, number> {
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach(review => {
      distribution[review.rating]++;
    });
    return distribution;
  }

  /**
   * API延迟模拟
   */
  private async simulateDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = Math.random() * (maxMs - minMs) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
  }
}

// 创建平台适配器实例
export const mockAmazonAdapter = new MockPlatformAdapter('amazon');
export const mockRakutenAdapter = new MockPlatformAdapter('rakuten');
export const mockYahooAdapter = new MockPlatformAdapter('yahoo');