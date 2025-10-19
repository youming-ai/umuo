/**
 * useAnalytics Hook
 * React hooks for analytics tracking
 */

import { useCallback, useEffect, useRef } from 'react';
import AnalyticsService from '@/services/AnalyticsService';

export interface UseAnalyticsReturn {
  trackEvent: (eventName: string, parameters?: Record<string, any>) => Promise<void>;
  trackScreen: (screenName: string, screenClass?: string, parameters?: Record<string, any>) => Promise<void>;
  trackEngagement: (type: string, target?: string, parameters?: Record<string, any>) => Promise<void>;
  trackSearch: (query: string, resultsCount: number, filters?: Record<string, any>) => Promise<void>;
  trackProductEvent: (eventName: string, productId: string, productInfo?: Record<string, any>) => Promise<void>;
  trackPriceEvent: (eventName: string, productId: string, price: number, currency?: string) => Promise<void>;
  trackBarcodeScan: (barcode: string, barcodeType: string, success: boolean, productFound?: boolean) => Promise<void>;
  trackNotification: (action: string, type: string, data?: Record<string, any>) => Promise<void>;
  trackError: (error: Error, context?: Record<string, any>) => Promise<void>;
  trackPerformance: (metric: string, value: number, unit?: string) => Promise<void>;
  trackProductView: (productId: string, productName: string, category?: string, price?: number) => Promise<void>;
  trackAddToCart: (productId: string, productName: string, price: number, quantity?: number) => Promise<void>;
  trackPurchase: (transactionId: string, items: Array<{
    productId: string;
    productName: string;
    price: number;
    quantity: number;
  }>) => Promise<void>;
}

/**
 * Hook for analytics tracking
 */
export const useAnalytics = (): UseAnalyticsReturn => {
  const trackEvent = useCallback(async (eventName: string, parameters?: Record<string, any>) => {
    await AnalyticsService.trackEvent(eventName, parameters);
  }, []);

  const trackScreen = useCallback(async (screenName: string, screenClass?: string, parameters?: Record<string, any>) => {
    await AnalyticsService.trackScreen(screenName, screenClass, parameters);
  }, []);

  const trackEngagement = useCallback(async (type: string, target?: string, parameters?: Record<string, any>) => {
    await AnalyticsService.trackEngagement(type, target, parameters);
  }, []);

  const trackSearch = useCallback(async (query: string, resultsCount: number, filters?: Record<string, any>) => {
    await AnalyticsService.trackSearch(query, resultsCount, filters);
  }, []);

  const trackProductEvent = useCallback(async (eventName: string, productId: string, productInfo?: Record<string, any>) => {
    await AnalyticsService.trackProductEvent(eventName, productId, productInfo);
  }, []);

  const trackPriceEvent = useCallback(async (eventName: string, productId: string, price: number, currency?: string) => {
    await AnalyticsService.trackPriceEvent(eventName, productId, price, currency);
  }, []);

  const trackBarcodeScan = useCallback(async (barcode: string, barcodeType: string, success: boolean, productFound?: boolean) => {
    await AnalyticsService.trackBarcodeScan(barcode, barcodeType, success, productFound);
  }, []);

  const trackNotification = useCallback(async (action: string, type: string, data?: Record<string, any>) => {
    await AnalyticsService.trackNotification(action, type, data);
  }, []);

  const trackError = useCallback(async (error: Error, context?: Record<string, any>) => {
    await AnalyticsService.trackError(error, context);
  }, []);

  const trackPerformance = useCallback(async (metric: string, value: number, unit?: string) => {
    await AnalyticsService.trackPerformance(metric, value, unit);
  }, []);

  const trackProductView = useCallback(async (productId: string, productName: string, category?: string, price?: number) => {
    await AnalyticsService.trackProductView(productId, productName, category, price);
  }, []);

  const trackAddToCart = useCallback(async (productId: string, productName: string, price: number, quantity?: number) => {
    await AnalyticsService.trackAddToCart(productId, productName, price, quantity);
  }, []);

  const trackPurchase = useCallback(async (transactionId: string, items: Array<{
    productId: string;
    productName: string;
    price: number;
    quantity: number;
  }>) => {
    await AnalyticsService.trackPurchase(transactionId, items);
  }, []);

  return {
    trackEvent,
    trackScreen,
    trackEngagement,
    trackSearch,
    trackProductEvent,
    trackPriceEvent,
    trackBarcodeScan,
    trackNotification,
    trackError,
    trackPerformance,
    trackProductView,
    trackAddToCart,
    trackPurchase,
  };
};

/**
 * Hook for tracking screen views
 */
export const useScreenTracking = (screenName: string, screenClass?: string, parameters?: Record<string, any>) => {
  const { trackScreen } = useAnalytics();

  useEffect(() => {
    trackScreen(screenName, screenClass, parameters);
  }, [screenName, screenClass, parameters, trackScreen]);
};

/**
 * Hook for tracking component lifecycle events
 */
export const useComponentTracking = (componentName: string, trackMount = true, trackUnmount = true) => {
  const { trackEvent } = useAnalytics();
  const mountTime = useRef<number>();

  useEffect(() => {
    if (trackMount) {
      mountTime.current = Date.now();
      trackEvent('component_mount', {
        component_name: componentName,
        mount_time: mountTime.current,
      });
    }

    return () => {
      if (trackUnmount && mountTime.current) {
        const duration = Date.now() - mountTime.current;
        trackEvent('component_unmount', {
          component_name: componentName,
          mount_time: mountTime.current,
          duration_ms: duration,
        });
      }
    };
  }, [componentName, trackMount, trackUnmount, trackEvent]);
};

/**
 * Hook for tracking user interactions
 */
export const useInteractionTracking = () => {
  const { trackEngagement } = useAnalytics();

  const trackClick = useCallback(async (target: string, parameters?: Record<string, any>) => {
    await trackEngagement('click', target, parameters);
  }, [trackEngagement]);

  const trackSwipe = useCallback(async (direction: string, target?: string, parameters?: Record<string, any>) => {
    await trackEngagement('swipe', target, {
      direction,
      ...parameters,
    });
  }, [trackEngagement]);

  const trackScroll = useCallback(async (target?: string, parameters?: Record<string, any>) => {
    await trackEngagement('scroll', target, parameters);
  }, [trackEngagement]);

  const trackLongPress = useCallback(async (target: string, parameters?: Record<string, any>) => {
    await trackEngagement('long_press', target, parameters);
  }, [trackEngagement]);

  return {
    trackClick,
    trackSwipe,
    trackScroll,
    trackLongPress,
  };
};

/**
 * Hook for tracking performance metrics
 */
export const usePerformanceTracking = () => {
  const { trackPerformance } = useAnalytics();

  const trackRenderTime = useCallback(async (componentName: string, renderTime: number) => {
    await trackPerformance('render_time', renderTime, 'ms', {
      component_name: componentName,
    });
  }, [trackPerformance]);

  const trackLoadTime = useCallback(async (resourceType: string, loadTime: number) => {
    await trackPerformance('load_time', loadTime, 'ms', {
      resource_type: resourceType,
    });
  }, [trackPerformance]);

  const trackApiResponseTime = useCallback(async (endpoint: string, responseTime: number) => {
    await trackPerformance('api_response_time', responseTime, 'ms', {
      endpoint,
    });
  }, [trackPerformance]);

  const trackMemoryUsage = useCallback(async (memoryUsage: number) => {
    await trackPerformance('memory_usage', memoryUsage, 'bytes');
  }, [trackPerformance]);

  return {
    trackRenderTime,
    trackLoadTime,
    trackApiResponseTime,
    trackMemoryUsage,
  };
};

/**
 * Hook for A/B testing
 */
export const useABTest = (testName: string, variant: string) => {
  const { trackEvent } = useAnalytics();

  useEffect(() => {
    trackEvent('ab_test_assigned', {
      test_name: testName,
      variant,
    });
  }, [testName, variant, trackEvent]);

  const trackConversion = useCallback(async (goal: string, value?: number) => {
    await trackEvent('ab_test_conversion', {
      test_name: testName,
      variant,
      goal,
      value,
    });
  }, [testName, variant, trackEvent]);

  return { trackConversion };
};

/**
 * Hook for tracking user journey
 */
export const useJourneyTracking = () => {
  const { trackEvent } = useAnalytics();
  const journeySteps = useRef<Array<{ step: string; timestamp: number }>>([]);

  const addJourneyStep = useCallback((step: string) => {
    const timestamp = Date.now();
    journeySteps.current.push({ step, timestamp });

    trackEvent('journey_step', {
      step,
      step_number: journeySteps.current.length,
      timestamp,
    });
  }, [trackEvent]);

  const completeJourney = useCallback(async (journeyName: string, success: boolean = true) => {
    const journeyData = {
      journey_name: journeyName,
      success,
      total_steps: journeySteps.current.length,
      duration_ms: journeySteps.current.length > 0
        ? Date.now() - journeySteps.current[0].timestamp
        : 0,
      steps: journeySteps.current,
    };

    await trackEvent('journey_complete', journeyData);
    journeySteps.current = [];
  }, [trackEvent]);

  return { addJourneyStep, completeJourney };
};

/**
 * Hook for tracking form interactions
 */
export const useFormTracking = (formName: string) => {
  const { trackEvent, trackError } = useAnalytics();
  const formStartTime = useRef<number>();
  const fieldInteractions = useRef<Set<string>>(new Set());

  const startForm = useCallback(() => {
    formStartTime.current = Date.now();
    fieldInteractions.current.clear();
  }, []);

  const trackFieldInteraction = useCallback((fieldName: string, fieldType: string) => {
    fieldInteractions.current.add(fieldName);
    trackEvent('form_field_interaction', {
      form_name: formName,
      field_name: fieldName,
      field_type: fieldType,
    });
  }, [formName, trackEvent]);

  const trackFormSubmission = useCallback(async (success: boolean, errors?: string[]) => {
    const duration = formStartTime.current ? Date.now() - formStartTime.current : 0;

    await trackEvent('form_submission', {
      form_name: formName,
      success,
      duration_ms: duration,
      fields_interacted: Array.from(fieldInteractions.current),
      error_count: errors?.length || 0,
      errors: errors,
    });
  }, [formName, trackEvent]);

  const trackFormError = useCallback(async (fieldName: string, errorMessage: string) => {
    await trackError(new Error(errorMessage), {
      form_name: formName,
      field_name: fieldName,
    });
  }, [formName, trackError]);

  return {
    startForm,
    trackFieldInteraction,
    trackFormSubmission,
    trackFormError,
  };
};

export default useAnalytics;