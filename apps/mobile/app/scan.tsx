/**
 * Barcode Scanning Screen
 * Allows users to scan product barcodes for quick price comparison
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Vibration,
} from 'react-native';
import { router } from 'expo-router';
import { BarCodeScanner } from 'expo-barcode-scanner';
import * as Haptics from 'expo-haptics';
import { useSearchProducts } from '@/hooks/use_api';
import { useSearchStore } from '@/store/search_store';
import { useThemeColor } from '@/hooks/useThemeColor';
import { Ionicons } from '@expo/vector-icons';

export default function ScanScreen() {
  const [hasPermission, setHasPermission] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);

  const { addToRecentSearches } = useSearchStore();
  const searchMutation = useSearchProducts();

  const bgColor = useThemeColor({ light: '#000000', dark: '#000000' }, 'background');
  const overlayBg = useThemeColor({ light: '#FFFFFF', dark: '#1C1C1E' }, 'card');
  const textColor = useThemeColor({ light: '#000000', dark: '#FFFFFF' }, 'text');
  const secondaryTextColor = useThemeColor({ light: '#666666', dark: '#999999' }, 'secondaryText');
  const primaryColor = useThemeColor({ light: '#007AFF', dark: '#0A84FF' }, 'primary');
  const warningColor = useThemeColor({ light: '#FF9500', dark: '#FF9F0A' }, 'warning');

  useEffect(() => {
    requestCameraPermission();
  }, []);

  const requestCameraPermission = async () => {
    // In a real app, you would use expo-camera or expo-barcode-scanner permissions
    setHasPermission(true);
  };

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    // Prevent duplicate scans
    if (data === lastScannedCode) return;

    setLastScannedCode(data);
    setScanning(false);

    // Vibrate to acknowledge scan
    Vibration.vibrate(100);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Validate and clean barcode
    const cleanCode = data.replace(/[^0-9]/g, '');

    if (!cleanCode || cleanCode.length < 8) {
      Alert.alert(
        'スキャンエラー',
        '有効なバーコードではありません。もう一度お試しください。',
        [{ text: 'OK', onPress: () => setScanning(true) }]
      );
      return;
    }

    // Search for product
    handleProductSearch(cleanCode);
  };

  const handleProductSearch = async (barcode: string) => {
    try {
      const result = await searchMutation.mutateAsync({
        query: barcode,
        page: 1,
      });

      if (result.products && result.products.length > 0) {
        // Add to search history
        addToRecentSearches(barcode);

        // Navigate to first product or search results
        const product = result.products[0];
        router.push({
          pathname: '/product/[spuId]',
          params: { spuId: product.id },
        });
      } else {
        Alert.alert(
          '商品が見つかりません',
          'このバーコードの商品が見つかりませんでした。手動で検索しますか？',
          [
            { text: 'キャンセル', onPress: () => setScanning(true) },
            {
              text: '手動検索',
              onPress: () => {
                router.push({
                  pathname: '/search',
                  params: { q: barcode },
                });
              },
            },
          ]
        );
      }
    } catch (error) {
      Alert.alert(
        'エラー',
        '検索中にエラーが発生しました。もう一度お試しください。',
        [{ text: 'OK', onPress: () => setScanning(true) }]
      );
    }
  };

  const handleManualInput = () => {
    Alert.prompt(
      '商品コードを入力',
      'JAN/EANコードを手動で入力してください',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '検索',
          onPress: (code) => {
            if (code) {
              const cleanCode = code.replace(/[^0-9]/g, '');
              if (cleanCode && cleanCode.length >= 8) {
                handleProductSearch(cleanCode);
              } else {
                Alert.alert('エラー', '有効な商品コードではありません。');
              }
            }
          },
        },
      ]
    );
  };

  const toggleScanning = () => {
    setScanning(!scanning);
    if (!scanning) {
      setLastScannedCode(null);
    }
  };

  if (!hasPermission) {
    return (
      <View style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.permissionContainer}>
          <Ionicons name="camera-outline" size={64} color={textColor} />
          <Text style={[styles.permissionTitle, { color: textColor }]}>
            カメラの許可が必要です
          </Text>
          <Text style={[styles.permissionText, { color: textColor }]}>
            バーコードをスキャンするにはカメラへのアクセス許可が必要です。
          </Text>
          <TouchableOpacity
            style={[styles.permissionButton, { backgroundColor: primaryColor }]}
            onPress={requestCameraPermission}
          >
            <Text style={styles.permissionButtonText}>
              許可をリクエスト
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.permissionButton, { backgroundColor: warningColor }]}
            onPress={() => router.back()}
          >
            <Text style={styles.permissionButtonText}>
              戻る
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor }]}>
          バーコードスキャン
        </Text>
        <TouchableOpacity onPress={toggleScanning}>
          <Ionicons
            name={scanning ? 'pause-circle' : 'play-circle'}
            size={24}
            color={scanning ? warningColor : primaryColor}
          />
        </TouchableOpacity>
      </View>

      {/* Scanner */}
      {scanning && (
        <View style={styles.scannerContainer}>
          <BarCodeScanner
            onBarCodeScanned={handleBarCodeScanned}
            style={StyleSheet.absoluteFillObject}
            barCodeTypes={[
              BarCodeScanner.Constants.BarCodeType.qr,
              BarCodeScanner.Constants.BarCodeType.ean13,
              BarCodeScanner.Constants.BarCodeType.ean8,
              BarCodeScanner.Constants.BarCodeType.upc_a,
              BarCodeScanner.Constants.BarCodeType.upc_e,
            ]}
          />
          <View style={styles.scannerOverlay}>
            <View style={styles.scanFrame} />
            <Text style={[styles.scanHint, { color: textColor }]}>
              バーコードをフレーム内に合わせてください
            </Text>
          </View>
        </View>
      )}

      {/* Last Scanned Code Display */}
      {lastScannedCode && (
        <View style={[styles.scannedCodeContainer, { backgroundColor: overlayBg }]}>
          <Text style={[styles.scannedCodeLabel, { color: secondaryTextColor }]}>
            最後のスキャン:
          </Text>
          <Text style={[styles.scannedCode, { color: textColor }]}>
            {lastScannedCode}
          </Text>
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: overlayBg }]}
          onPress={toggleScanning}
        >
          <Ionicons
            name={scanning ? 'pause' : 'play'}
            size={24}
            color={scanning ? warningColor : primaryColor}
          />
          <Text style={[styles.actionButtonText, { color: textColor }]}>
            {scanning ? '一時停止' : 'スキャン開始'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: overlayBg }]}
          onPress={handleManualInput}
        >
          <Ionicons name="keypad-outline" size={24} color={primaryColor} />
          <Text style={[styles.actionButtonText, { color: textColor }]}>
            手動入力
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: overlayBg }]}
          onPress={() => router.push('/search')}
        >
          <Ionicons name="search-outline" size={24} color={primaryColor} />
          <Text style={[styles.actionButtonText, { color: textColor }]}>
            検索
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tips */}
      <View style={[styles.tipsContainer, { backgroundColor: overlayBg }]}>
        <Text style={[styles.tipsTitle, { color: textColor }]}>
          💡 スキャンのコツ
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 明るい場所でスキャンしてください
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • バーコードが鮮明なようにしてください
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • スキャン範囲内でバーコードを真っすぐに保持してください
        </Text>
        <Text style={[styles.tipText, { color: textColor }]}>
          • 13桁のJANコードまたは8桁のEANコードをサポートしています
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 24,
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 32,
    lineHeight: 24,
  },
  permissionButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
    marginBottom: 16,
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 60,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  scannerContainer: {
    flex: 1,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  scanHint: {
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  scannedCodeContainer: {
    marginHorizontal: 16,
    marginVertical: 16,
    padding: 16,
    borderRadius: 12,
  },
  scannedCodeLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  scannedCode: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  actionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
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