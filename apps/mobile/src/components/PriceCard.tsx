/**
 * Price Card Component
 * Displays price information for a specific platform
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColor } from '@/hooks/useThemeColor';
import { formatPrice } from '@/utils/currency';

interface PriceCardProps {
  platform: string;
  price: number;
  originalPrice?: number;
  currency: string;
  available: boolean;
  stockCount?: number;
  onBuy: () => void;
  onCompare?: () => void;
  showCompareButton?: boolean;
}

export const PriceCard: React.FC<PriceCardProps> = ({
  platform,
  price,
  originalPrice,
  currency,
  available,
  stockCount,
  onBuy,
  onCompare,
  showCompareButton = false,
}) => {
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const successColor = useThemeColor({ light: '#34C759', dark: '#30D158' }, 'success');
  const warningColor = useThemeColor({ light: '#FF9500', dark: '#FF9F0A' }, 'warning');

  const hasDiscount = originalPrice && originalPrice > price;
  const discountPercentage = hasDiscount
    ? Math.round(((originalPrice! - price) / originalPrice!) * 100)
    : 0;

  const getPlatformIcon = (platform: string) => {
      const iconMap: { [key: string]: string } = {
        amazon: 'logo-amazon',
        rakuten: 'storefront',
        yahoo: 'logo-yahoo',
        kakaku: 'pricetag',
        mercari: 'cart',
      };
      return iconMap[platform.toLowerCase()] || 'storefront';
  };

  const getPlatformColor = (platform: string) => {
      const colorMap: { [key: string]: string } = {
        amazon: '#FF9900',
        rakuten: '#BF0000',
        yahoo: '#4B0082',
        kakaku: '#00BFFF',
        mercari: '#FFCC00',
      };
      return colorMap[platform.toLowerCase()] || primaryColor;
  };

  const platformColor = getPlatformColor(platform);

  return (
    <View style={[styles.container, { backgroundColor: cardBg }]}>
      <View style={styles.header}>
        <View style={styles.platformInfo}>
          <Ionicons
            name={getPlatformIcon(platform) as any}
            size={20}
            color={platformColor}
          />
          <Text style={[styles.platformName, { color: textColor }]}>
            {platform.toUpperCase()}
          </Text>
        </View>

        {hasDiscount && (
          <View style={[styles.discountBadge, { backgroundColor: successColor }]}>
            <Text style={styles.discountText}>
              -{discountPercentage}%
            </Text>
          </View>
        )}
      </View>

      <View style={styles.priceSection}>
        <View style={styles.prices}>
          <Text style={[styles.currentPrice, { color: textColor }]}>
            {formatPrice(price, currency)}
          </Text>
          {originalPrice && (
            <Text style={[styles.originalPrice, { color: secondaryTextColor }]}>
              {formatPrice(originalPrice, currency)}
            </Text>
          )}
        </View>

        {!available && (
          <View style={styles.stockStatus}>
            <Ionicons name="close-circle" size={14} color="#FF3B30" />
            <Text style={[styles.stockText, { color: '#FF3B30' }]}>
              在庫切れ
            </Text>
          </View>
        )}

        {available && stockCount !== undefined && stockCount < 5 && (
          <View style={styles.stockStatus}>
            <Ionicons name="warning" size={14} color={warningColor} />
            <Text style={[styles.stockText, { color: warningColor }]}>
              あとり{stockCount}個
            </Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        {showCompareButton && (
          <TouchableOpacity
            style={[styles.compareButton, { backgroundColor: cardBg }]}
            onPress={onCompare}
          >
            <Ionicons name="git-compare" size={16} color={primaryColor} />
            <Text style={[styles.compareButtonText, { color: primaryColor }]}>
              比較
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.buyButton,
            {
              backgroundColor: available ? primaryColor : '#E5E5E7',
            }
          ]}
          onPress={onBuy}
          disabled={!available}
        >
          <Ionicons
            name={available ? 'cart' : 'close-circle'}
            size={16}
            color={available ? '#FFFFFF' : secondaryTextColor}
          />
          <Text
            style={[
              styles.buyButtonText,
              {
                color: available ? '#FFFFFF' : secondaryTextColor,
              }
            ]}
          >
            {available ? '購入する' : '在庫切れ'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformName: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  discountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  priceSection: {
    marginBottom: 12,
  },
  prices: {
    alignItems: 'flex-start',
  },
  currentPrice: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  originalPrice: {
    fontSize: 14,
    textDecorationLine: 'line-through',
    marginTop: 4,
  },
  stockStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  stockText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  compareButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E7',
  },
  compareButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 4,
  },
  buyButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  buyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
});