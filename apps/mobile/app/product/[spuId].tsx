/**
 * Product Detail Screen
 * Displays comprehensive product information with price comparisons and reviews
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useProductDetails, usePriceHistory } from '@/hooks/use_api';
import { Product, PriceHistory } from '@/types';
import { formatPrice } from '@/utils/currency';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useAlertStore } from '@/store/alert_store';
import { PriceChart } from '@/components/PriceChart';

export default function ProductDetailScreen() {
  const { spuId } = useLocalSearchParams();
  const [activeTab, setActiveTab] = useState<'overview' | 'prices' | 'reviews'>('overview');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  const { data: product, isLoading, error } = useProductDetails(spuId as string);
  const { data: priceHistory } = usePriceHistory(spuId as string);
  const { addAlert } = useAlertStore();

  const bgColor = useThemeColor({ light: '#F2F2F7', dark: '#000000' }, 'background');
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const successColor = useThemeColor({ light: '#34C759', dark: '#30D158' }, 'success');
  const warningColor = useThemeColor({ light: '#FF9500', dark: '#FF9F0A' }, 'warning');

  const handleShare = async () => {
    if (!product) return;

    try {
      await Share.share({
        message: `${product.name} - 最低価格 ${formatPrice(product.lowestPrice.currentPrice, product.lowestPrice.currency)}`,
        url: `https://yabaii.day/product/${product.id}`,
      });
    } catch (error) {
      Alert.alert('エラー', '共有に失敗しました');
    }
  };

  const handleSetAlert = () => {
    if (!product) return;

    addAlert({
      id: `alert_${product.id}_${Date.now()}`,
      productId: product.id,
      productName: product.name,
      type: 'price_drop',
      threshold: 15,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    Alert.alert('成功', '価格アラートを設定しました');
  };

  const renderPriceComparison = () => {
    if (!product?.platforms || product.platforms.length === 0) return null;

    const platforms = [
      { name: 'amazon', price: 12000, originalPrice: 15000 },
      { name: 'rakuten', price: 11800, originalPrice: null },
      { name: 'yahoo', price: 12500, originalPrice: 14000 },
    ].filter(p => selectedPlatform === 'all' || p.name === selectedPlatform);

    return (
      <View style={styles.priceComparisonContainer}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>
          価格比較
        </Text>

        <View style={styles.platformFilter}>
          {['all', 'amazon', 'rakuten', 'yahoo'].map((platform) => (
            <TouchableOpacity
              key={platform}
              style={[
                styles.filterChip,
                {
                  backgroundColor: selectedPlatform === platform ? primaryColor : cardBg,
                }
              ]}
              onPress={() => setSelectedPlatform(platform)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  {
                    color: selectedPlatform === platform ? '#FFFFFF' : textColor,
                  }
                ]}
              >
                {platform === 'all' ? 'すべて' : platform.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {platforms.map((platform, index) => (
          <View key={index} style={[styles.priceCard, { backgroundColor: cardBg }]}>
            <View style={styles.priceCardHeader}>
              <Text style={[styles.platformName, { color: textColor }]}>
                {platform.name.toUpperCase()}
              </Text>
              {platform.originalPrice && (
                <View style={styles.discountBadge}>
                  <Text style={styles.discountText}>
                    -{Math.round(((platform.originalPrice - platform.price) / platform.originalPrice) * 100)}%
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.priceInfo}>
              <Text style={[styles.currentPrice, { color: textColor }]}>
                {formatPrice(platform.price, 'JPY')}
              </Text>
              {platform.originalPrice && (
                <Text style={[styles.originalPrice, { color: secondaryTextColor }]}>
                  {formatPrice(platform.originalPrice, 'JPY')}
                </Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.buyButton, { backgroundColor: primaryColor }]}
              onPress={() => console.log(`Buy from ${platform.name}`)}
            >
              <Text style={styles.buyButtonText}>購入する</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    );
  };

  const renderOverview = () => (
    <View>
      {product?.images && product.images.length > 0 && (
        <View style={styles.imageGallery}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {product.images.map((image, index) => (
              <Image
                key={index}
                source={{ uri: image }}
                style={styles.productImage}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
        </View>
      )}

      <View style={[styles.productInfo, { backgroundColor: cardBg }]}>
        <Text style={[styles.productName, { color: textColor }]}>
          {product?.name}
        </Text>

        {product?.brand && (
          <Text style={[styles.brandText, { color: secondaryTextColor }]}>
            {product.brand}
          </Text>
        )}

        {product?.rating && (
          <View style={styles.ratingContainer}>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Ionicons
                  key={star}
                  name={star <= Math.floor(product.rating) ? 'star' : 'star-outline'}
                  size={16}
                  color="#FFCC00"
                />
              ))}
            </View>
            <Text style={[styles.ratingText, { color: textColor }]}>
              {product.rating.toFixed(1)}
            </Text>
            {product.reviewCount && (
              <Text style={[styles.reviewCount, { color: secondaryTextColor }]}>
                ({product.reviewCount} 件のレビュー)
              </Text>
            )}
          </View>
        )}

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: primaryColor }]}
            onPress={handleSetAlert}
          >
            <Ionicons name="notifications-outline" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>価格アラート</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: successColor }]}
            onPress={handleShare}
          >
            <Ionicons name="share-outline" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>共有</Text>
          </TouchableOpacity>
        </View>

        {product?.description && (
          <View style={styles.descriptionSection}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              商品説明
            </Text>
            <Text style={[styles.description, { color: textColor }]}>
              {product.description}
            </Text>
          </View>
        )}

        {product?.specifications && (
          <View style={styles.specificationsSection}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>
              仕様
            </Text>
            {Object.entries(product.specifications).map(([key, value]) => (
              <View key={key} style={styles.specRow}>
                <Text style={[styles.specKey, { color: secondaryTextColor }]}>
                  {key}
                </Text>
                <Text style={[styles.specValue, { color: textColor }]}>
                  {String(value)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );

  const renderPrices = () => (
    <View>
      {renderPriceComparison()}

      {priceHistory && priceHistory.length > 0 && (
        <View style={[styles.chartContainer, { backgroundColor: cardBg }]}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>
            価格推移
          </Text>
          <PriceChart data={priceHistory} />
        </View>
      )}
    </View>
  );

  const renderReviews = () => (
    <View style={[styles.reviewsContainer, { backgroundColor: cardBg }]}>
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        レビュー
      </Text>
      <Text style={[styles.comingSoon, { color: secondaryTextColor }]}>
        レビュー機能は近日公開予定です
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: bgColor }]}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
          読み込み中...
        </Text>
      </View>
    );
  }

  if (error || !product) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: bgColor }]}>
        <Ionicons name="alert-circle" size={48} color="#FF3B30" />
        <Text style={[styles.errorText, { color: textColor }]}>
          商品情報の読み込みに失敗しました
        </Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: primaryColor }]}
          onPress={() => router.back()}
        >
          <Text style={styles.retryButtonText}>戻る</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor }]}>
          商品詳細
        </Text>
        <TouchableOpacity onPress={handleShare}>
          <Ionicons name="share-outline" size={24} color={textColor} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabContainer}>
        {[
          { key: 'overview', label: '概要' },
          { key: 'prices', label: '価格' },
          { key: 'reviews', label: 'レビュー' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tab,
              {
                borderBottomColor: activeTab === tab.key ? primaryColor : 'transparent',
              }
            ]}
            onPress={() => setActiveTab(tab.key as any)}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color: activeTab === tab.key ? primaryColor : secondaryTextColor,
                }
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'prices' && renderPrices()}
      {activeTab === 'reviews' && renderReviews()}
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
    padding: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  imageGallery: {
    height: 300,
    backgroundColor: '#F5F5F7',
  },
  productImage: {
    width: 300,
    height: 300,
    marginHorizontal: 16,
    borderRadius: 12,
  },
  productInfo: {
    padding: 20,
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 12,
  },
  productName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  brandText: {
    fontSize: 16,
    marginBottom: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
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
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    marginLeft: 8,
  },
  descriptionSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
  },
  specificationsSection: {
    marginBottom: 24,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E7',
  },
  specKey: {
    fontSize: 16,
  },
  specValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E7',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '500',
  },
  priceComparisonContainer: {
    margin: 16,
  },
  platformFilter: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  priceCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  priceCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '600',
  },
  discountBadge: {
    backgroundColor: '#34C759',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  priceInfo: {
    marginBottom: 16,
  },
  currentPrice: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  originalPrice: {
    fontSize: 16,
    textDecorationLine: 'line-through',
  },
  buyButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buyButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  chartContainer: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
  },
  reviewsContainer: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  comingSoon: {
    fontSize: 16,
    textAlign: 'center',
  },
});