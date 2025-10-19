import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';

interface LoadingSpinnerProps {
  size?: 'small' | 'large';
  color?: string;
  text?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'large',
  color,
  text,
}) => {
  const defaultColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const spinnerColor = color || defaultColor;
  const textColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');

  return (
    <View style={styles.container}>
      <ActivityIndicator
        size={size === 'small' ? 'small' : 'large'}
        color={spinnerColor}
      />
      {text && (
        <Text style={[styles.text, { color: textColor }]}>
          {text}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  text: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
  },
});