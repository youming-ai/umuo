import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../src/theme';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  image?: ImageSourcePropType;
  icon?: keyof typeof Ionicons.glyphMap;
  preferences?: {
    key: string;
    label: string;
    options: Array<{
      value: string;
      label: string;
      icon?: keyof typeof Ionicons.glyphMap;
    }>;
    required?: boolean;
  }[];
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Yabaii',
    description: 'Your intelligent price comparison companion for Japanese shopping',
    icon: 'pricetag-outline',
  },
  {
    id: 'language',
    title: 'Choose Your Language',
    description: 'Select your preferred language for the best experience',
    icon: 'language-outline',
    preferences: [
      {
        key: 'language',
        label: 'Language',
        options: [
          { value: 'ja', label: '日本語', icon: 'flag-outline' },
          { value: 'en', label: 'English', icon: 'globe-outline' },
          { value: 'zh', label: '中文', icon: 'planet-outline' },
        ],
        required: true,
      },
    ],
  },
  {
    id: 'preferences',
    title: 'Shopping Preferences',
    description: 'Help us personalize your experience',
    icon: 'heart-outline',
    preferences: [
      {
        key: 'favoriteCategories',
        label: 'Favorite Categories',
        options: [
          { value: 'electronics', label: 'Electronics', icon: 'laptop-outline' },
          { value: 'fashion', label: 'Fashion', icon: 'shirt-outline' },
          { value: 'home', label: 'Home & Garden', icon: 'home-outline' },
          { value: 'books', label: 'Books', icon: 'book-outline' },
          { value: 'beauty', label: 'Beauty', icon: 'sparkles-outline' },
          { value: 'sports', label: 'Sports', icon: 'football-outline' },
        ],
      },
      {
        key: 'priceSensitivity',
        label: 'Price Priority',
        options: [
          { value: 'low', label: 'Budget Conscious', icon: 'wallet-outline' },
          { value: 'medium', label: 'Balanced', icon: 'scale-outline' },
          { value: 'high', label: 'Quality First', icon: 'diamond-outline' },
        ],
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Stay Updated',
    description: 'Get notified about price drops and deals',
    icon: 'notifications-outline',
    preferences: [
      {
        key: 'notifications',
        label: 'Notification Preferences',
        options: [
          { value: 'all', label: 'All Updates', icon: 'notifications' },
          { value: 'important', label: 'Important Only', icon: 'notifications-outline' },
          { value: 'none', label: 'None', icon: 'notifications-off-outline' },
        ],
      },
    ],
  },
  {
    id: 'features',
    title: 'Key Features',
    description: 'Discover what makes Yabaii special',
    icon: 'star-outline',
    preferences: [],
  },
];

export default function OnboardingScreen() {
  const [currentStep, setCurrentStep] = useState(0);
  const [preferences, setPreferences] = useState<Record<string, string[]>>({});
  const router = useRouter();
  const theme = useTheme();

  const currentStepData = ONBOARDING_STEPS[currentStep];
  const progress = ((currentStep + 1) / ONBOARDING_STEPS.length) * 100;

  const handleNext = () => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    // Save preferences and navigate to main app
    // This would integrate with your user service
    console.log('Onboarding completed with preferences:', preferences);
    router.replace('/(tabs)');
  };

  const handlePreferenceSelect = (prefKey: string, value: string) => {
    setPreferences(prev => ({
      ...prev,
      [prefKey]: prev[prefKey]?.includes(value)
        ? prev[prefKey].filter(v => v !== value)
        : [...(prev[prefKey] || []), value],
    }));
  };

  const canProceed = () => {
    const stepPrefs = currentStepData.preferences;
    if (!stepPrefs || stepPrefs.length === 0) return true;

    return stepPrefs.every(pref =>
      !pref.required || (preferences[pref.key]?.length || 0) > 0
    );
  };

  const renderStepContent = () => {
    const { title, description, icon, preferences: stepPreferences } = currentStepData;

    return (
      <View style={styles.content}>
        {/* Icon/Image */}
        <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary[100] }]}>
          {icon && (
            <Ionicons
              name={icon}
              size={64}
              color={theme.colors.primary[500]}
            />
          )}
        </View>

        {/* Title and Description */}
        <Text style={[styles.title, { color: theme.colors.text.primary }]}>
          {title}
        </Text>
        <Text style={[styles.description, { color: theme.colors.text.secondary }]}>
          {description}
        </Text>

        {/* Preferences */}
        {stepPreferences && stepPreferences.length > 0 && (
          <View style={styles.preferencesContainer}>
            {stepPreferences.map((pref) => (
              <View key={pref.key} style={styles.preferenceGroup}>
                <Text style={[styles.preferenceLabel, { color: theme.colors.text.primary }]}>
                  {pref.label}
                  {pref.required && <Text style={styles.required}> *</Text>}
                </Text>
                <View style={styles.optionsContainer}>
                  {pref.options.map((option) => {
                    const isSelected = preferences[pref.key]?.includes(option.value);
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.option,
                          {
                            backgroundColor: isSelected
                              ? theme.colors.primary[500]
                              : theme.colors.card,
                            borderColor: theme.colors.border,
                          },
                        ]}
                        onPress={() => handlePreferenceSelect(pref.key, option.value)}
                      >
                        {option.icon && (
                          <Ionicons
                            name={option.icon}
                            size={16}
                            color={isSelected ? theme.colors.white : theme.colors.primary[500]}
                          />
                        )}
                        <Text
                          style={[
                            styles.optionText,
                            {
                              color: isSelected
                                ? theme.colors.white
                                : theme.colors.text.primary,
                            },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Feature highlights for features step */}
        {currentStepData.id === 'features' && (
          <View style={styles.featuresContainer}>
            {[
              { icon: 'search-outline', title: 'Smart Search', desc: 'Find products across all major Japanese stores' },
              { icon: 'camera-outline', title: 'Barcode Scanner', desc: 'Scan products for instant price comparison' },
              { icon: 'notifications-outline', title: 'Price Alerts', desc: 'Get notified when prices drop' },
              { icon: 'analytics-outline', title: 'Price History', desc: 'Track prices over time to find the best deal' },
            ].map((feature, index) => (
              <Card key={index} style={styles.featureCard}>
                <View style={styles.featureContent}>
                  <Ionicons
                    name={feature.icon}
                    size={24}
                    color={theme.colors.primary[500]}
                  />
                  <View style={styles.featureText}>
                    <Text style={[styles.featureTitle, { color: theme.colors.text.primary }]}>
                      {feature.title}
                    </Text>
                    <Text style={[styles.featureDesc, { color: theme.colors.text.secondary }]}>
                      {feature.desc}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { backgroundColor: theme.colors.gray[200] }]}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress}%`, backgroundColor: theme.colors.primary[500] },
            ]}
          />
        </View>
        <Text style={[styles.progressText, { color: theme.colors.text.secondary }]}>
          {currentStep + 1} of {ONBOARDING_STEPS.length}
        </Text>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderStepContent()}
      </ScrollView>

      {/* Navigation */}
      <View style={[styles.navigation, { borderTopColor: theme.colors.border }]}>
        {currentStep > 0 && (
          <Button
            title="Previous"
            onPress={handlePrevious}
            variant="outline"
            style={styles.previousButton}
          />
        )}

        <View style={styles.nextButtonContainer}>
          <Button
            title={currentStep === ONBOARDING_STEPS.length - 1 ? 'Get Started' : 'Next'}
            onPress={handleNext}
            disabled={!canProceed()}
            style={[
              styles.nextButton,
              !canProceed() && styles.disabledButton,
            ]}
          />
        </View>

        {currentStep < ONBOARDING_STEPS.length - 1 && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleComplete}
          >
            <Text style={[styles.skipText, { color: theme.colors.text.secondary }]}>
              Skip
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  progressContainer: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  content: {
    flex: 1,
    alignItems: 'center',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  preferencesContainer: {
    width: '100%',
    marginBottom: 32,
  },
  preferenceGroup: {
    marginBottom: 24,
  },
  preferenceLabel: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  required: {
    color: '#E53E3E',
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 120,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  featuresContainer: {
    width: '100%',
    gap: 16,
  },
  featureCard: {
    padding: 16,
  },
  featureContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    flex: 1,
    marginLeft: 16,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 14,
    lineHeight: 20,
  },
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
  },
  previousButton: {
    minWidth: 100,
  },
  nextButtonContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 16,
  },
  nextButton: {
    minWidth: 120,
  },
  disabledButton: {
    opacity: 0.5,
  },
  skipButton: {
    padding: 8,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '500',
  },
});