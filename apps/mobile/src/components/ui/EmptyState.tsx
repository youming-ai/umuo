import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  image?: ImageSourcePropType;
  action?: {
    label: string;
    onPress: () => void;
  };
  style?: any;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  image,
  action,
  style,
}) => {
  const theme = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={styles.content}>
        {image ? (
          // eslint-disable-next-line react-native/no-inline-styles
          <Image source={image} style={[styles.image, { resizeMode: 'contain' }]} />
        ) : icon ? (
          <Ionicons
            name={icon}
            size={64}
            color={theme.colors.gray[400]}
            style={styles.icon}
          />
        ) : (
          <Ionicons
            name="folder-open-outline"
            size={64}
            color={theme.colors.gray[400]}
            style={styles.icon}
          />
        )}

        <Text style={[styles.title, { color: theme.colors.text.primary }]}>
          {title}
        </Text>

        {description && (
          <Text style={[styles.description, { color: theme.colors.text.secondary }]}>
            {description}
          </Text>
        )}

        {action && (
          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.colors.primary[500] }]}
            onPress={action.onPress}
          >
            <Text style={[styles.buttonText, { color: theme.colors.white }]}>
              {action.label}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  content: {
    alignItems: 'center',
    maxWidth: 300,
  },
  icon: {
    marginBottom: 16,
  },
  image: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 120,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default EmptyState;