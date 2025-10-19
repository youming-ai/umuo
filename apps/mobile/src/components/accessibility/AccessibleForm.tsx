/**
 * AccessibleForm Component
 * Provides accessible form components with proper labeling, error handling, and screen reader support
 */

import React, { useState } from 'react';
import {
  View,
  TextInput,
  TextInputProps,
  Text,
  ViewStyle,
  StyleSheet,
  Alert,
} from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';

interface AccessibleInputProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  accessibilityLabel?: string;
  accessibilityDescribedBy?: string;
  validationState?: 'valid' | 'invalid' | 'warning';
}

interface AccessibleFormProps {
  children: React.ReactNode;
  onSubmit?: (data: Record<string, any>) => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

const AccessibleInput: React.FC<AccessibleInputProps> = ({
  label,
  error,
  hint,
  required = false,
  accessibilityLabel,
  accessibilityDescribedBy,
  validationState,
  style,
  onChangeText,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const borderColor = useThemeColor({ light: '#D1D1D6', dark: '#38383A' }, 'border');
  const errorColor = useThemeColor({ light: '#FF3B30', dark: '#FF453A' }, 'error');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const backgroundColor = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'background');

  const getInputStyle = (): ViewStyle => {
    const baseStyle: ViewStyle = {
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      color: textColor,
      backgroundColor,
      minHeight: 44, // WCAG minimum touch target
    };

    let borderColors = borderColor;
    if (error) {
      borderColors = errorColor;
    } else if (validationState === 'valid') {
      borderColors = '#34C759'; // Success color
    } else if (validationState === 'warning') {
      borderColors = '#FF9500'; // Warning color
    } else if (isFocused) {
      borderColors = primaryColor;
    }

    return [baseStyle, { borderColor: borderColors }, style];
  };

  const getAccessibilityProps = () => {
    const accessibilityProps: any = {
      accessible: true,
      accessibilityLabel: accessibilityLabel || label,
      accessibilityState: {
        invalid: !!error,
      },
    };

    // Build description for screen readers
    const descriptions = [];
    if (hint) descriptions.push(hint);
    if (error) descriptions.push(`Error: ${error}`);
    if (required) descriptions.push('Required field');
    if (accessibilityDescribedBy) descriptions.push(accessibilityDescribedBy);

    if (descriptions.length > 0) {
      accessibilityProps.accessibilityHint = descriptions.join('. ');
    }

    // Add accessibility traits based on input type
    if (props.secureTextEntry) {
      accessibilityProps.accessibilityTraits = ['keyboard', 'password'];
    } else if (props.keyboardType === 'email-address') {
      accessibilityProps.accessibilityTraits = ['keyboard', 'email'];
    } else if (props.keyboardType === 'phone-pad') {
      accessibilityProps.accessibilityTraits = ['keyboard', 'phone'];
    } else {
      accessibilityProps.accessibilityTraits = ['keyboard'];
    }

    return accessibilityProps;
  };

  const handleChangeText = (text: string) => {
    onChangeText?.(text);
  };

  return (
    <View style={styles.inputContainer}>
      <View style={styles.labelContainer}>
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.required}> *</Text>}
        </Text>
      </View>

      <TextInput
        style={getInputStyle()}
        onChangeText={handleChangeText}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholderTextColor={useThemeColor({ light: '#8E8E93', dark: '#8E8E93' }, 'placeholder')}
        {...getAccessibilityProps()}
        {...props}
      />

      {hint && !error && (
        <Text style={styles.hint}>{hint}</Text>
      )}

      {error && (
        <Text style={[styles.errorText, { color: errorColor }]}>
          {error}
        </Text>
      )}
    </View>
  );
};

const AccessibleForm: React.FC<AccessibleFormProps> = ({
  children,
  onSubmit,
  accessibilityLabel,
  style,
}) => {
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (data: Record<string, any>): Record<string, string> => {
    const newErrors: Record<string, string> = {};

    // Basic validation - can be extended based on form requirements
    Object.keys(data).forEach(key => {
      const value = data[key];
      if (typeof value === 'string' && value.trim() === '') {
        newErrors[key] = `${key} is required`;
      }
    });

    return newErrors;
  };

  const handleSubmit = () => {
    const newErrors = validateForm(formData);

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);

      // Announce errors to screen readers
      const errorMessages = Object.values(newErrors).join(', ');
      Alert.alert('Form Error', `Please correct the following errors: ${errorMessages}`);

      return;
    }

    setErrors({});
    onSubmit?.(formData);
  };

  const updateFormData = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));

    // Clear error for this field when user starts typing
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  return (
    <View
      style={[styles.form, style]}
      accessibilityLabel={accessibilityLabel}
      accessible={true}
    >
      {React.Children.map(children, child => {
        if (React.isValidElement(child) && child.type === AccessibleInput) {
          return React.cloneElement(child, {
            onChangeText: (text: string) => {
              updateFormData(child.props.name || '', text);
              child.props.onChangeText?.(text);
            },
            error: errors[child.props.name || ''],
          });
        }
        return child;
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  form: {
    padding: 16,
  },
  inputContainer: {
    marginBottom: 20,
  },
  labelContainer: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  required: {
    color: '#FF3B30',
    marginLeft: 2,
  },
  hint: {
    fontSize: 14,
    marginTop: 4,
    color: '#8E8E93',
  },
  errorText: {
    fontSize: 14,
    marginTop: 4,
  },
});

export { AccessibleForm, AccessibleInput };
export default AccessibleForm;