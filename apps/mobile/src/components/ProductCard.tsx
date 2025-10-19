/**
 * Product Card Component
 * Displays product information in a card format
 */

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Product } from '@/types';
import { useThemeColor } from '@/hooks/useThemeColor';
import { formatPrice } from '@/utils/currency';

interface ProductCardProps {
  product: Product;
  onPress?: (product: Product) => void;
  onAlertPress?: (product: Product) => void;
  showAlertButton?: boolean;
  compact?: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onPress,
  onAlertPress,
  showAlertButton = true,
  compact = false,
}) => {
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'background');
  const borderColor = useThemeColor({ light: '#E5E5E7', dark: '#38383A' }, 'border');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');

  const handlePress = () => {
    onPress?.(product);
  };

  const handleAlertPress = (e: any) => {
    e.stopPropagation();
    onAlertPress?.(product);
  };

  const renderPriceInfo = () => {
    const { currentPrice, originalPrice, currency } = product.lowestPrice;
    const hasDiscount = originalPrice && originalPrice > currentPrice;
    const discountPercentage = hasDiscount
      ? Math.round(((originalPrice! - currentPrice) / originalPrice!) * 100)
      : 0;

    return (
      <View style={styles.priceContainer}>
        <Text style={[styles.currentPrice, { color: textColor }]}>
          {formatPrice(currentPrice, currency)}
        </Text>

        {hasDiscount && (
          <>
            <Text style={[styles.originalPrice, { color: secondaryTextColor }]}>
              {formatPrice(originalPrice!, currency)}
            </Text>
            <View style={[styles.discountBadge, { backgroundColor: '#FF3B30' }]}>
              <Text style={styles.discountText}>
                -{discountPercentage}%
              </Text>
            </View>
          </>
        )}
      </View>
    );
  };

  const renderRating = () => {
    if (!product.rating) return null;

    return (
      <View style={styles.ratingContainer}>
        <Ionicons
          name="star"
          size={14}
          color="#FFCC00"
        />
        <Text style={[styles.ratingText, { color: secondaryTextColor }]}>
          {product.rating.toFixed(1)}
        </Text>
        {product.reviewCount && (
          <Text style={[styles.reviewCount, { color: secondaryTextColor }]}>
            ({product.reviewCount})
          </Text>
        )}
      </View>
    );
  };

  const renderPlatforms = () => {
    if (!product.platforms || product.platforms.length === 0) return null;

    return (
      <View style={styles.platformsContainer}>
        {product.platforms.slice(0, 3).map((platform, index) => (
          <View
            key={index}
            style={[
              styles.platformBadge,
              { backgroundColor: primaryColor + '20' }
            ]}
          >
            <Text style={[styles.platformText, { color: primaryColor }]}>
              {platform}
            </Text>
          </View>
        ))}
        {product.platforms.length > 3 && (
          <Text style={[styles.morePlatformsText, { color: secondaryTextColor }]}>
            +{product.platforms.length - 3}
          </Text>
        )}
      </View>
    );
  };

  const cardHeight = compact ? 120 : 180;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: cardBg,
          borderColor: borderColor,
          height: cardHeight,
        }
      ]}
      onPress={handlePress}
      accessible={true}
      accessibilityLabel={`${product.name}, current price ${formatPrice(product.lowestPrice.currentPrice, product.lowestPrice.currency)}`}
    >
      <Image
        source={{ uri: product.image }}
        style={[styles.image, { height: compact ? 80 : 120 }]}
        resizeMode="cover"
      />

      <View style={styles.content}>
        <Text
          style={[styles.name, { color: textColor }]}
          numberOfLines={compact ? 1 : 2}
        >
          {product.name}
        </Text>

        {product.brand && (
          <Text style={[styles.brand, { color: secondaryTextColor }]}>
            {product.brand}
          </Text>
        )}

        <View style={styles.spacer} />

        {renderPriceInfo()}
        {renderRating()}
        {renderPlatforms()}

        {showAlertButton && !compact && (
          <TouchableOpacity
            style={[
              styles.alertButton,
              { backgroundColor: primaryColor + '20' }
            ]}
            onPress={handleAlertPress}
          >
            <Ionicons name="notifications-outline" size={16} color={primaryColor} />
            <Text style={[styles.alertButtonText, { color: primaryColor }]}>
              価格アラート
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginVertical: 6,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  image: {
    width: 100,
    borderRadius: 8,
    backgroundColor: '#F5F5F7',
  },
  content: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  brand: {
    fontSize: 14,
    marginTop: 2,
  },
  spacer: {
    flex: 1,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  currentPrice: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  originalPrice: {
    fontSize: 14,
    textDecorationLine: 'line-through',
    marginLeft: 8,
  },
  discountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  discountText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  ratingText: {
    fontSize: 14,
    marginLeft: 4,
  },
  reviewCount: {
    fontSize: 12,
    marginLeft: 2,
  },
  platformsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  platformBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  platformText: {
    fontSize: 10,
    fontWeight: '500',
  },
  morePlatformsText: {
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 4,
  },
  alertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginTop: 8,
  },
  alertButtonText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
});