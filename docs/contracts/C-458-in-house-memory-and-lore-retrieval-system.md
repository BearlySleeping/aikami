---
id: C-458
title: "In-House Memory & Lore Retrieval System"
source: "docs/contracts/BACKLOG_C452_PLUS.md 'C-463' seed (RPG-depth batch, 2026-08-30 roadmap review — 'the single highest-leverage gap identified'). Renumbered on authoring — see C-456's source note for the ID-allocation caveat."
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-02"
---

# Contract C-458: In-House Memory & Lore Retrieval System

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/BACKLOG_C452_PLUS.md` RPG-depth batch, seed "C-463" |
| **Target** | New service, `apps/frontend/client/src/lib/services/memory/` (or `packages/frontend/services/memory/` if promoted to shared — decide per Open Questions); reads from `lorebook_store.svelte.ts`, `keyword_scanner.ts`, `session_summary_service.svelte.ts`, `compacted_campaign_summary.ts` (C-344), `relationship_state.ts`/`faction_standing.ts` (C-341) |
| **Type** | full |
| **Priority** | P1 |
| **Dependencies** | None structurally; sequence before [C-457](C-457-gm-prompt-assembly-upgrade.md) where possible since both touch prompt budget from opposite sides — keep Open Questions in sync between the two |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing (memory quality is directly felt in play) |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: three disjoint, unindexed sources hold everything the game currently treats as "memory," and none of them support retrieval beyond exact keyword matching:
  1. **Lorebook** (`lorebook_store.svelte.ts` + `keyword_scanner.ts`, C-238) — `scanKeywords()` does purely lexical, case-insensitive, word-boundary regex matching against `entry.keywords`. No synonym, paraphrase, or semantic matching — a lore entry keyed on "the old mill" is invisible if the player says "that abandoned windmill."
  2. **Session summaries** (`session_summary_service.svelte.ts`, C-235) — one flat `SessionSummary` (synopsis, key events, NPC interactions) generated at end-of-session and **overwritten** each time. Not indexed, not queryable by topic/NPC/location — just the last session's snapshot. `compacted_campaign_summary.ts` (C-344) rolls multiple sessions into one still-flat blob.
  3. **Relationship/faction state** (`relationship_state.ts`/`faction_standing.ts`, C-341) — structured (`CharacterRelationship`, `FactionStanding`, `RememberedPromise`) but stored as flat records with no retrieval surface; a GM prompt would have to know exactly which character ID to look up, it can't "recall what's relevant" to the current scene.
- **Reproduction**: reference an NPC or event from 3 sessions ago by description rather than exact name/keyword — nothing in the current system surfaces it; the GM has no memory of it beyond whatever fits in the current session's context.
- **Existing implementation to reuse**: `lorebook_store.svelte.ts`'s budget-and-drop pattern (2048 warn / 5120 cap by priority) is a working precedent for bounding retrieval output size. `CompactedCampaignSummary`'s hierarchical rollup shape (`compactedSessionIds`, `sessionRange`, deduped `keyEvents`) is a reasonable unit of "what happened" to index, once indexing exists.
- **Known gaps**: no semantic/embedding-based matching exists anywhere in this codebase today — this contract is the first component doing that. No unified query surface across lorebook + summaries + relationships — a GM prompt assembler currently has to know which of three separate systems to ask, and two of them (summaries, relationships) don't support "what's relevant to X" queries at all.
- **Baseline tests**: `keyword_scanner.test.ts`, `lorebook_store.svelte.test.ts`, `session_summary_service.test.ts` — establish current lexical-only behavior as the regression baseline; this contract adds a new retrieval layer alongside these, it does not replace the lorebook's existing exact-match fast path.

## User Outcome

After this contract, a player's campaign remembers people, places, and events across sessions well enough that the GM can reference something from several sessions ago when it becomes relevant again — described by meaning, not only by exact keyword — without the player having to re-explain it.

## Success Measures

- **Time/latency target**: retrieval query must resolve fast enough to fit inside the existing GM prompt assembly turn (no visible added wait beyond the LLM call itself) — target under 200ms for a local retrieval query.
- **Offline/degraded behavior**: retrieval must work fully offline — this is Directive #3 (auth/cloud optional, text AI is not) and Directive #9 (local-first persistence on Turso) territory; no cloud vector DB dependency, no boot-time network call.
- **Production journey enabled**: a player can play a long-running campaign (10+ sessions) and have the GM correctly recall relevant history, relationships, and lore without the player manually re-stating context every session.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Exact-keyword lore matching | `keyword_scanner.ts`/`lorebook_store.svelte.ts` (C-238) | reuse as the fast, deterministic path — this contract adds semantic retrieval alongside it, per Directive #4 (deterministic fallback, not a substitute) |
| Session summary generation | `session_summary_service.svelte.ts` (C-235) | reuse as an input source — extend to be indexed rather than overwritten |
| Campaign-level compaction | `compacted_campaign_summary.ts` (C-344) | reuse as the unit of "what happened" to index |
| Relationship/faction structured state | `relationship_state.ts`/`faction_standing.ts` (C-341) | reuse as a queryable input, not replaced |
| Local-first persistence | Turso (libSQL) per Directive #9 | reuse as the storage backend for any new indexed/embedded data |

## Overview

Build an in-house memory/lore retrieval layer that indexes session summaries, lorebook entries, and relationship/faction state behind one query interface, using local embeddings (not a cloud vector DB) so retrieval works fully offline. Built in-house, informed by VoiceMem's retrieval approach as architectural inspiration only — not adopted as a dependency, because Aikami-specific context (factions, relationships, party state) needs to feed retrieval in ways a generic third-party memory system can't without heavy adaptation, at which point building in-house costs about the same and avoids the dependency. Include one clean pluggable-backend interface boundary (per the 2026-08-30 roadmap discussion) so a third-party or user-swappable backend remains possible later — but do not build a full plugin system for a single initial backend.

## Design Reference

Mirror `lorebook_store.svelte.ts`'s existing budget-and-priority-drop pattern for retrieval output sizing. Follow Directive #9 (Turso/libSQL as the durable local store) for any persisted index — do not introduce IndexedDB or a new storage layer. Follow Directive #4 (hand-authored baseline before generation) — the existing exact-keyword lorebook path stays as the deterministic fallback when retrieval is unavailable or low-confidence, not replaced by it.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Define a single `MemoryRetrievalBackend` interface (query in, ranked results out) with one concrete local-embedding implementation — this is the "one clean interface boundary" the roadmap discussion called for, not a full plugin system.
- Index three input types behind the same query surface: lorebook entries (supplementing, not replacing, `keyword_scanner.ts`'s exact-match path), session/campaign summaries (`SessionSummary`/`CompactedCampaignSummary`), and relationship/faction facts (`CharacterRelationship`, `FactionStanding`, `RememberedPromise`).
- Persist any embedding index in Turso (libSQL), consistent with Directive #9 — do not add a separate vector database dependency unless Turso genuinely cannot support the access pattern (flag as an Open Question if so, don't silently reach for another store).
- Retrieval must degrade gracefully to "no results" (not an error) when the index is empty or embeddings aren't yet computed for new content — the exact-keyword lorebook path continues to work independently as the deterministic fallback, per Directive #4.
- Expose a bounded, ranked result set (mirroring `lorebook_store.svelte.ts`'s priority-drop pattern) so a caller (eventually [C-457](C-457-gm-prompt-assembly-upgrade.md)'s prompt assembler) gets a size-bounded answer, not an unbounded dump.

## State & Data Models

```typescript
// New service — exact package location per Open Questions
type MemoryQuery = {
  text: string; // natural-language query, e.g. current player message or scene context
  scope?: "lore" | "history" | "relationships" | "all";
  limit?: number;
};

type MemoryResult = {
  sourceType: "lore" | "session_summary" | "relationship" | "faction";
  sourceId: string; // entry ID, session ID, character ID, or faction ID
  content: string; // the retrievable text
  relevanceScore: number; // 0..1
};

type MemoryRetrievalBackend = {
  index(entries: MemoryIndexable[]): Promise<void>;
  query(q: MemoryQuery): Promise<MemoryResult[]>;
};
```

TypeBox schemas for any persisted index rows go in `packages/shared/schemas/` per monorepo convention if the index needs to survive save/load as campaign state; if the index is fully derivable from existing campaign data on demand, it may not need persistent schema at all — resolve in Open Questions.

## Quality Requirements

- **Offline/degraded mode**: full retrieval must function with the local/offline AI engine — no cloud dependency for embedding generation or query (local embedding model, not a cloud embeddings API), per Directive #3.
- **Accessibility/input**: N/A — backend service, no new UI.
- **Performance budget**: retrieval query under ~200ms locally; indexing new content should not block gameplay (background/async indexing, not synchronous on save).
- **Security/privacy**: no campaign content leaves the device for indexing/retrieval in offline mode; if a cloud embedding provider is ever used in BYOK/service mode, it must go through the existing `AiProviderGateway` (Directive #10), not a bespoke call site.
- **Persistence/migration**: if an index is persisted, define how it's rebuilt/invalidated when underlying content (lorebook entries, summaries, relationships) changes — a stale index returning outdated results is worse than no index.
- **Cancellation/retry/idempotency**: indexing must be safely re-runnable (idempotent) — re-indexing the same content shouldn't duplicate entries.
- **Observability**: log retrieval query latency and result count; log indexing failures without blocking gameplay.

## Migration & Rollback

- **Old data compatibility**: existing campaigns have no memory index — first load after this ships must be able to build one from existing lorebook/summary/relationship data without requiring a fresh campaign.
- **Migration**: background indexing pass over existing campaign data on first load post-upgrade; must not block the boot/play path (Directive #5, one boot coordinator — indexing is not a boot dependency).
- **Rollback**: retrieval layer is additive — disabling it should fall back cleanly to the existing exact-keyword lorebook path with no data loss, since underlying source data (lorebook, summaries, relationships) is untouched by this contract.
- **Feature flag or kill switch**: retrieval should be toggleable (e.g. a settings flag) so it can be disabled without a redeploy if quality/performance issues surface post-ship.
- **Failure recovery**: if indexing fails partway (e.g. app closed mid-index), resuming should not require a full re-index from scratch if avoidable — at minimum, a failed partial index must not be treated as complete.

## Scope Boundaries

- **In Scope:** the `MemoryRetrievalBackend` interface and one local-embedding implementation; indexing lorebook/summary/relationship data; a query API other systems (notably C-457's prompt assembler) can call.
- **Out of Scope:** wiring this retrieval system into `gm_prompt_service.svelte.ts`'s actual prompt assembly — that integration is [C-457](C-457-gm-prompt-assembly-upgrade.md)'s and [C-459](C-459-ai-gm-narrative-director-enhancements.md)'s job, this contract only builds the retrieval capability and its query surface. Adopting VoiceMem or any third-party memory system directly (explicitly ruled out, inspiration only). A full pluggable-backend plugin system (one interface boundary is enough for now).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single contract — the three input sources (lore, summaries, relationships) share one query interface and one embedding backend; splitting by source would leave each half unable to demonstrate real cross-source retrieval, which is the actual point of the feature.

## Acceptance Criteria

### AC-1: Retrieval surfaces content by meaning, not just exact keyword
**Given** an indexed lorebook entry described by content the player references paraphrastically (not the exact keyword)
**When** a `MemoryQuery` is issued with that paraphrase
**Then** the entry is returned in `MemoryResult[]` with a relevance score, where the existing exact-keyword `keyword_scanner.ts` path would return nothing

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | new memory service test suite | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: index a known lore entry, query with a paraphrase, assert non-empty result
- E2E / Visual: N/A

**Watch Points**:
- Don't regress the existing exact-keyword lorebook path — this is additive, both should coexist.

### AC-2: Cross-source query returns results from multiple source types
**Given** indexed lore, session summaries, and relationship data all referencing the same NPC
**When** a `MemoryQuery` with `scope: "all"` is issued for that NPC
**Then** `MemoryResult[]` includes entries from more than one `sourceType`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | new memory service test suite | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: seed all three source types with overlapping NPC references, query, assert multi-source results
- E2E / Visual: N/A

### AC-3: Retrieval works fully offline
**Given** the local/offline AI engine mode (no network)
**When** indexing and querying run
**Then** both succeed with no network call, using local embeddings only

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | new memory service test suite, offline-mode simulation | `/game` offline mode | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: run indexing/query with network disabled/mocked out
- E2E / Visual: **Functional**: N/A (backend-only). **Visual**: N/A.

**Watch Points**:
- Any accidental network call (e.g. a cloud embeddings default) here is a hard failure, not a degraded-mode acceptable case — per Directive #3.

### AC-4: Existing campaign data can be indexed without blocking boot
**Given** an existing campaign with lorebook entries, session summaries, and relationship data predating this contract
**When** the app loads that campaign for the first time after this ships
**Then** background indexing runs without delaying boot/play readiness (Directive #5)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | new memory service test suite | `/game` existing-campaign load | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: load a pre-existing dev-fixture campaign, measure time-to-playable before/after this change
- E2E / Visual: N/A

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: define `MemoryRetrievalBackend` interface and types; implement the local-embedding backend; define index persistence shape (Turso).
2. **Phase 2 (Integration)**: build indexing pipelines for lorebook, session summaries, and relationship/faction data; wire background indexing on campaign load.
3. **Phase 3 (Validation)**: run `bun run validate`, `moon run client:test`, offline-mode integration checks, and a boot-time-regression check for AC-4.

## Edge Cases & Gotchas

- **Very large campaign history**: indexing must scale gracefully (background, incremental) rather than re-embedding the entire campaign on every session summary generation.
- **Conflicting/stale relationship data**: if a relationship value changes after indexing, retrieval must reflect the current value, not a stale embedded snapshot — decide whether relationship/faction facts are embedded at all or queried live and only lore/summaries are embedded (Open Question).
- **Empty campaign (fresh start)**: retrieval must return empty results gracefully, not error, when nothing has been indexed yet.

## Open Questions

Must be resolved before status becomes `approved`:

- Package location: does this live under `apps/frontend/client/src/lib/services/memory/` (app-local) or get promoted to `packages/frontend/services/` (shared, in case `hub` or another app needs it later)?
- Which local embedding model/library is available and license-compatible for offline use in a Tauri SPA — needs a concrete technical answer before Architecture Directives can be finalized.
- Are relationship/faction facts embedded into the index at all, or queried live from `relationship_state.ts` at retrieval time (avoiding staleness) while only lore and summaries get embedded?
- Does Turso genuinely support the vector/similarity query pattern needed here, or does this require an in-process vector index (e.g. an in-memory or file-based index) layered on top of Turso-persisted source data?

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
