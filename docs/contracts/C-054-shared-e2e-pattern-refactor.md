# Metadata
| Field | Value |
| --- | --- |
| Source | shared |
| Target | apps/e2e |
| Priority | P0 |
| Dependencies | C-052 |
| Status | not_started |
| Contract Version | 1.0.0 |

# Overview
This contract refactors the recently consolidated `apps/e2e` package to utilize enterprise-grade Playwright abstraction patterns. Migrated E2E E2E tests currently rely on raw locators and repetitive login flows. This refactor implements Authentication State Caching, Page Object Models (POM), Custom Fixtures, and Emulator Helpers to drastically reduce E2E execution time, eliminate E2E flakiness, and improve E2E maintainability across the Client and Game testing domains.

# Design Reference
- Playwright Project Dependencies (for E2E auth caching).
- SvelteKit testing abstractions.
- Custom E2E `test.extend` fixtures.

# Architecture Directives
- **Authentication Caching**: Implement an `auth.setup.ts` script executed by a dedicated Playwright setup project. This script must authenticate a test user against the local Firebase emulator once per test run, serialize the session state (cookies/IndexedDB), and save it to an `.auth/` directory. All downstream E2E projects must depend on this setup phase.
- **Page Object Models (POM)**: Abstract all E2E UI locators and interaction logic out of the `.spec.ts` files into a dedicated `src/pom/` directory. Create logical E2E classes (e.g., `ClientAuthPage`, `GameCanvas`) that expose business-intent methods like `login()` or `verifyRender()`. E2E tests must only assert against these abstracted methods.
- **Custom E2E Fixtures**: Implement a `src/fixtures.ts` file extending Playwright's base test object. This must automatically instantiate and inject the new E2E POMs (and the pre-authenticated context) into the E2E test blocks, completely eliminating `new ClientAuthPage(page)` boilerplate from the E2E suites.
- **Emulator Interaction Helpers**: Create a `src/emulator_helper.ts` utility to handle administrative interactions with the local backend (e.g., purging Firestore or Auth data via REST API).

# State & Data Models
The E2E framework will rely on a strictly typed custom fixture payload:

    type E2EFixtures = {
        authUser: import('@playwright/test').Page; // Pre-hydrated E2E session
        guestUser: import('@playwright/test').Page; // Pristine E2E session
        client: ClientPageModels; // E2E POM factory
        game: GamePageModels; // E2E POM factory
    };

# Acceptance Criteria
### AC-1: Playwright E2E Setup Dependency
- Given the unified Playwright configuration
- When the E2E test suite initializes
- Then a dedicated setup project must run first, authenticate a test identity, and successfully write the session state to `.auth/user.json`.
- Test Hook: Verify E2E suites targeting the Client dashboard can navigate directly to protected routes without manually filling in E2E login forms.

### AC-2: Custom E2E Fixtures and POM Injection
- Given a newly executing E2E test block
- When the E2E test destructures the provided arguments
- Then it must receive fully initialized E2E POM instances and the appropriately scoped E2E browser context (authenticated vs. unauthenticated).
- Test Hook: Refactor at least one Client E2E test and one Game E2E test to successfully execute using the new custom E2E fixtures.

### AC-3: Centralized E2E State Purging
- Given the `apps/e2e` global E2E test lifecycle
- When a major E2E suite completes
- Then the framework must invoke the new `emulator_helper.ts` utilities to hit the Firebase Emulator REST endpoints and purge E2E database state.
- Test Hook: Ensure E2E database records generated during test execution do not persist after the E2E suite tear-down phase.

# Implementation Notes
1. Create the `apps/e2e/src/` directory to house `auth.setup.ts`, `fixtures.ts`, and `emulator_helper.ts`.
2. Create the `apps/e2e/src/pom/` directory and begin abstracting the raw locators from the 12 migrated E2E tests into E2E class models.
3. Update `playwright.config.ts` to include the `setup` project and define the `.auth` storage state paths. Add `.auth` to `.gitignore`.
4. Refactor the existing `.spec.ts` files in the Client and Game E2E folders to utilize the new E2E fixtures and POMs.
5. Ensure ESM and CommonJS interoperability when importing Firebase Admin SDKs within the E2E Playwright Node environment.

# Edge Cases & Gotchas
- **SvelteKit E2E Hydration**: When building Client POMs, implement a deterministic E2E wait strategy (e.g., waiting for an `onMount` data attribute on the HTML tag) rather than arbitrary timeouts to prevent interactions with unhydrated E2E components.
- **Firebase Auth E2E Emulators**: If the Client utilizes Firebase Auth via IndexedDB, the `auth.setup.ts` script must explicitly inject the serialized auth tokens into the E2E browser's IndexedDB context, as standard E2E cookie persistence will not capture client-side Firebase Auth states.
