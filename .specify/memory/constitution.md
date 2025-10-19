<!--
Sync Impact Report:
Version change: No change required - Constitution remains at version 1.1.0
Modified principles: None - All principles remain current and relevant
Added sections: None - Constitution already includes all necessary sections
Removed sections: None - All sections remain applicable
Templates requiring updates: ✅ All templates already aligned with constitution
- ✅ .specify/templates/plan-template.md (Constitution Check section already aligned with APPI requirements and mobile-first principles)
- ✅ .specify/templates/spec-template.md (APPI compliance requirements and performance standards already included)
- ✅ .specify/templates/tasks-template.md (TDD and offline-first tasks already included)
- ✅ .claude/commands/*.md (No outdated references found - all commands use generic agent guidance)
- ✅ specs/001-prd-app-only/spec.md (APPI requirements and performance metrics match updated constitution)
Files verified for alignment:
- ✅ README.md (Project documentation reflects constitutional principles)
- ✅ package.json (Dependencies support constitutional requirements)
- ✅ tsconfig.json (TypeScript strict mode supports TDD principles)
Follow-up TODOs: None - Constitution is current and complete
Validation completed: No placeholder tokens remain, all dates in ISO format, principles are declarative and testable
-->

# Yabaii Constitution
<!-- Japanese Price Comparison App -->

## Core Principles

### I. Mobile-First Experience
Every feature MUST prioritize mobile user experience above all else. The app is the primary interface, not the API. All design decisions start with "how would this feel on a phone?" Mobile constraints drive the architecture, not the other way around.

### II. Price Data Accuracy & Freshness
Price data is the core value proposition. All price information MUST be no older than 1 hour from search time. API responses MUST be delivered within 300ms (p95). Cached data MUST be clearly timestamped. Freshness failures MUST be communicated transparently to users.

### III. Japanese Market Compliance (APPI-Centric)
All features MUST comply with Japanese e-commerce regulations and consumer protection laws. External API integrations MUST respect platform terms of service. User data handling MUST strictly follow Japan's Act on the Protection of Personal Information (APPI) with granular consent management, data minimization, purpose limitation, and comprehensive audit logging. Multi-language support MUST include proper Japanese localization. Age verification and parental consent MUST be implemented for users under 20 years old.

### IV. Offline-First Architecture
The app MUST remain functional without network connectivity. Essential data (watchlists, price history, product details) MUST be cached locally. Users MUST be able to access saved information with clear "Last Updated" timestamps. Background sync MUST be intelligent and battery-conscious.

### V. Test-Driven Development (NON-NEGOTIABLE)
TDD is mandatory for all critical functionality. Tests MUST be written first, verified to fail, then implementation follows. Price comparison logic, barcode scanning, and notification systems require comprehensive test coverage. Integration tests MUST validate external API contracts.

## Performance Standards

### API Response Requirements
- **Price Comparison API**: MUST respond within 300ms (p95)
- **Barcode Lookup**: MUST complete within 2 seconds
- **Search Results**: MUST display within 500ms
- **Batch Price Refresh**: MUST handle up to 10 products simultaneously within 2 seconds

### Mobile Performance Requirements
- **App Startup**: MUST complete within 2.5 seconds
- **Screen Navigation**: MUST transition within 500ms
- **Memory Usage**: MUST stay under 200MB during normal operation
- **Battery Impact**: Background operations MUST minimize battery drain

## Security & Privacy

### APPI-Specific Data Protection
- User accounts MUST use JWT tokens with secure expiration
- Personal data MUST be encrypted at rest and in transit with AES-256 encryption
- Location data (if collected) MUST require explicit granular consent
- All external API keys MUST be stored securely and never exposed in client code
- Granular consent MUST be obtained for each category of personal data during onboarding
- Consent management dashboard MUST allow users to review and modify consent settings at any time
- Complete audit logs MUST be maintained for all consent changes and data processing activities
- Data minimization principles MUST be implemented, collecting only necessary data
- Cross-border data transfers MUST require explicit consent and contractual safeguards
- Data breach notifications MUST follow 30-day PPC notification requirement

### Privacy by Design
- Data collection MUST be limited to what's necessary for specified purposes
- Users MUST have clear data deletion within 30 days and export options in machine-readable format
- Analytics and tracking MUST be opt-in with transparent disclosures
- Third-party integrations MUST be reviewed for privacy compliance
- User data MUST be retained for 1 year after last activity, then deletion warnings provided
- Age verification MUST be implemented for users under 20 years old with parental consent

## Governance

This constitution supersedes all other development practices and guidelines. All code changes, feature implementations, and architectural decisions MUST align with these principles.

### Amendment Process
- Proposals for amendments MUST be documented with clear reasoning
- Changes affecting core principles require majority approval from maintainers
- All amendments MUST increment version according to semantic versioning
- Previous versions MUST be archived for reference

### Compliance Review
- Every pull request MUST verify compliance with relevant principles
- Code reviews MUST check for constitutional violations
- Performance tests MUST validate against defined standards
- Security audits MUST verify APPI compliance and data protection requirements
- APPI compliance reviews MUST validate consent management, data minimization, and audit logging
- Cross-border data transfers MUST be documented with appropriate safeguards
- Data retention policies MUST be enforced with automated deletion procedures

**Version**: 1.1.0 | **Ratified**: 2025-10-09 | **Last Amended**: 2025-10-17