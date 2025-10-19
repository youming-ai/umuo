import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useNetInfo } from '@react-native-community/netinfo';

interface OfflineIndicatorProps {
  showDetails?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  style?: any;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  showDetails = false,
  onRetry,
  onDismiss,
  style,
}) => {
  const netInfo = useNetInfo();
  const theme = useTheme();
  const [animValue] = useState(new Animated.Value(0));
  const [isVisible, setIsVisible] = useState(false);

  const isOffline = netInfo.type === 'none' || netInfo.isInternetReachable === false;
  const isSlowConnection = netInfo.type === 'cellular' && (netInfo.details?.cellularGeneration === '2g' || netInfo.details?.cellularGeneration === '3g');

  useEffect(() => {
    if (isOffline) {
      setIsVisible(true);
      Animated.timing(animValue, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start();
    } else if (isVisible) {
      Animated.timing(animValue, {
        toValue: 0,
        duration: 300,
        useNativeDriver: false,
      }).start(() => setIsVisible(false));
    }
  }, [isOffline, isVisible]);

  const getConnectionTypeText = () => {
    switch (netInfo.type) {
      case 'wifi':
        return 'Wi-Fi';
      case 'cellular':
        return `Mobile (${netInfo.details?.cellularGeneration || 'Unknown'})`;
      case 'ethernet':
        return 'Ethernet';
      default:
        return 'Unknown';
    }
  };

  const getLastSyncTime = () => {
    // This would typically come from your data store
    const lastSync = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    return lastSync.toLocaleTimeString();
  };

  const getCachedDataInfo = () => {
    // This would typically query your local storage
    return {
      productsCount: 156,
      lastSync: getLastSyncTime(),
      size: '2.3 MB',
    };
  };

  if (!isVisible) return null;

  const containerStyle = {
    height: animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 80],
    }),
    opacity: animValue,
  };

  return (
    <Animated.View style={[styles.container, containerStyle, { backgroundColor: theme.colors.warning[50] }, style]}>
      <View style={styles.content}>
        <View style={styles.leftSection}>
          <Ionicons
            name={isOffline ? 'cloud-offline-outline' : isSlowConnection ? 'warning-outline' : 'wifi-outline'}
            size={20}
            color={isOffline ? theme.colors.error[500] : theme.colors.warning[500]}
          />
          <View style={styles.textContainer}>
            <Text style={[styles.title, { color: isOffline ? theme.colors.error[500] : theme.colors.warning[500] }]}>
              {isOffline ? 'No Internet Connection' : isSlowConnection ? 'Slow Connection' : 'Connected'}
            </Text>
            {showDetails && (
              <Text style={[styles.details, { color: theme.colors.text.secondary }]}>
                {isOffline ? 'Showing cached data' : getConnectionTypeText()}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.rightSection}>
          {showDetails && !isOffline && (
            <Text style={[styles.cachedInfo, { color: theme.colors.text.secondary }]}>
              {getCachedDataInfo().productsCount} items cached
            </Text>
          )}

          {onRetry && isOffline && (
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: theme.colors.primary[500] }]}
              onPress={onRetry}
            >
              <Ionicons
                name="refresh-outline"
                size={16}
                color={theme.colors.white}
              />
              <Text style={[styles.retryText, { color: theme.colors.white }]}>
                Retry
              </Text>
            </TouchableOpacity>
          )}

          {onDismiss && !isOffline && (
            <TouchableOpacity
              style={styles.dismissButton}
              onPress={onDismiss}
            >
              <Ionicons
                name="close-outline"
                size={20}
                color={theme.colors.text.secondary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Detailed offline information */}
      {showDetails && isOffline && (
        <View style={[styles.detailedInfo, { borderTopColor: theme.colors.border }]}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.colors.text.secondary }]}>
              Cached Data:
            </Text>
            <Text style={[styles.infoValue, { color: theme.colors.text.primary }]}>
              {getCachedDataInfo().productsCount} products ({getCachedDataInfo().size})
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.colors.text.secondary }]}>
              Last Sync:
            </Text>
            <Text style={[styles.infoValue, { color: theme.colors.text.primary }]}>
              {getCachedDataInfo().lastSync}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: theme.colors.text.secondary }]}>
              Available Features:
            </Text>
            <Text style={[styles.infoValue, { color: theme.colors.text.primary }]}>
              Browse, Search, View Saved Items
            </Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
};

interface OfflineBannerProps {
  visible: boolean;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  visible,
  message = 'You\'re offline. Some features may be unavailable.',
  actionLabel = 'Learn More',
  onAction,
}) => {
  const theme = useTheme();

  if (!visible) return null;

  return (
    <View style={[styles.banner, { backgroundColor: theme.colors.warning[100] }]}>
      <Ionicons
        name="cloud-offline-outline"
        size={16}
        color={theme.colors.warning[500]}
      />
      <Text style={[styles.bannerText, { color: theme.colors.warning[700] }]}>
        {message}
      </Text>
      {onAction && (
        <TouchableOpacity onPress={onAction}>
          <Text style={[styles.bannerAction, { color: theme.colors.warning[600] }]}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  textContainer: {
    marginLeft: 12,
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  details: {
    fontSize: 12,
    marginTop: 2,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cachedInfo: {
    fontSize: 12,
    marginRight: 12,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  dismissButton: {
    padding: 4,
  },
  detailedInfo: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  infoLabel: {
    fontSize: 12,
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '500',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 8,
  },
  bannerText: {
    fontSize: 14,
    flex: 1,
    marginLeft: 8,
    fontWeight: '500',
  },
  bannerAction: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default OfflineIndicator;