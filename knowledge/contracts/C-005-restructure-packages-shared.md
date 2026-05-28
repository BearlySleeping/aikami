## Metadata

| Field | Value |
|---|---|
| **Source** | Nordclaw `packages/shared/` structure |
| **Target** | `/aikami/packages/shared/` |
| **Priority** | P1 — Foundation change required before adding new packages |
| **Dependencies** | C-001 (clean root) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Restructure the monorepo so that shared packages live under `packages/shared/` instead of `packages/` directly. This follows the nordclaw convention and separates shared utilities from domain-specific backend/frontend packages.

## Design Reference

**Current aikami structure**:
```
packages/
├── constants/     # → packages/shared/constants
├── logger/        # → packages/shared/logger
├── mocks/         # → packages/shared/mocks
├── schemas/       # → packages/shared/schemas
├── types/         # → packages/shared/types
├── utils/         # → packages/shared/utils
├── backend/
│   ├── ai/
│   ├── auth/
│   ├── configs/
│   ├── database/
│   ├── svelte-kit/
│   └── utils/
└── frontend/
    ├── components/
    ├── repositories/
    ├── services/
    └── utils/
```

**Target structure** (nordclaw-style):
```
packages/
├── shared/
│   ├── constants/
│   ├── logger/
│   ├── mocks/
│   ├── schemas/
│   ├── types/
│   └── utils/
├── backend/
│   ├── configs/
│   ├── database/
│   ├── auth/
│   ├── svelte-kit/
│   └── utils/
└── frontend/
    ├── configs/        # Added by C-006
    ├── components/
    ├── repositories/
    ├── services/
    └── utils/
```

## Files to Update Per Moved Package

For each package moved (constants, logger, mocks, schemas, types, utils), update:
1. **Physical location**: `git mv packages/{name} packages/shared/{name}`
2. **package.json**: `"name": "@aikami/{name}"` stays same
3. **tsconfig.json paths**: Update `extends` and `paths` to reflect new relative location
4. **moon.yml**: No change needed (moon uses workspace-relative paths)
5. **`.moon/workspace.yml`**: Update project paths from `packages/{name}` to `packages/shared/{name}`
6. **Root tsconfig.json references**: Update paths
7. **Root package.json workspaces**: Update from `"packages/*"` to `"packages/shared/*"`, `"packages/backend/*"`, `"packages/frontend/*"`
8. **All cross-package imports**: Update `@aikami/{name}` import paths (tsconfig paths handle this) — verify

## Package-Specific Changes

### packages/backend/ai → REMOVE
The `packages/backend/ai` package should be **removed** (it's AI vendor integration code). If there are useful Firebase/AI integration utilities, extract them into `packages/backend/utils` before removal.

## Acceptance Criteria

### AC-1: All Shared Packages Moved
**Given** constants, logger, mocks, schemas, types, utils are at `packages/`
**When** migration is complete
**Then** all six packages are at `packages/shared/` and `packages/` no longer contains these directories directly

**Test Hooks**:
- Unit: `test -d packages/shared/constants && test -d packages/shared/logger && test -d packages/shared/mocks && test -d packages/shared/schemas && test -d packages/shared/types && test -d packages/shared/utils`
- Unit: `test ! -d packages/constants && test ! -d packages/logger`

### AC-2: All tsconfig.json Files Updated
**Given** packages reference each other via tsconfig paths
**When** migration is complete
**Then** all tsconfig paths correctly resolve across the new directory structure

**Test Hooks**:
- Unit: `bun run typecheck` passes in all packages
- Unit: `grep -r 'packages/constants' packages/shared/*/tsconfig.json` returns updated paths

### AC-3: Workspace Configuration Updated
**Given** `.moon/workspace.yml` and root `package.json` define workspace projects
**When** migration is complete
**Then** both files reference the new `packages/shared/` paths

**Test Hooks**:
- Unit: `bun moon sync` succeeds without errors
- Unit: `bun moon run :typecheck` succeeds

### AC-4: packages/backend/ai Removed
**Given** the `packages/backend/ai` package exists
**When** this contract is implemented
**Then** the package is removed and all references to it are cleaned up

**Test Hooks**:
- Unit: `test ! -d packages/backend/ai`
- Unit: `grep -r 'backend/ai' .moon/workspace.yml` returns no results
- Unit: `grep -r '@aikami/ai'` across the repo returns no results

## Implementation Notes

1. **Use `git mv`**: Preserves git history — use `git mv packages/constants packages/shared/constants`
2. **Update order**: Move all packages first, then update configs, then verify builds
3. **tsconfig paths**: Each package's tsconfig uses `"../` relative paths — these change when depth changes (e.g., `../../config/` → `../../../config/`)
4. **moon task inputs**: Most use `@group(sources)` which is relative — no change needed
5. **Root tsconfig.json**: Add all `packages/shared/*` references

## Edge Cases & Gotchas

- **node_modules**: Each package has its own `node_modules/` — these are gitignored but exist locally. Delete them after moving to avoid stale symlinks
- **storybook-static**: `packages/frontend/components/storybook-static/` should be gitignored or cleaned
- **Import aliases**: Some packages may use `$lib` or other aliases in addition to `@aikami/*` — verify all resolve
- **bun.lock**: Will be regenerated on next `bun install` — no manual update needed
