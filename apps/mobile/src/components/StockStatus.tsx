import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

export interface StockStatus {
  inStock: boolean;
  quantity?: number;
  estimatedDelivery?: string;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'pre_order';
  lastUpdated?: Date;
}

interface StockStatusProps {
  status: StockStatus;
  showQuantity?: boolean;
  showDeliveryInfo?: boolean;
  compact?: boolean;
  onAlert?: () => void;
  style?: any;
}

export const StockStatus: React.FC<StockStatusProps> = ({
  status,
  showQuantity = true,
  showDeliveryInfo = true,
  compact = false,
  onAlert,
  style,
}) => {
  const theme = useTheme();

  const getStatusConfig = () => {
    switch (status.stockStatus) {
      case 'in_stock':
        return {
          color: theme.colors.success[500],
          backgroundColor: theme.colors.success[100],
          icon: 'checkmark-circle' as keyof typeof Ionicons.glyphMap,
          text: 'In Stock',
          shortText: 'Available',
        };
      case 'low_stock':
        return {
          color: theme.colors.warning[500],
          backgroundColor: theme.colors.warning[100],
          icon: 'warning' as keyof typeof Ionicons.glyphMap,
          text: 'Low Stock',
          shortText: 'Few Left',
        };
      case 'out_of_stock':
        return {
          color: theme.colors.error[500],
          backgroundColor: theme.colors.error[100],
          icon: 'close-circle' as keyof typeof Ionicons.glyphMap,
          text: 'Out of Stock',
          shortText: 'Sold Out',
        };
      case 'pre_order':
        return {
          color: theme.colors.primary[500],
          backgroundColor: theme.colors.primary[100],
          icon: 'time' as keyof typeof Ionicons.glyphMap,
          text: 'Pre-order',
          shortText: 'Pre-order',
        };
      default:
        return {
          color: theme.colors.gray[500],
          backgroundColor: theme.colors.gray[100],
          icon: 'help-circle' as keyof typeof Ionicons.glyphMap,
          text: 'Unknown',
          shortText: 'Unknown',
        };
    }
  };

  const config = getStatusConfig();

  const getQuantityText = () => {
    if (!showQuantity || !status.quantity) return null;

    if (status.stockStatus === 'in_stock' && status.quantity > 10) {
      return 'Plenty available';
    } else if (status.stockStatus === 'low_stock') {
      return `Only ${status.quantity} left`;
    } else if (status.stockStatus === 'pre_order') {
      return 'Pre-order available';
    }

    return null;
  };

  const getDeliveryText = () => {
    if (!showDeliveryInfo || !status.estimatedDelivery) return null;

    if (status.stockStatus === 'in_stock') {
      return `Delivers by ${status.estimatedDelivery}`;
    } else if (status.stockStatus === 'pre_order') {
      return `Expected ${status.estimatedDelivery}`;
    }

    return null;
  };

  const shouldShowAlert = () => {
    return status.stockStatus === 'out_of_stock' || status.stockStatus === 'low_stock';
  };

  const handleAlertPress = () => {
    if (shouldShowAlert() && onAlert) {
      onAlert();
    }
  };

  if (compact) {
    return (
      <View style={[styles.compactContainer, style]}>
        <View style={[styles.compactStatus, { backgroundColor: config.backgroundColor }]}>
          <Ionicons
            name={config.icon}
            size={12}
            color={config.color}
          />
          <Text style={[styles.compactText, { color: config.color }]}>
            {config.shortText}
          </Text>
        </View>
        {shouldShowAlert() && (
          <TouchableOpacity onPress={handleAlertPress} style={styles.alertButton}>
            <Ionicons
              name="notifications-outline"
              size={14}
              color={theme.colors.primary[500]}
            />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <View style={[styles.statusIndicator, { backgroundColor: config.backgroundColor }]}>
          <Ionicons
            name={config.icon}
            size={16}
            color={config.color}
          />
          <Text style={[styles.statusText, { color: config.color }]}>
            {config.text}
          </Text>
        </View>

        {status.lastUpdated && (
          <Text style={[styles.updatedText, { color: theme.colors.text.secondary }]}>
            Updated {new Date(status.lastUpdated).toLocaleTimeString()}
          </Text>
        )}
      </View>

      {getQuantityText() && (
        <Text style={[styles.quantityText, { color: theme.colors.text.primary }]}>
          {getQuantityText()}
        </Text>
      )}

      {getDeliveryText() && (
        <Text style={[styles.deliveryText, { color: theme.colors.text.secondary }]}>
          {getDeliveryText()}
        </Text>
      )}

      {shouldShowAlert() && (
        <TouchableOpacity
          style={[styles.alertContainer, { backgroundColor: theme.colors.primary[50] }]}
          onPress={handleAlertPress}
        >
          <Ionicons
            name="notifications-outline"
            size={16}
            color={theme.colors.primary[500]}
          />
          <Text style={[styles.alertText, { color: theme.colors.primary[500] }]}>
            {status.stockStatus === 'out_of_stock'
              ? 'Notify me when back in stock'
              : 'Notify me if stock runs low'
            }
          </Text>
        </TouchableOpacity>
      )}

      {status.stockStatus === 'pre_order' && (
        <View style={[styles.preOrderInfo, { backgroundColor: theme.colors.info[50] }]}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color={theme.colors.info[500]}
          />
          <Text style={[styles.preOrderText, { color: theme.colors.info[500] }]}>
            Pre-order items are charged when shipped
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  updatedText: {
    fontSize: 10,
  },
  quantityText: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  deliveryText: {
    fontSize: 12,
    marginBottom: 8,
  },
  alertContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  alertText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 6,
    flex: 1,
  },
  preOrderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  preOrderText: {
    fontSize: 12,
    marginLeft: 6,
    flex: 1,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  compactText: {
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 2,
  },
  alertButton: {
    marginLeft: 8,
    padding: 2,
  },
});

export default StockStatus;