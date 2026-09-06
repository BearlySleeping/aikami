---
id: C-486
title: "Replace the conditional release gate with one unconditional journey"
source: direct
contract_type: full
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-07T00:00:00Z"
---

# Contract C-486: Replace the conditional release gate with one unconditional journey

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-486, seeded from the 2026-09-06 external review (`docs/research/astra-game-review.md`); tightens the gate established by [C-335](C-335-enforce-the-playable-demo-release-gate.md) |
| **Target** | `apps/e2e/tests/client/release_gate.spec.ts`, `apps/e2e/src/pom/game_page.ts` |
| **Type** | full |
| **Priority** | P0 — the gate currently cannot fail for the reasons it exists |
| **Dependencies** | None. C-495 extends this journey later — leave the spec structured for that. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |
| **Execution** | Target 2–6 changed files, hard stop at 12. Product bugs the tightened gate surfaces are filed, not fixed here. |

## Problem & Baseline Evidence

The release gate is the repo's single strongest claim that the demo is playable. Three independently verified weaknesses mean it can pass on a build that a player cannot start, that never fights, and that loses state on reload.

- **Current behavior — wrong front door (V-11)**: `apps/e2e/tests/client/release_gate.spec.ts:64` matches `page.getByRole('button', { name: /new game|start|play/i })`. The production start menu renders **"New Adventure"** (`apps/frontend/client/src/lib/views/start/start_view.svelte:90`), which that regex cannot match. The keyboard journey repeats the same regex at `:252`. Whatever the spec currently clicks, it is not the front door the player uses.
- **Current behavior — conditional combat (V-12)**: `release_gate.spec.ts:116-121` reads combat visibility with `.isVisible(...).catch(() => false)` and then runs the entire combat leg inside `if (inCombat)`. A build that never enters combat passes the combat leg by skipping it.
- **Current behavior — vacuous state assertion (V-13)**: `:476` captures `hpBefore`, and `:500` asserts only `expect(hpAfter).toBeGreaterThan(0)`; the two values are never compared. A save/load that resets HP to full passes "HP preserved". (Inventory is already compared exactly at `:508` — that is the pattern HP should follow.)
- **Reproduction**: read the three sites above; then `grep -c "if (" apps/e2e/tests/client/release_gate.spec.ts` → 15 conditional branches in a 524-line gate.
- **Existing implementation to reuse**: `apps/e2e/src/pom/game_page.ts` already owns the journey vocabulary — `gotoColdLaunch()` (`:62`), `waitForPlayingState()` (`:107`), `expectCombatActive()` (`:324`), `clickAttack()` (`:332`), `expectCombatEnded()` (`:352`), `expectCurrentObjective()` (`:397`), `saveGame()` (`:190`), `reloadAndWaitForBoot()` (`:419`), `getPlayerHp()` (`:431`). The tightening belongs in the POM and the assertions, not in new test infrastructure.
- **Known gaps**: the POM has no start-menu affordance at all — every spec re-implements the regex inline. There is no helper that reads quest objective state as a comparable value.
- **Legitimate skip that stays**: `:176` — `test.skip(true, 'Offline AI test requires Ollama (not available in CI)')`. That is an environment skip with a stated reason, which is the shape this contract wants; it is not one of the conditionals being removed.
- **Baseline tests**: run the full `release_gate.spec.ts` against `main` and record the result before any change, so "the gate went red" can be attributed to the tightening rather than to a pre-existing failure.

## User Outcome

After this contract, a developer who sees the release gate pass knows a real player can launch the game from the real start button, reach combat, resolve it, save, reload, and find their character exactly as they left it — because the gate fails when any of those is untrue.

## Success Measures

- **Time/latency target**: the tightened spec's runtime stays within the existing E2E budget; removing the `waitForTimeout`-and-hope conditionals should not make it slower.
- **Offline/degraded behavior**: the offline-AI leg remains an explicit `test.skip` with a stated reason when Ollama is unavailable; it never silently degrades into a pass.
- **Production journey enabled**: cold launch → "New Adventure" → setup → quest → combat → reward → save → reload, asserted end to end with no branch that can skip a leg.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Journey vocabulary (boot, combat, quest, save, reload, HP) | `apps/e2e/src/pom/game_page.ts` | reuse; extend with a start-menu affordance and a comparable quest-state reader |
| Cold-launch navigation | `game_page.ts:62` `gotoColdLaunch()` | modify — route the start-button click through the POM |
| The journey spec | `apps/e2e/tests/client/release_gate.spec.ts` | modify — remove conditionals, tighten assertions |
| Visual checkpoints (AC-7) and engine replay (AC-8) | `apps/e2e/src/visual/suites/release_gate.visual.ts`, `apps/e2e/src/fixtures/engine_replay.ts` | untouched — out of scope |

## Overview

The gate's structure is right and its assertions are not. This contract moves the start-menu affordance into the POM where it can assert the real label, removes every `if (present)` branch from the spec so an absent UI fails instead of skipping, and turns the state-survival leg into exact before/after comparisons for HP, inventory count and quest objective. It deliberately does not fix whatever the tightened gate then catches — those are product bugs, filed separately.

## Design Reference

- `apps/e2e/src/pom/game_page.ts` — the established POM pattern: `expect*` methods that assert rather than return booleans. The new start-menu method follows it.
- `release_gate.spec.ts:508` — `expect(inventoryItemsAfter).toBe(inventoryItemsBefore)` is already the correct shape; HP and quest state adopt it.
- `release_gate.spec.ts:176` — the sanctioned environment skip: `test.skip(true, '<reason>')` at the top of the block, never an inline truthiness branch.
- [C-335](C-335-enforce-the-playable-demo-release-gate.md) — the contract that created this gate and named its ACs; keep its AC-1…AC-8 describe-block numbering intact.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

The POM owns every affordance lookup. A method such as `startNewAdventure()` asserts the real production label is present and visible, then clicks it; it must not fall back to a permissive regex across several candidate labels, because a fallback is how the current bug survived. The keyboard journey uses the same source of truth for the label rather than repeating a literal.

The spec expresses one unconditional journey. Every leg either asserts or fails. Environment-dependent legs use `test.skip(condition, 'reason')` at the top of the block — a form that is visible in the report as a skip — never `if (present) { ... }`, which is invisible. Retry and settle logic belongs in Playwright's auto-waiting and `expect.poll`, not in `try/catch → false` probes.

State-survival assertions compare captured values. `hpAfter === hpBefore` exactly; inventory count exactly; quest objective state exactly. If a game mechanic legitimately changes HP across a save/reload, that is a product decision that must be stated in the spec as an explicit tolerance with a comment naming the mechanic — not a `> 0` assertion.

Leave the describe-block structure and AC numbering intact so C-495 can append the companion-acknowledgement and epilogue legs without renumbering.

## State & Data Models

No persisted state. The only new shape is the comparable state snapshot the spec captures on both sides of the reload:

```ts
type JourneyStateSnapshot = {
	hp: number;
	inventoryItemCount: number;
	questObjectiveLabel: string;
};
```

It is local to the E2E lane and lives with the POM; it is not a domain type and does not belong in `@aikami/types`.

## Quality Requirements

- **Offline/degraded mode**: the Ollama-dependent leg stays an explicit skip with a stated reason.
- **Accessibility/input**: the keyboard journey (`AC-3` describe block) must reach the same start affordance by keyboard; a label-matching change must not break it.
- **Performance budget**: no increase in spec runtime beyond existing E2E limits; prefer auto-waiting over fixed `waitForTimeout`.
- **Security/privacy**: N/A — no credentials or user data.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: the spec must pass on a repeat run against the same build; no reliance on first-run-only state.
- **Observability**: a failing leg names which journey step failed, so a red gate is diagnosable without re-running locally.

## Migration & Rollback

N/A — no persistent state changes. Rollback is reverting the spec and POM changes; nothing else depends on them.

## Scope Boundaries

- **In Scope:** a POM start-menu affordance asserting the real "New Adventure" label; removing every `if (present)` conditional from `release_gate.spec.ts`; unconditional combat entry; exact before/after comparison of HP, inventory count and quest objective across save/reload; keeping the Ollama environment skip; filing each product bug the tightened gate surfaces as a separate thin contract.
- **Out of Scope:** new journey steps for features that do not exist yet — companion acknowledgement and epilogue belong to C-495; visual/AI assessment suites (`*.visual.ts`) and the engine-replay fixture; fixing the product bugs the tightened gate surfaces; renumbering the existing AC describe blocks; changes to production client code.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the three weaknesses are one outcome — a gate that cannot be passed by a build that never starts, never fights, or loses state. Splitting them would leave a gate that is honest about one leg and decorative about the others, which is indistinguishable from today. The POM change and the spec change are the same edit seen from two files.

## Acceptance Criteria

### AC-1: The gate uses the real front door
**Given** the production start menu
**When** the release gate runs
**Then** it clicks the actual "New Adventure" affordance through a POM method that asserts the label is present, and no permissive multi-label regex remains in either the mouse or the keyboard journey.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` | `/` — the start menu (`apps/frontend/client/src/lib/views/start/start_view.svelte:90`) | Filled during verification |

**Test Hooks**:
- Moon Task: the client E2E task running `release_gate.spec.ts`
- Integration: temporarily rename the production button label and confirm the gate goes red — then revert
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts`, AC-1 and AC-3 describe blocks, using the new `game_page.ts` start-menu method.
    - **Visual**: N/A — the visual checkpoints are C-335's AC-7 suite and are out of scope.

**Watch Points**:
- Do not re-add a fallback chain of candidate labels. One label, asserted.
- The keyboard journey at `:252` must consume the same label source, not a second literal that can drift.
- A continue/load-campaign button may also exist on the start menu; the gate must click the new-adventure one specifically.

### AC-2: Combat is entered unconditionally
**Given** the demo adventure
**When** the release gate runs
**Then** the combat leg executes without an `if`, and the run fails when combat cannot be reached within its timeout.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` | `/game` — combat encounter in the Emberwatch demo, via `game_page.ts` `expectCombatActive()` | Filled during verification |

**Test Hooks**:
- Moon Task: the client E2E task running `release_gate.spec.ts`
- Integration: run against a build with the encounter disabled and confirm the gate fails rather than passes
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts`, AC-1 describe block, combat steps.
    - **Visual**: N/A.

**Watch Points**:
- `.isVisible().catch(() => false)` is the anti-pattern being removed — a probe that converts a failure into a boolean. Replace it with an assertion, not with a longer timeout on the same probe.
- If combat genuinely cannot be entered deterministically, that is a product bug to file, not a reason to restore the conditional.

### AC-3: State survival is asserted by exact comparison
**Given** a save followed by a reload
**When** the gate compares state
**Then** it asserts `hpAfter === hpBefore`, an unchanged inventory item count, and an unchanged quest objective — with any legitimate tolerance stated explicitly in a comment naming the mechanic that causes it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` | `/game` — pause → save, then reload, via `game_page.ts` `saveGame()` / `reloadAndWaitForBoot()` | Filled during verification |

**Test Hooks**:
- Moon Task: the client E2E task running `release_gate.spec.ts`
- Integration: mutate HP between save and reload in a scratch build and confirm the assertion fails
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts`, AC-6 describe block.
    - **Visual**: N/A.

**Watch Points**:
- `hpBefore` is currently captured and unused; deleting the capture is the wrong fix — compare it.
- Quest objective needs a comparable value; `expectCurrentObjective(label)` asserts against a literal. Add a reader that returns the current objective so before/after can be compared without hardcoding the demo's content.
- Do not weaken to `toBeGreaterThanOrEqual` when the comparison first goes red.

### AC-4: No conditional leg remains
**Given** any leg of the journey whose UI is absent
**When** the gate runs
**Then** it fails. No `if (present)`-style guard remains in the spec; deliberate environment skips are `test.skip` with a stated reason at the top of their block, and the Ollama skip at `:176` is preserved in that form.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` | `/game` — the full cold-launch journey; each leg asserts against a production surface | Filled during verification |

**Test Hooks**:
- Moon Task: the client E2E task running `release_gate.spec.ts`
- Integration: review the diff — every removed `if` is either an assertion now or a `test.skip` with a reason; loop counters that bound retries are not conditionals of this kind and may remain
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts`, all non-skipped describe blocks.
    - **Visual**: N/A.

**Watch Points**:
- Distinguish the two kinds of `if`: a bounded retry loop over combat rounds is control flow; `if (uiPresent)` around an assertion is a hidden skip. Only the second kind is in scope.
- Onboarding step loops that break on reaching `/game` are retry control flow — but the loop exhausting without reaching `/game` must fail, not fall through silently.

### AC-5: The tightened gate runs against `main` and its failures are filed, not softened
**Given** the whole spec
**When** it runs against `main`
**Then** it passes; and if it does not, each failure is filed as a separate thin contract naming the product bug, with this contract's Amendments recording what was filed. No assertion is loosened to make the run green.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` (full-suite run against `main`) | `/game` — the same production journey; this AC is the run itself | Filled during verification |

**Test Hooks**:
- Moon Task: full client E2E run on `main`
- Integration: compare against the pre-change baseline run recorded in Problem & Baseline Evidence; attribute every delta
- E2E / Visual:
    - **Functional**: the whole of `apps/e2e/tests/client/release_gate.spec.ts`.
    - **Visual**: N/A.

**Watch Points**:
- **This is the AC that will hurt, and it is the point of the contract.** Budget for the gate going red on first tightening.
- A red gate must not be "fixed" by relaxing an assertion, widening a label match, restoring a conditional, or marking a leg `test.fixme`. File the bug.
- A filed bug that blocks the gate is a legitimate reason for this contract to land with the gate red and the failure documented — say so explicitly rather than shipping a green lie.

## Implementation Sequence

1. **Phase 1 (Baseline)**: run `release_gate.spec.ts` against `main` and record the result — pass/fail per test — before touching anything.
2. **Phase 2 (POM)**: add the start-menu affordance and the quest-objective reader to `game_page.ts`; route both the mouse and keyboard journeys through them (AC-1).
3. **Phase 3 (Unconditional legs)**: remove the `if (present)` guards, make combat entry unconditional, and preserve the Ollama `test.skip` in its existing form (AC-2, AC-4).
4. **Phase 4 (Exact assertions)**: compare HP, inventory count and quest objective across the reload (AC-3).
5. **Phase 5 (Run and file)**: run the full spec against `main`, attribute every delta to the baseline, and file each real product bug as a thin contract (AC-5).

## Edge Cases & Gotchas

- **A start menu with several entry buttons**: "New Adventure" and a continue/load button coexist when a campaign exists. The gate must target the new-adventure affordance specifically, and must behave identically on a machine with existing saves.
- **First run downloads starter content** (see `CLAUDE.md` § Data Planes): cold launch may be network-dependent on a clean profile. Give that leg a realistic timeout rather than a conditional.
- **Combat timing**: the current code waits a fixed 2s then probes. Replace with an assertion that auto-waits; a fixed sleep plus an assertion is still flaky, just louder.
- **Auto-heal or regen on load** would make exact HP comparison fail legitimately. If that mechanic exists, state it as an explicit, commented tolerance — and confirm it is a real mechanic before assuming it, since "HP may differ if auto-heal/regen is active" is currently an unverified comment at `:498`.
- **C-495 will extend this spec.** Keep describe blocks and AC numbering stable, and keep new helpers on the POM rather than inline, so appending legs later is additive.

## Open Questions

- Resolved: the Ollama environment skip stays as-is — an explicit `test.skip` with a reason is the sanctioned form, not one of the conditionals being removed.
- Resolved: product bugs surfaced by the tightening are filed as separate thin contracts and recorded in this contract's Amendments; they are not fixed here.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).
