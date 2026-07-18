---
description: Implement a contract from docs/contracts/ — plan → build → QA → docs → handoff
argument-hint: "[contract name or leave empty to pick next pending]"
---

# Contract Implementation Workflow

User input: $ARGUMENTS

Single-session flow. You are architect, coder, QA, and docs writer in sequence. You are NOT the final verifier — you hand off at `implemented` for independent verification.

**Load skills before writing any code:**
- `aikami-conventions` (ALWAYS first)
- If frontend UI / Svelte: also `svelte-conventions` + `aikami-ui`
- If game code: `pixijs-v8`
- If Cloud Functions: `firestack`
- Testing phase: `testing`

## Phase 0: Preflight

1. **Verify clean workspace**: 🔴 You run inside an isolated Git Worktree at `.pi/workspaces/` — `git` commands resolve correctly within the worktree. Use git:
   ```bash
   git status
   git log -1 --format="%H %s"
   ```
   The pipeline provisioned this worktree on top of `dev`. If `git status` shows unrelated in-flight changes, report them in your findings.

2. **🔴 Audit dev services**: Before analyzing any code, verify the running container infrastructure:
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

3. **Record baseline**: The run manifest already stores the base commit — no manual bookkeeping needed. Never write state to `/tmp`.

4. **Read the contract** fully: data model, ACs, Evidence Matrix, Scope, Quality Requirements, Open Questions.

5. **Check dependencies**: every contract in Dependencies must exist and have status `verified` or `completed`. If not, stop — build the dependency first.

6. **Read PROGRESS.md** — check in-progress/completed. If picking next: read INDEX.md for priority (INDEX.md is READ-ONLY).

7. **Run `moon_detect_affected`** to see current project state.

8. **Run baseline tests** for any related areas listed in Problem & Baseline Evidence:
   Use `moon_run_task({ target: "<project>:test" })` (Pi tool with built-in timeout):
   Record exact failing test IDs. These are the pre-existing failures — no new failures are allowed.

9. **Confirm status is `approved`**. If `draft`, stop — the contract is not ready for implementation.

## Phase 1: Plan (architect)

1. Draft a file plan (in your head — no plan files). Validate every planned path against the placement matrix:
   - Cross-project data shapes / types → `packages/shared/types/` — derived via `Static<typeof Schema>`
   - Runtime validation shapes → `packages/shared/schemas/` as TypeBox
   - Constants, labels, provider registries → `packages/shared/constants/`
   - UI state flags → `*_view_model.svelte.ts`
   - Game engine code → `packages/frontend/engine/`
   - ViewModels are thin bridges: no repository/Firestore/ticker imports
2. Check the Existing System & Reuse Map — reuse before creating.
3. 🔴 SvelteKit route groups use LITERAL parentheses: `(dev)`, never `\(dev\)`.
4. Lock scope: note every line in "In Scope" and "Out of Scope." Changes during implementation require an Amendment before continuing.

## Phase 2: Implement (coder)

**Set status to `in_progress`** before writing any code.

For each Acceptance Criteria, in order:

1. **Write or update the focused test FIRST** (domain logic, persistence, commands, schemas, regressions — TDD):
   - Unit test for logic/schemas → colocated or in `__tests__/`
   - E2E spec for user flows → `apps/e2e/tests/client/<feature>.spec.ts`
   - Visual suite → `apps/e2e/src/visual/suites/<feature>.visual.ts`
2. **Run the test — confirm it FAILS** for the expected reason.
3. **Implement** the code to make it pass.
4. **Run the test — confirm it PASSES.**
5. Proceed to the next AC.

Not every UI detail needs strict TDD, but domain logic, persistence, commands, schemas, and regressions MUST be test-driven.

**Conventions checklist** (per file):
- snake_case file names, `$logger` alias, package-root imports
- Types/schemas in `packages/shared/`, not `apps/`
- `type` aliases, never `interface`
- Arrow functions for module-level code, regular methods for classes
- `ClassName.create()`, never `new`
- Private `_` prefix on all private members
- Class methods auto-logged by `create()` — no manual `this.debug()` at method entry
- Run `moon_run_task` fix+typecheck per project — max 3 fix iterations per failure

**Sandbox rule**: A dev sandbox at `routes/(dev)/dev/<feature>/` is OPTIONAL. Create one only when it helps isolate:
- Pixi rendering or engine behavior
- A reusable component in controlled states
- A deterministic visual state for testing

**Production path is MANDATORY** for user-facing contracts. The feature must work through the real game/application flow, not just a sandbox.

**Scope change gate**: If you discover the contract's AC is wrong, STOP. Do NOT silently change scope. Instead:
1. Note the issue in the execution report under Deviations.
2. Propose an Amendment entry.
3. Continue with the approved AC if possible.
4. Let the user decide to amend or split.

## Phase 3: QA & Self-Verification

Do NOT skip. The contract must pass these before status becomes `implemented`.

1. **Self-audit** (deterministic greps on files you created/modified):
   - `pixi.js` / `@pixi/` imports in `*_view_model.svelte.ts` or `.svelte` files → violation
   - `app.ticker.add` outside `packages/frontend/engine/` → violation
   - `Type.Object|Array|String|...` inside `**/services/**` → violation
   - Label/dictionary constants in ViewModels → violation
   - `interface` keyword in new code → violation (use `type`)

2. **Run focused tests**: each AC's test from Phase 2. Record PASS/FAIL counts.

3. **🔴 Production path verification** (ALL user-facing contracts — MANDATORY, never skip):
   - **Abstract claims are BANNED.** You may NOT claim "route works" or "UI renders correctly"
     without visual evidence. Every production path AC must have a corresponding screenshot
     + ai_validate_image assertion.
   - Ensure client dev server is running: `herdr_session restart client` if routes were added.
     **🔴 If `herdr_session restart client` fails, capture the error log BEFORE claiming the
     server is down. You MUST show the failed restart attempt output.**
   - **`browser_screenshot` at the PRODUCTION route path** (NOT the dev sandbox route).
     The screenshot must capture the actual user-facing page, not an isolated sandbox.
   - **`ai_validate_image` with explicit AC expectations**. Score ≥ 85 required.
     Write a detailed expectation string that references specific AC criteria
     (layout, colors, text content, interactive elements).
   - **Test state persistence**: reload the page — state must survive if persistence is an AC.
   - **Test error paths**: trigger failures — must degrade cleanly.
   - **🔴 AUTO-FAIL**: If you claim you "cannot test because the dev server is down" without
     showing the failed `herdr_session start` / `herdr_session restart` log output,
     your stage will be automatically failed. The pipeline environment provides dev servers.

4. **Sandbox check** (only if you created one):
   - `browser_screenshot` the sandbox route.
   - `ai_validate_image` — used for visual regression, not as primary completion gate.

5. **Baseline regression check**: Run the same tests from Phase 0 step 7. New failures = stop and fix.

## Phase 4: Validate

1. `validate({ test: true })` — fix+typecheck+build+test on all affected.
2. If errors: fix and re-run until clean.
3. Walk each AC and confirm it is actually met — no aspirational ✅.

## Phase 5: Docs

Decide from the contract's Target/Overview:
- **User-facing feature** → write/update a SHORT page (1-3 paragraphs, link to source) in `apps/frontend/docs/src/content/docs/`.
- **Internal/refactor/infra** → no docs page.
- Either way, the execution report (Phase 6) is mandatory.

## Phase 6: Handoff

**Set status to `implemented`** — NOT `completed`. The independent verifier promotes it to `verified`.

1. Update the `**Status**` metadata field to `implemented`.
2. Append the Execution Report to the BOTTOM of the contract file:

```markdown
## Execution Report

### Summary
{2-4 sentences — what was built, what was deferred}

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅/⚠️/❌ | {one-line note — be honest} |

### Files Created
| File | Purpose |
|---|---|
| `{path}` | {description} |

### Files Modified
| File | Change |
|---|---|
| `{path}` | {description} |

### Deviations from Spec
{Any AC change, scope expansion/reduction, or unplanned work. If the contract's AC was wrong, note it here and propose an Amendment.}

### Test Results
- Unit: {PASS}/{total} ({FAIL} failures)
- E2E: {PASS}/{total} ({FAIL} failures)
- Visual: Score {N}/100 — {PASS/FAIL}
- Baseline: {N} pre-existing failures, {N} new failures
```

3. Knowledge sync ownership:
   - Automated contract pipeline (`CONTRACT_PIPELINE_RUN_ID` set): do **not** run `bun knowledge:sync`; the pre-commit hook regenerates and stages contract dashboards.
   - Manual `/contract` session: run `bun knowledge:sync` when reviewers need PROGRESS.md updated before commit.
   - 🔴 NEVER hand-edit PROGRESS.md, PROMOTION.md, or INDEX.md.

4. Present a diff summary + suggested Conventional Commit message:
   ```
   feat(client): {brief description} (C-XXX)
   ```

5. **Do NOT commit or push** without explicit instruction. Ask: "Handoff complete. Ready for independent verification via /contract-verify. Stage for commit?"

## Hard Rules

- Never push without explicit instruction
- One contract at a time
- `validate()` for final verification
- `moon_run_task` for per-project operations
- 🔴 NEVER run raw shell `bun moon run` or `bun test` — use the Pi tools `moon_run_task` and `validate()` which have built-in timeouts. Raw shell commands will hang forever on large test suites.
- 🔴 NEVER run long-lived servers in the main thread — use `herdr_session` / `firebase_emulator`
- 🔴 **In worktrees, always restart services before testing**: `herdr_session restart client firebase voice image text`. The main repo's dev servers are running the wrong code — you must restart from the worktree CWD.
- 🔴 Route groups: literal `(dev)` — a `\(dev\)` directory breaks the route tree
- 🔴 **Retry: when the verifier bounces changes back**, your task message includes the findings under "🔴 Verifier requested changes". Read them, fix each issue, run the affected tests, then call `contract_stage_complete`. Do NOT re-call without making code changes.
- Report failures honestly — a partial implementation with a truthful report beats a fake ✅
- End at `implemented`, never `completed` — the verifier handles the rest
- Scope changes without an Amendment entry prevent `verified` status
- **Shared sections**: `Promotion Lifecycle` and `Status Lifecycle` reference `docs/contracts/SHARED_SECTIONS.md`. Do not re-read, re-implement, or re-verify them — they are static project-wide material outside this contract's scope.
