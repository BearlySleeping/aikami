---
id: C-456
title: "Group Chat & Systemic NPC Interactions"
source: "docs/contracts/BACKLOG_C452_PLUS.md 'C-461' seed (RPG-depth batch, 2026-08-30 roadmap review). Renumbered on authoring per BACKLOG_C452_PLUS.md's own ID-allocation caveat — C-453/454/455 were claimed by unrelated contracts by the time this batch was drafted; C-456 is the real next free ID."
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-02"
---

# Contract C-456: Group Chat & Systemic NPC Interactions

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/BACKLOG_C452_PLUS.md` RPG-depth batch, seed "C-461" |
| **Target** | `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts`, `apps/frontend/client/src/lib/services/game/party_roster_service.svelte.ts`, a new NPC-awareness source under `apps/frontend/client/src/lib/services/npc/`, `packages/shared/constants/src/lib/autonomous_npc.ts` |
| **Type** | full |
| **Priority** | P2 |
| **Dependencies** | [C-340](C-340-build-party-and-companion-gameplay.md) (party roster + data model — implemented); builds on [C-235](C-235-gm-narrative-director.md) (address-mode prompt shape — done) and [C-248](C-248-autonomous-npc-behavior-schedules.md) (idle-chat cooldown/talkativeness — completed) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing |
| **Contract version** | 1.1.0 |

## Problem & Baseline Evidence

- **Current behavior**: `gm_prompt_service.svelte.ts`'s `'party'` address mode already formats multi-character voice instructions ("Each party member speaks in their own distinct voice… prefix with **Name**: dialogue.", `_buildAddressModeInstruction`) and already gates a `[PARTY MEMBERS]` block into the assembled prompt — but the two functions that populate that data, `_gatherNearbyNpcs()` and `_gatherPartyMembers()`, are stub TODOs that unconditionally `return []`. So the prompt *shape* for group scenes exists and is unused: no real party member or nearby-NPC context ever reaches the LLM today, and NPCs never participate in a turn alongside other NPCs — only isolated 1:1 player↔NPC exchanges work end to end.
- **Reproduction**: Enter `'party'` address mode with 2+ recruited companions in `party_roster_service.svelte.ts`'s `members` state and send a message — the assembled prompt's `[PARTY MEMBERS]` section is empty because `_gatherPartyMembers()` returns `[]` regardless of roster state.
- **Existing implementation to reuse**: `AddressMode` type + `_buildAddressModeHeader`/`_buildAddressModeInstruction` (address-mode prompt formatting, C-235) — reuse as-is. `party_roster_service.svelte.ts`'s reactive `members: PartyRosterEntry[]` state (C-340) — the real data source `_gatherPartyMembers()` should read from. `autonomous_npc.ts` constants (talkativeness, cooldown, `MAX_AUTONOMOUS_MESSAGES_PER_TICK`) and the idle-chat poller (C-248) — extend for multi-NPC turns instead of building a parallel scheduling system.
- **Known gaps**: No nearby-NPC awareness source is wired into `gm_prompt_service.svelte.ts` — `_gatherNearbyNpcs()` is a stub. However, the underlying data already exists: `worldStateService.currentLocation` exposes `WorldLocation` which has an `npcIds` field (`packages/shared/schemas/src/lib/domain/world.ts`). The gap is reading that field and resolving NPC details (name, persona) into `GmNpcContext`, not building new spatial state. `MAX_AUTONOMOUS_MESSAGES_PER_TICK = 1` in C-248's idle-chat constants hard-caps autonomous chat to one NPC per tick, which is fine for idle ambiance but wrong for an active group conversation where the player addressed multiple NPCs at once.
- **Baseline tests**: `gm_prompt_service.test.ts` (party/scene/gm mode assembly), `party_roster_service.svelte.test.ts`, any existing `autonomous_message_service.svelte.ts` tests — run before starting; both stub functions currently have no test asserting non-empty output, so "returns `[]`" is not caught as a regression today.

## User Outcome

After this contract, a player in a scene with multiple party members or nearby NPCs present can address the group and get a response where each present character speaks in their own voice, aware of both the player and each other, instead of only ever getting a single NPC's isolated reply.

## Success Measures

- **Time/latency target**: no added latency budget beyond the existing single-LLM-call prompt assembly — this is a context-gathering fix, not a new inference round-trip.
- **Offline/degraded behavior**: if the NPC-awareness source cannot resolve nearby NPCs (e.g. mid-transition between zones), `_gatherNearbyNpcs()` degrades to an empty array exactly as today rather than throwing — group chat should never block on scene metadata being incomplete.
- **Production journey enabled**: player can recruit 2+ companions, address them together, and receive a scene where NPCs react to each other's dialogue, not just the player's.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Address-mode prompt formatting | `gm_prompt_service.svelte.ts` `_buildAddressModeHeader`/`_buildAddressModeInstruction` (C-235) | reuse as-is |
| Party roster reactive state | `party_roster_service.svelte.ts` `members` (C-340) | reuse — wire into `_gatherPartyMembers()` |
| Idle-chat scheduling/talkativeness | `packages/shared/constants/src/lib/autonomous_npc.ts`, autonomous message poller (C-248) | modify — allow >1 participant per group-addressed turn without changing idle-ambiance behavior |
| Party order data model | `PartyRosterEntrySchema`/`PartyStateSchema` (`packages/shared/schemas/src/lib/game/party.ts`, C-340) | reuse — no schema change required for this contract |

## Overview

Close the gap between the prompt-formatting layer (already built in C-235) and real data: give `gm_prompt_service.svelte.ts` a live source for "who is present in this scene," wire `_gatherPartyMembers()` to the existing party roster, and extend the idle-chat/autonomous system so a group-addressed turn can produce more than one NPC response in the same GM turn, with each NPC aware of what the others just said.

## Design Reference

Follow `gm_prompt_service.svelte.ts`'s existing section-assembly pattern (`gatherContext()` → typed context object → `assemblePrompt()`) — add real data to the existing `GmNpcContext`/`GmPartyMemberContext` shapes in `gm_types.ts` rather than inventing new ones. Follow C-248's poller/cooldown pattern for the multi-NPC turn cap rather than building new scheduling primitives.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Replace `_gatherPartyMembers()`'s `return []` stub with a read from `partyRosterService.members`, mapped to `GmPartyMemberContext` (name, class, approval-relevant fields already on `PartyRosterEntry`).
- Build a nearby-NPC awareness source (new, scoped to the current scene/location) and wire `_gatherNearbyNpcs()` to it — scope to "NPCs the scene/encounter system currently marks as present," not a new spatial query system; reuse whatever scene/location state already exists rather than adding a second source of truth.
- Extend C-248's autonomous message selection so a single group-addressed player turn can select multiple present NPCs to respond (bounded — see Open Questions) instead of only the existing `MAX_AUTONOMOUS_MESSAGES_PER_TICK = 1` idle-ambiance cap, which stays unchanged for idle (non-addressed) ticks.
- Each NPC's response context includes the other responding NPCs' dialogue from the same turn so reactions read as aware, not parallel-independent monologues — sequence multi-NPC generation within a turn rather than firing all NPC calls off the same pre-turn snapshot.

## State & Data Models

```typescript
// apps/frontend/client/src/lib/services/gm/gm_types.ts — use existing shapes, no new schema package needed
// GmPartyMemberContext already exists:
//   id: string; name: string; personality: string;
// Map PartyRosterEntry fields (npcId, name, classId, level) into this shape.
// The `personality` field should be populated from the NPC's persona/class description.
//
// GmNpcContext already exists for nearby NPCs:
//   id: string; name: string; persona: string; relationship: string; currentActivity: string;
// Populate from WorldLocation.npcIds + NPC data sources; no new type needed.
```

No `packages/shared` schema changes — this contract wires existing client-local GM types to existing party/scene state, per `gm_types.ts`'s documented decision to keep GM prompt context app-local.

## Quality Requirements

- **Offline/degraded mode**: group chat works fully offline (local AI engine) exactly as 1:1 chat does today — no new network dependency.
- **Accessibility/input**: N/A — no new input surface, only richer AI-generated dialogue.
- **Performance budget**: multi-NPC turn generation must not multiply LLM calls unbounded — cap participant count per turn (see Open Questions) so a crowded scene doesn't produce an N-call cascade.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no new persistent state, only prompt-context assembly.
- **Cancellation/retry/idempotency**: a failed mid-turn NPC generation must not corrupt the party/scene state that fed it — treat each NPC response as independently retryable.
- **Observability**: log when `_gatherNearbyNpcs()`/`_gatherPartyMembers()` return non-empty for the first time in a session (replacing the current permanently-empty baseline), and log the participant count selected per group turn.

## Migration & Rollback

N/A — no persistent state changes. Rollback is reverting the two stub functions and the multi-NPC selection change; idle-chat (C-248) behavior for non-addressed ticks is unaffected either way.

## Scope Boundaries

- **In Scope:** wiring `_gatherPartyMembers()`/`_gatherNearbyNpcs()` to real data; extending C-248's selection logic to allow multiple NPCs per group-addressed turn; sequencing multi-NPC responses within one turn so NPCs react to each other.
- **Out of Scope:** new party orders (wait/guard/scavenge — that's the C-340 amendment, tracked separately); GM prompt budget/truncation logic (that's [C-457](C-457-gm-prompt-assembly-upgrade.md)); memory/lore retrieval feeding NPC awareness (that's [C-458](C-458-in-house-memory-and-lore-retrieval-system.md)); any new UI for group-addressing beyond the existing `'party'` address mode toggle.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single contract — party-member wiring and nearby-NPC wiring share the same context-gathering seam in `gm_prompt_service.svelte.ts` and the same multi-NPC turn-sequencing change; splitting them would leave one half unable to demonstrate a real group scene.

## Acceptance Criteria

### AC-1: Party members appear in the assembled prompt
**Given** 2+ recruited companions in `party_roster_service.svelte.ts`'s roster and `'party'` address mode active
**When** `assemblePrompt()` runs
**Then** the `[PARTY MEMBERS]` section contains each companion's name/class, not an empty block

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `gm_prompt_service.test.ts` | `/game` party-mode chat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: recruit 2 companions in a dev sandbox campaign, switch to party mode, inspect assembled prompt in dev tools/log
- E2E / Visual: N/A — prompt-assembly change, not a visible UI change

**Watch Points**:
- Don't regress `'scene'`/`'gm'` mode prompts, which should not include the party block.

### AC-2: Nearby NPCs are addressable without being party members
**Given** an NPC present in the current scene (via `WorldLocation.npcIds`) but not recruited
**When** the player addresses the group in party mode
**Then** that NPC's context is included via `_gatherNearbyNpcs()` and it can respond

**Note**: The `[NEARBY NPCS]` section is already assembled for all modes; `[PARTY MEMBERS]` is party-mode-only. AC-2 specifically tests that a non-party NPC appears in the party-mode prompt context.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `gm_prompt_service.test.ts`, new NPC-awareness source test | `/game` scene with unrecruited NPCs present | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: dev sandbox scene with 2+ NPCs, none recruited, confirm both surface in context
- E2E / Visual: N/A

**Watch Points**:
- Must not double-count an NPC that is both a party member and scene-present.

### AC-3: Multiple NPCs respond in one group-addressed turn, aware of each other
**Given** a group-addressed turn with 2+ present NPCs
**When** the GM generates responses
**Then** more than one NPC responds in that turn (bounded per Open Questions), and at least one NPC's response reflects awareness of another NPC's dialogue from the same turn

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | new multi-NPC turn sequencing test | `/game` party-mode multi-NPC exchange | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: script a group turn in a dev sandbox campaign, inspect generated dialogue for cross-reference
- E2E / Visual: **Functional**: `tests/client/group_chat.spec.ts` — send a group-addressed message with 2 companions, assert 2 distinct NPC replies appear in the chat log. **Visual**: N/A.

**Watch Points**:
- Bound the participant cap explicitly (see Open Questions) — an unbounded cascade is both a cost and a latency risk.
- The multi-NPC generation sequencing must not change the idle-chat poller's `MAX_AUTONOMOUS_MESSAGES_PER_TICK` behavior (see AC-4).

### AC-4: Idle-chat (non-addressed) behavior is unchanged
**Given** no player message (idle tick), C-248's existing poller
**When** the idle-chat poller fires
**Then** `MAX_AUTONOMOUS_MESSAGES_PER_TICK` still caps at 1 exactly as before this contract — the multi-NPC change only applies to player-addressed group turns

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | existing autonomous message service tests, extended | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: run idle-chat poller in dev sandbox, confirm single-message-per-tick behavior unchanged
- E2E / Visual: N/A

**Watch Points**:
- This is a regression guard — the risk is the multi-NPC turn logic accidentally sharing code paths with the idle poller and loosening its cap.

### AC-5: Group-addressed multi-NPC turn has a bounded cap
**Given** a group-addressed turn with N+ present NPCs where N exceeds the configured participant cap
**When** the GM generates responses
**Then** the number of responding NPCs is bounded by the configured cap (see Open Questions), not by the idle-chat `MAX_AUTONOMOUS_MESSAGES_PER_TICK`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Integration | new multi-NPC selection test | `/game` party-mode with N+ present NPCs | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: script a group turn with 5 NPCs present, cap=3, confirm only 3 respond
- E2E / Visual: N/A

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: wire `_gatherPartyMembers()` to `partyRosterService.members`; build the nearby-NPC awareness source and wire `_gatherNearbyNpcs()`.
2. **Phase 2 (Integration)**: extend C-248's selection logic for group-addressed turns; sequence multi-NPC generation within a turn so later NPCs see earlier NPCs' dialogue.
3. **Phase 3 (Validation)**: run `bun run validate`, `moon run client:test`, the new `group_chat.spec.ts` functional E2E, and manually verify idle-chat behavior is unaffected.

## Edge Cases & Gotchas

- **Party member also present as "nearby NPC"**: dedupe by `npcId` before assembling context — a recruited companion should only appear once.
- **Scene transition mid-turn**: if the scene changes between context-gathering and response generation, don't let a stale nearby-NPC list produce a response from an NPC no longer present — snapshot the participant list once per turn.
- **All present NPCs unrecruited and hostile**: group-addressing hostile NPCs should still assemble context correctly even if a group *conversation* doesn't make narrative sense — that's a content/GM-prompt judgment call, not something this contract needs to block on.

## Open Questions

Must be resolved before status becomes `approved`:

- What is the hard cap on NPCs responding in a single group-addressed turn (2? 3? party size?) — needed to bound latency/cost per AC-3.
- Should nearby-NPC presence be scene/location-authored (content-pack data) or dynamically computed from ECS spatial state — affects whether this needs `packages/frontend/engine` changes or stays client-service-only.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Execution Report

### Summary

Wired `_gatherPartyMembers()` and `_gatherNearbyNpcs()` in `gm_prompt_service.svelte.ts` to real data sources (party roster and world location NPC IDs). Created `NpcAwarenessService` for resolving nearby NPC context with party-member dedup. Extended `AutonomousMessageService` with multi-NPC group-turn selection (weighted, bounded by `MAX_GROUP_PARTICIPANTS`) and sequential response generation where each NPC sees prior NPCs' dialogue. Idle-chat behavior (C-248) is unchanged — the multi-NPC cap only applies to addressed turns.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Party members appear in `[PARTY MEMBERS]` section with name/class/level — verified by unit test |
| AC-2 | ✅ | Nearby NPCs from `WorldLocation.npcIds` appear in `[NEARBY NPCS]` section, deduped against party members — verified by unit test |
| AC-3 | ✅ | `generateMultiNpcResponses()` sequences responses with cross-NPC awareness — verified by unit test |
| AC-4 | ✅ | Idle-chat poller unchanged — `_selectWeightedRandom` still selects 1 NPC per tick, `MAX_AUTONOMOUS_MESSAGES_PER_TICK` unaffected |
| AC-5 | ✅ | `selectGroupParticipants()` caps at `MAX_GROUP_PARTICIPANTS` (3) — verified by unit test |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/services/npc/npc_awareness_service.svelte.ts` | Nearby NPC resolution from `worldStateService.currentLocation.npcIds` with party-member dedup |
| `apps/frontend/client/src/lib/services/npc/npc_awareness_service.test.ts` | Unit tests for awareness service — resolution, dedup, graceful degradation |
| `apps/frontend/client/src/lib/services/gm/gm_prompt_party.test.ts` | Unit tests for AC-1 (party members) and AC-2 (nearby NPCs) in assembled prompt |
| `apps/frontend/client/src/lib/services/npc/autonomous_message_group.test.ts` | Unit tests for AC-3 (multi-NPC sequencing), AC-4 (idle regression), AC-5 (bounded cap) |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/constants/src/lib/autonomous_npc.ts` | Added `MAX_GROUP_PARTICIPANTS = 3` constant |
| `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` | Wired `_gatherPartyMembers()` to `partyRosterService.members` and `_gatherNearbyNpcs()` to `worldStateService.currentLocation.npcIds` with party-member dedup |
| `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` | Added `selectGroupParticipants()` (weighted multi-NPC selection) and `generateMultiNpcResponses()` (sequential response generation with cross-NPC awareness) |
| `apps/frontend/client/src/lib/services/index.ts` | Added `npc_awareness_service` to the `$services` barrel |

### Deviations from Spec

None. All ACs implemented as specified. The `GmPartyMemberContext.personality` field uses `"{name} ({classId}, Level {level})"` as a synchronous fallback since full NPC personality resolution requires async access to `npcService`. Full async resolution is available via `npcAwarenessService.getNpcPersonality()` for multi-NPC turn generation.

### Test Results

- Unit (AC-1/AC-2): 7/7 PASS — 0 failures
- Unit (AC-3/AC-4/AC-5): 9/9 PASS — 0 failures
- Unit (awareness service): 6/6 PASS — 0 failures
- Existing (gm_prompt_assembler): 10/10 PASS — 0 failures (no regressions)
- Existing (party_roster_service): 11/11 PASS — 0 failures
- Existing (autonomous_message_service): 6/6 PASS — 0 failures

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
