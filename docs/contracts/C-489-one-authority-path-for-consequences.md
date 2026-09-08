---
id: C-489
title: "One authority path for consequences"
source: direct
contract_type: full
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-07T00:00:00Z"
---

# Contract C-489: One authority path for consequences

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-489, seeded from the 2026-09-06 external review; verified findings V-8 and V-9 |
| **Target** | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts:1881-1965` (`_validateAndApplyDeltas`), `packages/shared/utils/src/lib/rules/rules_kernel.ts:293` (`resolveCommand`), relationship/faction state services (C-341, `relationship_service.svelte.ts`) |
| **Type** | full |
| **Priority** | P0 — the game currently makes promises it silently fails to keep |
| **Dependencies** | [C-487](C-487-free-text-skill-checks-honour-the-character-sheet.md) — this contract owns what happens to the roll's result; C-487 owns what feeds the roll. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the production dialogue resolution path that applies (or rejects) `NpcStateDelta`s |

## Problem & Baseline Evidence

- **V-9 — silently dropped deltas**: `_validateAndApplyDeltas` (`npc_dialogue_service.svelte.ts:1881-1965`) pushes `trust_change` (`:1889-1895`) and `relationship_update` (`:1954-1959`) into the `valid` array after a bounds/label check and **never mutates anything**, while `flag_set`/`flag_clear` call `questStateService` and `inventory_grant`/`inventory_remove` call `inventoryService`. The method's name says it applies; for two of six kinds it does not. The player sees the NPC's narration accepting the consequence and nothing changes in the world.
- **V-8 — the rules kernel is unreachable**: `resolveCommand` (`rules_kernel.ts:293`) has no caller outside its own file. Even `relationshipService.applyDelta` (`relationship_service.svelte.ts:240-285`) re-implements trust/affinity clamping inline rather than calling the kernel, so the kernel's `applyRelationshipDelta` resolver is also unreachable. "AI proposes, rules decide" currently has multiple authorities, and the pure one is not among them.
- **Ordering**: the roll-resolution path narrates first and validates after — `_resolveRoll` streams the narrative, then calls `_validateAndApplyDeltas` on `output.stateDeltas` (`npc_dialogue_service.svelte.ts:1855-1863`). If the NPC says "Here, take the wand" and the mutation is rejected, the player experiences the game breaking its own promise.
- **Bounds checking is not authority**: `_validateAndApplyDeltas` only checks numeric bounds and label non-emptiness. It does not answer: is this NPC entitled to give this item? has this reward already been granted? does this action deserve advantage? did the referenced event actually occur?
- **Reproduction**: read `_validateAndApplyDeltas` and `resolveCommand`; then `grep -rn "resolveCommand" --include="*.ts"` outside `rules_kernel.ts` and its tests → no production callers.
- **Existing implementation to reuse**: `NpcStateDeltaSchema` (`packages/shared/schemas/src/lib/game/npc_dialogue_command.ts:213-234`) defines the six delta kinds; `relationship_service.svelte.ts` (`getRelationship`, `applyDelta`, `adjustFactionStanding`) and `questStateService`/`inventoryService` are the real stores to mutate; `rules_kernel.ts` already has the pure `applyRelationshipDelta` resolver.
- **Known gaps**: no single authority; `trust_change`/`relationship_update` are write-only "validations"; no entitlement/idempotency/provenance checks; no rejection surface the player can perceive coherently.
- **Baseline tests**: `npc_dialogue_service.test.ts`, `relationship_service.test.ts`, `packages/shared/utils/src/lib/rules/__tests__/rules_kernel.test.ts`. Record their state before starting.

## User Outcome

After this contract, when an NPC promises or grants something in dialogue, either the world state actually changes before the narration commits — or the player sees a coherent outcome that never claimed a change that did not happen. Consequence is no longer a suggestion that the game sometimes ignores.

## Success Measures

- **Time/latency target**: consequence application is local and synchronous; no new network round-trip.
- **Offline/degraded behavior**: consequences apply and persist identically offline — they are local state mutations.
- **Production journey enabled**: `/game` → resolve a consequential dialogue action → state commits before narration → save → reload → the change survives.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Delta kinds + schema validation | `NpcStateDeltaSchema` (`npc_dialogue_command.ts:213`) | reuse — validate, then apply |
| Trust/affinity mutation | `relationship_service.svelte.ts` `applyDelta` / `adjustFactionStanding` | modify — make it the single authority (or route through the kernel) |
| Quest flags, inventory | `questStateService`, `inventoryService` | reuse — existing call-throughs stay |
| Pure mechanical resolution | `rules_kernel.ts` `resolveCommand` | modify — invoke it from the production relationship-delta authority (AC-6) |
| Delta application seam | `_validateAndApplyDeltas` | modify — become an apply-and-report authority, not a filter |

## Overview

Three defects in one seam — silently dropped relationship deltas, an unreachable pure rules kernel, and narration that commits before state — are replaced with a single authority path. Every consequential delta is validated against entitlement, idempotency and provenance, applied to real stores, and committed before its narration is shown. Rejections produce a coherent outcome and a logged reason, never a narrated success whose effect did not happen.

## Design Reference

- `relationship_service.svelte.ts` — the store that already owns trust/affinity and persists via serialize/deserialize (C-334); `applyDelta` is the persistence boundary for character relationships and `adjustFactionStanding` is the faction boundary.
- `rules_kernel.ts` `RESOLVERS` — the pure dispatch the backlog names as the intended mechanical authority. This contract chooses the caller outcome: accepted character relationship deltas invoke `resolveCommand` before `relationshipService.applyDelta` persists the resolved values. AC-6 proves that invocation through the production authority rather than by text search.
- `_validateAndApplyDeltas` — the existing seam to convert from "filter then sometimes apply" to "authorize → apply → report".

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

There is exactly one authority for a consequential delta. That authority answers three questions, in order, before mutating anything:
- **Entitlement** — is the acting NPC allowed to grant/change this (derived from pack NPC data and world state)?
- **Idempotency** — has this exact reward/consequence already been granted (no double-granting)?
- **Provenance** — did the referenced event actually occur (e.g. the item exists to be removed; the quest flag was actually set)?

The caller supplies an immutable `operationId` for the dialogue turn or roll resolution and a `sourceEventId` for the local event being resolved. Both IDs are created before the model call and reused on retries. The authority validates `sourceEventId` against the loaded campaign event/state record before applying any delta. It records successful applications in a local idempotency ledger under a canonical key composed of `operationId` plus the delta's normalized `kind`, `target`, `label`, `value`, and duplicate occurrence number after canonical sorting. Retrying the same operation therefore returns `already-granted` without reapplying; a legitimate later grant has a new authoritative `operationId`/`sourceEventId` and may apply the same delta again. The ledger is authority state, not a field added to `NpcStateDelta`.

Consequential delta kinds are: `flag_set`, `flag_clear`, `inventory_grant`, `inventory_remove`, `trust_change`, `relationship_update` — all six, because each mutates persistent campaign state. Conversation that proposes **no** deltas (or only rejected ones) streams freely. State commits before the narration that describes it is shown to the player.

A rejected delta is logged with the reason, and the player sees a coherent outcome — the narration must not claim a success whose effect did not happen. Where the model has already streamed a claim that cannot be honoured, the reconciliation text must be shown, not silently dropped.

## State & Data Models

No delta-schema change. The deltas remain `NpcStateDelta` (`kind | target | value? | label?`). Stable operation and provenance identity wrap the batch outside that schema:

```ts
type ConsequenceRequest = {
  operationId: string;
  sourceEventId: string;
  npcId: string;
  deltas: NpcStateDelta[];
};

type ConsequenceResult = {
  operationId: string;
  applied: NpcStateDelta[];
  rejected: Array<{ delta: NpcStateDelta; reason: 'not-entitled' | 'already-granted' | 'no-provenance' | 'invalid' }>;
};
```

`_validateAndApplyDeltas` (or its replacement) accepts `ConsequenceRequest` and returns `ConsequenceResult` so the caller can reconcile narration with reality and retries can reuse the same identity.

The existing delta fields have one normative mapping:

| Delta | `target` | `value` | `label` | Destination |
|---|---|---|---|---|
| `trust_change` | character/NPC ID | trust delta | omitted | `relationshipService.applyDelta({ characterId: target, trustDelta: value, affinityDelta: 0, eventDescription })` |
| `relationship_update` | character/NPC ID | relationship delta | `trust` | `relationshipService.applyDelta({ characterId: target, trustDelta: value, affinityDelta: 0, eventDescription })` |
| `relationship_update` | character/NPC ID | relationship delta | `affinity` | `relationshipService.applyDelta({ characterId: target, trustDelta: 0, affinityDelta: value, eventDescription })` |
| `relationship_update` | faction ID | standing delta | `faction` | `relationshipService.adjustFactionStanding({ factionId: target, delta: value, reason: eventDescription })` |

For all rows, `eventDescription` is the deterministic `Dialogue consequence <operationId> from <sourceEventId>`. Any other `relationship_update.label`, any label on `trust_change`, or a missing/non-finite `value` is `invalid`; `value` never updates both trust and affinity.

## Quality Requirements

- **Offline/degraded mode**: consequences apply locally and persist; no network dependency.
- **Accessibility/input**: N/A — no new UI; reconciliation text is part of the existing dialogue overlay.
- **Performance budget**: authority checks are synchronous lookups on already-loaded stores; O(1) per delta.
- **Security/privacy**: the authority must never accept an NPC granting an item the pack does not entitle it to grant (no arbitrary item injection).
- **Persistence/migration**: relationship changes must survive save/reload via the existing `serialize`/`deserialize` path; no new save-format change.
- **Cancellation/retry/idempotency**: retrying the same `operationId` must not double-apply a successful delta; a rejected delta is safe to retry under the same operation after the world changes because only successful ledger keys are recorded. A later legitimate repeat uses a distinct authoritative operation/event identity.
- **Observability**: every rejection logs `kind`, `target`, and the reason.

## Migration & Rollback

- **Old data compatibility**: no save-format change; existing saves load unchanged.
- **Migration**: N/A.
- **Rollback**: revert to the pre-contract `_validateAndApplyDeltas` and remove the production `resolveCommand` caller introduced by AC-6.
- **Feature flag or kill switch**: N/A.
- **Failure recovery**: normalize and sort a batch by `kind` in this fixed order—`flag_clear`, `flag_set`, `inventory_remove`, `inventory_grant`, `relationship_update`, `trust_change`—then by `target` (code-point order), `label` (missing sorts first, then code-point order), and numeric `value` (missing sorts first, then ascending). Exact duplicates are equivalent; assign their occurrence number after this sort. Apply best-effort per delta in that order with individual logging. Rejecting one delta never stops or rolls back the others.

## Scope Boundaries

- **In Scope:** making `trust_change` and `relationship_update` mutate real relationship/faction state and survive reload; a single authority with entitlement/idempotency/provenance checks and external operation identity; committing state before narration for consequential deltas; coherent rejection handling with logged reasons; recomputing model-proposed advantage/bonus damage from state (treating proposals as requests); routing accepted character relationship mechanics through `resolveCommand`.
- **Out of Scope:** migrating combat resolution wholesale into the kernel (AC-6 covers the dialogue/delta path only); event recording (C-491 — this contract decides and applies, C-491 writes down what happened); any new delta kinds.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the dropped deltas, the unreachable kernel, and the narration/commit ordering are one seam — an authority that applies nothing, or an authority nobody calls, or an authority that runs after the lie is told, are each the same bug seen from three angles. Combat migration is already split out by the backlog.

## Acceptance Criteria

### AC-1: Accepted deltas are actually applied
**Given** any `NpcStateDelta`
**When** it is accepted
**Then** it is applied — `trust_change` and `relationship_update` mutate real relationship/faction state (C-341's stores), and a test asserts the value changed and survives a reload.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `npc_dialogue_service.test.ts` + `relationship_service.test.ts` | `_validateAndApplyDeltas` — the production delta seam invoked by `/game` dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: feed `trust_change`, `relationship_update` with `label: 'affinity'`, and `relationship_update` with `label: 'faction'`; assert the first two map to the exact `applyDelta` trust/affinity parameters above, the faction outcome maps to `adjustFactionStanding`, and all resulting values survive serialize → deserialize.
- E2E / Visual:
    - **Functional**: N/A — store-level survival is proven by unit test; the production journey is AC-3's concern.
    - **Visual**: N/A.

**Watch Points**:
- The current code pushes both kinds into `valid` and mutates nothing — the test must assert the *store* changed, not that the method returned a "valid" array.
- `relationship_update.label` is the destination discriminator (`trust`, `affinity`, or `faction`), not free-form history text. Build `eventDescription`/`reason` from the operation and source-event IDs exactly as specified in State & Data Models.

### AC-2: One authority checks entitlement, idempotency and provenance
**Given** a consequential delta
**When** it is processed
**Then** it passes through a single authority that checks **entitlement** (is this NPC allowed to grant this?), **idempotency** (has this operation/delta ledger key already succeeded?) and **provenance** (does `sourceEventId` identify the loaded event being resolved?), not just numeric bounds.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `npc_dialogue_service.test.ts` | the single authority invoked by `_validateAndApplyDeltas` | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: three negative cases—an NPC not entitled to grant an item, a retry using the same `operationId` and canonical delta key, and an unknown `sourceEventId`—are each rejected with the specific reason. A fourth case repeats the same grant under a new authoritative operation/event pair and asserts that it is a legitimate second application.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- Bounds/label checks remain necessary but are not sufficient; do not collapse the three checks into "is the number in range".
- Entitlement derives from pack NPC data and world state — do not hardcode a single allowed-grant list unless that is genuinely the pack's data.

### AC-3: State commits before narration is shown
**Given** a consequential action
**When** it resolves
**Then** state commits before the narration describing it is shown. Non-consequential conversation (no deltas) continues to stream freely.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | `npc_dialogue_service.test.ts`; a `/game` dialogue assertion | `/game` — the production `_resolveRoll` path | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test and E2E tasks
- Integration: assert that by the time the resolved narration is appended to the transcript, the corresponding store mutation has already happened.
- E2E / Visual:
    - **Functional**: `/game` journey — resolve a consequential dialogue turn and assert the world changed in the same turn.
    - **Visual**: N/A.

**Watch Points**:
- This is a reordering of `_resolveRoll` — the streamed narrative in the **intent** call is pre-roll and is not affected; the ordering rule applies to the **roll-resolution** narrative.
- The contract must state which delta kinds are consequential — see Architecture Directives (all six).

### AC-4: Rejection is coherent and logged
**Given** a rejected delta
**When** it is rejected
**Then** the player sees a coherent outcome — never a narrated success whose effect did not happen — and the rejection is logged with the reason.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `npc_dialogue_service.test.ts` | the rejection path of `_validateAndApplyDeltas` / its replacement | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: force a rejection and assert the log carries the reason and the returned `ConsequenceResult` marks it rejected (so the caller can reconcile narration).
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- "Coherent outcome" is not "delete the NPC's line" — it is reconciliation text that acknowledges the world did not change. The implementer decides the wording; the AC enforces that a success is never narrated for a rejected delta.

### AC-5: Model-proposed advantage and bonus damage are recomputed
**Given** custom combat actions where the model proposes advantage or bonus damage
**When** they are applied
**Then** the advantage and bonus are recomputed from state, and the model's proposal is treated as a request, not an input.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `npc_dialogue_service.test.ts` or the combat-action validation test | the production path that consumes model-proposed combat bonuses | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: a model proposal claiming `advantage: true` and `+10 bonus damage` resolves to the state-derived values, ignoring the `+10`.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- This mirrors C-487 AC-5 for combat. The line stays: model proposes, rules decide. Do not duplicate the C-487 modifier logic — reuse the same computed-mechanics helpers.

### AC-6: The production relationship authority invokes the rules kernel
**Given** `resolveCommand` in `rules_kernel.ts`
**When** an accepted `trust_change` or character-targeted `relationship_update` reaches the production consequence authority
**Then** that path invokes `resolveCommand` with `applyRelationshipDelta`, uses the returned mechanical state to call `relationshipService.applyDelta`, and persists the result. Imports, re-exports, and unreachable calls do not satisfy this criterion.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | an executable production-caller test in `npc_dialogue_service.test.ts` | `_validateAndApplyDeltas` → `resolveCommand` → `relationshipService.applyDelta` | Filled during verification |

**Test Hooks**:
- Moon Task: the client and utils test tasks
- Integration: inject or spy on the real `resolveCommand` dependency, invoke the production consequence authority with an accepted relationship delta, and assert one `applyRelationshipDelta` call and the resulting store mutation. Add the rejection control proving the kernel is not invoked for a rejected delta.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- A source grep is not evidence: it cannot distinguish a real invocation from an import, re-export, comment, or dead branch. The caller test must execute the production authority seam.

## Implementation Sequence

1. **Phase 1 (Single authority)**: convert `_validateAndApplyDeltas` into an authorize → apply → report path; route `trust_change`/`relationship_update` to `relationshipService` (AC-1, AC-2).
2. **Phase 2 (Ordering)**: reorder `_resolveRoll` so consequential state commits before narration; state the consequential kinds explicitly (AC-3).
3. **Phase 3 (Rejection)**: add `ConsequenceResult` and coherent rejection handling with logged reasons (AC-4).
4. **Phase 4 (Combat proposals)**: recompute model-proposed advantage/bonus from state (AC-5).
5. **Phase 5 (Kernel reachability)**: route character relationship mechanics through `resolveCommand` and prove the production invocation with an executable caller test (AC-6). Run `validate()`.

## Edge Cases & Gotchas

- **Double-grant on retry**: a retried `inventory_grant` with the same operation/canonical-delta ledger key must not grant twice; the same grant from a distinct authoritative event uses a new `operationId` and is allowed.
- **Entitlement for NPCs with no authored grant rights**: a generic NPC must not be able to grant arbitrary items; the authority falls back to "not entitled" unless pack data says otherwise.
- **Trust vs. faction standing**: `trust_change` (character relationship) and faction standing are different stores; map each delta kind to its store explicitly and test both.
- **Batch ordering**: use the fixed kind/target/label/value ordering in Failure Recovery, never model or collection input order. Tests retry a shuffled multi-delta batch under the same `operationId`, assert already-applied entries are not repeated, and assert an invalid/rejected entry does not prevent later sorted entries from applying.

## Open Questions

- Resolved: retain `resolveCommand` and make it the mechanical authority for production character relationship deltas; `relationshipService` remains the persistence boundary. AC-6's executable caller test prevents the kernel from becoming unreachable again.

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
