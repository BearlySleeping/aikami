---
name: testing
description: Aikami testing conventions — Playwright E2E, AI Visual Testing Framework, debugging workflow, test creation patterns, and commit policy.
---

# Testing

Complete guide to testing in the Aikami monorepo. Covers the two testing systems (AI Visual Runner + Playwright), debugging workflow, and test creation patterns.

## Architecture: Two Systems

**Do NOT mix these.** They serve different purposes and use different runtimes:

| System | Runtime | Purpose | Location | Command |
|--------|---------|---------|----------|---------|
| **AI Visual Runner** | Bun | Screenshot capture + AI evaluation | `apps/e2e/src/visual/` | `cd apps/e2e && bun run test:visual` |
| **Playwright** | Node.js | Behavioral/functional E2E | `apps/e2e/tests/` | `cd apps/e2e && bun run test` |

**Rule**: Playwright has `setup` and `client` projects. No `client-visual`. Game tests now run within the client project.
Visual tests live in `suites/*.visual.ts`, not `tests/*.visual.spec.ts`.

---

## Bun Unit Tests (Client)

Client-side unit tests use Bun's test runner with a required preload script.

### 🔴 Critical: Always Use `--preload`

Every client unit test depends on `src/lib/test_preload.ts` which provides:

| What | Why |
|------|-----|
| Svelte 5 rune polyfills (`$state`, `$derived`, `$effect`) | `.svelte.ts` files won't parse without them |
| `@aikami/frontend/services` mock | `BaseFrontendClass`, `BaseViewModel`, `dialogService`, etc. |
| `$services` barrel mock | All ViewModels import from `$services` |
| `$app/navigation`, `$app/state` mocks | SvelteKit virtual modules required by transitive deps |
| `indexedDB` polyfill | Required by `DraftStore` in test env |
| `window`, `AudioContext`, `KeyboardEvent` polyfills | Browser APIs not available in Bun |
| Vite env vars (`PUBLIC_*`) | Required by `@aikami/frontend/configs/environment.ts` |

**Without `--preload`, tests fail with `Cannot find module` or `undefined is not an object` errors.**

### Running Client Unit Tests

```bash
# ✅ Correct — always include --preload
cd apps/frontend/client && bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json src/lib

# ✅ Single file
cd apps/frontend/client && bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json src/lib/services/game/game_composition_root.test.ts

# ✅ Via moon (uses the script from package.json)
bun moon run client:test

# ❌ WRONG — missing --preload, tests will fail
bun test src/lib/services/game/game_composition_root.test.ts
```

The `client:test` moon task already includes `--preload` — prefer it for running all tests.

### 🔴 Preferred Pattern (New / Migrated Features): Feature-Owned Fixtures

New ViewModels receive **only the capabilities they need** through typed options.
Production singletons are wired in a sibling `*_composition.ts` file, and the
ViewModel module never imports `$services`. Tests construct the ViewModel with
fresh, typed doubles from a feature-local `testing/` directory — no global
barrel mock, no `test_preload` inventory coupling.

This is the migration target. `views/settings/account/` is the reference slice:

```
views/settings/account/
  account_view.svelte
  account_view_model.svelte.ts        # class + createAccountViewModel(capabilities)
  account_composition.ts             # wires authService/gameStateSyncService from $services
  account_view_model.test.ts         # builds VM from fixtures directly
  testing/account_fixtures.ts        # fresh typed doubles, explicit defaults
```

```typescript
// account_view_model.svelte.ts — no '$services' import
const viewModel = createAccountViewModel({
  className: 'AccountViewModel',
  account: createSignedInAccount({ signOut }),
  sync: createSyncCapabilities({ listSlots }),
});
```

Prefer one narrow capability type per collaborator over a full service
interface, and move credentialed HTTP calls behind a service operation rather
than injecting `fetch` into the ViewModel.

The legacy `mock.module()` / `localServicesMockBase()` pattern below remains for
unmigrated tests until the preload lane is deleted. **Do not adopt it for new
ViewModels.**

### Mock Patterns for Service Tests (legacy preload lane)

When testing a service that extends `BaseFrontendClass`, use `mock.module()` in
`beforeEach` to stub its dependencies. The global mocks from `test_preload.ts`
cover the `@aikami/frontend/services` and `$services` barrels — you only need
to mock the service's own imports:

```typescript
import { beforeEach, describe, expect, mock, test } from 'bun:test';

describe('MyService', () => {
  let service: import('./my_service.svelte.ts').MyServiceInterface;

  beforeEach(async () => {
    // Mock sub-service dependencies
    mock.module('./dependency_service.svelte', () => ({
      dependencyService: {
        initialize: mock(async () => {}),
        doSomething: mock(() => 'result'),
      },
    }));

    const mod = await import('./my_service.svelte');
    service = mod.myService;
  });

  test('should do something', async () => {
    // ...
  });
});
```

**Rule**: use `await import()` inside `beforeEach` so `mock.module()` calls register
before the real module is evaluated.

### Known Limitations

| Issue | Details |
|-------|---------|
| `mock.module()` with `.svelte.ts` files | Bun resolves real modules before mocks in some edge cases. The global barrel mocks in `test_preload.ts` mitigate most cases. |
| `$state` / runes | Polyfills are identity functions (`value => value`) — no reactivity. Pure Bun tests must treat `$state` fields as plain values. For real reactivity, use the Vitest Browser Mode lane (preferred for ViewModels/components) or the compiled Playwright lane. |
| PixiJS / WebGPU | Not available in Bun. Tests that touch the game engine are skipped in CI (handled by E2E). |

### Compiled Component / Lifecycle Testing (C-477)

Pure Bun tests cannot verify Svelte 5 reactivity because rune polyfills are identity
functions without reactive semantics. For real `$state` / `$derived` / `$effect`
behavior, use the compiled Playwright E2E lane:

| Aspect | Pure Bun (unit) | Compiled Playwright (E2E) |
|--------|-----------------|---------------------------|
| Runner | `bun test --preload ./src/lib/test_preload.ts` | `cd apps/e2e && bun run test` (Playwright) |
| Runes | Identity polyfills | Real Svelte 5 compiler transform |
| Reactivity | ❌ — cannot observe reactive updates | ✅ — $state/$derived/$effect work |
| Lifecycle | ✅ — disposal logic with timers/resources | ✅ — component mount/unmount, real $effect cleanup |
| Async stale updates | ✅ — setTimeout and AbortController patterns | ✅ — browser-integrated cancellation behavior |
| Speed | Fast (no browser) | Slower (browser startup) |
| Location | `apps/frontend/client/src/lib/` | `apps/e2e/tests/client/` |

Use Pure Bun for direct lifecycle disposal logic and stale-update prevention
that can be exercised with `setTimeout` and `AbortController`. Use the compiled
Playwright lane when the behavior depends on component mount/unmount, real
`$effect` cleanup, or DOM reactivity.

**Test fixture location**: compiled lifecycle test components live in
`apps/frontend/client/src/lib/views/reactive_lifecycle/` with a dev sandbox
route at `(dev)/dev/reactive-lifecycle/`. Playwright E2E tests in
`apps/e2e/tests/client/reactive_lifecycle.spec.ts` interact with the compiled
components through the dev sandbox.

**Pattern**:
1. Create a ViewModel using real `$state`, `$derived`, `$effect.root`
2. Create a View that renders the ViewModel's state
3. Host the View in a dev sandbox route `(dev)/dev/<feature>/`
4. Write Playwright E2E tests that navigate to the sandbox and verify DOM updates

### Vitest Browser Mode (real-Svelte unit lane)

The preferred lane for ViewModel/component reactivity: instead of the Bun
preload's identity runes, Vitest compiles the `.svelte.ts`/`.svelte` with the
real Svelte plugin and runs it in Chromium via Playwright. No preload, no
global module mocks, no application boot or dev route.

```bash
# from apps/frontend/client
bun run test:browser          # vitest run --config vitest.config.ts
bun moon run client:test-browser
```

- Config: `apps/frontend/client/vitest.config.ts` (standalone; only the aliases
  a component/ViewModel test needs).
- Tests: `apps/frontend/client/src/browser_tests/**/*.browser.test.ts` —
  deliberately outside `src/lib` so `bun test src/lib` never collects them.
- Reference pilot: `reactive_lifecycle.browser.test.ts` asserts real
  `$state`/`$derived` updates and `registerEffectRoot` cleanup on `dispose()`.
- Use `flushSync()` from `svelte` after mutating state to force effects.

**Status**: pilot. `client:test-browser` is `runInCI: false` until the CI
client job installs Playwright browsers. The compiled E2E lane above remains
the integration-level coverage (mount/unmount, DOM, full navigation).

### Repository Contract Tests (real adapter)

Do **not** assert persistence behavior against the regex SQL fake in
`test_preload.ts` — it replaces duplicate inserts where SQLite would reject
them and its `transaction()` never rolls back. For a repository under migration,
override the preload's `@aikami/frontend/storage` mock and run the real
repository against a real in-memory adapter with the production schema:

```typescript
import { applyMigrations } from '@aikami/frontend/storage/migrations';
import { WasmStorageAdapter } from '@aikami/frontend/storage/wasm_storage_adapter';

const db = new WasmStorageAdapter({ databasePath: ':memory:' });
await db.open();
await applyMigrations(db);

mock.module('@aikami/frontend/storage', () => ({
  getLocalDatabase: mock(async () => db),
}));
const { chatStorage } = await import('./chat_storage.svelte.ts');
```

Import the adapter/migrations from their **subpaths** so the preload's barrel
mock does not intercept them. Reference:
`src/lib/services/chat/chat_storage.test.ts`, which also fault-injects a failed
transaction to prove rollback.

---

## AI Visual Testing Framework

Declarative, TypeBox-validated visual assessment. Captures screenshots via Playwright, evaluates via OpenRouter AI, caches results with SHA-256 hashes, and generates a static HTML report.

### Quick Start

```bash
cd apps/e2e

# Capture only (screenshots, no API calls)
bun run src/visual/runner.ts --capture-only

# Full run (capture + AI evaluation, requires OPENROUTER_API_KEY)
bun run test:visual

# Single suite
bun run src/visual/runner.ts --suite=map --capture-only
```

Requires the Client dev server running on port 5274. For AI evaluation, set `OPENROUTER_API_KEY`.

### Creating a Visual Suite

Use `defineConfig` + `export default`. Place in `apps/e2e/src/visual/suites/`:

```typescript
// apps/e2e/src/visual/suites/my_feature.visual.ts
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

const MySchema = Type.Object({
  score: Type.Number({ description: '0-100 score' }),
  elementVisible: Type.Boolean(),
  issues: Type.Array(Type.String()),
});

export default defineConfig({
  id: 'my-feature',
  route: '/dev/my-sandbox',
  waitCondition: 'game_ready',          // 'pixi_loaded' | 'game_ready'
  requiresAuth: false,                  // inject .auth/user-worker-{N}.json
  cases: [
    {
      name: 'Default State',
      searchParams: { state: 'default' },
      prompt: 'Describe what the AI should evaluate...',
      schema: MySchema,
      canvasSelector: 'canvas',         // CSS selector for clip region
      clipSize: 256,                    // clip region size in px
      setupHook: async (page) => {      // optional Playwright interaction
        await page.locator('button').click();
      },
    },
  ],
});
```

### Suite Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | ✅ | Unique suite ID, used for `--suite=` filter |
| `route` | `string` | ✅ | SvelteKit route path (e.g. `/dev/sandbox/map`) |
| `waitCondition` | `'pixi_loaded' \| 'game_ready'` | ✅ | How to detect page readiness |
| `requiresAuth` | `boolean` | — | Inject Playwright auth state (default: false) |
| `cases[].name` | `string` | ✅ | Human-readable case name |
| `cases[].prompt` | `string` | ✅ | AI evaluation prompt |
| `cases[].schema` | `TSchema` | ✅ | TypeBox schema for validation |
| `cases[].searchParams` | `Record<string,string>` | — | URL query parameters |
| `cases[].canvasSelector` | `string` | — | CSS selector for clip (default: 'canvas') |
| `cases[].clipSize` | `number` | — | Clip region size (default: 256) |
| `cases[].setupHook` | `(page: Page) => Promise<void>` | — | Interactive Playwright setup before capture |

### Framework Internals

```
apps/e2e/src/visual/
├── runner.ts              # CLI entry — load suites → capture → evaluate → report
├── core/
│   ├── config.ts          # defineConfig() helper
│   ├── capture.ts         # Playwright orchestration (sequential, WebGL-safe)
│   ├── evaluate.ts        # OpenRouter + TypeBox Value.Check()
│   ├── cache.ts           # SHA-256 hash cache (.visual-cache.json, committed to Git)
│   └── report.ts          # Static HTML report generation
└── suites/
    ├── boot_diagnostics.visual.ts
    ├── combat.visual.ts
    ├── lpc.visual.ts
    ├── map.visual.ts
    └── sandbox.visual.ts
```

### Cache

`apps/e2e/.visual-cache.json` — committed to Git. Key = SHA-256 of (base64Image + prompt + stringified schema). Cache hits skip OpenRouter entirely. Only stores hash→JSON result — no base64 image data.

### Concurrency

Evaluations chunked into groups of 5 to avoid OpenRouter 429 rate limits. Capture is always sequential to protect the WebGL rendering context.

---

## Playwright Functional Tests

Behavioral tests for client app and game engine. Three projects: `setup` (auth), `client`, `game` (game now runs within client).

### Project Structure

```
apps/e2e/
├── playwright.config.ts    # setup, client projects
├── src/
│   ├── auth.setup.ts       # Per-worker auth state generation
│   ├── config.ts           # EMULATOR_PORTS, EMULATOR_PROJECT_ID
│   ├── emulator_helper.ts  # clearAllEmulatorData()
│   ├── fixtures.ts         # Shared fixtures (guestUser, etc.)
│   ├── global_setup.ts     # Pre-suite emulator purge (single project)
│   ├── global_teardown.ts  # Post-suite emulator purge (single project)
│   └── pom/                # Page Object Models
│       ├── combat_page.ts
│       ├── inventory_page.ts
│       ├── client_auth_page.ts
│       ├── client_chat_page.ts
│       ├── client_navigation.ts
│       └── game_menu_page.ts
└── tests/
    ├── client/             # Client functional tests (*.spec.ts)
    ├── game/               # Game engine tests (*.spec.ts, run within client)
    └── ai-services/        # AI microservice tests
```

### Running

```bash
cd apps/e2e

bun run test              # All Playwright tests
bun run test:client       # Client-only
bun run test:game         # Game-only (runs within client dev server)
```

### Creating E2E Tests

**Use POMs — no inline `page.locator()` calls.** Import from `$pom`:

```typescript
// apps/e2e/tests/client/my_feature.spec.ts
import { test } from '@playwright/test';
import { CombatPage } from '$pom';

test.describe('My Feature', () => {
  let combat: CombatPage;

  test.beforeEach(async ({ page }) => {
    combat = new CombatPage(page);
    await combat.gotoDev();
  });

  test('should do something', async () => {
    await combat.clickAttack();
    await combat.expectLogContains('hits for');
  });
});
```

### Creating a POM

```typescript
// apps/e2e/src/pom/my_page.ts
import type { Page } from '@playwright/test';

export class MyPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ──
  async goto(): Promise<void> { /* ... */ }

  // ── Locators (getters, not stored) ──
  get myElement() { return this.page.locator('[data-testid="my-element"]'); }

  // ── Actions ──
  async clickSomething(): Promise<void> { await this.myElement.click(); }

  // ── Assertions (lazy import keep POM framework-agnostic) ──
  async expectVisible(): Promise<void> {
    const { expect } = await import('@playwright/test');
    await expect(this.myElement).toBeVisible();
  }
}
```

Then add to `apps/e2e/src/pom/index.ts` barrel export.

### Worker Isolation

- All workers run against the **single emulator project** `demo-aikami-emulator`
- Parallel workers isolate state via separate browser contexts
- Auth states are per-worker: `.auth/user-worker-{0..N}.json`
- Global setup/teardown purges the emulator project via REST API

> Per-worker emulator project IDs (`demo-aikami-worker-{0..N}`) were removed —
> nothing ever wrote to those projects, and their Auth purges tripped the
> emulator's single-project-mode warnings.

### Path Aliases

| Alias | Maps to |
|-------|---------|
| `$visual/*` | `apps/e2e/src/visual/*` |
| `$pom` | `apps/e2e/src/pom/index.ts` |
| `$pom/*` | `apps/e2e/src/pom/*` |
| `$utils/*` | `apps/e2e/tests/utils/*` |

---

## Debugging Workflow

**Code-first debugging.** Most issues are solved by reading source files, herdr logs, and
checking the D1 data. Browser tools are a LAST resort — they are expensive
in tokens and time.

### Debugging Priority (use in order)

| Priority | Tool                 | When to use                                      |
| -------- | -------------------- | ------------------------------------------------ |
| 1        | `read` source files  | Always — understand the code FIRST               |
| 2        | `herdr_session read`  | Check live server logs for errors                |
<!-- TODO(stale): D1 query tool — verify against the live .pi extension list before relying on this row. -->
| 4        | `browser inspect`    | UI rendering bug, 404, blank page, env var check |
| 5        | `browser console`    | Evidence of a JS runtime error in the browser    |
| 6        | `browser network`    | Specific hypothesis about a failing API call     |
| 7        | `browser screenshot` | User asks to see the page, or final verification |

### Browser Tool Rules

1. **`browser inspect`** — Use ONCE with a focused `selector`. Exposes `PUBLIC_*` env vars. Do NOT inspect the same page repeatedly.
2. **`browser console`** — Only after browser inspect, only when you suspect JS errors.
3. **`browser network`** — Only with a SPECIFIC hypothesis about a failing API call.
4. **`browser screenshot`** — Only when user asks to see the page, or final verification.
5. **`browser lighthouse`** — Specialized audit tool. Only for performance/accessibility questions.

### Common Debug Patterns

```bash
# Pattern: "Something is broken in the client"
# Step 1: Check what's running
bash: ss -tlnp | grep <port>
# Step 2: Read server logs
herdr_session read client
# Step 3: Check the DOM once
browser inspect selector="body"
# Step 4: Read relevant source files

# Pattern: "API call is failing"
# Step 1: Read service/repository code
# Step 2: Check herdr logs for backend errors
# Step 3: browser network ONLY if XHR/fetch
```

### Debugging loop prevention

2 failed attempts → diagnostic script. Never ask user to "try again" without gathering data first.

---

## Commit & Push Policy

**Never commit or push without explicit instruction.** Keep changes in working tree.
After `validate()`, present a summary and ask: "Commit? Commit+push? Continue?"

### Commit Directives

| Directive      | Effect                                                    |
| :------------- | :-------------------------------------------------------- |
| `[only <app>]` | Deploy only specified app(s), ignoring affected detection |
| `[skip <app>]` | Skip specified app(s) even if affected                    |
| `[skip all]`   | Skip all deployments                                      |
| `[deploy all]` | Deploy all apps regardless of changes (Alias: `[force]`)  |

### Pre-Commit Checks

Lefthook runs `moon run :fix:affected --status=staged` + `moon run :typecheck:affected --status=staged` on staged files.
