# Testing Strategy

Testing approach for the Aikami monorepo.

## Test Layers

```
┌──────────────────────────────────┐
│    Blackbox (E2E)                │  scripts/src/test_blackbox/
│    Hub API + Client + Playwright │
├──────────────────────────────────┤
│    Integration                   │  Per-app tests/
│    D1 repositories, API routes   │
├──────────────────────────────────┤
│    Unit                          │  Co-located *.test.ts
│    Vitest, schema validation     │
└──────────────────────────────────┘
```

## Unit Tests

**Location:** `src/**/*.test.ts` (co-located with source)

**Runner:** `bun test` (Bun's built-in runner) across the monorepo

**What's tested:**
- TypeBox schema validation (packages/shared/schemas/src/lib/*.test.ts)
- Business logic validation
- Utility functions
- AI response parsing

**Coverage:** Partial — the schemas package has 15+ test files; backend coverage is thinner.

```bash
bun run test              # All unit tests via moon
bun run moon run schemas:test  # Just schemas
```

## Integration Tests

**Location:** Per-project `tests/` directories

**Hub API tests:**
```bash
bun test apps/frontend/hub/src/lib
```
- Elysia route tests run against a mock D1 binding
- Better Auth is exercised end-to-end through its real HTTP handler
  (`packages/backend/auth/tests/better_auth.test.ts`)

**Database tests:**
```bash
bun test packages/backend/database/tests/
```

## Blackbox (E2E) Tests

**Runner:** `scripts/src/test_blackbox/run.ts`

**Architecture:**
```
scripts/src/test_blackbox/
├── run.ts                     # Entry point
├── emulator_manager.ts        # Firestack emulator lifecycle
├── dev_server_manager.ts      # Client dev server lifecycle
├── test_runner.ts             # Suite execution
├── reporter.ts                # Terminal + JSON reports
└── suites/
    ├── schema_check.ts        # TypeScript compilation check
    ├── functions.api.ts       # Functions emulator health
    └── client.e2e.ts             # Playwright browser tests
```

**Client Playwright Tests** (`apps/frontend/client/tests/`):
- `emulator-login.spec.ts` — auth flow with emulator
- `basic.spec.ts` — core Client functionality
- `chat.spec.ts`, `chat-sending.spec.ts`, `chat-store.spec.ts` — chat features
- `onboarding.spec.ts` — new user flow
- `i18n.spec.ts` — internationalization
- `character-card.spec.ts` — character display

**Running:**
```bash
bun run test:blackbox                    # All suites
bun run test:blackbox schema-check       # Just schemas
bun run test:blackbox client                # Just Client
bun run test:blackbox --no-cross-service # Skip cross-service
```

**CI mode:**
```bash
CI=true bun run test:blackbox
```

## Test Status

| Layer | Coverage | Status |
|-------|----------|--------|
| Unit (schemas) | 15+ test files | ✅ Active |
| Unit (functions) | 1 test file | ⚠️ Minimal |
| Unit (Client) | None | ❌ Missing |
| Unit (game engine) | Some (string registry, etc.) | ⚠️ Partial — packages/frontend/engine |
| Integration (hub API + D1) | Configured | ✅ Active |
| Blackbox (schema-check) | Working | ✅ Active |
| Blackbox (functions) | Health probe | ⚠️ Basic |
| Blackbox (Client Playwright) | 8 spec files | ✅ Active |

## Known Test Issues

1. **Schema test type errors**: Pre-existing TS errors in test files (unused vars, strict null checks). Tests pass at runtime but `tsc` reports errors.
2. **Client svelte-check warnings**: Accessibility warnings in Client components, pre-existing.
3. **No Client unit tests**: ViewModels and services lack unit test coverage.
4. **Functions test coverage**: Only 1 test file for 5 controllers.
