/**
 * Price Comparison Screen
 * Allows users to compare products side by side
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProductDetails } from '@/hooks/use_api';
import { ProductCard } from '@/components/ProductCard';
import { useThemeColor } from '@/hooks/useThemeColor';
import { formatPrice } from '@/utils/currency';

export default function CompareScreen() {
  const [compareList, setCompareList] = useState<string[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const bgColor = useThemeColor({ light: '#F2F2F7', dark: '#000000' }, 'background');
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const successColor = useThemeColor({ light: '#34C759', dark: '#30D158' }, 'success');

  useEffect(() => {
    // Load saved compare list
    loadCompareList();
  }, []);

  useEffect(() => {
    if (compareList.length > 0) {
      loadProducts();
    } else {
      setProducts([]);
    }
  }, [compareList]);

  const loadCompareList = () => {
    // In a real app, load from AsyncStorage
    // For now, use mock data
    setCompareList(['1', '2', '3']);
  };

  const loadProducts = async () => {
    setLoading(true);
    try {
      // In a real app, fetch product details
      const mockProducts = [
        {
          id: '1',
          name: 'iPhone 15 Pro',
          brand: 'Apple',
          image: 'https://example.com/iphone15.jpg',
          rating: 4.8,
          reviewCount: 1250,
          platforms: ['amazon', 'rakuten'],
          lowestPrice: {
            currentPrice: 128000,
            currency: 'JPY',
            originalPrice: 148000,
          },
        },
        {
          id: '2',
          name: 'iPhone 15',
          brand: 'Apple',
          image: 'https://example.com/iphone15.jpg',
          rating: 4.7,
          reviewCount: 890,
          platforms: ['amazon', 'yahoo'],
          lowestPrice: {
            currentPrice: 98000,
            currency: 'JPY',
          },
        },
        {
          id: '3',
          name: 'iPhone 14 Pro',
          brand: 'Apple',
          image: 'https://example.com/iphone14.jpg',
          rating: 4.6,
          reviewCount: 670,
          platforms: ['amazon', 'rakuten', 'yahoo'],
          lowestPrice: {
            currentPrice: 108000,
            currency: 'JPY',
            originalPrice: 130000,
          },
        },
      ].filter(p => compareList.includes(p.id));

      setProducts(mockProducts);
    } catch (error) {
      console.error('Failed to load products:', error);
    } finally {
      setLoading(false);
    }
  };

  const removeFromCompare = (productId: string) => {
    const newList = compareList.filter(id => id !== productId);
    setCompareList(newList);

    // Save to AsyncStorage
    // await AsyncStorage.setItem('compare_list', JSON.stringify(newList));
  };

  const clearCompareList = () => {
    setCompareList([]);
    setProducts([]);

    // Clear from AsyncStorage
    // await AsyncStorage.removeItem('compare_list');
  };

  const renderCompareItem = ({ item, index }: { item: any; index: number }) => (
    <View key={item.id} style={[styles.compareItem, { backgroundColor: cardBg }]}>
      <View style={styles.compareHeader}>
        <View style={styles.productInfo}>
          <Text style={[styles.productName, { color: textColor }]}>
            {item.name}
          </Text>
          <Text style={[styles.brandText, { color: secondaryTextColor }]}>
            {item.brand}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => removeFromCompare(item.id)}
        >
          <Ionicons name="close-circle" size={20} color="#FF3B30" />
        </TouchableOpacity>
      </View>

      <Image
        source={{ uri: item.image }}
        style={styles.productImage}
        resizeMode="cover"
      />

      <View style={styles.priceContainer}>
        <Text style={[styles.currentPrice, { color: textColor }]}>
          {formatPrice(item.lowestPrice.currentPrice, item.lowestPrice.currency)}
        </Text>
        {item.lowestPrice.originalPrice && (
          <Text style={[styles.originalPrice, { color: secondaryTextColor }]}>
            {formatPrice(item.lowestPrice.originalPrice, item.lowestPrice.currency)}
          </Text>
        )}
        {item.lowestPrice.originalPrice && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>
              -{Math.round(((item.lowestPrice.originalPrice - item.lowestPrice.currentPrice) / item.lowestPrice.originalPrice) * 100)}%
            </Text>
          </View>
        )}
      </View>

      <View style={styles.ratingContainer}>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Ionicons
              key={star}
              name={star <= Math.floor(item.rating) ? 'star' : 'star-outline'}
              size={14}
              color="#FFCC00"
            />
          ))}
        </View>
        <Text style={[styles.ratingText, { color: textColor }]}>
          {item.rating.toFixed(1)}
        </Text>
        <Text style={[styles.reviewCount, { color: secondaryTextColor }]}>
          ({item.reviewCount})
        </Text>
      </View>

      <View style={styles.platformsContainer}>
        {item.platforms.map((platform: string, pIndex: number) => (
          <View key={pIndex} style={[styles.platformBadge, { backgroundColor: primaryColor + '20' }]}>
            <Text style={[styles.platformText, { color: primaryColor }]}>
              {platform.toUpperCase()}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.viewDetailsButton, { backgroundColor: primaryColor }]}
      onPress={() => {
        // Navigate to product details
        console.log(`Navigate to product ${item.id}`);
      }}
      >
        <Text style={styles.viewDetailsButtonText}>詳細を見る</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="git-compare-outline" size={64} color={secondaryTextColor} />
      <Text style={[styles.emptyTitle, { color: textColor }]}>
        比較リストが空です
      </Text>
      <Text style={[styles.emptyText, { color: secondaryTextColor }]}>
        商品詳細ページで「比較に追加」ボタンを押して、商品を比較リストに追加してください
      </Text>
      <TouchableOpacity
        style={[styles.browseButton, { backgroundColor: primaryColor }]}
        onPress={() => {
          // Navigate to search or browse products
          console.log('Navigate to search');
        }}
      >
        <Ionicons name="search" size={20} color="#FFFFFF" />
        <Text style={styles.browseButtonText}>商品を探す</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading && compareList.length > 0) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: bgColor }]}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
          読み込み中...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: textColor }]}>
          価格比較
        </Text>
        {compareList.length > 0 && (
          <TouchableOpacity onPress={clearCompareList}>
            <Text style={[styles.clearButton, { color: primaryColor }]}>
              すべてクリア
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Compare List */}
      {products.length > 0 ? (
        <View style={styles.compareContainer}>
          <View style={styles.compareStats}>
            <Text style={[styles.statsText, { color: textColor }]}>
              {compareList.length} 商品を比較中
            </Text>
            <Text style={[styles.statsSubtext, { color: secondaryTextColor }]}>
              最低価格: {formatPrice(Math.min(...products.map(p => p.lowestPrice.currentPrice)), 'JPY')}
            </Text>
          </View>

          <FlatList
            data={products}
            renderItem={({ item, index }) => renderCompareItem({ item, index })}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContainer}
          />
        </View>
      ) : (
        renderEmptyState()
      )}

      {/* Tips */}
      <View style={[styles.tipsContainer, { backgroundColor: cardBg }]}>
        <Text style={[styles.tipsTitle, { color: textColor }]}>
          💡 比較のコツ
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 最大4商品まで同時に比較できます
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 商品詳細ページの「比較に追加」で比較リストに追加できます
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 価格、評価、プラットフォームで比較できます
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • お気に入りの商品を比較して最適な価格を見つけましょう
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  clearButton: {
    fontSize: 16,
    fontWeight: '500',
  },
  compareContainer: {
    padding: 16,
  },
  compareStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#F5F5F7',
    borderRadius: 12,
  },
  statsText: {
    fontSize: 16,
    fontWeight: '600',
  },
  statsSubtext: {
    fontSize: 14,
  },
  listContainer: {
    gap: 16,
  },
  compareItem: {
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  compareHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 8,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  brandText: {
    fontSize: 14,
  },
  removeButton: {
    padding: 4,
  },
  productImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#F5F5F7',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  currentPrice: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  originalPrice: {
    fontSize: 16,
    textDecorationLine: 'line-through',
    marginLeft: 8,
  },
  discountBadge: {
    backgroundColor: '#34C759',
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
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  stars: {
    flexDirection: 'row',
    marginRight: 8,
  },
  ratingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  reviewCount: {
    fontSize: 14,
    marginLeft: 4,
  },
  platformsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
    marginBottom: 4,
  },
  platformText: {
    fontSize: 12,
    fontWeight: '500',
  },
  viewDetailsButton: {
    margin: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewDetailsButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    color: '#666',
    marginBottom: 32,
  },
  browseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  tipsContainer: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
  },
  tipsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  tipText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
});