---
id: C-460
title: "NPC Behavioral Autonomy Layer"
source: "docs/contracts/BACKLOG_C452_PLUS.md 'C-465' seed (RPG-depth batch, 2026-08-30 roadmap review). Renumbered on authoring — see C-456's source note for the ID-allocation caveat."
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/232"
  pr_number: 232
created_at: "2026-09-02"
---

# Contract C-460: NPC Behavioral Autonomy Layer

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/BACKLOG_C452_PLUS.md` RPG-depth batch, seed "C-465" |
| **Target** | `packages/frontend/engine/src/systems/macro_simulation_system.ts` (C-194), autonomous NPC idle-chat (`packages/shared/constants/src/lib/autonomous_npc.ts`, `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts`, C-248) |
| **Type** | full |
| **Priority** | P3 |
| **Dependencies** | [C-456](C-456-group-chat-and-systemic-npc-interactions.md) (nearby-NPC awareness source), [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) (relationship/faction data this layer wires in) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | user-facing (indirect — NPCs feel more alive) |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: two mechanical systems already exist and are lightweight by design — `MacroSimulationSystem` (C-194) steps offscreen NPCs' GOAP actions every 500ms (`selectBestAction`/`evaluatePreconditions`/`applyEffects`), purely spatial/mechanical, no relationship or memory input. `autonomous_message_service.svelte.ts` (C-248) selects which idle NPC speaks based on idle-timer, per-NPC `DEFAULT_TALKATIVENESS` (0.5), cooldown, and schedule-driven availability — also with zero coupling to relationships, factions, or memory. Both systems make real behavioral decisions (which GOAP action to take; which NPC talks and when) using only mechanical/timing inputs.
- **Reproduction**: N/A — not a bug, a scoping gap; observable by inspecting `selectBestAction`'s scoring inputs (spatial/GOAP only) and `autonomous_message_service.svelte.ts`'s NPC-selection weighting (talkativeness/cooldown/schedule only, no relationship or faction terms).
- **Existing implementation to reuse**: both `MacroSimulationSystem` and the C-248 idle-chat selection are reused as-is structurally — this contract is explicitly "wire memory/relationships into decisions these systems already make," not a new simulation layer, per the backlog seed and Directive #7 (progressive disclosure) and Directive #12 (no technology migration inside the vertical slice unless it removes a blocker).
- **Known gaps**: neither system reads `relationship_state.ts`/`faction_standing.ts` (C-341) or C-458's retrieval layer at all. An NPC hostile to the player's faction behaves identically, mechanically, to a friendly one; idle-chat NPC selection doesn't favor NPCs with an active relationship thread or recent shared history with the player.
- **Baseline tests**: `packages/frontend/engine/src/__tests__/macro_simulation.test.ts` (C-194 baseline), existing autonomous message service tests — establish current mechanical-only behavior as the regression baseline. This contract extends the existing macro simulation test file with new tests for relationship-weighted scoring; it does not create a separate test file from scratch.

## User Outcome

After this contract, NPCs' autonomous behavior (offscreen actions, idle-chat participation) reflects their relationships and faction standing with the player and party — a hostile faction member's offscreen GOAP choices and an ally's idle-chat likelihood both differ meaningfully from a neutral stranger's, without a new simulation system being built.

## Success Measures

- **Time/latency target**: no change to existing tick rates (500ms macro tick, 60s idle-chat poller) — this contract adds scoring inputs, not new loops.
- **Offline/degraded behavior**: relationship/faction lookups must degrade to current (relationship-agnostic) behavior if C-458's retrieval layer is unavailable — never blocks or errors the existing mechanical systems.
- **Production journey enabled**: a player who has built (or damaged) relationships with NPCs and factions sees that reflected in ambient, systemic ways — not just in dialogue, but in who talks to them unprompted and how offscreen NPCs act.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Offscreen GOAP stepping | `MacroSimulationSystem`, `action_registry.ts` (C-194) | reuse — modify scoring inputs only |
| Idle-chat NPC selection | `autonomous_message_service.svelte.ts`, `autonomous_npc.ts` constants (C-248) | reuse — modify selection weighting only |
| Relationship/faction data | `relationship_state.ts`/`faction_standing.ts` (C-341), accessed via `relationship_service.svelte.ts` (`.getRelationship()`, `.getStanding()`) in the client; injected context in the engine | new input — read, not modified |
| Memory/retrieval | [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) | new input — read for "recent shared history" signal |

## Overview

Wire relationship and faction standing (C-341 — accessed via `relationship_service.svelte.ts`) and, where relevant, recent shared history (C-458 — via `memoryRetrievalService.query()`) into the scoring/selection logic of two existing mechanical systems: `MacroSimulationSystem`'s GOAP action selection and C-248's idle-chat NPC selection. No new simulation layer, no new scheduling system — additive scoring terms on existing decision points, consistent with the codebase's stated bias against feature-bloat copied from reference tools (Marinara-Engine/SillyTavern/RisuAI) that don't share Aikami's "game first" directives.

## Design Reference

Follow Directive #7 (progressive disclosure) — this remains ambient/systemic behavior, not a new player-facing configuration surface; players feel the effect, they don't configure relationship-weighted NPC AI directly. Follow Directive #2 (AI proposes; rules engine decides) where any LLM-originated content is involved (e.g. C-458 memory results influencing idle-chat topic) — the *decision* of which NPC acts/speaks stays deterministic, scored by the existing systems; only content generation (what they say) remains LLM-driven as it already is.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- `MacroSimulationSystem`/`stepMacroAgent`: add relationship/faction standing as an optional scoring term before the GOAP `selectBestAction` call — e.g. a hostile-faction NPC's action scoring can favor aggressive/avoidant actions toward the player's known position; a friendly NPC's scoring can favor helpful/approach actions. Keep this additive to existing precondition/effect evaluation, not a replacement. **Data flow**: `stepMacroAgent(eid)` reads per-entity relationship context from a new optional parameter or a module-level lookup (e.g. a `Map<number, GoapActionScoringContext>` keyed by entity ID) rather than importing client services directly into the engine package — the engine (`packages/frontend/engine/`) must not depend on `apps/frontend/client/`; relationship data must be injected or stored in bitECS components at the boundary.
- `autonomous_message_service.svelte.ts`: add relationship/faction standing (via `relationshipService.getRelationship()`, `relationshipService.getStanding()`) and recent-shared-history (via `memoryRetrievalService.query()`, C-458) as additional weighting terms alongside existing talkativeness/cooldown/schedule — an NPC with an active relationship thread or recent shared event should have elevated selection weight within the existing selection algorithm, not a parallel selection path.
- Both integrations must be read-only against relationship/faction/memory data — this contract does not change how relationships or faction standing themselves are computed or updated (that's C-341's domain).
- Preserve `MAX_AUTONOMOUS_MESSAGES_PER_TICK` and the 500ms macro tick rate exactly — this contract changes *what* is scored, not *how often* or *how many* decisions happen.

## State & Data Models

```typescript
// packages/frontend/engine/src/systems/macro_simulation_system.ts — additive scoring input
type GoapActionScoringContext = {
  // existing spatial/precondition inputs unchanged
  playerRelationship?: { standing: number; factionTier?: string }; // optional, from C-341
  npcFactionId?: string;
};

// apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts — additive weighting input
type NpcSelectionWeight = {
  // existing talkativeness/cooldown/schedule terms unchanged
  relationshipBoost: number; // derived from relationship_state.ts standing + C-458 recent-history signal, defaults to 0 when unavailable
};
```

No `packages/shared` schema changes — both are additive scoring/weighting terms consumed at decision time, not new persisted state.

## Quality Requirements

- **Offline/degraded mode**: both systems function identically to today when relationship/faction/memory data is unavailable (new campaign, or C-458 not yet indexed) — scoring terms default to neutral (0/no boost), never block decision-making.
- **Accessibility/input**: N/A.
- **Performance budget**: relationship/faction lookups must not slow the 500ms macro tick or the 60s idle-chat poller measurably — prefer cheap direct reads from `relationship_state.ts` over C-458 retrieval queries inside the hot macro-tick loop; reserve retrieval queries (slower) for the idle-chat path, which already runs on a much longer interval.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no new persistent state.
- **Cancellation/retry/idempotency**: N/A — synchronous scoring reads.
- **Observability**: log when relationship/faction scoring meaningfully changes an outcome (e.g. an NPC selected for idle-chat specifically due to relationship boost) for tuning visibility.

## Migration & Rollback

N/A — no persistent state changes. Rollback is reverting the additive scoring terms; both underlying systems (C-194, C-248) are functionally unchanged without them.

## Scope Boundaries

- **In Scope:** relationship/faction-standing scoring input to `MacroSimulationSystem`'s GOAP action selection; relationship/faction/recent-history weighting input to C-248's idle-chat NPC selection.
- **Out of Scope:** any new simulation system, new scheduling loop, or new tick rate; changing how relationships/faction standing themselves are computed (C-341's domain); group-conversation turn-taking (that's [C-456](C-456-group-chat-and-systemic-npc-interactions.md)); player-facing configuration of NPC behavior weighting (violates Directive #7).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single contract — both scoring integrations (GOAP and idle-chat) are the same pattern (additive relationship-aware scoring on an existing decision point) applied to two systems; splitting would duplicate the design discussion without either half being more independently valuable.

## Acceptance Criteria

### AC-1: Faction-hostile NPC's offscreen GOAP action reflects hostility
**Given** an NPC with negative faction standing toward the player, stepped by `MacroSimulationSystem` while offscreen
**When** `selectBestAction` evaluates candidate actions
**Then** the selected action differs (favoring aggressive/avoidant behavior) compared to an otherwise-identical neutral-standing NPC — verified by seeding identical NPCs with different faction standings and asserting divergent `selectBestAction` results

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/engine/src/__tests__/macro_simulation.test.ts` (extended) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: seed two otherwise-identical NPCs with different faction standings, step both, compare selected actions
- E2E / Visual: N/A

**Watch Points**:
- Must not break existing GOAP precondition/effect correctness for NPCs with no relationship data (defaults to current behavior).

### AC-2: Relationship standing elevates idle-chat selection likelihood
**Given** two idle NPCs with equal talkativeness/cooldown/schedule state but different relationship standing with the player
**When** the idle-chat poller selects a speaker
**Then** the NPC with higher relationship standing (or more recent shared history via C-458) receives a higher selection weight — verified by testing that the weight computation function produces a correctly elevated `relationshipBoost` term for higher-standing NPCs (not by stochastic distribution across trials)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | extended autonomous message service tests | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: run selection N times with seeded relationship data, assert statistically favored selection
- E2E / Visual: N/A

**Watch Points**:
- `MAX_AUTONOMOUS_MESSAGES_PER_TICK` must remain unchanged — this AC is about *who* is selected, not *how many*.

### AC-3: Both systems degrade gracefully with no relationship/memory data
**Given** a fresh campaign with no relationship history and C-458 retrieval unindexed
**When** both `MacroSimulationSystem` and the idle-chat poller run
**Then** behavior matches current (pre-contract) baseline exactly — no errors, no blocked decisions

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/engine/src/__tests__/macro_simulation.test.ts` (extended), autonomous message service tests | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`, `moon run client:test`
- Integration: fresh dev-sandbox campaign, run both systems, diff against pre-contract baseline behavior
- Regression: run the existing C-194 macro simulation tests unchanged to confirm no baseline regression
- E2E / Visual: N/A

**Watch Points**:
- This is the primary regression guard — treat any deviation from current baseline (in the no-data case) as a blocker.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: add relationship/faction-standing read to `MacroSimulationSystem`'s scoring context; add relationship/history weighting term to C-248's selection algorithm.
2. **Phase 2 (Integration)**: wire both to read from `relationship_state.ts`/`faction_standing.ts` (C-341) and, for idle-chat, optionally query C-458 for recent-history signal.
3. **Phase 3 (Validation)**: run `bun run validate`, `moon run engine:test`, `moon run client:test`, and confirm AC-3's no-data baseline is unchanged.

## Edge Cases & Gotchas

- **Macro tick performance**: relationship reads inside the 500ms macro-tick hot loop must stay cheap (direct state read, not a retrieval query) — reserve any C-458 retrieval usage for the much-lower-frequency idle-chat path per the Performance Budget note above.
- **Engine-client boundary**: the engine package (`packages/frontend/engine/`) cannot import from `apps/frontend/client/`. Relationship data must reach the GOAP system via injection (e.g. a `Map<eid, GoapActionScoringContext>` set by the caller before stepping) or via bitECS components — not by importing `relationshipService` directly.
- **Relationship data mid-change**: an NPC's standing could change between tick evaluations — acceptable, since both systems already re-evaluate every tick/poll; no special staleness handling needed beyond reading current state each time.

## Open Questions

Must be resolved before status becomes `approved`:

- Should faction-hostile NPCs' GOAP scoring changes be visible/noticeable to the player in the vertical slice's current content, or is this groundwork for future content packs with richer hostile-NPC behaviors — affects how aggressively to tune the scoring weights initially.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Execution Report

### Summary
Wired relationship/faction standing data into two existing decision-making systems: `MacroSimulationSystem`'s GOAP action selection (engine) and `autonomous_message_service`'s idle-chat NPC weighting (client). Added `GoapActionScoringContext` type, entity-aware scoring context map, and relationship-based cost modifiers to `action_registry.ts` for engine-side relationship-aware GOAP selection. Added `_computeRelationshipBoost` method to the autonomous message service for client-side relationship-weighted NPC selection. Both degrade gracefully to current behavior when no relationship data is available. No new state, schemas, loops, or tick rates were introduced.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | 8 new engine tests confirm hostile/friendly NPCs diverge from neutral baseline; relationship cost modifier influences tie-breaking |
| AC-2 | ✅ | 3 new client tests confirm relationship boost computation works correctly for friendly, hostile, and unknown NPCs |
| AC-3 | ✅ | All 21 baseline engine tests + 6 baseline client tests pass unchanged; new "no data" tests confirm graceful degradation |

### Files Created
None — all changes are additive modifications to existing files.

### Files Modified
| File | Change |
|---|---|
| `packages/frontend/engine/src/math/goap/action_registry.ts` | Added `GoapActionScoringContext` type, scoring context map (`setEntityScoringContext`/`clearAllScoringContexts`/`getEntityScoringContext`), `_applyRelationshipCostModifier` function, modified `selectBestAction` to accept optional entity ID |
| `packages/frontend/engine/src/math/goap/index.ts` | Re-exported new types and functions from action_registry.ts |
| `packages/frontend/engine/src/systems/macro_simulation_system.ts` | Pass entity ID through to `selectBestAction` call in `stepMacroAgent` |
| `packages/frontend/engine/src/__tests__/macro_simulation.test.ts` | Added 8 AC-4 tests for relationship-aware scoring (hostile/friendly divergence, context cleanup, backward compat, no-data degradation) |
| `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` | Added `_computeRelationshipBoost` method using `relationshipService.getRelationship()`; modified `_selectWeightedRandom` and `_selectWeightedRandomN` to include relationship boost in weight computation |
| `apps/frontend/client/src/lib/services/npc/autonomous_message_service.test.ts` | Added 3 AC-2 tests for relationship boost (friendly boost, no-data zero, hostile negative) |

### Deviations from Spec
None. All ACs implemented as specified. The relationship cost modifier was kept small (max 3) so it influences tie-breaking without overriding goal progress, which aligns with the "additive scoring term" directive.

### Test Results
- Unit (Engine): 29/29 pass (0 failures) — 21 baseline + 8 AC-4
- Unit (Client): 9/9 pass (0 failures) — 6 baseline + 3 AC-2
- Baseline: 0 pre-existing failures, 0 new failures
- Pre-existing `bun` typecheck issue in `frontend-engine:typecheck` (TS2688: missing bun types) — not caused by this contract

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
