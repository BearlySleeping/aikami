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
├── config.ts             # EMULATOR_PORTS, getWorkerProjectId()
├── emulator_helper.ts    # Emulator purge utilities
├── fixtures.ts           # Shared fixtures (guestUser, etc.)
├── global_setup.ts       # Pre-suite purge (all workers)
├── global_teardown.ts    # Post-suite purge (all workers)
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

Each worker uses a distinct Firebase project ID (`demo-aikami-worker-{N}`) for data isolation. Auth states are per-worker. Setup/teardown purges all worker projects. Max 4 parallel workers.

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

- Client dev server on port 5274 (`bun moon run client:dev` or `herdr_session start client`)
- Firebase emulators for functional tests (`herdr_session start firebase`)
- `OPENROUTER_API_KEY` env var for AI visual evaluation
