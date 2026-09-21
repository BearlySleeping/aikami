# Testing Strategy

Testing approach for the Aikami monorepo. For the contributor-facing short
version see [CONTRIBUTING testing](../../CONTRIBUTING.md#testing); for the CI
pipelines see [`CI_CD.md`](CI_CD.md).

## Test Layers

```
┌──────────────────────────────────┐
│    E2E / visual (Playwright)     │  apps/e2e/tests, apps/e2e/src/visual
│    Production routes + game      │
├──────────────────────────────────┤
│    Integration                   │  per-project tests/ (D1 repos, API routes)
├──────────────────────────────────┤
│    Unit                          │  co-located *.test.ts, `bun test`
└──────────────────────────────────┘
│    Blackbox                      │  scripts/src/lib/test_blackbox/
└──────────────────────────────────┘
```

## Unit Tests

**Location:** `src/**/*.test.ts` (co-located with source)

**Runner:** `bun test` (Bun's built-in runner), invoked through Moon so that
prerequisites and path mappings are set up:

```bash
bun moon run schemas:test      # one project
bun moon run client:test       # client
bun moon run hub:test          # hub — runs svelte-kit sync first (see below)
bun run test                   # every project (slow)
```

> 🔴 Do **not** run a bare `bun test <file>` in `apps/frontend/hub` — its
> `tsconfig.test.json` extends the generated `.svelte-kit/tsconfig.json`, so a
> bare run sees no path mappings and fails with a misleading module error. Use
> `bun moon run hub:test`.

**What's tested:** TypeBox schema validation, business logic, utility functions,
AI response parsing, and engine systems (the engine has a large unit suite).

## Integration Tests

**Location:** per-project `tests/` directories.

- Hub API — Elysia route tests against a mocked D1 binding; Better Auth is
  exercised end-to-end through its real handler
  (`packages/backend/auth/tests/better_auth.test.ts`).
- Database — D1 schema/repository tests under
  `packages/backend/database/tests/`.

## E2E and Visual Tests

**Location:** `apps/e2e/tests/` (Playwright specs) and `apps/e2e/src/visual/`
(AI visual suites).

E2E exercises production routes (POM-based) and the game loop. Visual suites
compare rendered output. Evidence for appearance-related acceptance criteria
belongs here, not in unit mocks.

## Blackbox Tests

**Runner:** `scripts/src/lib/test_blackbox/run.ts` (`bun run test:blackbox`).

Manages the dev-server / Docker / herdr service lifecycle for a full integration
pass. Suites live under `scripts/src/lib/test_blackbox/suites/`. `CI=true`
selects CI behavior.

## Known Test Issues

- **Pre-existing client/hub `test:unit` failures** — tracked as a TODO seed
  (C-539) with a note to re-measure before quoting.
- **Client svelte-check accessibility warnings** — pre-existing; see
  [`../architecture/limitations.md`](../architecture/limitations.md).
- **No Playwright visual regression baseline** for every surface — the visual
  suites cover declared cases, not a whole-app screenshot diff.
