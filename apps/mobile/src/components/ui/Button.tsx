import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  icon?: {
    name: string;
    position: 'left' | 'right';
  };
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
  fullWidth = false,
}) => {
  const theme = useTheme();

  const getButtonStyle = (): ViewStyle => {
    const baseStyle: ViewStyle = {
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    };

    // Size styles
    const sizeStyles = {
      small: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        minHeight: 32,
      },
      medium: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        minHeight: 44,
      },
      large: {
        paddingHorizontal: 32,
        paddingVertical: 16,
        minHeight: 52,
      },
    };

    // Variant styles
    const variantStyles = {
      primary: {
        backgroundColor: disabled ? theme.colors.gray[300] : theme.colors.primary[500],
      },
      secondary: {
        backgroundColor: disabled ? theme.colors.gray[300] : theme.colors.gray[700],
      },
      outline: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: disabled ? theme.colors.gray[300] : theme.colors.primary[500],
      },
      ghost: {
        backgroundColor: 'transparent',
      },
    };

    return {
      ...baseStyle,
      ...sizeStyles[size],
      ...variantStyles[variant],
      width: fullWidth ? '100%' : undefined,
    };
  };

  const getTextStyle = (): TextStyle => {
    const baseStyle: TextStyle = {
      fontWeight: '600',
    };

    const sizeStyles = {
      small: {
        fontSize: 14,
      },
      medium: {
        fontSize: 16,
      },
      large: {
        fontSize: 18,
      },
    };

    const variantStyles = {
      primary: {
        color: disabled ? theme.colors.gray[500] : theme.colors.white,
      },
      secondary: {
        color: disabled ? theme.colors.gray[500] : theme.colors.white,
      },
      outline: {
        color: disabled ? theme.colors.gray[500] : theme.colors.primary[500],
      },
      ghost: {
        color: disabled ? theme.colors.gray[500] : theme.colors.primary[500],
      },
    };

    return {
      ...baseStyle,
      ...sizeStyles[size],
      ...variantStyles[variant],
    };
  };

  const renderIcon = () => {
    if (!icon || loading) return null;

    const iconSize = size === 'small' ? 16 : size === 'large' ? 24 : 20;
    const iconColor = variant === 'primary' || variant === 'secondary'
      ? theme.colors.white
      : theme.colors.primary[500];

    return (
      <Ionicons
        name={icon.name as any}
        size={iconSize}
        color={disabled ? theme.colors.gray[500] : iconColor}
        style={icon.position === 'left' ? styles.iconLeft : styles.iconRight}
      />
    );
  };

  return (
    <TouchableOpacity
      style={[getButtonStyle(), style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'secondary' ? theme.colors.white : theme.colors.primary[500]}
        />
      ) : (
        <>
          {icon?.position === 'left' && renderIcon()}
          <Text style={[getTextStyle(), textStyle]}>{title}</Text>
          {icon?.position === 'right' && renderIcon()}
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  iconLeft: {
    marginRight: 8,
  },
  iconRight: {
    marginLeft: 8,
  },
});

export default Button;