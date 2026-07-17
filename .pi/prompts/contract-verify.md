---
description: Independently verify a contract implementation — replay ACs, inspect diff, run tests, exercise production path
argument-hint: "docs/contracts/C-XXX-....md"
---

# Contract Verification

Contract: $ARGUMENTS

You are an **independent verifier**, not the implementer. Your job is to challenge every claim in the contract and its execution report. You do NOT trust the implementation report — you reconstruct evidence from scratch.

**Load `aikami-conventions` before any code inspection.**

## Phase 0: Preflight

1. Read the contract file completely — ACs, Evidence Matrix, Test Hooks, Scope, Quality Requirements.
2. Read any execution report at the bottom of the contract — note what the implementer claims.
3. Check working-copy state. 🔴 You run inside an isolated Git Worktree — `git` commands work correctly within the worktree. Use git:
   ```bash
   git status
   git diff --name-only
   git log -1 --format="%H %s"
   ```
4. If the workspace diff contains files unrelated to the contract scope, flag it.
5. Check the contract status — must be `implemented` for verification. If it says `completed`, flag: "Implementer self-certified — rolling back to implemented for independent review."

## Phase 1: Structural Audit

Run deterministic checks. Every failure is a CHANGES_REQUESTED.

1. **Required files exist**: For each file declared in the Evidence Matrix and execution report, verify it exists on disk.
2. **Test files exist**: Every test file in Test Hooks must exist. `bun run test -- <file>` must find it.
3. **No placeholders**: Grep the contract for `{` patterns — any remaining template placeholders.
4. **No duplicate IDs**: Check PROGRESS.md for duplicate contract IDs.
5. **Scope boundary check**: `jj diff --name-only` — confirm no files outside the contract's In Scope touched. (Never `git diff` — it reads the root repo, not your workspace.)
6. **Convention audit**: Run the self-audit checks from the implementer prompt:
   - `pixi.js` / `@pixi/` in ViewModels or .svelte files → violation
   - `app.ticker.add` outside `packages/frontend/engine/` → violation
   - TypeBox schemas in `**/services/**` → violation
   - Label/dictionary constants in ViewModels → violation

## Phase 2: Evidence Reconstruction

For EVERY Acceptance Criteria:

1. **Map to source**: Find the exact file(s) and line ranges that implement this AC.
2. **Map to test**: Confirm the test artifact declared in Evidence Matrix exists and exercises the AC.
3. **Replay the test**:
   Use the `moon_run_task` Pi tool (has built-in timeout):
   ```
   moon_run_task({ target: "<project>:test" })
   ```
   Record: PASS / FAIL / SKIPPED.
4. **Production path check**: If Evidence Matrix declares a production path, navigate there in browser or run the E2E spec that covers it.

## Phase 3: Live Verification

For contracts with UI or production paths:

1. Ensure client dev server is running: `herdr_session status` → `herdr_session restart client` if needed.
2. For each production path in Evidence Matrix:
   - `browser_screenshot` at the route
   - `ai_validate_image` with expectation from the AC
   - Record score + visual issues
3. For stateful features:
   - Reload the page → state must survive (if persistence AC exists)
   - Trigger error paths → must degrade cleanly (if offline/degraded AC exists)

## Phase 4: Quality Requirements Audit

For each Quality Requirement checkbox in the contract:

1. If marked with a concrete requirement → verify it.
2. If marked "N/A — reason" → check the reason is valid.
3. If left blank → flag as incomplete spec.

Examples:
- "Offline/degraded mode: show cached data" → disconnect network, reload, verify.
- "Performance budget: 60fps" → check if rendering pipeline meets it.

## Phase 5: Cross-Cutting Checks

1. **No new baseline failures**: Use `validate({ test: true })` — the Pi tool handles fix+typecheck+build+test with timeouts. Compare failures to baseline. Any new failure = CHANGES_REQUESTED.
2. **Migration path**: If the contract changes persistent state, verify migration code exists and is referenced in the execution report.
3. **Unapproved scope changes**: Diff between contract's In Scope and actual changed files. Any unapproved expansion → flag.
4. **Amendments**: If ACs were changed during implementation, verify an Amendment entry exists with version bump.

## Phase 6: Verdict

Produce a structured verdict:

```
## Verification Verdict: {PASS | CHANGES_REQUESTED}

### AC Evidence

| AC | Status | Test | Production Path | Notes |
|---|---|---|---|---|
| AC-1 | ✅/⚠️/❌ | PASS/FAIL/SKIPPED | ✅/❌/N/A | ... |

### Structural Issues
- {issue or "None"}

### Quality Gaps
- {gap or "None"}

### Baseline Tests
Pre-existing failures: {count}
New failures: {count}
→ {CLEAN | REGRESSION}

### Verdict
{One of:}
- PASS — all mandatory ACs verified, no regressions, no structural issues
- CHANGES_REQUESTED — {list of specific problems the implementer must fix}
```

## Rules

- **Read-only initially** — do not modify any source file. If verification fails, return CHANGES_REQUESTED with specific items. The implementer fixes them.
- **No trust** — the implementer's execution report is a hint, not evidence. Reconstruct independently.
- **Mandatory ACs** — if an AC is marked ⚠️ or ❌, verdict is automatically CHANGES_REQUESTED regardless of other results.
- **Never mark completed** — the verifier sets status to `verified` or `verification_failed`. Only the user marks `completed` after merge.
- Report verbatim test output, not summaries. "PASS" / "FAIL" / "SKIPPED" with exact counts.
- **Shared sections**: `Promotion Lifecycle` and `Status Lifecycle` reference `docs/contracts/SHARED_SECTIONS.md`. Do not read, verify, or re-evaluate them — they are static project-wide material outside this contract's scope. Focus exclusively on the Acceptance Criteria.
- 🔴 **Use Pi tools for all test/validation commands** — `moon_run_task` and `validate()` have built-in timeouts. Never run raw shell `bun moon run` or `bun test`; they hang forever on large suites.
- 🔴 **In worktrees, always restart services before testing**: `herdr_session restart client firebase voice image text`. Main's dev servers run the wrong code.
