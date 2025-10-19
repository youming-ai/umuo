/**
 * Profile Screen
 * User profile, settings, and account management
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Image,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUserStore } from '@/store/user_store';
import { useAlertStore } from '@/store/alert_store';
import { User } from '@/types';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useRouter } from 'expo-router';

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const { getUser, updateUser, logout } = useUserStore();
  const { getAlerts } = useAlertStore();
  const router = useRouter();

  const bgColor = useThemeColor({ light: '#F2F2F7', dark: '#000000' }, 'background');
  const cardBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const successColor = useThemeColor({ light: '#34C759', dark: '#30D158' }, 'success');
  const warningColor = useThemeColor({ light: '#FF9500', dark: '#FF9F0A' }, 'warning');
  const dangerColor = useThemeColor({ light: '#FF3B30', dark: '#FF453A' }, 'danger');

  useEffect(() => {
    loadUserData();
    loadPreferences();
  }, []);

  const loadUserData = async () => {
    try {
      const userData = await getUser();
      setUser(userData);
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  };

  const loadPreferences = () => {
    // In a real app, load from AsyncStorage
    setNotificationsEnabled(true);
    setAnalyticsEnabled(false);
    setLocationEnabled(false);
  };

  const handleLogout = () => {
    Alert.alert(
      'ログアウト',
      'ログアウトしてもよろしいですか？',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'ログアウト',
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
              router.replace('/auth');
            } catch (error) {
              console.error('Logout failed:', error);
              Alert.alert('エラー', 'ログアウトに失敗しました');
            }
          },
        },
      ]
    );
  };

  const handleLanguageChange = () => {
    Alert.alert(
      '言語設定',
      '表示言語を選択してください',
      [
        { text: '日本語', onPress: () => console.log('Set language to Japanese') },
        { text: 'English', onPress: () => console.log('Set language to English') },
        { text: '中文', onPress: () => console.log('Set language to Chinese') },
        { text: 'キャンセル', style: 'cancel' },
      ]
    );
  };

  const renderProfileHeader = () => (
    <View style={[styles.profileHeader, { backgroundColor: cardBg }]}>
      <View style={styles.profileInfo}>
        <View style={[styles.avatarContainer, { backgroundColor: primaryColor + '20' }]}>
          {user?.avatar ? (
            <Image source={{ uri: user.avatar }} style={styles.avatar} />
          ) : (
            <Ionicons name="person" size={40} color={primaryColor} />
          )}
        </View>
        <View style={styles.profileDetails}>
          <Text style={[styles.userName, { color: textColor }]}>
            {user?.displayName || 'ゲストユーザー'}
          </Text>
          <Text style={[styles.userEmail, { color: secondaryTextColor }]}>
            {user?.email || 'ログインしていません'}
          </Text>
          <Text style={[styles.memberSince, { color: secondaryTextColor }]}>
            {user?.createdAt ? `登録日: ${new Date(user.createdAt).toLocaleDateString('ja-JP')}` : ''}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={[styles.editButton, { backgroundColor: primaryColor + '20' }]}
        onPress={() => router.push('/profile/edit')}
      >
        <Ionicons name="create-outline" size={20} color={primaryColor} />
      </TouchableOpacity>
    </View>
  );

  const renderStatsCard = async () => {
    const alertsCount = await getAlerts();

    return (
      <View style={[styles.statsCard, { backgroundColor: cardBg }]}>
        <Text style={[styles.statsTitle, { color: textColor }]}>
          利用統計
        </Text>
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: primaryColor }]}>
              {alertsCount?.length || 0}
            </Text>
            <Text style={[styles.statLabel, { color: secondaryTextColor }]}>
              価格アラート
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: successColor }]}>
              0
            </Text>
            <Text style={[styles.statLabel, { color: secondaryTextColor }]}>
              比較リスト
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: warningColor }]}>
              0
            </Text>
            <Text style={[styles.statLabel, { color: secondaryTextColor }]}>
              お気に入り
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: dangerColor }]}>
              0
            </Text>
            <Text style={[styles.statLabel, { color: secondaryTextColor }]}>
              検索履歴
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderSettingsSection = (title: string, items: any[]) => (
    <View style={[styles.sectionContainer, { backgroundColor: cardBg }]}>
      <Text style={[styles.sectionTitle, { color: textColor }]}>
        {title}
      </Text>
      {items.map((item, index) => (
        <View key={index}>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={item.onPress}
            disabled={item.disabled}
          >
            <View style={styles.settingLeft}>
              <View style={[styles.settingIconContainer, { backgroundColor: item.color + '20' }]}>
                <Ionicons name={item.icon} size={20} color={item.color} />
              </View>
              <View style={styles.settingInfo}>
                <Text style={[styles.settingTitle, { color: textColor }]}>
                  {item.title}
                </Text>
                {item.description && (
                  <Text style={[styles.settingDescription, { color: secondaryTextColor }]}>
                    {item.description}
                  </Text>
                )}
              </View>
            </View>
            {item.type === 'toggle' ? (
              <Switch
                value={item.value}
                onValueChange={item.onToggle}
                trackColor={{ false: '#E5E5E7', true: item.color + '40' }}
                thumbColor={item.value ? item.color : '#FFFFFF'}
              />
            ) : item.type === 'navigation' ? (
              <Ionicons name="chevron-forward" size={20} color={secondaryTextColor} />
            ) : null}
          </TouchableOpacity>
          {index < items.length - 1 && <View style={[styles.divider, { backgroundColor: '#E5E5E7' }]} />}
        </View>
      ))}
    </View>
  );

  const notificationSettings = [
    {
      icon: 'notifications-outline',
      title: 'プッシュ通知',
      description: '価格アラートやお得な情報をお知らせ',
      color: primaryColor,
      type: 'toggle',
      value: notificationsEnabled,
      onToggle: setNotificationsEnabled,
    },
    {
      icon: 'mail-outline',
      title: 'メール通知',
      description: '重要な更新情報をメールで受信',
      color: successColor,
      type: 'toggle',
      value: false,
      onToggle: (value: boolean) => console.log('Email notifications:', value),
    },
  ];

  const privacySettings = [
    {
      icon: 'analytics-outline',
      title: '利用データ',
      description: 'アプリ改善のための匿名データ収集',
      color: warningColor,
      type: 'toggle',
      value: analyticsEnabled,
      onToggle: setAnalyticsEnabled,
    },
    {
      icon: 'location-outline',
      title: '位置情報',
      description: '近くのお店情報を表示',
      color: dangerColor,
      type: 'toggle',
      value: locationEnabled,
      onToggle: setLocationEnabled,
    },
  ];

  const appSettings = [
    {
      icon: 'language-outline',
      title: '言語',
      description: '日本語',
      color: primaryColor,
      type: 'navigation',
      onPress: handleLanguageChange,
    },
    {
      icon: 'moon-outline',
      title: 'ダークモード',
      description: 'システム設定に従う',
      color: secondaryTextColor,
      type: 'navigation',
      onPress: () => console.log('Open theme settings'),
    },
    {
      icon: 'download-outline',
      title: 'オフラインデータ',
      description: '最終同期: 1時間前',
      color: successColor,
      type: 'navigation',
      onPress: () => console.log('Open offline settings'),
    },
  ];

  const supportSettings = [
    {
      icon: 'help-circle-outline',
      title: 'ヘルプセンター',
      color: primaryColor,
      type: 'navigation',
      onPress: () => Linking.openURL('https://help.yabaii.day'),
    },
    {
      icon: 'chatbubble-outline',
      title: 'フィードバック',
      color: successColor,
      type: 'navigation',
      onPress: () => console.log('Open feedback'),
    },
    {
      icon: 'document-text-outline',
      title: '利用規約',
      color: secondaryTextColor,
      type: 'navigation',
      onPress: () => Linking.openURL('https://yabaii.day/terms'),
    },
    {
      icon: 'shield-checkmark-outline',
      title: 'プライバシーポリシー',
      color: secondaryTextColor,
      type: 'navigation',
      onPress: () => Linking.openURL('https://yabaii.day/privacy'),
    },
  ];

  const dangerSettings = [
    {
      icon: 'trash-outline',
      title: 'データ削除',
      description: 'すべてのユーザーデータを削除',
      color: dangerColor,
      type: 'navigation',
      onPress: () => {
        Alert.alert(
          '確認',
          'すべてのユーザーデータを削除してもよろしいですか？この操作は元に戻せません。',
          [
            { text: 'キャンセル', style: 'cancel' },
            {
              text: '削除',
              style: 'destructive',
              onPress: () => console.log('Delete user data'),
            },
          ]
        );
      },
    },
    {
      icon: 'log-out-outline',
      title: 'ログアウト',
      color: dangerColor,
      type: 'navigation',
      onPress: handleLogout,
    },
  ];

  return (
    <ScrollView style={[styles.container, { backgroundColor: bgColor }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: textColor }]}>
          プロフィール
        </Text>
      </View>

      {/* Profile Header */}
      {renderProfileHeader()}

      {/* Stats Card */}
      {renderStatsCard()}

      {/* Notification Settings */}
      {renderSettingsSection('通知設定', notificationSettings)}

      {/* Privacy Settings */}
      {renderSettingsSection('プライバシー設定', privacySettings)}

      {/* App Settings */}
      {renderSettingsSection('アプリ設定', appSettings)}

      {/* Support */}
      {renderSettingsSection('サポート', supportSettings)}

      {/* Danger Zone */}
      <View style={styles.dangerSection}>
        {renderSettingsSection('', dangerSettings)}
      </View>

      {/* App Version */}
      <View style={styles.versionContainer}>
        <Text style={[styles.versionText, { color: secondaryTextColor }]}>
          やばいデイ v1.0.0
        </Text>
        <Text style={[styles.copyrightText, { color: secondaryTextColor }]}>
          © 2025 Yabaii.day
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  profileHeader: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  profileDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 16,
    marginBottom: 4,
  },
  memberSince: {
    fontSize: 14,
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 20,
    right: 20,
  },
  statsCard: {
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    textAlign: 'center',
  },
  sectionContainer: {
    margin: 16,
    marginTop: 0,
    padding: 4,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    margin: 16,
    marginBottom: 8,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 14,
  },
  divider: {
    height: 1,
    marginHorizontal: 16,
  },
  dangerSection: {
    marginTop: 8,
  },
  versionContainer: {
    alignItems: 'center',
    padding: 32,
  },
  versionText: {
    fontSize: 14,
    marginBottom: 4,
  },
  copyrightText: {
    fontSize: 12,
  },
});