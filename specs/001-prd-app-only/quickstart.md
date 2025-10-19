# Quick Start Guide: Japanese Price Comparison App

**Date**: 2025-10-08
**Version**: 1.0.0
**Target**: Developers and QA testers

## Overview

This guide helps you set up and test the Japanese price comparison mobile application locally. The app provides cross-platform e-commerce price comparisons with AI-powered features.

## Prerequisites

### Development Environment
- **Node.js**: 18.x or later
- **npm** or **yarn**: Latest version
- **Expo CLI**: `npm install -g @expo/cli`
- **iOS Simulator** (macOS only) or **Android Studio**
- **Physical device** (optional, for testing camera/scanner)

### Required Accounts
- **Apple Developer Account** (for iOS testing)
- **Google Play Console** (for Android testing)
- **E-commerce API Access**:
  - Amazon Product Advertising API
  - Rakuten Developer Portal
  - Yahoo Shopping API
  - Others as needed

## Project Setup

### 1. Repository Setup
```bash
# Clone the repository
git clone <repository-url>
cd crushbot.ai

# Switch to feature branch
git checkout 001-prd-app-only

# Install dependencies
npm install
```

### 2. Mobile App Setup
```bash
# Navigate to mobile app directory
cd apps/mobile

# Install Expo dependencies
npx expo install

# Install additional dependencies
npm install @tanstack/react-query zustand nativewind
npm install axios expo-barcode-scanner expo-notifications
npm install @lingui/react @lingui/cli
npm install @sentry/react-native sentry-expo
```

### 3. Backend API Setup
```bash
# Navigate to API directory
cd ../api

# Install backend dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys and configurations
```

## Environment Configuration

### Mobile App Configuration
Create `apps/mobile/.env.local`:

```env
# API Configuration
EXPO_PUBLIC_API_URL=https://api.yabaii.day/v1
EXPO_PUBLIC_API_DOMAIN=api.yabaii.day
EXPO_PUBLIC_APP_DOMAIN=yabaii.day
EXPO_PUBLIC_SENTRY_DSN=your_sentry_dsn

# Feature Flags
EXPO_PUBLIC_ENABLE_AI_FEATURES=true
EXPO_PUBLIC_ENABLE_BARCODE_SCANNER=true
EXPO_PUBLIC_ENABLE_NOTIFICATIONS=true

# Development Settings
EXPO_PUBLIC_DEBUG_MODE=true
EXPO_PUBLIC_LOG_LEVEL=debug
```

### Backend API Configuration
Create `api/.env.local`:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/yabaii
REDIS_URL=redis://localhost:6379

# API Keys
AMAZON_ACCESS_KEY=your_amazon_key
AMAZON_SECRET_KEY=your_amazon_secret
RAKUTEN_APP_ID=your_rakuten_id
YAHOO_APP_ID=your_yahoo_id

# Vercel AI Services
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
VERCEL_AI_API_KEY=your_vercel_ai_key
LOCAL_AI_ENDPOINT=http://localhost:11434  # Ollama

# External Services
SENTRY_DSN=your_sentry_dsn

# Service Domain
DOMAIN=yabaii.day
API_DOMAIN=api.yabaii.day
```

## Running the Application

### 1. Start Backend API
```bash
# In api directory
npm run dev
```

The API will be available at `http://localhost:3000`

### 2. Start Mobile App
```bash
# In apps/mobile directory
npx expo start
```

This will open the Expo DevTools in your browser.

### 3. Run on Device/Simulator

#### iOS (macOS only)
```bash
# Press 'i' in Expo DevTools or run:
npx expo run:ios
```

#### Android
```bash
# Press 'a' in Expo DevTools or run:
npx expo run:android
```

#### Physical Device
1. Install Expo Go app from App Store/Play Store
2. Scan QR code from Expo DevTools
3. Or use `npx expo install --fix` for native modules

## Core Feature Testing

### 1. Product Search
**Action**: Search for products
**Steps**:
1. Open the app
2. Tap on search bar
3. Enter "iPhone 15" or any product name
4. View search results
5. Tap on a product to see details

**Expected Results**:
- Search returns products from multiple platforms
- Product details show price comparisons
- Price history charts are displayed

### 2. Barcode Scanning
**Action**: Scan product barcode
**Steps**:
1. Go to scan tab
2. Grant camera permissions
3. Scan a product barcode
4. View product details

**Expected Results**:
- Camera opens successfully
- Barcode is recognized
- Product information is displayed

### 3. Price Alerts
**Action**: Set up price alerts
**Steps**:
1. Navigate to a product detail page
2. Tap "Set Alert" button
3. Configure alert conditions
4. Save alert

**Expected Results**:
- Alert is created successfully
- Alert appears in alerts list
- Notification permission requested

### 4. Community Features
**Action**: Vote on deals and comment
**Steps**:
1. Navigate to deals tab
2. Find a deal and vote "worth it"
3. Add a comment
4. View community feedback

**Expected Results**:
- Vote is recorded
- Comment appears
- Community scores update

### 5. AI Features
**Action**: View AI-generated summaries
**Steps**:
1. Go to product details
2. Scroll to review section
3. View AI summary
4. Check recommendations

**Expected Results**:
- AI-generated summary displayed
- Pros and cons listed
- Recommended products shown

## Testing Data Setup

### Sample Products
Use these sample JAN codes for testing:
- **4905524038230**: Calorie Mate (Japanese product)
- **4562215330216**: Shiseido product
- **4987020678125**: Japanese snack

### Test Users
Create test user accounts:
- Email: `test@example.com`
- Language: Japanese (ja)
- Preferences: Enable all notifications

## Troubleshooting

### Common Issues

#### Metro Bundle Issues
```bash
# Clear Metro cache
npx expo start --clear

# Reset node modules
rm -rf node_modules package-lock.json
npm install
```

#### iOS Simulator Issues
```bash
# Reset iOS Simulator
# iOS Simulator → Device → Erase All Content and Settings

# Reinstall app
npx expo run:ios --clear
```

#### Android Emulator Issues
```bash
# Wipe Android emulator
# Android Studio → AVD Manager → Wipe Data

# Reinstall app
npx expo run:android --clear
```

#### API Connection Issues
- Check that backend API is running on `localhost:3000`
- Verify environment variables are set correctly
- Check network connectivity in mobile device settings

#### Camera/Scanner Issues
- Ensure camera permissions are granted
- Check device camera is working
- Test with different barcode formats

### Debug Mode

Enable debug logging:
```javascript
// In app entry point
if (__DEV__) {
  import('./ReactotronConfig').then(() => console.log('Reactotron Configured'))
}
```

## Performance Testing

### Key Metrics to Monitor
- **First Paint**: <2.5 seconds
- **API Response**: <300ms p95
- **Memory Usage**: <150MB
- **Frame Rate**: >55 FPS

### Testing Tools
- **Flipper**: React Native debugging
- **Expo DevTools**: Performance monitoring
- **Sentry**: Error tracking
- **Reactotron**: State debugging

## Code Quality

### Linting and Formatting
```bash
# Run ESLint
npm run lint

# Run Prettier
npm run format

# Type checking
npm run type-check
```

### Testing
```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Generate coverage report
npm run test:coverage
```

## Deployment

### Development Build
```bash
# Create development build
eas build --profile development --platform ios
eas build --profile development --platform android
```

### Preview Build
```bash
# Create preview build for testing
eas build --profile preview --platform all
```

### Production Build
```bash
# Create production build
eas build --profile production --platform all
```

## Contributing

### Code Style
- Follow TypeScript strict mode
- Use Prettier for formatting
- Write tests for new features
- Update documentation

### Git Workflow
1. Create feature branch from `001-prd-app-only`
2. Make changes and test thoroughly
3. Submit PR with clear description
4. Ensure all tests pass
5. Request code review

## Support

### Documentation
- API Documentation: `/api/docs`
- Component Library: `/docs/components`
- Architecture Guide: `/docs/architecture`

### Contact
- Development Team: `dev-team@pricecompare.jp`
- QA Team: `qa-team@pricecompare.jp`
- Support Channel: `#mobile-dev` on Slack

---

**Quick Start Complete**: You should now have the app running locally and be able to test all core features. For additional help, refer to the detailed documentation or contact the development team.