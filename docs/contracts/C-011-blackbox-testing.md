## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami blackbox test runner — `architecture/blackbox-test-runner.md`, `contracts/pwa-admin-ai--llm-provider-management.md` |
| **Target** | `/aikami/tests/blackbox/` + test infrastructure |
| **Priority** | P2 — Important for regression safety but not blocking initial refactor |
| **Dependencies** | C-007 (scripts project), C-009 (standardized configs) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Establish a blackbox (end-to-end) testing infrastructure for aikami. Currently aikami uses Playwright for the PWA, but there's no structured blackbox test runner with fixtures, reporting, and CI integration. Follow the aikami pattern of a universal blackbox test runner that can test the full stack (Firebase emulators + PWA + API routes).

## Design Reference

**Aikami blackbox test architecture**:
- Tests live alongside code or in a dedicated `tests/` directory
- Playwright for browser-based tests
- Firebase emulators for backend integration tests
- Test fixtures for common setup (auth, data seeding)
- CI integration via GitHub Actions
- Visual regression testing with Playwright screenshots

## Infrastructure

```
tests/
├── blackbox/
│   ├── playwright.config.ts    # Playwright configuration
│   ├── fixtures/
│   │   ├── auth.fixture.ts     # Authentication helpers
│   │   ├── db.fixture.ts       # Database seeding/cleanup
│   │   └── api.fixture.ts      # API route test helpers
│   ├── specs/
│   │   ├── auth/               # Auth flow tests
│   │   ├── pwa/                # PWA-specific tests
│   │   └── api/                # API route tests
│   ├── helpers/
│   │   ├── emulator.ts         # Firebase emulator management
│   │   └── utils.ts            # Test utilities
│   └── visual/
│       ├── screenshots/        # Baseline screenshots
│       └── visual.config.ts    # Visual regression config
├── unit/                       # Unit tests (co-located or here)
└── integration/                # Integration tests
```

## Test Runner Script

Create `scripts/src/lib/test_runner.ts`:
- Start Firebase emulators
- Run Playwright tests
- Generate reports
- Stop emulators
- Exit with appropriate code

## Acceptance Criteria

### AC-1: Blackbox Test Directory Created
**Given** aikami has no structured test directory
**When** this contract is implemented
**Then** `tests/blackbox/` exists with playwright.config.ts and fixtures/ directory

**Test Hooks**:
- Unit: `test -f tests/blackbox/playwright.config.ts`
- Unit: `test -d tests/blackbox/fixtures`

### AC-2: Playwright Configuration
**Given** the PWA needs browser testing
**When** playwright.config.ts is configured
**Then** it targets the local dev server, supports Firefox and Chromium, and has screenshot-on-failure

**Test Hooks**:
- Unit: `playwright.config.ts` configures `webServer` to start the PWA dev server
- Unit: `playwright.config.ts` includes `screenshot: 'only-on-failure'`

### AC-3: Auth Fixture
**Given** the PWA requires Firebase authentication
**When** tests need an authenticated user
**Then** auth.fixture.ts provides helper to create/sign-in test users

**Test Hooks**:
- Unit: `auth.fixture.ts` exports `createTestUser()` and `signInTestUser()`
- Integration: A test using the auth fixture can sign in and access authenticated routes

### AC-4: Test Runner Script
**Given** the test infrastructure
**When** running `bun run scripts/src/lib/test_runner.ts`
**Then** Firebase emulators start, Playwright tests run, and emulators stop

**Test Hooks**:
- Integration: Script exits with code 0 when all tests pass
- Integration: Script exits with non-zero when tests fail
- Integration: Emulators are stopped even if tests fail (cleanup)

### AC-5: CI Integration Ready
**Given** the test runner
**When** run in CI (non-interactive)
**Then** it skips interactive prompts and uses CI-compatible config

**Test Hooks**:
- Unit: `CI=true bun run scripts/src/lib/test_runner.ts` runs without prompts
- Unit: Test results are output in JUnit or JSON format for CI parsing

### AC-6: Visual Regression (Stretch)
**Given** Playwright screenshot capabilities
**When** visual tests are configured
**Then** baseline screenshots are stored and compared against

**Test Hooks**:
- Unit: `tests/blackbox/visual/screenshots/` contains baseline images
- Unit: Visual tests detect pixel differences above threshold

## Implementation Notes

1. **Reuse existing Playwright setup**: Aikami's PWA already has Playwright — extend rather than replacing
2. **Firebase emulator config**: Add `firebase.json` emulator configuration if not already present
3. **Test runner script**: Place in `scripts/src/lib/test_runner.ts`, add `"test:blackbox"` to root package.json
4. **Fixtures as Playwright fixtures**: Use Playwright's built-in fixture system, not custom abstractions
5. **Database seeding**: Use Firebase Admin SDK to seed Firestore before tests, clean up after
6. **CI workflow**: Add a `.github/workflows/blackbox-tests.yml` (or add to existing CI)
7. **Visual regression**: Start simple — screenshot comparison with 1% threshold, expand later

## Edge Cases & Gotchas

- **Emulator ports**: Ensure emulator ports don't conflict with dev server ports
- **Test isolation**: Each test file should clean up its data — use unique prefixes or separate collections
- **CI speed**: Full blackbox suite may be slow — add `--only-changed` flag for affected tests
- **Firebase auth emulator**: May not support all auth providers — document known limitations
- **Screenshot flakiness**: Visual tests are brittle — use high tolerance initially, tighten over time
