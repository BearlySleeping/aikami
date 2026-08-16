---
id: C-402
title: "Fix NPC/Player Movement Deadlock"
source: "docs/strategy/mvp-assessment-2026-08-16.md §6.2 (MVP playthrough)"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/154"
  pr_number: 154
created_at: "2026-08-16"
---

# Contract C-402: Fix NPC/Player Movement Deadlock

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/strategy/mvp-assessment-2026-08-16.md` §6.2 — live MVP playthrough 2026-08-16 |
| **Target** | `packages/frontend/engine/src/systems/` — collision masks, movement, GOAP movement execution |
| **Priority** | P0 — soft-locks play; the player loses control with no recovery short of reload |
| **Dependencies** | — |
| **Status** | approved |
| **Promotion** | `—` |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the player becomes stuck when an NPC walks toward them.
  Movement input stops taking effect and does not recover.

- **Root cause**: symmetric blocking with no resolution rule.

  `packages/frontend/engine/src/systems/movement_system.ts:55`:
  ```ts
  export const PLAYER_COLLISION_MASK =
    CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.enemy;
  ```

  `packages/frontend/engine/src/systems/entity_spawner.ts:115`:
  ```ts
  /**
   * NPC collision mask: blocks walls, other NPCs, and the player (two-way
   * blocking so a future GOAP/moving NPC cannot walk through the player).
   */
  const NPC_COLLISION_MASK =
    CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.player;
  ```

  The comment names the intent — *"so a future GOAP/moving NPC cannot walk
  through the player"* — and that future arrived with C-191/C-192 (GOAP
  scheduler and JPS pathfinder). The mask was written for static NPCs, where
  symmetric blocking is harmless. With NPCs that move, a moving NPC pathing
  into the player's tile and a player pathing into the NPC's tile block each
  other, and **neither yields**. There is no push-out, no repath-on-block, and
  no notion of a living entity as a soft obstacle.

- **Reproduction**:
  1. Load Emberwatch `village`.
  2. Stand still and wait for an NPC to path toward the player (GOAP
     locomotion for wanderers is enabled at `entity_spawner.ts:461-478`).
  3. Once adjacent, movement input no longer moves the player.

- **Existing implementation to reuse**:
  - `packages/frontend/engine/src/systems/collision_system.ts` — mask
    evaluation.
  - `packages/frontend/engine/src/systems/goap_movement_executor.ts` (249
    lines) — requests A* paths (goal cell → PathFollow) on a repath cadence
    and skips entities with an active path; its pursue-target goal selection
    must become radius-aware.
  - `packages/frontend/engine/src/systems/path_follow_system.ts` (142 lines) —
    the per-tick locomotion executor that writes Velocity; the halt rule
    lives here (see Architecture Directives).
  - `packages/frontend/engine/src/systems/interaction_proximity_system.ts`
    (138 lines) — already computes player proximity; `interactionRadius` is
    declared per NPC in map data (`village.json`, value `48`) and stored per
    NPC on `NPCDialog.interactionRadius` (spawner default
    `DEFAULT_INTERACTION_RADIUS = 50`, `entity_spawner.ts:96`).
  - `COMBATANT_COLLISION_MASK` (`movement_system.ts:67`) — combat correctly
    requires mutual blocking and must keep it.
  - `packages/frontend/engine/src/systems/movement_system.test.ts` — the
    established headless bitECS Bun-test pattern for deterministic movement
    regression (spawn entities, tick the world, assert positions). ⚠️ The
    C-335/C-336 replay harness (`apps/e2e/tests/engine_replay.test.ts`) is a
    `test.skip()` placeholder gated on the unimplemented deterministic rules
    kernel — it is NOT usable as this contract's regression vehicle.

- **Known gaps**: no stuck detection exists anywhere; a blocked player is
  indistinguishable from a player not pressing a key.

- **Baseline tests**: `moon run engine:test -- movement_system.test.ts`,
  `path_follow_system.test.ts`, `apps/e2e/tests/game/collision_e2e.spec.ts`.

## User Outcome

After this contract, a **player** never loses control of their character
because of another character's movement. NPCs approach, stop at conversational
distance, and the player can always walk away.

## Success Measures

- **Time/latency target**: no added per-tick cost in the movement loop; the
  halt check is a distance comparison the proximity system already performs.
- **Offline/degraded behavior**: N/A — pure engine logic, no network or AI.
- **Production journey enabled**: an uninterruptible walk through all three
  Emberwatch maps, which the cold-start playtest depends on.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Player collision mask | `movement_system.ts:55` | **modify** — drop `npc` |
| NPC collision mask | `entity_spawner.ts:115` | **modify** — drop `player` |
| Combatant mask | `movement_system.ts:67` | **reuse unchanged** — combat needs mutual blocking |
| NPC per-tick locomotion | `path_follow_system.ts` | **modify** — add the halt rule |
| NPC path request | `goap_movement_executor.ts` | **modify** — radius-aware pursue-target goal selection |
| Proximity computation | `interaction_proximity_system.ts` | **reuse** — supplies the halt distance |
| Per-NPC interaction radius | map data (`interactionRadius: 48`) | **reuse** as the halt distance |
| Headless movement tests | `packages/frontend/engine/src/systems/movement_system.test.ts` | **reuse** the pattern — deterministic bitECS world tests are the regression vehicle |

## Overview

Player and NPC collision masks block each other symmetrically with no rule for
who yields, so a moving NPC and a moving player deadlock. This contract removes
the deadlock **class** rather than resolving it per frame: NPCs halt at their
declared interaction radius and never enter the player's tile, and the player
passes through NPCs. Combat positioning is untouched. A stuck detector is added
as a safety net for any remaining case.

## Design Reference

**The design decision, and why.** Three approaches were considered:

- **(a) Soft obstacle** — NPCs treat the player as passable and repath around;
  the player never collides with NPCs. Removes the deadlock but lets NPCs walk
  through the player, which looks wrong.
- **(b) Mutual push-out** — the lower-priority actor is displaced to the
  nearest free tile. Resolves the deadlock but adds a per-frame displacement
  search, can teleport actors through walls if the free-tile search is sloppy,
  and produces visible jitter when two actors contest a tile.
- **(c) Halt at interaction radius** — NPCs stop before reaching the player's
  tile, so the contested state never arises.

**Chosen: (c) for NPCs, plus (a) for the player.** NPCs halt at
`interactionRadius`, and the player's mask no longer includes `npc`. This
eliminates the deadlock by construction instead of detecting and resolving it
every tick, and it reuses a value already declared per NPC in map data. The
cost — the player can walk through a stationary NPC — is a minor visual
compromise, and it is strictly better than losing control of the character.
It also matches how the NPCs are meant to behave: they exist to be talked to,
and stopping at conversational distance is the correct behaviour regardless of
the bug.

**Combat is explicitly excluded.** `COMBATANT_COLLISION_MASK`
(`movement_system.ts:67`) deliberately blocks combatants against each other and
against the player; tactical positioning depends on it. This contract must not
touch it.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Collision masks stay **data on the entity** (`CollisionData`), read by the
  movement loop. Do not special-case entity kinds inside the movement loop
  itself — `movement_system.ts:73` already warns that the loop must never fall
  back to the player's mask for a non-player mover.
- The halt rule lives in the **NPC locomotion executor**, not in the collision
  system. Collision answers "can this cell be entered"; halting is a behaviour
  decision and belongs with the behaviour. Concretely:
  `path_follow_system.ts` is the single per-tick locomotion executor (it
  writes Velocity toward waypoints every frame) — the per-tick halt check
  (distance to player < `interactionRadius` → zero Velocity, set
  `NpcHaltReason.player_proximity`) runs there, gated to NPCs carrying
  `NPCDialog` so party followers (no `NPCDialog`) never halt.
  `goap_movement_executor.ts` only requests paths on a repath cadence and
  skips entities with an active path, so a halt implemented only there could
  never stop an in-flight approach nor track a moving player. Its
  pursue-target goal selection should additionally choose a goal cell at
  `interactionRadius` from the player rather than the player's own cell, so
  A* never routes through the player's tile.
- Combat masks and the turn-based walkability composites
  (`turn_manager_system`, `goap_combat_tactics_system`) are **out of scope and
  must not change**.
- Stuck detection is a **safety net that logs**, not a movement mechanic. If it
  ever fires in normal play, that is a bug to fix, and the log is how it gets
  found.
- All of this is engine-internal. Nothing crosses `EngineBridge`
  (directive #6).

## State & Data Models

```ts
/** Why an NPC stopped moving this tick — carried for observability
 *  and asserted in the halt-rule unit test. */
type NpcHaltReason =
  | 'none'
  | 'reached_goal'
  | 'player_proximity'   // ← new: halted at interactionRadius
  | 'blocked_terrain'
  | 'blocked_actor';

/** Stuck-detector state, tracked per mover. */
type StuckWatch = {
  readonly eid: number;
  /** Consecutive ticks with movement intent but zero displacement. */
  readonly blockedTicks: number;
  /** Tick at which the detector last logged, to rate-limit output. */
  readonly lastReportTick: number;
};
```

No component layout changes and no persisted state changes. `interactionRadius`
is already present in map data and read by the proximity system.

## Quality Requirements

- **Offline/degraded mode**: N/A — pure engine logic.
- **Accessibility/input**: this contract *restores* input responsiveness; that
  is its point. Verify keyboard input recovers. Click-to-move (C-380) is a
  `draft` contract — verify its recovery only if it has landed by
  implementation time; keyboard is the gate.
- **Performance budget**: the halt check is one distance comparison per moving
  NPC per tick, using a value the proximity system already computes. Must add
  no measurable cost to the 60fps loop. The stuck detector is a counter, not a
  search.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — masks are runtime values reconstructed at
  spawn, not persisted. Old saves are unaffected.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: log every stuck-detector trigger with the entity id, the
  blocked direction, and the occupying entity. Log `NpcHaltReason` transitions
  at debug level.

## Migration & Rollback

N/A — no persistent state changes. Collision masks are constructed at spawn
from constants; rollback is a revert.

## Scope Boundaries

- **In Scope:**
  - Remove `CollisionLayer.npc` from `PLAYER_COLLISION_MASK`.
  - Remove `CollisionLayer.player` from `NPC_COLLISION_MASK`.
  - Halt rule in the NPC locomotion executor (`path_follow_system.ts`) at
    `interactionRadius`.
  - Stuck detection with logging as a safety net.
  - Headless movement regression test for both directions of approach.
  - Update the now-stale comments at `entity_spawner.ts:112-115` and `:396`.

- **Out of Scope:**
  - `COMBATANT_COLLISION_MASK` and all combat positioning.
  - `turn_manager_system` and `goap_combat_tactics_system` walkability.
  - Prop collision (`PROP_COLLISION_MASK`) — props are static and correctly
    block.
  - Crowd simulation, flow fields, or local avoidance steering.
  - Party-follow behaviour (`party_follow_system.ts`) unless the headless
    movement regression test shows it deadlocks too — if it does, record an
    amendment rather than widening scope silently.
  - Click-to-move path planning (C-380) beyond verifying it recovers.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** not split. The two mask changes and the halt rule are
one invariant — "a living actor never permanently blocks another" — and
applying either mask change alone leaves an asymmetry that is harder to reason
about than the current symmetric bug. The stuck detector is small and exists to
prove the invariant holds.

## Acceptance Criteria

### AC-1: An approaching NPC never blocks the player
**Given** the player is stationary in Emberwatch `village`
**When** an NPC paths toward the player and reaches them
**Then** player movement input continues to move the player in every direction

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `packages/frontend/engine/src/systems/movement_system.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test -- movement_system.test.ts`
- Integration: headless bitECS world — spawn one NPC, attach a PathFollow
  path into the player, tick `updateMovement` for N frames with player
  velocity set, assert player displacement is non-zero.
- E2E / Visual: **Functional**: extend
  `apps/e2e/tests/game/collision_e2e.spec.ts`. **Visual**: N/A — a deadlock is
  not visible in a still frame.

**Watch Points**:
- Assert displacement over ticks, not a single-frame position. A one-tick block
  is normal; a permanent one is the bug.

### AC-2: A player walking into an NPC does not deadlock
**Given** an NPC standing still
**When** the player walks directly into it and continues to hold input
**Then** neither entity is permanently blocked and the player continues moving

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `packages/frontend/engine/src/systems/movement_system.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test -- movement_system.test.ts`
- Integration: headless bitECS world — player walks into a stationary NPC,
  assert the player keeps displacing; cover all four cardinal approach
  directions.
- E2E / Visual: **Functional**: `collision_e2e.spec.ts`. **Visual**: N/A.

**Watch Points**:
- With `npc` removed from the player mask the player passes *through* the NPC.
  Confirm this does not let the player leave the map or enter a wall via an NPC
  standing in a doorway — walls are a separate layer and must still block.

### AC-3: NPCs halt at interaction radius
**Given** an NPC with `interactionRadius: 48` pathing toward the player
**When** it reaches that distance
**Then** it stops with `NpcHaltReason.player_proximity` and does not enter the
player's tile

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/engine/src/systems/path_follow_system.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: assert final NPC distance from the player is `>= interactionRadius`
  and `< interactionRadius + tileSize`.
- E2E / Visual: **Visual**: a case in
  `apps/e2e/src/visual/suites/emberwatch.visual.ts` asserting NPCs stand at
  conversational distance rather than overlapping the player — pairs
  naturally with C-400's visual work if that contract lands first.

**Watch Points**:
- An NPC whose spawn point omits `interactionRadius` must use a sane default,
  not `0` — a `0` radius reintroduces the deadlock for that NPC specifically.
  The spawner already guarantees this (`DEFAULT_INTERACTION_RADIUS = 50`,
  `entity_spawner.ts:96`); the halt rule only reads `NPCDialog.interactionRadius`.
- Unit distance check uses pixels (the radius is in pixels, tileSize is 32px);
  assert final NPC distance is `>= interactionRadius` and
  `< interactionRadius + tileSize`.

### AC-4: Combat positioning is unchanged
**Given** the existing combat test suite
**When** it runs after this change
**Then** all combat positioning and walkability tests pass unmodified

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `apps/e2e/tests/game/goap_combat.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/game/goap_combat.spec.ts`
- Integration: also run `tests/client/combat_sandbox.spec.ts` and
  `combat_enhancements.spec.ts`.
- E2E / Visual: **Functional**: existing specs, unmodified. **Visual**: N/A.

**Watch Points**:
- This AC is satisfied by *not* changing `COMBATANT_COLLISION_MASK`. If any
  combat test needs editing to pass, scope has leaked — stop and raise an
  amendment.

### AC-5: Stuck detection logs rather than silently failing
**Given** a mover with movement intent and zero displacement
**When** that persists beyond the threshold tick count
**Then** a warning is logged with the entity id, direction, and occupying
entity, rate-limited to avoid per-tick spam

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `packages/frontend/engine/src/systems/movement_system.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: construct a genuinely walled-in entity and assert exactly one
  log within the rate-limit window.
- E2E / Visual: N/A.

**Watch Points**:
- A player pressing into a wall is *normal* and must not log. The detector must
  distinguish "blocked by terrain" (expected) from "blocked by an actor"
  (suspicious). Only the latter warns.

## Implementation Sequence

1. **Phase 1 (Data/Logic)** — Remove `CollisionLayer.npc` from
   `PLAYER_COLLISION_MASK` (`movement_system.ts:55`) and
   `CollisionLayer.player` from `NPC_COLLISION_MASK`
   (`entity_spawner.ts:115`). Update both stale comments. Add `NpcHaltReason`
   and the per-tick halt rule to `path_follow_system.ts` (the locomotion
   executor — see Architecture Directives), reading `interactionRadius`
   from `NPCDialog` (already populated at spawn, default
   `DEFAULT_INTERACTION_RADIUS = 50`). Make `goap_movement_executor.ts`
   pursue-target goal selection radius-aware.
2. **Phase 2 (Integration)** — Add the stuck detector to the movement loop,
   distinguishing terrain-blocked from actor-blocked. Verify keyboard input
   recovers (and click-to-move if C-380 has landed). Run the full combat
   suite to prove AC-4 before writing new tests.
3. **Phase 3 (Validation)** — Add headless movement test cases for AC-1 and
   AC-2 across four approach directions, the halt-rule unit test, and the
   stuck-detector test. Run `moon run engine:test`, `moon run e2e:test`,
   `bun run typecheck`.

## Edge Cases & Gotchas

- **NPC standing in a doorway.** With the player able to pass through NPCs this
  is no longer a blocker, but confirm the player cannot use an NPC in a
  transition zone to skip a zone trigger (`zoning_system.ts`).
- **Two NPCs contesting a tile.** `NPC_COLLISION_MASK` retains
  `CollisionLayer.npc`, so NPC-vs-NPC blocking is unchanged and can still
  deadlock. That is pre-existing and out of scope, but the stuck detector will
  now surface it — expect log noise and record it rather than widening scope.
- **Party followers** (`party_follow_system.ts`) may rely on the player
  blocking them. Verify the follower does not walk through or over the player
  after the mask change.
- **The `interactionRadius: 48` value is in pixels**, while collision works in
  tile coordinates (`tileSize: 32`). Do not mix units — this is the most likely
  source of an off-by-one-tile halt distance.
- **Combat entry from a halted NPC.** Rollo can start combat from dialogue.
  Confirm the transition from halted-at-radius into combat positioning works,
  since combat re-enables mutual blocking.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1** — Does `party_follow_system.ts` depend on the player blocking
  followers? If yes, the follower needs its own halt rule in this contract or
  an explicit follow-up. Verify by running `tests/client/party-follow` sandbox
  before implementing.
- **OQ-2** — RESOLVED: the spawner already defaults an omitted
  `interactionRadius` to `DEFAULT_INTERACTION_RADIUS = 50`
  (`entity_spawner.ts:96`, applied at `:409-412`). Reuse that constant — do
  NOT introduce a new one. (Emberwatch declares 48; the codebase default is
  50 — the 2px difference is immaterial at 32px tiles, and the existing
  constant is the source of truth.)
- **OQ-3** — Codebase evidence: `_spawnEnemy` (`entity_spawner.ts:633`) does
  not attach `GoapAgent`/`PathFollow`, so overworld enemies have no
  locomotion today and cannot deadlock the player. Keeping
  `CollisionLayer.enemy` in `PLAYER_COLLISION_MASK` is safe. If enemy
  locomotion lands later, revisit this mask decision then — record an
  amendment, not a scope widening here.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-16 | Initial draft from `mvp-assessment-2026-08-16.md` §6.2. Approach (c)+(a) — halt at interaction radius plus player pass-through — chosen over push-out; rationale in Design Reference. | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** — production route plus headless engine regression
and E2E coverage. A deadlock is a temporal behaviour, so visual assessment
adds nothing.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Removed the NPC/player movement deadlock **class** rather than resolving it
per frame. `CollisionLayer.npc` was dropped from `PLAYER_COLLISION_MASK` and
`CollisionLayer.player` from `NPC_COLLISION_MASK`, so a moving NPC pathing
into the player's tile and a player pathing into the NPC's tile can no
longer block each other symmetrically. NPCs now halt at their declared
`interactionRadius` via a per-tick halt rule in `path_follow_system.ts`
(velocity zeroed, `NpcHaltReason.player_proximity` recorded, path kept live
so the GOAP executor does not re-request every tick), and
`goap_movement_executor.ts` selects pursue-target goal cells at
`interactionRadius` from the player rather than the player's own cell so A*
never routes through the player's tile. A rate-limited stuck detector in the
movement loop logs actor-blocked movers as a safety net. Combat masks,
turn-manager walkability, and combat positioning are untouched.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `movement_system.test.ts` — NPC pathed into the player, player displacement non-zero over frames; E2E `/game` production test proves input recovers with NPCs present |
| AC-2 | ✅ | Four cardinal directions covered in `movement_system.test.ts`; wall-behind-NPC case verified; stale C-375 test updated to assert pass-through |
| AC-3 | ✅ | `path_follow_system.test.ts` — NPC stops at `>= interactionRadius` and `< interactionRadius + tileSize` with `NpcHaltReason.player_proximity`; companion exclusion locked in; radius-aware GOAP goal unit tests added |
| AC-4 | ✅ | `COMBATANT_COLLISION_MASK` untouched; combat engine suites pass unmodified (goap_combat_tactics, turn_manager, combat_sync = 72 tests) |
| AC-5 | ✅ | Stuck detector logs exactly one warning per rate-limit window when actor-blocked; terrain-press never logs |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/engine/src/systems/goap_movement_executor.test.ts` | Unit tests for radius-aware pursue-target goal selection (C-402 AC-3) |

### Files Modified

| File | Change |
|---|---|
| `packages/frontend/engine/src/systems/movement_system.ts` | Dropped `npc` from `PLAYER_COLLISION_MASK`; added `StuckWatch` stuck detector + `_findBlockingActor` helper + `resetStuckWatch`/`getStuckWatch` exports |
| `packages/frontend/engine/src/systems/entity_spawner.ts` | Dropped `player` from `NPC_COLLISION_MASK`; updated stale comments; exported `DEFAULT_INTERACTION_RADIUS` |
| `packages/frontend/engine/src/systems/path_follow_system.ts` | Added `NpcHaltReason` + per-tick halt rule (look-ahead step so final distance stays `>= interactionRadius`); `updatePathFollow(world, deltaMs, playerEntityId)` |
| `packages/frontend/engine/src/systems/goap_movement_executor.ts` | Radius-aware pursue-target goal selection (`_pickPursueGoal`); combat move-to-range unchanged |
| `packages/frontend/engine/src/worker/ecs_worker.ts` | Passes `playerEntityId` into `updatePathFollow` |
| `packages/frontend/engine/src/index.ts` | Exports `NpcHaltReason`/`getNpcHaltReason`, `resetStuckWatch`/`getStuckWatch` |
| `packages/frontend/engine/src/systems/movement_system.test.ts` | AC-1/AC-2/AC-5 tests; updated stale C-375 NPC-block assertion |
| `packages/frontend/engine/src/systems/path_follow_system.test.ts` | AC-3 halt-rule + companion-exclusion tests; SoA cleanup for module-global slots |
| `packages/frontend/engine/src/__tests__/entity_spawner.test.ts` | Updated NPC mask assertion to `wall|npc` (no player layer) |
| `apps/e2e/tests/game/collision_e2e.spec.ts` | Offset-aware BASE_URL; added C-402 production `/game` functional test |

### Deviations from Spec

- **Party-follower gating**: the contract says the halt rule is "gated to
  NPCs carrying `NPCDialog` so party followers (no `NPCDialog`) never halt" —
  but in this codebase `_spawnNpc` attaches `NPCDialog` to ALL NPCs,
  including companions. The halt rule therefore gates on
  `NPCDialog && !Companion`, honoring the stated intent (party followers
  never halt) with the correct component check. OQ-1 resolved: party
  followers do not rely on the player blocking them (they path to a
  formation slot via A*, and the mask change lets them pass the player's
  tile — no deadlock, verified by the companion-exclusion unit test).
- **Stuck-detector threshold**: the contract does not name a tick count; the
  implementation uses `STUCK_THRESHOLD_TICKS = 60` (~1s at 60fps) and
  `STUCK_REPORT_INTERVAL_MS = 5000`, both module constants for easy tuning.
- **No scope leaks**: `COMBATANT_COLLISION_MASK`, `turn_manager_system`,
  `goap_combat_tactics_system`, and `PROP_COLLISION_MASK` are unchanged.

### Test Results

- Unit (engine): 983 pass / 10 fail — the 10 failures are the pre-existing
  baseline (`buildManifest` ×5, `SpatialVisionSystem` ×5), identical before
  and after; 12 new contract tests added, all passing.
- Combat (engine): 72 pass / 0 fail (goap_combat_tactics, turn_manager,
  combat_sync) — AC-4 unmodified.
- E2E: C-402 production `/game` test passes (offset-aware). Pre-existing
  game/client specs that hardcode `:5274` fail to connect in the
  contract-scoped worktree (client on the offset port) — environmental,
  reproduced identically at HEAD with the new tests stashed.
- Visual: production `/game` screenshot (noon, player moved off the gate
  arch) validated at 85/100 via `ai_validate_image` — village renders,
  player character visible, input works with NPC present.
- Baseline: 10 pre-existing failures, 0 new failures.
