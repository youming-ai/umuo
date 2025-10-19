# Implementation Plan: Japanese Price Comparison App

**Branch**: `001-prd-app-only` | **Date**: 2025-10-10 | **Spec**: `/specs/001-prd-app-only/spec.md`
**Input**: Feature specification from `/specs/001-prd-app-only/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary
Japanese price comparison mobile app using React Native/Expo with TypeScript. The app will provide cross-platform e-commerce price comparisons (Amazon, Rakuten, Yahoo Shopping, Kakaku, Mercari), AI-powered review summaries, price history tracking, alert notifications, barcode scanning, and community features. Technical approach emphasizes mobile-first development with offline capabilities, multi-language support (Japanese/English/Chinese), and compliance with Japanese privacy regulations (APPI).

## Technical Context
**Language/Version**: TypeScript (strict mode) with React Native/Expo
**Primary Dependencies**: Expo (Managed Workflow), Expo Router, React Query, Zustand, NativeWind, expo-barcode-scanner, expo-notifications, @lingui/react
**Storage**: MMKV for KV caching, SQLite (expo-sqlite) for offline price history/watchlists, SecureStore for auth tokens
**Testing**: Jest + @testing-library/react-native (≥70% coverage), MSW for integration testing
**Target Platform**: iOS & Android mobile apps (app-only approach)
**Project Type**: Mobile app + API backend
**Performance Goals**: First screen <2.5s, interactions <100ms, FPS >55, API responses <300ms p95
**Constraints**: APPI compliance, Japanese market localization, offline-first design, affiliate tracking
**Scale/Scope**: 50k users in 6 months, 10k DAU, multi-platform e-commerce integration

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Mobile-First Experience (Principle I)
- [x] Design prioritizes mobile UX over desktop/web (React Native/Expo mobile-first)
- [x] Mobile constraints drive architectural decisions (app-only approach)
- [x] Feature design starts with "how would this feel on a phone?" (touch interface, small screen)

### Price Data Accuracy & Freshness (Principle II)
- [x] API response times under 300ms (p95) for price comparisons (explicit requirement)
- [x] Data freshness requirements clearly defined (< 1 hour old from FR-002a)
- [x] Cached data includes clear timestamp indicators (offline mode support)
- [x] Failure handling for data freshness issues documented (EC-004, EC-012)

### Japanese Market Compliance (Principle III)
- [x] Compliance with Japanese e-commerce regulations documented (Japanese platforms only)
- [x] External API terms of service reviewed and respected (Amazon, Rakuten, Yahoo, Kakaku, Mercari)
- [x] Comprehensive APPI compliance implemented (10 specific requirements FR-017 to FR-026)
- [x] Consent management and audit logging designed (User Consent, Consent Audit Log entities)
- [x] Data export/deletion procedures defined (Data Export Request, Data Deletion Request entities)
- [x] Cross-border data transfer controls and breach notification procedures documented
- [x] Japanese localization requirements included (Japanese/English/Chinese support)

### Offline-First Architecture (Principle IV)
- [x] Essential data caching strategy defined (MMKV + SQLite combo)
- [x] Offline functionality clearly specified (EC-010, EC-011)
- [x] Background sync approach battery-conscious (intelligent sync design)
- [x] Local data storage requirements documented (SQLite for watchlists/history)

### Test-Driven Development (Principle V)
- [x] TDD approach mandated for critical functionality (Jest + React Native Testing Library)
- [x] Integration test requirements for external APIs defined (MSW for API mocking)
- [x] Test coverage requirements for price logic, barcode scanning, notifications specified (≥70% coverage)

## Project Structure

### Documentation (this feature)
```
specs/001-prd-app-only/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── api-integration-tests.md # Phase 1.5 output (detailed API testing)
├── performance-benchmarks.md # Phase 1.5 output (performance targets)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── api.yaml         # OpenAPI specification
│   └── schemas/         # JSON schemas for API contracts
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
```
apps/mobile/
├── app/                      # expo-router file-based routing
│   ├── (tabs)/               # Tab navigation screens
│   │   ├── index.tsx         # Home: discovery and recommendations
│   │   ├── compare.tsx       # Price comparison screen
│   │   ├── deals.tsx         # Deals and promotions
│   │   ├── alerts.tsx        # User alerts and notifications
│   │   └── profile.tsx       # User profile and settings
│   ├── product/[spuId].tsx   # Product detail screen
│   ├── search.tsx            # Search results screen
│   ├── scan.tsx              # Barcode scanning screen
│   └── _layout.tsx           # Root layout with providers
├── src/
│   ├── api/                  # API client layer with Axios interceptors
│   ├── services/             # Business logic services (combine API + storage + AI)
│   ├── features/             # Feature modules (compare, deals, alerts, etc.)
│   ├── components/           # Reusable UI components
│   ├── hooks/                # Custom React hooks (usePriceHistory, useDeals)
│   ├── store/                # Zustand stores (session, preferences, subscriptions)
│   ├── i18n/                 # Lingui internationalization resources
│   ├── utils/                # Utility functions (formatting, analytics, time, currency)
│   ├── theme/                # Theme configuration and NativeWind styles
│   └── types/                # TypeScript type definitions (DTOs, entities)
├── assets/                   # Icons, illustrations, fonts
├── tests/                    # Unit, component, and E2E tests
├── app.config.ts             # Expo configuration for multiple environments
└── package.json

api/                          # Backend API (separate service)
├── src/
│   ├── routes/               # API endpoint handlers
│   ├── services/             # Business logic
│   ├── models/               # Data structures
│   └── tests/                # Test files
└── package.json
```

**Structure Decision**: Mobile-first architecture with separate API backend. The `apps/mobile` directory contains the Expo React Native app using conventional structure. The `api` directory contains the backend service. This structure follows mobile development best practices while maintaining clear separation between frontend and backend concerns.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - ✅ All technical decisions provided in user input
   - ✅ Expo ecosystem dependencies clearly specified
   - ✅ Performance targets and constraints defined
   - ✅ Multi-platform e-commerce integration requirements documented

2. **Generate and dispatch research agents**:
   ```
   Research completed - all technical decisions provided in user input:
   - Expo vs React Native CLI: Expo Managed Workflow selected
   - State management: Zustand chosen over Redux
   - Navigation: Expo Router file-based routing
   - Testing strategy: Jest + React Native Testing Library + MSW
   - Localization: Lingui for Japanese/English/Chinese support
   - API integration: React Query with Axios
   - Offline storage: MMKV + SQLite combination
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: ✅ research.md with all technical decisions documented
**✅ COMPLETED**: Phase 0 research complete - all technical decisions justified

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST patterns
   - Output OpenAPI schema to `/contracts/api.yaml`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Create detailed API integration test specifications**:
   - Platform-specific test cases (Amazon, Rakuten, Yahoo, Kakaku, Mercari)
   - Cross-platform consistency tests
   - Performance and error handling tests
   - Output to `api-integration-tests.md`

6. **Define comprehensive performance benchmarks**:
   - Mobile app performance targets (startup, interaction, memory)
   - API performance targets (response times, caching, scalability)
   - User experience metrics (interaction response, visual stability)
   - Output to `performance-benchmarks.md`

7. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh claude`
   - Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: ✅ data-model.md, /contracts/api.yaml, quickstart.md, api-integration-tests.md, performance-benchmarks.md, agent-specific file
**✅ COMPLETED**: Phase 1 design complete - all contracts, models, API tests, and performance benchmarks generated

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P]
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:
- TDD order: Tests before implementation
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 35-40 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)
**Phase 4**: Implementation (execute tasks.md following constitutional principles)
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Constitution violations requiring justification*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Mobile toolchain vs Bun runtime | Mobile app development requires platform-specific tools (Expo CLI, React Native) | Bun runtime cannot compile to iOS/Android native code - mobile development requires different toolchain |
| Separate API service | Mobile app needs dedicated backend for e-commerce API integrations | Embedding business logic in mobile app would increase complexity and limit cross-platform consistency |

## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS (with documented mobile toolchain justification)
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented

---
*Based on Constitution v1.0.0 - See `/memory/constitution.md`*
