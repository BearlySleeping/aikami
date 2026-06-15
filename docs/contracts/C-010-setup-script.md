## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami `scripts/src/lib/setup.ts` pattern + intro/setup.md |
| **Target** | `/aikami/scripts/src/lib/setup.ts` |
| **Priority** | P2 — Quality of life for developers; not blocking |
| **Dependencies** | C-007 (scripts project), C-008 (.moon setup) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Create an interactive setup script that onboards new developers to the aikami monorepo. The script should check prerequisites, install dependencies, generate required configs, and verify the environment is ready for development.

## Design Reference

**Aikami setup** (`knowledge/intro/setup.md` and `scripts/src/lib/setup.ts`):
- Prerequisite checks (Bun, Node, Firebase CLI, git)
- Dependency installation (`bun install`)
- Moon synchronization (`bunx moon sync`)
- Firebase project configuration
- Environment file generation
- Verification step (typecheck passes)

## Setup Script Flow

```
┌─────────────────────────────────┐
│ 1. Check prerequisites          │
│    - Bun >= 1.x                 │
│    - Node.js >= 22              │
│    - git                        │
│    - Firebase CLI (optional)    │
│    - moon CLI (via bun)         │
└────────────┬────────────────────┘
             ↓
┌─────────────────────────────────┐
│ 2. Install dependencies         │
│    - bun install                │
│    - bun moon sync              │
└────────────┬────────────────────┘
             ↓
┌─────────────────────────────────┐
│ 3. Configure environment        │
│    - Copy .env.example → .env   │
│    - Prompt for Firebase proj   │
│    - Generate Firebase config   │
└────────────┬────────────────────┘
             ↓
┌─────────────────────────────────┐
│ 4. Verify setup                 │
│    - bun moon run :typecheck    │
│    - bun moon run :test --affected│
└────────────┬────────────────────┘
             ↓
┌─────────────────────────────────┐
│ 5. Print next steps             │
│    - How to start dev server    │
│    - Where docs are             │
│    - How to run tests           │
└─────────────────────────────────┘
```

## Acceptance Criteria

### AC-1: Prerequisite Checks
**Given** a developer machine that may or may not have required tools
**When** the setup script runs
**Then** it checks for Bun, Node.js, git, and Firebase CLI, reporting missing tools with install instructions

**Test Hooks**:
- Unit: Test with missing Bun → script exits with helpful error
- Unit: Test with all tools installed → script proceeds

### AC-2: Dependency Installation
**Given** prerequisites are met
**When** the script runs `bun install` and `bun moon sync`
**Then** all workspace dependencies and moon project links are established

**Test Hooks**:
- Integration: After running, `bun moon run :typecheck` succeeds

### AC-3: Environment Configuration
**Given** no `.env` file exists
**When** the script runs
**Then** it either generates a `.env` from template or prompts the user for required values

**Test Hooks**:
- Unit: `.env` file exists after setup
- Unit: `.env` contains required Firebase variables (or placeholders with instructions)

### AC-4: Verification Step
**Given** setup is complete
**When** the script runs verification
**Then** typecheck and test pass (or clear error messages if they don't)

**Test Hooks**:
- Integration: Script exits 0 only if verification passes
- Unit: Script reports each check (typecheck, test, lint) with pass/fail status

### AC-5: Idempotent
**Given** setup has already been run
**When** setup runs again
**Then** it skips already-completed steps or confirms overwrites

**Test Hooks**:
- Unit: Running setup twice exits successfully without errors
- Unit: Existing `.env` is not overwritten without confirmation

### AC-6: Next Steps Output
**Given** setup completes successfully
**When** the script finishes
**Then** it prints clear next steps: how to start dev, how to run tests, where docs are

**Test Hooks**:
- Unit: Output contains `bun run dev` or equivalent
- Unit: Output references `knowledge/CONTEXT.md`

## Implementation Notes

1. **Place at `scripts/src/lib/setup.ts`**: Callable via `bun run scripts/src/lib/setup.ts` or as `bun run setup` (if added to root package.json)
2. **Use Bun native APIs**: `Bun.which()`, `Bun.spawn()`, `Bun.file()` — no extra dependencies needed
3. **Interactive prompts**: Use `readline` or simple `process.stdin` for prompting Firebase project ID, etc.
4. **Firebase CLI**: Make optional — allow development without Firebase (for frontend-only work)
5. **Add to root package.json**: `"setup": "bun run scripts/src/lib/setup.ts"`
6. **Error handling**: Every step should have clear error messages with remediation steps

## Edge Cases & Gotchas

- **Fresh clone**: Must work from `git clone` with zero local state
- **Partial setup**: If a previous setup failed halfway, the script should recover gracefully
- **CI environment**: Script should detect CI (CI=true) and skip interactive prompts
- **Different OS**: macOS and Linux should both work (Bun handles cross-platform well)
- **Firebase project**: Two developers may use different Firebase projects — support per-developer Firebase config
