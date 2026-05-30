## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami reference: `apps/backend/firebase/`, `packages/frontend/dataconnect/` |
| **Target** | `apps/backend/firebase/`, `packages/frontend/dataconnect/` — restructure backend + scaffold frontend DataConnect package |
| **Priority** | P0 — structural alignment with Aikami; unblocks future DataConnect SDK work |
| **Dependencies** | MIG-001 (Knowledge Splitting) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Restructure the Aikami backend so its directory layout and workspace naming identically match the Aikami standard. The `apps/backend/functions/` workspace is renamed to `apps/backend/firebase/` and Data Connect is nested inside it (`apps/backend/firebase/dataconnect/`). A new frontend DataConnect SDK package (`packages/frontend/dataconnect/`) wraps the generated Firebase Data Connect queries so SvelteKit ViewModels don't manage connection state.

## Design Reference

**Aikami pattern**: `apps/backend/firebase/` (Cloud Functions + DataConnect) and `packages/frontend/dataconnect/` (generated SDK wrappers)

Key structural elements:
- `apps/backend/firebase/` — the sole Firebase workspace; replaces `apps/backend/functions/`
- `apps/backend/firebase/dataconnect/` — nested DataConnect config (schema, connector, dataconnect.yaml)
- `packages/frontend/dataconnect/` — frontend-accessible wrapper around `@firebase/data-connect` generated SDK
- `packages/frontend/dataconnect/src/lib/generated/` — auto-generated SDK (ESM + CJS + types)
- `firebase.json` at repo root → points `dataconnect.source` to `apps/backend/firebase/dataconnect`
- Workspace alias `firebase` (was `functions`) in `.moon/workspace.yml`

## Changes Detail

### Directory Mapping

| Old (Aikami) | New (Aikami, matching Aikami) |
|---|---|
| `apps/backend/functions/` | `apps/backend/firebase/` |
| `apps/backend/dataconnect/` | `apps/backend/firebase/dataconnect/` |
| (does not exist) | `packages/frontend/dataconnect/` |
| (does not exist) | `firebase.json` (root) |

### Package Rename

- `@app/backend-functions` → `@aikami/firebase`
- New: `@aikami/frontend-dataconnect`

### Config Updates

| File | Change |
|---|---|
| `.moon/workspace.yml` | `functions: "apps/backend/functions"` → `firebase: "apps/backend/firebase"`; add `frontend-dataconnect: "packages/frontend/dataconnect"` |
| `biome.json` | `apps/backend/functions/**` → `apps/backend/firebase/**`; add `packages/frontend/dataconnect/**` |
| `apps/backend/firebase/package.json` | Rename package; update to Aikami-style scripts and dependencies |
| `apps/backend/firebase/moon.yml` | Rename project, update tags, add tasks |
| `apps/backend/firebase/tsconfig.json` | Update path aliases for new workspace name |
| `firebase.json` (root, new) | `dataconnect.source: "apps/backend/firebase/dataconnect"` |
| `scripts/src/test_blackbox/emulator_manager.ts` | `apps/backend/functions` → `apps/backend/firebase` |
| `scripts/src/lib/dev_all.ts` | `apps/backend/functions` → `apps/backend/firebase` |
| `scripts/src/lib/generate_context.ts` | `apps/backend/functions` → `apps/backend/firebase` |

## Acceptance Criteria

### AC-1: Backend Directory Matches Aikami Structure
**Given** the repo is checked out at HEAD
**When** I inspect `apps/backend/`
**Then** `apps/backend/functions/` does NOT exist; `apps/backend/firebase/` DOES exist with all original functions source files plus `dataconnect/` subdirectory containing schema, connector, and dataconnect.yaml

**Test Hooks**:
- Unit: `test -d apps/backend/firebase && ! -d apps/backend/functions`
- Integration: moon workspace resolves `firebase` project correctly
- CI: `moon run firebase:typecheck` passes

**Watch Points**:
- The `dist/` directory inside the old `functions/` contains cached emulator state; exclude from move or clean first
- The `dataconnect/` subdirectory keeps its existing content (Aikami schema, not Aikami's)

### AC-2: Root firebase.json Points to New DataConnect Path
**Given** the repo root
**When** I read `firebase.json`
**Then** it contains `"dataconnect": { "source": "apps/backend/firebase/dataconnect" }`

**Test Hooks**:
- Unit: `jq '.dataconnect.source' firebase.json` returns `"apps/backend/firebase/dataconnect"`
- Integration: Firebase CLI resolves the dataconnect config

**Watch Points**:
- This file did not exist before; it is created fresh

### AC-3: Frontend DataConnect Package is Scaffolded
**Given** the repo
**When** I inspect `packages/frontend/dataconnect/`
**Then** it contains `package.json` (name: `@aikami/frontend-dataconnect`), `moon.yml`, `tsconfig.json`, `src/index.ts` (wrapper), and `src/lib/generated/` (placeholder generated SDK with connectorConfig matching Aikami's dataconnect)

**Test Hooks**:
- Unit: `bun run typecheck` in the package passes
- Integration: moon workspace resolves `frontend-dataconnect` project
- CI: `moon run frontend-dataconnect:typecheck` passes

**Watch Points**:
- The generated SDK must use Aikami's connector id (`aikami-connector`) and service id (`aikami-db`), not Aikami's
- The `@aikami/frontend/configs` path alias must exist in tsconfig for the `getDataConnect` import

### AC-4: All Import Paths and Config References Are Updated
**Given** the restructured repo
**When** I grep for old paths: `apps/backend/functions`, `@app/backend-functions`
**Then** no source files (excluding `node_modules`, `.git`, `dist/`, `bun.lock`) reference them

**Test Hooks**:
- Unit: `rg "apps/backend/functions" --no-ignore-vcs --type-not md | rg -v 'node_modules|dist/|bun.lock'` returns empty
- Unit: `rg "@app/backend-functions"` returns empty
- CI: `moon run :typecheck` across all affected projects

**Watch Points**:
- The `bun.lock` may still reference old package name until `bun install` is re-run
- `apps/backend/firebase/dist/` contains generated files with embedded paths; these regenerate on next build

### AC-5: Moon Workspace Resolution Passes
**Given** the restructured repo
**When** I run `moon sync`
**Then** all projects resolve, `firebase` replaces `functions`, `frontend-dataconnect` is recognized

**Test Hooks**:
- Integration: `bunx moon run firebase:typecheck`
- Integration: `bunx moon run frontend-dataconnect:typecheck`
- CI: `moon sync` exits 0

**Watch Points**:
- The moon cache may need clearing after project rename: `rm -rf .moon/cache`

## Implementation Notes

1. **Files to create**:
   - `firebase.json` (root)
   - `packages/frontend/dataconnect/package.json`
   - `packages/frontend/dataconnect/moon.yml`
   - `packages/frontend/dataconnect/tsconfig.json`
   - `packages/frontend/dataconnect/src/index.ts`
   - `packages/frontend/dataconnect/src/lib/generated/index.d.ts`
   - `packages/frontend/dataconnect/src/lib/generated/index.cjs.js`
   - `packages/frontend/dataconnect/src/lib/generated/esm/index.esm.js`
   - `packages/frontend/dataconnect/src/lib/generated/esm/package.json`
   - `packages/frontend/dataconnect/src/lib/generated/package.json`
   - `packages/frontend/dataconnect/src/lib/generated/README.md`
   - `packages/frontend/dataconnect/src/lib/generated/.guides/config.json`
   - `packages/frontend/dataconnect/src/lib/generated/.guides/setup.md`
   - `packages/frontend/dataconnect/src/lib/generated/.guides/usage.md`

2. **Files to modify**:
   - `apps/backend/firebase/package.json` (was functions)
   - `apps/backend/firebase/moon.yml` (was functions)
   - `apps/backend/firebase/tsconfig.json` (was functions)
   - `.moon/workspace.yml`
   - `biome.json`
   - `scripts/src/test_blackbox/emulator_manager.ts`
   - `scripts/src/lib/dev_all.ts`
   - `scripts/src/lib/generate_context.ts`
   - `config/tsconfig/tsconfig.frontend.json` (add `@aikami/frontend/configs` alias)

3. **Files to delete**: None (rename operations are moves)

4. **Order of operations**:
   a. Write contract
   b. Move `apps/backend/functions/` → `apps/backend/firebase/`
   c. Move `apps/backend/dataconnect/` → `apps/backend/firebase/dataconnect/`
   d. Create `firebase.json` at root
   e. Update `apps/backend/firebase/package.json`, `moon.yml`, `tsconfig.json`
   f. Update `.moon/workspace.yml`
   g. Update `biome.json`
   h. Update script files
   i. Update `config/tsconfig/tsconfig.frontend.json`
   j. Scaffold `packages/frontend/dataconnect/`
   k. Run `moon sync` and validate

5. **Verification**: `moon run firebase:typecheck && moon run frontend-dataconnect:typecheck`

## Edge Cases & Gotchas

- **dist/ directory in old functions**: The `dist/` dir contains large emulator state files. Use `mv` (which is fast and atomic) rather than copy.
- **node_modules**: The `functions` directory has its own `node_modules`. After `bun install` at root, the lockfile needs updating.
- **moon cache**: After renaming a project, moon's cache may be invalid. Run `bunx moon clean` or delete `.moon/cache` if typecheck fails with stale errors.
- **Generated SDK connector config**: Must use `connector: 'aikami-connector'` and `service: 'aikami-db'` to match Aikami's dataconnect.yaml, not Aikami's `audit-logs`.
- **frontend-configs path alias**: The new `tsconfig.frontend.json` must include `@aikami/frontend/configs` for the dataconnect package to resolve the `getDataConnect` import.
