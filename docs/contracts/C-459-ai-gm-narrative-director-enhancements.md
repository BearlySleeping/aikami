---
id: C-459
title: "AI GM / Narrative Director Enhancements"
source: "docs/contracts/BACKLOG_C452_PLUS.md 'C-464' seed (RPG-depth batch, 2026-08-30 roadmap review). Renumbered on authoring — see C-456's source note for the ID-allocation caveat."
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-02"
---

# Contract C-459: AI GM / Narrative Director Enhancements

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/BACKLOG_C452_PLUS.md` RPG-depth batch, seed "C-464" |
| **Target** | `apps/frontend/client/src/lib/services/gm/narrative_director_service.svelte.ts`, `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` |
| **Type** | full |
| **Priority** | P2 |
| **Dependencies** | [C-457](C-457-gm-prompt-assembly-upgrade.md), [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) — the director needs a bounded prompt budget and real retrieval to draw on before its scene direction can meaningfully use campaign history |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `narrative_director_service.svelte.ts` (C-235) already runs as a background LLM agent generating `SceneDirection` objects on a configurable interval (default 120s), persists `ArcMemory` via `gameSaveService`, and injects narrative guidance into GM prompts. It has a manual `pushStory()` trigger and start/stop controls. This is a working director, not a blank slate — but its scene direction currently draws only on whatever `gm_prompt_service.svelte.ts` already assembles (world/party/quest state), with no access to the richer retrieval layer being built in [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) and no formal connection to the rules-engine-decides directive.
- **Reproduction**: N/A — this is an enhancement to a working system, not a bug repro; baseline behavior is observable by running an existing dev-sandbox campaign for 2+ minutes and inspecting generated `SceneDirection` output.
- **Existing implementation to reuse**: `narrative_director_service.svelte.ts`'s interval-based generation loop, `ArcMemory` persistence, and `pushStory()` manual trigger — all reused as-is. `gm_prompt_service.svelte.ts`'s injection point for director guidance — reused, not rebuilt.
- **Known gaps**: director-generated `SceneDirection` has no explicit mechanism ensuring it only *proposes* narrative beats rather than directly mutating game state — Directive #2 ("AI proposes; the rules engine decides") needs a concrete, checkable boundary here, not just a convention. No connection yet to C-458's retrieval layer, so scene direction can't reference "what happened 3 sessions ago" even once that capability exists.
- **Baseline tests**: `narrative_director.test.ts`, `arc_memory.test.ts` — establish current interval/persistence behavior as the regression baseline.

## User Outcome

After this contract, the AI GM's background narrative direction draws on real campaign memory (via C-458) to propose story beats that reference past events and relationships, while every proposal still passes through the same rules-engine validation as any other AI-originated command — never applying directly.

## Success Measures

- **Time/latency target**: no change to the existing 120s default interval unless evidence from this work justifies a different cadence — flag as Open Question rather than silently retuning.
- **Offline/degraded behavior**: narrative direction must degrade gracefully when retrieval (C-458) has no relevant history yet (fresh campaign) — falls back to the current C-235 behavior (world/party/quest state only), never blocks or errors.
- **Production journey enabled**: a player in a long-running campaign notices the GM referencing earlier events and relationships unprompted, not just reacting to the immediate scene.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Background scene-direction loop | `narrative_director_service.svelte.ts` (C-235) | reuse — extend inputs, not the loop mechanism |
| Arc memory persistence | `ArcMemory` via `gameSaveService` (C-235) | reuse as-is |
| Manual trigger | `pushStory()` (C-235) | reuse as-is |
| Retrieval layer | [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) `MemoryRetrievalBackend` | new dependency — director queries it for relevant history when generating `SceneDirection` |
| AI-proposes/rules-decide boundary | Directive #2, `vision-and-directives.md` | new — formalize for this specific proposal path |

## Overview

Extend the existing narrative director to query C-458's memory/lore retrieval system when generating scene direction, so proposed story beats can reference relevant past events, relationships, and faction state instead of only current world/party/quest snapshot. Formalize the existing "AI proposes" pattern for this specific path: `SceneDirection` output is validated/typed before it can influence gameplay, never applied as a direct state mutation.

## Design Reference

Follow Directive #2 exactly: `SceneDirection` remains an LLM proposal; whatever downstream consumes it (currently `gm_prompt_service.svelte.ts`'s injection point) must be the thing that decides whether/how it affects the actual prompt or game state, not the director itself. Follow Directive #4 (hand-authored baseline before generation) — scene direction is optional narrative flavor, not a required-to-function system; the game must play correctly with the director disabled.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Add a retrieval query step to `narrative_director_service.svelte.ts`'s generation cycle: before generating `SceneDirection`, query C-458's `MemoryRetrievalBackend` for content relevant to the current scene/arc state.
- Keep `SceneDirection`'s existing typed shape as the sole interface between the director and the rest of the system — no new direct-mutation path. Document (in code comments where non-obvious, and in this contract's State & Data Models) exactly which fields are advisory-only.
- Degrade gracefully: if C-458's retrieval returns nothing (fresh campaign, or retrieval disabled), the director must produce `SceneDirection` from existing world/party/quest state exactly as it does today — this is not a hard dependency that breaks direction if retrieval is unavailable.
- Do not change the 120s default interval or the `pushStory()` manual trigger's behavior — this contract adds an input source, not new triggering logic.

## State & Data Models

```typescript
// apps/frontend/client/src/lib/services/gm/gm_types.ts — extend existing SceneDirection shape
type SceneDirection = {
  // existing fields unchanged
  referencedMemory?: MemoryResult[]; // from C-458, optional — present only when retrieval found relevant history
};
```

No `packages/shared` schema changes — `SceneDirection` stays client-local per the existing GM-context boundary decision (matches C-457/C-458's approach).

## Quality Requirements

- **Offline/degraded mode**: functions fully offline (director already does; retrieval per C-458 is offline-first too).
- **Accessibility/input**: N/A.
- **Performance budget**: retrieval query must fit inside the existing 120s generation cycle without meaningfully extending it — no synchronous blocking beyond the retrieval query's own ~200ms target (per C-458).
- **Security/privacy**: N/A.
- **Persistence/migration**: `ArcMemory` shape may need a minor additive field if `referencedMemory` is persisted for replay/debugging — treat as optional, not required.
- **Cancellation/retry/idempotency**: a failed retrieval query must not abort scene-direction generation — fall back to current behavior (see Architecture Directives).
- **Observability**: log when a `SceneDirection` includes referenced memory vs. when it falls back to world-state-only generation, so the two behaviors are distinguishable in logs.

## Migration & Rollback

- **Old data compatibility**: existing `ArcMemory` saves have no `referencedMemory` field — treat as absent/empty, no migration needed since the field is additive and optional.
- **Migration**: none required.
- **Rollback**: remove the retrieval query step; `narrative_director_service.svelte.ts` reverts to exactly its C-235 behavior since nothing about the existing loop/persistence changes structurally.
- **Feature flag or kill switch**: reuse whatever toggle C-458 exposes for disabling retrieval — director should respect it and fall back automatically, not need its own separate flag.
- **Failure recovery**: N/A beyond the graceful-degradation behavior already specified.

## Scope Boundaries

- **In Scope:** wiring the narrative director's generation cycle to query C-458's retrieval layer; formalizing the propose-not-mutate boundary for `SceneDirection`'s new memory-referencing capability.
- **Out of Scope:** any change to the director's interval, manual trigger, or persistence mechanism; new UI for viewing/editing scene direction; NPC-level behavioral changes (that's [C-460](C-460-npc-behavioral-autonomy-layer.md)); the retrieval system itself (that's C-458 — this contract only consumes it).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single contract — the retrieval-query wiring and the propose/decide boundary formalization are two facets of the same change (both concern how the director's output relates to real game state) and neither is independently useful without the other.

## Acceptance Criteria

### AC-1: Scene direction references relevant past events when available
**Given** a campaign with indexed history (via C-458) relevant to the current arc
**When** the narrative director generates its next `SceneDirection`
**Then** `referencedMemory` is populated with relevant `MemoryResult[]` entries

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `narrative_director.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: seed a dev campaign with indexed history relevant to the current scene, trigger `pushStory()`, inspect output
- E2E / Visual: N/A

### AC-2: Direction generation degrades gracefully with no retrieval results
**Given** a fresh campaign with nothing indexed yet
**When** the director generates `SceneDirection`
**Then** generation succeeds exactly as it did before this contract, with `referencedMemory` absent or empty — no error, no blocked generation

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `narrative_director.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: fresh dev-sandbox campaign, trigger generation, confirm no error and prior behavior intact
- E2E / Visual: N/A

**Watch Points**:
- This is the regression guard for the existing C-235 behavior — treat any failure here as a blocker.

### AC-3: SceneDirection never directly mutates game state
**Given** a generated `SceneDirection` with referenced memory
**When** it's consumed downstream by `gm_prompt_service.svelte.ts`
**Then** the consumption path only injects it as prompt context — no direct write to campaign/world/relationship state occurs from the director itself

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `narrative_director.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: code-level check — grep/audit the director for any write call into game/campaign state outside `ArcMemory` persistence
- E2E / Visual: N/A

**Watch Points**:
- This directly enforces Directive #2 — treat any direct-mutation path found here as a design violation to fix, not to document as an exception.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: add the `referencedMemory` field to `SceneDirection`; implement the retrieval query call.
2. **Phase 2 (Integration)**: wire the query into the director's generation cycle with graceful fallback; confirm `gm_prompt_service.svelte.ts`'s injection point handles the optional field.
3. **Phase 3 (Validation)**: run `bun run validate`, `moon run client:test`, and a manual audit for AC-3's propose-not-mutate guarantee.

## Edge Cases & Gotchas

- **Retrieval query slow or hanging**: must not stall the director's 120s cycle — apply a timeout consistent with C-458's ~200ms target, fall back on timeout rather than waiting indefinitely.
- **Referenced memory becomes stale between query and use**: since generation happens on an interval, a relationship/fact could change between retrieval and prompt injection — acceptable for narrative flavor (not mechanically authoritative), but don't let stale referenced memory contradict currently-displayed game state in a jarring way; keep referenced content advisory/narrative, not factual claims about current state.

## Open Questions

Must be resolved before status becomes `approved`:

- Should the 120s generation interval be reconsidered now that a retrieval query adds latency, or is the existing interval's headroom sufficient? (Depends on C-458's actual measured query latency once implemented.)

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
