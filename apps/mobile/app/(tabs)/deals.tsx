/**
 * Deals Screen
 * Shows promotional deals, special offers, and community-submitted deals
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
  RefreshControl,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeals } from '@/hooks/use_api';
import { Deal } from '@/types';
import { formatPrice, formatRelativeTime } from '@/utils';
import { useThemeColor } from '@/hooks/useThemeColor';
import { router } from 'expo-router';

export default function DealsScreen() {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const bgColor = useThemeColor({ light: '#F2F2F7', dark: '#000000' }, 'background');
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const successColor = useThemeColor({ light: '#34C759', dark: '#30D158' }, 'success');
  const warningColor = useThemeColor({ light: '#FF9500', dark: '#FF9F0A' }, 'warning');

  const categories = [
    { id: 'all', name: 'すべて', icon: 'grid-outline' },
    { id: 'electronics', name: '家電', icon: 'laptop-outline' },
    { id: 'fashion', name: 'ファッション', icon: 'shirt-outline' },
    { id: 'home', name: 'ホーム', icon: 'home-outline' },
    { id: 'beauty', name: 'ビューティー', icon: 'sparkles-outline' },
    { id: 'food', name: '食品', icon: 'restaurant-outline' },
  ];

  const { data: dealsData, isLoading, refetch } = useDeals();

  useEffect(() => {
    if (dealsData) {
      setDeals(dealsData);
    }
  }, [dealsData]);

  useEffect(() => {
    loadDeals();
  }, [selectedCategory]);

  const loadDeals = async () => {
    setLoading(true);
    try {
      // In a real app, filter by category
      // For now, use mock data
      const mockDeals: Deal[] = [
        {
          id: '1',
          title: 'iPhone 15 Pro Max - 20% OFF',
          description: 'Amazonタイムセール！最新iPhoneが最大20%割引',
          type: 'sale',
          discount: { type: 'percentage', value: 20 },
          products: [
            {
              productId: 'iphone-15-pro-max',
              platformId: 'amazon',
              originalPrice: 180000,
              discountedPrice: 144000,
            },
          ],
          platforms: ['amazon'],
          url: 'https://amazon.jp/dp/B0CHX2Q2Q3',
          images: ['https://example.com/iphone15-deal.jpg'],
          startDate: new Date(),
          endDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
          submittedBy: 'user123',
          status: 'active',
          communityScore: { upvotes: 245, downvotes: 12, totalScore: 233 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          title: 'Nintendo Switch - ソフト2本付きセット',
          description: '本体 +人気ソフト2本でお得なセット価格',
          type: 'bundle',
          discount: { type: 'fixed', value: 10000 },
          products: [
            {
              productId: 'switch-console',
              platformId: 'yahoo',
              originalPrice: 32978,
              discountedPrice: 22978,
            },
          ],
          platforms: ['yahoo'],
          url: 'https://shopping.yahoo.co.jp/p/switch-bundle',
          images: ['https://example.com/switch-deal.jpg'],
          startDate: new Date(),
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          status: 'active',
          communityScore: { upvotes: 189, downvotes: 8, totalScore: 181 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '3',
          title: 'Sony WF-1000XM5 - クリアランスセール',
          description: '最新ノイズキャンセリングイヤホンが半額！',
          type: 'clearance',
          discount: { type: 'percentage', value: 50 },
          products: [
            {
              productId: 'sony-wf1000xm5',
              platformId: 'rakuten',
              originalPrice: 39900,
              discountedPrice: 19950,
            },
          ],
          platforms: ['rakuten'],
          url: 'https://books.rakuten.co.jp/rb/12345678/',
          images: ['https://example.com/sony-earbuds.jpg'],
          startDate: new Date(),
          endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
          submittedBy: 'user456',
          status: 'active',
          communityScore: { upvotes: 567, downvotes: 23, totalScore: 544 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      setDeals(mockDeals);
    } catch (error) {
      console.error('Failed to load deals:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    await loadDeals();
    setRefreshing(false);
  };

  const handleDealPress = (deal: Deal) => {
    // Navigate to deal details or external link
    if (deal.url) {
      // In a real app, open in browser or in-app webview
      console.log('Opening deal:', deal.url);
    }
  };

  const renderDealItem = ({ item }: { item: Deal }) => {
    const discountText = item.discount.type === 'percentage'
      ? `${item.discount.value}% OFF`
      : `${formatPrice(item.discount.value, 'JPY')} OFF`;

    const isExpiringSoon = item.endDate
      ? new Date(item.endDate).getTime() - Date.now() < 24 * 60 * 60 * 1000 // less than 24 hours
      : false;

    return (
      <TouchableOpacity
        style={[styles.dealCard, { backgroundColor: cardBg }]}
        onPress={() => handleDealPress(item)}
      >
        {/* Deal Badge */}
        <View style={styles.dealHeader}>
          <View style={[
            styles.dealTypeBadge,
            { backgroundColor: item.type === 'clearance' ? warningColor + '20' : successColor + '20' }
          ]}>
            <Text style={[
              styles.dealTypeText,
              { color: item.type === 'clearance' ? warningColor : successColor }
            ]}>
              {item.type === 'sale' ? 'セール' :
               item.type === 'bundle' ? 'バンドル' :
               item.type === 'clearance' ? 'クリアランス' : '限定'}
            </Text>
          </View>

          {isExpiringSoon && (
            <View style={[styles.expiringBadge, { backgroundColor: '#FF3B3020' }]}>
              <Text style={[styles.expiringText, { color: '#FF3B30' }]}>
                まもなく終了
              </Text>
            </View>
          )}
        </View>

        {/* Deal Image */}
        {item.images && item.images.length > 0 && (
          <Image
            source={{ uri: item.images[0] }}
            style={styles.dealImage}
            resizeMode="cover"
          />
        )}

        {/* Deal Content */}
        <View style={styles.dealContent}>
          <Text style={[styles.dealTitle, { color: textColor }]} numberOfLines={2}>
            {item.title}
          </Text>

          <Text style={[styles.dealDescription, { color: secondaryTextColor }]} numberOfLines={3}>
            {item.description}
          </Text>

          {/* Discount */}
          <View style={styles.discountContainer}>
            <Text style={[styles.discountText, { color: primaryColor }]}>
              {discountText}
            </Text>
            {item.products && item.products.length > 0 && (
              <Text style={[styles.originalPriceText, { color: secondaryTextColor }]}>
                元価格: {formatPrice(item.products[0].originalPrice, 'JPY')}
              </Text>
            )}
          </View>

          {/* Deal Meta */}
          <View style={styles.dealMeta}>
            <View style={styles.platformInfo}>
              <Ionicons name="storefront-outline" size={14} color={secondaryTextColor} />
              <Text style={[styles.platformText, { color: secondaryTextColor }]}>
                {item.platforms?.[0]?.toUpperCase() || 'UNKNOWN'}
              </Text>
            </View>

            <View style={styles.timeInfo}>
              <Ionicons name="time-outline" size={14} color={secondaryTextColor} />
              <Text style={[styles.timeText, { color: secondaryTextColor }]}>
                {item.endDate ? formatRelativeTime(new Date(item.endDate)) : '期間限定'}
              </Text>
            </View>
          </View>

          {/* Community Score */}
          <View style={styles.communityScore}>
            <View style={styles.scoreContainer}>
              <Ionicons name="arrow-up" size={16} color={successColor} />
              <Text style={[styles.scoreText, { color: textColor }]}>
                {item.communityScore.upvotes}
              </Text>
            </View>
            <View style={styles.scoreContainer}>
              <Ionicons name="arrow-down" size={16} color="#FF3B30" />
              <Text style={[styles.scoreText, { color: textColor }]}>
                {item.communityScore.downvotes}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="pricetag-outline" size={64} color={secondaryTextColor} />
      <Text style={[styles.emptyTitle, { color: textColor }]}>
        利用可能なディールがありません
      </Text>
      <Text style={[styles.emptyText, { color: secondaryTextColor }]}>
        新しいディールが追加され次第、ここに表示されます
      </Text>
    </View>
  );

  if (isLoading && deals.length === 0) {
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
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: textColor }]}>
          お得なディール
        </Text>
        <TouchableOpacity onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color={primaryColor} />
        </TouchableOpacity>
      </View>

      {/* Category Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryContainer}
        contentContainerStyle={styles.categoryContent}
      >
        {categories.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.categoryChip,
              {
                backgroundColor: selectedCategory === category.id ? primaryColor : cardBg,
                borderColor: selectedCategory === category.id ? primaryColor : '#E5E5E7',
              }
            ]}
            onPress={() => setSelectedCategory(category.id)}
          >
            <Ionicons
              name={category.icon as any}
              size={16}
              color={selectedCategory === category.id ? '#FFFFFF' : textColor}
            />
            <Text style={[
              styles.categoryText,
              {
                color: selectedCategory === category.id ? '#FFFFFF' : textColor,
              }
            ]}>
              {category.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Deals List */}
      <FlatList
        data={deals}
        renderItem={renderDealItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.dealsList}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={renderEmptyState()}
      />

      {/* Tips */}
      <View style={[styles.tipsContainer, { backgroundColor: cardBg }]}>
        <Text style={[styles.tipsTitle, { color: textColor }]}>
          💡 ディール活用のコツ
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 人気のディールは品切れになりやすいです
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 限定セールは期間内に購入を
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • コミュニティの評価を参考にしましょう
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 複数のプラットフォームで価格を比較して
        </Text>
      </View>
    </View>
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
  categoryContainer: {
    maxHeight: 60,
  },
  categoryContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '500',
  },
  dealsList: {
    padding: 16,
    gap: 16,
  },
  dealCard: {
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  dealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 12,
    paddingBottom: 8,
  },
  dealTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dealTypeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  expiringBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  expiringText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dealImage: {
    width: '100%',
    height: 180,
    backgroundColor: '#F5F5F7',
  },
  dealContent: {
    padding: 16,
  },
  dealTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  dealDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  discountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  discountText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginRight: 8,
  },
  originalPriceText: {
    fontSize: 14,
    textDecorationLine: 'line-through',
  },
  dealMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  platformText: {
    fontSize: 12,
    fontWeight: '500',
  },
  timeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    fontSize: 12,
  },
  communityScore: {
    flexDirection: 'row',
    gap: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '500',
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
    marginBottom: 32,
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