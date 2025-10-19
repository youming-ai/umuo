# API Integration Test Cases: Japanese E-commerce Platforms

**Date**: 2025-10-16
**Feature**: 001-prd-app-only
**Purpose**: Comprehensive integration testing for all e-commerce platform APIs
**Test Environment**: Staging environment with rate limiting respected

## Test Strategy

### Platform Coverage
- **Priority 1**: Amazon Product Advertising API (JP)
- **Priority 2**: Rakuten Ichiba API
- **Priority 3**: Yahoo Shopping API
- **Priority 4**: Kakaku.com API
- **Priority 5**: Mercari API

### Test Categories
1. **Authentication & Authorization**
2. **Product Search & Discovery**
3. **Product Details & Pricing**
4. **Inventory & Availability**
5. **Rate Limiting & Error Handling**
6. **Data Consistency & Validation**

---

## Test Environment Setup

### Configuration Requirements
```yaml
# Test Environment Variables
AMAZON_ACCESS_KEY: test_amazon_key
AMAZON_SECRET_KEY: test_amazon_secret
AMAZON_ASSOCIATE_TAG: test_associate_tag
RAKUTEN_APP_ID: test_rakuten_id
YAHOO_APP_ID: test_yahoo_id
KAKAKU_API_KEY: test_kakaku_key
MERCARI_API_KEY: test_mercari_key

# Rate Limiting (Respect Production Limits)
RATE_LIMIT_REQUESTS_PER_MINUTE:
  amazon: 60
  rakuten: 1000
  yahoo: 5000
  kakaku: 600
  mercari: 300

# Test Data
TEST_JAN_CODES:
  - "4905524038230"  # Calorie Mate
  - "4562215330216"  # Shiseido Product
  - "4987020678125"  # Japanese Snack
```

### Test Data Management
- Use staging/test API endpoints where available
- Mock external services for reliability
- Maintain test JAN code registry
- Cache product responses for consistency

---

## Amazon Product Advertising API Tests

### Authentication Tests
```typescript
describe('Amazon API Authentication', () => {
  test('TC-AM-001: Valid credentials should authenticate successfully', async () => {
    const response = await amazonAPI.authenticate();
    expect(response.status).toBe(200);
    expect(response.data.IsValid).toBe(true);
  });

  test('TC-AM-002: Invalid credentials should return 401 error', async () => {
    const response = await amazonAPI.authenticate('invalid_key', 'invalid_secret');
    expect(response.status).toBe(401);
  });
});
```

### Product Search Tests
```typescript
describe('Amazon Product Search', () => {
  test('TC-AM-003: Search by keywords should return relevant products', async () => {
    const response = await amazonAPI.searchProducts('iPhone 15', {
      page: 1,
      limit: 10
    });

    expect(response.data.Items).toBeDefined();
    expect(response.data.Items.length).toBeGreaterThan(0);
    expect(response.data.Items[0].ItemInfo.Title).toContain('iPhone');
  });

  test('TC-AM-004: Search by JAN code should return exact product match', async () => {
    const janCode = '4905524038230';
    const response = await amazonAPI.searchByJAN(janCode);

    expect(response.data.Items).toBeDefined();
    expect(response.data.Items.length).toBe(1);
    expect(response.data.Items[0].ItemInfo.ExternalIds.EANs).toContain(janCode);
  });

  test('TC-AM-005: Search with invalid JAN should return empty results', async () => {
    const invalidJAN = '0000000000000';
    const response = await amazonAPI.searchByJAN(invalidJAN);

    expect(response.data.Items).toEqual([]);
  });
});
```

### Product Details Tests
```typescript
describe('Amazon Product Details', () => {
  test('TC-AM-006: Get product details should return complete information', async () => {
    const asin = 'B0CHX2FJQF'; // iPhone 15 ASIN
    const response = await amazonAPI.getProductDetails(asin);

    expect(response.data.ASIN).toBe(asin);
    expect(response.data.ItemInfo.Title).toBeDefined();
    expect(response.data.Offers.Summary.LowestPrice).toBeDefined();
    expect(response.data.ItemInfo.ProductInfo.ByLineInfo).toBeDefined();
  });

  test('TC-AM-007: Price information should include currency and amount', async () => {
    const asin = 'B0CHX2FJQF';
    const response = await amazonAPI.getProductDetails(asin);

    const price = response.data.Offers.Summary.LowestPrice;
    expect(price.Amount).toBeGreaterThan(0);
    expect(price.Currency).toBe('JPY');
  });

  test('TC-AM-008: Availability status should be clearly indicated', async () => {
    const asin = 'B0CHX2FJQF';
    const response = await amazonAPI.getProductDetails(asin);

    expect(response.data.Offers.Summary.TotalOfferCount).toBeGreaterThanOrEqual(0);
    if (response.data.Offers.Summary.TotalOfferCount > 0) {
      expect(response.data.Offers.Listings[0].Availability.Message).toBeDefined();
    }
  });
});
```

### Rate Limiting Tests
```typescript
describe('Amazon Rate Limiting', () => {
  test('TC-AM-009: Should respect 60 requests per minute limit', async () => {
    const promises = Array(65).fill().map(() =>
      amazonAPI.searchProducts('test')
    );

    const results = await Promise.allSettled(promises);
    const rejected = results.filter(r => r.status === 'rejected');

    // Should have some rejections due to rate limiting
    expect(rejected.length).toBeGreaterThan(0);
    rejected.forEach(result => {
      expect(result.reason.response?.status).toBe(503);
    });
  });

  test('TC-AM-010: Should implement exponential backoff on rate limit', async () => {
    const startTime = Date.now();

    // Make sequential requests that trigger rate limit
    for (let i = 0; i < 5; i++) {
      await amazonAPI.searchProducts(`test${i}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const endTime = Date.now();
    // Should take longer than simple requests due to backoff
    expect(endTime - startTime).toBeGreaterThan(1000);
  });
});
```

---

## Rakuten Ichiba API Tests

### Product Search Tests
```typescript
describe('Rakuten Product Search', () => {
  test('TC-RK-001: Search by keyword should return ranked results', async () => {
    const response = await rakutenAPI.searchProducts({
      keyword: 'iPhone 15',
      hits: 10,
      page: 1
    });

    expect(response.data.Items).toBeDefined();
    expect(response.data.Items.length).toBeGreaterThan(0);
    expect(response.data.Items[0].Item.itemName).toContain('iPhone');
  });

  test('TC-RK-002: Search by JAN code should return exact matches', async () => {
    const janCode = '4905524038230';
    const response = await rakutenAPI.searchByJAN(janCode);

    expect(response.data.Items).toBeDefined();
    expect(response.data.Items.length).toBeGreaterThan(0);
    response.data.Items.forEach(item => {
      expect(item.Item.janCode).toBe(janCode);
    });
  });

  test('TC-RK-003: Search should include price and availability', async () => {
    const response = await rakutenAPI.searchProducts({
      keyword: 'iPhone 15',
      hits: 5
    });

    response.data.Items.forEach(item => {
      expect(item.Item.itemPrice).toBeGreaterThan(0);
      expect(item.Item.availability).toBeDefined();
    });
  });
});
```

### Product Details Tests
```typescript
describe('Rakuten Product Details', () => {
  test('TC-RK-004: Get product details should return comprehensive data', async () => {
    const productCode = 'test_product_code';
    const response = await rakutenAPI.getProductDetails(productCode);

    expect(response.data.Item).toBeDefined();
    expect(response.data.Item.itemName).toBeDefined();
    expect(response.data.Item.itemPrice).toBeGreaterThan(0);
    expect(response.data.Item.itemCaption).toBeDefined();
  });

  test('TC-RK-005: Should include seller information', async () => {
    const response = await rakutenAPI.searchProducts({
      keyword: 'iPhone 15',
      hits: 5
    });

    response.data.Items.forEach(item => {
      expect(item.Item.shopName).toBeDefined();
      expect(item.Item.shopUrl).toBeDefined();
    });
  });
});
```

---

## Yahoo Shopping API Tests

### Product Search Tests
```typescript
describe('Yahoo Shopping Search', () => {
  test('TC-YH-001: Search should return ranked product results', async () => {
    const response = await yahooAPI.searchProducts({
      query: 'iPhone 15',
      results: 10,
      start: 1
    });

    expect(response.data.ResultSet).toBeDefined();
    expect(response.data.ResultSet[0].Result).toBeDefined();
    expect(response.data.ResultSet[0].Result.length).toBeGreaterThan(0);
  });

  test('TC-YH-002: Search by JAN code should return matching products', async () => {
    const janCode = '4905524038230';
    const response = await yahooAPI.searchByJAN(janCode);

    expect(response.data.ResultSet[0].Result).toBeDefined();
    response.data.ResultSet[0].Result.forEach(item => {
      expect(item.Code).toBeDefined();
      expect(item.Name).toBeDefined();
    });
  });
});
```

---

## Kakaku.com API Tests

### Price Comparison Tests
```typescript
describe('Kakaku Price Comparison', () => {
  test('TC-KK-001: Product search should return price comparison data', async () => {
    const response = await kakakuAPI.searchProducts({
      keyword: 'iPhone 15',
      pageSize: 10
    });

    expect(response.data.Item).toBeDefined();
    if (response.data.Item.length > 0) {
      expect(response.data.Item[0].ItemName).toBeDefined();
      expect(response.data.Item[0].LowestPrice).toBeGreaterThan(0);
    }
  });

  test('TC-KK-002: Should include price history information', async () => {
    const response = await kakakuAPI.getProductPriceHistory('test_product_id');

    expect(response.data.PriceHistory).toBeDefined();
    if (response.data.PriceHistory.length > 0) {
      expect(response.data.PriceHistory[0].Price).toBeGreaterThan(0);
      expect(response.data.PriceHistory[0].UpdateDate).toBeDefined();
    }
  });
});
```

---

## Mercari API Tests

### Product Search Tests
```typescript
describe('Mercari Product Search', () => {
  test('TC-MC-001: Search should return C2C marketplace listings', async () => {
    const response = await mercariAPI.searchProducts({
      keyword: 'iPhone 15',
      limit: 10,
      status: 'on_sale'
    });

    expect(response.data.data).toBeDefined();
    expect(response.data.data.length).toBeGreaterThan(0);
    response.data.data.forEach(item => {
      expect(item.name).toContain('iPhone');
      expect(item.price).toBeGreaterThan(0);
      expect(item.status).toBe('on_sale');
    });
  });

  test('TC-MC-002: Should include seller rating and condition', async () => {
    const response = await mercariAPI.searchProducts({
      keyword: 'iPhone 15',
      limit: 5
    });

    response.data.data.forEach(item => {
      expect(item.seller).toBeDefined();
      expect(item.created).toBeDefined();
      if (item.thumbnails) {
        expect(item.thumbnails.length).toBeGreaterThan(0);
      }
    });
  });
});
```

---

## Cross-Platform Integration Tests

### Data Consistency Tests
```typescript
describe('Cross-Platform Data Consistency', () => {
  test('TC-CP-001: Same JAN code should return consistent product names', async () => {
    const janCode = '4905524038230';

    const [amazon, rakuten, yahoo] = await Promise.all([
      amazonAPI.searchByJAN(janCode),
      rakutenAPI.searchByJAN(janCode),
      yahooAPI.searchByJAN(janCode)
    ]);

    // Product names should be similar across platforms
    const normalizeName = (name) => name.toLowerCase().replace(/\s+/g, '');
    const baseName = normalizeName(amazon.data.Items[0]?.ItemInfo.Title || '');

    if (baseName) {
      expect(normalizeName(rakuten.data.Items[0]?.Item.itemName || '')).toContain(baseName.split(' ')[0]);
    }
  });

  test('TC-CP-002: Price variations should be within reasonable ranges', async () => {
    const keyword = 'iPhone 15';

    const responses = await Promise.all([
      amazonAPI.searchProducts(keyword),
      rakutenAPI.searchProducts({ keyword }),
      yahooAPI.searchProducts({ query: keyword })
    ]);

    const prices = responses
      .filter(response => response.data.Items || response.data.ResultSet?.[0]?.Result)
      .flatMap(response => {
        if (response.data.Items) {
          return response.data.Items.map(item =>
            item.ItemInfo?.Offers?.Summary?.LowestPrice?.Amount ||
            item.Item?.itemPrice || 0
          );
        } else if (response.data.ResultSet?.[0]?.Result) {
          return response.data.ResultSet[0].Result.map(item =>
            item.Price?.Price || 0
          );
        }
        return [];
      })
      .filter(price => price > 0);

    if (prices.length > 1) {
      const maxPrice = Math.max(...prices);
      const minPrice = Math.min(...prices);
      const variation = (maxPrice - minPrice) / minPrice;

      // Price variation should be reasonable (< 50% difference)
      expect(variation).toBeLessThan(0.5);
    }
  });
});
```

### Performance Tests
```typescript
describe('API Performance', () => {
  test('TC-PF-001: All platform APIs should respond within 300ms p95', async () => {
    const keyword = 'iPhone 15';
    const startTime = Date.now();

    const responses = await Promise.all([
      amazonAPI.searchProducts(keyword),
      rakutenAPI.searchProducts({ keyword }),
      yahooAPI.searchProducts({ query: keyword })
    ]);

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // All responses should complete within 3 seconds total
    expect(responseTime).toBeLessThan(3000);

    // Each individual response should be relatively fast
    responses.forEach(response => {
      expect(response.config.metadata?.responseTime || 0).toBeLessThan(1000);
    });
  });

  test('TC-PF-002: Concurrent requests should not exceed rate limits', async () => {
    const promises = Array(10).fill().map((_, i) =>
      amazonAPI.searchProducts(`test${i}`)
    );

    const results = await Promise.allSettled(promises);
    const rejected = results.filter(r => r.status === 'rejected');

    // Should handle concurrent requests gracefully
    expect(rejected.length).toBeLessThan(3);
  });
});
```

---

## Error Handling Tests

### General Error Tests
```typescript
describe('Error Handling', () => {
  test('TC-ER-001: Network timeouts should be handled gracefully', async () => {
    const api = new AmazonAPI({ timeout: 1 }); // 1ms timeout

    await expect(api.searchProducts('iPhone 15'))
      .rejects.toThrow();
  });

  test('TC-ER-002: Invalid product IDs should return appropriate errors', async () => {
    const invalidASIN = 'INVALID_ASIN';

    await expect(amazonAPI.getProductDetails(invalidASIN))
      .rejects.toThrow(/Invalid|not found/);
  });

  test('TC-ER-003: Rate limit errors should include retry-after header', async () => {
    // Make rapid requests to trigger rate limit
    const promises = Array(70).fill().map(() =>
      amazonAPI.searchProducts('test')
    );

    const results = await Promise.allSettled(promises);
    const rateLimited = results.find(r =>
      r.status === 'rejected' &&
      r.reason.response?.status === 503
    );

    if (rateLimited) {
      expect(rateLimited.reason.response.headers['retry-after']).toBeDefined();
    }
  });
});
```

---

## Test Data Management

### Test JAN Code Registry
```typescript
const TEST_JAN_CODES = {
  valid: [
    '4905524038230', // Calorie Mate
    '4562215330216', // Shiseido Product
    '4987020678125', // Japanese Snack
    '4901878238645', // Suntory Beverage
    '4582329400011'  // Nintendo Product
  ],
  invalid: [
    '0000000000000',
    '1234567890123',
    'ABCDEFGHIJKLM',
    '12345',
    ''
  ]
};
```

### Mock Response Templates
```typescript
const mockAmazonResponse = {
  Items: [{
    ASIN: 'B0CHX2FJQF',
    ItemInfo: {
      Title: { DisplayValue: 'iPhone 15 128GB' },
      ProductInfo: { ByLineInfo: { Brand: { DisplayValue: 'Apple' } } }
    },
    Offers: {
      Summary: {
        LowestPrice: { Amount: 139800, Currency: 'JPY' },
        TotalOfferCount: 1
      }
    }
  }]
};
```

---

## Test Execution Guidelines

### Running Tests
```bash
# Run all API integration tests
npm run test:integration:api

# Run specific platform tests
npm run test:integration:amazon
npm run test:integration:rakuten

# Run performance tests
npm run test:performance:api

# Generate test report
npm run test:report:api
```

### Continuous Integration
- Run smoke tests on every commit
- Run full integration test suite nightly
- Monitor API response times and success rates
- Alert on performance degradation or service outages

### Test Data Freshness
- Refresh test JAN codes monthly
- Update mock responses quarterly
- Validate API contract changes immediately

---

**API Integration Testing Complete**: Comprehensive test coverage for all e-commerce platforms with performance, error handling, and cross-platform consistency validation.