/**
 * Search Screen - Full screen search with filters and results
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSearchStore } from '@/store/search_store';
import { useSearchProducts } from '@/hooks/use_api';
import { Product } from '@/types';
import { ProductCard } from '@/components/ProductCard';
import { useThemeColor } from '@/hooks/useThemeColor';

export default function SearchScreen() {
  const params = useLocalSearchParams();
  const { q: initialQuery } = params as { q?: string };

  const [searchQuery, setSearchQuery] = useState(initialQuery || '');
  const [showFilters, setShowFilters] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const {
    query,
    filters,
    sort,
    results,
    loading,
    error,
    page,
    hasMore,
    setQuery,
    setFilters,
    setSort,
    setResults,
    setLoading,
    setError,
    setPage,
    addToRecentSearches,
    clearSearch,
  } = useSearchStore();

  const searchMutation = useSearchProducts();

  const bgColor = useThemeColor({ light: '#F2F2F7', dark: '#000000' }, 'background');
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');

  useEffect(() => {
    if (initialQuery) {
      handleSearch(initialQuery);
    }
  }, [initialQuery]);

  const handleSearch = async (searchString?: string) => {
    const queryToSearch = searchString || searchQuery;
    if (!queryToSearch.trim()) return;

    addToRecentSearches(queryToSearch);
    setQuery(queryToSearch);
    setLoading(true);
    setError(null);
    setPage(1);

    try {
      const result = await searchMutation.mutateAsync({
        query: queryToSearch,
        filters,
        page: 1,
      });
      setResults(result.products || [], result.total || 0, result.hasMore || false);
    } catch (err) {
      setError('検索中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore || !query) return;

    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);

    try {
      const result = await searchMutation.mutateAsync({
        query,
        filters,
        page: nextPage,
      });

      // Append new results
      setResults(
        [...results, ...(result.products || [])],
        result.total || 0,
        result.hasMore || false
      );
    } catch (err) {
      setError('追加の結果を読み込み中にエラーが発生しました');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleFilterChange = (newFilters: typeof filters) => {
    setFilters(newFilters);
    setShowFilters(false);
    if (query) {
      handleSearch(query);
    }
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort as any);
    if (query) {
      handleSearch(query);
    }
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    clearSearch();
  };

  const handleProductPress = (product: Product) => {
    router.push(`/product/${product.id}`);
  };

  const renderProduct = ({ item }: { item: Product }) => (
    <ProductCard
      product={item}
      onPress={handleProductPress}
    />
  );

  const renderFilterModal = () => (
    <Modal
      visible={showFilters}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={[styles.filterModal, { backgroundColor: bgColor }]}>
        <View style={styles.filterHeader}>
          <TouchableOpacity onPress={() => setShowFilters(false)}>
            <Ionicons name="close" size={24} color={textColor} />
          </TouchableOpacity>
          <Text style={[styles.filterTitle, { color: textColor }]}>
            フィルター
          </Text>
          <TouchableOpacity onPress={() => handleFilterChange({})}>
            <Text style={[styles.filterClear, { color: primaryColor }]}>
              クリア
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.filterContent}>
          <View style={styles.filterSection}>
            <Text style={[styles.filterSectionTitle, { color: textColor }]}>
              カテゴリー
            </Text>
            {['電子機器', '家電', 'ファッション', '本', 'スポーツ'].map((category) => (
              <TouchableOpacity
                key={category}
                style={[
                  styles.filterOption,
                  { backgroundColor: cardBg, borderColor: '#E5E5E7' }
                ]}
                onPress={() => handleFilterChange({ ...filters, category })}
              >
                <Text style={[styles.filterOptionText, { color: textColor }]}>
                  {category}
                </Text>
                {filters.category === category && (
                  <Ionicons name="checkmark" size={16} color={primaryColor} />
                )}
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.filterSection}>
            <Text style={[styles.filterSectionTitle, { color: textColor }]}>
              価格範囲
            </Text>
            <View style={styles.priceRangeContainer}>
              <TextInput
                style={[styles.priceInput, { backgroundColor: cardBg, color: textColor }]}
                placeholder="最低価格"
                placeholderTextColor={secondaryTextColor}
                value={filters.minPrice?.toString()}
                onChangeText={(text) => handleFilterChange({
                  ...filters,
                  minPrice: text ? parseInt(text) : undefined,
                })}
                keyboardType="numeric"
              />
              <Text style={[styles.priceSeparator, { color: textColor }]}>-</Text>
              <TextInput
                style={[styles.priceInput, { backgroundColor: cardBg, color: textColor }]}
                placeholder="最高価格"
                placeholderTextColor={secondaryTextColor}
                value={filters.maxPrice?.toString()}
                onChangeText={(text) => handleFilterChange({
                  ...filters,
                  maxPrice: text ? parseInt(text) : undefined,
                })}
                keyboardType="numeric"
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Search Header */}
      <View style={[styles.searchHeader, { backgroundColor: cardBg }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={textColor} />
        </TouchableOpacity>
        <TextInput
          style={[styles.searchInput, { color: textColor }]}
          placeholder="商品を検索..."
          placeholderTextColor={secondaryTextColor}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={() => handleSearch()}
          returnKeyType="search"
          autoFocus
        />
        {searchQuery ? (
          <TouchableOpacity onPress={handleClearSearch}>
            <Ionicons name="close-circle" size={20} color={secondaryTextColor} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => router.push('/scan')}>
            <Ionicons name="barcode" size={24} color={primaryColor} />
          </TouchableOpacity>
        )}
      </View>

      {/* Sort and Filter Options */}
      <View style={styles.optionsBar}>
        <TouchableOpacity
          style={[styles.optionButton, { backgroundColor: cardBg }]}
          onPress={() => setShowFilters(true)}
        >
          <Ionicons name="funnel" size={16} color={primaryColor} />
          <Text style={[styles.optionText, { color: textColor }]}>
            フィルター
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.optionButton, { backgroundColor: cardBg }]}
          onPress={() => setShowFilters(true)}
        >
          <Ionicons name="swap-vertical" size={16} color={primaryColor} />
          <Text style={[styles.optionText, { color: textColor }]}>
            並び替え
          </Text>
        </TouchableOpacity>
      </View>

      {/* Results */}
      {loading && results.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
            検索中...
          </Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color="#FF3B30" />
          <Text style={[styles.errorText, { color: textColor }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: primaryColor }]}
            onPress={() => query && handleSearch(query)}
          >
            <Text style={styles.retryButtonText}>再試行</Text>
          </TouchableOpacity>
        </View>
      ) : results.length === 0 && query ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="search" size={48} color={secondaryTextColor} />
          <Text style={[styles.emptyText, { color: textColor }]}>
            検索結果が見つかりませんでした
          </Text>
          <Text style={[styles.emptySubtext, { color: secondaryTextColor }]}>
            別のキーワードで試してください
          </Text>
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderProduct}
          keyExtractor={(item) => item.id}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.1}
          ListFooterComponent={() =>
            loadingMore ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={primaryColor} />
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Filter Modal */}
      {renderFilterModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    margin: 16,
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
  optionsBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 16,
    marginTop: 16,
    textAlign: 'center',
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  loadingMore: {
    padding: 16,
    alignItems: 'center',
  },
  filterModal: {
    flex: 1,
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E7',
  },
  filterTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  filterClear: {
    fontSize: 16,
    fontWeight: '500',
  },
  filterContent: {
    flex: 1,
    padding: 16,
  },
  filterSection: {
    marginBottom: 24,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 8,
  },
  filterOptionText: {
    fontSize: 16,
  },
  priceRangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  priceInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E7',
    fontSize: 16,
  },
  priceSeparator: {
    fontSize: 16,
    fontWeight: '600',
  },
});