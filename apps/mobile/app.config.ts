import { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Yabaii',
  slug: 'yabaii',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  assetBundlePatterns: [
    '**/*'
  ],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.yabaii.app',
    infoPlist: {
      NSCameraUsageDescription: 'This app uses the camera to scan product barcodes for price comparison.',
      NSPhotoLibraryUsageDescription: 'This app uses photo library for product image uploads.',
      NSLocationWhenInUseUsageDescription: 'This app uses location to show nearby deals and offers.'
    }
  },
  android: {
    package: 'com.yabaii.app',
    permissions: [
      'CAMERA',
      'VIBRATE',
      'INTERNET',
      'ACCESS_NETWORK_STATE',
      'ACCESS_WIFI_STATE'
    ]
  },
  plugins: [
    'expo-barcode-scanner',
    'expo-notifications',
    'expo-secure-store'
  ],
  extra: {
    eas: {
      projectId: 'your-eas-project-id'
    },
    apiDomain: process.env.EXPO_PUBLIC_API_DOMAIN || 'localhost:3000',
    appDomain: process.env.EXPO_PUBLIC_APP_DOMAIN || 'localhost:8081'
  },
  updates: {
    enabled: true,
    fallbackToCacheTimeout: 0
  },
  runtimeVersion: {
    policy: 'sdkVersion'
  }
});