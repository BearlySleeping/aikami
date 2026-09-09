---
id: C-495
title: "Emberwatch dramatic structure"
source: direct
contract_type: full
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-495: Emberwatch dramatic structure

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-495, seeded from the 2026-09-06 external review (V-5); the milestone contract — "the dramatic possibility space is small" |
| **Target** | `content/packs/emberwatch/manifest.json` (next version after 4.0.0), `packages/shared/schemas/src/lib/game/content_pack.ts` (dilemma/evidence/starting-conditions structure), the quest graph (`objectives` prerequisites + `prerequisiteQuestIds`, C-339), `apps/e2e/tests/client/release_gate.spec.ts` (extend C-486's journey) |
| **Type** | full |
| **Priority** | P1 — three maps, three NPCs, one fetch quest, one ending; AI can paraphrase a fetch quest indefinitely without making it dynamic |
| **Dependencies** | [C-488](C-488-authored-npc-identity-in-the-content-pack.md) (authored identity), [C-491](C-491-committed-narrative-event-record.md) (`EvidencePresented` events), [C-494](C-494-one-companion-who-reacts.md) (the companion who acknowledges the milestone). |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — campaign creation (truth sampling) and the release journey (`release_gate.spec.ts` via the game/dialogue POMs) |

## Problem & Baseline Evidence

- **The dramatic possibility space is one fetch quest.** The Emberwatch pack (now `version: "4.0.0"`, bumped by C-488) ships 3 maps, 3 NPCs (`village_elder`, `rollo_grasper`, `merchant`), 1 quest (`fading_ward`), 1 encounter, 7 items, 18 dialogues, 3 factions — and **one** quest ending (`ward_renewed`). The quest is a linear 4-objective fetch: ask Thalia → find the keeper → obtain the wand → return it. AI can paraphrase that indefinitely without making it dynamic.
- **The schema supports more than the content uses.** `ContentPackQuestEndingSchema` (`content_pack.ts:371-386`) already has `worldStateFlag` + `reactionDialogueKey` per ending, and `ContentPackQuestEntrySchema` already has `prerequisiteQuestIds` (C-339) and objective prerequisites — yet the pack declares exactly one ending and no conflicting accounts, no discoverable evidence, and no starting-condition variance.
- **There is no evidence concept.** No `evidence` key exists in the manifest, and nothing produces an `EvidencePresented` event — C-491 made the event *recordable* but no content ever triggers it.
- **There is no hidden-truth/variance mechanism.** Campaign creation is deterministic: every new campaign starts with the same ward, the same Rollo, the same evidence. AC-5's replayability — "a small bounded set of starting conditions varies" — has no home in the data model, and nothing prevents each NPC generation from independently inventing a contradictory truth.
- **Reproduction**: `python3 -c "import json; d=json.load(open('content/packs/emberwatch/manifest.json')); print(len(d['maps']), len(d['npcs']), len(d['quests']), len(d['encounters']), len(d['items']), len(d['dialogues']), len(d['factions']), len(d['quests']['fading_ward']['endings']))"` → `3 3 1 1 7 18 3 1`; `grep -rn "evidence\|dilemma\|startingConditions\|hiddenTruth" content/packs/emberwatch/manifest.json` → no hits.
- **Existing implementation to reuse**: the `endings` schema (`worldStateFlag` + `reactionDialogueKey`) and quest-completion path (`quest_state_service._completeQuest` derives journal entries from `QuestResolved` events per C-491); the `worldStateFlag` → world-state mechanism (C-316); C-339's objective prerequisites / `prerequisiteQuestIds`; C-491's `EvidencePresented` kind; C-494's companion (draft) for the acknowledgement leg; C-486's now-unconditional `release_gate.spec.ts` journey.
- **Known gaps**: one ending; no conflicting accounts; no evidence; no hidden-truth sampling; no per-ending village change; no variance at campaign creation; the release journey stops short of the full milestone.
- **Baseline tests**: `content_pack.test.ts` (ending schema coverage), `quest_state_service.test.ts`, `release_gate.spec.ts`. Record pass state before starting.

## User Outcome

After this contract, starting a new Emberwatch campaign draws one hidden truth from a small bounded set, every clue and NPC behaviour derives from that single truth, the player can investigate conflicting accounts and present discovered evidence, and the quest can resolve into at least three endings that differ in world state — with the village visibly changed afterward and a companion acknowledging the whole arc. The release journey asserts that full milestone end-to-end.

## Success Measures

- **Time/latency target**: truth sampling is a synchronous, persisted choice at campaign creation; no per-NPC generation-time truth rolls.
- **Offline/degraded behavior**: all structure (evidence discovery, ending flags, village change) is content + local state — no network dependency; authored dialogue carries the conflicts when the AI is unavailable.
- **Production journey enabled**: `/game` → create campaign (truth sampled) → learn → promise or threaten → resolve with the real sheet → validated state change → immediate reaction → leave → save → reload → changed interaction → companion acknowledgement.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Quest endings | `ContentPackQuestEndingSchema` (`worldStateFlag`, `reactionDialogueKey`) | reuse — author ≥3, each with distinct world state |
| Quest graph | objective `prerequisiteIndices` + `prerequisiteQuestIds` (C-339) | reuse — the structure the dilemma hangs on |
| Evidence events | C-491 `EvidencePresented` kind + `narrativeEventService.record` | reuse — the recording seam for presenting evidence |
| World-state change | `worldStateFlag` → world-state flags (C-316) | reuse — the per-ending village change |
| Companion acknowledgement | C-494 companion + C-492 recall | reuse — the milestone's final leg |
| Release journey | `release_gate.spec.ts` (C-486 unconditional journey) | extend — add the learn→promise→resolve→reload→acknowledge legs |

## Overview

Expand Emberwatch from a single fetch quest into a small dramatic structure — **without adding geography or writing the prose here**. The contract specifies and validates the *structure*: conflicting accounts with a marked truth, discoverable and presentable evidence (producing `EvidencePresented` events), at least three endings that differ in world state, a village that visibly changes per ending, and a hidden truth sampled once at campaign creation from a bounded set of starting conditions. The maintainer authors the actual dilemma, dialogue, and character writing; placeholder content is acceptable as long as the structural acceptance criteria hold and the placeholders are clearly marked.

## Design Reference

- `ContentPackQuestEntrySchema` / `ContentPackQuestEndingSchema` — the existing quest/ending shape to extend with the dilemma/evidence/starting-conditions structures (all optional, so v4.0.0 packs still load).
- `quest_state_service._completeQuest` — where an ending's `worldStateFlag` and `reactionDialogueKey` already apply; the ≥3 endings ride this path.
- `narrativeEventService.record({ kind: 'EvidencePresented', … })` — the single seam for evidence presentation.
- `release_gate.spec.ts` AC-1/AC-6 — the journey legs C-486 already tightened; AC-6 of this contract extends them.
- Campaign creation (`campaignService.ensureDefaultCampaign` / the new-game path) — where the hidden truth is sampled once and persisted.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **🔴 Structure, schema, and validation only.** The actual dilemma, dialogue, and character writing are authored by the maintainer — **not** the drafting agent and **not** the implementer. The reviewer's illustrative ward dilemma (Rollo's counterclaim that the ward diverts danger outward, a ledger as evidence, Thalia as sympathetic antagonist) is **illustrative, not approved** — do not hardcode it. Placeholder content is acceptable in the implementation as long as the structural ACs are met and placeholders are clearly marked for replacement.
- **One hidden truth, sampled once.** The truth is drawn from a bounded set at campaign creation and persisted with the campaign; every account, clue, evidence, and NPC behaviour derives from that one sampled truth. NPC generations must **not** independently invent contradictory answers — forbid per-NPC truth rolls explicitly in Watch Points and tests.
- **Three endings differ in world state, not prose.** Each ending sets a distinct `worldStateFlag` (plus distinct relationship/item-ownership deltas where applicable); the village change in AC-4 is driven by those flags, not by a one-off text swap.
- **Evidence is discoverable and presentable.** An evidence item must be discoverable in the world (a location/prop or an NPC interaction) and presentable to a named NPC, producing exactly one C-491 `EvidencePresented` event through `narrativeEventService.record`.
- **No new maps or regions.** Keep the three maps; the dilemma lives inside the existing geography.

## State & Data Models

New optional manifest structures (TypeBox in `packages/shared/schemas/src/lib/game/content_pack.ts`, derived types mirrored in `packages/shared/types/`). All are **optional** so a v4.0.0 pack still loads (AC-7).

```ts
// The hidden-truth space and starting-condition variance, sampled once at campaign creation.
export const ContentPackTruthVariantSchema = Type.Object({
  id: Type.String({ minLength: 1 }),              // e.g. "rollo_owns_the_ledger"
  label: Type.String({ minLength: 1 }),           // short human label
  startingConditions: Type.Array(
    Type.Object({
      key: Type.String({ minLength: 1 }),         // "whoOwesWhom" | "missingEvidence" | "rolloWants" | "wardProximity"
      value: Type.String({ minLength: 1 }),
    }),
  ),
});

export const ContentPackEvidenceSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  discoverableAt: Type.String({ minLength: 1 }),  // map id / prop id / NPC interaction key
  presentToNpcId: Type.String({ minLength: 1 }),  // which NPC the player presents it to
  supportsTruthId: Type.String({ minLength: 1 }), // which truth variant this evidence proves
});

export const ContentPackAccountSchema = Type.Object({
  npcId: Type.String({ minLength: 1 }),
  claim: Type.String({ minLength: 1 }),           // the account's assertion (prose placeholder allowed)
  supportsTruthId: Type.String({ minLength: 1 }), // which truth variant this account is consistent with
});
```

The manifest gains three optional top-level keys, all absent on v4.0.0:

```ts
type ContentPackDramaticStructure = {
  truthVariants?: ContentPackTruthVariantSchema[];  // bounded set (2-4); one sampled per campaign
  accounts?: Record<string, ContentPackAccountSchema[]>; // keyed by situation id; ≥2 conflicting per dilemma
  evidence?: ContentPackEvidenceSchema[];            // ≥1 physical evidence per dilemma
};
```

Campaign creation samples one `truthVariant.id` and persists it (e.g. as a campaign field or a dedicated serializable service field — implementer chooses the home, but it must be **sampled once and persisted**, never re-rolled on reload and never re-rolled per NPC). All account/evidence/clue resolution reads that single sampled truth; an NPC account or evidence item is "consistent with" the sampled truth when its `supportsTruthId` matches.

Endings remain the existing `ContentPackQuestEndingSchema` shape; AC-3 just requires ≥3 entries, each with a distinct `worldStateFlag` and a `reactionDialogueKey`.

## Quality Requirements

- **Offline/degraded mode**: truth sampling, evidence discovery, and ending flags are local state; authored dialogue carries the conflicts offline.
- **Accessibility/input**: N/A — no new UI; evidence presentation reuses the existing dialogue/choice path.
- **Performance budget**: truth sampling is O(1); evidence lookup is O(evidence); no new per-frame work.
- **Security/privacy**: the hidden truth is player-local campaign state (not a server secret); it must not leak to the player through any UI that enumerates `truthVariants`.
- **Persistence/migration**: the sampled truth persists with the campaign; a v4.0.0 pack loads unchanged (new keys optional); a campaign created before C-495 has no sampled truth and degrades to the default variant.
- **Cancellation/retry/idempotency**: truth sampling is once-per-campaign (idempotent); evidence presentation records exactly one `EvidencePresented` event per presentation.
- **Observability**: log the sampled truth id at campaign creation (debug), and each evidence presentation (kind + event id).

## Migration & Rollback

- **Old data compatibility**: the new manifest keys are optional — a v4.0.0 pack (and a pack authored against v4.0.0) still loads with no dilemma/evidence/truth structures. A campaign saved before C-495 has no sampled truth and uses the default truth variant on next load.
- **Migration**: none required; if a v4.0.0 campaign later gains a sampled truth, it defaults to the pack's first truth variant — document this in the pack authoring notes.
- **Rollback**: remove the new manifest keys and the sampling call; the quest falls back to its single-ending behaviour. The `release_gate` extension would need reverting to C-486's scope.
- **Feature flag or kill switch**: the presence of `truthVariants` is the switch — a pack without it behaves exactly as today.
- **Failure recovery**: if sampling fails, fall back to the default variant rather than blocking campaign creation.

## Scope Boundaries

- **In Scope:** the dilemma/evidence/starting-conditions schema structures (all optional, validated); ≥2 materially conflicting NPC accounts with a marked truth; ≥1 discoverable + presentable evidence producing `EvidencePresented`; ≥3 endings differing in world state; a per-ending village change driven by world-state flags; bounded starting-condition variance with a single sampled truth persisted at creation; the release-journey extension to the full milestone.
- **Out of Scope:** new maps, new regions, procedural world generation; new combat mechanics or classes; voice or image generation for the new content; writing the final prose (maintainer authors it — the reviewer's ward-dilemma sketch is illustrative, not approved); changing C-491's event schema; adding a quest-graph *engine* beyond the existing `prerequisiteQuestIds`/objective prerequisites.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the schema, the truth-sampling, the endings, the village change, and the release-journey extension share one invariant — "one hidden truth, sampled once, drives every clue, account, evidence, and ending." Splitting them would let a drafting pass build the endings without the sampling (per-NPC truth, the exact failure the Notes forbid) or build the schema without the journey that proves the player can reach it. The milestone is the point; keep it whole.

## Acceptance Criteria

### AC-1: Conflicting accounts with a marked truth
**Given** the dilemma structure in the pack
**When** the player investigates
**Then** at least two NPCs give **materially conflicting accounts** of the same situation, and the schema supports marking which account is true (via `supportsTruthId` against the sampled truth) — a test asserts the pack has ≥2 conflicting accounts for the dilemma and that exactly the account(s) consistent with the sampled truth resolve as true.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `content_pack.test.ts` + a pack-validation test | the Emberwatch manifest `accounts` (loaded by the production pack loader) | Filled during verification |

**Test Hooks**:
- Moon Task: the schemas/content-pack test task
- Integration: load the pack, sample each truth variant, and assert every account's truth status derives from the single sampled variant — never from per-NPC state.
- E2E / Visual:
    - **Functional**: N/A — AC-6 exercises the investigation journey.
    - **Visual**: N/A.

**Watch Points**:
- "Materially conflicting" means the accounts cannot both be true under one sampled truth. A test must assert the conflict, not just the presence of two strings.
- Do not hardcode the reviewer's ward-dilemma sketch — the maintainer authors the actual accounts; this contract validates structure.

### AC-2: Discoverable, presentable evidence
**Given** the world
**When** the player explores
**Then** at least one piece of physical **evidence** exists that can be discovered and presented to an NPC, producing exactly one `EvidencePresented` event (C-491).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + integration | `content_pack.test.ts` + `narrative_event_service.test.ts` | `narrative_event_service.svelte.ts#narrativeEventService.record` — the production event seam | Filled during verification |

**Test Hooks**:
- Moon Task: the schemas + client unit-test tasks
- Integration: discover the evidence, present it to the named NPC, and assert exactly one `EvidencePresented` event is recorded with the evidence id; assert presenting twice does not record twice (idempotency).
- E2E / Visual:
    - **Functional**: N/A — AC-6 exercises the presentation journey.
    - **Visual**: N/A.

**Watch Points**:
- Evidence is a world-discoverable thing (location/prop/interaction), not a dialogue-only mention — the `discoverableAt` field must resolve to a real map id or prop.
- The event must flow through `narrativeEventService.record`, never be written directly to the journal.

### AC-3: At least three endings that differ in world state
**Given** the quest
**When** it resolves
**Then** at least **three endings** are reachable that differ in **world state** — different `worldStateFlag`s, different relationships, different item ownership — not only in prose.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `content_pack.test.ts` + `quest_state_service.test.ts` | `quest_state_service.svelte.ts#questStateService._completeQuest` — the production ending-application path | Filled during verification |

**Test Hooks**:
- Moon Task: the schemas + client unit-test tasks
- Integration: for each ending, assert a distinct `worldStateFlag` is set and at least one non-prose difference (relationship delta or item-ownership change) is observable; assert the three flags are mutually exclusive.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- Three endings in the `endings` record is necessary but not sufficient — the *world-state difference* is what makes them endings rather than three paragraphs. Test the flags, not just the count.

### AC-4: The village visibly changes per ending
**Given** any ending
**When** the player returns to the village afterward
**Then** the village is **visibly changed** in a way that reflects which ending occurred, and NPCs reference it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + E2E | `content_pack.test.ts` + a village-state assertion in the release journey | the world-state flag mechanism (C-316) applied at `_completeQuest`, plus NPC reaction dialogue keys | Filled during verification |

**Test Hooks**:
- Moon Task: the schemas + client unit-test tasks, and the release-gate E2E task
- Integration: after each ending, assert the village world-state reflects the ending's flag (a prop/interactable/NPC reaction key changes); assert an NPC's post-ending dialogue references the ending.
- E2E / Visual:
    - **Functional**: the release journey (AC-6) returns to the village and asserts the change.
    - **Visual**: N/A (no visual suite yet — note as future work).

**Watch Points**:
- "Visibly changed" must be a world-state-driven difference (flag → prop/interactable/NPC reaction), not a text-only line. The flag is the source of truth; the visible change projects from it.

### AC-5: One hidden truth, sampled once at creation
**Given** campaign creation
**When** a new campaign starts
**Then** a small bounded set of starting conditions varies (who owes whom, which evidence is missing, what Rollo wants, how close the ward is to failure); the hidden truth is sampled **once** at creation and persisted; and all clues and NPC behaviour derive from that same truth — NPC generations must not independently invent contradictory answers.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + integration | `campaign_service.test.ts` (or the campaign-creation path) + a truth-consistency test | campaign creation (`campaignService` / the new-game path) — the production sampling seam | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: create two campaigns and assert the sampled truth may differ but is stable within each (reload does not re-sample); assert every account/evidence/clue resolution for a campaign reads that campaign's single sampled truth.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- **Forbid per-NPC truth rolls explicitly.** This is the contract's easiest-to-get-wrong AC: randomness creates the *situation* (sampled once), the player's decisions create what is *unique*. A drafting pass will be tempted to let each NPC roll their own truth — test against it by asserting all NPC accounts resolve against one sampled value.
- The sampled truth must be persisted with the save; a reload that re-samples is a bug.

### AC-6: The release journey asserts the full milestone
**Given** C-486's unconditional release journey
**When** extended
**Then** it asserts the full milestone: learn → promise or threaten → resolve with the real sheet → validated state change → immediate reaction → leave → save → reload → changed interaction → companion acknowledgement.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` (extended) | `/game` — the production release journey via the game/dialogue POMs | Filled during verification |

**Test Hooks**:
- Moon Task: the e2e client test task (grep-scoped to `release_gate`)
- Integration: N/A — this AC is the E2E journey.
- E2E / Visual:
    - **Functional**: extend `release_gate.spec.ts` so one test walks learn → promise/threaten → skill check with the real sheet → state change → reaction → leave → save → reload → changed interaction → companion acknowledgement, each leg asserting on real production state (not mocks).
    - **Visual**: N/A.

**Watch Points**:
- This is the last AC verified, and it must be verified by **watching the journey run**, not by reading a green check — the seed's explicit instruction. If a leg fails, the failure is a real product bug to file as a separate thin contract, not a reason to re-soften an assertion into a conditional.

### AC-7: v4.0.0 packs still load
**Given** a pack authored against v4.0.0 (the current version)
**When** loaded after this contract
**Then** it still loads, or a documented migration runs — the new dilemma/evidence/truth structures are optional and absent packs behave exactly as today.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit | `content_pack.test.ts` + the pack loader test | the production pack loader (`loadContentPack`) | Filled during verification |

**Test Hooks**:
- Moon Task: the schemas/content-pack test task
- Integration: load a v4.0.0-shaped manifest (no new keys) and assert it loads and boots without the new structures; assert the version bump is documented in the pack's migration notes.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- All new schema fields are `Type.Optional` / absent-tolerant; a required field here would break every existing install. Test the *absence* path, not just the presence path.

## Implementation Sequence

1. **Phase 1 (Schema)**: add the optional `truthVariants`/`accounts`/`evidence` structures to `content_pack.ts` and mirror types; add pack-validation coverage for absence (v4.0.0) and presence (new) (AC-7, AC-1 groundwork).
2. **Phase 2 (Truth sampling)**: persist one sampled truth at campaign creation; route account/evidence/clue resolution through it (AC-5).
3. **Phase 3 (Endings + evidence + village)**: author placeholder evidence and ≥3 endings (marked for replacement), wire `EvidencePresented` recording, and project per-ending village change from `worldStateFlag` (AC-1, AC-2, AC-3, AC-4).
4. **Phase 4 (Release journey)**: extend `release_gate.spec.ts` to the full milestone and watch it run (AC-6).

## Edge Cases & Gotchas

- **Per-NPC truth drift**: the forbidden failure mode — every account/evidence/NPC must resolve against the one sampled truth; test asserts it.
- **Reload re-sampling**: the sampled truth must be persisted with the campaign; a reload that rolls a new truth silently corrupts the investigation.
- **Evidence double-presentation**: presenting the same evidence twice must not record two `EvidencePresented` events.
- **v4.0.0 absence path**: a pack without the new keys must load and boot — do not make any new field required.
- **Placeholder prose**: acceptable only if clearly marked for replacement and structurally valid; the maintainer authors the final content.

## Open Questions

- **Resolved during drafting (content authority):** this contract specifies structure, schema, and validation only — the maintainer authors the dilemma, dialogue, and character writing. The reviewer's ward-dilemma sketch is illustrative, not approved.
- **Resolved during drafting (version):** the pack is currently 4.0.0 (C-488's bump); C-495's structural additions land as the next version, and AC-7's back-compat target is v4.0.0.
- **Resolved during drafting (truth home):** the sampled truth is persisted with the campaign (implementer chooses the exact field/service); the invariant — sampled once, persisted, never re-rolled per NPC — is the contract, not the storage location.

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
