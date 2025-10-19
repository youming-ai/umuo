import React from 'react';
import {
  View,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme';

interface DividerProps {
  thickness?: number;
  color?: string;
  style?: ViewStyle;
  horizontal?: boolean;
  spacing?: number;
}

export const Divider: React.FC<DividerProps> = ({
  thickness = 1,
  color,
  style,
  horizontal = true,
  spacing = 0,
}) => {
  const theme = useTheme();

  const dividerStyle: ViewStyle = {
    backgroundColor: color || theme.colors.border,
    margin: spacing,
  };

  if (horizontal) {
    dividerStyle.height = thickness;
    dividerStyle.width = '100%';
  } else {
    dividerStyle.width = thickness;
    dividerStyle.height = '100%';
  }

  return <View style={[dividerStyle, styles.divider, style]} />;
};

const styles = StyleSheet.create({
  divider: {
    alignSelf: 'stretch',
  },
});

export default Divider;