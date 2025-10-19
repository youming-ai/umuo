import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme';

interface BadgeProps {
  text: string;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  size?: 'small' | 'medium' | 'large';
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  text,
  variant = 'default',
  size = 'medium',
  style,
}) => {
  const theme = useTheme();

  const getBadgeStyle = (): ViewStyle => {
    const baseStyle: ViewStyle = {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      alignSelf: 'flex-start',
    };

    const sizeStyles = {
      small: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        minHeight: 16,
      },
      medium: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        minHeight: 24,
      },
      large: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        minHeight: 32,
      },
    };

    const variantStyles = {
      default: {
        backgroundColor: theme.colors.gray[100],
      },
      primary: {
        backgroundColor: theme.colors.primary[100],
      },
      success: {
        backgroundColor: theme.colors.success[100],
      },
      warning: {
        backgroundColor: theme.colors.warning[100],
      },
      error: {
        backgroundColor: theme.colors.error[100],
      },
    };

    return {
      ...baseStyle,
      ...sizeStyles[size],
      ...variantStyles[variant],
    };
  };

  const getTextColor = () => {
    const colorMap = {
      default: theme.colors.text.secondary,
      primary: theme.colors.primary[700],
      success: theme.colors.success[700],
      warning: theme.colors.warning[700],
      error: theme.colors.error[700],
    };
    return colorMap[variant];
  };

  const getFontSize = () => {
    const sizeMap = {
      small: 10,
      medium: 12,
      large: 14,
    };
    return sizeMap[size];
  };

  return (
    <View style={[getBadgeStyle(), style]}>
      <Text
        style={[
          styles.text,
          {
            color: getTextColor(),
            fontSize: getFontSize(),
          },
        ]}
      >
        {text}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  text: {
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

export default Badge;