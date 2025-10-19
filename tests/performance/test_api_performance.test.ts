/**
 * API Performance Tests
 * Tests API response times and performance requirements
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import axios from 'axios';

// Performance thresholds (in milliseconds)
const PERFORMANCE_THRESHOLDS = {
  API_RESPONSE_TIME: 300, // 300ms for API endpoints
  DATABASE_QUERY: 100,    // 100ms for database queries
  CACHE_RETRIEVAL: 50,     // 50ms for cache retrieval
  EXTERNAL_API: 1000,      // 1000ms for external API calls
};

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

describe('API Performance Tests', () => {
  beforeAll(async () => {
    // Wait for API to be ready
    let retries = 30;
    while (retries > 0) {
      try {
        await axios.get(`${API_BASE_URL}/health`);
        break;
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        retries--;
      }
      if (retries === 0) {
        throw new Error('API server not available after 30 seconds');
      }
    }
  });

  describe('Health Check Performance', () => {
    it('should respond to health check within 100ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/health`);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(100);
      expect(response.status).toBe(200);
    });
  });

  describe('Search API Performance', () => {
    it('should handle basic search within 300ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/search?q=iPhone&limit=20`);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
      expect(response.data).toHaveProperty('data');
    });

    it('should handle search with filters within 300ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/search`, {
        params: {
          q: 'iPhone',
          category: 'electronics',
          minPrice: 5000,
          maxPrice: 50000,
          limit: 20,
          offset: 0,
        },
      });

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
      expect(response.status).toBe(200);
    });

    it('should handle autocomplete within 200ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/search/autocomplete?q=iPh`);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(200);
      expect(response.status).toBe(200);
    });
  });

  describe('Product API Performance', () => {
    it('should retrieve product details within 300ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/products/sample-product-id`);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
      expect(response.status).toBe(200);
    });

    it('should retrieve product price history within 300ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/products/sample-product-id/price-history`);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
      expect(response.status).toBe(200);
    });

    it('should retrieve similar products within 300ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/products/sample-product-id/similar`);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
      expect(response.status).toBe(200);
    });
  });

  describe('Price API Performance', () => {
    it('should get current prices within 300ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/prices/current`, {
        params: {
          productId: 'sample-product-id',
          platforms: ['amazon', 'rakuten'],
        },
      });

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
      expect(response.status).toBe(200);
    });

    it('should get price statistics within 300ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/prices/stats`, {
        params: {
          productId: 'sample-product-id',
          period: 30, // days
        },
      });

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
      expect(response.status).toBe(200);
    });
  });

  describe('Deals API Performance', () => {
    it('should get trending deals within 300ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/deals/trending`, {
        params: {
          category: 'all',
          limit: 20,
        },
      });

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
      expect(response.status).toBe(200);
    });

    it('should get personalized recommendations within 500ms', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/deals/recommendations`, {
        headers: {
          'Authorization': 'Bearer sample-token',
        },
        params: {
          userId: 'sample-user-id',
          limit: 10,
        },
      });

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(500); // Slightly higher threshold for personalized recommendations
      expect([200, 401]).toContain(response.status); // Accept both success and unauthorized for test
    });
  });

  describe('Concurrent Request Performance', () => {
    it('should handle 10 concurrent search requests', async () => {
      const requests = Array.from({ length: 10 }, (_, i) =>
        axios.get(`${API_BASE_URL}/api/v1/search?q=test${i}&limit=20`)
      );

      const startTime = Date.now();

      const responses = await Promise.all(requests);

      const totalTime = Date.now() - startTime;
      const averageTime = totalTime / requests.length;

      expect(averageTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME * 1.5); // Allow 50% overhead for concurrency
      expect(responses.every(r => r.status === 200)).toBe(true);
    });

    it('should handle 5 concurrent product detail requests', async () => {
      const productIds = ['prod1', 'prod2', 'prod3', 'prod4', 'prod5'];
      const requests = productIds.map(id =>
        axios.get(`${API_BASE_URL}/api/v1/products/${id}`)
      );

      const startTime = Date.now();

      const responses = await Promise.allSettled(requests);

      const totalTime = Date.now() - startTime;
      const successfulResponses = responses.filter(r =>
        r.status === 'fulfilled' && r.value.status === 200
      );

      // At least 3 out of 5 should succeed
      expect(successfulResponses.length).toBeGreaterThanOrEqual(3);
      expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME * 3); // Reasonable total time for batch
    });
  });

  describe('Cache Performance', () => {
    it('should have cache hit for repeated requests', async () => {
      const searchQuery = 'iPhone 13 test query';

      // First request (cache miss)
      const startTime1 = Date.now();
      const response1 = await axios.get(`${API_BASE_URL}/api/v1/search?q=${searchQuery}`);
      const time1 = Date.now() - startTime1;

      // Second request (should be cache hit)
      const startTime2 = Date.now();
      const response2 = await axios.get(`${API_BASE_URL}/api/v1/search?q=${searchQuery}`);
      const time2 = Date.now() - startTime2;

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(time2).toBeLessThan(time1 * 0.8); // Second request should be at least 20% faster
    });
  });

  describe('Error Handling Performance', () => {
    it('should handle invalid requests quickly', async () => {
      const startTime = Date.now();

      try {
        await axios.get(`${API_BASE_URL}/api/v1/products/invalid-product-id`);
      } catch (error) {
        // Expected to fail
      }

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME);
    });

    it('should handle rate limiting efficiently', async () => {
      const requests = Array.from({ length: 20 }, () =>
        axios.get(`${API_BASE_URL}/api/v1/search?q=test`).catch(e => e)
      );

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      // Even with rate limiting, responses should be handled efficiently
      expect(totalTime).toBeLessThan(5000); // 5 seconds max for 20 requests
      expect(responses.some(r => r.response?.status === 429)).toBe(true); // Some should be rate limited
    });
  });

  describe('Memory and Resource Performance', () => {
    it('should handle large response data efficiently', async () => {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/search`, {
        params: {
          q: 'electronics',
          limit: 100, // Large dataset
        },
      });

      const responseTime = Date.now() - startTime;
      const dataSize = JSON.stringify(response.data).length;

      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME * 2); // Allow more time for large data
      expect(response.status).toBe(200);
      expect(dataSize).toBeGreaterThan(1000); // Should have substantial data
    });

    it('should maintain performance under load', async () => {
      const burstRequests = Array.from({ length: 50 }, (_, i) =>
        axios.get(`${API_BASE_URL}/health`).catch(e => e)
      );

      const startTime = Date.now();
      const responses = await Promise.all(burstRequests);
      const totalTime = Date.now() - startTime;

      const successfulResponses = responses.filter(r =>
        r.status === 'fulfilled' && r.value.status === 200
      );

      // Should handle burst load reasonably well
      expect(successfulResponses.length).toBeGreaterThan(40); // At least 80% success rate
      expect(totalTime).toBeLessThan(10000); // 10 seconds max for burst
    });
  });
});

describe('Database Performance Tests', () => {
  // These tests would require database access
  // For now, we'll test through API endpoints

  it('should query product data within performance threshold', async () => {
    const startTime = Date.now();

    const response = await axios.get(`${API_BASE_URL}/api/v1/products/sample-product-id`);

    const responseTime = Date.now() - startTime;
    expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.DATABASE_QUERY * 2); // API overhead included
  });

  it('should handle pagination efficiently', async () => {
    const pageSizes = [10, 20, 50, 100];

    for (const pageSize of pageSizes) {
      const startTime = Date.now();

      const response = await axios.get(`${API_BASE_URL}/api/v1/search`, {
        params: {
          q: 'test',
          limit: pageSize,
        },
      });

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.API_RESPONSE_TIME * 1.5);
      expect(response.status).toBe(200);
    }
  });
});