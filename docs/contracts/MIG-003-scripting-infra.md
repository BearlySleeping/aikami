<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami reference: `scripts/src/lib/` — deploy/, ops/, setup/, test_blackbox/ subdirectories |
| **Target** | `scripts/src/lib/` — reorganize into domain folders matching Aikami hierarchy |
| **Priority** | P0 — structural prerequisite for future deploy/setup scripts |
| **Dependencies** | None |
| **Status** | **completed**  |
| **Contract version** | 1.0.0 |

## Overview

Restructure Aikami's `scripts/` package from a flat `src/lib/` directory (with `test_blackbox/` at `src/` level) to the Aikami hierarchy where `deploy/`, `ops/`, `setup/`, and `test_blackbox/` all live under `scripts/src/lib/`. Extract inline CLI utilities from `index.ts` into a shared `cli_utils.ts` file. This aligns the scripting infrastructure architecture between the two codebases, enabling consistent module resolution and making it straightforward to port scripts between repos.

## Design Reference

**Aikami pattern**: `scripts/src/lib/{deploy,ops,setup,test_blackbox}/`

Key structural elements:
- `scripts/src/lib/deploy/` — deployment scripts (index, plan, secrets, notification, prepare_package)
- `scripts/src/lib/ops/` — operational scripts (dev_all, add_user, sync_env, logs, etc.)
- `scripts/src/lib/setup/` — developer setup scripts (project, firebase, gmail_oauth, etc.)
- `scripts/src/lib/test_blackbox/` — blackbox integration test suite
- `scripts/src/lib/cli_utils.ts` — shared CLI helpers (colors, prompts, command execution)
- `scripts/src/index.ts` — script runner with SCRIPT_MAP, findScripts (recursive), interactive mode

## Changes Detail

### Directory restructure

Current flat layout:
```
scripts/src/
  index.ts
  lib/
    cleanup_vendor_dirs.ts
    dev_all.ts
    generate_context.ts
    generate_llms_txt.ts
    setup.ts
    validate_all.ts
  test_blackbox/          ← wrong location (should be inside lib/)
    ...
```

New Aikami-aligned layout:
```
scripts/src/
  index.ts
  lib/
    cli_utils.ts           ← NEW: extracted from index.ts inline utilities
    deploy/                ← NEW: empty directory for future deploy scripts
    ops/
      cleanup_vendor_dirs.ts
      dev_all.ts
      generate_context.ts
      generate_llms_txt.ts
      validate_all.ts
    setup/
      setup.ts
    test_blackbox/         ← moved from src/test_blackbox/
      dev_server_manager.ts
      emulator_manager.ts
      reporter.ts
      run.ts
      suites/
        functions.api.ts
        client.e2e.ts
        schema_check.ts
      test_runner.ts
      types.ts
```

### File changes

1. **New file**: `scripts/src/lib/cli_utils.ts` — extract color constants, log, ok, error, warn helpers from index.ts (mirroring Aikami's cli_utils.ts)
2. **Modified**: `scripts/src/index.ts` — update SCRIPT_MAP entries, import from cli_utils, add EXCLUDED_FILES
3. **Modified (5 moved scripts)**: Fix `PROJECT_ROOT`/`ROOT` from `../../..` → `../../../..` in dev_all.ts, generate_context.ts, generate_llms_txt.ts, cleanup_vendor_dirs.ts, setup.ts
4. **Modified**: `package.json` (root) — update 4 script paths

## Acceptance Criteria

### AC-1: Directory structure matches Aikami
**Given** the monorepo is checked out
**When** listing `scripts/src/lib/`
**Then** the directories `deploy/`, `ops/`, `setup/`, and `test_blackbox/` exist, and the file `cli_utils.ts` exists

**Test Hooks**:
- Unit: `test -d scripts/src/lib/deploy && test -d scripts/src/lib/ops && test -d scripts/src/lib/setup && test -d scripts/src/lib/test_blackbox`
- Integration: N/A
- CI: `moon run scripts:typecheck` passes

**Watch Points**:
- Empty `deploy/` directory must still exist to mirror Aikami

### AC-2: Script runner resolves all scripts correctly
**Given** the monorepo is set up with `bun install`
**When** running `bun run scripts -- validate` or `bun run scripts -- setup`
**Then** the script runner resolves via SCRIPT_MAP, finds the file in its new subdirectory, and runs it

**Test Hooks**:
- Unit: `bun run scripts/src/index.ts -- validate_all` exits 0
- Integration: `bun run scripts` interactive mode lists all scripts correctly
- CI: N/A

**Watch Points**:
- The `test_blackbox` entries must now be `test_blackbox/run.ts` (not `../test_blackbox/run.ts` since test_blackbox is inside lib/)

### AC-3: Moved scripts find project root correctly
**Given** any moved script that references the monorepo root
**When** it resolves `import.meta.dir` from its new deeper location
**Then** the `../../..` → `../../../..` path adjustment correctly reaches the monorepo root

**Test Hooks**:
- Unit: `bun run scripts/src/lib/ops/dev_all.ts --help` resolves FIREBASE_DIR and PWA_DIR correctly
- Integration: `bun run scripts/src/lib/setup/setup.ts` in CI mode passes prerequisite checks
- CI: N/A

**Watch Points**:
- `validate_all.ts` has no root-path references, so it requires no changes

### AC-4: Root package.json scripts work with new paths
**Given** the root `package.json` has been updated
**When** running `bun run setup`, `bun run dev:all`, `bun run knowledge:generate`, or `bun run test:blackbox`
**Then** the correct script in the new subdirectory is invoked

**Test Hooks**:
- Unit: grep package.json for old paths (`scripts/src/lib/setup.ts` without `/setup/`) returns nothing
- Integration: N/A
- CI: N/A

**Watch Points**:
- `bun run scripts` entry (which launches the runner) needs no change

## Implementation Notes

1. **Files to create**: `scripts/src/lib/cli_utils.ts`
2. **Files to modify**: `scripts/src/index.ts`, `package.json` (root), `dev_all.ts`, `generate_context.ts`, `generate_llms_txt.ts`, `cleanup_vendor_dirs.ts`, `setup.ts`
3. **Files to delete**: None (moved, not deleted)
4. **Order of operations**: create dirs → move test_blackbox → move flat scripts → create cli_utils → update index.ts → fix paths → update package.json
5. **Verification**: `moon run scripts:typecheck` must pass, `bun run scripts` interactive mode must list all scripts correctly

## Edge Cases & Gotchas

- **Empty deploy/ directory**: Git does not track empty directories. Create a `.gitkeep` or mention in CONTEXT.md that the directory exists. Aikami does NOT have a .gitkeep — check if deploy/ is empty there. If so, copy the approach.
- **test_blackbox relative imports**: All test_blackbox files use same-dir (`./`) or parent (`../`) imports relative to each other. Since they all move as a unit into `lib/test_blackbox/`, no changes needed.
- **moon.yml sources glob**: Currently `src/lib/**/*.ts` — test_blackbox files moving INTO `src/lib/` are now covered by this glob (previously they were at `src/test_blackbox/`). Add explicit test_blackbox fileGroup if needed. Verify moon's glob resolution.
