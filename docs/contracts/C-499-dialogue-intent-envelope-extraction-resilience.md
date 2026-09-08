---
id: C-499
title: "Dialogue Intent Envelope Extraction Resilience"
source: "direct"
contract_type: thin
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/276"
  pr_number: 276
created_at: "2026-09-08T13:50:28Z"
---

# Contract C-499: Dialogue Intent Envelope Extraction Resilience

## Metadata

| Field | Value |
|---|---|
| **Source** | `tmp/TODO.md` — "Trying to initiate combat I get No JSON object found in response" |
| **Target** | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` + `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` + `packages/frontend/ai-gateway/src/lib/` — intent-envelope extraction + structured-output fallback |
| **Type** | thin |
| **Priority** | P0 — blocks combat initiation and fails whole dialogue turns on a recoverable parse condition |
| **Dependencies** | none |
| **Status** | draft |
| **Promotion** | `integrated` — production route `/game` |
| **Docs Impact** | none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` (dialogue → combat) |

## Problem & Baseline Evidence

- **Current behavior**: Dialogue turn 2 ("intent envelope" extraction) is fatal when the model returns a body that contains no JSON object. The turn fails entirely (`analyzeIntent:failed`) even though turn 1 — the NPC's streamed narrative — already succeeded and was displayed to the player.
- **Reproduction** (from `tmp/TODO.md` logs): start a dialogue, tap a combat chip against an NPC. Observed log sequence:
  - `[AiGatewayService] textAdapter:done` → `chunkCount: 0`
  - `[AiGatewayService] textAdapter:structured-fallback` → `reason: "Error: No JSON object found in response"`
  - `[AiGatewayService] textAdapter:fetch-ok` → `status: 200, stream: true`
  - `[AiGatewayService] textAdapter:done` → `chunkCount: 0` (fallback also empty)
  - `[TextGenerationService] extractStructure:failed` → `AiGatewayException: No JSON object found in response`
  - `[NpcDialogueService] dialogue:call-failed` → `path: "intent-envelope", call: 2, reason: "provider_error"`
  - `[NpcDialogueService] _analyzeIntent:call2-failed` → `detail: "No JSON object found in response"`
- **Existing implementation to reuse**:
  - `npc_dialogue_service.svelte.ts` `_analyzeIntent` (~L1652) — call 2 extracts the envelope; there is already a repair path `recoverIntentAnalysisOutput(...)` (~L1693), but it is only reachable when `rawOutput` is present-but-invalid, **not** when `_extractEnvelope` throws. The throw at ~L1676 makes call-2 failure fatal.
  - `text_generation_service.svelte.ts` `extractStructure` (~L175) — delegates to `aiGatewayService.generateText({ schema, schemaName })`.
  - `packages/frontend/ai-gateway/src/lib/text_adapter_openai_compatible.ts` structured path (~L315) — native `response_format: json_schema`; on parse failure falls back to `generatePlain` then `parseStructured`.
  - `packages/frontend/ai-gateway/src/lib/structured.ts` `sanitizeJsonResponse` (~L116) — throws `'No JSON object found in response'` when no `{`/`[` present.
- **Known gaps**:
  1. Call-2 failure aborts the turn; the authoritative streamed narrative is discarded from the player's perspective.
  2. An empty 200 body (`chunkCount: 0`) is treated the same as a schema-validation failure — no retry for a transient empty completion.
  3. The repair path is dead code for the most common failure mode.
- **Baseline tests**: `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts`, `packages/frontend/ai-gateway/src/**/*.test.ts`. Run before starting.

## User Outcome

After this contract, a player can initiate dialogue and combat even when the local/byok model returns an empty or non-JSON envelope — the turn degrades gracefully to recovered chips and the streamed narrative instead of erroring out.

## Scope Boundaries

- **In Scope:**
  - Make `_analyzeIntent` call-2 failure non-fatal: fall back to `recoverIntentAnalysisOutput` from the streamed narrative.
  - Add one bounded retry (with backoff) for empty-content structured completions in the ai-gateway structured path.
  - Distinguish `empty response` (retryable) from `non-empty non-JSON` (fall back to plain, then repair).
  - Keep `analyzeIntent:failed` logging with detail, but only after retries/repair are exhausted.
- **Out of Scope:**
  - Combat UI rendering / engine stall (C-500).
  - Changing the `NpcIntentAnalysisOutput` schema.
  - TTS, slash commands, model/prompt re-engineering beyond the empty-retry fix.
  - `recoverIntentAnalysisOutput` logic rewrite — reuse it, don't redesign it.

## Acceptance Criteria

### AC-1: Envelope failure does not fail the turn
**Given** a dialogue turn where call 1 (narrative) streamed successfully and call 2 (`intent-envelope`) throws `No JSON object found in response`
**When** retries are exhausted
**Then** the turn completes using `recoverIntentAnalysisOutput` on the streamed narrative (`requiresRoll: false`, recovered `suggestedChips`), and the player still sees the narrative plus chips — including the combat chip that can start combat.
**Verification**: production route `/game` — talk to an NPC with a combat chip and confirm the turn resolves; unit test in `npc_dialogue_service.test.ts` for the throw path.

### AC-2: Empty completion is retried once
**Given** a structured extraction request
**When** the provider returns `200` with an empty body (`chunkCount: 0`)
**Then** the adapter retries once with backoff before declaring failure.
**Verification**: unit test in `packages/frontend/ai-gateway` covering the empty-body → retry → success path.

### AC-3: No stuck or silent turn
**Given** call 2 ultimately fails after retry and repair
**When** the turn ends
**Then** the UI never leaves the player on an endless "..." state — either the recovered chips render, or an explicit error state with a retry affordance is shown, and `analyzeIntent:failed` carries the real detail.
**Verification**: production route `/game` degraded-path check.

## Edge Cases & Gotchas

- **Empty body is not the same as bad JSON**: an empty 200 from `openrouter/free` is transient; retry it. Non-empty prose with no JSON object should go to the repair path, not retry forever.
- **Do not double-append narrative**: the repair path already reuses the streamed text — make sure the player does not see the narrative twice.
- **Abort semantics**: keep `_checkAbort` / cancellation handling intact; a user-cancelled turn must still abort, not be swallowed by repair.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
