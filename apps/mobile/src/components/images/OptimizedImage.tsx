/**
 * OptimizedImage Component
 * Provides optimized image loading with CDN, lazy loading, and performance optimization
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Image,
  ImageProps,
  View,
  ActivityIndicator,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';

interface OptimizedImageProps extends Omit<ImageProps, 'source'> {
  source: { uri: string };
  cdnUrl?: string;
  width?: number;
  height?: number;
  quality?: number; // 1-100
  format?: 'auto' | 'webp' | 'jpg' | 'png';
  lazy?: boolean;
  placeholder?: string;
  blurPlaceholder?: boolean;
  fadeInDuration?: number;
  onLoadStart?: () => void;
  onLoad?: (width: number, height: number) => void;
  onLoadEnd?: () => void;
  onError?: (error: any) => void;
  retryCount?: number;
  cachePolicy?: 'default' | 'reload' | 'force-cache' | 'only-if-cached';
  accessible?: boolean;
  accessibilityLabel?: string;
}

const { width: screenWidth } = Dimensions.get('window');

const OptimizedImage: React.FC<OptimizedImageProps> = ({
  source,
  cdnUrl = 'https://cdn.yabaii.day',
  width,
  height,
  quality = 80,
  format = 'auto',
  lazy = true,
  placeholder,
  blurPlaceholder = true,
  fadeInDuration = 300,
  onLoadStart,
  onLoad,
  onLoadEnd,
  onError,
  retryCount = 3,
  cachePolicy = 'default',
  accessible = true,
  accessibilityLabel,
  style,
  ...props
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentRetry, setCurrentRetry] = useState(0);
  const [isVisible, setIsVisible] = useState(!lazy);
  const [imageSize, setImageSize] = useState({ width: width || 0, height: height || 0 });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const viewRef = useRef<View>(null);
  const imageRef = useRef<Image>(null);

  const backgroundColor = useThemeColor({ light: '#F2F2F7', dark: '#1C1C1E' }, 'background');
  const activityIndicatorColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');

  /**
   * Generate optimized CDN URL
   */
  const generateOptimizedUrl = useCallback((originalUrl: string): string => {
    if (!cdnUrl || !originalUrl.startsWith('http')) {
      return originalUrl;
    }

    try {
      const url = new URL(originalUrl);
      const optimizedUrl = new URL(cdnUrl + url.pathname);

      // Add optimization parameters
      const params = new URLSearchParams();

      // Quality
      params.set('q', quality.toString());

      // Format
      if (format !== 'auto') {
        params.set('f', format);
      }

      // Dimensions
      if (width || height) {
        const targetWidth = width || Math.min(imageSize.width, screenWidth);
        const targetHeight = height || (width ? (imageSize.height * width) / imageSize.width : imageSize.height);

        params.set('w', Math.round(targetWidth).toString());
        params.set('h', Math.round(targetHeight).toString());
        params.set('fit', 'cover');
      }

      // Auto format selection based on browser support
      if (format === 'auto') {
        params.set('auto', 'format');
      }

      // Add cache busting for development
      if (__DEV__) {
        params.set('t', Date.now().toString());
      }

      optimizedUrl.search = params.toString();
      return optimizedUrl.toString();
    } catch (error) {
      console.warn('Failed to generate optimized URL:', error);
      return originalUrl;
    }
  }, [cdnUrl, quality, format, width, height, imageSize.width, imageSize.height]);

  /**
   * Handle intersection observer for lazy loading
   */
  useEffect(() => {
    if (!lazy) {
      return;
    }

    let observer: IntersectionObserver | null = null;

    const setupObserver = () => {
      if (!viewRef.current || typeof IntersectionObserver === 'undefined') {
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setIsVisible(true);
              observer?.disconnect();
            }
          });
        },
        {
          rootMargin: '50px', // Start loading 50px before element is visible
          threshold: 0.1,
        }
      );

      observer.observe(viewRef.current);
    };

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(setupObserver);

    return () => {
      observer?.disconnect();
    };
  }, [lazy]);

  /**
   * Start fade in animation
   */
  const startFadeIn = useCallback(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: fadeInDuration,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, fadeInDuration]);

  /**
   * Handle image load start
   */
  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
    setHasError(false);
    onLoadStart?.();
  }, [onLoadStart]);

  /**
   * Handle image load success
   */
  const handleLoad = useCallback((event: any) => {
    const { nativeEvent } = event;
    const { width: loadedWidth, height: loadedHeight } = nativeEvent;

    setIsLoading(false);
    setHasError(false);
    setCurrentRetry(0);

    setImageSize({
      width: loadedWidth,
      height: loadedHeight,
    });

    onLoad?.(loadedWidth, loadedHeight);
    startFadeIn();
    onLoadEnd?.();
  }, [onLoad, onLoadEnd, startFadeIn]);

  /**
   * Handle image load error
   */
  const handleError = useCallback((error: any) => {
    setIsLoading(false);

    if (currentRetry < retryCount) {
      // Retry with exponential backoff
      const retryDelay = Math.pow(2, currentRetry) * 1000;
      setTimeout(() => {
        setCurrentRetry(prev => prev + 1);
        // Force re-render to trigger retry
        setImageSize(prev => ({ ...prev }));
      }, retryDelay);
    } else {
      setHasError(true);
      onError?.(error);
    }

    onLoadEnd?.();
  }, [currentRetry, retryCount, onError, onLoadEnd]);

  /**
   * Retry loading image
   */
  const retry = useCallback(() => {
    setCurrentRetry(0);
    setHasError(false);
    setImageSize(prev => ({ ...prev }));
  }, []);

  /**
   * Get image style with proper dimensions
   */
  const getImageStyle = () => {
    const imageStyle: any = {
      opacity: fadeAnim,
    };

    if (width && height) {
      imageStyle.width = width;
      imageStyle.height = height;
    } else if (width) {
      imageStyle.width = width;
      imageStyle.aspectRatio = imageSize.width / imageSize.height || 1;
    } else if (height) {
      imageStyle.height = height;
      imageStyle.aspectRatio = imageSize.width / imageSize.height || 1;
    }

    return [imageStyle, style];
  };

  /**
   * Get container style
   */
  const getContainerStyle = () => {
    const containerStyle: any = {
      backgroundColor,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    };

    if (width && height) {
      containerStyle.width = width;
      containerStyle.height = height;
    } else if (width) {
      containerStyle.width = width;
    } else if (height) {
      containerStyle.height = height;
    }

    return containerStyle;
  };

  /**
   * Render placeholder
   */
  const renderPlaceholder = () => {
    if (placeholder) {
      return (
        <Image
          source={{ uri: placeholder }}
          style={[
            getContainerStyle(),
            blurPlaceholder && styles.blurPlaceholder,
          ]}
          blurRadius={blurPlaceholder ? 10 : 0}
        />
      );
    }

    return (
      <View style={getContainerStyle()}>
        {isLoading && (
          <ActivityIndicator
            size="small"
            color={activityIndicatorColor}
            style={styles.placeholderIcon}
          />
        )}
      </View>
    );
  };

  /**
   * Render error state
   */
  const renderError = () => (
    <View style={[styles.errorContainer, getContainerStyle()]}>
      {/* Error icon could be added here */}
    </View>
  );

  /**
   * Get optimized source
   */
  const getOptimizedSource = () => {
    const optimizedUrl = generateOptimizedUrl(source.uri);
    return { uri: optimizedUrl, cache: cachePolicy };
  };

  return (
    <View ref={viewRef} style={getContainerStyle()} accessible={accessible} accessibilityLabel={accessibilityLabel}>
      {!isVisible && lazy ? (
        renderPlaceholder()
      ) : (
        <>
          {(isLoading || (hasError && currentRetry < retryCount)) && renderPlaceholder()}

          {hasError && currentRetry >= retryCount ? (
            renderError()
          ) : (
            <Image
              ref={imageRef}
              source={getOptimizedSource()}
              style={getImageStyle()}
              onLoadStart={handleLoadStart}
              onLoad={handleLoad}
              onError={handleError}
              progressiveRenderingEnabled={true}
              resizeMethod="resize"
              {...props}
            />
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  errorContainer: {
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderIcon: {
    position: 'absolute',
  },
  blurPlaceholder: {
    opacity: 0.7,
  },
});

export default OptimizedImage;