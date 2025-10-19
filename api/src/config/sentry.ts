/**
 * Sentry configuration for Yabaii API
 * Error monitoring and performance tracking
 */

import * as Sentry from '@sentry/bun';
import { logger } from '@/utils/logger';

/**
 * Sentry configuration interface
 */
interface SentryConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
  profilesSampleRate: number;
  enabled: boolean;
}

/**
 * Get Sentry configuration from environment variables
 */
function getSentryConfig(): SentryConfig {
  const dsn = process.env.SENTRY_DSN;
  const environment = process.env.NODE_ENV || 'development';
  const release = process.env.npm_package_version || '1.0.0';

  if (!dsn) {
    logger.warn('Sentry DSN not configured - error monitoring disabled');
  }

  return {
    dsn: dsn || '',
    environment,
    release,
    tracesSampleRate: getFloatEnvVar('SENTRY_TRACES_SAMPLE_RATE', 0.1),
    profilesSampleRate: getFloatEnvVar('SENTRY_PROFILES_SAMPLE_RATE', 0.1),
    enabled: !!dsn && environment !== 'test',
  };
}

/**
 * Get float environment variable with default
 */
function getFloatEnvVar(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;

  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Initialize Sentry
 */
export function initializeSentry(): void {
  const config = getSentryConfig();

  if (!config.enabled) {
    logger.info('Sentry disabled - no DSN configured or running in test mode');
    return;
  }

  try {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,

      // Performance monitoring
      tracesSampleRate: config.tracesSampleRate,
      profilesSampleRate: config.profilesSampleRate,

      // Error sampling
      sampleRate: 1.0,

      // Debug mode in development
      debug: config.environment === 'development',

      // Before sending to Sentry
      beforeSend(event, hint) {
        // Filter out certain errors in development
        if (config.environment === 'development') {
          // Don't send validation errors in development
          if (event.exception?.values?.[0]?.type === 'ValidationError') {
            return null;
          }
        }

        // Add custom context
        event.contexts = {
          ...event.contexts,
          app: {
            name: 'yabaii-api',
            version: config.release,
          },
          runtime: {
            name: 'bun',
            version: process.version,
          },
        };

        return event;
      },

      // Integrations
      integrations: [
        // Add any custom integrations here
      ],

      // Transport options
      transportOptions: {
        headers: {
          'X-Yabaii-Source': 'api',
        },
      },
    });

    logger.info('Sentry initialized successfully', {
      environment: config.environment,
      release: config.release,
      tracesSampleRate: config.tracesSampleRate,
      profilesSampleRate: config.profilesSampleRate,
    });

    // Set user information if available
    setCurrentUser();

  } catch (error) {
    logger.error('Failed to initialize Sentry:', error);
  }
}

/**
 * Set current user in Sentry context
 */
function setCurrentUser(): void {
  // This would typically be called during authentication
  // For now, we'll set it as anonymous
  Sentry.setUser({
    id: 'anonymous',
    segment: 'guest',
  });
}

/**
 * Update user context in Sentry
 */
export function updateUserContext(user: {
  id: string;
  email?: string;
  subscription?: string;
  tier?: string;
}): void {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    subscription: user.subscription,
    tier: user.tier,
  });
}

/**
 * Clear user context in Sentry
 */
export function clearUserContext(): void {
  Sentry.setUser(null);
}

/**
 * Set transaction context for performance monitoring
 */
export function setTransactionContext(transactionName: string, data?: Record<string, any>): void {
  Sentry.configureScope((scope) => {
    scope.setTransactionName(transactionName);
    if (data) {
      scope.setContext('transaction_data', data);
    }
  });
}

/**
 * Add breadcrumb to Sentry for debugging
 */
export function addBreadcrumb(
  message: string,
  category: string = 'default',
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  data?: Record<string, any>
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    level,
    data,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Capture exception with additional context
 */
export function captureException(
  error: Error,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, any>;
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
    user?: { id: string; email?: string };
  }
): string | undefined {
  return Sentry.captureException(error, {
    tags: context?.tags,
    extra: context?.extra,
    level: context?.level,
    user: context?.user,
  });
}

/**
 * Capture message for Sentry
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, any>;
  }
): string | undefined {
  return Sentry.captureMessage(message, {
    level,
    tags: context?.tags,
    extra: context?.extra,
  });
}

/**
 * Performance monitoring utilities
 */
export const performance = {
  /**
   * Start a transaction
   */
  startTransaction(name: string, op: string = 'http.server'): Sentry.Transaction | undefined {
    const transaction = Sentry.startTransaction({
      name,
      op,
    });

    if (transaction) {
      addBreadcrumb('Transaction started', 'performance', 'info', { name, op });
    }

    return transaction;
  },

  /**
   * Set a child span
   */
  setSpan(operation: string, description?: string): Sentry.Span | undefined {
    return Sentry.startSpan({
      op: operation,
      description,
    });
  },

  /**
   * Finish transaction
   */
  finishTransaction(transaction: Sentry.Transaction, status?: Sentry.SpanStatus): void {
    if (transaction) {
      transaction.setStatus(status);
      transaction.finish();
      addBreadcrumb('Transaction finished', 'performance', 'info', {
        name: transaction.name,
        status,
        duration: transaction.endTimestamp! - transaction.startTimestamp,
      });
    }
  },
};

/**
 * Health check for Sentry
 */
export function checkSentryHealth(): {
  enabled: boolean;
  configured: boolean;
  environment: string;
  dsnConfigured: boolean;
} {
  const config = getSentryConfig();
  const client = Sentry.getCurrentHub().getClient();

  return {
    enabled: config.enabled,
    configured: !!client,
    environment: config.environment,
    dsnConfigured: !!config.dsn,
  };
}

/**
 * Get Sentry configuration for monitoring
 */
export function getSentryMonitoringInfo(): {
  enabled: boolean;
  environment: string;
  release: string;
  tracesSampleRate: number;
  profilesSampleRate: number;
  health: ReturnType<typeof checkSentryHealth>;
} {
  const config = getSentryConfig();
  const health = checkSentryHealth();

  return {
    enabled: config.enabled,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    profilesSampleRate: config.profilesSampleRate,
    health,
  };
}

export default {
  initializeSentry,
  updateUserContext,
  clearUserContext,
  setTransactionContext,
  addBreadcrumb,
  captureException,
  captureMessage,
  performance,
  checkSentryHealth,
  getSentryMonitoringInfo,
};