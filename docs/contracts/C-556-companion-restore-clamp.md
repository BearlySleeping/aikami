---
id: C-556
title: "Clamp restored companions to safe cells and refresh follow paths"
source: "direct — C-549 save & companion restore follow-up; docs/reference/emberwatch-polish-review-and-plan.md §9 Save positions"
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-24T19:03:53+02:00"
---

# Contract C-556: Clamp restored companions to safe cells and refresh follow paths

## Metadata

| Field | Value |
|---|---|
| **Source** | C-549 `Save & companion restore findings`; `docs/reference/emberwatch-polish-review-and-plan.md` §9 `Save positions` |
| **Target** | `packages/frontend/engine/src/worker/` — production restore/map-load relocation; `packages/frontend/engine/src/__tests__/emberwatch_crossing_restore.test.ts` — real-map regression |
| **Type** | thin |
| **Priority** | P1 — prevents companions from beginning follow paths from newly blocked restored cells |
| **Dependencies** | C-340 party follow, C-378 restore clamp, C-379 footprint-aware pathfinding, C-549 village crossing regression |
| **Status** | implemented |
| **Promotion** | integrated |
| **Docs Impact** | internal → none |
| **Contract version** | 1.0.0 |
| **Production Surface** | `packages/frontend/engine/src/worker/ecs_worker.ts` `LOAD_MAP`, `LOAD_GAME`, and `RESTORE_PLAYER` handlers |

## Problem & Baseline Evidence

- **Current behavior:** restore handlers relocate the player but not companions. A companion whose saved cell became terrain-solid or dynamically occupied remains in that invalid origin and only reacts after path-follow movement rejects its next step.
- **Reproduction:** restore a companion at Emberwatch village cell `(39,8)`, which became river in C-549, while the player stands on the current bridge. The companion keeps `(39,8)`; no companion relocation or follow invalidation runs.
- **Existing implementation to reuse:** `clampSpawnToWalkable`, `getPathfindingGrid`, `isCellBlocked`, spatial-grid re-registration, and party-follow `PathFollow` lifecycle.
- **Known gaps:** the player oracle is not valid for companions; relocation logic inside `ecs_worker.ts` would grow a size-guard-governed module; stale path state needs explicit invalidation after relocation.
- **Baseline tests:** C-549's `emberwatch_crossing_restore.test.ts` covered player restore against the committed village collision layer and carried a marked companion `todo`.

## User Outcome

A player loading or crossing into a changed map sees recruited companions relocated beside the player when a safe target exists, then they resume following on a fresh path. If no safe target exists, the companion's saved position is kept rather than moving it to an unsafe location.

## Success Measures

- **Latency target:** deterministic local ECS work during restore; no per-frame cost.
- **Offline/degraded behavior:** unchanged and fully local; no AI or network dependency.
- **Production journey enabled:** existing save/load and map transition flows repair companion positions before simulation resumes.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Player relocation | `movement_system.ts#clampSpawnToWalkable` | reuse inside extracted worker module |
| Actor footprint | `collision_system.ts#getPathfindingGrid` | reuse |
| Dynamic occupancy | `collision_system.ts#isCellBlocked` | reuse with companion mask |
| Follow-path refresh | `path_follow_system.ts#clearActorMovement` + `PathFollow.repathAtMs` | reuse |

## Overview

Extract restore relocation out of the size-constrained worker and apply it to player and companion entities. Companion validity uses the canonical companion collision mask and footprint-aware terrain grid; recruited companions prefer one of the eight cells touching the player, then use the existing 20-ring nearest-cell policy. Unrecruited companions use the ring search around their own saved position. Successful moves repair `Position`, `GridPosition`, and spatial occupancy, clear stale movement, and schedule a fresh party-follow path.

## Architecture Directives

- Keep `ecs_worker.ts` net-smaller; restore mechanics belong in `worker/companion_restore.ts`.
- Use `$logger`; log every companion relocation at info with source, ECS entity ID, companion ID, and coordinates.
- Do not mutate content packs, map builders, atlas painters, client views, or save schemas.
- Do not raise structural guard baselines or size ceilings.

## State & Data Models

```ts
type RestoreSource = 'LOAD_GAME' | 'LOAD_MAP' | 'RESTORE_PLAYER';

type RestoreRelocation = {
  entityId: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
};
```

No persistent schema changes.

## Quality Requirements

- **Offline/degraded mode:** local deterministic collision data only.
- **Accessibility/input:** N/A — no input or UI surface.
- **Performance budget:** bounded 20-cell ring search during restore; zero ongoing per-frame overhead.
- **Security/privacy:** N/A — no external data.
- **Persistence/migration:** old saves require no migration; invalid positions are repaired at load.
- **Cancellation/retry/idempotency:** repeated calls leave already-valid companions untouched.
- **Observability:** info relocation records include entity IDs; warning identifies an entity when no safe target exists.

## Migration & Rollback

N/A — no persistent state changes. Rollback removes the extracted module and restores the previous player-only worker calls.

## Scope Boundaries

- **In Scope:** companion restore validation, player-adjacent preference, ring fallback, occupancy repair, path invalidation, info logs, production handler wiring, behavioural regression.
- **Out of Scope:** content/map generation, companion roster persistence model, client UI, save migration, E2E/visual presentation changes.

## Contract Size & Split Rule

Single focused engine correction; no split required.

## Acceptance Criteria

### AC-1: Real-map companion restore is repaired beside the player

**Given** the committed Emberwatch village collision layer and a companion restored at newly-water cell `(39,8)`
**When** restore relocation runs with the player on the bridge
**Then** the companion moves to a walkable cell touching the player, its grid/spatial position agrees, and its old `PathFollow`/`Velocity` state is removed with `repathAtMs = 0`.

**Evidence Matrix:**
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit, real content fixture | `src/__tests__/emberwatch_crossing_restore.test.ts` | `RESTORE_PLAYER` handler | 2 behavioural C-556 tests pass |

### AC-2: Companion-specific mask and ring fallback are enforced

**Given** every player-adjacent cell is occupied by an entity matching the companion mask
**When** the saved companion cell is invalid
**Then** relocation rejects those cells and uses the same bounded ring search around the saved cell.

**Evidence Matrix:**
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `src/__tests__/emberwatch_crossing_restore.test.ts`, `src/__tests__/entity_spawner.test.ts` | `LOAD_GAME` handler | Dynamic occupancy and canonical map-spawn mask tests pass |

### AC-3: All production scene restoration paths share the policy

**Given** current collision and occupancy are loaded
**When** `LOAD_MAP`, `LOAD_GAME`, or `RESTORE_PLAYER` completes actor setup
**Then** each path calls the extracted relocation module, and every companion move emits an info record containing its ECS entity ID.

**Evidence Matrix:**
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + source wiring | `companion_restore.ts`, `ecs_worker.ts` | all three worker handlers | Typecheck, lint, guards |

**Test Hooks:**
- Moon Task: `env -u CI bun moon run frontend-engine:test -- --test-name-pattern 'C-556'`
- Integration: real committed village JSON + manifest collision oracle; no source-text assertion.
- E2E / Visual: N/A — deterministic worker data repair with no visual acceptance criterion; production entry point is covered through its extracted runtime module.

## Implementation Sequence

1. Turn the C-549 `todo` into a failing behavioural import/assertion and record red output.
2. Add canonical companion mask and extracted restore relocation module.
3. Wire all three worker restoration paths and remove duplicated worker clamp blocks.
4. Run engine Moon gates, `validate`, and affected Moon CI.

## Edge Cases & Gotches

- A companion may pass through the player by design, but relocation must never place it in the player's exact cell.
- Multiple restored companions are processed in ECS query order; occupancy is repaired before the next query entity is evaluated.
- A target must be safe under both the footprint-aware terrain grid and the companion's dynamic collision mask.
- If no bounded target exists, preserve the saved position and emit a warning rather than moving to an unsafe fallback.

## Open Questions

None.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-24 | Initial implementation | — |

## Execution Report

### Summary

Implemented C-556 without changing content or save schemas. `ecs_worker.ts` now delegates player and companion relocation to a focused module; companions use the canonical NPC/enemy/wall mask, footprint-aware path grid, player-adjacent preference, and existing ring fallback. Relocation repairs occupancy and forces a fresh follow path.

### AC Status

| AC | Status | Note |
|---|---|---|
| AC-1 | ✅ | Real village restore moves `(39,8)` to a walkable player-adjacent cell and clears stale movement. |
| AC-2 | ✅ | Test occupies all player-adjacent cells with companion-mask occupants and proves ring fallback. |
| AC-3 | ✅ | `LOAD_MAP`, `LOAD_GAME`, and `RESTORE_PLAYER` call the extracted module; info logs include entity IDs. |

### Files

| File | Change |
|---|---|
| `packages/frontend/engine/src/worker/companion_restore.ts` | Added extracted relocation policy and observability. |
| `packages/frontend/engine/src/worker/ecs_worker.ts` | Wired all restore paths; reduced from 2,397 to 2,349 lines. |
| `packages/frontend/engine/src/components/collision_data.ts` | Added canonical companion mask. |
| `packages/frontend/engine/src/entities/create_npc.ts` | Reuses canonical companion mask. |
| `packages/frontend/engine/src/systems/entity_spawner.ts` | Companion map spawns receive the canonical mask. |
| `packages/frontend/engine/src/__tests__/emberwatch_crossing_restore.test.ts` | Replaced C-549 `todo` with two passing behavioural tests. |
| `packages/frontend/engine/src/__tests__/entity_spawner.test.ts` | Pins companion map-spawn mask behavior. |
| `scripts/src/lib/ops/guard_cognitive_complexity_baseline.json` | Reduction-only contraction: worker worst score 197 → 186 after extraction. |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Reduction-only contraction: `entity_spawner.ts` 997 → 995 lines. |

### Failing-first proof

Before implementation, the new behavioural test imported the not-yet-existing production seam:

```text
env -u CI bun moon run frontend-engine:test -- --test-name-pattern 'C-556'
error: Cannot find module '../worker/companion_restore.ts' from
'.../packages/frontend/engine/src/__tests__/emberwatch_crossing_restore.test.ts'
1 fail
```

After implementation and generated test prerequisites:

```text
2 pass
1842 filtered out
0 fail
Ran 2 tests across 118 files.
```

### Deviations

None.

### Verification

- `frontend-engine:typecheck` — pass.
- `frontend-engine:lint` — pass, 337 files checked.
- `frontend-engine:test` — pass, 1,844 tests / 0 fail / 113,815 assertions.
- `validate` — pass: affected frontend-engine + scripts fix/typecheck/guards; 3 tasks completed.
- `bun moon ci --base=origin/main` — pass: 54 actions completed, 5 cached, 2 skipped, 30.607s.
