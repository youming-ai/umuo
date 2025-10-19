# Data Model: Japanese Price Comparison App

**Date**: 2025-10-08
**Feature**: 001-prd-app-only
**Status**: Draft

## Core Entities

### 1. User
Represents app users with authentication and preferences.

```typescript
interface User {
  id: string
  email?: string
  displayName: string
  avatar?: string
  language: 'ja' | 'en' | 'zh'
  currency: 'JPY'
  timezone: 'Asia/Tokyo'
  preferences: UserPreferences
  subscription?: UserSubscription
  createdAt: Date
  updatedAt: Date
  lastActiveAt: Date
}

interface UserPreferences {
  notifications: NotificationSettings
  privacy: PrivacySettings
  search: SearchSettings
  display: DisplaySettings
}

interface NotificationSettings {
  priceAlerts: boolean
  dealAlerts: boolean
  communityUpdates: boolean
  marketingEmails: boolean
  quietHours: {
    start: string // HH:mm
    end: string   // HH:mm
  }
}

interface PrivacySettings {
  analyticsEnabled: boolean
  personalizationEnabled: boolean
  locationTracking: boolean
  affiliateDisclosure: boolean
}
```

### 2. Product (SPU)
Standard Product Unit representing products across platforms.

```typescript
interface Product {
  id: string // SPU identifier
  name: string
  description?: string
  brand?: string
  category: ProductCategory
  images: ProductImage[]
  specifications: ProductSpecification[]
  identifiers: ProductIdentifiers
  status: 'active' | 'discontinued' | 'out_of_stock'
  createdAt: Date
  updatedAt: Date
}

interface ProductCategory {
  id: string
  name: Record<string, string> // localized names
  parentId?: string
  level: number
}

interface ProductImage {
  url: string
  alt: Record<string, string> // localized alt text
  width: number
  height: number
  order: number
}

interface ProductSpecification {
  name: string
  value: string
  unit?: string
}

interface ProductIdentifiers {
  jan?: string // Japanese Article Number
  upc?: string // Universal Product Code
  ean?: string // European Article Number
  asin?: string // Amazon Standard Identification Number
  sku?: string // Stock Keeping Unit
}
```

### 3. ProductOffer
Specific product offer from a platform.

```typescript
interface ProductOffer {
  id: string
  productId: string
  platform: Platform
  platformProductId: string
  title: string
  description?: string
  price: Price
  availability: Availability
  seller: Seller
  shipping: ShippingInfo
  condition: 'new' | 'used' | 'refurbished'
  url: string
  images: ProductImage[]
  reviews: ReviewSummary
  affiliateInfo: AffiliateInfo
  firstSeenAt: Date
  lastUpdatedAt: Date
}

interface Platform {
  id: string
  name: string
  domain: string
  icon: string
  supportedRegions: string[]
  affiliateProgram: boolean
}

interface Price {
  amount: number
  currency: string
  originalPrice?: number
  discountPercentage?: number
  validUntil?: Date
}

interface Availability {
  inStock: boolean
  quantity?: number
  estimatedDelivery?: string
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'pre_order'
}

interface Seller {
  id: string
  name: string
  rating?: number
  reviewCount?: number
  url?: string
}

interface ShippingInfo {
  free: boolean
  cost?: number
  estimatedDays?: number
  methods: string[]
}

interface AffiliateInfo {
  enabled: boolean
  trackingCode: string
  commission?: number
}
```

### 4. PriceHistory
Historical price tracking for products.

```typescript
interface PriceHistory {
  id: string
  productId: string
  platformId: string
  price: number
  currency: string
  recordedAt: Date
  source: 'api' | 'scrape' | 'manual'
}

interface PriceStatistics {
  productId: string
  platformId: string
  period: number // days
  currentPrice: number
  averagePrice: number
  lowestPrice: number
  highestPrice: number
  priceChangePercent: number
  trend: 'rising' | 'falling' | 'stable'
}
```

### 5. Alert
User-defined price and availability alerts.

```typescript
interface Alert {
  id: string
  userId: string
  productId: string
  platformId?: string // optional for cross-platform alerts
  type: AlertType
  condition: AlertCondition
  active: boolean
  triggered: boolean
  createdAt: Date
  triggeredAt?: Date
  expiresAt?: Date
}

type AlertType = 'price_drop' | 'price_low' | 'in_stock' | 'any_change'

interface AlertCondition {
  threshold?: number // price threshold
  percentage?: number // percentage drop
  lowestHistorical?: boolean
  platformIds?: string[]
}
```

### 6. Deal
Promotional deals and special offers.

```typescript
interface Deal {
  id: string
  title: string
  description: string
  type: DealType
  discount: Discount
  products: DealProduct[]
  platforms: string[]
  url: string
  images: ProductImage[]
  startDate: Date
  endDate?: Date
  submittedBy?: string
  status: 'active' | 'pending' | 'expired' | 'rejected'
  communityScore: CommunityScore
  createdAt: Date
  updatedAt: Date
}

type DealType = 'coupon' | 'sale' | 'bundle' | 'clearance' | 'limited_time'

interface Discount {
  type: 'percentage' | 'fixed' | 'buy_one_get_one'
  value: number
  conditions?: string[]
}

interface DealProduct {
  productId: string
  platformId: string
  originalPrice: number
  discountedPrice: number
}
```

### 7. Community Content
User-generated content and social features.

```typescript
interface Vote {
  id: string
  userId: string
  targetType: 'product' | 'deal' | 'review'
  targetId: string
  value: 'up' | 'down'
  createdAt: Date
}

interface Comment {
  id: string
  userId: string
  targetType: 'product' | 'deal'
  targetId: string
  content: string
  parentId?: string // for replies
  status: 'active' | 'hidden' | 'deleted'
  moderationStatus: 'approved' | 'pending' | 'rejected'
  communityScore: CommunityScore
  createdAt: Date
  updatedAt: Date
}

interface CommunityScore {
  upvotes: number
  downvotes: number
  totalScore: number
  userVote?: 'up' | 'down'
}
```

### 8. Review
Product reviews and AI-generated summaries.

```typescript
interface Review {
  id: string
  productId: string
  platformId: string
  platformReviewId: string
  title?: string
  content: string
  rating: number // 1-5
  reviewer: Reviewer
  verified: boolean
  helpfulVotes: number
  totalVotes: number
  createdAt: Date
  updatedAt: Date
}

interface Reviewer {
  id: string
  name: string
  avatar?: string
  verified: boolean
}

interface ReviewSummary {
  productId: string
  platformId: string
  averageRating: number
  totalReviews: number
  ratingDistribution: RatingDistribution
  aiSummary: AISummary
  lastUpdated: Date
}

interface RatingDistribution {
  5: number
  4: number
  3: number
  2: number
  1: number
}

interface AISummary {
  summary: string
  pros: string[]
  cons: string[]
  confidence: number
  generatedAt: Date
  modelVersion: string
}
```

### 9. User Activity
User behavior tracking for personalization.

```typescript
interface UserActivity {
  id: string
  userId: string
  type: ActivityType
  targetType: 'product' | 'deal' | 'search'
  targetId?: string
  metadata: Record<string, any>
  timestamp: Date
}

type ActivityType =
  | 'view_product'
  | 'search_query'
  | 'set_alert'
  | 'vote'
  | 'comment'
  | 'share'
  | 'affiliate_click'

interface UserPreferences {
  favoriteCategories: string[]
  preferredPlatforms: string[]
  priceSensitivity: 'low' | 'medium' | 'high'
  searchHistory: SearchHistoryItem[]
  watchlist: WatchlistItem[]
}

interface SearchHistoryItem {
  query: string
  timestamp: Date
  resultCount: number
  clickedProductId?: string
}

interface WatchlistItem {
  productId: string
  addedAt: Date
  lastViewedAt: Date
  alertId?: string
}
```

### 10. Recommendation
AI-powered product recommendations.

```typescript
interface Recommendation {
  id: string
  userId: string
  productId: string
  type: RecommendationType
  score: number
  reason: RecommendationReason
  metadata: Record<string, any>
  shownAt?: Date
  clickedAt?: Date
  dismissedAt?: Date
  createdAt: Date
  expiresAt: Date
}

type RecommendationType =
  | 'similar_products'
  | 'price_drop'
  | 'trending'
  | 'personalized'
  | 'alternative'

interface RecommendationReason {
  type: string
  explanation: string
  confidence: number
}
```

## Relationships and Constraints

### Key Relationships
1. **User ↔ Alert**: One-to-many (users can have multiple alerts)
2. **User ↔ Vote**: One-to-many (users can vote on multiple items)
3. **User ↔ Comment**: One-to-many (users can write multiple comments)
4. **Product ↔ ProductOffer**: One-to-many (products can have offers from multiple platforms)
5. **Product ↔ PriceHistory**: One-to-many (products have historical price records)
6. **Product ↔ Review**: One-to-many (products can have reviews from multiple platforms)
7. **Deal ↔ DealProduct**: One-to-many (deals can include multiple products)

### Validation Rules
- Product prices must be positive numbers
- User ratings must be between 1 and 5
- Alert thresholds must be positive
- Email addresses must be valid format
- URLs must be valid and accessible
- Image dimensions must be positive

### Data Constraints
- User display names: 1-50 characters
- Product names: 1-200 characters
- Comments: 1-1000 characters
- Search queries: 1-100 characters
- Alert notifications: Maximum 100 per user per day

## Indexing Strategy

### Primary Indexes
- Users: email, lastActiveAt
- Products: name, category, brand, status
- ProductOffers: productId, platform, price, availability
- PriceHistory: productId, recordedAt
- Alerts: userId, active, triggered
- Deals: status, startDate, endDate
- Reviews: productId, rating, createdAt

### Composite Indexes
- ProductOffers: (productId, platform, price)
- PriceHistory: (productId, platform, recordedAt)
- UserActivity: (userId, timestamp, type)
- Votes: (targetType, targetId, createdAt)

---

**Model Complete**: Core entities, relationships, and constraints defined for implementation.