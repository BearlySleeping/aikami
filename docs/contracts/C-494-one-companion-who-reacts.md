---
id: C-494
title: "One companion who reacts"
source: direct
contract_type: full
status: approved
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-494: One companion who reacts

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-494, seeded from the 2026-09-06 external review (V-5); Phase 2 — "I disapprove: −5" is bookkeeping, a companion is a character |
| **Target** | `content/packs/emberwatch/manifest.json` (one NPC gains companion fields — `isCompanion`, `recruitDialogueKey`, `dismissDialogueKey`, `companionClassId`, `initialApproval`, `banterPool` — and the C-488 identity fields), `apps/frontend/client/src/lib/services/game/party_roster_service.svelte.ts` (recruitment path), `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (companion reaction seam), `apps/frontend/client/src/lib/services/game/narrative_event_service.svelte.ts` (C-491 event consumption) |
| **Type** | full |
| **Priority** | P1 — "I disapprove: −5" is bookkeeping; a companion is a character |
| **Dependencies** | [C-488](C-488-authored-npc-identity-in-the-content-pack.md) (authored identity), [C-491](C-491-committed-narrative-event-record.md) (the events the companion witnesses), [C-492](C-492-memory-retrieval-correctness-and-production-wiring.md) (witness-scoped recall feeding the companion's references). |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the party roster (`party_roster_service.svelte.ts#partyRosterService.recruit`), the Talk to Party overlay (`talk_to_party_view_model.svelte.ts`), and the dialogue consequence/event seams |

## Problem & Baseline Evidence

- **No Emberwatch NPC is recruitable.** All three pack NPCs (`village_elder`, `rollo_grasper`, `merchant`) carry C-488 identity fields (`personality`, `agenda`, `knowledge`, `secrets`, `boundaries`) but **none** sets `isCompanion: true` — the companion fields (`isCompanion`, `recruitDialogueKey`, `dismissDialogueKey`, `companionClassId`, `initialApproval`, `banterPool`) exist in `ContentPackNpcEntrySchema` (`content_pack.ts:186-198`, C-340) and are unused by the pack.
- **All the scaffolding exists and is untested end-to-end.** `party_roster_service.svelte.ts` has `recruit`, `dismiss`, `adjustApproval`, `getApproval`, `activatePersonalQuest`, and save/load serialization. C-491 records witnessed events (`PromiseMade`, `ThreatWitnessed`, …). C-488 assembles authored identity. C-492 (draft) wires witness-scoped recall into dialogue. No authored companion uses any of it.
- **Approval is the only reaction surface.** `adjustApproval({ npcId, delta })` is the entire "companion reacts" vocabulary. There is no path from a witnessed event to a companion utterance, no boundary-crossing behaviour, and no unprompted action.
- **Reproduction**: `python3 -c "import json; d=json.load(open('content/packs/emberwatch/manifest.json')); print([(k, v.get('isCompanion')) for k,v in d['npcs'].items()])"` → all `None`/`false`; `grep -rn "isCompanion" content/packs/emberwatch/manifest.json` → no hits.
- **Existing implementation to reuse**: `party_roster_service` (`recruit`/`adjustApproval`/`getApproval`/`serialize`/`hydrate`); C-491 `narrativeEventService.witnessedBy(npcId)` + the closed event kinds; C-488's `buildNpcPersona`; C-492's `retrieveForNpc` (witness-scoped recall) once landed; the Talk to Party overlay as the companion-dialogue surface.
- **Known gaps**: no recruitable companion in the pack; no reaction seam from event → companion behaviour; boundary crossing has no state consequence; no unprompted-turn trigger for a companion.
- **Baseline tests**: `party_roster_service.test.ts`, `narrative_event_service.test.ts`, `relationship_service.test.ts`, `npc_dialogue_service.test.ts`, `talk_to_party` tests if present. Record pass state before starting.

## User Outcome

After this contract, the player meets **one** companion early in the demo adventure, recruits them through the existing roster, and that companion behaves like a character: they recall a promise or threat they witnessed (in their own voice), object or walk away when the player crosses their line, and act once without being asked — with all of it surviving save/reload.

## Success Measures

- **Time/latency target**: reaction is a local, synchronous append/state-mutation at the existing consequence/event seams; no new network round-trip.
- **Offline/degraded behavior**: companion reactions and recall are fully offline; when the AI provider is unavailable, the companion's authored boundary/banter lines still surface through the existing authored-fallback path.
- **Production journey enabled**: `/game` → recruit the companion → make a promise or threat they witness (C-491 records it) → next conversation references it unprompted → cross their boundary → state changes → save → reload → companion, witnessed events, and approval survive.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Companion fields | `ContentPackNpcEntrySchema` companion fields (`content_pack.ts:141-158`) | reuse — populate for one NPC, do not extend the schema |
| Recruitment | `party_roster_service.recruit` / `dismiss` / `getMember` | reuse — the only recruitment path |
| Approval / relationship | `party_roster_service.adjustApproval` + C-341 relationship service | reuse — the reaction state store |
| Authored identity | C-488 `buildNpcPersona` + pack identity fields | reuse — the companion's voice |
| Witnessed events | C-491 `narrativeEventService.witnessedBy` | reuse — what the companion can reference |
| Witness-scoped recall | C-492 `memoryRetrievalService.retrieveForNpc` | reuse — inject the witnessed reference into the companion's turn |
| Companion dialogue surface | `talk_to_party_view_model.svelte.ts` | modify — companion turns route through the same production dialogue path |

## Overview

Make exactly one Emberwatch NPC a recruitable companion by populating the existing companion fields in the pack and wiring two behaviours the scaffolding cannot yet express: (1) after the companion witnesses a consequential event (`PromiseMade` / `ThreatWitnessed`), their next turn references it unprompted in their own voice, sourced through C-492's witness-scoped recall; and (2) crossing the companion's authored boundary produces a **state change** — refusal, objection, or leaving — not just a dialogue line. Add one scripted unprompted action, and prove the whole thing round-trips through save/reload. **One companion, not a roster** — no new party mechanics, no companion framework.

## Design Reference

- `party_roster_service.svelte.ts` — the existing recruitment/approval API; the companion is recruited through it, never around it.
- `narrative_event_service.witnessedBy(npcId)` — the authority for "did this companion see this event".
- C-492's `retrieveForNpc` — the seam that turns witnessed events into prompt facts; AC-3 consumes it rather than querying events directly.
- `npc_dialogue_service._buildContextProjection` / `_buildNarrativeSystemPrompt` — where a `[COMPANION WITNESSED]` (or the existing `[MEMORY]` section) carries the reference.
- `talk_to_party_view_model.svelte.ts` — the production dialogue surface for an already-recruited companion.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Exactly one companion.** Add `isCompanion: true` (plus recruit/dismiss/class/approval fields) to one NPC. Do not add a second companion, a recruitment UI, or a companion framework. If the implementation needs a trigger to gate the companion's availability, reuse the existing dialogue-choice/`recruitDialogueKey` path.
- **No new schema fields.** All five identity characteristics in AC-2 are expressed through C-488's existing fields, mapped as: desire → `agenda`; fear → `personality` (manner) or `boundaries`; revisable belief → `knowledge` phrased as a belief the NPC holds, not a world fact; relationship → an `agenda` entry that conflicts with another NPC's want; boundary → `boundaries`. The implementer must not invent `fear`/`belief`/`relationship` fields.
- **One reaction authority.** Boundary crossing is detected at the dialogue consequence/event seam and mutates real state (`adjustApproval` to a floor, or `dismiss` for "leaving") — it is never a prose-only outcome. The exact threshold and which boundary maps to which reaction are authored in the pack, not hardcoded.
- **Unprompted action has exactly one trigger.** AC-5's scripted moment is keyed to a C-491 event the companion witnesses (or a world flag set by one), and reuses C-493's production autonomous poller for the turn; do not build a second poller. If C-493 has not landed, hook the event-commit path directly and note the deviation.

## State & Data Models

No new persistent schema. The companion's state lives in the existing `PartyRosterEntry` (npcId, approval, personalQuestActive, equipmentSlotIds) plus the C-491 event record and the C-341 relationship state — all already registered for save/load. The contract's only data addition is **authored content** in the manifest: one NPC gains the companion fields, and the companion's `boundaries`/`agenda` entries gain a machine-readable reaction (see below) via an optional, strictly-authored annotation.

Reaction binding is expressed inside the existing `boundaries` strings with a fixed, documented convention rather than a new schema field, e.g.:

```jsonc
{
  "village_guard": {
    // ...
    "isCompanion": true,
    "companionClassId": "fighter",
    "initialApproval": 10,
    "boundaries": [
      "refuse|Threaten an innocent villager"
    ],
    "agenda": [
      "protect Emberwatch from the Crimson Covenant",
      "prove to Elder Thalia that force is not always the answer"  // conflicts with Thalia's "resolve the ward by any means"
    ]
  }
}
```

The `reaction|trigger` convention inside a boundary/agenda entry is the contract's extension point: `refuse` (companion objects, approval −N), `object` (companion objects, no approval change but refuses cooperation), or `leave` (companion leaves the party via `dismiss`). The implementer documents the convention in the pack authoring notes; the actual prose is maintainer-authored.

## Quality Requirements

- **Offline/degraded mode**: reactions are local state mutations; authored boundary/banter lines fall back through the existing authored-dialogue path when the AI is unavailable.
- **Accessibility/input**: N/A — no new UI beyond the existing Talk to Party overlay and roster.
- **Performance budget**: reaction is O(1) at the consequence seam; witnessed-event lookup is already O(events) via `witnessedBy`.
- **Security/privacy**: the companion references only events they **witnessed** (C-491 witness model), never secrets they merely exist alongside.
- **Persistence/migration**: companion membership (roster), approval, witnessed events, and relationship all already round-trip; a save written before C-494 loads with no companion recruited (nothing to migrate).
- **Cancellation/retry/idempotency**: recruitment is idempotent (`recruit` returns the existing entry); the reaction must not double-fire on retry — key it to the event `sourceEventId`/sequence like C-489.
- **Observability**: log each reaction with the trigger (boundary/event), the resulting state mutation, and the companion id.

## Migration & Rollback

- **Old data compatibility**: no schema change — saves before C-494 load unchanged; the companion simply is not recruited until the player meets them.
- **Migration**: none — populating the manifest's companion fields for one NPC is a content edit, not a data migration.
- **Rollback**: revert the manifest entry (remove `isCompanion`) and remove the reaction seam; existing saves with the companion recruited would carry a roster entry for an NPC that is no longer recruitable — state the handling (the roster keeps the member; the NPC simply stops producing companion reactions).
- **Feature flag or kill switch**: the pack's `isCompanion` flag is the switch — flipping it off disables recruitment without a redeploy.
- **Failure recovery**: if the reaction seam throws after the trigger, fail the turn rather than silently dropping the state mutation (same discipline as C-489/C-491).

## Scope Boundaries

- **In Scope:** exactly one Emberwatch companion recruited through the existing roster; the five authored identity characteristics expressed in C-488's fields; unprompted reference to a witnessed `PromiseMade`/`ThreatWitnessed` event via C-492 recall; boundary crossing as a real state change (refusal/objection/leaving); one scripted unprompted action; save/reload round-trip of companion state, witnessed events, and relationship.
- **Out of Scope:** a second companion or generalising to a companion framework; romance, companion quests, or companion progression; party orders (wait/guard/scavenge) — that is the C-340 amendment already tracked in `BACKLOG_C452_PLUS.md`; new schema fields or a reaction engine (the `reaction|trigger` convention is authored content, not a runtime system); new recruitment UI.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one companion, one set of behaviours, one persistence story. The witness-scoped recall (C-492) and the production poller (C-493) are already split out; this contract is the *consumer* of both. Splitting further would leave a companion that recruits but never reacts — the exact bookkeeping-shaped hole this contract exists to fill.

## Acceptance Criteria

### AC-1: The companion recruits through the existing roster
**Given** the demo adventure and a companion authored with `isCompanion: true`
**When** the player meets them early and accepts the recruit offer
**Then** they are recruited into the party through `partyRosterService.recruit` — no new party mechanics, no new recruitment UI, and the recruit path is the existing `recruitDialogueKey` dialogue-choice seam.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + integration | `party_roster_service.test.ts` + `npc_dialogue_service.test.ts` | `party_roster_service.svelte.ts#partyRosterService.recruit` — the production recruitment seam | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: drive the recruit dialogue choice for the authored companion and assert a `PartyRosterEntry` appears with the pack's `initialApproval`; assert re-recruit is idempotent; assert a non-companion NPC cannot be recruited.
- E2E / Visual:
    - **Functional**: N/A — covered by the release-journey extension in C-495 AC-6.
    - **Visual**: N/A.

**Watch Points**:
- Recruitment must flow through `recruitDialogueKey`, not a new overlay button — the dialogue-choice seam already exists and is the production path.

### AC-2: The companion's identity carries all five characteristics
**Given** the companion's authored identity in the pack
**When** it is defined
**Then** it includes a desire, a fear, a belief they might revise, a relationship with another Emberwatch NPC, and one boundary they will not casually cross — all expressed through the existing C-488 fields per the mapping in Architecture Directives — and a test asserts each of the five is present.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `content_pack.test.ts` (or a pack-validation test) | the Emberwatch manifest `npcs` entry (loaded by the production pack loader) | Filled during verification |

**Test Hooks**:
- Moon Task: the schemas/content-pack test task
- Integration: load the pack and assert the companion entry has non-empty `agenda` (desire + the conflicting relationship entry), `personality` (fear/manner), `knowledge` (the revisable belief), and `boundaries` (the boundary); assert the conflicting agenda entry names another Emberwatch NPC's want.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- Do not invent `fear`/`belief`/`relationship` schema fields — express all five inside C-488's existing fields. This is the line that stops a companion framework from creeping in.

### AC-3: The companion references a witnessed event unprompted
**Given** a `PromiseMade` or `ThreatWitnessed` event the companion witnessed (C-491)
**When** the player next speaks with them
**Then** they reference that specific event unprompted, in their own voice — not a numeric approval readout — and the Execution Report quotes an actual generated line, not just a passing test.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + integration | `npc_dialogue_service.test.ts` + `memory_retrieval_service.test.ts` | `npc_dialogue_service.svelte.ts#_buildContextProjection` → C-492 `retrieveForNpc` — the production dialogue context | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: record a witnessed `PromiseMade` for the companion, then build the companion's dialogue context and assert the injected memory/companion section contains the event summary and the companion's identity voice is the one framing it (persona present); assert a `ThreatWitnessed` the companion did **not** witness is absent.
- E2E / Visual:
    - **Functional**: N/A — C-495 AC-6 asserts the full journey end-to-end.
    - **Visual**: N/A.

**Watch Points**:
- The reference comes through C-492's witness-scoped recall, never by querying `narrativeEventService.events` directly — one witness authority.
- ⚠️ **C-492 reverted on `main`** (commit `3f2568db4` rolled back the C-492/C-506 memory-retrieval surface): `retrieveForNpc`, the `narrative_event` source type, and the `[MEMORY]` injection are **not currently present**. If they are not re-landed before this contract lands, the implementer must either re-land the minimal witness-scoped recall (filter `narrativeEventService.witnessedBy(npcId)` → inject a bounded `[COMPANION WITNESSED]` section) or — as a documented deviation mirroring the C-493 fallback — route through `narrativeEventService.witnessedBy` directly, and record the deviation as an Amendment. Do not silently depend on code that is absent.
- "Unprompted" means the player did not ask about it; the prompt injects it as background, and the companion's own voice surfaces it. A test that only checks the string is in the prompt is necessary but not sufficient — quote the generated line.

### AC-4: Crossing the boundary is a state change
**Given** the companion's authored boundary
**When** the player crosses it
**Then** the companion acts — refusal, objection, or leaving — and that reaction is a state change (approval drop to a floor, or `dismiss`), not only a dialogue line.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + integration | `npc_dialogue_service.test.ts` + `party_roster_service.test.ts` | `npc_dialogue_service.svelte.ts` consequence seam → `party_roster_service.adjustApproval`/`dismiss` | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: trigger the boundary-crossing consequence and assert `adjustApproval` was called (or the member was `dismiss`ed) with the authored reaction, and the companion's response text reflects the reaction; assert the state survives a save/reload round-trip.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- The reaction is detected at the consequence/event seam (where the boundary line is crossed in dialogue), not in a separate "did the player say a bad word" scanner.
- `leave` must use `dismiss`, not just set approval low — "leaving" is a roster state change.

### AC-5: One scripted moment makes the companion act unprompted
**Given** a scripted trigger (a C-491 event the companion witnesses, or a world flag set by one)
**When** the trigger fires
**Then** the companion acts **without being asked** — an autonomous turn, not a reply to the player.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + integration | `autonomous_message_service.test.ts` + `narrative_event_service.test.ts` | the production autonomous poller (C-493) or the event-commit reaction hook | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: fire the trigger and assert the companion produces an autonomous turn without player input; assert the trigger fires exactly once (idempotency keyed to the event).
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- Reuse C-493's production poller — do not build a second poller. If C-493 has not landed, hook the event-commit path and record the deviation.
- "Without being asked" is literal: the turn must originate from the trigger, not from a player message.

### AC-6: Companion state survives save/reload
**Given** a recruited companion with approval, witnessed events, and relationship state
**When** the campaign is saved and reloaded
**Then** companion state (roster membership, approval), witnessed events, and relationship survive intact.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `party_roster_service.test.ts` + `game_save_service.test.ts` + `narrative_event_service.test.ts` | `game_save_service.svelte.ts#gameSaveService` — the production save/load path | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: recruit the companion, adjust approval, record a witnessed event, save, reload, and assert the roster entry, approval, and witnessed event all round-trip.
- E2E / Visual:
    - **Functional**: N/A — C-495 AC-6 asserts the full journey.
    - **Visual**: N/A.

**Watch Points**:
- All three stores are already registered for serialization — the test proves the *combination* survives, not just each individually.

## Implementation Sequence

1. **Phase 1 (Content)**: populate one Emberwatch NPC's companion fields (`isCompanion`, `recruitDialogueKey`, `dismissDialogueKey`, `companionClassId`, `initialApproval`, `banterPool`) and the five identity characteristics (AC-1, AC-2).
2. **Phase 2 (Recruit + recall)**: verify recruitment flows through the existing `recruitDialogueKey` seam; wire the companion's next-turn reference to C-492 recall (AC-1, AC-3).
3. **Phase 3 (Reactions)**: implement the boundary-crossing state change and the single unprompted trigger (AC-4, AC-5).
4. **Phase 4 (Validation)**: save/reload round-trip, `validate()`, and quote a real generated companion line in the Execution Report (AC-6).

## Edge Cases & Gotchas

- **Secret leakage**: the companion references only events they witnessed — a `dialogue_claim`/`character_belief` event they witnessed is *heard*, not *known*, and must be framed as hearsay in their voice (C-491/C-492 discipline).
- **Reaction double-fire**: key reactions to the triggering event's identity; a retry must not drop approval twice or dismiss twice.
- **Non-companion NPCs**: the reaction seam must not fire for NPCs without `isCompanion` — gate on the roster membership / pack flag.
- **Recruit offer timing**: the companion must be meetable early, but recruitment must still route through the authored `recruitDialogueKey` — do not auto-recruit on meeting.
- **Old saves**: no migration; a save from before C-494 has no recruited companion and loads cleanly.

## Open Questions

- **Resolved during drafting:** the companion is a single authored NPC (not a framework); which NPC is the maintainer's content call, and the contract specifies structure/behaviour, not the prose.
- **Resolved during drafting:** the five identity characteristics map onto C-488's existing fields (no new schema); see Architecture Directives.
- **Resolved during drafting:** AC-5's unprompted turn reuses C-493's production poller; if C-493 is not yet landed, the implementer hooks the event-commit path and records the deviation as an Amendment.
- **Resolved during drafting:** C-492's `retrieveForNpc` was reverted on `main` (commit `3f2568db4`). AC-3 prefers the witness-scoped recall once re-landed; otherwise the implementer re-lands the minimal recall or routes through `narrativeEventService.witnessedBy` directly and records the deviation as an Amendment (see AC-3 Watch Points).

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
