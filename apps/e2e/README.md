# Aikami E2E Testing

Two separate testing systems — **do not mix them**.

| System | Runtime | Purpose | Command |
|--------|---------|---------|---------|
| **AI Visual Runner** | Bun | Screenshot capture + AI evaluation | `bun run test:visual` |
| **Playwright** | Node.js | Behavioral/functional E2E | `bun run test` |

## AI Visual Testing Framework

Declarative, TypeBox-validated visual assessment. Captures screenshots via Playwright, evaluates via OpenRouter AI, caches results with SHA-256 hashes, and generates a static HTML report.

### Quick Start

```bash
# Capture only (screenshots, no API calls)
bun run src/visual/runner.ts --capture-only

# Full run (capture + AI evaluation)
bun run test:visual

# Single suite
bun run src/visual/runner.ts --suite=map --capture-only
```

Requires the PWA dev server running on port 5274. For AI evaluation, set `OPENROUTER_API_KEY`.

### Creating a Suite

Place in `src/visual/suites/`. Use `defineConfig` + `export default`:

```typescript
import { Type } from 'typebox';
import { defineConfig } from '$visual/core/config';

export default defineConfig({
  id: 'my-feature',
  route: '/dev/my-sandbox',
  waitCondition: 'game_ready',
  cases: [
    {
      name: 'Default State',
      searchParams: { state: 'default' },
      prompt: 'Is the UI rendered correctly?',
      schema: Type.Object({
        score: Type.Number(),
        uiVisible: Type.Boolean(),
        issues: Type.Array(Type.String()),
      }),
      setupHook: async (page) => {
        await page.locator('button').click();
      },
    },
  ],
});
```

### Architecture

```
src/visual/
├── runner.ts              # CLI entry
├── core/
│   ├── config.ts          # defineConfig() helper
│   ├── capture.ts         # Playwright orchestration
│   ├── evaluate.ts        # OpenRouter + TypeBox validation
│   ├── cache.ts           # SHA-256 hash cache
│   └── report.ts          # Static HTML report
└── suites/                # Declarative test definitions
```

### Cache

`apps/e2e/.visual-cache.json` — committed to Git. SHA-256 key of (image + prompt + schema). Cache hits skip OpenRouter entirely. No base64 stored.

### Path Aliases

| Alias | Maps to |
|-------|---------|
| `$visual/*` | `src/visual/*` |
| `$pom` | `src/pom/index.ts` |
| `$pom/*` | `src/pom/*` |
| `$utils/*` | `tests/utils/*` |

---

## Playwright Functional Tests

Behavioral tests for PWA client and game engine.

### Project Structure

```
playwright.config.ts      # setup, client, game projects
src/
├── auth.setup.ts         # Per-worker auth state generation
├── config.ts             # EMULATOR_PORTS, EMULATOR_PROJECT_ID
├── emulator_helper.ts    # Emulator purge utilities
├── fixtures.ts           # Shared fixtures (guestUser, etc.)
├── global_setup.ts       # Pre-suite purge (single project)
├── global_teardown.ts    # Post-suite purge (single project)
└── pom/                  # Page Object Models
    ├── combat_page.ts
    ├── inventory_page.ts
    ├── client_auth_page.ts
    ├── client_chat_page.ts
    ├── client_navigation.ts
    └── game_menu_page.ts
tests/
├── client/               # PWA functional tests
├── game/                 # Game engine tests
└── ai-services/          # AI microservice tests
```

### Running

```bash
bun run test              # All Playwright tests
bun run test:client       # Client-only
bun run test:game         # Game-only (needs dev server + engine)
```

### Creating Tests

Use POMs from `$pom` — no inline `page.locator()`:

```typescript
import { test } from '@playwright/test';
import { CombatPage } from '$pom';

test.describe('My Test', () => {
  let combat: CombatPage;
  test.beforeEach(async ({ page }) => { combat = new CombatPage(page); });
  test('example', async () => {
    await combat.gotoDev();
    await combat.clickAttack();
  });
});
```

### Worker Isolation

All Playwright workers run against the **single emulator project** (`demo-aikami-emulator`). Parallel workers isolate test state via separate browser contexts and per-worker auth state files (`.auth/user-worker-{N}.json`). Global setup/teardown purges the emulator project before and after each run.

> Per-worker emulator project IDs (`demo-aikami-worker-{N}`) were removed — nothing ever wrote to those projects, and their Auth purges tripped the emulator's single-project-mode warnings.

### Auth Setup

The `setup` project generates auth states at `.auth/user-worker-{N}.json`. Runs automatically as a dependency of the `client` project.

---

## Moon Tasks

```bash
bun moon run e2e:test             # All Playwright tests
bun moon run e2e:test-client      # Client-only
bun moon run e2e:test-game        # Game-only
bun moon run e2e:run-visual-tests # AI visual runner
```

## Prerequisites

Playwright's `webServer` block starts whatever is missing, so nothing here is
strictly required — but a warm herdr workspace makes runs much faster because
Playwright reuses the servers instead of starting its own
(`reuseExistingServer: !process.env.CI`).

- Client dev server on port 5274 (`bun herdr:start client`, or `bun moon run client:dev`)
- Hub dev server on port 5276 for `tests/hub` (`bun herdr:start hub`)
- Site dev server on port 5280 for `tests/site` (`bun herdr:start site`)
- `OPENROUTER_API_KEY` env var for AI visual evaluation

There is no Firebase emulator any more — C-426 replaced it with Cloudflare D1
plus local SQLite, and `global_setup.ts`'s purge step is now a no-op.

## How this runs in CI

herdr is **not** used in CI, on purpose. It is a nix flake input (a Rust
binary), so a GitHub runner would have to install nix or build it from source
just to get it on PATH — and everything herdr is good at (detachable panes
that outlive the client, named tabs an agent can read back, one workspace per
contract) is worth nothing to a one-shot job that dies with the runner.
Playwright's own `webServer` does the CI job: start, poll for readiness, tear
down.

Two deliberate differences from a local run:

| | Local | CI |
|---|---|---|
| Servers | your herdr tabs, reused | started by Playwright, from **built** output |
| Hub | `vite dev` on :5276 (SvelteKit platform proxy supplies D1/R2) | `wrangler dev --local` on :5278 against `build/_worker.js`, with real local D1 |
| Reporter | `list` | `list` + `html` (uploaded as a workflow artifact) |

CI serves built output so there is no HMR warm-up stalling behind a 15s
`expect` timeout, and so the bytes under test are the bytes that ship. The
hub is the exception to "just preview it": `vite preview` serves an SSR
adapter-cloudflare app *without* its bindings, so every `/api` route would
500 — its real built equivalent is the wrangler worker.

The e2e suite is label-gated: add `run-heavy` to a PR, or dispatch
`pr-checks.yml` with `include-heavy=true`.
