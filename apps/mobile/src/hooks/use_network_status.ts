import { useState, useEffect, useCallback } from 'react';
import { useNetInfo } from '@react-native-community/netinfo';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  type: string;
  connectionType: 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown';
  details?: {
    isConnectionExpensive?: boolean;
    cellularGeneration?: '2g' | '3g' | '4g' | '5g' | 'unknown';
    carrier?: string;
    signalStrength?: number;
  };
  lastChanged?: Date;
}

export interface NetworkMetrics {
  latency: number;
  speed: number;
  reliability: number;
  dataUsage: {
    upload: number;
    download: number;
  };
}

export interface UseNetworkStatusOptions {
  showAlertOnReconnect?: boolean;
  autoRetryOnReconnect?: boolean;
  trackMetrics?: boolean;
  cacheDuration?: number; // in seconds
}

export interface NetworkStatusResult extends NetworkStatus {
  isSlowConnection: boolean;
  isOffline: boolean;
  metrics?: NetworkMetrics;
  retry: () => Promise<void>;
  testConnection: () => Promise<boolean>;
  clearCache: () => Promise<void>;
}

const NETWORK_CACHE_KEY = '@yabaii_network_cache';
const METRICS_CACHE_KEY = '@yabaii_network_metrics';

export function useNetworkStatus(options: UseNetworkStatusOptions = {}): NetworkStatusResult {
  const {
    showAlertOnReconnect = false,
    autoRetryOnReconnect = true,
    trackMetrics = false,
    cacheDuration = 300, // 5 minutes
  } = options;

  const netInfo = useNetInfo();
  const [metrics, setMetrics] = useState<NetworkMetrics | undefined>();
  const [lastChanged, setLastChanged] = useState<Date>();

  // Determine connection quality
  const isSlowConnection = netInfo.type === 'cellular' &&
    (netInfo.details?.cellularGeneration === '2g' ||
     netInfo.details?.cellularGeneration === '3g' ||
     (metrics && metrics.latency > 2000));

  const isOffline = netInfo.type === 'none' || netInfo.isInternetReachable === false;

  // Network status object
  const networkStatus: NetworkStatus = {
    isConnected: netInfo.isConnected || false,
    isInternetReachable: netInfo.isInternetReachable || false,
    type: netInfo.type || 'unknown',
    connectionType: (netInfo.type as any) || 'unknown',
    details: {
      isConnectionExpensive: netInfo.details?.isConnectionExpensive,
      cellularGeneration: netInfo.details?.cellularGeneration,
      carrier: netInfo.details?.carrier,
      signalStrength: netInfo.details?.strength,
    },
    lastChanged,
  };

  // Test network connection
  const testConnection = useCallback(async (): Promise<boolean> => {
    try {
      // Test with a simple request to your API
      const response = await fetch('https://api.yabaii.day/health', {
        method: 'HEAD',
        timeout: 5000,
        cache: 'no-cache',
      });

      return response.ok || response.status === 404; // 404 means server is reachable
    } catch (error) {
      console.log('Connection test failed:', error);
      return false;
    }
  }, []);

  // Measure network metrics
  const measureMetrics = useCallback(async (): Promise<NetworkMetrics | null> => {
    if (!netInfo.isConnected) return null;

    try {
      const startTime = Date.now();
      const testData = new ArrayBuffer(1024); // 1KB test data

      // Measure latency
      const latencyResponse = await fetch('https://api.yabaii.day/ping', {
        method: 'HEAD',
        cache: 'no-cache',
      });
      const latency = Date.now() - startTime;

      // Estimate speed (simplified)
      const speed = netInfo.type === 'wifi' ? 50000 : // 50 Mbps wifi estimate
                   netInfo.details?.cellularGeneration === '5g' ? 100000 : // 100 Mbps 5g
                   netInfo.details?.cellularGeneration === '4g' ? 20000 : // 20 Mbps 4g
                   netInfo.details?.cellularGeneration === '3g' ? 1000 : // 1 Mbps 3g
                   500; // 500 kbps fallback

      // Calculate reliability (based on recent connection stability)
      const cacheKey = `${METRICS_CACHE_KEY}_reliability`;
      const reliabilityData = await AsyncStorage.getItem(cacheKey);
      let reliability = 0.8; // Default reliability

      if (reliabilityData) {
        const history = JSON.parse(reliabilityData);
        const recentSuccesses = history.filter((h: boolean) => h).length;
        reliability = recentSuccesses / Math.min(history.length, 10);
      }

      const newMetrics: NetworkMetrics = {
        latency,
        speed,
        reliability,
        dataUsage: {
          upload: 0, // Would be tracked by actual requests
          download: 0,
        },
      };

      if (trackMetrics) {
        setMetrics(newMetrics);
        await AsyncStorage.setItem(METRICS_CACHE_KEY, JSON.stringify(newMetrics));
      }

      return newMetrics;
    } catch (error) {
      console.error('Failed to measure network metrics:', error);
      return null;
    }
  }, [netInfo.isConnected, trackMetrics]);

  // Clear network cache
  const clearCache = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove([NETWORK_CACHE_KEY, METRICS_CACHE_KEY]);
      setMetrics(undefined);
    } catch (error) {
      console.error('Failed to clear network cache:', error);
    }
  }, []);

  // Retry failed requests
  const retry = useCallback(async () => {
    const isConnected = await testConnection();

    if (isConnected) {
      if (showAlertOnReconnect) {
        Alert.alert(
          'Connection Restored',
          'Your internet connection has been restored.',
          [{ text: 'OK', style: 'default' }]
        );
      }

      if (trackMetrics) {
        await measureMetrics();
      }

      // Update reliability history
      const cacheKey = `${METRICS_CACHE_KEY}_reliability`;
      const reliabilityData = await AsyncStorage.getItem(cacheKey);
      const history = reliabilityData ? JSON.parse(reliabilityData) : [];
      history.push(true);

      // Keep only last 20 entries
      if (history.length > 20) {
        history.shift();
      }

      await AsyncStorage.setItem(cacheKey, JSON.stringify(history));
    } else {
      // Update reliability history
      const cacheKey = `${METRICS_CACHE_KEY}_reliability`;
      const reliabilityData = await AsyncStorage.getItem(cacheKey);
      const history = reliabilityData ? JSON.parse(reliabilityData) : [];
      history.push(false);

      if (history.length > 20) {
        history.shift();
      }

      await AsyncStorage.setItem(cacheKey, JSON.stringify(history));

      throw new Error('Connection test failed');
    }
  }, [testConnection, showAlertOnReconnect, trackMetrics, measureMetrics]);

  // Handle network state changes
  useEffect(() => {
    const handleNetworkChange = async () => {
      const now = new Date();
      setLastChanged(now);

      if (netInfo.isConnected && netInfo.isInternetReachable) {
        if (autoRetryOnReconnect) {
          try {
            await retry();
          } catch (error) {
            console.log('Auto retry failed:', error);
          }
        }

        if (trackMetrics) {
          await measureMetrics();
        }
      }
    };

    handleNetworkChange();
  }, [netInfo.isConnected, netInfo.isInternetReachable, autoRetryOnReconnect, retry, trackMetrics, measureMetrics]);

  // Load cached metrics on mount
  useEffect(() => {
    const loadCachedMetrics = async () => {
      if (trackMetrics) {
        try {
          const cachedMetrics = await AsyncStorage.getItem(METRICS_CACHE_KEY);
          if (cachedMetrics) {
            const metrics = JSON.parse(cachedMetrics);
            const now = Date.now();

            // Check if cache is still valid
            if (now - new Date(metrics.timestamp).getTime() < cacheDuration * 1000) {
              setMetrics(metrics);
            }
          }
        } catch (error) {
          console.error('Failed to load cached metrics:', error);
        }
      }
    };

    loadCachedMetrics();
  }, [trackMetrics, cacheDuration]);

  // Background metrics monitoring
  useEffect(() => {
    if (!trackMetrics) return;

    const interval = setInterval(async () => {
      if (netInfo.isConnected) {
        await measureMetrics();
      }
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [trackMetrics, netInfo.isConnected, measureMetrics]);

  return {
    ...networkStatus,
    isSlowConnection,
    isOffline,
    metrics,
    retry,
    testConnection,
    clearCache,
  };
}

// Additional hook for offline-first data management
export function useOfflineData<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    staleTime?: number;
    cacheTime?: number;
    networkStatus?: NetworkStatusResult;
  } = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>();

  const { staleTime = 300000, cacheTime = 86400000, networkStatus } = options; // 5 min stale, 24h cache

  const loadData = useCallback(async (forceRefresh = false) => {
    try {
      setIsLoading(true);
      setError(null);

      // Try to load from cache first
      const cacheKey = `@yabaii_cache_${key}`;
      const cached = await AsyncStorage.getItem(cacheKey);

      if (cached && !forceRefresh) {
        const parsed = JSON.parse(cached);
        const now = Date.now();
        const age = now - new Date(parsed.timestamp).getTime();

        if (age < staleTime) {
          setData(parsed.data);
          setLastUpdated(new Date(parsed.timestamp));
          setIsLoading(false);
          return;
        }
      }

      // Fetch fresh data if online
      if (networkStatus?.isConnected !== false) {
        const freshData = await fetcher();

        // Cache the fresh data
        await AsyncStorage.setItem(cacheKey, JSON.stringify({
          data: freshData,
          timestamp: new Date().toISOString(),
        }));

        setData(freshData);
        setLastUpdated(new Date());
      } else if (cached) {
        // Use cached data if offline
        const parsed = JSON.parse(cached);
        setData(parsed.data);
        setLastUpdated(new Date(parsed.timestamp));
      }

    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [key, fetcher, staleTime, networkStatus?.isConnected]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh when coming back online
  useEffect(() => {
    if (networkStatus?.isConnected && lastUpdated) {
      const timeSinceUpdate = Date.now() - lastUpdated.getTime();
      if (timeSinceUpdate > staleTime) {
        loadData(true);
      }
    }
  }, [networkStatus?.isConnected, lastUpdated, staleTime, loadData]);

  // Clear cache
  const clearCache = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(`@yabaii_cache_${key}`);
      setData(null);
      setLastUpdated(undefined);
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }, [key]);

  return {
    data,
    isLoading,
    error,
    lastUpdated,
    refresh: () => loadData(true),
    clearCache,
  };
}

export default useNetworkStatus;