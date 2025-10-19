/**
 * AsyncErrorBoundary Component
 * Handles errors from async operations and promises
 */

import React, { Component, ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isPending: boolean;
}

class AsyncErrorBoundaryInternal extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      isPending: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidCatch?(error: Error, errorInfo: React.ErrorInfo): void {
    // Handle async errors specifically
    if (error.name === 'ChunkLoadError' || error.message.includes('Loading chunk')) {
      console.error('Async loading error:', error);
      // Could trigger a retry or refresh mechanism here
    }
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      isPending: false,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      return (
        <View style={styles.container}>
          <Text style={styles.title}>読み込みエラー</Text>
          <Text style={styles.message}>
            コンテンツの読み込み中にエラーが発生しました。
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

// Hook for handling async errors in functional components
export const useAsyncErrorHandler = () => {
  const handleError = React.useCallback((error: Error) => {
    console.error('Async error:', error);
    // Could integrate with error reporting service here
  }, []);

  return { handleError };
};

// Higher-order component for async operations
export const withAsyncErrorHandling = <P extends object>(
  Component: React.ComponentType<P>
) => {
  return (props: P) => (
    <AsyncErrorBoundaryInternal>
      <Component {...props} />
    </AsyncErrorBoundaryInternal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
});

export default AsyncErrorBoundaryInternal;