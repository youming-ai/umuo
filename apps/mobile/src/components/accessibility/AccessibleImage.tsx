/**
 * AccessibleImage Component
 * Provides accessible image components with proper alt text, descriptions, and screen reader support
 */

import React, { useState } from 'react';
import {
  Image,
  ImageProps,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  ImageStyle,
} from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';

interface AccessibleImageProps extends ImageProps {
  alt: string; // Required for accessibility
  description?: string; // Extended description for detailed content
  decorative?: boolean; // If true, image is decorative and ignored by screen readers
  showLoadingIndicator?: boolean;
  fallbackElement?: React.ReactNode;
  caption?: string;
  expandable?: boolean;
  style?: ViewStyle;
  imageStyle?: ImageStyle;
}

const AccessibleImage: React.FC<AccessibleImageProps> = ({
  alt,
  description,
  decorative = false,
  showLoadingIndicator = true,
  fallbackElement,
  caption,
  expandable = false,
  style,
  imageStyle,
  source,
  ...props
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const backgroundColor = useThemeColor({ light: '#F2F2F7', dark: '#1C1C1E' }, 'background');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const borderColor = useThemeColor({ light: '#D1D1D6', dark: '#38383A' }, 'border');

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handlePress = () => {
    if (expandable) {
      setIsExpanded(!isExpanded);
    }
  };

  const getAccessibilityProps = () => {
    const accessibilityProps: any = {
      accessible: !decorative,
    };

    if (!decorative) {
      accessibilityProps.accessibilityLabel = alt;

      if (description) {
        accessibilityProps.accessibilityHint = description;
      }

      if (expandable) {
        accessibilityProps.accessibilityRole = 'imagebutton';
        accessibilityProps.accessibilityState = {
          expanded: isExpanded,
        };
      } else {
        accessibilityProps.accessibilityRole = 'image';
      }

      if (caption) {
        accessibilityProps.accessibilityDescribedBy = caption;
      }
    }

    return accessibilityProps;
  };

  const renderImage = () => {
    if (hasError && fallbackElement) {
      return (
        <View style={[styles.fallbackContainer, { backgroundColor }, imageStyle]}>
          {fallbackElement}
        </View>
      );
    }

    return (
      <Image
        source={source}
        style={[imageStyle]}
        onLoad={handleLoad}
        onError={handleError}
        resizeMode={props.resizeMode || 'cover'}
        {...props}
      />
    );
  };

  const renderLoadingIndicator = () => {
    if (!showLoadingIndicator || !isLoading) {
      return null;
    }

    return (
      <View style={[styles.loadingContainer, { backgroundColor }, imageStyle]}>
        <ActivityIndicator size="small" color="#007AFF" />
      </View>
    );
  };

  const renderContent = () => {
    const ImageComponent = (
      <View style={style}>
        {renderLoadingIndicator()}
        {!isLoading && renderImage()}
        {caption && (
          <Text style={[styles.caption, { color: textColor }]}>
            {caption}
          </Text>
        )}
      </View>
    );

    if (expandable) {
      return (
        <TouchableOpacity
          onPress={handlePress}
          accessibilityHint={`${alt}. ${isExpanded ? 'Tap to collapse' : 'Tap to expand'} for full view.`}
          {...getAccessibilityProps()}
        >
          {ImageComponent}
        </TouchableOpacity>
      );
    }

    return (
      <View {...getAccessibilityProps()}>
        {ImageComponent}
      </View>
    );
  };

  // If decorative, render without accessibility props
  if (decorative) {
    return (
      <View style={style} accessible={false}>
        <Image
          source={source}
          style={imageStyle}
          onLoad={handleLoad}
          onError={handleError}
          resizeMode={props.resizeMode || 'cover'}
          accessibilityRole="none"
          importantForAccessibility="no"
          {...props}
        />
        {caption && (
          <Text style={[styles.caption, { color: textColor }]}>
            {caption}
          </Text>
        )}
      </View>
    );
  }

  return renderContent();
};

interface AccessibleImageGridProps {
  images: Array<{
    source: ImageProps['source'];
    alt: string;
    description?: string;
    caption?: string;
  }>;
  columns?: number;
  spacing?: number;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

const AccessibleImageGrid: React.FC<AccessibleImageGridProps> = ({
  images,
  columns = 2,
  spacing = 8,
  accessibilityLabel,
  style,
}) => {
  const getGridStyle = (): ViewStyle => {
    return {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -spacing / 2,
    };
  };

  const getImageStyle = (): ViewStyle => {
    const width = `${100 / columns}%`;
    return {
      width,
      paddingHorizontal: spacing / 2,
      marginBottom: spacing,
    };
  };

  return (
    <View
      style={[styles.gridContainer, getGridStyle(), style]}
      accessibilityLabel={accessibilityLabel || `Grid of ${images.length} images`}
      accessibilityRole="grid"
    >
      {images.map((image, index) => (
        <View key={index} style={getImageStyle()}>
          <AccessibleImage
            source={image.source}
            alt={image.alt}
            description={image.description}
            caption={image.caption}
            style={styles.gridImage}
            imageStyle={styles.gridImageInner}
            accessibilityLabel={`Image ${index + 1} of ${images.length}: ${image.alt}`}
          />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridImage: {
    // Individual grid item styling handled by getImageStyle
  },
  gridImageInner: {
    aspectRatio: 1,
    borderRadius: 8,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D1D6',
    borderRadius: 8,
  },
  caption: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export { AccessibleImageGrid };
export default AccessibleImage;