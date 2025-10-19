/**
 * AccessibleText Component
 * Provides accessible text components with proper semantic markup and screen reader support
 */

import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';

interface AccessibleTextProps extends TextProps {
  variant?: 'heading1' | 'heading2' | 'heading3' | 'body' | 'caption' | 'label';
  color?: string;
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'header' | 'text' | 'label' | 'summary' | 'note';
  children: React.ReactNode;
}

const AccessibleText: React.FC<AccessibleTextProps> = ({
  variant = 'body',
  color,
  accessible = true,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'text',
  children,
  style,
  ...props
}) => {
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const finalColor = color || textColor;

  const getTextStyles = () => {
    const baseStyles = {
      color: finalColor,
    };

    const variantStyles = {
      heading1: {
        fontSize: 32,
        fontWeight: 'bold' as const,
        lineHeight: 40,
        letterSpacing: -0.5,
      },
      heading2: {
        fontSize: 24,
        fontWeight: 'bold' as const,
        lineHeight: 32,
        letterSpacing: -0.25,
      },
      heading3: {
        fontSize: 20,
        fontWeight: '600' as const,
        lineHeight: 28,
      },
      body: {
        fontSize: 16,
        fontWeight: 'normal' as const,
        lineHeight: 24,
      },
      caption: {
        fontSize: 14,
        fontWeight: 'normal' as const,
        lineHeight: 20,
      },
      label: {
        fontSize: 16,
        fontWeight: '600' as const,
        lineHeight: 24,
      },
    };

    return [baseStyles, variantStyles[variant]];
  };

  const getAccessibilityProps = () => {
    const accessibilityProps: any = {
      accessible,
    };

    if (accessibilityLabel) {
      accessibilityProps.accessibilityLabel = accessibilityLabel;
    }

    if (accessibilityHint) {
      accessibilityProps.accessibilityHint = accessibilityHint;
    }

    if (accessibilityRole) {
      accessibilityProps.accessibilityRole = accessibilityRole;
    }

    // Adjust accessibility based on variant
    if (variant === 'heading1' || variant === 'heading2' || variant === 'heading3') {
      accessibilityProps.accessibilityRole = 'header';
    }

    return accessibilityProps;
  };

  return (
    <Text
      style={[getTextStyles(), style]}
      {...getAccessibilityProps()}
      {...props}
    >
      {children}
    </Text>
  );
};

export default AccessibleText;