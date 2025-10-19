import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// API Configuration
const API_BASE_URL = Constants.expoConfig?.extra?.apiDomain ||
  (__DEV__ ? 'http://localhost:3000/api/v1' : 'https://api.yabaii.day/api/v1');

// Storage keys
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

// API Error class
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class APIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Client-Version': Constants.expoConfig?.version || '1.0.0',
        'X-Platform': Platform.OS,
        'X-Platform-Version': Platform.Version?.toString(),
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      async (config) => {
        // Generate request ID
        const requestId = this.generateRequestId();
        config.headers['X-Request-ID'] = requestId;

        // Add auth token if available
        const token = await this.getStoredToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        // Log request in development
        if (__DEV__) {
          console.log(`🚀 API Request: ${config.method?.toUpperCase()} ${config.url}`);
        }

        return config;
      },
      (error) => {
        if (__DEV__) {
          console.error('Request interceptor error:', error);
        }
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        // Log response in development
        if (__DEV__) {
          console.log(`✅ API Response: ${response.status} ${response.config.url}`);
        }

        return response;
      },
      async (error) => {
        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

        // Log error in development
        if (__DEV__) {
          console.log(`❌ API Error: ${error.response?.status} ${originalRequest.url}`);
          console.log('Error details:', error.response?.data);
        }

        // Handle 401 - Unauthorized
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            const newToken = await this.refreshToken();
            if (newToken) {
              // Retry original request with new token
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              return this.client.request(originalRequest);
            }
          } catch (refreshError) {
            // Refresh failed, logout user
            await this.logout();
          }
        }

        // Convert to custom ApiError
        const apiError = new ApiError(
          error.response?.data?.error || error.message || 'Unknown error',
          error.response?.status,
          error.response?.data?.code,
          error.response?.data?.details
        );

        return Promise.reject(apiError);
      }
    );
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  private async getStoredToken(): Promise<string | null> {
    try {
      // Use SecureStore for production, AsyncStorage for development
      if (__DEV__) {
        return await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
      } else {
        return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      }
    } catch (error) {
      console.error('Failed to get stored token:', error);
      return null;
    }
  }

  private async setStoredToken(token: string): Promise<void> {
    try {
      if (__DEV__) {
        await AsyncStorage.setItem(ACCESS_TOKEN_KEY, token);
      } else {
        await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, token);
      }
    } catch (error) {
      console.error('Failed to set stored token:', error);
    }
  }

  private async getRefreshToken(): Promise<string | null> {
    try {
      if (__DEV__) {
        return await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
      } else {
        return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      }
    } catch (error) {
      console.error('Failed to get refresh token:', error);
      return null;
    }
  }

  private async refreshToken(): Promise<string | null> {
    try {
      const refreshToken = await this.getRefreshToken();
      if (!refreshToken) {
        return null;
      }

      const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
        refreshToken,
      });

      const { accessToken, refreshToken: newRefreshToken } = response.data.data;

      // Store new tokens
      await this.setStoredToken(accessToken);
      if (newRefreshToken) {
        if (__DEV__) {
          await AsyncStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
        } else {
          await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, newRefreshToken);
        }
      }

      return accessToken;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return null;
    }
  }

  private async logout(): Promise<void> {
    try {
      // Clear tokens
      if (__DEV__) {
        await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]);
      } else {
        await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
        await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      }

      // Optionally call server logout endpoint
      await this.client.post('/auth/logout');
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  }

  /**
   * Public authentication methods
   */
  async setTokens(accessToken: string, refreshToken?: string): Promise<void> {
    await this.setStoredToken(accessToken);
    if (refreshToken) {
      if (__DEV__) {
        await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      } else {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
      }
    }
  }

  async clearTokens(): Promise<void> {
    await this.logout();
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getStoredToken();
    return !!token;
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.post(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.put(url, data, config);
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.delete(url, config);
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.patch(url, data, config);
  }
}

export const apiClient = new APIClient();
export default apiClient;