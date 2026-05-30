## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami `.moon/` setup |
| **Target** | `/aikami/.moon/` |
| **Priority** | P1 — Required for consistent task orchestration across all projects |
| **Dependencies** | C-005 (packages/shared/ restructured), C-006 (frontend configs), C-007 (scripts) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Enhance the `.moon/` setup by copying task templates, git hooks, and inherited tasks from aikami. Currently aikami has only `workspace.yml` and `toolchains.yml` — missing task templates and hooks. This contract adds the full aikami moon orchestration layer.

## Design Reference

**Aikami `.moon/`** full structure:
```
.moon/
├── workspace.yml               # Project registry, VCS config, pipeline
├── toolchains.yml              # Toolchain config
├── tasks/
│   └── all.yml                 # Global inherited tasks (all projects)
├── task-templates/
│   ├── typescript-library.yml  # For library packages
│   ├── vite-application.yml    # For SvelteKit/Vite apps
│   └── firebase-functions.yml  # For Firebase Cloud Functions
├── hooks/
│   ├── pre-commit              # Git pre-commit hook
│   ├── post-merge              # Post-merge sync
│   └── post-checkout           # Post-checkout sync
└── cache/
    └── CACHEDIR.TAG            # Cache marker
```

## Changes Detail

### 1. `.moon/tasks/all.yml` — Global Inherited Tasks
Copy from aikami. Defines file groups and tasks inherited by ALL projects:
- `sources`, `configs`, `root-configs`, `deployment`, `tests`, `assets` file groups
- `typecheck`, `format`, `lint`, `test`, `fix`, `validate` tasks
- All tasks use `bun run <name>` — delegates to each project's package.json scripts

### 2. `.moon/task-templates/` — Task Templates
Copy all three templates from aikami:
- **typescript-library.yml**: For packages/shared/*, packages/backend/*, packages/frontend/* — vitest, biome, tsc
- **vite-application.yml**: For apps/frontend/pwa, apps/frontend/docs, apps/frontend/landing_page — vite build, preview, dev
- **firebase-functions.yml**: For apps/backend/functions — firebase deploy, emulator

### 3. `.moon/hooks/` — Git Hooks
Copy from aikami, adapt for aikami:
- **pre-commit**: Currently disabled in aikami (commented out). For aikami, enable a lightweight check
- **post-merge**: `bunx moon sync` (no knowledge:pull or lovable:sync for aikami)
- **post-checkout**: `bunx moon sync`

### 4. `.moon/workspace.yml` — Enhance
Add aikami features currently missing:
- `vcs.hooks` configuration
- `pipeline` configuration (cacheLifetime, syncProjects, etc.)
- `hasher` configuration
- `experiments` (asyncAffectedTracking)

## Acceptance Criteria

### AC-1: tasks/all.yml Created
**Given** `.moon/tasks/` does not exist
**When** this contract is implemented
**Then** `.moon/tasks/all.yml` exists with inherited task definitions

**Test Hooks**:
- Unit: `test -f .moon/tasks/all.yml`
- Unit: File contains `typecheck`, `format`, `lint`, `test`, `fix`, `validate` task definitions
- Unit: All tasks use `command: 'bun run <name>'`

### AC-2: Task Templates Created
**Given** `.moon/task-templates/` does not exist
**When** this contract is implemented
**Then** three task templates exist: typescript-library.yml, vite-application.yml, firebase-functions.yml

**Test Hooks**:
- Unit: `test -f .moon/task-templates/typescript-library.yml`
- Unit: `test -f .moon/task-templates/vite-application.yml`
- Unit: `test -f .moon/task-templates/firebase-functions.yml`

### AC-3: Git Hooks Configured
**Given** `.moon/hooks/` does not exist
**When** this contract is implemented
**Then** post-merge and post-checkout hooks exist

**Test Hooks**:
- Unit: `test -f .moon/hooks/post-merge && test -f .moon/hooks/post-checkout`
- Unit: Post-merge contains `bunx moon sync`

### AC-4: workspace.yml Enhanced
**Given** the current `.moon/workspace.yml` is minimal
**When** this contract is implemented
**Then** it includes vcs.hooks, pipeline, hasher, and experiments sections

**Test Hooks**:
- Unit: `grep 'pipeline:' .moon/workspace.yml` returns results
- Unit: `grep 'hasher:' .moon/workspace.yml` returns results
- Unit: `bun moon sync` succeeds

### AC-5: Workspace Projects Updated
**Given** workspace.yml lists all projects
**When** this contract is implemented
**Then** it reflects the new package structure (C-005, C-006) and scripts project (C-007)

**Test Hooks**:
- Unit: workspace.yml includes `scripts: "scripts"`
- Unit: workspace.yml includes `frontend-configs: "packages/frontend/configs"`
- Unit: Shared packages use `packages/shared/` paths

### AC-6: Inherited Tasks Work
**Given** all project moon.yml files reference inherited tasks
**When** running `bun moon run :typecheck`
**Then** it runs typecheck on all projects

**Test Hooks**:
- Unit: `bun moon run :typecheck` executes across all projects
- Unit: Projects without explicit `typecheck` task inherit it from all.yml

## Implementation Notes

1. **Copy tasks/all.yml**: Nearly identical to aikami — copy, then update any aikami-specific file paths
2. **Copy task templates**: Copy all three, adjust comments (remove aikami-specific project references)
3. **Hooks**: Copy post-merge and post-checkout. For pre-commit, start with just `git diff` passthrough (like aikami's current state), leave a comment about enabling `:fix --affected` later
4. **workspace.yml merge**: Start with aikami's current workspace.yml, ADD the aikami features (vcs, pipeline, hasher, experiments), don't overwrite the project list
5. **defaultProject**: Set to `pwa` (matches aikami's `"dev": "moon run pwa:dev"`)
6. **vcs.defaultBranch**: Set to `master` (matches aikami's current branch)

## Edge Cases & Gotchas

- **enforceLayerRelationships**: Keep `false` like aikami — layers are advisory
- **Pre-commit hook**: Don't enable `:fix --affected` in pre-commit yet — it can be slow. Add as commented-out example
- **firebase-functions template**: Verify it works with aikami's functions structure
- **toolchains.yml**: Aikami already has this — no change needed unless aikami has different toolchain versions
