import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>🛍️ Yabaii</Text>
      <Text style={styles.subtitle}>Japanese Price Comparison App</Text>
      <Text style={styles.description}>
        Your intelligent shopping companion for finding the best deals across Japanese e-commerce platforms.
      </Text>
      <View style={styles.features}>
        <Text style={styles.feature}>✓ Multi-platform price comparison</Text>
        <Text style={styles.feature}>✓ Barcode scanning</Text>
        <Text style={styles.feature}>✓ AI-powered recommendations</Text>
        <Text style={styles.feature}>✓ Price alerts & notifications</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 20,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: '#1e293b',
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
    color: '#334155',
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
    color: '#64748b',
    paddingHorizontal: 20,
  },
  features: {
    alignItems: 'flex-start',
    width: '100%',
    maxWidth: 300,
  },
  feature: {
    fontSize: 16,
    marginBottom: 8,
    color: '#059669',
    fontWeight: '500',
  },
});