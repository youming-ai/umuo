/**
 * Authentication API Contract Tests
 * Tests for authentication endpoints according to OpenAPI specification
 */

import request from 'supertest';
import { Hono } from 'hono';
import { routes } from '../../src/routes';

// Mock the user service
jest.mock('../../src/services/user_service');
import { UserService } from '../../src/services/user_service';

const app = new Hono();
app.route('/api/v1', routes);

describe('Authentication API Contract Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/register', () => {
    it('should register a new user successfully', async () => {
      const mockAuthResult = {
        user: {
          id: 'user_123',
          email: 'test@example.com',
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
        token: 'jwt_token_123',
        refreshToken: 'refresh_token_123',
        expiresAt: '2024-01-08T00:00:00Z'
      };

      (UserService.register as jest.Mock).mockResolvedValue(mockAuthResult);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123',
          preferences: {
            language: 'ja',
            currency: 'JPY'
          }
        });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: 'user_123',
            email: 'test@example.com',
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
          token: 'jwt_token_123',
          refreshToken: 'refresh_token_123',
          expiresAt: '2024-01-08T00:00:00Z'
        }
      });
      expect(UserService.register).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Password123',
        preferences: {
          language: 'ja',
          currency: 'JPY'
        }
      });
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Password123'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Invalid email address');
    });

    it('should return 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: '123' // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Password must be at least 8 characters');
    });

    it('should return 409 for existing user', async () => {
      (UserService.register as jest.Mock).mockRejectedValue(new Error('User with this email already exists'));

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'Password123'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        success: false,
        error: 'User with this email already exists'
      });
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          // Missing email and password
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /auth/login', () => {
    it('should authenticate user successfully', async () => {
      const mockAuthResult = {
        user: {
          id: 'user_456',
          email: 'login@example.com',
          preferences: {
            language: 'ja',
            currency: 'JPY'
          },
          subscription: {
            tier: 'free',
            features: ['basic_search']
          }
        },
        token: 'jwt_token_456',
        refreshToken: 'refresh_token_456',
        expiresAt: '2024-01-08T00:00:00Z'
      };

      (UserService.login as jest.Mock).mockResolvedValue(mockAuthResult);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@example.com',
          password: 'Password123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: 'user_456',
            email: 'login@example.com',
            preferences: {
              language: 'ja',
              currency: 'JPY'
            },
            subscription: {
              tier: 'free',
              features: ['basic_search']
            }
          },
          token: 'jwt_token_456',
          refreshToken: 'refresh_token_456',
          expiresAt: '2024-01-08T00:00:00Z'
        }
      });
      expect(UserService.login).toHaveBeenCalledWith({
        email: 'login@example.com',
        password: 'Password123'
      });
    });

    it('should return 401 for invalid credentials', async () => {
      (UserService.login as jest.Mock).mockRejectedValue(new Error('Invalid email or password'));

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'wrong@example.com',
          password: 'wrongpassword'
        });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid email or password'
      });
    });

    it('should return 400 for missing credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          // Missing password
          email: 'test@example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for empty email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: '',
          password: 'Password123'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('email is required');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh access token successfully', async () => {
      const mockRefreshResult = {
        user: {
          id: 'user_789',
          email: 'refresh@example.com'
        },
        token: 'new_jwt_token_789',
        refreshToken: 'new_refresh_token_789',
        expiresAt: '2024-01-08T00:00:00Z'
      };

      (UserService.refreshToken as jest.Mock).mockResolvedValue(mockRefreshResult);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'refresh_token_123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          user: {
            id: 'user_789',
            email: 'refresh@example.com'
          },
          token: 'new_jwt_token_789',
          refreshToken: 'new_refresh_token_789',
          expiresAt: '2024-01-08T00:00:00Z'
        }
      });
      expect(UserService.refreshToken).toHaveBeenCalledWith('refresh_token_123');
    });

    it('should return 401 for invalid refresh token', async () => {
      (UserService.refreshToken as jest.Mock).mockRejectedValue(new Error('Invalid refresh token'));

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'invalid_token'
        });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid or expired refresh token'
      });
    });

    it('should return 400 for missing refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({
          // Missing refreshToken
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Refresh token is required');
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout user successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid_token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Logout successful'
      });
    });

    it('should return 401 for missing authorization header', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Authorization header is required');
    });

    it('should return 401 for invalid authorization header format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'InvalidFormat token')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid authorization header format');
    });

    it('should return 401 for missing Bearer token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer ')
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Token is required');
    });
  });

  describe('GET /auth/me', () => {
    it('should return current user profile', async () => {
      const mockUser = {
        id: 'user_profile',
        email: 'profile@example.com',
        preferences: {
          language: 'ja',
          currency: 'JPY',
          notifications: {
            priceAlerts: true,
            stockAlerts: false,
            dealAlerts: true
          }
        },
        subscription: {
          tier: 'premium',
          features: ['advanced_search', 'price_alerts']
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-15T00:00:00Z'
      };

      (UserService.getUserById as jest.Mock).mockResolvedValue(mockUser);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer valid_token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          user: {
            id: 'user_profile',
            email: 'profile@example.com',
            preferences: {
              language: 'ja',
              currency: 'JPY',
              notifications: {
                priceAlerts: true,
                stockAlerts: false,
                dealAlerts: true
              }
            },
            subscription: {
              tier: 'premium',
              features: ['advanced_search', 'price_alerts']
            },
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-15T00:00:00Z'
          }
        }
      });
    });

    it('should return 401 for unauthorized request', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 when user not found', async () => {
      (UserService.getUserById as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer token_for_nonexistent_user');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: 'User not found'
      });
    });
  });

  describe('PUT /auth/me', () => {
    it('should update user profile successfully', async () => {
      const updatedUser = {
        id: 'user_update',
        email: 'updated@example.com',
        preferences: {
          language: 'en',
          currency: 'USD',
          notifications: {
            priceAlerts: false,
            stockAlerts: true,
            dealAlerts: false
          }
        },
        updatedAt: '2024-01-15T00:00:00Z'
      };

      (UserService.updateUser as jest.Mock).mockResolvedValue(updatedUser);

      const response = await request(app)
        .put('/api/v1/auth/me')
        .set('Authorization', 'Bearer valid_token')
        .send({
          preferences: {
            language: 'en',
            currency: 'USD'
          }
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: {
            id: 'user_update',
            email: 'updated@example.com',
            preferences: {
              language: 'en',
              currency: 'USD',
              notifications: {
                priceAlerts: false,
                stockAlerts: true,
                dealAlerts: false
              }
            },
            updatedAt: '2024-01-15T00:00:00Z'
          }
        }
      });
      expect(UserService.updateUser).toHaveBeenCalledWith('user_id_from_token', {
        preferences: {
          language: 'en',
          currency: 'USD'
        }
      });
    });

    it('should return 401 for unauthorized update', async () => {
      const response = await request(app)
        .put('/api/v1/auth/me')
        .send({
          preferences: { language: 'en' }
        });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid update data', async () => {
      const response = await request(app)
        .put('/api/v1/auth/me')
        .set('Authorization', 'Bearer valid_token')
        .send({
          preferences: {
            language: 'invalid_language' // Invalid language code
          }
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 409 when email already exists', async () => {
      (UserService.updateUser as jest.Mock).mockRejectedValue(new Error('Email already exists'));

      const response = await request(app)
        .put('/api/v1/auth/me')
        .set('Authorization', 'Bearer valid_token')
        .send({
          email: 'existing@example.com'
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        success: false,
        error: 'Email already exists'
      });
    });
  });

  describe('POST /auth/change-password', () => {
    it('should change password successfully', async () => {
      (UserService.changePassword as jest.Mock).mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', 'Bearer valid_token')
        .send({
          currentPassword: 'OldPassword123',
          newPassword: 'NewPassword123'
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Password changed successfully'
      });
      expect(UserService.changePassword).toHaveBeenCalledWith('user_id_from_token', {
        currentPassword: 'OldPassword123',
        newPassword: 'NewPassword123'
      });
    });

    it('should return 401 for unauthorized request', async () => {
      const response = await request(app)
        .post('/api/v1/auth/change-password')
        .send({
          currentPassword: 'OldPassword123',
          newPassword: 'NewPassword123'
        });

      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', 'Bearer valid_token')
        .send({
          currentPassword: 'OldPassword123',
          newPassword: 'weak' // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Password must be at least 8 characters');
    });

    it('should return 400 for incorrect current password', async () => {
      (UserService.changePassword as jest.Mock).mockRejectedValue(new Error('Current password is incorrect'));

      const response = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', 'Bearer valid_token')
        .send({
          currentPassword: 'WrongPassword',
          newPassword: 'NewPassword123'
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Current password is incorrect'
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should handle rate limiting for authentication attempts', async () => {
      // Mock multiple rapid login attempts
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'ratelimit@example.com',
            password: 'Password123'
          });
      }

      // The 6th attempt should be rate limited
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'ratelimit@example.com',
          password: 'Password123'
        });

      expect(response.status).toBe(429);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Too many authentication attempts');
    });
  });

  describe('Response Schema Validation', () => {
    it('should return correct response schema for successful operations', async () => {
      const mockAuthResult = {
        user: {
          id: 'user_schema',
          email: 'schema@example.com',
          preferences: {
            language: 'ja',
            currency: 'JPY'
          },
          subscription: {
            tier: 'free',
            features: ['basic_search']
          }
        },
        token: 'schema_token',
        refreshToken: 'schema_refresh',
        expiresAt: '2024-01-08T00:00:00Z'
      };

      (UserService.login as jest.Mock).mockResolvedValue(mockAuthResult);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'schema@example.com',
          password: 'Password123'
        });

      expect(response.status).toBe(200);

      // Validate response structure matches OpenAPI schema
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('data');

      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data).toHaveProperty('expiresAt');

      expect(response.body.data.user).toHaveProperty('id');
      expect(response.body.data.user).toHaveProperty('email');
      expect(response.body.data.user).toHaveProperty('preferences');
      expect(response.body.data.user).toHaveProperty('subscription');
    });

    it('should return error response schema for failed operations', async () => {
      (UserService.login as jest.Mock).mockRejectedValue(new Error('Authentication failed'));

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'error@example.com',
          password: 'WrongPassword'
        });

      expect(response.status).toBe(401);

      // Validate error response structure
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('error');
      expect(response.body.success).toBe(false);
      expect(typeof response.body.error).toBe('string');
    });
  });
});