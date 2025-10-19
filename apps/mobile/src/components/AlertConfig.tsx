import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { AlertCondition, AlertType } from '../../types';

interface AlertConfigProps {
  visible: boolean;
  onClose: () => void;
  onSave: (config: AlertConfiguration) => void;
  productName: string;
  currentPrice: number;
  initialConfig?: Partial<AlertConfiguration>;
}

interface AlertConfiguration {
  type: AlertType;
  condition: AlertCondition;
  active: boolean;
}

export const AlertConfig: React.FC<AlertConfigProps> = ({
  visible,
  onClose,
  onSave,
  productName,
  currentPrice,
  initialConfig,
}) => {
  const [config, setConfig] = useState<AlertConfiguration>({
    type: 'price_drop',
    condition: {
      threshold: currentPrice * 0.9, // Default: 10% drop
      percentage: 10,
    },
    active: true,
    ...initialConfig,
  });

  const theme = useTheme();

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const updateCondition = (updates: Partial<AlertCondition>) => {
    setConfig(prev => ({
      ...prev,
      condition: { ...prev.condition, ...updates },
    }));
  };

  const alertTypes: { value: AlertType; label: string; description: string }[] = [
    {
      value: 'price_drop',
      label: 'Price Drop',
      description: 'Get notified when price drops',
    },
    {
      value: 'price_low',
      label: 'Low Price',
      description: 'Get notified when price is below threshold',
    },
    {
      value: 'in_stock',
      label: 'Back in Stock',
      description: 'Get notified when item is available',
    },
    {
      value: 'any_change',
      label: 'Any Change',
      description: 'Get notified for any price change',
    },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={theme.colors.text.primary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.colors.text.primary }]}>
            Price Alert
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
            <Text style={[styles.saveButtonText, { color: theme.colors.primary[500] }]}>
              Save
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.productInfo, { backgroundColor: theme.colors.card }]}>
            <Text style={[styles.productName, { color: theme.colors.text.primary }]}>
              {productName}
            </Text>
            <Text style={[styles.currentPrice, { color: theme.colors.text.secondary }]}>
              Current: ¥{currentPrice.toLocaleString()}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text.primary }]}>
              Alert Type
            </Text>
            {alertTypes.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.typeOption,
                  {
                    backgroundColor: theme.colors.card,
                    borderColor: config.type === type.value ? theme.colors.primary[500] : theme.colors.border,
                  },
                ]}
                onPress={() => setConfig(prev => ({ ...prev, type: type.value }))}
              >
                <View style={styles.typeInfo}>
                  <Text style={[styles.typeLabel, { color: theme.colors.text.primary }]}>
                    {type.label}
                  </Text>
                  <Text style={[styles.typeDescription, { color: theme.colors.text.secondary }]}>
                    {type.description}
                  </Text>
                </View>
                <View
                  style={[
                    styles.radioButton,
                    {
                      borderColor: theme.colors.border,
                      backgroundColor: config.type === type.value ? theme.colors.primary[500] : 'transparent',
                    },
                  ]}
                >
                  {config.type === type.value && (
                    <View style={[styles.radioInner, { backgroundColor: theme.colors.white }]} />
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {(config.type === 'price_drop' || config.type === 'price_low') && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text.primary }]}>
                Alert Conditions
              </Text>

              {config.type === 'price_drop' && (
                <View style={[styles.inputGroup, { backgroundColor: theme.colors.card }]}>
                  <Text style={[styles.inputLabel, { color: theme.colors.text.primary }]}>
                    Percentage Drop (%)
                  </Text>
                  <TextInput
                    style={[
                      styles.textInput,
                      {
                        color: theme.colors.text.primary,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.background,
                      },
                    ]}
                    value={config.condition.percentage?.toString()}
                    onChangeText={(text) => {
                      const percentage = parseInt(text) || 0;
                      updateCondition({
                        percentage,
                        threshold: currentPrice * (1 - percentage / 100),
                      });
                    }}
                    keyboardType="numeric"
                    placeholder="10"
                    maxLength={3}
                  />
                </View>
              )}

              {(config.type === 'price_low' || config.type === 'price_drop') && (
                <View style={[styles.inputGroup, { backgroundColor: theme.colors.card }]}>
                  <Text style={[styles.inputLabel, { color: theme.colors.text.primary }]}>
                    Target Price (¥)
                  </Text>
                  <TextInput
                    style={[
                      styles.textInput,
                      {
                        color: theme.colors.text.primary,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.background,
                      },
                    ]}
                    value={config.condition.threshold?.toString()}
                    onChangeText={(text) => {
                      const threshold = parseInt(text) || 0;
                      updateCondition({
                        threshold,
                        percentage: Math.round(((currentPrice - threshold) / currentPrice) * 100),
                      });
                    }}
                    keyboardType="numeric"
                    placeholder="0"
                  />
                </View>
              )}
            </View>
          )}

          <View style={[styles.section, styles.switchSection, { backgroundColor: theme.colors.card }]}>
            <View style={styles.switchInfo}>
              <Text style={[styles.switchLabel, { color: theme.colors.text.primary }]}>
                Active Alert
              </Text>
              <Text style={[styles.switchDescription, { color: theme.colors.text.secondary }]}>
                Enable notifications for this alert
              </Text>
            </View>
            <Switch
              value={config.active}
              onValueChange={(active) => setConfig(prev => ({ ...prev, active }))}
              trackColor={{ false: theme.colors.gray[300], true: theme.colors.primary[200] }}
              thumbColor={config.active ? theme.colors.primary[500] : theme.colors.gray[400]}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  saveButton: {
    padding: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  productInfo: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  currentPrice: {
    fontSize: 14,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  typeInfo: {
    flex: 1,
  },
  typeLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  typeDescription: {
    fontSize: 14,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  inputGroup: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  switchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
  },
  switchInfo: {
    flex: 1,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 14,
  },
});

export default AlertConfig;