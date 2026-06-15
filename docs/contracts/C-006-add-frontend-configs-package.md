## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami `packages/frontend/configs/` |
| **Target** | `/aikami/packages/frontend/configs/` |
| **Priority** | P1 — Needed for frontend config management pattern |
| **Dependencies** | C-005 (packages/shared/ restructured) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Create a `packages/frontend/configs/` package for shared frontend configuration — environment schemas, Firebase config, app constants, and feature flags. This follows the aikami pattern where frontend configs are separated from backend configs. Currently aikami has `packages/backend/configs/` but no dedicated frontend configs package.

## Design Reference

**Aikami `packages/frontend/configs/`** structure:
- `moon.yml` — project config with dependsOn: constants, schemas, types
- `tsconfig.json` — extends frontend tsconfig, paths to shared packages
- `package.json` — `@aikami/frontend-configs`
- `src/` — config source files
- Extends `config/tsconfig/tsconfig.frontend.json`

## Package Structure

```
packages/frontend/configs/
├── moon.yml
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Barrel export
    ├── app.config.ts         # App-level config (name, version, features)
    ├── env.schema.ts         # Zod schemas for environment variables
    ├── firebase.config.ts    # Firebase project configuration
    └── feature-flags.ts      # Feature flag definitions
```

## Acceptance Criteria

### AC-1: Package Created with Standard Structure
**Given** `packages/frontend/` exists but has no `configs/` subdirectory
**When** this contract is implemented
**Then** `packages/frontend/configs/` exists with moon.yml, package.json, tsconfig.json, and src/

**Test Hooks**:
- Unit: `test -f packages/frontend/configs/moon.yml`
- Unit: `test -f packages/frontend/configs/tsconfig.json`
- Unit: `test -f packages/frontend/configs/package.json`

### AC-2: moon.yml Follows Aikami Pattern
**Given** the moon.yml file
**When** moon syncs the project
**Then** the project is registered with correct dependsOn, layer, tags

**Test Hooks**:
- Unit: `moon.yml` has `dependsOn: [constants, schemas, types]`
- Unit: `moon.yml` has `layer: library`, `stack: frontend`, `tags: [config, frontend, library]`

### AC-3: tsconfig.json Extends Frontend Base
**Given** the frontend configs package
**When** TypeScript compiles
**Then** it extends `config/tsconfig/tsconfig.frontend.json` and has correct path mappings to shared packages

**Test Hooks**:
- Unit: `tsconfig.json` extends `../../../config/tsconfig/tsconfig.frontend.json`
- Unit: Path aliases resolve `@aikami/constants`, `@aikami/schemas`, `@aikami/types`, `@aikami/utils`, `$logger`

### AC-4: Registered in Workspace
**Given** the new package
**When** moon sync runs
**Then** the package appears in `.moon/workspace.yml` as `frontend-configs: "packages/frontend/configs"`

**Test Hooks**:
- Unit: `bun moon sync` succeeds
- Unit: `grep 'frontend-configs' .moon/workspace.yml` shows correct path

### AC-5: Root tsconfig.json Updated
**Given** the new package
**When** TypeScript project references are updated
**Then** root `tsconfig.json` includes `{ "path": "./packages/frontend/configs" }`

**Test Hooks**:
- Unit: `grep 'packages/frontend/configs' tsconfig.json` returns a reference entry

## Implementation Notes

1. **Copy moon.yml structure** from aikami's `packages/frontend/configs/moon.yml`
2. **Copy tsconfig.json structure** from aikami, adapting paths for aikami (`@aikami/` instead of `@aikami/`)
3. **package.json**: Use `"name": "@aikami/frontend-configs"`, standard scripts (typecheck, lint, format, fix, test)
4. **src/ contents**: Create initial files — env.schema.ts (Zod), app.config.ts, firebase.config.ts, feature-flags.ts
5. **config/tsconfig/tsconfig.frontend.json**: May need to create this base config if aikami doesn't have one. Copy from aikami's `config/tsconfig/tsconfig.frontend.json`
6. **Root package.json workspaces**: Already covers `"packages/frontend/*"` — no change needed

## Edge Cases & Gotchas

- **Existing backend/configs**: Do NOT modify `packages/backend/configs/` — frontend configs is a separate concern
- **Firebase config**: If aikami currently has Firebase config scattered across the PWA, consolidate into this package
- **config/tsconfig/ directory**: Verify `tsconfig.frontend.json` and `tsconfig.base.json` exist in `config/tsconfig/` — create if missing (copy from aikami)
