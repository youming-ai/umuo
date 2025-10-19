/**
 * Alerts Screen
 * Shows price alerts and notifications set by the user
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAlertStore } from '@/store/alert_store';
import { Alert as AlertType } from '@/types';
import { useThemeColor } from '@/hooks/useThemeColor';
import { formatPrice, formatRelativeTime } from '@/utils';
import { router } from 'expo-router';

export default function AlertsScreen() {
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [loading, setLoading] = useState(false);
  const { getAlerts, updateAlert, deleteAlert } = useAlertStore();

  const bgColor = useThemeColor({ light: '#F2F2F7', dark: '#000000' }, 'background');
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const successColor = useThemeColor({ light: '#34C759', dark: '#30D158' }, 'success');
  const warningColor = useThemeColor({ light: '#FF9500', dark: '#FF9F0A' }, 'warning');
  const dangerColor = useThemeColor({ light: '#FF3B30', dark: '#FF453A' }, 'danger');

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const userAlerts = await getAlerts();
      setAlerts(userAlerts);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAlert = async (alertId: string, enabled: boolean) => {
    try {
      await updateAlert(alertId, { enabled });
      setAlerts(prevAlerts =>
        prevAlerts.map(alert =>
          alert.id === alertId ? { ...alert, enabled } : alert
        )
      );
    } catch (error) {
      console.error('Failed to update alert:', error);
      Alert.alert('エラー', 'アラートの更新に失敗しました');
    }
  };

  const handleDeleteAlert = (alertId: string) => {
    Alert.alert(
      '確認',
      'このアラートを削除してもよろしいですか？',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAlert(alertId);
              setAlerts(prevAlerts => prevAlerts.filter(alert => alert.id !== alertId));
            } catch (error) {
              console.error('Failed to delete alert:', error);
              Alert.alert('エラー', 'アラートの削除に失敗しました');
            }
          },
        },
      ]
    );
  };

  const handleEditAlert = (alert: AlertType) => {
    // Navigate to alert edit screen
    router.push({
      pathname: '/alert/[alertId]',
      params: { alertId: alert.id },
    });
  };

  const renderAlertItem = ({ item }: { item: AlertType }) => {
    const getAlertTypeLabel = (type: string) => {
      switch (type) {
        case 'price_drop':
          return '値下げ';
        case 'price_low':
          return '目標価格';
        case 'in_stock':
          return '在庫復活';
        case 'any_change':
          return '価格変動';
        default:
          return type;
      }
    };

    const getAlertTypeColor = (type: string) => {
      switch (type) {
        case 'price_drop':
          return successColor;
        case 'price_low':
          return primaryColor;
        case 'in_stock':
          return warningColor;
        case 'any_change':
          return secondaryTextColor;
        default:
          return textColor;
      }
    };

    const getAlertTypeIcon = (type: string) => {
      switch (type) {
        case 'price_drop':
          return 'trending-down';
        case 'price_low':
          return 'flag';
        case 'in_stock':
          return 'checkmark-circle';
        case 'any_change':
          return 'sync';
        default:
          return 'notifications';
      }
    };

    const isTriggered = item.triggered;
    const alertColor = getAlertTypeColor(item.type);
    const alertIcon = getAlertTypeIcon(item.type);

    return (
      <View style={[styles.alertCard, { backgroundColor: cardBg }]}>
        <View style={styles.alertHeader}>
          <View style={styles.alertTypeContainer}>
            <View style={[styles.alertIconContainer, { backgroundColor: alertColor + '20' }]}>
              <Ionicons name={alertIcon as any} size={20} color={alertColor} />
            </View>
            <View style={styles.alertTypeInfo}>
              <Text style={[styles.alertTypeText, { color: alertColor }]}>
                {getAlertTypeLabel(item.type)}
              </Text>
              <Text style={[styles.productName, { color: textColor }]}>
                {item.productName}
              </Text>
            </View>
          </View>

          <View style={styles.alertActions}>
            <Switch
              value={item.enabled}
              onValueChange={(value) => handleToggleAlert(item.id, value)}
              trackColor={{ false: '#E5E5E7', true: alertColor + '40' }}
              thumbColor={item.enabled ? alertColor : '#FFFFFF'}
            />
          </View>
        </View>

        {/* Alert Condition */}
        <View style={styles.alertCondition}>
          {item.condition.threshold && (
            <View style={styles.conditionRow}>
              <Ionicons name="pricetag" size={16} color={secondaryTextColor} />
              <Text style={[styles.conditionText, { color: textColor }]}>
                目標価格: {formatPrice(item.condition.threshold, 'JPY')}
              </Text>
            </View>
          )}

          {item.condition.percentage && (
            <View style={styles.conditionRow}>
              <Ionicons name="percent" size={16} color={secondaryTextColor} />
              <Text style={[styles.conditionText, { color: textColor }]}>
                値下げ率: {item.condition.percentage}%
              </Text>
            </View>
          )}

          {item.condition.lowestHistorical && (
            <View style={styles.conditionRow}>
              <Ionicons name="trending-down" size={16} color={successColor} />
              <Text style={[styles.conditionText, { color: textColor }]}>
                過去最低値
              </Text>
            </View>
          )}
        </View>

        {/* Status */}
        <View style={styles.alertStatus}>
          <View style={styles.statusRow}>
            <Text style={[styles.statusText, { color: secondaryTextColor }]}>
              状態:
            </Text>
            <Text style={[
              styles.statusValue,
              {
                color: isTriggered ? successColor :
                       item.enabled ? primaryColor : secondaryTextColor
              }
            ]}>
              {isTriggered ? 'トリガー済み' :
               item.enabled ? '監視中' : '無効'}
            </Text>
          </View>

          <Text style={[styles.createdText, { color: secondaryTextColor }]}>
            作成: {formatRelativeTime(new Date(item.createdAt))}
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.alertActionsRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: primaryColor + '20' }]}
            onPress={() => handleEditAlert(item)}
          >
            <Ionicons name="create-outline" size={16} color={primaryColor} />
            <Text style={[styles.actionButtonText, { color: primaryColor }]}>
              編集
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: dangerColor + '20' }]}
            onPress={() => handleDeleteAlert(item.id)}
          >
            <Ionicons name="trash-outline" size={16} color={dangerColor} />
            <Text style={[styles.actionButtonText, { color: dangerColor }]}>
              削除
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="notifications-off-outline" size={64} color={secondaryTextColor} />
      <Text style={[styles.emptyTitle, { color: textColor }]}>
        価格アラートがありません
      </Text>
      <Text style={[styles.emptyText, { color: secondaryTextColor }]}>
        商品詳細ページで「価格アラート」を設定して、お得な価格をお見逃しなく！
      </Text>
      <TouchableOpacity
        style={[styles.browseButton, { backgroundColor: primaryColor }]}
        onPress={() => router.push('/search')}
      >
        <Ionicons name="search" size={20} color="#FFFFFF" />
        <Text style={styles.browseButtonText}>商品を探す</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading && alerts.length === 0) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: bgColor }]}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
          読み込み中...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: textColor }]}>
          価格アラート
        </Text>
        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: primaryColor }]}
          onPress={() => router.push('/search')}
        >
          <Ionicons name="add" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      {alerts.length > 0 && (
        <View style={[styles.statsContainer, { backgroundColor: cardBg }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: textColor }]}>
              {alerts.length}
            </Text>
            <Text style={[styles.statLabel, { color: secondaryTextColor }]}>
              合計アラート
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: successColor }]}>
              {alerts.filter(a => a.enabled).length}
            </Text>
            <Text style={[styles.statLabel, { color: secondaryTextColor }]}>
              監視中
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: warningColor }]}>
              {alerts.filter(a => a.triggered).length}
            </Text>
            <Text style={[styles.statLabel, { color: secondaryTextColor }]}>
              トリガー済み
            </Text>
          </View>
        </View>
      )}

      {/* Alerts List */}
      <FlatList
        data={alerts}
        renderItem={renderAlertItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.alertsList}
        ListEmptyComponent={renderEmptyState()}
      />

      {/* Tips */}
      <View style={[styles.tipsContainer, { backgroundColor: cardBg }]}>
        <Text style={[styles.tipsTitle, { color: textColor }]}>
          💡 価格アラート活用術
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 目標価格を設定すると、その価格以下になったら通知します
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 値下げ率アラートは、指定した割引以上の割引時に通知します
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 過去最低値アラートは、これまでの最安値を下回ったら通知します
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • アラートはいつでもオン/オフ切り替え可能です
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 14,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: '#E5E5E7',
    marginHorizontal: 16,
  },
  alertsList: {
    padding: 16,
    gap: 16,
  },
  alertCard: {
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    padding: 16,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  alertTypeContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  alertIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  alertTypeInfo: {
    flex: 1,
  },
  alertTypeText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  productName: {
    fontSize: 16,
    fontWeight: '500',
  },
  alertActions: {
    marginLeft: 12,
  },
  alertCondition: {
    marginBottom: 12,
    gap: 8,
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  conditionText: {
    fontSize: 14,
  },
  alertStatus: {
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusText: {
    fontSize: 14,
    marginRight: 8,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  createdText: {
    fontSize: 12,
  },
  alertActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  browseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  tipsContainer: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
  },
  tipsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  tipText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
});