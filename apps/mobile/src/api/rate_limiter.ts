/**
 * API Rate Limiter with Exponential Backoff
 * Prevents API abuse and handles rate limiting gracefully
 */

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  retryAfterBase?: number;
  maxRetryDelay?: number;
  jitter?: boolean;
}

export interface RateLimitState {
  requests: number;
  windowStart: number;
  blocked: boolean;
  retryAfter?: number;
  resetTime?: number;
}

export interface RequestInfo {
  endpoint: string;
  method: string;
  timestamp: number;
  retryCount?: number;
}

export class RateLimiter {
  private static instance: RateLimiter;
  private states: Map<string, RateLimitState> = new Map();
  private requestHistory: RequestInfo[] = [];
  private defaultConfig: RateLimitConfig;

  private constructor() {
    this.defaultConfig = {
      maxRequests: 100,
      windowMs: 60000, // 1 minute
      retryAfterBase: 1000, // 1 second
      maxRetryDelay: 30000, // 30 seconds
      jitter: true,
    };
  }

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  /**
   * Check if a request is allowed
   */
  isAllowed(key: string, config: Partial<RateLimitConfig> = {}): {
    allowed: boolean;
    retryAfter?: number;
    remaining?: number;
    resetTime?: number;
  } {
    const finalConfig = { ...this.defaultConfig, ...config };
    const state = this.getState(key, finalConfig);
    const now = Date.now();

    // Reset window if expired
    if (now - state.windowStart > finalConfig.windowMs) {
      state.requests = 0;
      state.windowStart = now;
      state.blocked = false;
      state.retryAfter = undefined;
    }

    // Check if currently blocked for retry
    if (state.blocked && state.retryAfter) {
      if (now < state.retryAfter) {
        return {
          allowed: false,
          retryAfter: state.retryAfter - now,
          resetTime: state.windowStart + finalConfig.windowMs,
        };
      } else {
        // Unblock after retry delay
        state.blocked = false;
        state.retryAfter = undefined;
      }
    }

    // Check rate limit
    if (state.requests >= finalConfig.maxRequests) {
      const retryAfter = this.calculateRetryAfter(state, finalConfig);
      state.blocked = true;
      state.retryAfter = now + retryAfter;

      return {
        allowed: false,
        retryAfter,
        resetTime: state.windowStart + finalConfig.windowMs,
      };
    }

    // Allow request
    state.requests++;
    state.resetTime = state.windowStart + finalConfig.windowMs;

    return {
      allowed: true,
      remaining: finalConfig.maxRequests - state.requests,
      resetTime: state.resetTime,
    };
  }

  /**
   * Record a failed request for backoff calculation
   */
  recordFailure(key: string, endpoint: string, method: string, error?: any): void {
    const now = Date.now();
    const request: RequestInfo = {
      endpoint,
      method,
      timestamp: now,
    };

    // Add to request history
    this.requestHistory.push(request);

    // Clean old history (keep last 1000 requests)
    if (this.requestHistory.length > 1000) {
      this.requestHistory = this.requestHistory.slice(-1000);
    }

    // Check if this is a rate limit error
    if (error?.status === 429 || error?.response?.status === 429) {
      const state = this.states.get(key);
      if (state) {
        const retryAfter = error?.response?.headers?.['retry-after'];
        if (retryAfter) {
          state.retryAfter = now + (parseInt(retryAfter) * 1000);
        } else {
          state.retryAfter = now + this.calculateRetryAfter(state, this.defaultConfig);
        }
        state.blocked = true;
      }
    }
  }

  /**
   * Calculate delay with exponential backoff
   */
  calculateRetryDelay(
    key: string,
    attempt: number,
    config: Partial<RateLimitConfig> = {}
  ): number {
    const finalConfig = { ...this.defaultConfig, ...config };
    const baseDelay = finalConfig.retryAfterBase || 1000;
    const maxDelay = finalConfig.maxRetryDelay || 30000;

    // Exponential backoff: base * 2^attempt
    let delay = baseDelay * Math.pow(2, attempt);

    // Add jitter if enabled
    if (finalConfig.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    // Cap at maximum delay
    return Math.min(delay, maxDelay);
  }

  /**
   * Get current state for a key
   */
  getState(key: string, config: RateLimitConfig): RateLimitState {
    if (!this.states.has(key)) {
      this.states.set(key, {
        requests: 0,
        windowStart: Date.now(),
        blocked: false,
      });
    }
    return this.states.get(key)!;
  }

  /**
   * Get statistics for monitoring
   */
  getStatistics(): {
    totalStates: number;
    blockedStates: number;
    totalRequests: number;
    requestHistory: number;
    failureRate: number;
  } {
    const blockedStates = Array.from(this.states.values()).filter(s => s.blocked).length;
    const totalRequests = Array.from(this.states.values()).reduce((sum, s) => sum + s.requests, 0);

    // Calculate failure rate from recent history
    const recentHistory = this.requestHistory.filter(r => Date.now() - r.timestamp < 300000); // Last 5 minutes
    const failureCount = recentHistory.filter(r => r.retryCount && r.retryCount > 0).length;
    const failureRate = recentHistory.length > 0 ? failureCount / recentHistory.length : 0;

    return {
      totalStates: this.states.size,
      blockedStates,
      totalRequests,
      requestHistory: this.requestHistory.length,
      failureRate,
    };
  }

  /**
   * Reset state for a key
   */
  reset(key: string): void {
    this.states.delete(key);
  }

  /**
   * Reset all states
   */
  resetAll(): void {
    this.states.clear();
    this.requestHistory = [];
  }

  /**
   * Clean up expired states
   */
  cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, state] of this.states) {
      if (now - state.windowStart > this.defaultConfig.windowMs * 10) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.states.delete(key));

    // Clean old request history
    this.requestHistory = this.requestHistory.filter(
      r => now - r.timestamp < 3600000 // Keep last hour
    );
  }

  /**
   * Calculate retry after time for rate limiting
   */
  private calculateRetryAfter(state: RateLimitState, config: RateLimitConfig): number {
    const baseDelay = config.retryAfterBase || 1000;

    // Use exponential backoff based on consecutive blocks
    const consecutiveBlocks = Math.floor(state.requests / config.maxRequests);
    let delay = baseDelay * Math.pow(2, consecutiveBlocks);

    // Add jitter
    if (config.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    // Cap at maximum
    return Math.min(delay, config.maxRetryDelay || 30000);
  }
}

// Enhanced fetch wrapper with rate limiting
export interface RateLimitedFetchOptions extends RequestInit {
  rateLimitKey?: string;
  rateLimitConfig?: Partial<RateLimitConfig>;
  retryOnRateLimit?: boolean;
  maxRetries?: number;
}

export async function rateLimitedFetch(
  url: string,
  options: RateLimitedFetchOptions = {}
): Promise<Response> {
  const {
    rateLimitKey = url,
    rateLimitConfig = {},
    retryOnRateLimit = true,
    maxRetries = 3,
    ...fetchOptions
  } = options;

  const rateLimiter = RateLimiter.getInstance();
  let attempt = 0;

  while (attempt <= maxRetries) {
    // Check rate limit
    const rateCheck = rateLimiter.isAllowed(rateLimitKey, rateLimitConfig);

    if (!rateCheck.allowed) {
      if (!retryOnRateLimit || attempt >= maxRetries) {
        throw new RateLimitError(
          'Rate limit exceeded',
          rateCheck.retryAfter,
          rateCheck.resetTime
        );
      }

      // Wait for retry after or reset time
      const waitTime = Math.min(
        rateCheck.retryAfter || rateCheck.resetTime! - Date.now(),
        30000 // Max 30 second wait
      );

      await new Promise(resolve => setTimeout(resolve, waitTime));
      attempt++;
      continue;
    }

    try {
      // Make the request
      const response = await fetch(url, {
        ...fetchOptions,
        headers: {
          'X-RateLimit-Remaining': rateCheck.remaining?.toString() || '0',
          'X-RateLimit-Reset': rateCheck.resetTime?.toString() || '0',
          ...fetchOptions.headers,
        },
      });

      // Handle rate limit response
      if (response.status === 429) {
        rateLimiter.recordFailure(rateLimitKey, url, fetchOptions.method || 'GET', {
          status: 429,
          response: {
            headers: {
              'retry-after': response.headers.get('retry-after') || undefined,
            },
          },
        });

        if (!retryOnRateLimit || attempt >= maxRetries) {
          throw new RateLimitError(
            'Rate limit exceeded (429)',
            parseInt(response.headers.get('retry-after') || '60') * 1000,
            rateCheck.resetTime
          );
        }

        const retryDelay = rateLimiter.calculateRetryDelay(rateLimitKey, attempt, rateLimitConfig);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        attempt++;
        continue;
      }

      return response;

    } catch (error) {
      // Record failure for retry calculation
      rateLimiter.recordFailure(rateLimitKey, url, fetchOptions.method || 'GET', error);

      // Don't retry on non-rate-limit errors unless configured
      if (error instanceof RateLimitError && retryOnRateLimit && attempt < maxRetries) {
        const retryDelay = rateLimiter.calculateRetryDelay(rateLimitKey, attempt, rateLimitConfig);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        attempt++;
        continue;
      }

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number,
    public resetTime?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// React hook for rate limiting
export function useRateLimit(key: string, config: Partial<RateLimitConfig> = {}) {
  const rateLimiter = RateLimiter.getInstance();
  const [state, setState] = React.useState(() => rateLimiter.getState(key, { ...rateLimiter['defaultConfig'], ...config }));

  const checkLimit = React.useCallback(() => {
    const result = rateLimiter.isAllowed(key, config);
    setState(rateLimiter.getState(key, { ...rateLimiter['defaultConfig'], ...config }));
    return result;
  }, [key, config, rateLimiter]);

  const reset = React.useCallback(() => {
    rateLimiter.reset(key);
    setState(rateLimiter.getState(key, { ...rateLimiter['defaultConfig'], ...config }));
  }, [key, config, rateLimiter]);

  return {
    ...state,
    checkLimit,
    reset,
  };
}

// Export singleton instance
export const rateLimiter = RateLimiter.getInstance();

export default rateLimiter;