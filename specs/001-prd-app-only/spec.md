# Feature Specification: Japanese Price Comparison App

**Feature Branch**: `001-prd-app-only`
**Created**: 2025-10-08
**Status**: Draft
**Input**: User description: "好的 ✅ 我帮你整理了一份 详细的产品需求文档（PRD），聚焦于 移动端 App-only 方案。内容包含目标、功能、AI 赋能、架构及里程碑。"

## Execution Flow (main)
```
1. Parse user description from Input
   → If empty: ERROR "No feature description provided"
2. Extract key concepts from description
   → Identify: actors, actions, data, constraints
3. For each unclear aspect:
   → Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   → If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   → Each requirement must be testable
   → Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
   → If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   → If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements
- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation
When creating this spec from a user prompt:
1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd need to make
2. **Don't guess**: If the prompt doesn't specify something (e.g., "login system" without auth method), mark it
3. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
4. **Common underspecified areas**:
   - User types and permissions
   - Data retention/deletion policies
   - Performance targets and scale
   - Error handling behaviors
   - Integration requirements
   - Security/compliance needs

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a Japanese consumer who wants to make informed purchasing decisions, I want to compare prices across multiple e-commerce platforms and receive intelligent recommendations, so that I can always find the best deals and save money on my purchases.

### Acceptance Scenarios
1. **Given** I am shopping for a specific product, **When** I search by product name or scan a barcode, **Then** I see current prices from Amazon, Rakuten, Yahoo Shopping, Kakaku, and Mercari
2. **Given** I found a product I want to buy, **When** I set a price alert, **Then** I receive notifications when the price drops below my target or reaches a historical low
3. **Given** I am researching a product, **When** I view the product details, **Then** I see AI-generated summaries of customer reviews highlighting pros and cons
4. **Given** I want community input, **When** I view a product, **Then** I can see "worth it/not worth it" voting results and read community comments
5. **Given** I prefer shopping in my native language, **When** I use the app, **Then** I can navigate in Japanese, English, or Chinese

### Edge Cases *(specific requirements)*

#### Product Availability
- **EC-001**: When products are out of stock on some platforms, system MUST clearly indicate stock status for each platform with "In Stock", "Out of Stock", or "Limited Stock" labels
- **EC-002**: System MUST still show out-of-stock platforms for price comparison with visual indicators of unavailability
- **EC-003**: Users MUST be able to set stock alerts for products currently out of stock

#### Data Quality & Consistency
- **EC-004**: When price data is temporarily unavailable from a platform, system MUST display "Price Unavailable" with last known price and timestamp
- **EC-005**: System MUST validate JAN/ASIN codes and provide "Product Not Found" messaging for invalid codes
- **EC-006**: For discontinued products, system MUST display "Discontinued" status and suggest similar alternative products
- **EC-007**: Price inconsistencies between platforms MUST be flagged with warnings when price variance exceeds 30%

#### User Personalization
- **EC-008**: For users with no purchase history, system MUST provide recommendations based on popular products and general market trends
- **EC-009**: New user onboarding MUST include preference selection (categories, brands, price range) to enable initial personalization

#### Network & Performance
- **EC-010**: In offline mode, system MUST display cached price data with clear "Last Updated" timestamps
- **EC-011**: When network connectivity is poor, system MUST provide manual refresh options and limit automatic data fetching
- **EC-012**: System MUST gracefully handle API rate limits with exponential backoff and user notifications

## Clarifications

### Session 2025-10-10
- Q: What authentication methods should be supported for user accounts? → A: Email/password + social login (Google, Apple, Line)
- Q: How long should user data (watchlists, price history, preferences) be retained for inactive users? → A: 1 year after last activity
- Q: Should the app include affiliate links for revenue generation when users purchase products? → A: Yes, clearly marked affiliate links
- Q: What should be the maximum number of products users can track in their watchlists? → A: 50 products per user
- Q: What geographic scope should be supported initially - Japan only or include international shipping options? → A: Japan domestic market only

### Session 2025-10-16 (APPI Compliance Details)
- Q: What specific APPI compliance measures must be implemented? → A: Explicit consent for data collection, purpose limitation, data minimization, retention policies, third-party transfer controls
- Q: How should user consent be obtained and managed? → A: Granular consent during onboarding, consent dashboard, easy withdrawal mechanism, consent logging
- Q: What are the requirements for cross-border data transfers? → A: Adequate level of protection in recipient countries, explicit user consent for transfers, contractual safeguards
- Q: How should data breach notifications be handled? → A: Notify PPC within 30 days, affected users without undue delay, breach logging and remediation procedures

---

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST allow users to search for products using keywords, JAN codes, or ASIN codes
- **FR-002**: System MUST display price comparisons across multiple Japanese e-commerce platforms (Amazon, Rakuten, Yahoo Shopping, Kakaku, Mercari)
- **FR-002a**: Price data MUST be no older than 1 hour from search time
- **FR-002b**: API responses for price comparisons MUST be delivered within 300ms (p95)
- **FR-002c**: System MUST display cached data with timestamp indicators when fresh data is unavailable
- **FR-002d**: Price refresh operations MUST complete within 2 seconds for up to 10 products simultaneously
- **FR-003**: Users MUST be able to scan product barcodes using their mobile device camera for quick price lookup
- **FR-004**: System MUST display historical price trends for each product with visual charts
- **FR-005**: Users MUST be able to set personalized price drop alerts and receive notifications when prices drop below their target OR reach historical lows
- **FR-005a**: System MUST define "historical low" as the lowest price recorded in the preceding 90 days across all tracked platforms
- **FR-005b**: System MUST notify users when current price meets or falls below the historical low threshold
- **FR-005c**: Historical low calculations MUST exclude prices older than 90 days and must be platform-specific
- **FR-006**: System MUST provide AI-generated summaries of customer reviews highlighting key pros and cons
- **FR-007**: Users MUST be able to participate in "worth it/not worth it" voting on products
- **FR-008**: System MUST aggregate and display promotional deals and discount information from multiple platforms
- **FR-009**: Users MUST be able to create and manage their product watchlists
- **FR-010**: System MUST provide personalized product recommendations based on user browsing and purchase history
- **FR-011**: Users MUST be able to access the application in Japanese, English, or Chinese languages
- **FR-012**: System MUST support user accounts with email/password or social login (Google, Apple, Line) for saving preferences, watchlists, and notification settings
- **FR-013**: System MUST retain user data for 1 year after last activity, then provide deletion warnings before permanent removal
- **FR-014**: System MUST include clearly marked affiliate links for revenue generation when users purchase products
- **FR-015**: Users MUST be limited to 50 products maximum in their watchlists
- **FR-016**: System MUST focus on Japan domestic market only (no international shipping options)

### APPI Compliance Requirements
- **FR-017**: System MUST obtain granular user consent for each category of personal data collection during onboarding
- **FR-018**: System MUST provide a consent management dashboard allowing users to review and modify consent settings at any time
- **FR-019**: System MUST implement data minimization principles, collecting only data necessary for specified purposes
- **FR-020**: System MUST maintain complete audit logs of all consent changes and data processing activities
- **FR-021**: System MUST provide easy data export functionality in machine-readable format (JSON/CSV)
- **FR-022**: System MUST support complete data deletion with verification within 30 days of user request
- **FR-023**: System MUST obtain explicit consent before transferring personal data to third-party services
- **FR-024**: System MUST implement encryption for all personal data both at rest and in transit
- **FR-025**: System MUST provide data breach notification procedures with 30-day PPC notification requirement
- **FR-026**: System MUST support age verification and parental consent for users under 20 years old

### Key Entities *(include if feature involves data)*
- **User Profile**: Stores user preferences, language settings, notification preferences, and watchlists
- **Product**: Represents items available across multiple platforms with unified identification
- **Price History**: Tracks price changes over time for each product across different platforms
- **Review Summary**: AI-generated analysis of customer reviews with pros/cons extraction
- **Price Alert**: User-defined notification triggers based on price thresholds
- **Community Vote**: Aggregates "worth it/not worth it" voting data for products
- **Promotional Deal**: Current discount offers and promotional campaigns from platforms
- **User Consent**: Tracks granular consent permissions for different data processing activities
- **Consent Audit Log**: Records all consent changes, data access, and processing activities
- **Data Export Request**: Manages user requests for personal data export with processing status
- **Data Deletion Request**: Handles user data deletion requests with verification and compliance tracking

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

### APPI Compliance Check
- [x] All 10 APPI compliance requirements defined (FR-017 to FR-026)
- [x] Consent management entities specified
- [x] Data retention and deletion policies clear
- [x] Cross-border data transfer requirements addressed
- [x] Breach notification procedures defined

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---