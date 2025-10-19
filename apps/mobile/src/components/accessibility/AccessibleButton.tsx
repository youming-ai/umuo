/**
 * AccessibleButton Component
 * Provides fully accessible button components with proper focus management and screen reader support
 */

import React from 'react';
import {
  TouchableOpacity,
  TouchableOpacityProps,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';

interface AccessibleButtonProps extends TouchableOpacityProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'tab' | 'link';
  onPress: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const AccessibleButton: React.FC<AccessibleButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  onPress,
  children,
  icon,
  iconPosition = 'left',
  style,
  ...props
}) => {
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const backgroundColor = useThemeColor({ light: '#FFFFFF', dark: '#000000' }, 'background');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const disabledColor = useThemeColor({ light: '#8E8E93', dark: '#48484A' }, 'disabled');

  const getButtonStyles = (): ViewStyle => {
    const baseStyles: ViewStyle = {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      minHeight: 44, // WCAG minimum touch target size
      minWidth: 44,
    };

    const variantStyles: Record<string, ViewStyle> = {
      primary: {
        backgroundColor: disabled ? disabledColor : primaryColor,
        borderWidth: 0,
      },
      secondary: {
        backgroundColor: disabled ? disabledColor : '#F2F2F7',
        borderWidth: 0,
      },
      outline: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: disabled ? disabledColor : primaryColor,
      },
      ghost: {
        backgroundColor: 'transparent',
        borderWidth: 0,
      },
    };

    const sizeStyles: Record<string, ViewStyle> = {
      small: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        minHeight: 36,
      },
      medium: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 44,
      },
      large: {
        paddingHorizontal: 24,
        paddingVertical: 16,
        minHeight: 52,
      },
    };

    return [
      baseStyles,
      variantStyles[variant],
      sizeStyles[size],
      disabled && { opacity: 0.5 },
      style,
    ];
  };

  const getTextStyles = (): TextStyle => {
    const baseStyles: TextStyle = {
      fontWeight: '600',
      textAlign: 'center',
    };

    const variantStyles: Record<string, TextStyle> = {
      primary: {
        color: '#FFFFFF',
      },
      secondary: {
        color: disabled ? disabledColor : textColor,
      },
      outline: {
        color: disabled ? disabledColor : primaryColor,
      },
      ghost: {
        color: disabled ? disabledColor : primaryColor,
      },
    };

    const sizeStyles: Record<string, TextStyle> = {
      small: {
        fontSize: 14,
        lineHeight: 20,
      },
      medium: {
        fontSize: 16,
        lineHeight: 24,
      },
      large: {
        fontSize: 18,
        lineHeight: 26,
      },
    };

    return [baseStyles, variantStyles[variant], sizeStyles[size]];
  };

  const getAccessibilityProps = () => {
    const accessibilityProps: any = {
      accessible: true,
      accessibilityRole,
      accessibilityState: {
        disabled: disabled || loading,
        busy: loading,
      },
    };

    if (accessibilityLabel) {
      accessibilityProps.accessibilityLabel = accessibilityLabel;
    }

    if (accessibilityHint) {
      accessibilityProps.accessibilityHint = accessibilityHint;
    }

    // Add loading state to accessibility label
    if (loading) {
      accessibilityProps.accessibilityLabel = accessibilityLabel
        ? `${accessibilityLabel} - Loading`
        : 'Loading';
    }

    return accessibilityProps;
  };

  const renderContent = () => {
    if (loading) {
      return (
        <>
          <ActivityIndicator
            size="small"
            color={variant === 'primary' ? '#FFFFFF' : primaryColor}
            style={styles.loader}
          />
          <Text style={getTextStyles()}>
            {typeof children === 'string' ? children : 'Loading...'}
          </Text>
        </>
      );
    }

    const content = (
      <Text style={getTextStyles()}>
        {children}
      </Text>
    );

    if (icon && iconPosition === 'left') {
      return (
        <>
          {icon}
          <Text style={[getTextStyles(), styles.iconLeft]}>
            {children}
          </Text>
        </>
      );
    }

    if (icon && iconPosition === 'right') {
      return (
        <>
          <Text style={[getTextStyles(), styles.iconRight]}>
            {children}
          </Text>
          {icon}
        </>
      );
    }

    return content;
  };

  return (
    <TouchableOpacity
      style={getButtonStyles()}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={disabled || loading ? 1 : 0.7}
      {...getAccessibilityProps()}
      {...props}
    >
      {renderContent()}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  loader: {
    marginRight: 8,
  },
  iconLeft: {
    marginLeft: 8,
  },
  iconRight: {
    marginRight: 8,
  },
});

export default AccessibleButton;