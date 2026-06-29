# Metadata
| Field | Value |
| --- | --- |
| Source | shared |
| Target | apps/e2e, apps/frontend/client, apps/frontend/game |
| Priority | P0 |
| Dependencies | C-054 |
| Status | not_started |
| Contract Version | 1.0.0 |

# Overview
This contract resolves the technical debt incurred during the E2E Page Object Model (POM) refactor. Currently, 36 E2E tests are failing due to content-level assertion mismatches and outdated locators within the POM abstractions. The objective is to audit the failing tests, align the POM locators with the actual DOM structure of the Aikami frontend applications, and achieve a 100% pass rate across the E2E suite.

# Design Reference
- Playwright Best Practices for Semantic Locators (`getByRole`, `getByText`, `getByTestId`).
- The existing SvelteKit components in `apps/frontend/client/src/lib/components/` and `apps/frontend/client/src/lib/views/`.

# Architecture Directives
- **Locator Alignment**: Update the locators inside `apps/e2e/src/pom/*.ts`. Do not rewrite the test logic in the `.spec.ts` files unless absolutely necessary. The POM is the source of truth for DOM interaction.
- **Semantic Priority**: Eradicate brittle CSS selectors (e.g., `.chat-box > div:nth-child(2)`) in favor of Playwright's auto-waiting semantic locators (e.g., `page.getByRole('button', { name: 'Submit' })`).
- **Missing Test IDs**: If a semantic locator is impossible due to complex headless UI (e.g., custom dropdowns), inject a `data-testid` directly into the target Svelte component in the frontend package rather than writing a brittle XPath locator in the E2E package.
- **Hydration Safety**: Ensure that POM initialization methods (e.g., `goto()`) strictly await the SvelteKit hydration signal (`data-hydrated="true"`) to prevent premature test execution.

# State & Data Models
No new data models are introduced.

# Acceptance Criteria
### AC-1: Client Authentication Flow Integrity
- Given the unified E2E runner
- When executing the Client authentication test suite
- Then the POM must successfully locate the login/register forms, inputs, and submit buttons, resulting in successful test passes.
- Test Hook: `moon run e2e:test -- -g "auth"` (or equivalent grep) passes.

### AC-2: Client Chat & Dashboard Integrity
- Given the unified E2E runner
- When executing the Client chat capabilities suite
- Then the POM must correctly identify streaming state changes, message bubbles, and virtualized list nodes.
- Test Hook: `moon run e2e:test -- -g "chat"` passes.

### AC-3: Game Interface Integrity
- Given the unified E2E runner
- When executing the Game E2E suite
- Then the `GameMenuPage` or related POMs must accurately target the canvas container and overlay UI elements.
- Test Hook: `moon run e2e:test -- -g "game"` passes.

### AC-4: Absolute Baseline
- Given the complete E2E workspace
- When executing the entire suite
- Then the runner must report zero failures.
- Test Hook: `moon run e2e:test` returns a 100% pass rate.

# Implementation Notes
1. Run `moon run e2e:test` to generate a fresh failure report.
2. Group the failures by domain (e.g., Auth, Chat, Game).
3. For a failing test, identify the POM method throwing the timeout or mismatch.
4. Inspect the corresponding `.svelte` file in `apps/frontend/client` or `apps/frontend/game` to find the correct class, text, or ARIA role.
5. Update the POM method with the correct Playwright locator.
6. Re-run the specific test file. Repeat until the entire suite is green.

# Edge Cases & Gotchas
- **i18n Translation Mismatches**: If your E2E tests are asserting literal text like "Welcome back", but the SvelteKit app uses Paraglide/i18n and defaults to a different locale (or key), the test will fail. Prefer `getByRole` with a generic fallback, or ensure the E2E setup forces a specific `LANG` cookie.
- **Animation Delays**: If a sidebar slides in, Playwright might click the button before the animation finishes, causing a mis-click. Ensure action locators wait for stability or use `waitFor({ state: 'visible' })` on the target container.
