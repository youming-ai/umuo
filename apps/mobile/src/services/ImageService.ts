/**
 * Image Service
 * Comprehensive image optimization and management service
 */

import { Dimensions } from 'react-native';

interface ImageDimensions {
  width: number;
  height: number;
}

interface ImageOptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'auto' | 'webp' | 'jpg' | 'png';
  fit?: 'cover' | 'contain' | 'fill' | 'scale-down';
  crop?: string;
  gravity?: 'auto' | 'center' | 'top' | 'bottom' | 'left' | 'right';
}

interface ImageCacheEntry {
  url: string;
  dimensions: ImageDimensions;
  timestamp: number;
  size: number;
}

class ImageService {
  private static instance: ImageService;
  private cache: Map<string, ImageCacheEntry> = new Map();
  private maxCacheSize = 100; // Maximum number of cached images
  private maxCacheAge = 24 * 60 * 60 * 1000; // 24 hours
  private cdnUrl: string = 'https://cdn.yabaii.day';
  private defaultQuality: number = 80;

  static getInstance(): ImageService {
    if (!ImageService.instance) {
      ImageService.instance = new ImageService();
    }
    return ImageService.instance;
  }

  /**
   * Set CDN URL
   */
  setCdnUrl(url: string): void {
    this.cdnUrl = url;
  }

  /**
   * Set default quality
   */
  setDefaultQuality(quality: number): void {
    this.defaultQuality = Math.max(1, Math.min(100, quality));
  }

  /**
   * Generate optimized image URL
   */
  generateOptimizedUrl(
    originalUrl: string,
    options: ImageOptimizationOptions = {}
  ): string {
    if (!originalUrl || !originalUrl.startsWith('http')) {
      return originalUrl;
    }

    try {
      const url = new URL(originalUrl);
      const optimizedUrl = new URL(this.cdnUrl + url.pathname);

      const params = new URLSearchParams();

      // Quality
      const quality = options.quality || this.defaultQuality;
      params.set('q', quality.toString());

      // Format
      if (options.format && options.format !== 'auto') {
        params.set('f', options.format);
      } else {
        params.set('auto', 'format');
      }

      // Dimensions
      if (options.width || options.height) {
        params.set('w', (options.width || '').toString());
        params.set('h', (options.height || '').toString());

        // Fit mode
        if (options.fit) {
          params.set('fit', options.fit);
        }

        // Crop
        if (options.crop) {
          params.set('crop', options.crop);
        }

        // Gravity
        if (options.gravity) {
          params.set('g', options.gravity);
        }
      }

      // Device pixel ratio for high DPI displays
      const pixelRatio = Dimensions.get('window').scale;
      if (pixelRatio > 1) {
        params.set('dpr', pixelRatio.toString());
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
  }

  /**
   * Generate responsive image URLs for different screen sizes
   */
  generateResponsiveUrls(
    originalUrl: string,
    baseWidth: number,
    aspectRatio: number = 1,
    breakpoints: number[] = [320, 640, 768, 1024, 1280, 1536]
  ): Array<{ width: number; url: string }> {
    return breakpoints
      .filter(breakpoint => breakpoint >= baseWidth)
      .map(breakpoint => ({
        width: breakpoint,
        url: this.generateOptimizedUrl(originalUrl, {
          width: breakpoint,
          height: Math.round(breakpoint / aspectRatio),
          quality: this.defaultQuality,
        }),
      }))
      .sort((a, b) => a.width - b.width);
  }

  /**
   * Get image dimensions from cache or calculate
   */
  async getImageDimensions(url: string): Promise<ImageDimensions> {
    // Check cache first
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.timestamp < this.maxCacheAge) {
      return cached.dimensions;
    }

    try {
      // For React Native, we need to use Image.getSize
      return new Promise((resolve, reject) => {
        // This would need to be implemented with proper React Native Image
        // For now, we'll return default dimensions
        resolve({ width: 300, height: 300 });

        // In a real implementation:
        // import { Image } from 'react-native';
        // Image.getSize(url, (width, height) => {
        //   const dimensions = { width, height };
        //   this.cacheDimensions(url, dimensions);
        //   resolve(dimensions);
        // }, reject);
      });
    } catch (error) {
      console.warn('Failed to get image dimensions:', error);
      return { width: 300, height: 300 };
    }
  }

  /**
   * Cache image dimensions
   */
  private cacheDimensions(url: string, dimensions: ImageDimensions): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(url, {
      url,
      dimensions,
      timestamp: Date.now(),
      size: 0, // Would calculate actual size in real implementation
    });
  }

  /**
   * Preload images
   */
  async preloadImages(urls: string[]): Promise<void> {
    const promises = urls.map(url => this.preloadImage(url));
    await Promise.allSettled(promises);
  }

  /**
   * Preload single image
   */
  async preloadImage(url: string): Promise<void> {
    try {
      // This would be implemented with proper image preloading
      // For React Native, this could be done with Image.prefetch
      console.log('Preloading image:', url);

      // In a real implementation:
      // import { Image } from 'react-native';
      // await Image.prefetch(url);
    } catch (error) {
      console.warn('Failed to preload image:', error);
    }
  }

  /**
   * Generate placeholder image URL
   */
  generatePlaceholderUrl(
    width: number,
    height: number,
    text?: string,
    backgroundColor: string = '#f0f0f0',
    textColor: string = '#666666'
  ): string {
    const params = new URLSearchParams({
      w: width.toString(),
      h: height.toString(),
      bg: backgroundColor.replace('#', ''),
      txt: text || `${width}x${height}`,
      txtclr: textColor.replace('#', ''),
    });

    return `https://via.placeholder.com/${width}x${height}?${params.toString()}`;
  }

  /**
   * Optimize image for specific use case
   */
  optimizeForUseCase(
    url: string,
    useCase: 'thumbnail' | 'banner' | 'product' | 'avatar' | 'gallery',
    customOptions?: ImageOptimizationOptions
  ): string {
    const defaultOptions: Record<string, ImageOptimizationOptions> = {
      thumbnail: {
        width: 150,
        height: 150,
        quality: 70,
        fit: 'cover',
      },
      banner: {
        width: Dimensions.get('window').width,
        height: 200,
        quality: 85,
        fit: 'cover',
      },
      product: {
        width: 300,
        height: 300,
        quality: 90,
        fit: 'cover',
      },
      avatar: {
        width: 100,
        height: 100,
        quality: 80,
        fit: 'cover',
        gravity: 'center',
      },
      gallery: {
        width: 400,
        height: 400,
        quality: 85,
        fit: 'cover',
      },
    };

    const options = { ...defaultOptions[useCase], ...customOptions };
    return this.generateOptimizedUrl(url, options);
  }

  /**
   * Calculate optimal image size for container
   */
  calculateOptimalSize(
    containerWidth: number,
    containerHeight: number,
    originalWidth: number,
    originalHeight: number,
    fit: 'cover' | 'contain' | 'fill' = 'cover'
  ): ImageDimensions {
    const containerRatio = containerWidth / containerHeight;
    const imageRatio = originalWidth / originalHeight;

    switch (fit) {
      case 'cover':
        if (imageRatio > containerRatio) {
          return {
            width: containerWidth,
            height: containerWidth / imageRatio,
          };
        } else {
          return {
            width: containerHeight * imageRatio,
            height: containerHeight,
          };
        }

      case 'contain':
        if (imageRatio > containerRatio) {
          return {
            width: containerHeight * imageRatio,
            height: containerHeight,
          };
        } else {
          return {
            width: containerWidth,
            height: containerWidth / imageRatio,
          };
        }

      case 'fill':
        return {
          width: containerWidth,
          height: containerHeight,
        };

      default:
        return {
          width: originalWidth,
          height: originalHeight,
        };
    }
  }

  /**
   * Get image format from URL
   */
  getImageFormat(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();

      if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
        return 'jpeg';
      } else if (pathname.endsWith('.png')) {
        return 'png';
      } else if (pathname.endsWith('.webp')) {
        return 'webp';
      } else if (pathname.endsWith('.gif')) {
        return 'gif';
      } else if (pathname.endsWith('.svg')) {
        return 'svg';
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if format supports optimization
   */
  supportsOptimization(url: string): boolean {
    const format = this.getImageFormat(url);
    return format === 'jpeg' || format === 'png' || format === 'webp';
  }

  /**
   * Generate blur placeholder URL
   */
  generateBlurPlaceholder(url: string, blur: number = 10): string {
    return this.generateOptimizedUrl(url, {
      quality: 20,
      format: 'jpg',
    });
  }

  /**
   * Clean up cache
   */
  cleanupCache(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > this.maxCacheAge) {
        expiredKeys.push(key);
      }
    });

    expiredKeys.forEach(key => this.cache.delete(key));
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    totalEntries: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    if (this.cache.size === 0) {
      return {
        size: 0,
        totalEntries: 0,
        oldestEntry: null,
        newestEntry: null,
      };
    }

    const timestamps = Array.from(this.cache.values()).map(entry => entry.timestamp);
    const oldestEntry = Math.min(...timestamps);
    const newestEntry = Math.max(...timestamps);

    return {
      size: this.cache.size,
      totalEntries: this.cache.size,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export default ImageService.getInstance();