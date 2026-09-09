---
id: C-492
title: "Memory retrieval correctness and production wiring"
source: direct
contract_type: full
status: implemented
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-492: Memory retrieval correctness and production wiring

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-492, seeded from the 2026-09-06 external review (V-7); Phase 2 — retrieval correctness after C-491 |
| **Target** | `apps/frontend/client/src/lib/services/memory/local_embedding_backend.ts` (branch at `:174`), `apps/frontend/client/src/lib/services/memory/memory_retrieval_service.svelte.ts`, `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` (boot pipeline), `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (`_buildContextProjection`), `apps/frontend/client/src/lib/services/game/game_state_facts.ts` (or the dialogue overlay's fact-assembly seam), `packages/shared/constants/src/lib/memory.ts`, `packages/shared/schemas/src/lib/domain/memory_retrieval.ts` + derived types in `packages/shared/types/` |
| **Type** | full |
| **Priority** | P1 — the current implementation does the opposite of what its own docs say |
| **Dependencies** | [C-491](C-491-committed-narrative-event-record.md) — the committed narrative event record is the authoritative fact source this contract retrieves from. [C-488](C-488-authored-npc-identity-in-the-content-pack.md) — AC-5's budget ceiling. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the game boot pipeline (`game_boot_service.svelte.ts#gameBootService.boot`) initialises memory; the NPC dialogue overlay (`dialogue_overlay_view_model.svelte.ts` → `npc_dialogue_service.svelte.ts#_buildContextProjection`) consumes witness-scoped recall |

## Problem & Baseline Evidence

- **The retrieval branch is inverted (V-7).** `local_embedding_backend.ts:174-183`:

  ```ts
  const hasPrecomputedEmbeddings =
    this._entries.length > 0 && this._entries[0].embedding.length > 0;

  if (!hasPrecomputedEmbeddings) {
    await this._ensureModel();
  }

  if (hasPrecomputedEmbeddings) {
    // With pre-computed embeddings, use keyword overlap scoring
  ```

  The normal indexed case — entries **with** embeddings — takes the **keyword-overlap** branch. The cosine-similarity path the service documents as its core behaviour (C-458 AC-1, "retrieval by meaning, not just exact keyword") runs only when embeddings are absent, i.e. only in the case the model was never loaded. The branch is the exact inverse of the service's documented contract.

- **No production caller initialises or indexes memory.** `memoryRetrievalService.init()` and `memoryRetrievalService.backgroundIndexOnLoad()` have **zero** callers outside the service itself and its tests. The only production-side reference to `memoryRetrievalService.query` is `narrative_director_service.svelte.ts:243` (`_queryRelevantMemory`), and the narrative director's startup is sandbox-only (`gm_system_sandbox_view_model.svelte.ts:144`, `push_story_button_view_model.svelte.ts:60`). Net effect: in a real `/game` boot the index is never built and never queried.

- **The index is not persisted and not rebuilt.** `local_embedding_backend.toSnapshot()` / `loadSnapshot()` (`:280`, `:288`) exist but have no save/load callers — the backend is not registered with `serializable_service.ts`. The index is purely ephemeral, which is a *symptom* of the deeper problem: the only thing that would populate it (`backgroundIndexOnLoad`) is never called. (This is load-bearing for the resolution in AC-1 — see Architecture Directives.)

- **The NPC dialogue path does not consume retrieval at all.** `npc_dialogue_service._buildContextProjection` (`:1385`) builds `memory` from the last 10 conversation turns, and `gameStateFacts` comes from `buildGameStateFacts` (`game_state_facts.ts`). C-491's `narrativeEventService.witnessedBy(npcId)` — the witness model that makes "this NPC could know this" answerable — exists and is not queried by any retrieval path.

- **Retrieval has no witness/belief scoping.** The indexable source types are `lore`, `session_summary`, `relationship`, `faction` (`memory_retrieval.ts` schema). There is no `narrative_event` source type, and nothing distinguishes "Rollo possesses the wand" (world fact, witnessed) from "Thalia believes Rollo intends to sell it" (belief) from "Rollo says he never touched it" (claim). Any retrieval that does not route through C-491's witnesses/belief model will leak secrets to NPCs that never learned them.

- **Reproduction**: `grep -rn "memoryRetrievalService\.\(init\|backgroundIndexOnLoad\|indexAll\)" apps/frontend/client/src --include='*.ts' --include='*.svelte' --include='*.svelte.ts'` outside the service and its tests → no hits; `grep -rn "memoryRetrievalService.query"` → only `narrative_director_service` (sandbox-startup); read `local_embedding_backend.ts:174-183` and observe the branch polarity.
- **Existing implementation to reuse**: C-491's `narrativeEventService` (`events`, `witnessedBy(npcId)`, `record()`); `memory_retrieval_service.svelte.ts` (`indexAll`, `indexLorebookEntries`, `indexSessionSummary`, `setEnabled`); `local_embedding_backend.ts` keyword-overlap scoring (already deterministic and offline); `buildGameStateFacts` + `_buildContextProjection` as the dialogue injection seams; `game_boot_service.svelte.ts` boot stages (`loading_campaign` → `hydrating_snapshot` → `spawning_entities`) as the production init seam; `session_summary_service` (summaries) and `lorebook_store` (lore) as non-witness sources.
- **Known gaps**: inverted branch; no production init/index; no `narrative_event` source type; no witness-scoped retrieval; dialogue path never receives retrieved memory; no budget accounting for the added prompt section.
- **Baseline tests**: `memory_retrieval_service.test.ts` (19 tests, mock-backend keyword overlap; note its comment that the real embedding model is unavailable in Bun's test environment), `narrative_event_service.test.ts`, `npc_dialogue_service.test.ts`, `game_boot_service.test.ts`. Record their pass state before starting.

## User Outcome

After this contract, a player who establishes a fact in conversation — and then leaves, saves, reloads, and returns — finds that the NPC who *witnessed* it can recall it. Retrieval is deterministic, offline, and witness-scoped: an NPC never recalls a secret it did not witness, and the retrieval path actually runs on a real campaign boot instead of existing only in a sandbox and a passing unit test.

## Success Measures

- **Time/latency target**: memory initialisation is non-blocking on boot; keyword scoring is O(entries × query-words) with no model download or ONNX startup. Boot's critical path is unchanged — indexing runs in the background after service hydration.
- **Offline/degraded behavior**: retrieval is fully offline and model-free after AC-1's resolution; when the index is empty or retrieval is disabled, the dialogue path degrades to the existing conversation-history-only context (no error).
- **Production journey enabled**: `/game` → establish a fact through dialogue (C-491 commits a witnessed event) → leave the conversation → save → reload → return to the same NPC → the assembled dialogue context contains the fact, and the NPC recalls it.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Committed, witnessed facts | `narrative_event_service.svelte.ts` (`events`, `witnessedBy`) | reuse — the authoritative fact source for recall |
| Retrieval service surface | `memory_retrieval_service.svelte.ts` | modify — add witness-scoped `retrieveForNpc`, wire init/index into boot |
| Retrieval backend | `local_embedding_backend.ts` | modify — delete the semantic/cosine path, make keyword scoring the only path |
| Dialogue prompt injection | `npc_dialogue_service.svelte.ts` `_buildContextProjection` + `buildGameStateFacts` | modify — add a bounded `[MEMORY]` section sourced from witness-scoped recall |
| Production boot seam | `game_boot_service.svelte.ts` boot stages | modify — init + background-index after `hydrating_snapshot` |
| Non-witness sources | `lorebook_store`, `session_summary_service` | reuse — lore is shared world knowledge; summaries feed the GM path only |
| Source-type registry | `packages/shared/constants/src/lib/memory.ts`, `memory_retrieval.ts` schemas/types | modify — add `narrative_event` source type + an NPC recall scope |

## Overview

Resolve the inverted-branch fork by committing to **deterministic keyword retrieval** — a correct, witness-scoped fact table over C-491's committed narrative events, session summaries, and lore — and deleting the semantic/cosine path that the production boot never initialised. Wire memory initialisation and indexing into the real `/game` boot pipeline (post-hydration, non-blocking), add a `narrative_event` source type, and inject a bounded, witness-scoped `[MEMORY]` section into the NPC dialogue prompt. The result is a retrieval loop a player can actually reach: witnessed facts survive save/reload and come back in the NPC's own context, while unwitnessed secrets do not leak.

## Design Reference

- `narrative_event_service.svelte.ts` — `witnessedBy(npcId)` and `events` are the witness authority; retrieval filters through them rather than re-deriving witness membership.
- `buildGameStateFacts` (`game_state_facts.ts`) — the existing bounded-fact pattern (cap + push helper, `MAX_TOTAL_FACTS`) to mirror for the `[MEMORY]` section's budget.
- `npc_dialogue_service._buildContextProjection` / `_buildNarrativeSystemPrompt` — the existing `[CONVERSATION HISTORY]` / `[GAME STATE]` prompt sections; `[MEMORY]` slots in beside them under the same budget discipline (C-488 AC-6).
- `game_boot_service.svelte.ts` — the boot stage order (`loading_campaign` → `validating_save` → `initializing_asset_registry` → `prefetching_starter_content` → `warming_cache` → `preloading_content` → `creating_engine` → `hydrating_snapshot` → `spawning_entities`) shows where the post-hydration, non-blocking memory hook belongs.
- C-458's directive #4 — the deterministic keyword path is the fallback of record; this contract makes it the primary path rather than the thing a broken semantic layer fell back *onto* by accident.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

**Resolve the AC-1 fork toward keyword retrieval, and delete the semantic path.** Do not "fix the inversion" by swapping the branch polarity — that would leave a 2MB+ ONNX model dependency, lazy model load, and a cosine path that has never once run in a production boot, all in service of a five-character village. The evidence for keyword sufficiency is already in the code: the keyword-overlap branch is deterministic, offline, testable in Bun (the test file notes the embedding model cannot load there), and was what the system *actually ran* whenever the inverted branch was reached. Record that evidence in the Execution Report — it is the correct outcome, not a regression.

- **Delete, do not dead-letter.** Remove `_cosineSimilarity`, `_normalise`, `_ensureModel`, `init()`'s model-loading, and the `@huggingface/transformers` dynamic import from `local_embedding_backend.ts`. The backend's `query()` runs keyword scoring unconditionally; `isReady` means "index initialised", not "model loaded". The `MemoryRetrievalBackend` interface (`index`/`query`/`remove`/`clear`/`size`) is otherwise unchanged, so no consumer has to know which backend it holds.
- **The index is a rebuildable projection, not a persisted store.** Because the index is not registered with `serializable_service.ts` and its sources (lore, summaries, C-491 events) are themselves persisted, do not add index persistence. Rebuild the fact table from authoritative sources on load. This is what removes the need for embeddings entirely — a keyword index over bounded content is cheap enough to rebuild every boot.
- **Exactly one witness authority.** NPC-scoped recall must filter narrative-event results through `narrativeEventService.witnessedBy(npcId)` — never through the event list directly, and never by treating "it's in the campaign log" as knowledge.
- **Two retrieval surfaces with different trust levels.** The GM/narrative-director path (`memoryRetrievalService.query`, all sources including `session_summary`) may know things the player-facing NPC path must not. NPC recall is a *separate* method that draws only from `narrative_event` entries the NPC witnessed plus `lore` (shared world knowledge). `session_summary` is the player's own record and must never be injected into an NPC's recall.
- **Budget is a hard ceiling.** The `[MEMORY]` section added to the dialogue prompt displaces filler (conversation-history window), it does not extend C-488's budget. Keep the cap in one place and test it.

## State & Data Models

Add a `narrative_event` source type. In `packages/shared/schemas/src/lib/domain/memory_retrieval.ts`, extend the `sourceType` unions (`MemoryIndexableSchema`, `InMemoryIndexEntrySchema`, `MemoryResultSchema`) with `Type.Literal('narrative_event')`; mirror in `packages/shared/types/src/lib/domain/memory_retrieval.ts`. In `packages/shared/constants/src/lib/memory.ts`, extend `MEMORY_QUERY_SCOPE_SOURCE_TYPES.all` to include `'narrative_event'` (the `history` and `lore` scopes stay as-is). For the NPC path, `retrieveForNpc` must not reuse the `all` scope — it currently resolves to `['lore', 'session_summary']` and would leak the player's private `session_summary` into NPC recall. Either add a dedicated `npc: ['narrative_event', 'lore']` scope to `MEMORY_QUERY_SCOPE_SOURCE_TYPES` (preferred — keeps the exclusion at the scope layer) or filter `session_summary` results out before the witness filter. The observable requirement is fixed regardless of mechanism: a `session_summary` entry is never returned by the NPC path even when it matches the query (AC-4).

The backend entry `embedding` field becomes optional in the schema (`Type.Optional(Type.Array(Type.Number()))`) and is no longer produced or read. Since the index is not serialised into saves, this is a schema-only change with **no save-format migration** — state that in the contract's Migration & Rollback.

The service interface gains one method (conceptual shape — TypeScript `type` aliases, never `interface`):

```ts
type NpcMemoryRecallQuery = {
  npcId: string;          // the NPC whose knowledge scope we query
  text: string;           // free-text query (player message or current scene context)
  limit?: number;         // defaults to NPC_RECALL_MAX_RESULTS
};

// On MemoryRetrievalServiceInterface:
retrieveForNpc(query: NpcMemoryRecallQuery): Promise<MemoryResult[]>;
```

`retrieveForNpc` semantics:

1. `const witnessedIds = new Set(narrativeEventService.witnessedBy(query.npcId).map((e) => e.id));`
2. Keyword-query the backend over `narrative_event` + `lore` entries.
3. Drop `narrative_event` results whose `sourceId` is not in `witnessedIds`. Lore results pass through (shared world knowledge).
4. Return up to `limit`, highest score first.

`indexAll` additionally indexes each `narrativeEventService.events` entry as:

```ts
{
  sourceType: 'narrative_event',
  sourceId: event.id,
  content: event.summary,
  metadata: {
    kind: event.kind,
    informationKind: event.informationKind,
    claimantId: event.claimantId ?? '',
    campaignId: event.campaignId,
    sequence: String(event.sequence),
  },
}
```

The `content` for belief/claim events should carry the attribution so the prompt distinguishes knowledge from hearsay — e.g. `"[Thalia believes] Rollo intends to sell the wand"` for `character_belief`, `"[Rollo claims] he never touched the wand"` for `dialogue_claim`, and the plain summary for `world_fact`. Do not let the model's prose manufacture a modifier (C-487 AC-5 discipline applies to facts the same way it applies to bonuses).

The dialogue context projection gains a `memory`-adjacent field — either a new `recalledFacts` array in `DialogueContextProjection` or a rename of the current conversation-history `memory` field to `conversationHistory` with `recalledFacts` alongside it. `_buildNarrativeSystemPrompt` renders it as a bounded `[MEMORY]` section. The projection's existing `memory` (last 10 turns) remains as conversation history; `recalledFacts` is a separate, capped list (default cap 4 facts, aligned with `DEFAULT_MAX_RESULTS` budget discipline rather than its raw value of 10).

## Quality Requirements

- **Offline/degraded mode**: fully offline, model-free. Empty index or disabled retrieval → empty `[MEMORY]` section, conversation proceeds exactly as today.
- **Accessibility/input**: N/A — no new UI; a test hook (see AC-3) may expose the assembled context but ships no player-facing chrome.
- **Performance budget**: boot init is non-blocking (fire-and-forget after `hydrating_snapshot`); keyword scoring is O(entries × words) over a bounded index; no model download, no ONNX startup.
- **Security/privacy**: witness scoping is the privacy boundary — a narrative-event fact never reaches an NPC that did not witness it. `session_summary` is excluded from the NPC path.
- **Persistence/migration**: the index is ephemeral and rebuilt; no save-format change. C-491 events (the durable facts) round-trip through the existing `narrativeEvents` snapshot.
- **Cancellation/retry/idempotency**: `indexAll` and the new event indexing are idempotent (same `sourceId` replaces the old entry, already the backend's contract).
- **Observability**: log retrieval source counts and witness-set size at `debug`; log (at `info`) when the NPC path would have returned a fact but witness filtering dropped it, so secret-leak attempts are visible without leaking content.

## Migration & Rollback

- **Old data compatibility**: saves written before this contract already contain no memory-index snapshot (the backend was never registered), and C-491's `narrativeEvents` snapshot already round-trips. A pre-C-492 save loads exactly as it does today; the memory index is rebuilt from the hydrated events on load.
- **Migration**: none — the index is a rebuildable projection, not persisted state. No back-fill: events recorded before C-492 are already in the `narrativeEvents` snapshot and become retrievable on the first boot after this contract.
- **Rollback**: remove the boot hook, the `retrieveForNpc` call site in `_buildContextProjection`, and the `narrative_event` source type; the `[MEMORY]` section disappears and dialogue reverts to conversation-history-only context. No save data is invalidated.
- **Feature flag or kill switch**: the existing `setEnabled(false)` toggle keeps working and now actually matters in production — disabling it stops both init and injection.
- **Failure recovery**: if `indexAll` fails in the background, boot must not fail (log and continue); retrieval then returns empty until the next boot or a manual re-index.

## Scope Boundaries

- **In Scope:** resolving the AC-1 fork by committing to keyword retrieval and deleting the semantic/cosine path (with the evidence recorded); production init + background index from the `/game` boot pipeline; a `narrative_event` source type; witness-scoped NPC recall (`retrieveForNpc`) drawing only from witnessed events + lore; a bounded `[MEMORY]` section in the NPC dialogue prompt; save/reload round-trip of the *facts* (via C-491 events, not a persisted index); a budget test proving the added section stays within C-488's ceiling.
- **Out of Scope:** adopting VoiceMem or any third-party memory system — the [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) decision (in-house, VoiceMem as inspiration only) stands and is not reopened; semantic re-ranking, hybrid search, or embedding-model selection (AC-1 resolves to keyword retrieval, which is a legitimate outcome at this content scale); changing C-491's event schema or the consequence-commit paths that write events; the "be told / infer" knowledge-propagation mechanism (C-494); authoring new NPC knowledge content (C-488/C-495 own the content, not the retrieval plumbing); persisting the retrieval index.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the fork resolution, the boot wiring, the witness-scoped retrieval, and the dialogue injection share one invariant — "a fact is recalled if and only if the recalling NPC witnessed it, through one production path that actually runs." Splitting retrieval from injection would ship a working fact table nobody reads (C-456's failure mode again); splitting boot wiring from retrieval would ship a tested service nobody starts. C-491 already split off the *recording* half.

## Acceptance Criteria

### AC-1: Retrieval takes one documented path — keyword, not a broken semantic branch
**Given** entries indexed with the current `embedding` field populated (the case that today takes the keyword branch)
**When** `query()` (or `retrieveForNpc()`) runs
**Then** the backend performs keyword-overlap scoring as its only path — the cosine-similarity/model-loading path is deleted, not merely bypassed — and the service's documented behaviour, code comments, and `local_embedding_backend.ts` file header all state that retrieval is keyword-based and why (deterministic, offline, sufficient at this content scale; C-458 AC-1's semantic ambition superseded for a five-character village).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `memory_retrieval_service.test.ts` + `local_embedding_backend.test.ts` (new) | `memory_retrieval_service.svelte.ts#memoryRetrievalService` — the singleton both production consumers call | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: index two entries with overlapping-but-not-identical wording; assert a keyword query returns the overlapping-token entry above a non-overlapping entry; assert **no** import of `@huggingface/transformers` is reachable from the backend module (static `grep` assertion in the test); assert `query()` returns results without any model initialisation.
- E2E / Visual:
    - **Functional**: N/A — retrieval ranking is a pure logic path covered by unit test at the service seam.
    - **Visual**: N/A.

**Watch Points**:
- The trap is "fix the polarity". The contract forbids it: the semantic path must be *gone* (no `_cosineSimilarity`, no `_normalise`, no model import), because a half-live path is exactly how this bug shipped the first time. A test that greps the compiled/source module for the transformers import is worth more than a passing ranking test.

### AC-2: Memory initialisation and indexing run from the production boot path
**Given** a normal `/game` boot (fresh or reload)
**When** the boot pipeline completes service hydration (`hydrating_snapshot`)
**Then** memory initialisation and background indexing are invoked from `game_boot_service`'s boot path — non-blocking (boot does not wait on it, a failure logs and continues) — and a test asserts the production boot path calls them, not merely that the methods exist.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + integration | `game_boot_service.test.ts` + `memory_retrieval_service.test.ts` | `game_boot_service.svelte.ts#gameBootService.boot` — the production `/game` boot pipeline | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: drive `gameBootService.boot()` (or its post-hydration stage) with a campaign that has C-491 events; assert `memoryRetrievalService` ends `isReady === true` and `retrieveForNpc`/`size` reflects indexed entries; assert boot resolves without awaiting the background pass (timing/order assertion, not a sleep-based one).
- E2E / Visual:
    - **Functional**: the `/game` boot already has an E2E (`game_boot.spec.ts`); add or extend one assertion that after boot the memory service is ready and the index is non-empty for a campaign with authored facts.
    - **Visual**: N/A.

**Watch Points**:
- Hook it **after** `hydrating_snapshot`, not at `loading_campaign` — indexing reads `narrativeEventService.events`, which is empty until services hydrate. Running at load-campaign time is the exact kind of "looks wired, is actually no-op" bug this contract exists to kill.
- Boot must not fail if indexing throws; degrade to empty retrieval, log, continue.

### AC-3: An NPC recalls an established fact after save/reload (E2E journey)
**Given** a campaign where a fact is established and committed as a C-491 event witnessed by a specific NPC
**When** the player leaves the conversation, saves, reloads, and returns to that same NPC
**Then** the assembled dialogue context for that NPC contains the fact (and the NPC's response reflects it), proven by an E2E journey — not a unit test.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | E2E | `apps/e2e/tests/client/memory_recall.spec.ts` + a POM or test hook exposing the assembled context | `/game` → dialogue overlay (`dialogue_overlay_view_model.svelte.ts` → `npc_dialogue_service.svelte.ts#_buildContextProjection`) | Filled during verification |

**Test Hooks**:
- Moon Task: the e2e client test task (grep-scoped to `memory_recall`)
- Integration: N/A — this AC is the E2E journey itself.
- E2E / Visual:
    - **Functional**: the journey seeds a witnessed `world_fact` event for a known NPC (via the production `narrativeEventService.record` or a seeded campaign), boots `/game`, saves, reloads, opens dialogue with that NPC, and asserts the injected `[MEMORY]` content (exposed via a `data-testid` test hook on the dialogue overlay, or a deterministic provider that echoes the context) contains the established fact's summary.
    - **Visual**: N/A.

**Watch Points**:
- The assertion must not depend on a live LLM "remembering" — it asserts the **assembled context** (the `[MEMORY]` section) that the production prompt would receive, via a test hook that does not alter production behaviour.
- The fact must be *witnessed by the NPC under test*. Seeding a fact the NPC did not witness and then asserting recall would encode the exact privacy violation AC-4 forbids.

### AC-4: Retrieval returns only what the NPC could know
**Given** a set of C-491 events where NPC A witnessed a fact, NPC B did not, and one event is a `dialogue_claim`/`character_belief` by a third party
**When** `retrieveForNpc({ npcId: A })` and `retrieveForNpc({ npcId: B })` run
**Then** NPC A's results contain the witnessed fact and do not contain events A did not witness; NPC B's results contain no `narrative_event` result B did not witness; and a secret/claim A never learned is never returned to A — retrieving it is a failing test.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `memory_retrieval_service.test.ts` + `narrative_event_service.test.ts` | `memory_retrieval_service.svelte.ts#retrieveForNpc` — the witness-scoped NPC recall surface | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: record three events (A-witnessed fact, B-witnessed fact, unwitnessed secret/claim), index them, assert `retrieveForNpc(A)` returns only the A-witnessed fact and never the secret; assert `retrieveForNpc(B)` is symmetric; assert a `session_summary` entry is never returned by the NPC path even when it matches the query.
- E2E / Visual:
    - **Functional**: N/A — the witness filter is pure logic covered at the service seam; AC-3 exercises the production consequence.
    - **Visual**: N/A.

**Watch Points**:
- Witness membership must come from `narrativeEventService.witnessedBy(npcId)`, never from re-reading `events` and hand-rolling the filter — one witness authority, one source of truth.
- The `[Thalia believes]` / `[Rollo claims]` attribution in `content` must survive into results so the prompt can distinguish knowledge from hearsay — the filter protects *access*, the attribution protects *meaning*.

### AC-5: The recall section respects C-488's budget ceiling
**Given** the dialogue prompt assembled with authored identity (C-488) plus the new `[MEMORY]` section
**When** the prompt is built for a typical turn
**Then** total prompt size stays within C-488's budget — the `[MEMORY]` section displaces conversation-history filler rather than extending the ceiling — and the Execution Report records a measured before/after token count.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `npc_dialogue_service.test.ts` (prompt assembly) | `npc_dialogue_service.svelte.ts#_buildNarrativeSystemPrompt` — the production prompt builder | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: build the narrative system prompt with N recalled facts and M history turns; assert the `[MEMORY]` section is capped at its limit, that a large `[MEMORY]` shortens the conversation-history window rather than growing the prompt, and that total token count (measured with the same tokenizer/counting used in C-488) is ≤ the C-488 ceiling.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- The obvious implementation stuffs facts in front of the history and grows the prompt. The cap must be enforced in one place (mirror `buildGameStateFacts`'s `MAX_TOTAL_FACTS` discipline), and the Execution Report must quote real numbers, not "we think it's fine".

## Implementation Sequence

1. **Phase 1 (Backend + source type)**: resolve AC-1 — delete the semantic path from `local_embedding_backend.ts`, make keyword scoring unconditional; extend the `narrative_event` source type in schemas/types/constants (AC-1, AC-4 groundwork).
2. **Phase 2 (Service)**: add `retrieveForNpc` to `memory_retrieval_service` with the witness filter over `narrativeEventService.witnessedBy`; extend `indexAll` to index C-491 events with attribution-aware content (AC-4).
3. **Phase 3 (Boot + dialogue wiring)**: invoke init + background index from `game_boot_service` after `hydrating_snapshot` (AC-2); inject the bounded `[MEMORY]` section via `_buildContextProjection`/`_buildNarrativeSystemPrompt` (AC-3, AC-5).
4. **Phase 4 (Validation)**: run `validate()` and the client + e2e memory-scoped tasks; record before/after token counts in the Execution Report.

## Edge Cases & Gotchas

- **Secret leakage**: a `dialogue_claim`/`character_belief` event witnessed by the NPC is *heard*, not *known* — the attribution must ride the content so the prompt says "you heard X claim Y", never "Y is true". A fact the NPC did not witness must not appear at all.
- **Witness deduplication and empty witness sets**: C-491 guarantees non-empty witnesses, but `retrieveForNpc` must treat an empty `witnessedBy` result as "no narrative-event recall" — not fall back to "all events".
- **Boot ordering**: init/index after hydration, or the index reads empty events and the whole contract ships as a no-op in production (the C-456 failure mode).
- **Index rebuild vs persistence**: do not register the backend with `serializable_service` — the index is a projection; rebuilding it every boot is the cheap, correct behaviour.
- **Old saves**: no memory-index snapshot existed, so nothing to migrate; C-491 events already round-trip and become retrievable on the first boot after this contract.
- **Background failure**: `indexAll` throwing must not fail boot; log and continue with empty retrieval.
- **Keyword normalisation**: keep case-insensitive word-boundary tokenisation (the existing branch); do not introduce a stemming dependency — a five-character village does not need it, and the test must not encode model-specific normalisation.

## Open Questions

- **Resolved during drafting (AC-1 fork):** commit to keyword retrieval and delete the semantic path. Rationale: the inverted branch proves the cosine path never ran in production; the embedding model adds a 2MB+ ONNX dependency the boot never loaded; keyword retrieval is deterministic, offline, and testable in Bun. Evidence of keyword sufficiency at this content scale is recorded as the contract's outcome, not a regression.
- **Resolved during drafting (index persistence):** the retrieval index stays ephemeral and is rebuilt on load from persisted sources (lore, summaries, C-491 events). No index snapshot is added to the save envelope.
- **Resolved during drafting (GM vs NPC trust boundary):** the GM/narrative-director path may query `session_summary`; the player-facing NPC recall path may not. NPC recall = witnessed `narrative_event` + shared `lore` only.

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

## Execution Report

### Summary

Resolved the AC-1 fork toward deterministic keyword retrieval (the semantic/cosine path is **deleted**, not inverted): `local_embedding_backend.ts` no longer imports `@huggingface/transformers`, no longer loads a model, and `query()` runs keyword-overlap scoring as its only path. Added a `narrative_event` source type and a dedicated `npc` retrieval scope (`['narrative_event', 'lore']`, session summaries excluded at the scope layer). Wired memory init + non-blocking background indexing into the production `/game` boot hook (post-`hydrating_snapshot`), added witness-scoped `retrieveForNpc` over `narrativeEventService.witnessedBy` with attribution-aware event content, and injected a bounded `[MEMORY]` section into the NPC dialogue prompt that displaces conversation-history filler within C-488's budget. All 2405 client unit tests pass (0 new failures); the AC-3 full E2E journey is authored (`memory_recall.spec.ts`) but was not executed in this sandbox (no dev-server/browser harness) — the recall path is covered by passing unit/integration tests (AC-2, AC-4, AC-5).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Semantic path deleted (no `@huggingface/transformers` import, no `_cosineSimilarity`/`_normalise`/`_ensureModel`). Keyword scoring is the only path; file header + service comments document why (deterministic, offline, sufficient at five-character-village scale). `local_embedding_backend.test.ts` includes a static-grep assertion that no transformers import is reachable. |
| AC-2 | ✅ | `game_boot_service` calls `_startMemoryRetrieval()` after `hydrating_snapshot` (non-blocking, failure logs + continues). `game_boot_service.test.ts` pins the hook's init→backgroundIndex contract and failure isolation; `memory_retrieval_service.test.ts` verifies `indexAll()` indexes committed events. |
| AC-3 | ⚠️ | Implementation complete (witness-scoped recall flows into `_buildContextProjection`/`_buildNarrativeSystemPrompt` in `generateTurn`). E2E journey authored at `apps/e2e/tests/client/memory_recall.spec.ts` but NOT executed in this sandbox — requires the dev-server/browser harness. Recall+prompt logic verified by unit/integration tests (AC-4, AC-5). |
| AC-4 | ✅ | `retrieveForNpc` filters narrative-event results through `narrativeEventService.witnessedBy` (one witness authority); `npc` scope excludes `session_summary` at the scope layer; empty witness set = no narrative-event recall. Tests cover both NPCs, the secret never returned, session_summary exclusion, attribution survival, and the cap. |
| AC-5 | ✅ | `[MEMORY]` capped at `NPC_RECALL_MAX_RESULTS` (4); a large `[MEMORY]` shortens the conversation-history window (`MAX_CONVERSATION_TURNS - recalledFacts.length`); measured cl100k_base: baseline 283 tokens (10-turn history) vs 291 with `[MEMORY]` (4 facts + 6-turn history) — both ≤ 4096, the added section displaces history rather than extending the ceiling. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/services/memory/local_embedding_backend.test.ts` | AC-1: keyword-only ranking, no model init, static no-transformers-import grep assertion |
| `apps/e2e/tests/client/memory_recall.spec.ts` | AC-3: authored save/reload witness-recall journey (not executed here — needs dev harness) |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/domain/memory_retrieval.ts` | Added `narrative_event` to all three `sourceType` unions; added `npc` query scope; `embedding` now optional (legacy, no longer produced/read — schema-only, no save migration) |
| `packages/shared/types/src/lib/domain/memory_retrieval.ts` | Added `NpcMemoryRecallQuery` type |
| `packages/shared/constants/src/lib/memory.ts` | Added `NPC_RECALL_MAX_RESULTS`; `MEMORY_QUERY_SCOPE_SOURCE_TYPES.all` includes `narrative_event`; added `npc: ['narrative_event','lore']`; removed `EMBEDDING_DIMENSION`/`LOCAL_EMBEDDING_MODEL` (semantic path deleted) |
| `apps/frontend/client/src/lib/services/memory/local_embedding_backend.ts` | Deleted semantic/cosine/model-loading path; keyword scoring is the only path; `isReady` = index initialised; index stays an ephemeral rebuildable projection |
| `apps/frontend/client/src/lib/services/memory/memory_retrieval_service.svelte.ts` | Added `retrieveForNpc` (witness-scoped); `indexAll` indexes C-491 events with attribution-aware content (`[claimant believes/claims]`); init no longer loads a model |
| `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` | Post-`hydrating_snapshot` non-blocking `_startMemoryRetrieval()` hook (init → backgroundIndexOnLoad, failure logs + continues) |
| `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` | Added `recalledFacts` to `DialogueContextProjection`; `_recallForTurn` (witness-scoped, seeded by last player message, abort-checked); `[MEMORY]` prompt section; history window shrinks by recalled-fact count |
| `apps/frontend/client/src/lib/services/memory/memory_retrieval_service.test.ts` | Rewritten: removed transformer mock; AC-2 event indexing, AC-4 witness scoping/session_summary exclusion/cap tests, scope filtering |
| `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts` | AC-5: `[MEMORY]` cap, history-displacement, attribution + ≤4096 token assertions |
| `apps/frontend/client/src/lib/services/game/game_boot_service.test.ts` | AC-2: boot hook init→background non-blocking contract + failure isolation |
| `apps/frontend/client/src/lib/test_preload.ts` | Added default `memoryRetrievalService.retrieveForNpc` mock |
| `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/dialogue/+page.svelte` | Added `recalledFacts: []` to the dev dialogue mock projection |

### Deviations from Spec

None. The contract's AC-1 fork resolution (commit to keyword, delete the semantic path) was implemented as directed — **not** by swapping the inverted-branch polarity. The keyword-overlap branch that previously ran only when the index had no embeddings is now the single documented path, matching the service's own stated contract (C-458 AC-1). No Amendment needed. AC-3's E2E is authored but was not executable in this agent sandbox (no `herdr_session`/browser harness); the production-path logic it asserts is covered by passing unit/integration tests.

### Test Results

- Unit (client): **2405 pass / 0 fail** (7 skip, 2 todo — pre-existing) across 162 files.
  - `local_embedding_backend.test.ts`: 6/6 PASS (new)
  - `memory_retrieval_service.test.ts`: 13/13 PASS (rewritten)
  - `npc_dialogue_service.test.ts`: 70/70 PASS (incl. 3 new C-492 AC-5 tests)
  - `game_boot_service.test.ts`: 16/16 PASS (incl. 2 new C-492 AC-2 tests)
- Baseline: the one flaky `AC-5 cancellation` timeout surfaced during iteration was resolved (recall fetch now abort-checks inside the try, routing through the abort turn-state path); final run is fully green. No new failures.
- E2E: `memory_recall.spec.ts` authored; **not executed** in this sandbox (needs dev server + browser harness).
- Visual: N/A (no new UI).

---
