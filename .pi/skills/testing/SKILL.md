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

### Mock Patterns for Service Tests

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
| `$state` / runes | Polyfills are identity functions (`value => value`) — no reactivity. Tests must treat `$state` fields as plain values. |
| PixiJS / WebGPU | Not available in Bun. Tests that touch the game engine are skipped in CI (handled by E2E). |

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
│   ├── config.ts           # EMULATOR_PORTS, getWorkerProjectId()
│   ├── emulator_helper.ts  # clearAllWorkerProjects()
│   ├── fixtures.ts         # Shared fixtures (guestUser, etc.)
│   ├── global_setup.ts     # Pre-suite emulator purge (all workers)
│   ├── global_teardown.ts  # Post-suite emulator purge (all workers)
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

- Each worker uses a distinct Firebase project ID: `demo-aikami-worker-{0..N}`
- Auth states are per-worker: `.auth/user-worker-{0..N}.json`
- Global setup/teardown purges ALL worker projects via emulator REST API
- `MAX_WORKERS = 8` — increase if running more parallel workers

### Path Aliases

| Alias | Maps to |
|-------|---------|
| `$visual/*` | `apps/e2e/src/visual/*` |
| `$pom` | `apps/e2e/src/pom/index.ts` |
| `$pom/*` | `apps/e2e/src/pom/*` |
| `$utils/*` | `apps/e2e/tests/utils/*` |

---

## Debugging Workflow

**Code-first debugging.** Most issues are solved by reading source files, tmux logs, and
checking the Firestore emulator data. Browser tools are a LAST resort — they are expensive
in tokens and time.

### Debugging Priority (use in order)

| Priority | Tool                 | When to use                                      |
| -------- | -------------------- | ------------------------------------------------ |
| 1        | `read` source files  | Always — understand the code FIRST               |
| 2        | `tmux_session read`  | Check live server logs for errors                |
| 3        | `firestore_query`    | Verify data state in the emulator                |
| 4        | `browser_inspect`    | UI rendering bug, 404, blank page, env var check |
| 5        | `browser_console`    | Evidence of a JS runtime error in the browser    |
| 6        | `browser_network`    | Specific hypothesis about a failing API call     |
| 7        | `browser_screenshot` | User asks to see the page, or final verification |

### Browser Tool Rules

1. **`browser_inspect`** — Use ONCE with a focused `selector`. Exposes `PUBLIC_*` env vars. Do NOT inspect the same page repeatedly.
2. **`browser_console`** — Only after browser_inspect, only when you suspect JS errors.
3. **`browser_network`** — Only with a SPECIFIC hypothesis about a failing API call. Does NOT capture Firestore gRPC.
4. **`browser_screenshot`** — Only when user asks to see the page, or final verification.
5. **`browser_lighthouse`** — Specialized audit tool. Only for performance/accessibility questions.

### Common Debug Patterns

```bash
# Pattern: "Something is broken in the client"
# Step 1: Check what's running
bash: ss -tlnp | grep <port>
# Step 2: Read server logs
tmux_session read client
# Step 3: Check the DOM once
browser_inspect selector="body"
# Step 4: Read relevant source files

# Pattern: "API call is failing"
# Step 1: Read service/repository code
# Step 2: Check tmux logs for backend errors
# Step 3: browser_network ONLY if XHR/fetch (not Firestore gRPC)
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
