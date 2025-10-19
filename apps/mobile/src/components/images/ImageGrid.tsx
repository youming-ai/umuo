/**
 * ImageGrid Component
 * Optimized grid layout for images with lazy loading and performance optimization
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  FlatList,
  Dimensions,
  StyleSheet,
  ListRenderItem,
} from 'react-native';
import OptimizedImage from './OptimizedImage';

interface ImageGridItem {
  id: string;
  url: string;
  placeholder?: string;
  width: number;
  height: number;
  alt?: string;
  onPress?: (item: ImageGridItem) => void;
}

interface ImageGridProps {
  data: ImageGridItem[];
  numColumns?: number;
  spacing?: number;
  containerWidth?: number;
  aspectRatio?: number;
  imageQuality?: number;
  cdnUrl?: string;
  lazy?: boolean;
  onImagePress?: (item: ImageGridItem) => void;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  ListHeaderComponent?: React.ComponentType<any>;
  ListFooterComponent?: React.ComponentType<any>;
  ListEmptyComponent?: React.ComponentType<any>;
  refreshControl?: React.ReactElement;
  showsVerticalScrollIndicator?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  contentContainerStyle?: any;
}

const { width: screenWidth } = Dimensions.get('window');

const ImageGrid: React.FC<ImageGridProps> = ({
  data,
  numColumns = 2,
  spacing = 8,
  containerWidth = screenWidth,
  aspectRatio = 1,
  imageQuality = 80,
  cdnUrl,
  lazy = true,
  onImagePress,
  onEndReached,
  onEndReachedThreshold = 0.5,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  refreshControl,
  showsVerticalScrollIndicator = false,
  showsHorizontalScrollIndicator = false,
  contentContainerStyle,
}) => {
  const [layout, setLayout] = useState({ width: containerWidth, height: 0 });
  const [imagesLayout, setImagesLayout] = useState<Record<string, { width: number; height: number }>>({});

  const itemWidth = useMemo(() => {
    const totalSpacing = spacing * (numColumns + 1);
    const availableWidth = layout.width - totalSpacing;
    return Math.floor(availableWidth / numColumns);
  }, [layout.width, numColumns, spacing]);

  const itemHeight = useMemo(() => {
    return Math.floor(itemWidth / aspectRatio);
  }, [itemWidth, aspectRatio]);

  /**
   * Calculate optimal layout for images
   */
  const calculateOptimalLayout = useCallback((items: ImageGridItem[]) => {
    const layout: Record<string, { width: number; height: number }> = {};

    items.forEach((item) => {
      if (item.width && item.height) {
        const targetWidth = itemWidth;
        const targetHeight = Math.floor((item.height * targetWidth) / item.width);
        layout[item.id] = { width: targetWidth, height: targetHeight };
      } else {
        layout[item.id] = { width: itemWidth, height: itemHeight };
      }
    });

    return layout;
  }, [itemWidth, itemHeight]);

  /**
   * Update layout when container size changes
   */
  const handleLayout = useCallback((event: any) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });

    const newImagesLayout = calculateOptimalLayout(data);
    setImagesLayout(newImagesLayout);
  }, [data, calculateOptimalLayout]);

  /**
   * Render grid item
   */
  const renderItem: ListRenderItem<ImageGridItem> = useCallback(({ item, index }) => {
    const imageDimensions = imagesLayout[item.id] || { width: itemWidth, height: itemHeight };
    const { width: imageWidth, height: imageHeight } = imageDimensions;

    return (
      <View style={[styles.itemContainer, { width: imageWidth, height: imageHeight, margin: spacing / 2 }]}>
        <OptimizedImage
          source={{ uri: item.url }}
          width={imageWidth}
          height={imageHeight}
          quality={imageQuality}
          cdnUrl={cdnUrl}
          lazy={lazy}
          placeholder={item.placeholder}
          accessible={true}
          accessibilityLabel={item.alt || `Product image ${index + 1}`}
          style={styles.image}
          resizeMode="cover"
          onPress={() => {
            onImagePress?.(item);
            item.onPress?.(item);
          }}
        />
      </View>
    );
  }, [
    imagesLayout,
    itemWidth,
    itemHeight,
    imageQuality,
    cdnUrl,
    lazy,
    spacing,
    onImagePress,
  ]);

  /**
   * Get item layout for performance optimization
   */
  const getItemLayout = useCallback((data: any, index: number) => {
    const itemHeightWithSpacing = itemHeight + spacing;
    return {
      length: itemHeightWithSpacing,
      offset: itemHeightWithSpacing * index,
      index,
    };
  }, [itemHeight, spacing]);

  /**
   * Get number of columns for responsive design
   */
  const getNumColumns = useCallback(() => {
    if (layout.width < 400) return 1;
    if (layout.width < 600) return 2;
    if (layout.width < 900) return 3;
    return numColumns;
  }, [layout.width, numColumns]);

  /**
   * Memoized data with layout calculations
   */
  const processedData = useMemo(() => {
    return data.map((item, index) => ({
      ...item,
      index,
      dimensions: imagesLayout[item.id] || { width: itemWidth, height: itemHeight },
    }));
  }, [data, imagesLayout, itemWidth, itemHeight]);

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <FlatList
        data={processedData}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        numColumns={getNumColumns()}
        getItemLayout={getItemLayout}
        onEndReached={onEndReached}
        onEndReachedThreshold={onEndReachedThreshold}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
        contentContainerStyle={[
          styles.listContent,
          contentContainerStyle,
          { padding: spacing / 2 },
        ]}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        initialNumToRender={6}
        windowSize={10}
        getItemLayout={getItemLayout}
      />
    </View>
  );
};

interface MasonryGridProps extends Omit<ImageGridProps, 'aspectRatio'> {
  minColumnWidth?: number;
  maxColumnWidth?: number;
}

/**
 * MasonryGrid Component
 * Pinterest-style masonry layout for images of varying heights
 */
export const MasonryGrid: React.FC<MasonryGridProps> = ({
  data,
  numColumns = 2,
  spacing = 8,
  containerWidth = screenWidth,
  minColumnWidth = 150,
  maxColumnWidth = 300,
  imageQuality = 80,
  cdnUrl,
  lazy = true,
  onImagePress,
  onEndReached,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  refreshControl,
  showsVerticalScrollIndicator = false,
  contentContainerStyle,
}) => {
  const [layout, setLayout] = useState({ width: containerWidth, height: 0 });
  const [columns, setColumns] = useState<Array<{ id: string; items: ImageGridItem[]; height: number }>>([]);

  /**
   * Calculate optimal number of columns
   */
  const calculateColumns = useCallback((width: number) => {
    let optimalColumns = Math.floor(width / minColumnWidth);
    optimalColumns = Math.min(optimalColumns, numColumns);
    optimalColumns = Math.max(optimalColumns, 1);
    return optimalColumns;
  }, [minColumnWidth, numColumns]);

  /**
   * Distribute items across columns
   */
  const distributeItems = useCallback((items: ImageGridItem[], columnCount: number) => {
    const newColumns: Array<{ id: string; items: ImageGridItem[]; height: number }> = [];

    // Initialize columns
    for (let i = 0; i < columnCount; i++) {
      newColumns.push({
        id: `column-${i}`,
        items: [],
        height: 0,
      });
    }

    // Distribute items to the shortest column
    items.forEach((item) => {
      const shortestColumnIndex = newColumns.reduce((shortest, column, index) => {
        return column.height < newColumns[shortest].height ? index : shortest;
      }, 0);

      const itemHeight = item.height || (item.width ? (item.height * itemWidth) / item.width : 200);

      newColumns[shortestColumnIndex].items.push(item);
      newColumns[shortestColumnIndex].height += itemHeight + spacing;
    });

    return newColumns;
  }, [spacing]);

  /**
   * Update layout when container size changes
   */
  const handleLayout = useCallback((event: any) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });

    const columnCount = calculateColumns(width);
    const newColumns = distributeItems(data, columnCount);
    setColumns(newColumns);
  }, [data, calculateColumns, distributeItems]);

  /**
   * Render column
   */
  const renderColumn = useCallback((column: { id: string; items: ImageGridItem[]; height: number }, columnIndex: number) => {
    const columnWidth = (layout.width - spacing * (columns.length + 1)) / columns.length;

    return (
      <View key={column.id} style={[styles.column, { width: columnWidth, marginHorizontal: spacing / 2 }]}>
        {column.items.map((item, itemIndex) => (
          <View key={item.id} style={[styles.masonryItem, { marginBottom: spacing }]}>
            <OptimizedImage
              source={{ uri: item.url }}
              width={columnWidth}
              height={item.height || 200}
              quality={imageQuality}
              cdnUrl={cdnUrl}
              lazy={lazy}
              placeholder={item.placeholder}
              accessible={true}
              accessibilityLabel={item.alt || `Product image ${itemIndex + 1}`}
              style={styles.image}
              resizeMode="cover"
              onPress={() => {
                onImagePress?.(item);
                item.onPress?.(item);
              }}
            />
          </View>
        ))}
      </View>
    );
  }, [
    layout.width,
    columns.length,
    spacing,
    imageQuality,
    cdnUrl,
    lazy,
    onImagePress,
  ]);

  /**
   * Handle end reached
   */
  const handleEndReached = useCallback(() => {
    // Find the last item across all columns
    const totalItems = columns.reduce((sum, column) => sum + column.items.length, 0);
    if (totalItems >= data.length * 0.9) {
      onEndReached?.();
    }
  }, [columns, data.length, onEndReached]);

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <FlatList
        data={columns}
        renderItem={({ item, index }) => renderColumn(item, index)}
        keyExtractor={(item) => item.id}
        horizontal={false}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        showsHorizontalScrollIndicator={false}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        refreshControl={refreshControl}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        contentContainerStyle={[styles.masonryContent, contentContainerStyle]}
        removeClippedSubviews={true}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={100}
        initialNumToRender={3}
        windowSize={5}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
  },
  itemContainer: {
    overflow: 'hidden',
    borderRadius: 8,
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  column: {
    flex: 1,
  },
  masonryContent: {
    flexDirection: 'row',
  },
  masonryItem: {
    overflow: 'hidden',
    borderRadius: 8,
  },
});

export { ImageGrid as default, MasonryGrid };