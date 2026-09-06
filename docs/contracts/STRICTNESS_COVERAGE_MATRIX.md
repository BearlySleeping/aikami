# Strictness Coverage Matrix

**Contract C-476**: every required rule has a known enforcement boundary.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Enforced | Checked in CI — failure blocks the PR |
| ⚠️ Ratchet | Checked in CI against a per-file baseline — may only go down |
| 🚫 Exempt | Explicitly disabled — see reason |
| — Not applicable | Rule does not apply to this category |

## Rules by Category

### A. Lint — Correctness

| Rule | `apps/frontend/client` | `apps/frontend/hub` | `apps/frontend/site` | `apps/frontend/docs` | `packages/shared` | `packages/frontend` | `packages/backend` | `apps/backend` | `scripts` | `.pi` | `apps/e2e` |
|------|---|---|---|---|---|---|---|---|---|---|---|
| `noUnusedVariables` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noUnusedImports` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noConsole` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 CLI | 🚫 Pi TUI | 🚫 tests |
| `noExplicitAny` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 tests |

### B. Lint — Style

| Rule | `apps/frontend/client` | `apps/frontend/hub` | `apps/frontend/site` | `apps/frontend/docs` | `packages/shared` | `packages/frontend` | `packages/backend` | `apps/backend` | `scripts` | `.pi` | `apps/e2e` |
|------|---|---|---|---|---|---|---|---|---|---|---|
| `useNamingConvention` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 tests |
| `useFilenamingConvention` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `useArrowFunction` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noNonNullAssertion` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noNestedTernary` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `useBlockStatements` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `useImportType` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `useConsistentTypeDefinitions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noRestrictedImports` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `noRestrictedGlobals` (frontend) | ✅ | ✅ | — | — | — | ✅ | — | — | — | — | — |
| `noRestrictedGlobals` (backend) | — | — | — | — | — | — | ✅ | ✅ | — | — | — |

### C. Lint — Suspicious

| Rule | `apps/frontend/client` | `apps/frontend/hub` | `apps/frontend/site` | `apps/frontend/docs` | `packages/shared` | `packages/frontend` | `packages/backend` | `apps/backend` | `scripts` | `.pi` | `apps/e2e` |
|------|---|---|---|---|---|---|---|---|---|---|---|
| `noExplicitAny` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 tests |
| `noConsole` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 CLI | 🚫 Pi TUI | 🚫 tests |

### D. Structural Guards (scripts/src/lib/ops/)

| Guard | `apps/frontend/client` | `apps/frontend/hub` | `packages/frontend` | `scripts` | `.pi` |
|-------|---|---|---|---|---|
| `guard-type-safety` (T1/T2/T3) | ⚠️ baseline | ⚠️ baseline | ⚠️ baseline | ⚠️ baseline | ⚠️ baseline |
| `guard-mvvm-conventions` | ✅ / ⚠️ | ✅ / ⚠️ | — | — | — |
| `guard-service-conventions` | ✅ / ⚠️ | ✅ / ⚠️ | — | — | — |
| `guard-service-mock-coverage` | ⚠️ | — | — | — | — |
| `guard-image-component` | ✅ | ✅ | — | — | — |
| `guard-data-plane` | — | ✅ | — | — | — |

### E. `.svelte.ts` Coverage

| Biome Rule | `.svelte.ts` (client) | `.svelte.ts` (hub) | `.svelte.ts` (packages) |
|------------|---|---|---|
| All lint rules | ✅ | ✅ | ✅ |
| `noRestrictedGlobals` | ✅ | ✅ | ✅ |
| Svelte rune syntax | ✅ parsed as TS | ✅ parsed as TS | ✅ parsed as TS |

> **Note**: `.svelte.ts` files are pure TypeScript (no HTML markup). Biome's TypeScript parser handles them identically to `.ts` files. Svelte runes (`$state`, `$derived`, `$effect`) are valid TypeScript identifiers — Biome does not need Svelte-aware parsing for them. The previous blanket exclusion (`!**/*.svelte.ts`) was unnecessary and has been removed.

### F. Exceptions with Reasons

| Category | Rule Disabled | Reason |
|----------|---------------|--------|
| `apps/e2e/**` | `noConsole` | Test logging and debug output |
| `apps/e2e/**` | `noExplicitAny` | Test mocks and fixture types |
| `apps/e2e/**` | `useNamingConvention` | Test naming patterns |
| `scripts/**` | `noConsole` | CLI tools produce stdout/stderr output |
| `.pi/**` | `noConsole` | Pi agent extensions and scripts use `console.log` for TUI/logging output |
| `**/*.d.ts` | `useConsistentTypeDefinitions` | Declaration files use `interface` for ambient declarations |
| `**/*.d.ts` | `useNamingConvention` | Declaration files follow ambient naming conventions |

### G. File Categories and Tooling Coverage

| Category | Biome Lint | Structural Guard | TypeScript Strict |
|----------|-----------|-----------------|-------------------|
| App code (`apps/frontend/client`) | ✅ | ✅ `guard-mvvm`, `guard-service`, `guard-image` | ✅ |
| App code (`apps/frontend/hub`) | ✅ | ✅ `guard-mvvm`, `guard-data-plane` | ✅ |
| Shared packages (`packages/shared`) | ✅ | — | ✅ |
| Frontend packages (`packages/frontend`) | ✅ | ✅ `guard-type-safety` | ✅ |
| Backend packages (`packages/backend`) | ✅ | ✅ `guard-data-plane` | ✅ |
| Scripts (`scripts/`) | ✅ | ✅ `guard-type-safety` | ✅ |
| Pi agent extensions (`.pi/`) | ✅ | ✅ `guard-type-safety` (C-476) | ✅ |
| E2E tests (`apps/e2e/`) | ✅ (narrowed) | — | ✅ |
| Generated skills (`.pi/generated-skills/`) | 🚫 excluded | — | — |
| SvelteKit build artifacts (`.svelte-kit`) | 🚫 excluded | — | — |

## Scope Boundaries

This matrix documents the **current** enforcement state after C-476. Changes to any cell require a PR with explicit reviewer approval and an updated matrix entry.
