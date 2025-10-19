# Yabaii API Documentation

## Overview

The Yabaii API is a RESTful API that provides price comparison and product search services for the Japanese market. It aggregates data from multiple e-commerce platforms to help users find the best deals.

## Base URL

- **Production**: `https://api.yabaii.day`
- **Staging**: `https://staging-api.yabaii.day`
- **Development**: `http://localhost:3001`

## Authentication

The API uses JWT (JSON Web Token) authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Rate Limiting

- **General API**: 1000 requests per 15 minutes
- **Search endpoints**: 60 requests per minute
- **Price tracking**: 30 requests per minute
- **Authentication**: 10 requests per 15 minutes

Rate limit headers are included in all responses:

- `X-Rate-Limit-Limit`: Request limit for the window
- `X-Rate-Limit-Remaining`: Remaining requests
- `X-Rate-Limit-Reset`: Time when the window resets

## API Endpoints

### Health Check

#### GET /health
Check the health status of the API and its dependencies.

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "external_apis": "healthy"
  },
  "version": "1.0.0"
}
```

### Search

#### GET /api/v1/search
Search for products across multiple platforms.

**Parameters:**
- `q` (string, required): Search query
- `category` (string, optional): Filter by category
- `minPrice` (number, optional): Minimum price in JPY
- `maxPrice` (number, optional): Maximum price in JPY
- `platform` (string, optional): Filter by platform (amazon, rakuten, yahoo)
- `limit` (number, optional): Number of results (default: 20, max: 100)
- `offset` (number, optional): Pagination offset (default: 0)
- `sort` (string, optional): Sort order (price_asc, price_desc, rating, relevance)

**Response:**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "prod_123",
        "name": "iPhone 13",
        "brand": "Apple",
        "category": "electronics",
        "description": "Latest iPhone model",
        "images": ["https://example.com/image.jpg"],
        "specifications": {
          "storage": "128GB",
          "color": "Black",
          "screen_size": "6.1 inch"
        },
        "availability": {
          "in_stock": true,
          "quantity": 15
        },
        "created_at": "2024-01-01T00:00:00.000Z",
        "updated_at": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total": 156,
    "has_more": true,
    "query_info": {
      "query": "iPhone 13",
      "filters_applied": ["electronics"],
      "search_time": 45
    }
  }
}
```

#### GET /api/v1/search/autocomplete
Get search suggestions for autocomplete.

**Parameters:**
- `q` (string, required): Partial search query
- `limit` (number, optional): Number of suggestions (default: 5, max: 10)

**Response:**
```json
{
  "success": true,
  "data": {
    "suggestions": [
      {
        "text": "iPhone 13",
        "type": "product",
        "count": 45
      },
      {
        "text": "iPhone 13 case",
        "type": "accessory",
        "count": 23
      }
    ]
  }
}
```

### Products

#### GET /api/v1/products/{productId}
Get detailed information about a specific product.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "prod_123",
    "name": "iPhone 13",
    "brand": "Apple",
    "category": "electronics",
    "description": "Latest iPhone model with A15 Bionic chip",
    "images": [
      {
        "url": "https://example.com/front.jpg",
        "type": "front",
        "size": "large"
      }
    ],
    "specifications": {
      "storage": "128GB",
      "color": "Black",
      "screen_size": "6.1 inch",
      "weight": "174g",
      "dimensions": "146.7 x 71.5 x 7.65 mm"
    },
    "platforms": ["amazon", "rakuten", "yahoo"],
    "created_at": "2024-01-01T00:00:00.000Z",
    "updated_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### GET /api/v1/products/{productId}/similar
Get similar products to the specified product.

**Parameters:**
- `limit` (number, optional): Number of similar products (default: 10)

**Response:**
```json
{
  "success": true,
  "data": {
    "similar_products": [
      {
        "id": "prod_456",
        "name": "iPhone 12",
        "brand": "Apple",
        "similarity_score": 0.85,
        "price_comparison": {
          "current": 75000,
          "original": 85000
        }
      }
    ]
  }
}
```

#### GET /api/v1/products/{productId}/price-history
Get price history for a product.

**Parameters:**
- `period` (number, optional): Period in days (default: 30, max: 365)
- `platform` (string, optional): Filter by platform

**Response:**
```json
{
  "success": true,
  "data": {
    "price_history": [
      {
        "date": "2024-01-01",
        "platform": "amazon",
        "price": 98000,
        "currency": "JPY",
        "availability": true
      }
    ],
    "statistics": {
      "lowest_price": 85000,
      "highest_price": 120000,
      "average_price": 98000,
      "current_price": 95000
    }
  }
}
```

### Prices

#### GET /api/v1/prices/current
Get current prices for a product across platforms.

**Parameters:**
- `productId` (string, required): Product ID
- `platforms` (array, optional): List of platforms to include

**Response:**
```json
{
  "success": true,
  "data": {
    "product_id": "prod_123",
    "prices": [
      {
        "platform": "amazon",
        "price": 95000,
        "currency": "JPY",
        "availability": true,
        "shipping_cost": 0,
        "seller": "Amazon Japan",
        "last_updated": "2024-01-01T00:00:00.000Z"
      }
    ],
    "best_offer": {
      "platform": "rakuten",
      "price": 92000,
      "total_cost": 92000
    }
  }
}
```

#### GET /api/v1/prices/stats
Get price statistics for a product.

**Parameters:**
- `productId` (string, required): Product ID
- `period` (number, optional): Period in days (default: 30)

**Response:**
```json
{
  "success": true,
  "data": {
    "product_id": "prod_123",
    "period_days": 30,
    "statistics": {
      "current_price": 95000,
      "lowest_price": 85000,
      "highest_price": 120000,
      "average_price": 98000,
      "median_price": 97000,
      "price_trend": "stable",
      "volatility": 0.15
    },
    "recommendations": {
      "buy_now": false,
      "wait_for_sale": true,
      "best_time_to_buy": "2-3 weeks"
    }
  }
}
```

### Deals

#### GET /api/v1/deals/trending
Get trending deals across all categories.

**Parameters:**
- `category` (string, optional): Filter by category
- `limit` (number, optional): Number of deals (default: 20)
- `min_discount` (number, optional): Minimum discount percentage

**Response:**
```json
{
  "success": true,
  "data": {
    "deals": [
      {
        "product": {
          "id": "prod_789",
          "name": "AirPods Pro",
          "brand": "Apple"
        },
        "deal_info": {
          "original_price": 25000,
          "current_price": 20000,
          "discount_percentage": 20,
          "savings": 5000,
          "deal_type": "hot",
          "expires_at": "2024-01-07T00:00:00.000Z"
        },
        "platform": "amazon",
        "confidence": 0.85
      }
    ],
    "categories": ["electronics", "fashion", "home"]
  }
}
```

#### GET /api/v1/deals/recommendations
Get personalized deal recommendations.

**Parameters:**
- `userId` (string, required): User ID
- `limit` (number, optional): Number of recommendations (default: 10)

**Response:**
```json
{
  "success": true,
  "data": {
    "recommendations": [
      {
        "product": {
          "id": "prod_101",
          "name": "iPad Air",
          "relevance_score": 0.92
        },
        "deal_info": {
          "current_price": 60000,
          "historical_low": 55000,
          "is_good_deal": true,
          "deal_score": 0.78
        },
        "reason": "Based on your interest in Apple products"
      }
    ],
    "personalization_info": {
      "based_on": ["purchase_history", "browsing_history", "preferences"],
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

### Users

#### GET /api/v1/users/profile
Get user profile information.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    "preferences": {
      "language": "ja",
      "currency": "JPY",
      "notifications": {
        "price_drops": true,
        "stock_alerts": false,
        "new_products": true
      }
    },
    "statistics": {
      "searches_count": 45,
      "alerts_count": 12,
      "savings_total": 15000
    },
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

#### PUT /api/v1/users/profile
Update user profile information.

**Headers:**
- `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "preferences": {
    "language": "ja",
    "currency": "JPY",
    "notifications": {
      "price_drops": true,
      "stock_alerts": false
    }
  }
}
```

### Alerts

#### GET /api/v1/alerts
Get user's price alerts.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "alerts": [
      {
        "id": "alert_123",
        "product_id": "prod_456",
        "type": "price_drop",
        "threshold": 20,
        "enabled": true,
        "created_at": "2024-01-01T00:00:00.000Z",
        "last_triggered": null
      }
    ]
  }
}
```

#### POST /api/v1/alerts
Create a new price alert.

**Headers:**
- `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "product_id": "prod_456",
  "type": "price_drop",
  "threshold": 20,
  "enabled": true
}
```

## Error Handling

The API returns standard HTTP status codes and error responses in the following format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "field": "price",
      "issue": "Price must be a positive number"
    }
  },
  "request_id": "req_123456789"
}
```

### Common Error Codes

- `400 BAD_REQUEST`: Invalid request parameters
- `401 UNAUTHORIZED`: Authentication required or invalid token
- `403 FORBIDDEN`: Insufficient permissions
- `404 NOT_FOUND`: Resource not found
- `429 TOO_MANY_REQUESTS`: Rate limit exceeded
- `500 INTERNAL_SERVER_ERROR`: Server error
- `503 SERVICE_UNAVAILABLE`: Service temporarily unavailable

## Data Types

### Product Object

```typescript
interface Product {
  id: string;
  name: string;
  brand?: string;
  category: string;
  description?: string;
  images: ProductImage[];
  specifications?: Record<string, any>;
  availability: ProductAvailability;
  platforms: string[];
  created_at: string;
  updated_at: string;
}

interface ProductImage {
  url: string;
  type: 'front' | 'back' | 'side' | 'detail';
  size: 'small' | 'medium' | 'large';
}

interface ProductAvailability {
  in_stock: boolean;
  quantity?: number;
  estimated_delivery?: string;
}
```

### Price Object

```typescript
interface Price {
  platform: string;
  price: number;
  currency: 'JPY' | 'USD';
  availability: boolean;
  shipping_cost?: number;
  seller?: string;
  last_updated: string;
}
```

### Alert Object

```typescript
interface Alert {
  id: string;
  product_id: string;
  type: 'price_drop' | 'historical_low' | 'stock_available' | 'any_change';
  threshold?: number; // For price-based alerts
  enabled: boolean;
  created_at: string;
  last_triggered?: string;
}
```

## Caching

The API implements caching to improve performance:

- **Product details**: 30 minutes
- **Price history**: 1 hour
- **Search results**: 5 minutes
- **User preferences**: 10 minutes

Cache headers are included in responses:
- `Cache-Control`: Cache directives
- `ETag`: Entity tag for validation
- `Last-Modified`: Last modification time

## SDKs and Libraries

### JavaScript/TypeScript

```bash
npm install @yabaii/api-client
```

```typescript
import { YabaiiAPI } from '@yabaii/api-client';

const api = new YabaiiAPI({
  baseURL: 'https://api.yabaii.day',
  apiKey: 'your-api-key'
});

const results = await api.search.products({
  query: 'iPhone 13',
  category: 'electronics',
  limit: 20
});
```

### Python

```bash
pip install yabaii-python
```

```python
from yabaii import YabaiiAPI

api = YabaiiAPI(
    base_url='https://api.yabaii.day',
    api_key='your-api-key'
)

results = api.search.products(
    query='iPhone 13',
    category='electronics',
    limit=20
)
```

## Webhooks

Configure webhooks to receive real-time notifications:

### Price Drop Webhook

```json
{
  "event": "price_drop",
  "data": {
    "product_id": "prod_123",
    "product_name": "iPhone 13",
    "old_price": 100000,
    "new_price": 85000,
    "discount_percentage": 15,
    "platform": "amazon",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Stock Alert Webhook

```json
{
  "event": "stock_available",
  "data": {
    "product_id": "prod_456",
    "product_name": "Nintendo Switch",
    "platform": "rakuten",
    "in_stock": true,
    "quantity": 5,
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## Support

- **Documentation**: https://docs.yabaii.day
- **API Status**: https://status.yabaii.day
- **Support Email**: api-support@yabaii.day
- **Developer Discord**: https://discord.gg/yabaii

## Changelog

### v1.0.0 (2024-01-01)
- Initial API release
- Product search and comparison
- Price tracking and alerts
- Deal recommendations
- User authentication and preferences

### v1.1.0 (2024-01-15)
- Added autocomplete endpoint
- Enhanced filtering options
- Improved error messages
- Performance optimizations

### v1.2.0 (2024-02-01)
- Webhook support
- Advanced analytics
- Batch operations
- Enhanced caching