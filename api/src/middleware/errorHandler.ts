/**
 * Error handling middleware for Yabaii API
 * Provides consistent error responses and logging with Sentry integration
 */

import { Context, Next } from 'hono';
import { logger } from '@/utils/logger';
import * as Sentry from '@sentry/bun';

export interface AppError extends Error {
  status?: number;
  code?: string;
  details?: any;
  context?: Record<string, any>;
  userId?: string;
  requestId?: string;
}

/**
 * Global error handler middleware with Sentry integration
 */
export const errorHandler = async (c: Context, next: Next) => {
  try {
    await next();
  } catch (error) {
    const err = error as AppError;
    const requestId = c.get('requestId');
    const userId = c.get('userId');

    // Prepare error context
    const errorContext = {
      requestId,
      userId,
      path: c.req.path,
      method: c.req.method,
      userAgent: c.req.header('User-Agent'),
      ip: getClientIP(c),
      timestamp: new Date().toISOString(),
      ...err.context,
    };

    // Log the error
    logger.error('API Error:', {
      message: err.message,
      stack: err.stack,
      status: err.status || 500,
      code: err.code,
      details: err.details,
      ...errorContext,
    });

    // Send to Sentry for server errors (5xx) and critical client errors
    if (shouldSendToSentry(err)) {
      Sentry.captureException(err, {
        tags: {
          status: err.status || 500,
          code: err.code || 'UNKNOWN',
          path: c.req.path,
          method: c.req.method,
        },
        extra: {
          requestId,
          userId,
          userAgent: c.req.header('User-Agent'),
          ip: getClientIP(c),
          ...err.details,
        },
        user: userId ? { id: userId } : undefined,
        level: getSeverityLevel(err),
      });
    }

    // Determine status code
    const status = err.status || 500;

    // Determine error message
    let message = 'Internal Server Error';
    let code = 'INTERNAL_ERROR';

    if (status < 500) {
      // Client errors - expose message
      message = err.message || message;
      code = err.code || 'CLIENT_ERROR';
    } else if (process.env.NODE_ENV === 'development') {
      // Server errors in development - expose message for debugging
      message = err.message || message;
      code = err.code || 'SERVER_ERROR';
    }

    // Build error response
    const errorResponse: any = {
      success: false,
      error: message,
      code,
      timestamp: new Date().toISOString(),
      path: c.req.path,
      requestId,
    };

    // Include details in development or if explicitly provided
    if ((process.env.NODE_ENV === 'development' || status < 500) && err.details) {
      errorResponse.details = err.details;
    }

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development' && err.stack) {
      errorResponse.stack = err.stack;
    }

    // Include Sentry event ID in production for error tracking
    if (process.env.NODE_ENV === 'production' && Sentry.getCurrentHub().getClient()) {
      const sentryEventId = Sentry.captureException(err);
      errorResponse.errorId = sentryEventId;
    }

    return c.json(errorResponse, status);
  }
};

/**
 * Custom error classes
 */
export class ValidationError extends Error {
  status = 400;
  code = 'VALIDATION_ERROR';
  details: any;
  context?: Record<string, any>;

  constructor(message: string, details?: any, context?: Record<string, any>) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
    this.context = context;
  }
}

export class AuthenticationError extends Error {
  status = 401;
  code = 'AUTHENTICATION_ERROR';

  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  status = 403;
  code = 'AUTHORIZATION_ERROR';

  constructor(message = 'Access denied') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends Error {
  status = 404;
  code = 'NOT_FOUND';

  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  status = 409;
  code = 'CONFLICT';

  constructor(message = 'Resource conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends Error {
  status = 429;
  code = 'RATE_LIMIT_EXCEEDED';

  constructor(message = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class DatabaseError extends Error {
  status = 500;
  code = 'DATABASE_ERROR';
  context?: Record<string, any>;

  constructor(message = 'Database operation failed', context?: Record<string, any>) {
    super(message);
    this.name = 'DatabaseError';
    this.context = context;
  }
}

export class ExternalServiceError extends Error {
  status = 502;
  code = 'EXTERNAL_SERVICE_ERROR';
  context?: Record<string, any>;

  constructor(message = 'External service unavailable', context?: Record<string, any>) {
    super(message);
    this.name = 'ExternalServiceError';
    this.context = context;
  }
}

/**
 * Helper function to get client IP address
 */
function getClientIP(c: Context): string {
  return c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
         c.req.header('X-Real-IP') ||
         c.req.header('CF-Connecting-IP') || // Cloudflare
         c.req.header('X-Client-IP') ||
         'unknown';
}

/**
 * Determine if error should be sent to Sentry
 */
function shouldSendToSentry(error: AppError): boolean {
  // Don't send client errors (4xx) to Sentry unless they're critical
  if (error.status && error.status < 500) {
    // Send authentication and validation errors in production
    const criticalClientErrors = [401, 403, 429];
    return criticalClientErrors.includes(error.status);
  }

  // Send all server errors (5xx)
  return true;
}

/**
 * Get Sentry severity level based on error status
 */
function getSeverityLevel(error: AppError): 'fatal' | 'error' | 'warning' | 'info' | 'debug' {
  const status = error.status || 500;

  if (status >= 500) {
    return status >= 503 ? 'fatal' : 'error';
  } else if (status === 429) {
    return 'warning';
  } else if (status === 401 || status === 403) {
    return 'info';
  }

  return 'debug';
}

/**
 * Helper function to create and throw appropriate errors
 */
export const createError = (
  status: number,
  message: string,
  code?: string,
  details?: any,
  context?: Record<string, any>
): AppError => {
  const error = new Error(message) as AppError;
  error.status = status;
  error.code = code;
  error.details = details;
  error.context = context;
  return error;
};