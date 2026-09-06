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
| `useNamingConvention` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🚫 | 🚫 | 🚫 tests |
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
| `scripts/**` | `useNamingConvention` | CLI, environment, and external payload identifiers follow tool-defined names |
| `.pi/**` | `noConsole` | Pi agent extensions and scripts use `console.log` for TUI/logging output |
| `.pi/**` | `useNamingConvention` | Agent extension and external API identifiers follow host-defined names |
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

### H. Recorded Debt — reviewed suppressions carried by this PR

Removing the blanket `!**/*.svelte.ts` Biome exclusion (AC-2) brought ~330
rune-bearing files under lint and format for the first time. All violations it
surfaced were fixed in place except the one below, which is recorded here rather
than silently removed, per AC-5 ("report remaining debt rather than marking it
fixed").

| Location | Rule | Why it is deferred |
|----------|------|--------------------|
| `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` | `noUnusedPrivateClassMembers` | `_memoryRetrievalService` is assigned from constructor options but never read — the C-458 recent-history signal was never wired into `_computeRelationshipBoost`. Deleting it would drop `memoryRetrievalService` from the public options type and discard the integration seam, which is a behavior change and out of scope for C-476. Suppressed with a reasoned `biome-ignore` and tracked here. |

Two mechanical consequences of the same change are also worth recording, since
both were invisible before `.svelte.ts` was linted:

- The formatter re-wraps long casts past 100 columns, which detaches a trailing
  `// guard-ignore lint/type-safety/casting:` comment from its cast. 16 such
  comments were moved onto their own line **above** the cast — the guard's
  stable, documented form — with no change to any reason text. The
  `guard_type_safety` baseline is unchanged at T1=14 T2=4 T3=1.
- `apps/frontend/client/src/lib/views/combat/combat_view_model.dev.svelte.ts`
  gained a named `CombatVmInternals` type so its two casts fit on one line and
  cannot be re-wrapped away from their comments again.

## Scope Boundaries

This matrix documents the **current** enforcement state after C-476. Changes to any cell require a PR with explicit reviewer approval and an updated matrix entry.
