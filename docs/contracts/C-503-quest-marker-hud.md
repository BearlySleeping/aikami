---
id: C-503
title: "Quest Marker HUD"
source: "direct"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-08T14:01:09Z"
---

# Contract C-503: Quest Marker HUD

## Metadata

| Field | Value |
|---|---|
| **Source** | `tmp/TODO.md` — "Add quest marker" |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/hud/` + quest state projection — spatial quest objective marker |
| **Type** | full |
| **Priority** | P2 — navigation quality-of-life; depends on the C-502 projection bridge |
| **Dependencies** | C-502 (shared world→screen projection bridge) |
| **Status** | draft |
| **Promotion** | `integrated` — production route `/game` |
| **Docs Impact** | none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` |

## Problem & Baseline Evidence

- **Current behavior**: quest objectives appear only as text (`currentObjectiveText` in `quest_tracker_view.svelte`). There is no spatial indicator pointing the player toward the objective's location in the world.
- **Reproduction**: accept a quest with a location/NPC target (e.g. "talk to the Elder"), then explore — nothing on screen indicates which direction to walk.
- **Existing implementation to reuse**:
  - `packages/shared/schemas/src/lib/game/content_pack.ts` `ContentPackQuestObjectiveSchema` — objective targets: `mapId` (completes on enter), `npcId` (completes on interact), `encounterId` (completes on encounter), `itemId` (completes on pickup), plus `hidden`/`revealOn` and prerequisite indices.
  - `packages/shared/schemas/src/lib/game/quest_state.ts` + `packages/shared/types/src/lib/game/quest_state.ts` — `ActiveQuestState`, `QuestObjectiveProgressV1` (`objectiveIndex`, `status`, `hiddenRevealed`).
  - `apps/frontend/client/src/lib/views/game/ui/quest_tracker_view.svelte` + `quest_tracker_view_model.svelte.ts` — current text-only quest HUD and `currentObjectiveText`.
  - Entity positions from the content-pack entity spawner (C-136) → ECS `Position`.
  - C-502 `projectSpatialPoint` API — use its world→screen mode with viewport-edge clamping; do not depend on a minimap-only projection.
- **Known gaps**:
  1. No objective→spatial-target resolution (`npcId`/`mapId`/`itemId`/`encounterId` → world position).
  2. No marker rendering, and no gating on `status`/`hiddenRevealed`.
- **Baseline tests**: `apps/frontend/client/src/lib/views/game/ui/hud/quest_overlay_view_model.test.ts`, quest-state tests. Run before starting.

## User Outcome

After this contract, a player with an active quest can see a directional marker pointing toward the current objective, and a world-anchored marker when the target is on-screen — without markers for hidden or completed objectives.

## Success Measures

- **Time/latency target**: marker updates within the frame budget; position resolution is cheap.
- **Offline/degraded behavior**: markers resolve from local quest state + entity positions only; no network/AI.
- **Production journey enabled**: player can navigate directly to a quest target ("talk to the Elder") instead of guessing.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Objective targets | `content_pack.ts` `ContentPackQuestObjectiveSchema` | reuse |
| Quest runtime state | `quest_state.ts` schemas + types | reuse |
| Current quest text HUD | `quest_tracker_view.svelte` / `quest_tracker_view_model.svelte.ts` | reuse (extend, don't replace) |
| Entity positions | content-pack entity spawner → ECS `Position` | reuse |
| World→screen projection | C-502 projection bridge | reuse |

## Overview

Resolve the active quest's current objective into a spatial target (NPC/map/item/encounter position), then render a screen-edge directional marker when the target is off-screen and a world-anchored marker when it is on-screen. Hidden, locked, and completed objectives produce no marker.

## Design Reference

- Extend the existing quest tracker HUD rather than replacing its text display — text + marker coexist.
- Reuse the C-502 projection bridge for world→screen math; do not fork it.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Put objective→target resolution in a unit-tested pure function/service; the Svelte component stays a passive view over a ViewModel.
- The marker must degrade gracefully when the target entity does not exist (NPC not spawned, item already picked up).
- Project resolved positions through C-502 `projectSpatialPoint({ mode: 'screen', ... })`; use `clampTo: 'viewport-edge'` for off-screen arrows and its returned `direction`, rather than defining separate world→screen math.

## State & Data Models

```ts
type QuestMarkerTarget =
  | { kind: 'npc'; npcId: string }
  | { kind: 'map'; mapId: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'encounter'; encounterId: string };

type QuestMarkerState = {
  active: boolean;              // a revealable, in-progress objective has a spatial target
  target: QuestMarkerTarget | null;
  worldX: number | null;        // resolved world position, null when unresolvable
  worldY: number | null;
  onScreen: boolean;            // world-anchored vs edge-arrow
};
```

No persisted schema changes.

Target resolution is deterministic and uses only canonical content identifiers plus currently loaded world data:

- `npcId`: collect live ECS entities whose `NPCDialog.npcId` equals the identifier and that have a `Position`; choose the lowest numeric entity ID. No match returns `null`; multiple matches use that same lowest-ID rule.
- `mapId`: if it is the current map, return `null` because the map-enter objective should complete rather than point within that map. Otherwise, collect current-map transition zones whose normalized `targetMap` resolves to the manifest map ID and choose the lexicographically lowest zone ID, anchored at the zone rectangle's center. No matching transition, or an unknown map ID, returns `null`; multiple matches use the same lowest-zone-ID rule. Multi-hop route finding remains out of scope.
- `itemId`: collect live, uncollected world pickup/interactable entities whose canonical item ID equals the identifier and that have a `Position`; choose the lowest numeric entity ID. Inventory items do not count. No match returns `null`; multiple matches use that same lowest-ID rule.
- `encounterId`: collect live encounter/enemy entities whose canonical encounter ID equals the identifier and that have a `Position`; choose the lowest numeric entity ID. If none is spawned, resolve the encounter's manifest `mapId` through the `mapId` rule above. An unknown encounter, an encounter on the current map with no positioned entity, or an unresolved map fallback returns `null`; multiple live matches use the same lowest-ID rule.

The resolver returns either one `{ target, worldX, worldY }` anchor or `null`; it never guesses from an objective ID or stale/despawned entity. A `null` result sets `active: false`, clears both coordinates, and renders no marker while leaving the text tracker intact.

## Quality Requirements

- **Offline/degraded mode**: fully local; no network.
- **Accessibility/input**: marker is non-interactive HUD; text remains the accessible fallback.
- **Performance budget**: update at most once per frame; target resolution cached until objective/entity changes.
- **Security/privacy**: N/A — local state only.
- **Persistence/migration**: N/A — no persisted state.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: log `quest-marker:resolved` on target change only, not per frame.

## Migration & Rollback

N/A — no persistent state changes.

## Scope Boundaries

- **In Scope:**
  - Objective→spatial-target resolution.
  - Directional edge marker + on-screen world marker.
  - Gating by objective `status` and `hiddenRevealed`.
  - Graceful degradation for unresolvable targets.
- **Out of Scope:**
  - Minimap (C-502).
  - Quest journal redesign or new quest content.
  - Pathfinding/route display.
  - Multiple simultaneous markers (current objective only).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** single contract. One marker primitive over the shared projection bridge.

## Acceptance Criteria

### AC-1: Off-screen objective shows a directional marker
**Given** an active, revealed objective with a spatial target that is off-screen
**When** the player explores
**Then** a screen-edge marker points in the correct direction toward the target.
**Production Path**: `/game`

### AC-2: On-screen objective shows an anchored marker
**Given** the objective target is within the viewport
**When** the player looks at the target area
**Then** a marker anchors over the target's world position.
**Production Path**: `/game`

### AC-3: Hidden or completed objectives produce no marker
**Given** an objective with `status` other than `active`, or `hiddenRevealed === false`
**When** the player explores
**Then** no marker is rendered for that objective.
**Production Path**: `/game`

### AC-4: Unresolvable target degrades gracefully
**Given** an active objective whose target entity does not exist (e.g. NPC not spawned)
**When** the player explores
**Then** no marker renders and no error/crash occurs; the text quest tracker still shows the objective.
**Production Path**: `/game`

### AC-5: Marker updates and works offline
**Given** the player moves toward/away from the target with no network connection
**When** the camera moves
**Then** the marker direction/anchoring updates within the frame budget.
**Production Path**: `/game`

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E + Visual | `apps/e2e/tests/client/quest_marker.spec.ts` + visual suite | `/game` | Filled during verification |
| AC-2 | E2E + unit | `quest_marker_view_model.test.ts` | `/game` | Filled during verification |
| AC-3 | unit | target-resolution test | `/game` | Filled during verification |
| AC-4 | unit + manual | target-resolution test | `/game` | Filled during verification |
| AC-5 | E2E + manual | offline smoke | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`, `bun moon run engine:test`
- Integration: manual `/game` smoke — accept the Ember Watch quest ("talk to the Elder"), verify marker points at the Elder; complete it and verify marker clears.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/quest_marker.spec.ts` — marker appears for active objective, points correctly, clears on completion.
    - **Visual**: `apps/e2e/src/visual/suites/quest_marker.visual.ts` — declarative case at `/game` with an active quest; schema: directional marker at screen edge; OpenRouter AI evaluation: "Score 90+: a clear quest marker/arrow visible pointing toward the objective, no marker for completed/hidden objectives."

**Watch Points**:
- **Reuse the C-502 projection bridge** — this contract must not introduce a second world→screen math implementation.
- **Only `active` + `hiddenRevealed` objectives get markers** — check `QuestObjectiveProgressV1.status` and `hiddenRevealed` before resolving.
- **Target resolution is deterministic** — apply the per-kind lowest-ID/zone rule and documented map/encounter fallback; zero matches yield `null`, never throw, and multiple matches never depend on iteration order.
- **Current objective only** — do not render a marker per objective in the list.
- **Coordinate with C-502 sequencing** — land C-502's projection bridge first; this contract depends on it.

## Implementation Sequence

1. **Phase 1 (Resolution)**: add + unit-test objective→spatial-target resolution with status/hidden gating.
2. **Phase 2 (Marker)**: build `quest_marker_view_model.svelte.ts` + marker view using the C-502 projection bridge; wire into the HUD.
3. **Phase 3 (Validation)**: E2E + visual (Ember Watch "talk to the Elder" journey); run `validate({ test: true })` and the Moon tasks above.

## Edge Cases & Gotchas

- **Objective with no spatial target** (text-only): no marker, text fallback remains.
- **Target entity despawns mid-quest**: clear the marker, don't stale-anchor to a removed entity.
- **Multiple active objectives**: mark only the current (first in-progress) objective.
- **Camera at map edge**: clamp the edge-arrow so it never renders off-window.

## Open Questions

Must be resolved before status becomes `approved`:

- When multiple objectives are `active` simultaneously, marker should follow the first in-progress objective (index order). Confirm this matches the quest tracker's `currentObjectiveText` selection.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
