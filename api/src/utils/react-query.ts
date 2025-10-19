/**
 * React Query API Response Utilities
 * Utilities for creating API responses optimized for React Query consumption
 */

import { ReactQueryResponse } from '@/middleware/react-query';

/**
 * Standard React Query response wrapper
 */
export function createReactQueryResponse<T>(
  data: T,
  options: {
    message?: string;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
      nextPage?: number;
    };
    cache?: {
      ttl: number;
      key: string;
      stale: boolean;
    };
  } = {}
): ReactQueryResponse<T> {
  return {
    data,
    success: true,
    message: options.message,
    timestamp: new Date().toISOString(),
    requestId: '', // Will be set by middleware
    pagination: options.pagination,
    cache: options.cache,
  };
}

/**
 * Paginated response helper
 */
export function createPaginatedResponse<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
  options: {
    message?: string;
    cache?: {
      ttl: number;
      key: string;
      stale: boolean;
    };
  } = {}
): ReactQueryResponse<T[]> {
  const hasMore = (page * limit) < total;
  const nextPage = hasMore ? page + 1 : undefined;

  return createReactQueryResponse(items, {
    message: options.message,
    pagination: {
      page,
      limit,
      total,
      hasMore,
      nextPage,
    },
    cache: options.cache,
  });
}

/**
 * Error response helper
 */
export function createReactQueryErrorResponse(
  error: string,
  code: string,
  statusCode: number = 500,
  options: {
    details?: any;
    requestId?: string;
  } = {}
): {
  success: false;
  error: string;
  code: string;
  timestamp: string;
  requestId?: string;
  details?: any;
} {
  return {
    success: false,
    error,
    code,
    timestamp: new Date().toISOString(),
    requestId: options.requestId,
    details: options.details,
  };
}

/**
 * Success response with metadata
 */
export function createSuccessResponse<T>(
  data: T,
  message?: string,
  metadata?: Record<string, any>
): ReactQueryResponse<T> {
  return createReactQueryResponse(data, {
    message,
    cache: metadata?.cache,
  });
}

/**
 * List response helper
 */
export function createListResponse<T>(
  items: T[],
  options: {
    message?: string;
    total?: number;
    cache?: {
      ttl: number;
      key: string;
      stale: boolean;
    };
  } = {}
): ReactQueryResponse<T[]> {
  return createReactQueryResponse(items, {
    message: options.message,
    cache: options.cache,
  });
}

/**
 * Empty response helper
 */
export function createEmptyResponse(message = 'No data found'): ReactQueryResponse<null> {
  return createReactQueryResponse(null, {
    message,
  });
}

/**
 * Validation error response
 */
export function createValidationError(
  errors: Record<string, string[]> | string,
  message = 'Validation failed'
) {
  const details = typeof errors === 'string' ? { general: [errors] } : errors;

  return createReactQueryErrorResponse(
    message,
    'VALIDATION_ERROR',
    400,
    { details }
  );
}

/**
 * Not found error response
 */
export function createNotFoundError(resource = 'Resource') {
  return createReactQueryErrorResponse(
    `${resource} not found`,
    'NOT_FOUND',
    404
  );
}

/**
 * Authentication error response
 */
export function createAuthError(message = 'Authentication required') {
  return createReactQueryErrorResponse(
    message,
    'AUTHENTICATION_ERROR',
    401
  );
}

/**
 * Authorization error response
 */
export function createAuthorizationError(message = 'Access denied') {
  return createReactQueryErrorResponse(
    message,
    'AUTHORIZATION_ERROR',
    403
  );
}

/**
 * Rate limit error response
 */
export function createRateLimitError(
  retryAfter: number,
  message = 'Rate limit exceeded'
) {
  return createReactQueryErrorResponse(
    message,
    'RATE_LIMIT_EXCEEDED',
    429,
    { retryAfter }
  );
}

/**
 * Database error response
 */
export function createDatabaseError(message = 'Database operation failed') {
  return createReactQueryErrorResponse(
    message,
    'DATABASE_ERROR',
    500
  );
}

/**
 * External service error response
 */
export function createExternalServiceError(
  service: string,
  message = 'External service unavailable'
) {
  return createReactQueryErrorResponse(
    message,
    'EXTERNAL_SERVICE_ERROR',
    502,
    { service }
  );
}

/**
 * Cache control utilities
 */
export const cacheControl = {
  /**
   * No caching headers
   */
  noCache() {
    return {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    };
  },

  /**
   * Short-term caching (1 minute)
   */
  shortTerm(maxAge: number = 60) {
    return {
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=30`,
    };
  },

  /**
   * Medium-term caching (5 minutes)
   */
  mediumTerm(maxAge: number = 300) {
    return {
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=60`,
    };
  },

  /**
   * Long-term caching (1 hour)
   */
  longTerm(maxAge: number = 3600) {
    return {
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=300`,
    };
  },

  /**
   * ETag headers
   */
  etag(value: string) {
    return {
      'ETag': `"${value}"`,
    };
  },

  /**
   * Last modified header
   */
  lastModified(date: Date) {
    return {
      'Last-Modified': date.toUTCString(),
    };
  },
};

/**
 * React Query specific headers
 */
export const reactQueryHeaders = {
  /**
   * Add React Query specific headers
   */
  addHeaders(response: Response, options: {
    requestId?: string;
    duration?: number;
    cache?: {
      ttl: number;
      key: string;
      stale: boolean;
    };
  } = {}): Response {
    // Add React Query headers
    response.headers.set('X-React-Query-Enabled', 'true');
    response.headers.set('X-React-Query-Version', '5.0.0');

    if (options.requestId) {
      response.headers.set('X-Request-ID', options.requestId);
    }

    if (options.duration) {
      response.headers.set('X-Response-Time', `${options.duration}ms`);
    }

    if (options.cache) {
      response.headers.set('X-React-Query-Cache-Key', options.cache.key);
      response.headers.set('X-React-Query-Cache-TTL', options.cache.ttl.toString());
      response.headers.set('X-React-Query-Cache-Stale', options.cache.stale.toString());
    }

    return response;
  },

  /**
   * Add pagination headers
   */
  addPaginationHeaders(response: Response, pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
    nextPage?: number;
  }): Response {
    response.headers.set('X-Pagination-Page', pagination.page.toString());
    response.headers.set('X-Pagination-Limit', pagination.limit.toString());
    response.headers.set('X-Pagination-Total', pagination.total.toString());
    response.headers.set('X-Pagination-Has-More', pagination.hasMore.toString());

    if (pagination.nextPage) {
      response.headers.set('X-Pagination-Next-Page', pagination.nextPage.toString());
    }

    return response;
  },

  /**
   * Add rate limit headers
   */
  addRateLimitHeaders(response: Response, rateLimit: {
    limit: number;
    remaining: number;
    reset: Date;
    window: number;
  }): Response {
    response.headers.set('X-Rate-Limit-Limit', rateLimit.limit.toString());
    response.headers.set('X-Rate-Limit-Remaining', rateLimit.remaining.toString());
    response.headers.set('X-Rate-Limit-Reset', rateLimit.reset.toISOString());
    response.headers.set('X-Rate-Limit-Window', rateLimit.window.toString());

    return response;
  },
};

/**
 * Response optimization utilities
 */
export const responseOptimization = {
  /**
   * Compress JSON response
   */
  compressJSON(data: any): string {
    // Simple JSON optimization - remove unnecessary whitespace
    return JSON.stringify(data);
  },

  /**
   * Add conditional request headers
   */
  addConditionalHeaders(response: Response, etag: string, lastModified?: Date): Response {
    response.headers.set('ETag', etag);

    if (lastModified) {
      response.headers.set('Last-Modified', lastModified.toUTCString());
    }

    return response;
  },

  /**
   * Handle conditional requests
   */
  handleConditionalRequest(
    ifNoneMatch?: string,
    ifModifiedSince?: string,
    currentETag?: string,
    currentLastModified?: Date
  ): { shouldReturn304: boolean } {
    const etagMatch = ifNoneMatch && currentETag && ifNoneMatch === currentETag;
    const modifiedMatch = ifModifiedSince && currentLastModified &&
      new Date(ifModifiedSince).getTime() >= currentLastModified.getTime();

    return {
      shouldReturn304: etagMatch || modifiedMatch,
    };
  },
};

/**
 * Error optimization utilities
 */
export const errorOptimization = {
  /**
   * Sanitize error messages for production
   */
  sanitizeMessage(error: Error, isDevelopment: boolean): string {
    if (isDevelopment) {
      return error.message;
    }

    // Generic messages for production
    if (error.name === 'ValidationError') {
      return 'Invalid input data';
    }

    if (error.name === 'DatabaseError') {
      return 'Data operation failed';
    }

    if (error.name === 'ExternalServiceError') {
      return 'External service unavailable';
    }

    return 'An error occurred';
  },

  /**
   * Add error context for debugging
   */
  addErrorContext(error: Error, context: Record<string, any>): Error & { context: Record<string, any> } {
    return Object.assign(error, { context });
  },

  /**
   * Create retryable error
   */
  createRetryableError(
    originalError: Error,
    retryAfter: number = 5,
    maxRetries: number = 3
  ): Error & { retryAfter: number; maxRetries: number; originalError: Error } {
    const retryableError = new Error(originalError.message) as any;
    retryableError.name = 'RetryableError';
    retryableError.retryAfter = retryAfter;
    retryableError.maxRetries = maxRetries;
    retryableError.originalError = originalError;
    return retryableError;
  },
};

export {
  createReactQueryResponse,
  createPaginatedResponse,
  createReactQueryErrorResponse,
  createSuccessResponse,
  createListResponse,
  createEmptyResponse,
  createValidationError,
  createNotFoundError,
  createAuthError,
  createAuthorizationError,
  createRateLimitError,
  createDatabaseError,
  createExternalServiceError,
};