<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami `scripts/` project |
| **Target** | `/aikami/scripts/` |
| **Priority** | P1 — Required for developer onboarding, CI, and operational scripts |
| **Dependencies** | C-001 (clean root), C-005 (packages/shared/) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Create a `scripts/` project at the monorepo root for CI scripts, developer setup, monorepo maintenance, and operational tasks. Follow the aikami scripts pattern: a standalone moon project with its own package.json, tsconfig.json, and src/ directory. This replaces any ad-hoc scripts currently at the root level.

## Design Reference

**Aikami scripts/** structure:
```
scripts/
├── moon.yml
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point / CLI dispatcher
│   └── lib/
│       ├── setup.ts          # Developer onboarding / first-time setup
│       ├── dev_all.ts        # Start all dev services
│       ├── generate_llms_txt.ts  # Generate knowledge/llms.txt
│       ├── ci/
│       │   └── ...           # CI-specific scripts
│       ├── ops/
│       │   └── ...           # Operations scripts
│       └── utils.ts          # Script utilities
├── apps/                     # Script-associated app configs
└── temp/                     # Temporary script output (gitignored)
```

## Scripts to Create

| Script | Purpose |
|--------|---------|
| `src/lib/setup.ts` | Developer onboarding — install deps, sync moon, generate configs |
| `src/lib/dev_all.ts` | Start all dev services (Firebase emulators, Client dev server) |
| `src/lib/generate_llms_txt.ts` | Generate `knowledge/llms.txt` from knowledge directory |
| `src/lib/generate_context.ts` | Generate `knowledge/CONTEXT.md` from project metadata |
| `src/lib/cleanup_vendor_dirs.ts` | Run C-001 cleanup (remove AI vendor dirs) |
| `src/lib/validate_all.ts` | Run full CI validation (typecheck + lint + test) |

## Acceptance Criteria

### AC-1: Scripts Project Created
**Given** aikami has no `scripts/` directory
**When** this contract is implemented
**Then** `scripts/` exists with moon.yml, package.json, tsconfig.json, and src/ structure

**Test Hooks**:
- Unit: `test -f scripts/moon.yml && test -f scripts/package.json && test -f scripts/tsconfig.json`
- Unit: `test -f scripts/src/index.ts`

### AC-2: Registered as Moon Project
**Given** the scripts project
**When** moon sync runs
**Then** `scripts` appears in `.moon/workspace.yml` as `scripts: "scripts"`

**Test Hooks**:
- Unit: `bun moon sync` succeeds
- Unit: `bun moon run scripts:typecheck` succeeds

### AC-3: Setup Script Works
**Given** a fresh clone of the repo
**When** running `bun run scripts/src/lib/setup.ts`
**Then** all dependencies are installed, moon is synced, and required configs are generated

**Test Hooks**:
- Unit: Setup script exits with code 0
- Integration: After running setup, `bun moon run :typecheck` passes

### AC-4: generate_llms_txt.ts Works
**Given** the knowledge directory is populated (C-002)
**When** running the generation script
**Then** `knowledge/llms.txt` is generated with correct file index

**Test Hooks**:
- Unit: Script exits with code 0
- Unit: Generated `llms.txt` contains "AI-first entry point"
- Unit: Generated `llms.txt` lists all files in knowledge/ subdirectories

### AC-5: dev_all.ts Starts Services
**Given** Firebase project is configured
**When** running `bun run scripts/src/lib/dev_all.ts`
**Then** Firebase emulators start, Client dev server starts

**Test Hooks**:
- Integration: Script starts without errors
- Integration: Client is accessible at localhost

## Implementation Notes

1. **Copy moon.yml**: Copy structure from aikami `scripts/moon.yml`, adapt tags and description
2. **Copy tsconfig.json**: Copy from aikami, add `@aikami/` paths
3. **package.json**: `"name": "@aikami/scripts"`, dependencies on `@aikami/constants`, `@aikami/schemas`, `firebase-admin`
4. **Root package.json scripts**: Add `"setup": "bun run scripts/src/lib/setup.ts"`, `"dev:all": "bun run scripts/src/lib/dev_all.ts"`, `"knowledge:generate": "bun run scripts/src/lib/generate_llms_txt.ts"`
5. **Root moon.yml tasks**: Add `emulate-all` task (like aikami) that calls `dev_all.ts`
6. **Skip aikami-specific scripts**: Don't copy `lovable_setup.ts`, `lovable_sync.ts`, `generate_migration_manifest.ts` — aikami doesn't use Lovable

## Edge Cases & Gotchas

- **Firebase dependency**: Setup and dev scripts need Firebase tools installed — add to devDependencies or document as prerequisite
- **Scripts should be idempotent**: Running setup twice should be safe (skip already-completed steps)
- **temp/ directory**: Add to both root `.gitignore` and `scripts/.gitignore`
- **CLI entry point**: `src/index.ts` should dispatch subcommands (setup, dev, generate, validate) via a simple CLI argument switch
