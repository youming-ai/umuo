import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  onSubmit?: (query: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onClear?: () => void;
  showClearButton?: boolean;
  autoFocus?: boolean;
  style?: ViewStyle;
  inputStyle?: TextStyle;
  disabled?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = 'Search products...',
  value = '',
  onChangeText,
  onSubmit,
  onFocus,
  onBlur,
  onClear,
  showClearButton = true,
  autoFocus = false,
  style,
  inputStyle,
  disabled = false,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const theme = useTheme();

  const handleFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  const handleSubmit = () => {
    const trimmedQuery = value.trim();
    if (trimmedQuery) {
      onSubmit?.(trimmedQuery);
      Keyboard.dismiss();
    }
  };

  const handleClear = () => {
    onChangeText?.('');
    onClear?.();
    inputRef.current?.focus();
  };

  const borderColor = isFocused ? theme.colors.primary[500] : theme.colors.gray[300];
  const backgroundColor = disabled ? theme.colors.gray[100] : theme.colors.white;

  return (
    <View style={[styles.container, { borderColor, backgroundColor }, style]}>
      <Ionicons
        name="search"
        size={20}
        color={theme.colors.gray[400]}
        style={styles.searchIcon}
      />

      <TextInput
        ref={inputRef}
        style={[styles.input, { color: theme.colors.text.primary }, inputStyle]}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text.secondary}
        value={value}
        onChangeText={onChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSubmitEditing={handleSubmit}
        returnKeyType="search"
        autoFocus={autoFocus}
        editable={!disabled}
        multiline={false}
        maxLength={100}
      />

      {showClearButton && value.length > 0 && !disabled && (
        <TouchableOpacity
          style={styles.clearButton}
          onPress={handleClear}
          accessibilityLabel="Clear search"
          accessibilityRole="button"
        >
          <Ionicons
            name="close-circle"
            size={18}
            color={theme.colors.gray[400]}
          />
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 0,
  },
  clearButton: {
    marginLeft: 12,
    padding: 4,
  },
});

export default SearchBar;