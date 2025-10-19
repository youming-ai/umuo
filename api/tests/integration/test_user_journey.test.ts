/**
 * Complete User Journey Integration Tests
 * Tests end-to-end user workflows from registration to product interaction
 */

import request from 'supertest';
import { Hono } from 'hono';
import { routes } from '../../src/routes';

// Mock all services
jest.mock('../../src/services/user_service');
jest.mock('../../src/services/search_service');
jest.mock('../../src/services/notification_service');
jest.mock('../../src/services/alert_service');

import { UserService } from '../../src/services/user_service';
import { SearchService } from '../../src/services/search_service';
import { NotificationService } from '../../src/services/notification_service';
import { AlertService } from '../../src/services/alert_service';

const app = new Hono();
app.route('/api/v1', routes);

describe('Complete User Journey Integration Tests', () => {
  let authToken: string;
  let refreshToken: string;
  let userId: string;
  let productId: string;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('New User Registration and Onboarding Journey', () => {
    it('should complete full registration and initial setup', async () => {
      // Step 1: User Registration
      const mockAuthResult = {
        user: {
          id: 'user_journey_123',
          email: 'journey@example.com',
          preferences: {
            language: 'ja',
            currency: 'JPY',
            notifications: {
              priceAlerts: true,
              stockAlerts: true,
              dealAlerts: false
            }
          },
          subscription: {
            tier: 'free',
            features: ['basic_search'],
            expiresAt: '2025-01-01T00:00:00Z',
            autoRenew: false
          },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        token: 'journey_jwt_token_123',
        refreshToken: 'journey_refresh_token_123',
        expiresAt: '2024-01-08T00:00:00Z'
      };

      (UserService.register as jest.Mock).mockResolvedValue(mockAuthResult);

      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'journey@example.com',
          password: 'SecurePassword123',
          preferences: {
            language: 'ja',
            currency: 'JPY',
            notifications: {
              priceAlerts: true,
              stockAlerts: true,
              dealAlerts: false
            }
          }
        });

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.body.success).toBe(true);
      expect(registerResponse.body.data.user.email).toBe('journey@example.com');

      // Store auth tokens for subsequent requests
      authToken = registerResponse.body.data.token;
      refreshToken = registerResponse.body.data.refreshToken;
      userId = registerResponse.body.data.user.id;

      expect(UserService.register).toHaveBeenCalledWith({
        email: 'journey@example.com',
        password: 'SecurePassword123',
        preferences: {
          language: 'ja',
          currency: 'JPY',
          notifications: {
            priceAlerts: true,
            stockAlerts: true,
            dealAlerts: false
          }
        }
      });

      // Step 2: Verify user can access protected endpoints
      const profileResponse = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.data.user.id).toBe(userId);

      // Step 3: Update user preferences
      const updateResponse = await request(app)
        .put('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          preferences: {
            language: 'ja',
            currency: 'JPY',
            notifications: {
              priceAlerts: true,
              stockAlerts: true,
              dealAlerts: true, // Enable deal alerts
              quietHours: {
                enabled: true,
                start: '22:00',
                end: '08:00'
              }
            }
          }
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.success).toBe(true);
    });
  });

  describe('Product Discovery and Search Journey', () => {
    beforeEach(() => {
      authToken = 'journey_jwt_token_123';
      userId = 'user_journey_123';
    });

    it('should search for products and get results', async () => {
      const mockSearchResults = {
        products: [
          {
            id: 'prod_search_1',
            name: 'iPhone 15 Pro',
            brand: 'Apple',
            category: {
              id: 'cat_electronics',
              name: { ja: 'エレクトロニクス' }
            },
            currentPrice: 120000,
            originalPrice: 140000,
            currency: 'JPY',
            platform: 'Amazon',
            availability: 'in_stock',
            image: 'https://example.com/iphone.jpg',
            rating: 4.5,
            reviewCount: 1234
          },
          {
            id: 'prod_search_2',
            name: 'Nintendo Switch',
            brand: 'Nintendo',
            category: {
              id: 'cat_gaming',
              name: { ja: 'ゲーム' }
            },
            currentPrice: 29980,
            originalPrice: 32980,
            currency: 'JPY',
            platform: 'Rakuten',
            availability: 'in_stock',
            image: 'https://example.com/switch.jpg',
            rating: 4.8,
            reviewCount: 5678
          }
        ],
        total: 2,
        page: 1,
        limit: 20,
        hasMore: false,
        facets: {
          categories: [
            { name: 'エレクトロニクス', count: 1 },
            { name: 'ゲーム', count: 1 }
          ],
          priceRanges: [
            { range: '¥10,000-¥50,000', count: 1 },
            { range: '¥20,000-¥30,000', count: 1 }
          ]
        },
        searchTime: 150
      };

      (SearchService.search as jest.Mock).mockResolvedValue(mockSearchResults);

      const response = await request(app)
        .get('/api/v1/search')
        .query({
          q: 'iPhone',
          page: 1,
          limit: 20
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.products).toHaveLength(2);
      expect(response.body.data.products[0].name).toBe('iPhone 15 Pro');
      expect(response.body.data.products[1].name).toBe('Nintendo Switch');

      // Store product ID for subsequent tests
      productId = response.body.data.products[0].id;

      expect(SearchService.search).toHaveBeenCalledWith({
        query: 'iPhone',
        page: 1,
        limit: 20
      });
    });

    it('should get detailed product information', async () => {
      const mockProductDetails = {
        product: {
          id: productId,
          name: 'iPhone 15 Pro',
          brand: 'Apple',
          description: 'Latest iPhone with A17 Pro chip',
          category: {
            id: 'cat_electronics',
            name: { ja: 'エレクトロニクス' }
          },
          images: [
            {
              url: 'https://example.com/iphone1.jpg',
              alt: { ja: 'iPhone 15 Pro 正面' },
              width: 800,
              height: 600
            }
          ],
          specifications: [
            {
              name: 'ディスプレイ',
              value: '6.1インチ',
              unit: 'inch'
            },
            {
              name: 'ストレージ',
              value: '256GB',
              unit: 'GB'
            }
          ],
          identifiers: {
            jan: '4901234567890',
            asin: 'B0DHPX9J1R'
          },
          status: 'active'
        },
        offers: [
          {
            id: 'offer_amazon',
            platform: 'Amazon',
            title: 'iPhone 15 Pro 256GB',
            price: 120000,
            originalPrice: 140000,
            currency: 'JPY',
            availability: 'in_stock',
            seller: 'Amazon Japan',
            url: 'https://amazon.co.jp/dp/B0DHPX9J1R',
            rating: 4.5,
            reviewCount: 1234
          },
          {
            id: 'offer_rakuten',
            platform: 'Rakuten',
            title: 'iPhone 15 Pro 256GB',
            price: 118000,
            originalPrice: 140000,
            currency: 'JPY',
            availability: 'in_stock',
            seller: 'Rakuten Mobile',
            url: 'https://rakuten.co.jp/iphone',
            rating: 4.4,
            reviewCount: 856
          }
        ],
        priceHistory: [
          {
            date: '2024-01-01',
            price: 140000
          },
          {
            date: '2024-01-15',
            price: 130000
          },
          {
            date: '2024-02-01',
            price: 120000
          }
        ],
        recommendations: []
      };

      // Mock get product by ID
      jest.spyOn(SearchService, 'getProductById').mockResolvedValue(mockProductDetails.product);

      const response = await request(app)
        .get(`/api/v1/products/${productId}`);

      expect(response.status).toBe(200);
      expect(response.body.data.product.name).toBe('iPhone 15 Pro');
      expect(response.body.data.offers).toHaveLength(2);
      expect(response.body.data.priceHistory).toHaveLength(3);
    });
  });

  describe('Alert Creation and Management Journey', () => {
    beforeEach(() => {
      authToken = 'journey_jwt_token_123';
      userId = 'user_journey_123';
      productId = 'prod_search_1';
    });

    it('should create price drop alert and receive notifications', async () => {
      // Step 1: Create price drop alert
      const mockAlert = {
        id: 'alert_journey_1',
        userId: userId,
        productId: productId,
        type: 'price_drop',
        condition: { threshold: 110000 },
        active: true,
        createdAt: '2024-02-01T00:00:00Z'
      };

      (AlertService.createAlert as jest.Mock).mockResolvedValue(mockAlert);

      const createAlertResponse = await request(app)
        .post('/api/v1/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          productId: productId,
          type: 'price_drop',
          condition: {
            threshold: 110000
          },
          active: true
        });

      expect(createAlertResponse.status).toBe(201);
      expect(createAlertResponse.body.success).toBe(true);
      expect(createAlertResponse.body.data.alert.type).toBe('price_drop');

      // Step 2: Verify alert appears in user's alerts list
      const mockUserAlerts = [mockAlert];
      (AlertService.getUserAlerts as jest.Mock).mockResolvedValue(mockUserAlerts);

      const alertsResponse = await request(app)
        .get('/api/v1/alerts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(alertsResponse.status).toBe(200);
      expect(alertsResponse.body.data.alerts).toHaveLength(1);
      expect(alertsResponse.body.data.alerts[0].productId).toBe(productId);

      // Step 3: Simulate price drop notification
      const mockNotification = {
        id: 'notif_journey_1',
        userId: userId,
        type: 'price_drop',
        title: '価格下落アラート',
        message: 'iPhone 15 Proが110,000円以下になりました！',
        data: {
          productId: productId,
          oldPrice: 120000,
          newPrice: 108000,
          discount: 12000
        }
      };

      (NotificationService.sendNotification as jest.Mock).mockResolvedValue({
        success: true,
        messageId: 'notif_msg_123'
      });

      // Simulate price update that triggers alert
      const updatedAlert = {
        ...mockAlert,
        triggered: true,
        triggeredAt: '2024-02-02T00:00:00Z'
      };

      (AlertService.checkAndTriggerAlerts as jest.Mock).mockResolvedValue([updatedAlert]);

      expect(NotificationService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: userId,
          type: 'price_drop',
          title: expect.any(String),
          message: expect.any(String)
        })
      );
    });

    it('should manage multiple alerts for different products', async () => {
      // Create alerts for multiple products
      const products = [
        { id: 'prod_1', name: 'iPhone 15 Pro' },
        { id: 'prod_2', name: 'Nintendo Switch' },
        { id: 'prod_3', name: 'MacBook Air' }
      ];

      const createdAlerts = [];
      for (const product of products) {
        const mockAlert = {
          id: `alert_${product.id}`,
          userId: userId,
          productId: product.id,
          type: 'price_drop' as const,
          condition: { threshold: product.id === 'prod_1' ? 110000 : 25000 },
          active: true
        };

        (AlertService.createAlert as jest.Mock).mockResolvedValue(mockAlert);
        createdAlerts.push(mockAlert);
      }

      // Get all user alerts
      (AlertService.getUserAlerts as jest.Mock).mockResolvedValue(createdAlerts);

      const response = await request(app)
        .get('/api/v1/alerts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.alerts).toHaveLength(3);
      expect(response.body.data.alerts.map((a: any) => a.productId)).toEqual(
        expect.arrayContaining(['prod_1', 'prod_2', 'prod_3'])
      );
    });
  });

  describe('Barcode Scanning Journey', () => {
    beforeEach(() => {
      authToken = 'journey_jwt_token_123';
      userId = 'user_journey_123';
    });

    it('should scan barcode and find product information', async () => {
      // Step 1: Scan JAN barcode
      const mockBarcodeResolve = {
        product: {
          id: 'prod_barcode_1',
          name: 'カロリーメイト',
          brand: 'Otsuka Pharmaceutical',
          category: {
            id: 'cat_food',
            name: { ja: '食品・飲料' }
          },
          currentPrice: 150,
          currency: 'JPY',
          image: 'https://example.com/calorie.jpg',
          specifications: [
            { name: '内容量', value: '50mL' },
            { name: 'カロリー', value: '40kcal' }
          ]
        }
      };

      (SearchService.resolveBarcode as jest.Mock).mockResolvedValue(mockBarcodeResolve);

      const response = await request(app)
        .get('/api/v1/barcode/resolve')
        .query({
          code: '4901234567890',
          type: 'JAN'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.product.name).toBe('カロリーメイト');
      expect(response.body.data.product.brand).toBe('Otsuka Pharmaceutical');

      // Step 2: Get price history for scanned product
      const mockPriceHistory = {
        history: [
          {
            productId: 'prod_barcode_1',
            platformId: 'amazon',
            price: 160,
            currency: 'JPY',
            recordedAt: '2024-01-01T00:00:00Z'
          },
          {
            productId: 'prod_barcode_1',
            platformId: 'amazon',
            price: 150,
            currency: 'JPY',
            recordedAt: '2024-02-01T00:00:00Z'
          }
        ],
        statistics: {
          productId: 'prod_barcode_1',
          platformId: 'amazon',
          period: 30,
          currentPrice: 150,
          averagePrice: 155,
          lowestPrice: 150,
          highestPrice: 160,
          priceChangePercent: -6.25,
          trend: 'falling'
        }
      };

      (SearchService.getPriceHistory as jest.Mock).mockResolvedValue(mockPriceHistory);

      const priceHistoryResponse = await request(app)
        .get('/api/v1/prices/prod_barcode_1/history')
        .query({ days: 30 });

      expect(priceHistoryResponse.status).toBe(200);
      expect(priceHistoryResponse.body.data.statistics.lowestPrice).toBe(150);
      expect(priceHistoryResponse.body.data.statistics.trend).toBe('falling');
    });
  });

  describe('User Settings and Preferences Journey', () => {
    beforeEach(() => {
      authToken = 'journey_jwt_token_123';
      userId = 'user_journey_123';
    });

    it('should update notification preferences and settings', async () => {
      // Update notification preferences
      const mockUpdatedUser = {
        id: userId,
        email: 'journey@example.com',
        preferences: {
          language: 'en',
          currency: 'USD',
          notifications: {
            priceAlerts: false,
            stockAlerts: true,
            dealAlerts: true,
            quietHours: {
              enabled: true,
              start: '23:00',
              end: '07:00'
            }
          }
        },
        subscription: {
          tier: 'free',
          features: ['basic_search']
        },
        updatedAt: '2024-02-01T00:00:00Z'
      };

      (UserService.updateUser as jest.Mock).mockResolvedValue(mockUpdatedUser);

      const response = await request(app)
        .put('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          preferences: {
            language: 'en',
            currency: 'USD',
            notifications: {
              priceAlerts: false,
              stockAlerts: true,
              dealAlerts: true,
              quietHours: {
                enabled: true,
                start: '23:00',
                end: '07:00'
              }
            }
          }
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.preferences.language).toBe('en');
      expect(response.body.data.user.preferences.currency).toBe('USD');
      expect(response.body.data.user.notifications.priceAlerts).toBe(false);
    });

    it('should change password successfully', async () => {
      (UserService.changePassword as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'OldPassword123',
          newPassword: 'NewSecurePassword456'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Password changed successfully');
      expect(UserService.changePassword).toHaveBeenCalledWith(userId, {
        currentPassword: 'OldPassword123',
        newPassword: 'NewSecurePassword456'
      });
    });
  });

  describe('Data Export and Privacy Journey', () => {
    beforeEach(() => {
      authToken = 'journey_jwt_token_123';
      userId = 'user_journey_123';
    });

    it('should export user data including all activity', async () => {
      const mockExportData = {
        user: {
          id: userId,
          email: 'journey@example.com',
          preferences: {
            language: 'ja',
            currency: 'JPY'
          },
          subscription: {
            tier: 'free',
            features: ['basic_search']
          },
          createdAt: '2024-01-01T00:00:00Z',
          lastActiveAt: '2024-02-01T00:00:00Z'
        },
        searches: [
          {
            query: 'iPhone 15',
            timestamp: '2024-01-15T10:00:00Z',
            resultCount: 25,
            clickedProductId: 'prod_1'
          },
          {
            query: 'Nintendo Switch',
            timestamp: '2024-01-20T14:30:00Z',
            resultCount: 15
          }
        ],
        alerts: [
          {
            id: 'alert_export_1',
            type: 'price_drop',
            productId: 'prod_1',
            createdAt: '2024-01-10T00:00:00Z',
            triggered: false
          }
        ],
        watchlist: [
          {
            productId: 'prod_watch_1',
            addedAt: '2024-01-05T00:00:00Z',
            lastViewedAt: '2024-01-20T00:00:00Z'
          }
        ]
      };

      (UserService.exportUserData as jest.Mock).mockResolvedValue(mockExportData);

      const response = await request(app)
        .get('/api/v1/auth/export')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('searches');
      expect(response.body.data).toHaveProperty('alerts');
      expect(response.body.data).toHaveProperty('watchlist');
      expect(response.body.data.searches).toHaveLength(2);
      expect(response.body.data.alerts).toHaveLength(1);
    });

    it('should delete user account and all associated data', async () => {
      (UserService.deleteUser as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          password: 'ConfirmDelete123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Account deletion successful');
      expect(UserService.deleteUser).toHaveBeenCalledWith(userId, 'ConfirmDelete123');
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle session expiration gracefully', async () => {
      // Simulate expired token
      const expiredResponse = {
        success: false,
        error: 'Token has expired'
      };

      (UserService.refreshToken as jest.Mock).mockRejectedValue(new Error('Token has expired'));

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'expired_token'
        });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid or expired refresh token'
      });
    });

    it('should handle network failures with retry logic', async () => {
      // First request fails
      (SearchService.search as jest.Mock)
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          products: [
            {
              id: 'prod_retry_1',
              name: 'Retry Product',
              currentPrice: 10000,
              currency: 'JPY'
            }
          ],
          total: 1,
          page: 1,
          limit: 20,
          hasMore: false
        });

      // Retry logic would be implemented in the service layer
      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: 'Retry Product' });

      expect(response.status).toBe(200);
      expect(response.body.data.products[0].name).toBe('Retry Product');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large result sets efficiently', async () => {
      const mockLargeResults = {
        products: Array(50).fill(null).map((_, index) => ({
          id: `prod_large_${index}`,
          name: `Product ${index}`,
          currentPrice: 1000 * (index + 1),
          currency: 'JPY',
          platform: 'Amazon'
        })),
        total: 100,
        page: 1,
        limit: 50,
        hasMore: true,
        searchTime: 250
      };

      (SearchService.search as jest.Mock).mockResolvedValue(mockLargeResults);

      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: 'Large Search', limit: 50 });

      expect(response.status).toBe(200);
      expect(response.body.data.products).toHaveLength(50);
      expect(response.body.data.total).toBe(100);
      expect(response.body.data.hasMore).toBe(true);
    });

    it('should maintain response times under load', async () => {
      const startTime = Date.now();

      const mockQuickResults = {
        products: [
          {
            id: 'prod_perf_1',
            name: 'Performance Test Product',
            currentPrice: 10000,
            currency: 'JPY'
          }
        ],
        total: 1,
        page: 1,
        limit: 20,
        hasMore: false,
        searchTime: 50
      };

      (SearchService.search as jest.Mock).mockResolvedValue(mockQuickResults);

      const response = await request(app)
        .get('/api/v1/search')
        .query({ q: 'Performance Test' });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
    });
  });
});