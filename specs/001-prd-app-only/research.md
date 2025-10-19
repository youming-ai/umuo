# Research Findings: Japanese Price Comparison App

**Date**: 2025-10-08
**Feature**: 001-prd-app-only
**Status**: Complete

## Technical Decisions

### 1. Mobile Framework Decision
**Decision**: Expo (Managed Workflow) with React Native
**Rationale**:
- Simplified development and deployment workflow
- OTA updates capability via EAS Updates
- Built-in services (notifications, camera, secure storage)
- Strong TypeScript support
- Large ecosystem of compatible libraries

**Alternatives Considered**:
- React Native CLI: More flexibility but higher complexity
- Flutter: Different language (Dart) and smaller Japanese market ecosystem
- Native iOS/Android: Platform-specific code, higher maintenance cost

### 2. Navigation Solution
**Decision**: Expo Router (file-based routing)
**Rationale**:
- Type-safe navigation with TypeScript
- Deep linking support out of the box
- Convention-based routing reduces boilerplate
- Universal links and app links support

**Alternatives Considered**:
- React Navigation: More manual configuration
- Custom navigation solution: Higher development overhead

### 3. State Management
**Decision**: Zustand for complex state, React Query + Context for simple state
**Rationale**:
- Zustand: Minimal boilerplate, TypeScript-first, devtools support
- React Query: Server state management with caching and synchronization
- Context: Simple UI state without additional libraries

**Alternatives Considered**:
- Redux Toolkit: More complex, larger bundle size
- Recoil: Facebook-maintained but smaller ecosystem

### 4. Styling Solution
**Decision**: NativeWind (Tailwind CSS for React Native)
**Rationale**:
- Consistent with web development practices
- Utility-first approach for rapid development
- TypeScript support for style validation
- Smaller bundle size compared to styled-components

**Alternatives Considered**:
- StyleSheet API: React Native default but verbose
- Styled-components: Runtime overhead, larger bundle

### 5. Data Fetching Strategy
**Decision**: React Query with Axios
**Rationale**:
- React Query: Caching, background updates, error handling
- Axios: Request/response interceptors, timeout handling, retry logic
- TypeScript support for type-safe API calls

**Alternatives Considered**:
- Fetch API: Built-in but requires more boilerplate
- SWR: Similar to React Query but less feature-rich

### 6. Local Storage Strategy
**Decision**: MMKV for KV storage, SQLite for relational data, SecureStore for sensitive data
**Rationale**:
- MMKV: High-performance key-value storage for app preferences
- SQLite: Offline price history and watchlists with complex queries
- SecureStore: Encrypted storage for authentication tokens

**Alternatives Considered**:
- AsyncStorage: Slower performance for large datasets
- Realm: More complex, additional dependencies

### 7. Testing Strategy
**Decision**: Jest + React Native Testing Library + MSW
**Rationale**:
- Jest: Standard testing framework with good React Native support
- RNTL: Focus on user behavior testing
- MSW: API mocking for integration tests without network dependencies

**Alternatives Considered**:
- Detox: E2E testing but higher setup complexity
- Cypress: Web-focused, less mobile support

### 8. Internationalization
**Decision**: Lingui with ICU message format
**Rationale**:
- Strong TypeScript support
- ICU format for complex pluralization and gender rules
- Extracts messages for translation management
- Supports Japanese-specific formatting requirements

**Alternatives Considered**:
- i18next: Popular but more configuration required
- React Intl: Less TypeScript integration

### 9. Barcode Scanning
**Decision**: expo-barcode-scanner with expo-camera fallback
**Rationale**:
- expo-barcode-scanner: Dedicated scanning functionality
- expo-camera: Fallback for devices with camera limitations
- Supports JAN, UPC, QR codes for Japanese market

**Alternatives Considered**:
- react-native-camera: More complex setup
- Manual entry: Fallback for scanning failures

### 10. Push Notifications
**Decision**: expo-notifications
**Rationale**:
- Unified API for iOS and Android
- Rich notification support
- Background fetch capabilities
- Integration with Expo's notification service

**Alternatives Considered**:
- react-native-push-notification: More complex setup
- Platform-specific APIs: Higher maintenance overhead

## Performance Considerations

### Mobile Performance Budget
- **First Paint**: <2.5 seconds
- **Interaction Response**: <100ms
- **Frame Rate**: >55 FPS
- **Bundle Size**: <50MB initial download

### Optimization Strategies
- List virtualization with FlashList
- Image optimization with CDN and caching
- Code splitting for feature modules
- Lazy loading of non-critical components
- Background updates with React Query

## Security and Compliance

### APPI Compliance
- Minimal data collection with explicit consent
- Secure storage in SecureStore for personal data
- Data export and deletion capabilities
- Privacy policy integration in onboarding

### Affiliate Tracking
- Transparent affiliate link disclosure
- Privacy-compliant attribution tracking
- User consent for tracking preferences

## Multi-Platform Integration Strategy

### E-commerce Platform APIs
- **Priority 1**: Amazon Product Advertising API
- **Priority 2**: Rakuten API (Japanese market focus)
- **Priority 3**: Yahoo Shopping API
- **Priority 4**: Kakaku.com API (price comparison specialist)
- **Priority 5**: Mercari API (C2C marketplace)

### Rate Limiting and Caching
- Implement rate limiting to respect API quotas
- Aggressive caching strategies for price data
- Background refresh for outdated information
- Fallback data for offline scenarios

## Development and Deployment

### CI/CD Pipeline
- EAS Build for automated builds
- Preview builds for PR testing
- Automated testing pipeline
- Code signing and distribution management

### Environment Management
- Development, staging, production configurations
- Environment-specific API endpoints
- Feature flags for gradual rollout
- A/B testing framework integration

---

**Research Complete**: All technical decisions documented and justified. Ready for Phase 1 design and contracts generation.