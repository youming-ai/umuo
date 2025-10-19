/**
 * Error Boundary Component
 * Catches JavaScript errors in child component tree and displays fallback UI
 */

import React, { Component, ReactNode, ErrorInfo } from 'react';
import {
  View,
  Text,
  Button,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  enableDebugMode?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
}

class ErrorBoundaryInternal extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: this.generateErrorId(),
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      errorInfo,
    });

    // Log error to console in development
    if (__DEV__) {
      console.group('🚨 Error Boundary: Error Caught');
      console.error('Error:', error);
      console.error('Error Info:', errorInfo);
      console.groupEnd();
    }

    // Call custom error handler
    this.props.onError?.(error, errorInfo);

    // Send error to logging service
    this.logError(error, errorInfo);
  }

  private generateErrorId = (): string => {
    return `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  private logError = (error: Error, errorInfo: ErrorInfo) => {
    const errorData = {
      errorId: this.state.errorId,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: require('react-native/Libraries/Utilities/Platform').select({
        ios: 'iOS',
        android: 'Android',
        default: 'Unknown',
      }),
    };

    // In production, send to error logging service
    if (!__DEV__) {
      // Example: Send to Sentry, Crashlytics, or custom service
      // this.sendToErrorService(errorData);
      console.warn('Error would be sent to logging service:', errorData);
    }
  };

  private handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: this.generateErrorId(),
    });
  };

  private handleReportIssue = () => {
    const subject = `Error Report: ${this.state.error?.message || 'Unknown Error'}`;
    const body = `
Error ID: ${this.state.errorId}

Error Message:
${this.state.error?.message}

Stack Trace:
${this.state.error?.stack}

Component Stack:
${this.state.errorInfo?.componentStack}

Device Information:
- Platform: ${require('react-native/Libraries/Utilities/Platform').OS}
- Version: ${require('react-native/Libraries/Utilities/Platform').Version}
- App Version: ${require('@expo/constants').default.expoConfig?.version || 'Unknown'}
    `.trim();

    const mailtoUrl = `mailto:support@yabaii.day?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(mailtoUrl).catch(() => {
      console.warn('Could not open email client');
    });
  };

  private renderErrorScreen = () => {
    if (this.props.fallback) {
      return <>{this.props.fallback}</>;
    }

    return (
      <ErrorFallback
        error={this.state.error}
        errorInfo={this.state.errorInfo}
        errorId={this.state.errorId}
        onRetry={this.handleRetry}
        onReportIssue={this.handleReportIssue}
        enableDebugMode={this.props.enableDebugMode}
      />
    );
  };

  render() {
    if (this.state.hasError) {
      return this.renderErrorScreen();
    }

    return this.props.children;
  }
}

interface ErrorFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
  onRetry: () => void;
  onReportIssue: () => void;
  enableDebugMode?: boolean;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  errorInfo,
  errorId,
  onRetry,
  onReportIssue,
  enableDebugMode = false,
}) => {
  const backgroundColor = useThemeColor({ light: '#FFFFFF', dark: '#000000' }, 'background');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const errorColor = useThemeColor({ light: '#FF3B30', dark: '#FF453A' }, 'error');
  const borderColor = useThemeColor({ light: '#E5E5E7', dark: '#38383A' }, 'border');

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: textColor }]}>
          おっと、何か問題が発生しました
        </Text>

        <Text style={[styles.subtitle, { color: textColor }]}>
          An unexpected error occurred
        </Text>

        <View style={[styles.errorContainer, { borderColor }]}>
          <Text style={[styles.errorTitle, { color: errorColor }]}>
            Error Details:
          </Text>

          <Text style={[styles.errorMessage, { color: textColor }]}>
            {error?.message || 'Unknown error occurred'}
          </Text>

          <Text style={[styles.errorId, { color: textColor }]}>
            Error ID: {errorId}
          </Text>
        </View>

        <View style={styles.actionsContainer}>
          <View style={styles.buttonContainer}>
            <Button
              title="再試行 / Retry"
              onPress={onRetry}
              color="#007AFF"
            />
          </View>

          <View style={styles.buttonContainer}>
            <Button
              title="問題を報告 / Report Issue"
              onPress={onReportIssue}
              color="#34C759"
            />
          </View>
        </View>

        {enableDebugMode && __DEV__ && (
          <View style={styles.debugContainer}>
            <Text style={[styles.debugTitle, { color: textColor }]}>
              Debug Information:
            </Text>

            <ScrollView style={styles.debugScroll}>
              <Text style={[styles.debugText, { color: textColor }]}>
                {error?.stack}
              </Text>

              {errorInfo?.componentStack && (
                <>
                  <Text style={[styles.debugTitle, { color: textColor, marginTop: 16 }]}>
                    Component Stack:
                  </Text>
                  <Text style={[styles.debugText, { color: textColor }]}>
                    {errorInfo.componentStack}
                  </Text>
                </>
              )}
            </ScrollView>
          </View>
        )}

        <View style={styles.helpContainer}>
          <Text style={[styles.helpText, { color: textColor }]}>
            この問題が続く場合は、サポートまでご連絡ください。
          </Text>
          <Text style={[styles.helpText, { color: textColor }]}>
            If this problem persists, please contact support.
          </Text>
        </View>
      </View>
    </View>
  );
};

// Hook-based wrapper for functional components
export const useErrorBoundary = () => {
  // This would be implemented using react-error-boundary library
  // For now, we'll return a simple implementation
  return {
    resetBoundary: () => {
      console.warn('Error boundary reset not implemented in this simple version');
    },
  };
};

// HOC for wrapping components with error boundary
export const withErrorBoundary = <P extends object>(
  Component: React.ComponentType<P>,
  options?: Omit<Props, 'children'>
) => {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...options}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.7,
  },
  errorContainer: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    marginBottom: 8,
    lineHeight: 20,
  },
  errorId: {
    fontSize: 12,
    opacity: 0.6,
    fontFamily: 'monospace',
  },
  actionsContainer: {
    marginBottom: 24,
  },
  buttonContainer: {
    marginBottom: 12,
  },
  debugContainer: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
    maxHeight: 200,
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  debugScroll: {
    maxHeight: 150,
  },
  debugText: {
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  helpContainer: {
    alignItems: 'center',
  },
  helpText: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
    marginBottom: 4,
  },
});

export default ErrorBoundaryInternal;