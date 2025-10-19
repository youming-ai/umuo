/**
 * Mock Data Types for E-commerce Platforms
 * 统一的Mock数据类型定义
 */

export interface MockProduct {
  id: string;
  spuId: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  images: ProductImage[];
  platforms: PlatformProduct[];
  createdAt: string;
  updatedAt: string;
}

export interface PlatformProduct {
  platform: 'amazon' | 'rakuten' | 'yahoo';
  platformProductId: string;
  url: string;
  price: PriceInfo;
  availability: AvailabilityStatus;
  rating?: RatingInfo;
  reviews?: ReviewInfo;
  platformSpecific: Record<string, any>;
}

export interface ProductImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface PriceInfo {
  amount: number;
  currency: 'JPY';
  formattedPrice: string;
}

export interface RatingInfo {
  score: number;
  count: number;
  maxScore: number;
}

export interface ReviewInfo {
  total: number;
  average: number;
  distribution: Record<number, number>; // 1-5星分布
}

export interface AvailabilityStatus {
  status: 'in_stock' | 'out_of_stock' | 'limited_stock' | 'pre_order';
  message: string;
  quantity?: number;
}

export interface MockCategory {
  id: string;
  name: string;
  parentId?: string;
  level: number;
}

export interface MockBrand {
  id: string;
  name: string;
  logo?: string;
  website?: string;
}

// 搜索响应类型
export interface MockSearchResponse {
  products: MockProduct[];
  totalResults: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
  searchTime: number;
  facets?: SearchFacets;
}

export interface SearchFacets {
  categories: CategoryFacet[];
  brands: BrandFacet[];
  priceRanges: PriceRangeFacet[];
  ratings: RatingFacet[];
}

export interface CategoryFacet {
  id: string;
  name: string;
  count: number;
}

export interface BrandFacet {
  id: string;
  name: string;
  count: number;
}

export interface PriceRangeFacet {
  min: number;
  max: number;
  count: number;
}

export interface RatingFacet {
  score: number;
  count: number;
}

// 价格历史数据
export interface MockPriceHistory {
  productId: string;
  platformProductId: string;
  platform: string;
  history: PriceHistoryEntry[];
}

export interface PriceHistoryEntry {
  price: number;
  currency: 'JPY';
  date: string;
  source: 'api' | 'scraping' | 'user';
}

// Mock数据集
export interface MockDataSets {
  products: MockProduct[];
  categories: MockCategory[];
  brands: MockBrand[];
  priceHistory: MockPriceHistory[];
  deals: MockDeal[];
}

export interface MockDeal {
  id: string;
  productId: string;
  platform: string;
  title: string;
  description: string;
  originalPrice: number;
  dealPrice: number;
  discountPercentage: number;
  startDate: string;
  endDate: string;
  url: string;
  images: ProductImage[];
  voting: DealVoting;
  createdAt: string;
}

export interface DealVoting {
  worthIt: number;
  notWorthIt: number;
  total: number;
  userVote?: 'worth_it' | 'not_worth_it';
}