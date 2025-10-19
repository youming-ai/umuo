/**
 * Home Screen - Main tab screen with recommendations and quick search
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSearchStore } from '@/store/search_store';
import { useSearchProducts } from '@/hooks/use_api';
import { Product } from '@/types';
import { ProductCard } from '@/components/ProductCard';
import { useThemeColor } from '@/hooks/useThemeColor';

export default function HomeScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const { recentSearches, popularSearches, addToRecentSearches } = useSearchStore();
  const searchMutation = useSearchProducts();

  const bgColor = useThemeColor({ light: '#F2F2F7', dark: '#000000' }, 'background');
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');

  const handleSearch = () => {
    if (!searchQuery.trim()) return;

    addToRecentSearches(searchQuery);
    router.push({
      pathname: '/search',
      params: { q: searchQuery },
    });
  };

  const handlePopularSearch = (query: string) => {
    addToRecentSearches(query);
    router.push({
      pathname: '/search',
      params: { q: query },
    });
  };

  const handleProductPress = (product: Product) => {
    router.push(`/product/${product.id}`);
  };

  const renderRecommendationItem = ({ item }: { item: Product }) => (
    <ProductCard
      product={item}
      onPress={handleProductPress}
      compact
    />
  );

  const renderSearchHistoryItem = ({ item }: { item: string }) => (
    <TouchableOpacity
      style={[styles.historyItem, { backgroundColor: cardBg }]}
      onPress={() => handlePopularSearch(item)}
    >
      <Ionicons name="time-outline" size={16} color={secondaryTextColor} />
      <Text style={[styles.historyText, { color: textColor }]}>{item}</Text>
      <Ionicons name="chevron-forward" size={16} color={secondaryTextColor} />
    </TouchableOpacity>
  );

  const renderPopularSearchItem = ({ item }: { item: string }) => (
    <TouchableOpacity
      style={[styles.popularItem, { backgroundColor: primaryColor + '20' }]}
      onPress={() => handlePopularSearch(item)}
    >
      <Text style={[styles.popularText, { color: primaryColor }]}>{item}</Text>
    </TouchableOpacity>
  );

  // Mock recommendations data
  const recommendations: Product[] = [
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
      name: 'Nintendo Switch OLED',
      brand: 'Nintendo',
      image: 'https://example.com/switch.jpg',
      rating: 4.7,
      reviewCount: 890,
      platforms: ['amazon', 'yahoo'],
      lowestPrice: {
        currentPrice: 35000,
        currency: 'JPY',
      },
    },
  ];

  return (
    <ScrollView style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: textColor }]}>
          Yabaii
        </Text>
        <Text style={[styles.subtitle, { color: secondaryTextColor }]}>
          価格比較アプリ
        </Text>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: cardBg }]}>
        <Ionicons name="search" size={20} color={secondaryTextColor} />
        <TextInput
          style={[styles.searchInput, { color: textColor }]}
          placeholder="商品を検索..."
          placeholderTextColor={secondaryTextColor}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity onPress={handleSearch}>
          <Ionicons name="barcode-outline" size={20} color={primaryColor} />
        </TouchableOpacity>
      </View>

      {/* Recent Searches */}
      {recentSearches.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>
            最近の検索
          </Text>
          <FlatList
            data={recentSearches.slice(0, 5)}
            renderItem={renderSearchHistoryItem}
            keyExtractor={(item) => item}
            scrollEnabled={false}
          />
        </View>
      )}

      {/* Popular Searches */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>
          人気の検索
        </Text>
        <View style={styles.popularContainer}>
          {popularSearches.map((item) => (
            <View key={item} style={styles.popularItemWrapper}>
              {renderPopularSearchItem({ item })}
            </View>
          ))}
        </View>
      </View>

      {/* Recommendations */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>
          おすすめ商品
        </Text>
        <FlatList
          data={recommendations}
          renderItem={renderRecommendationItem}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: textColor }]}>
          クイックアクション
        </Text>
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: cardBg }]}
            onPress={() => router.push('/scan')}
          >
            <Ionicons name="barcode" size={24} color={primaryColor} />
            <Text style={[styles.quickActionText, { color: textColor }]}>
              バーコード
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: cardBg }]}
            onPress={() => router.push('/(tabs)/deals')}
          >
            <Ionicons name="flame" size={24} color="#FF9500" />
            <Text style={[styles.quickActionText, { color: textColor }]}>
              お得情報
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickAction, { backgroundColor: cardBg }]}
            onPress={() => router.push('/(tabs)/alerts')}
          >
            <Ionicons name="notifications" size={24} color="#FF3B30" />
            <Text style={[styles.quickActionText, { color: textColor }]}>
              通知
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 60,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    marginTop: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
    fontSize: 16,
  },
  section: {
    marginHorizontal: 16,
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  historyText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
  },
  popularContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  popularItemWrapper: {
    marginRight: 8,
    marginBottom: 8,
  },
  popularItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  popularText: {
    fontSize: 14,
    fontWeight: '500',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  quickAction: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    minWidth: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 8,
  },
});