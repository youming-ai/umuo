const { getDefaultConfig } = require('@expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = {
  ...config,
  resolver: {
    alias: {
      '@': './src',
      '@/components': './src/components',
      '@/hooks': './src/hooks',
      '@/store': './src/store',
      '@/utils': './src/utils',
      '@/types': './src/types'
    }
  }
};