/**
 * Error Reporting Service
 * Centralized error logging and reporting service
 */

import { Platform } from 'react-native';

interface ErrorReport {
  errorId: string;
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: string;
  userAgent: string;
  userId?: string;
  sessionId?: string;
  appVersion: string;
  buildNumber?: string;
  additionalContext?: Record<string, any>;
}

interface ErrorContext {
  userId?: string;
  sessionId?: string;
  additionalData?: Record<string, any>;
}

class ErrorReportingService {
  private static instance: ErrorReportingService;
  private isInitialized = false;
  private errorQueue: ErrorReport[] = [];
  private maxQueueSize = 50;
  private context: ErrorContext = {};

  static getInstance(): ErrorReportingService {
    if (!ErrorReportingService.instance) {
      ErrorReportingService.instance = new ErrorReportingService();
    }
    return ErrorReportingService.instance;
  }

  /**
   * Initialize the error reporting service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize any external error reporting services here
      // For example: Sentry.init(), FirebaseCrashlytics.init(), etc.

      this.isInitialized = true;
      console.log('Error reporting service initialized');

      // Process any queued errors
      this.processErrorQueue();
    } catch (error) {
      console.error('Failed to initialize error reporting service:', error);
    }
  }

  /**
   * Set context for error reports
   */
  setContext(context: ErrorContext): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create error report object
   */
  private createErrorReport(
    error: Error,
    componentStack?: string,
    additionalContext?: Record<string, any>
  ): ErrorReport {
    const constants = require('@expo/constants');

    return {
      errorId: this.generateErrorId(),
      message: error.message,
      stack: error.stack,
      componentStack,
      timestamp: new Date().toISOString(),
      userAgent: Platform.select({
        ios: `iOS ${Platform.Version}`,
        android: `Android ${Platform.Version}`,
        default: 'Unknown',
      }),
      userId: this.context.userId,
      sessionId: this.context.sessionId,
      appVersion: constants.expoConfig?.version || 'unknown',
      buildNumber: constants.expoConfig?.android?.versionCode || constants.expoConfig?.ios?.buildNumber,
      additionalContext: {
        ...this.context.additionalData,
        ...additionalContext,
      },
    };
  }

  /**
   * Report error to logging service
   */
  async reportError(
    error: Error,
    componentStack?: string,
    additionalContext?: Record<string, any>
  ): Promise<string> {
    const errorReport = this.createErrorReport(error, componentStack, additionalContext);

    // Log to console in development
    if (__DEV__) {
      console.group('🚨 Error Reported');
      console.error('Error:', error);
      console.error('Report:', errorReport);
      console.groupEnd();
    }

    if (!this.isInitialized) {
      // Queue error for later processing
      this.queueError(errorReport);
      return errorReport.errorId;
    }

    try {
      await this.sendToErrorService(errorReport);
      return errorReport.errorId;
    } catch (reportingError) {
      console.error('Failed to report error:', reportingError);
      // Fallback to console logging
      console.error('Original error:', error);
      return errorReport.errorId;
    }
  }

  /**
   * Queue error for later processing
   */
  private queueError(errorReport: ErrorReport): void {
    this.errorQueue.push(errorReport);

    // Remove oldest errors if queue is too large
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.shift();
    }
  }

  /**
   * Process queued errors
   */
  private async processErrorQueue(): Promise<void> {
    if (this.errorQueue.length === 0) {
      return;
    }

    const queuedErrors = [...this.errorQueue];
    this.errorQueue = [];

    for (const errorReport of queuedErrors) {
      try {
        await this.sendToErrorService(errorReport);
      } catch (error) {
        console.error('Failed to report queued error:', error);
      }
    }
  }

  /**
   * Send error to external service
   */
  private async sendToErrorService(errorReport: ErrorReport): Promise<void> {
    // This would integrate with external services like:
    // - Sentry: Sentry.captureException(error, { extra: errorReport })
    // - Firebase Crashlytics: Crashlytics.recordError(error)
    // - Custom API endpoint

    // For now, we'll simulate API call
    console.log('Sending error report to service:', errorReport.errorId);

    // Example of sending to custom API
    // await fetch('https://api.yabaii.day/errors', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify(errorReport),
    // });
  }

  /**
   * Report non-error events (warnings, info, etc.)
   */
  async reportMessage(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
    context?: Record<string, any>
  ): Promise<void> {
    const report = {
      message,
      level,
      timestamp: new Date().toISOString(),
      context: {
        ...this.context.additionalData,
        ...context,
      },
    };

    if (__DEV__) {
      console.log(`[${level.toUpperCase()}]`, message, report);
    }

    // Send to logging service if initialized
    if (this.isInitialized) {
      try {
        await this.sendBreadcrumb(report);
      } catch (error) {
        console.error('Failed to report message:', error);
      }
    }
  }

  /**
   * Send breadcrumb/breadcrumb data
   */
  private async sendBreadcrumb(breadcrumb: any): Promise<void> {
    // This would integrate with external services
    // Sentry.addBreadcrumb(breadcrumb)
    console.log('Breadcrumb:', breadcrumb);
  }

  /**
   * Set user information
   */
  setUser(userId: string, userInfo?: Record<string, any>): void {
    this.context.userId = userId;
    this.context.additionalData = {
      ...this.context.additionalData,
      userInfo,
    };

    // Update external services
    // Sentry.setUser({ id: userId, ...userInfo });
  }

  /**
   * Clear user information
   */
  clearUser(): void {
    this.context.userId = undefined;
    delete this.context.additionalData?.userInfo;

    // Clear from external services
    // Sentry.setUser(null);
  }

  /**
   * Add tags for better error categorization
   */
  setTags(tags: Record<string, string>): void {
    this.context.additionalData = {
      ...this.context.additionalData,
      tags,
    };

    // Add to external services
    // Sentry.setTags(tags);
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    queuedErrors: number;
    isInitialized: boolean;
    context: ErrorContext;
  } {
    return {
      queuedErrors: this.errorQueue.length,
      isInitialized: this.isInitialized,
      context: this.context,
    };
  }

  /**
   * Manual crash reporting
   */
  async reportCrash(error: Error, fatal: boolean = true): Promise<void> {
    const crashReport = {
      ...this.createErrorReport(error),
      fatal,
    };

    if (this.isInitialized) {
      await this.sendToErrorService(crashReport);
    } else {
      this.queueError(crashReport);
    }
  }

  /**
   * Performance monitoring
   */
  async startTransaction(name: string): Promise<string> {
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (__DEV__) {
      console.log(`Transaction started: ${name} (${transactionId})`);
    }

    // This would integrate with APM tools
    // Sentry.startTransaction({ name, op: 'navigation' });

    return transactionId;
  }

  async finishTransaction(transactionId: string, status: 'ok' | 'error' = 'ok'): Promise<void> {
    if (__DEV__) {
      console.log(`Transaction finished: ${transactionId} (${status})`);
    }

    // This would integrate with APM tools
    // const transaction = Sentry.getCurrentHub().getScope().getTransaction();
    // if (transaction) {
    //   transaction.setStatus(status);
    //   transaction.finish();
    // }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.errorQueue = [];
    this.context = {};
    this.isInitialized = false;
  }
}

export default ErrorReportingService.getInstance();