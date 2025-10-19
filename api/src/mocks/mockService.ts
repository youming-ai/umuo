/**
 * Mock Aggregation Service
 * 模拟聚合服务，整合所有平台的Mock数据
 */

import {
  MockSearchResponse,
  MockProduct,
  MockDeal,
  PlatformProduct
} from './types';
import {
  mockAmazonAdapter,
  mockRakutenAdapter,
  mockYahooAdapter,
  MockPlatformAdapter
} from './mockAdapter';
import { mockData } from './data';

export class MockAggregationService {
  private adapters: Map<string, MockPlatformAdapter>;

  constructor() {
    this.adapters = new Map([
      ['amazon', mockAmazonAdapter],
      ['rakuten', mockRakutenAdapter],
      ['yahoo', mockYahooAdapter]
    ]);
  }

  /**
   * 全平台商品搜索
   */
  async searchAllPlatforms(query: string, options: {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    page?: number;
    pageSize?: number;
    sort?: 'price' | 'rating' | 'relevance';
    platforms?: string[];
  } = {}): Promise<MockSearchResponse> {
    const {
      platforms = ['amazon', 'rakuten', 'yahoo'],
      page = 1,
      pageSize = 20
    } = options;

    // 并行调用所有平台的搜索
    const platformPromises = platforms.map(platformName => {
      const adapter = this.adapters.get(platformName);
      if (!adapter) return Promise.resolve(null);

      return adapter.searchProducts(query, options)
        .then(result => ({ platform: platformName, result }))
        .catch(error => {
          console.error(`Error searching ${platformName}:`, error);
          return null;
        });
    });

    const platformResults = await Promise.allSettled(platformPromises);
    const allProducts: MockProduct[] = [];
    let totalResults = 0;

    // 合并结果
    platformResults.forEach(promiseResult => {
      if (promiseResult.status === 'fulfilled' && promiseResult.value) {
        const { platform, result } = promiseResult.value;
        // 为每个商品添加平台信息
        result.products.forEach(product => {
          // 检查是否已经添加过相同SPU的商品
          const existingProduct = allProducts.find(p => p.spuId === product.spuId);
          if (existingProduct) {
            // 如果已存在，只添加该平台的价格信息
            const platformProduct = product.platforms.find(p => p.platform === platform);
            if (platformProduct) {
              existingProduct.platforms.push(platformProduct);
            }
          } else {
            // 如果不存在，添加新商品
            allProducts.push(product);
          }
        });
        totalResults += result.totalResults;
      }
    });

    // 排序和分页
    const sortedProducts = this.sortAggregatedProducts(allProducts, options.sort);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedProducts = sortedProducts.slice(startIndex, endIndex);

    return {
      products: paginatedProducts,
      totalResults: allProducts.length,
      pageSize,
      currentPage: page,
      totalPages: Math.ceil(allProducts.length / pageSize),
      searchTime: Math.random() * 0.8 + 0.2, // 0.2-1.0秒
      facets: this.generateAggregatedFacets(allProducts)
    };
  }

  /**
   * 商品详情获取（包含所有平台价格）
   */
  async getProductDetails(spuId: string): Promise<MockProduct | null> {
    // 首先找到基础商品
    const baseProduct = mockData.products.find(p => p.spuId === spuId);
    if (!baseProduct) return null;

    // 并行获取所有平台的最新价格和库存信息
    const platformPromises = baseProduct.platforms.map(async platformProduct => {
      const adapter = this.adapters.get(platformProduct.platform);
      if (!adapter) return platformProduct;

      try {
        const updatedProduct = await adapter.getProductDetails(baseProduct.id);
        if (updatedProduct) {
          return updatedProduct.platforms.find(p => p.platform === platformProduct.platform);
        }
      } catch (error) {
        console.error(`Error fetching details for ${platformProduct.platform}:`, error);
      }

      return platformProduct;
    });

    const updatedPlatforms = await Promise.allSettled(platformPromises);
    const validPlatforms = updatedPlatforms
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => (result as PromiseFulfilledResult<PlatformProduct>).value);

    return {
      ...baseProduct,
      platforms: validPlatforms,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * JANコード検索（全平台）
   */
  async searchByJanCode(janCode: string): Promise<MockProduct[]> {
    const platformPromises = Array.from(this.adapters.entries()).map(
      async ([platformName, adapter]) => {
        try {
          return await adapter.searchByJanCode(janCode);
        } catch (error) {
          console.error(`Error searching JAN code in ${platformName}:`, error);
          return [];
        }
      }
    );

    const platformResults = await Promise.allSettled(platformPromises);
    const allProducts: MockProduct[] = [];
    const seenSpuIds = new Set<string>();

    platformResults.forEach(promiseResult => {
      if (promiseResult.status === 'fulfilled' && promiseResult.value) {
        promiseResult.value.forEach(product => {
          if (!seenSpuIds.has(product.spuId)) {
            seenSpuIds.add(product.spuId);
            allProducts.push(product);
          }
        });
      }
    });

    return allProducts;
  }

  /**
   * 价格比较（所有平台）
   */
  async comparePrices(spuId: string): Promise<{
    product: MockProduct;
    priceComparison: PlatformComparison[];
    bestPrice: PlatformComparison;
    priceHistory: any[];
  } | null> {
    const product = await this.getProductDetails(spuId);
    if (!product) return null;

    const priceComparison: PlatformComparison[] = product.platforms.map(platform => ({
      platform: platform.platform,
      price: platform.price,
      availability: platform.availability,
      rating: platform.rating,
      url: platform.url,
      shipping: platform.platformSpecific.shippingCost || 0,
      totalPrice: platform.price.amount + (platform.platformSpecific.shippingCost || 0)
    }));

    // 找出最优价格
    const availablePlatforms = priceComparison.filter(p => p.availability.status === 'in_stock');
    const bestPrice = availablePlatforms.reduce((best, current) =>
      current.totalPrice < best.totalPrice ? current : best,
      availablePlatforms[0]
    );

    // 获取价格历史
    const priceHistory = await this.getAggregatedPriceHistory(product);

    return {
      product,
      priceComparison,
      bestPrice,
      priceHistory
    };
  }

  /**
   * 全平台优惠信息
   */
  async getAllDeals(options: {
    category?: string;
    minDiscount?: number;
    platforms?: string[];
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ deals: MockDeal[], total: number, platforms: string[] }> {
    const {
      platforms = ['amazon', 'rakuten', 'yahoo'],
      minDiscount = 5,
      page = 1,
      pageSize = 20
    } = options;

    const platformPromises = platforms.map(platformName => {
      const adapter = this.adapters.get(platformName);
      if (!adapter) return Promise.resolve({ deals: [], total: 0 });

      return adapter.getDeals(options)
        .catch(error => {
          console.error(`Error fetching deals from ${platformName}:`, error);
          return { deals: [], total: 0 };
        });
    });

    const platformResults = await Promise.allSettled(platformPromises);
    let allDeals: MockDeal[] = [];
    let totalDeals = 0;

    platformResults.forEach(promiseResult => {
      if (promiseResult.status === 'fulfilled' && promiseResult.value) {
        allDeals = allDeals.concat(promiseResult.value.deals);
        totalDeals += promiseResult.value.total;
      }
    });

    // 按折扣率和投票数排序
    allDeals.sort((a, b) => {
      const scoreA = a.discountPercentage * 0.7 + (a.voting.worthIt / Math.max(a.voting.total, 1)) * 30;
      const scoreB = b.discountPercentage * 0.7 + (b.voting.worthIt / Math.max(b.voting.total, 1)) * 30;
      return scoreB - scoreA;
    });

    // 分页
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedDeals = allDeals.slice(startIndex, endIndex);

    return {
      deals: paginatedDeals,
      total: allDeals.length,
      platforms
    };
  }

  /**
   * 价格趋势分析
   */
  async getPriceTrendAnalysis(spuId: string, days: number = 30): Promise<any> {
    const product = await this.getProductDetails(spuId);
    if (!product) return null;

    const platformTrends = await Promise.all(
      product.platforms.map(async platform => {
        const adapter = this.adapters.get(platform.platform);
        if (!adapter) return null;

        try {
          const history = await adapter.getPriceHistory(platform.platformProductId);
          if (!history) return null;

          const recentHistory = history.history.slice(-days);
          const trend = this.calculateTrend(recentHistory);

          return {
            platform: platform.platform,
            currentPrice: platform.price.amount,
            trend,
            lowestPrice: Math.min(...recentHistory.map((h: any) => h.price)),
            highestPrice: Math.max(...recentHistory.map((h: any) => h.price)),
            averagePrice: recentHistory.reduce((sum: number, h: any) => sum + h.price, 0) / recentHistory.length,
            recommendation: this.generatePriceRecommendation(trend, platform.price.amount, recentHistory)
          };
        } catch (error) {
          console.error(`Error analyzing trend for ${platform.platform}:`, error);
          return null;
        }
      })
    );

    const validTrends = platformTrends.filter(trend => trend !== null);

    return {
      spuId,
      title: product.title,
      period: `${days}日間`,
      platforms: validTrends,
      overallRecommendation: this.generateOverallRecommendation(validTrends),
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * 排序聚合商品
   */
  private sortAggregatedProducts(products: MockProduct[], sort?: string): MockProduct[] {
    if (!sort || sort === 'relevance') return products;

    return [...products].sort((a, b) => {
      switch (sort) {
        case 'price':
          const aMinPrice = Math.min(...a.platforms.map(p => p.price.amount));
          const bMinPrice = Math.min(...b.platforms.map(p => p.price.amount));
          return aMinPrice - bMinPrice;

        case 'rating':
          const aAvgRating = a.platforms.reduce((sum, p) => sum + (p.rating?.score || 0), 0) / a.platforms.length;
          const bAvgRating = b.platforms.reduce((sum, p) => sum + (p.rating?.score || 0), 0) / b.platforms.length;
          return bAvgRating - aAvgRating;

        default:
          return 0;
      }
    });
  }

  /**
   * 生成聚合facet
   */
  private generateAggregatedFacets(products: MockProduct[]): any {
    const categories: Record<string, number> = {};
    const brands: Record<string, number> = {};
    const platforms: Record<string, number> = {};

    products.forEach(product => {
      // 分类统计
      categories[product.category] = (categories[product.category] || 0) + 1;

      // 品牌统计
      brands[product.brand] = (brands[product.brand] || 0) + 1;

      // 平台统计
      product.platforms.forEach(platform => {
        platforms[platform.platform] = (platforms[platform.platform] || 0) + 1;
      });
    });

    return {
      categories: Object.entries(categories).map(([id, count]) => ({ id, name: id, count })),
      brands: Object.entries(brands).map(([id, count]) => ({ id, name: id, count })),
      platforms: Object.entries(platforms).map(([id, count]) => ({ id, name: id, count }))
    };
  }

  /**
   * 获取聚合价格历史
   */
  private async getAggregatedPriceHistory(product: MockProduct): Promise<any[]> {
    const platformHistories = await Promise.all(
      product.platforms.map(async platform => {
        const adapter = this.adapters.get(platform.platform);
        if (!adapter) return null;

        try {
          return await adapter.getPriceHistory(platform.platformProductId);
        } catch (error) {
          return null;
        }
      })
    );

    // 合并所有平台的价格历史
    const aggregatedHistory: Record<string, any> = {};
    platformHistories.forEach(history => {
      if (history) {
        history.history.forEach((entry: any) => {
          if (!aggregatedHistory[entry.date]) {
            aggregatedHistory[entry.date] = {
              date: entry.date,
              prices: {},
              lowestPrice: entry.price,
              highestPrice: entry.price,
              platforms: []
            };
          }

          aggregatedHistory[entry.date].prices[history.platform] = entry.price;
          aggregatedHistory[entry.date].platforms.push({
            platform: history.platform,
            price: entry.price
          });

          aggregatedHistory[entry.date].lowestPrice = Math.min(
            aggregatedHistory[entry.date].lowestPrice,
            entry.price
          );
          aggregatedHistory[entry.date].highestPrice = Math.max(
            aggregatedHistory[entry.date].highestPrice,
            entry.price
          );
        });
      }
    });

    return Object.values(aggregatedHistory)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-30); // 过去30天
  }

  /**
   * 计算趋势
   */
  private calculateTrend(history: any[]): 'up' | 'down' | 'stable' {
    if (history.length < 2) return 'stable';

    const firstPrice = history[0].price;
    const lastPrice = history[history.length - 1].price;
    const change = (lastPrice - firstPrice) / firstPrice;

    if (change > 0.05) return 'up';
    if (change < -0.05) return 'down';
    return 'stable';
  }

  /**
   * 生成价格推荐
   */
  private generatePriceRecommendation(trend: string, currentPrice: number, history: any[]): string {
    const lowestPrice = Math.min(...history.map((h: any) => h.price));
    const isNearLow = (currentPrice - lowestPrice) / lowestPrice < 0.05;

    if (trend === 'down' && isNearLow) {
      return '价格下降且接近近期低点，建议购买';
    } else if (trend === 'up') {
      return '价格上升趋势，考虑等待促销';
    } else if (isNearLow) {
      return '价格接近近期低点，是好时机';
    } else {
      return '价格相对稳定，可考虑购买';
    }
  }

  /**
   * 生成整体推荐
   */
  private generateOverallRecommendation(platformTrends: any[]): string {
    if (platformTrends.length === 0) return '暂无足够数据';

    const buyRecommendations = platformTrends.filter(t => t.recommendation.includes('建议购买')).length;
    const waitRecommendations = platformTrends.filter(t => t.recommendation.includes('等待')).length;

    if (buyRecommendations > waitRecommendations) {
      return '多数平台显示购买时机较好';
    } else if (waitRecommendations > buyRecommendations) {
      return '建议等待更好的价格';
    } else {
      return '价格相对稳定，可根据需要购买';
    }
  }
}

interface PlatformComparison {
  platform: string;
  price: any;
  availability: any;
  rating?: any;
  url: string;
  shipping: number;
  totalPrice: number;
}

// 创建全局Mock服务实例
export const mockAggregationService = new MockAggregationService();