---
id: C-500
title: "Combat Overlay Rendering and Engine Stall"
source: "direct"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-08T13:50:28Z"
---

# Contract C-500: Combat Overlay Rendering and Engine Stall

## Metadata

| Field | Value |
|---|---|
| **Source** | `tmp/TODO.md` — "I manage to start battle … but it just freezes the screen, I cannot move and it does not show battle UI" |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte` + `packages/frontend/engine/src/systems/path_follow_system.ts` — combat UI mount + engine stall |
| **Type** | full |
| **Priority** | P0 — combat is unreachable in production; modal input lock without UI is indistinguishable from a hard freeze |
| **Dependencies** | C-499 (envelope extraction) — combat can only be reached once dialogue resolves |
| **Status** | draft |
| **Promotion** | `integrated` — production route `/game` |
| **Docs Impact** | none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` |

## Problem & Baseline Evidence

- **Current behavior**: Triggering combat pushes the `COMBAT` overlay and locks engine input, but no battle UI ever appears. The player is left looking at a paused world with no way to act.
- **Reproduction** (from `tmp/TODO.md` logs): talk to an NPC with a combat chip → tap it. Observed:
  - `[GameOverlayService] overlay:push` → `{ type: "COMBAT", stackDepth: 1 }`
  - `[GameEngineService] pauseEngine:locking-input`
  - `[DialogueOverlayViewModel] _handleDirectCombat` → `{ npcName: "Rollo the Grasper", npcId: "rollo_grasper" }`
  - Then a repeating stall signature: `path-follow:halt-yield` → `{ eid: 1, haltedForMs: 5000.000000000002 }` and `{ eid: 10, haltedForMs: 5000.000000000002 }`, plus `[spam:zoning.position] (suppressed 601 repeats in 10s)`.
- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/views/combat/combat_view.svelte` — a complete combat UI (dice overlay, portrait stage, turn tracker, action controls, victory/defeat screen) accepting `viewModel: CombatViewModelInterface`. It is **not imported or rendered anywhere in the production game UI**.
  - `game_ui_view_model.svelte.ts` `$effect` (~L409) — already creates and initializes `combatViewModel` when `activeOverlay === 'COMBAT'`, and disposes it on teardown. This is the correct lifecycle.
  - `game_ui_view.svelte` overlay switch (L125–167) — branches exist for PAUSE_MENU, DIALOGUE, GAME_OVER, INVENTORY, QUEST_LOG, CHARACTER_DASHBOARD, VENDOR, END_SESSION, SETTINGS, PARTY_ROSTER, TALK_TO_PARTY, REPUTATION. **No `COMBAT` branch.**
  - `game_overlay_service.svelte.ts` `startCombat` (~L1320) → `combatService.startCombat({ enemyName, enemyHp: 60, … setActive })`.
- **Known gaps**:
  1. `CombatView` is never mounted → "does not show battle UI".
  2. Engine input is locked by design during a modal overlay, so the missing UI reads as a hard freeze.
  3. `path-follow:halt-yield` logging `haltedForMs: 5000.000000000002` every frame implies per-tick `deltaMs >= 5000` — a main-loop stall or delta-time miscalculation, not mere log noise.
- **Baseline tests**: `packages/frontend/engine/src/systems/path_follow_system.test.ts`, `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts`, and the combat dev sandbox `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/combat/+page.svelte`.

## User Outcome

After this contract, a player can start combat from dialogue and see the full battle UI over a still-but-healthy world, take a turn, resolve the fight, and return to exploration with input restored.

## Success Measures

- **Time/latency target**: combat overlay mounts within one frame of `overlay:push COMBAT`; engine tick stays at the normal rate (no ≥5s deltas) while the combat modal is open.
- **Offline/degraded behavior**: combat UI and combat service must not depend on network/AI — the modal renders and accepts input even with no provider connection.
- **Production journey enabled**: player can go from dialogue → combat → victory/defeat → back to EXPLORE in the `/game` route.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Combat UI component | `apps/frontend/client/src/lib/views/combat/combat_view.svelte` | reuse (mount it) |
| Combat ViewModel lifecycle | `game_ui_view_model.svelte.ts` `$effect` (~L409) | reuse (source of truth) |
| Overlay router | `game_ui_view.svelte` L125–167 | modify (add COMBAT branch) |
| Overlay/input lock | `game_overlay_service.svelte.ts` | reuse (behavior is correct) |
| NPC halt rule | `packages/frontend/engine/src/systems/path_follow_system.ts` (~L177) | modify (stop re-yield spin / investigate delta) |
| Combat service | `combatService` via `game_overlay_service.startCombat` | reuse |

## Overview

Two coupled defects make combat unreachable in production: the combat UI component is never mounted by the overlay router, and the engine appears to stall after combat starts. The fix mounts `CombatView` in the existing overlay chain using the ViewModel lifecycle that already exists, and investigates/repairs the engine stall so the modal world keeps ticking.

## Design Reference

- Follow the existing overlay `{#if viewModel.activeOverlay === 'X' && viewModel.xViewModel}` pattern in `game_ui_view.svelte`.
- Keep `game_ui_view_model.svelte.ts` as the single owner of `combatViewModel` creation/disposal — do not duplicate VM construction in the view.
- For the engine stall, reference `packages/frontend/engine/src/systems/path_follow_system.ts` C-402 halt rule and `zoning_system.ts`; confirm whether the stall is in the tick source or delta computation before changing behavior.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Mount the combat overlay in the production game UI (client view layer), reusing the existing `CombatViewModel` instance owned by `GameUIViewModel`.
- Engine-side, locate and fix the source of the ≥5s tick delta during the COMBAT overlay; do not merely suppress the `halt-yield`/`zoning.position` logs — verify the loop is healthy.

## State & Data Models

No persisted schema changes. Combat state remains in-memory (`combatService`, `CombatViewModel`). Type shapes already exist in `apps/frontend/client/src/lib/views/combat/`.

## Quality Requirements

- **Offline/degraded mode**: combat UI and service must work with no network/AI dependency.
- **Accessibility/input**: combat actions reachable by keyboard/pointer through the mounted view; Escape/back affordance still dismisses cleanly.
- **Performance budget**: no ≥5s tick deltas while combat is open; `halt-yield` and `zoning.position` must not spam at their pre-fix rate.
- **Security/privacy**: N/A — no new boundary.
- **Persistence/migration**: N/A — no persisted state.
- **Cancellation/retry/idempotency**: dismissing combat must dispose the ViewModel exactly once and resume engine input exactly once.
- **Observability**: retain `overlay:push`/`pauseEngine`/`resumeEngine` logging; confirm tick health via engine debug logs.

## Migration & Rollback

N/A — no persistent state changes.

## Scope Boundaries

- **In Scope:**
  - Add the `COMBAT` branch to `game_ui_view.svelte` and mount `CombatView` with `viewModel.combatViewModel`.
  - Investigate and fix the engine stall (≥5s delta / halt-yield re-loop) during the COMBAT overlay.
  - Production-route E2E + visual coverage for the combat journey.
- **Out of Scope:**
  - Combat balance, new abilities, enemy content.
  - Intent-envelope extraction failure (C-499).
  - The `/dev` combat sandbox (it already works there) — use it only as a reference.
  - TTS, slash commands, minimap, quest markers.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** single contract. The UI mount and the stall fix are both required for the same player-facing outcome ("combat is playable") and share the same verification journey.

## Acceptance Criteria

### AC-1: Combat UI renders in production
**Given** a dialogue with an NPC that can start combat
**When** the player triggers combat (combat chip / `startCombat` command)
**Then** the production `/game` route shows the full combat UI (portrait stage, turn tracker, dice, action controls) instead of a frozen world.
**Production Path**: `/game`

### AC-2: Engine keeps ticking while combat is open
**Given** the `COMBAT` overlay is active
**When** the player watches the world
**Then** the frame loop runs at the normal rate — no `halt-yield` events pinned at `haltedForMs ≈ 5000` every frame and no `[spam:zoning.position]` flood.
**Production Path**: `/game` (engine tick health observable via debug logs)

### AC-3: Combat turn resolves and exits cleanly
**Given** the combat UI is showing
**When** the player takes an action and resolves the fight to victory or defeat
**Then** the result screen renders and the player can exit back to EXPLORE with engine input unlocked (`resumeEngine:unlocked-input`).
**Production Path**: `/game`

### AC-4: Halt-yield no longer re-loops
**Given** an NPC halted at interaction radius under the C-402 halt rule
**When** it remains halted past `HALT_YIELD_THRESHOLD_MS`
**Then** its path is yielded once (single `halt-yield` event) and it does not re-halt/re-yield every tick.
**Production Path**: tooling: `bun moon run engine:test` + `/game` smoke

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E + Visual | `apps/e2e/tests/client/combat.spec.ts` + visual suite | `/game` | Filled during verification |
| AC-2 | E2E + unit | `path_follow_system.test.ts` | `/game` | Filled during verification |
| AC-3 | E2E | `apps/e2e/tests/client/combat.spec.ts` | `/game` | Filled during verification |
| AC-4 | Unit | `path_follow_system.test.ts` | tooling: `bun moon run engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`, `bun moon run engine:test`
- Integration: manual `/game` smoke — dialogue → combat chip → combat UI visible → take a turn → exit.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/combat.spec.ts` — cover start-combat-from-dialogue, action resolution, exit-to-EXPLORE. POMs as needed per `$pom` conventions.
    - **Visual**: `apps/e2e/src/visual/suites/combat.visual.ts` — declarative case at `/game` combat state; schema: combat UI visible with portrait stage + turn tracker + dice; OpenRouter AI evaluation: "Score 90+: combat overlay fully rendered, not a frozen/empty world view."

**Watch Points**:
- **Do not unlock engine input during combat** — the modal lock is correct; the bug is the missing UI that makes the lock look like a freeze.
- **The `haltedForMs: 5000.000000000002` value means per-tick `deltaMs >= 5000`.** Find the tick-source/delta bug; do not just raise the yield threshold or mute the log.
- **Mount in the view, not the ViewModel** — `combatViewModel` is already created/disposed by `game_ui_view_model`; adding a second VM in the view would double-initialize.
- **Dispose-once** — leaving combat must not leave a stale `combatViewModel` or a second `overlay:push`.

## Implementation Sequence

1. **Phase 1 (Mount)**: Add the `COMBAT` branch to `game_ui_view.svelte` and import `CombatView`; verify the overlay renders via the `/game` route.
2. **Phase 2 (Engine)**: Reproduce the ≥5s delta during COMBAT; locate the tick/delta source; fix and confirm the halt-yield re-loop stops.
3. **Phase 3 (Validation)**: Add E2E + visual coverage; run `validate({ test: true })` plus the Moon tasks above; capture a production-route screenshot and score it ≥85.

## Edge Cases & Gotchas

- **Dialogue → combat timing**: `_handleDirectCombat` waits ~1200ms for the transition message — the UI mount must tolerate that delay.
- **Rapid dismiss**: exiting combat immediately after entry must dispose cleanly and restore input exactly once.
- **Encounter without enemy name**: `startCombat` always passes `enemyName`; guard the VM against empty names so the header doesn't render blank.
- **No AI connection**: combat must remain fully playable with no network — do not gate any combat step on a provider.

## Open Questions

Must be resolved before status becomes `approved`:

- Is the ≥5s delta a main-loop stall in the tick source, or a delta-time computation bug (e.g. wall-clock elapsed spanning the pause)? The implementer must confirm the root cause before the fix; this contract prescribes the investigation, not a specific patch.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
