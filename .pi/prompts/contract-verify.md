---
description: Independently verify a contract implementation — replay ACs, inspect diff, run tests, fix trivial issues, bounce structural ones
argument-hint: "docs/contracts/C-XXX-....md"
---

# Contract Verification

Contract: $ARGUMENTS

You are an **independent verifier**. Your job is to challenge every claim, run tests, and either pass the contract or return actionable feedback.

**Load `aikami-conventions` before any code inspection.**

## 🔴 Verifier Mode: Fix trivial, bounce structural

You have TWO options after inspecting the code:

### Fix directly (call `contract_stage_complete` with `passed`)
Fix these yourself — it's faster than bouncing:
- Missing test stubs / empty test files
- Typos, formatting, minor convention violations
- Missing barrel exports, wrong import paths
- Hardcoded values that should reference constants
- Missing `@aikami/frontend-components` imports when using HUD components

After fixing: run affected tests, commit your changes, call `contract_stage_complete` with `passed`.

### Bounce back (call `contract_stage_complete` with `changes_requested`)
Bounce these — you can't fix them safely:
- Missing AC implementation (entire feature not built)
- Design flaws that need architectural changes
- Scope violations (files outside contract boundaries)
- ACs that are fundamentally wrong or incomplete
- New baseline test failures

## On Retry (attempt > 1)

When the pipeline sends you back after a bounce:

1. **Check what changed**: `git diff HEAD~1 --name-only` — if nothing changed, the implementer didn't fix anything.
2. **If nothing changed**: Call `contract_stage_complete` with `changes_requested` immediately — don't re-run all tests.
3. **If changes exist**: Run only the tests relevant to the changed files. Don't re-verify everything from scratch.

## Phase 0: Preflight

1. **🔴 Audit dev services**: Before analyzing any code, verify the running container infrastructure:
   ```bash
   herdr_session list
   ```
   - `firebase` must be `running` (or started via `firebase_emulator start`)
   - `client` must be `running` (or started via `herdr_session start client`)
   - If ANY service is unresponsive, you MUST restart it before proceeding:
     ```bash
     herdr_session restart firebase
     herdr_session restart client
     ```
   - **🔴 AUTO-FAIL RULE**: If you claim a server is down or unreachable without
     first showing the output of a failed `herdr_session start` or `herdr_session restart`
     attempt, your stage will be automatically failed. You MUST attempt to start/restart
     the service and show the error log before claiming it is unavailable.

2. Read the contract file completely — ACs, Evidence Matrix, Test Hooks, Scope.
3. Read any execution report — note what the implementer claims.
4. Check git state:
   ```bash
   git status
   git diff --name-only
   git log -1 --format="%H %s"
   ```
5. Contract status should be `implemented` or `approved`.

## Phase 1: Structural Audit

1. **Required files exist**: Every file in Evidence Matrix + execution report must exist.
2. **Test files exist**: Every test in Test Hooks must exist.
3. **No placeholders**: No `{TEMPLATE}` markers in contract.
4. **Scope boundaries**: No files modified outside contract's In Scope.
5. **Convention audit**: No pixi.js in ViewModels, no app.ticker outside engine, no TypeBox in services.

## Phase 2: Evidence Reconstruction

For EVERY AC:

1. Find the implementing files
2. Find the test files
3. Run tests: `moon_run_task({ target: "<project>:test" })`

## Phase 3: 🔴 Live Verification (MANDATORY — never skip)

**Abstract claims are BANNED.** You may NOT claim "route works" or "UI renders correctly"
without visual evidence. Every production path AC must have a corresponding screenshot
+ ai_validate_image assertion.

1. **Restart dev services from the worktree context**:
   ```bash
   herdr_session restart firebase
   herdr_session restart client
   ```
   **🔴 If any restart fails, capture the error log BEFORE claiming the server is down.
   You MUST show the failed restart attempt output. Do NOT skip verification because
   "the server is down" — the pipeline environment provides dev servers.**

2. **Screenshot + validate each production path**:
   - `browser_screenshot` at the **production route path** (NOT the dev sandbox route)
   - `ai_validate_image` with explicit AC expectations. Score ≥ 85 required.
   - Write a detailed expectation string that references specific AC criteria.

3. **Test error paths + persistence**: reload the page, trigger failures, verify clean degradation.

## Phase 4-5: Quality + Cross-Cutting

- Quality Requirements from contract
- No new baseline failures: `validate({ test: true })`

## Phase 6: Fix or Bounce

| Issue type | Action |
|---|---|
| Missing test stubs, typos, imports, formatting | ✏️ Fix yourself → `passed` |
| Missing AC, design flaw, scope violation, regression | ↩️ Bounce → `changes_requested` with clear instructions |

### When bouncing, write instructions the implementer can act on:

```markdown
## 🔴 Changes Required

### 1. Missing test: `input_action_service.test.ts`
**File to create:** `apps/frontend/client/src/lib/services/game/input_action_service.test.ts`
**What to test:** Device tracking debounce, gamepad→keyboard switching, action dispatch
**Example:** See `interaction_proximity_system.test.ts` for test structure

### 2. AC-5 reduced-motion incomplete
**File to fix:** `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte:44`
**Current:** `reducedMotion={false}` hardcoded
**Needed:** Read `window.matchMedia('(prefers-reduced-motion: reduce)')` and pass result
```

### When fixing, report what you changed:

```markdown
## ✅ Verified (with fixes)

### Fixes applied
- Added test stubs for `input_action_service.test.ts` (3 test cases)
- Fixed `reducedMotion` to use media query
- Re-imported `keyToDisplayLabel` from `@aikami/constants`

### Test results
- Engine: 783/783 PASS
- New tests: 3/3 PASS
```

## Verdict template

```markdown
## Verification Verdict: {PASS | CHANGES_REQUESTED}

### AC Evidence
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅/⚠️/❌ | ... |

### Fixes applied (if any)
- {list}

### Bounced issues (if any)
- {specific instructions}

### Test Results
{pass/fail counts}

### Verdict
PASS / CHANGES_REQUESTED — {summary}
```

## Rules

- **Fix trivial, bounce structural** — don't bounce for something you can fix in 2 minutes.
- **On retry, check git diff first** — don't re-run everything if nothing changed.
- **Write actionable instructions** — file paths, line numbers, what to change.
- **Never mark `completed`** — only `verified` or `verification_failed`.
- 🔴 **Use Pi tools for tests** — `moon_run_task`, `validate()`.
- 🔴 **Restart dev services before testing**: `herdr_session restart client firebase voice image text`.
