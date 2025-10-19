import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
  padding?: number;
  margin?: number;
  shadow?: boolean;
  borderRadius?: number;
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  onPress,
  padding = 16,
  margin = 0,
  shadow = true,
  borderRadius = 12,
}) => {
  const theme = useTheme();

  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.card,
    borderRadius,
    padding,
    margin,
    ...(shadow && {
      shadowColor: '#000',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.1,
      shadowRadius: 3.84,
      elevation: 5,
    }),
  };

  const CardComponent = onPress ? TouchableOpacity : View;

  return (
    <CardComponent
      style={[cardStyle, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {children}
    </CardComponent>
  );
};

export default Card;