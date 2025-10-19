import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../theme';

interface LoadingOverlayProps {
  visible: boolean;
  text?: string;
  transparent?: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  visible,
  text = 'Loading...',
  transparent = true,
}) => {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent={transparent}
      animationType="fade"
      statusBarTranslucent
    >
      <View style={[styles.overlay, { backgroundColor: transparent ? 'rgba(0,0,0,0.5)' : theme.colors.background }]}>
        <View style={[styles.container, { backgroundColor: theme.colors.card }]}>
          <ActivityIndicator
            size="large"
            color={theme.colors.primary[500]}
            style={styles.spinner}
          />
          {text && (
            <Text style={[styles.text, { color: theme.colors.text.primary }]}>
              {text}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 120,
    maxWidth: 200,
  },
  spinner: {
    marginBottom: 16,
  },
  text: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default LoadingOverlay;