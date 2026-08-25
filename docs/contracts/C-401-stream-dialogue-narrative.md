---
id: C-401
title: "Stream Dialogue Narrative and Collapse the Two-Call Skill-Check Flow"
source: "docs/strategy/mvp-assessment-2026-08-16.md §5.1 and §6.3 (MVP playthrough)"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/152"
  pr_number: 152
created_at: "2026-08-16"
---

# Contract C-401: Stream Dialogue Narrative and Collapse the Two-Call Skill-Check Flow

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/strategy/mvp-assessment-2026-08-16.md` §5.1, §6.3 — live MVP playthrough 2026-08-16 |
| **Target** | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts`, `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts`, and `dialogue_overlay.svelte` |
| **Priority** | P0 — highest perceived-quality-per-hour change in the repository; blocks any gameplay video |
| **Dependencies** | — (no hard dependencies; C-407 dialogue UI layout is a not-yet-drafted follow-up that lands in the same view) |
| **Status** | implemented |
| **Promotion** | `—` |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The production game does not stream NPC dialogue. Every
  conversation turn freezes the dialogue box until the full structured response
  arrives. Skill checks freeze it twice, with a dice prompt stranded between
  the two waits.

- **The comment lies.**
  `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts:795`
  states:

  > *"The gateway streams onChunk for narrative, then returns the full text +
  > parsed structured object."*

  It does not. `NpcDialogueTextGenerator` (line 96) declares:

  ```ts
  export type NpcDialogueTextGenerator = (options: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    schema?: Record<string, unknown>;
    schemaName?: string;
    signal?: AbortSignal;
  }) => Promise<{ text: string; structured?: unknown }>;
  ```

  There is no `onChunk`. The call site at line 797 passes only `messages`,
  `schema`, `schemaName`, `signal`. The comment describes an intention that was
  never wired.

- **The capability already exists.** `packages/frontend/ai-gateway`'s
  `generateText` accepts `onChunk` (`gateway_types.ts:26` and `:107`).
  `text_generation_service.svelte.ts` exposes `streamChat({ messages, onChunk,
  signal, model })` at line 43. `stream_orchestrator_service.svelte.ts:241` and
  `session_service.svelte.ts:857` both consume it. **The dev routes stream; the
  game does not.** The only view-layer consumers of `onChunk` are
  `apps/frontend/client/src/lib/views/chat/chat_view_model.dev.svelte.ts` (lines 218, 227, 318),
  `apps/frontend/client/src/lib/views/chat/chat_modes_sandbox_view_model.svelte.ts:233`, and
  `sandbox_view_model.svelte.ts:260`.

- **Skill checks double the cost.** Line 1373 —
  *"Call #2: Roll resolution — sends dice outcome to LLM for narrative."*
  Line 1404 builds a second system prompt (*"You are a game master resolving a
  dice roll outcome…"*). So a skill check is two full non-streamed round trips
  with a frozen UI between them. This is the reported "stuck when I get dice
  roll prompt".

- **Reproduction**:
  1. Configure any text provider (a local Qwen2.5-1.5B or an OpenRouter free
     model makes it unmissable).
  2. Talk to Elder Thalia. The dialogue box is empty and frozen for the full
     generation, then the complete reply appears at once.
  3. Talk to Rollo and choose "Reason with him" (`intentType: skill_check`).
     Freeze, dice prompt, freeze again.

- **Existing implementation to reuse**:
  - `text_generation_service.svelte.ts:43` `streamChat` — narrative streaming.
  - The same service's schema-constrained extraction method — envelope parsing.
  - `stream_orchestrator_service.svelte.ts` — an existing consumer to copy
    cancellation and error handling from.
  - `apps/e2e/tests/client/dev_text_stream.spec.ts` — an existing streaming E2E
    to model the new test on.

- **Known gaps**: no timeout exists on the dialogue generation path, so a
  stalled provider is indistinguishable from a slow one; there is no
  user-visible generating state.

- **Baseline tests**: `moon run e2e:test -- tests/client/dev_text_stream.spec.ts`,
  `tests/client/dialogue_fallback.spec.ts`, and
  `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts`.

## User Outcome

After this contract, a **player** talking to an NPC sees the reply begin
appearing within a second and stream in as it is generated, including on slow
local models — and a skill check shows its narrative before the dice prompt
rather than after a second silent wait.

## Success Measures

- **Time/latency target**: first visible token within **1500 ms** of the
  request on any provider that supports SSE. Total turn time is unchanged —
  this contract changes *perceived* latency, and that is the entire point.
- **Offline/degraded behavior**: a provider that does not support streaming
  falls back to a single non-streamed response with a visible generating
  indicator. A provider that stalls past the timeout surfaces an actionable
  error and offers the authored fallback turn.
- **Production journey enabled**: a 60-second gameplay video becomes possible
  to record — the explicit gate on marketing in the assessment §5.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Streaming text | `text_generation_service.svelte.ts:43` `streamChat` | **reuse** as-is |
| Structured extraction | same service, schema method | **reuse** as-is |
| Gateway `onChunk` | `packages/frontend/ai-gateway` `gateway_types.ts:26,107` | **reuse** — already supported |
| Dialogue orchestration | `npc_dialogue_service.svelte.ts:770` `_generateAiTurn` | **modify** — split into two calls |
| Text generator type | `npc_dialogue_service.svelte.ts:96` | **modify** — add `onChunk` |
| Skill-check second call | `npc_dialogue_service.svelte.ts:1373-1404` | **modify** — stream it too |
| Authored fallback turn | `npc_dialogue_service.svelte.ts:143` | **reuse** — becomes the timeout path |
| Cancellation pattern | `stream_orchestrator_service.svelte.ts` | **reuse** the pattern |

## Overview

NPC dialogue asks the model for a single structured `{narrative, command,
choices}` envelope, which cannot be streamed as prose — so the UI waits. This
contract splits the turn into a streamed narrative call and a fast
schema-constrained extraction call, threads `onChunk` through
`NpcDialogueTextGenerator` to the view, applies the same treatment to the
skill-check resolution call, and adds the timeout and generating states the
path currently lacks.

## Design Reference

**The design decision, and why.** A `{narrative, command, choices}` envelope
cannot be naively streamed — tokens arrive as JSON, not prose. Two approaches
were considered:

- **(a) Partial-JSON streaming.** Stream the structured response and
  incrementally parse the `narrative` field. Keeps one call. Requires a
  tolerant partial-JSON reader and depends on the model emitting `narrative`
  before `command` and `choices` — influenceable via schema property order but
  not guaranteed by any provider.
- **(b) Two-call split.** Call 1 streams plain narrative prose with no schema.
  Call 2 extracts the command envelope from the completed narrative under the
  existing TypeBox schema.

**Chosen: (b).** It is robust across every provider, it removes any dependency
on JSON field ordering, and it makes the existing skill-check second call the
general pattern rather than a special case. It maps directly onto methods that
already exist: `streamChat` for call 1, the schema extraction method for call
2. The cost is one extra short completion per turn, which is negligible against
a frozen UI — and call 2 may use a cheaper or faster model, since it is
extraction rather than authoring.

Copy cancellation and error handling from
`stream_orchestrator_service.svelte.ts`. Model the E2E on
`apps/e2e/tests/client/dev_text_stream.spec.ts`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- `NpcDialogueTextGenerator` gains an optional `onChunk`. Every call path
  supplies it; the type stays optional so authored-fallback and test doubles
  need not.
- **The Engine Boundary is unaffected.** Dialogue is a Svelte-side UI concern
  and never crosses `EngineBridge` per token. Streaming tokens must not be
  emitted as `GameEvent`s (directive #6, and `limitations.md` — bridge events
  are UI-relevant intervals, not per-token).
- Streaming updates the dialogue text through a **single** `$state` binding
  updated on a batched cadence, not one rune write per token. High-frequency
  writes risk `ERR_SVELTE_TOO_MANY_UPDATES` (see `limitations.md` §Svelte
  update threshold).
- **AI proposes, rules decide** (directive #2) is unchanged: call 2 still
  produces the typed command envelope, and all existing precondition and
  permission checks (`_validateCommandPreconditions`) run untouched on its
  output. Streaming narrative must never bypass command validation.
- Every generation path gets a timeout. A stalled provider must be
  distinguishable from a slow one.
- The authored fallback (`npc_dialogue_service.svelte.ts:143`) becomes the
  declared recovery for timeout and malformed-envelope cases — resilience, not
  a selectable mode (directive #4).

## State & Data Models

```ts
/** Text generation callback — now streaming-capable. */
type NpcDialogueTextGenerator = (options: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  schema?: Record<string, unknown>;
  schemaName?: string;
  signal?: AbortSignal;
  /** Called with each narrative token as it arrives. Absent for
   *  non-streaming callers (authored fallback, test doubles). */
  onChunk?: (text: string) => void;
}) => Promise<{ text: string; structured?: unknown }>;

/** UI-visible state of a dialogue turn. Drives the generating indicator,
 *  the streamed text, and the error affordance. */
type DialogueTurnState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'streaming'; readonly text: string }
  | { readonly kind: 'awaiting_envelope'; readonly text: string }
  | { readonly kind: 'complete'; readonly text: string }
  | {
      readonly kind: 'failed';
      readonly reason: 'timeout' | 'aborted' | 'provider_error' | 'malformed';
      readonly fallbackOffered: boolean;
    };
```

No persisted schema changes. `NpcDialogueAiEnvelopeSchema` is unchanged — it
now constrains call 2 instead of the single combined call.

## Quality Requirements

- **Offline/degraded mode**: local models are the primary target; they are the
  slowest and benefit most. Non-streaming providers degrade to a single
  response plus a generating indicator.
- **Accessibility/input**: the streaming region must be an ARIA live region
  (`aria-live="polite"`) so screen readers announce the reply once it settles,
  not per token. The generating state must be conveyed non-visually.
- **Performance budget**: token updates batched to at most one `$state` write
  per animation frame. Zero impact on the 60fps engine loop — dialogue does not
  touch the render path.
- **Security/privacy**: unchanged; no new data leaves the device beyond the
  existing provider calls. Note that the two-call split sends the narrative
  back to the provider a second time for extraction — acceptable, since it is
  the same provider that just authored it, but it must not be sent to a
  *different* provider than the one the user configured.
- **Persistence/migration**: N/A — no persistent state changes. Chat history
  stores the completed narrative, not the token stream.
- **Cancellation/retry/idempotency**: `End Chat` mid-generation must abort both
  calls via the existing `signal`. Aborting must not write a partial turn to
  history and must not surface an error toast.
- **Observability**: log time-to-first-token, total turn time, and which call
  (1 or 2) failed. These are the numbers that prove the Success Measures.

## Migration & Rollback

N/A — no persistent state changes. Rollback is a revert; chat history written
under the new path is shape-identical to history written under the old one.

## Scope Boundaries

- **In Scope:**
  - `onChunk` on `NpcDialogueTextGenerator` and every call path to it.
  - Two-call split of `_generateAiTurn` (line 770).
  - The same treatment for the skill-check resolution call (line 1373).
  - Token-by-token reveal in the dialogue view with a generating indicator.
  - Timeout with an actionable error state and the authored-fallback offer.
  - Abort-on-`End Chat` verified end to end.
  - Time-to-first-token instrumentation.
  - Correcting the false comment at line 795.

- **Out of Scope:**
  - Prompt content and context-window tuning (`_buildSystemPrompt`, the
    20-turn window at line 782).
  - Combat narration — a separate generation path.
  - Provider failover and model routing.
  - Vendor/merchant haggle chat — that surface is **C-416**.
  - Dialogue UI layout, portraits, and choice-row overflow — that is **C-407**,
    which follows this contract in the same view.
  - TTS behaviour.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** not split. The plain turn and the skill-check turn share
one generator type, one streaming mechanism, and one cancellation path.
Streaming only the plain turn would leave the skill-check path — the worst
offender, at two blocking calls — untouched while the type signature had
already changed, which is precisely the "two competing code paths left live"
condition.

## Acceptance Criteria

### AC-1: Narrative streams into the dialogue box
**Given** a configured text provider that supports SSE
**When** an NPC dialogue turn generates
**Then** the first token renders within 1500 ms and text grows incrementally
until the turn completes

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E | `apps/e2e/tests/client/dialogue_streaming.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/dialogue_streaming.spec.ts`
- Integration: talk to Elder Thalia against a local llama.cpp instance and
  watch the text build.
- E2E / Visual:
    - **Functional**: new spec `tests/client/dialogue_streaming.spec.ts`.
      Sample the dialogue text node across at least three polls and assert
      strictly increasing length before completion. Model on
      `dev_text_stream.spec.ts`. Extend the existing dialogue helpers on the
      GamePage POM (`apps/e2e/src/pom/game_page.ts` — `expectDialogueVisible`,
      `sendMessage`, `selectDialogueChoice`, `skipDialogue`) or add a dedicated
      `dialogue_page.ts`; do not duplicate helpers that already exist.
    - **Visual**: N/A — motion over time is not a still-frame assertion.

**Watch Points**:
- A fast provider can complete before three polls. Use a stubbed slow provider
  in the E2E rather than a real one, or the test is flaky by construction.

### AC-2: Skill-check narrative precedes the dice prompt
**Given** a dialogue choice with `intentType: skill_check` (e.g. Rollo's
"Reason with him")
**When** the check is triggered
**Then** the narrative for the check is fully streamed and visible **before**
the dice prompt appears, and the resolution narrative streams after the roll

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | E2E | `apps/e2e/tests/client/dialogue_streaming.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/dialogue_streaming.spec.ts`
- Integration: trigger Rollo's persuade and intimidate options manually.
- E2E / Visual: **Functional**: assert ordering — narrative text non-empty
  before the dice panel is visible. **Visual**: N/A.

**Watch Points**:
- Resolved: the dialogue overlay renders the unified `GameDice` component
  (`game_dice.svelte`) via `viewModel.diceState` (`dialogue_overlay.svelte:72`);
  `dice_roll_panel.svelte` is the chat-route panel and is not on the dialogue
  path. Write selectors against GameDice.

### AC-3: Abort on End Chat is clean
**Given** a turn is mid-generation
**When** the player presses `End Chat`
**Then** generation aborts, no further tokens render, no partial turn is
written to history, and no error is surfaced

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | E2E | `apps/e2e/tests/client/dialogue_streaming.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/dialogue_streaming.spec.ts`
- Integration: abort mid-stream, reopen the conversation, confirm history is
  intact and contains no truncated turn.
- E2E / Visual: **Functional**: assert no error toast and stable text after
  abort. **Visual**: N/A.

**Watch Points**:
- `signal` is already threaded through `_generateAiTurn`. Verify it actually
  reaches the adapter's `fetch` — an unused `AbortSignal` is a silent no-op.
- Abort must cancel **both** calls. Aborting during call 2 is the easy case to
  miss.
- Today's abort path replaces the placeholder with a `[Generation cancelled]`
  message (`dialogue_overlay_view_model.svelte.ts`,
  `_delegateGenerateResponse` catch block). AC-3 requires that no partial turn
  persists — either remove the placeholder message entirely on abort or mark
  it non-persisting; do not keep writing it into `messages`.

### AC-4: Timeout surfaces an actionable error and the authored fallback
**Given** a provider that never responds
**When** the timeout elapses
**Then** an actionable error renders naming the provider, and the authored
fallback turn is offered

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: inject a generator that never resolves; assert the state machine
  reaches `failed` with `reason: 'timeout'` and `fallbackOffered: true`.
- E2E / Visual: **Functional**: extend
  `tests/client/dialogue_fallback.spec.ts`. **Visual**: N/A.

**Watch Points**:
- The timeout must be generous enough for a CPU-bound local model on a slow
  machine. A value that fires during normal local play is worse than no
  timeout. Pick it from measured local-model latency, and make it configurable.

### AC-5: Time-to-first-token is instrumented
**Given** any completed dialogue turn
**When** the turn finishes
**Then** time-to-first-token and total turn time are logged, with the call
index recorded on failure

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: confirm the numbers appear in the browser console during manual
  play.
- E2E / Visual: N/A.

**Watch Points**:
- These measurements are the evidence for the 1500 ms Success Measure. Without
  them AC-1 can only be asserted qualitatively.

### AC-6: Non-streaming provider falls back to a single response
**Given** a configured text provider that does not support SSE streaming
**When** an NPC dialogue turn generates
**Then** a single non-streamed response renders with a visible generating
indicator, and no token-by-token growth occurs

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: configure a provider without SSE (or stub a generator that
  never invokes `onChunk`); assert the turn completes in one step and the
  generating indicator was visible during the wait.
- E2E / Visual: **Functional**: N/A — covered at unit level; the E2E suite
  runs against a stubbed slow SSE provider. **Visual**: N/A.

**Watch Points**:
- The generating indicator must stay visible for the whole non-streamed wait —
  this is the degraded-mode contract from the Success Measures.
- `DialogueTurnState` must not enter `streaming` when no `onChunk` is supplied.

### AC-7: Call-2 failure degrades to narrative-only, never discards streamed text
**Given** a turn whose narrative call (call 1) streamed successfully
**When** the envelope extraction call (call 2) fails or returns a malformed
envelope
**Then** the turn completes with the already-streamed narrative and
`_deriveChoices`-derived choices — no error surface, no authored-fallback
replacement of the player-visible text

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: inject a generator that resolves call 1 but throws or returns
  malformed output on call 2; assert the returned turn keeps the streamed
  narrative and contains derived (non-empty) choices.
- E2E / Visual: **Functional**: N/A — unit level. **Visual**: N/A.

**Watch Points**:
- This is the double-failure-surface guard from Edge Cases. Never discard
  `streaming` text already rendered to the player when call 2 fails.
- `_validateCommandPreconditions` must not run on a failed call 2 — no command
  is derived, so no command executes.

## Implementation Sequence

1. **Phase 1 (Data/Logic)** — Add `onChunk` to `NpcDialogueTextGenerator`
   (line 96). Split `_generateAiTurn` (line 770) into `_streamNarrative`
   (via `streamChat`, no schema) and `_extractEnvelope` (schema-constrained,
   non-streamed, operating on the completed narrative). Keep
   `_parseEnvelope`, `_filterChoices`, `_deriveChoices`, and
   `_validateCommandPreconditions` on the call-2 output, unchanged. Add the
   `DialogueTurnState` machine and the timeout.
2. **Phase 2 (Integration)** — Apply the same split to the skill-check
   resolution call (line 1373). Wire `onChunk` to the dialogue view with a
   frame-batched `$state` write. Add the generating indicator, the ARIA live
   region, and the error affordance. Verify `signal` reaches the adapter.
   Correct the stale comment at line 795.
3. **Phase 3 (Validation)** — Add `tests/client/dialogue_streaming.spec.ts`
   with the dialogue POM. Extend `dialogue_fallback.spec.ts` for the timeout
   path. Run `moon run client:test-unit`, `moon run e2e:test`, and
   `bun run typecheck`. Measure time-to-first-token against a real local model
   and record it in the Execution Report.

## Edge Cases & Gotchas

- **Two calls double the failure surface.** Call 1 succeeding and call 2
  failing must still show the player the narrative they already read — degrade
  to narrative-only with derived choices (`_deriveChoices` already exists),
  never discard streamed text.
- **Token batching vs. `ERR_SVELTE_TOO_MANY_UPDATES`.** `limitations.md`
  documents this failure mode explicitly. Batch to one write per frame.
- **The 20-turn window** (line 782) applies to call 1. Call 2 should receive
  only the narrative it is extracting from, not the full history — sending the
  window twice doubles token cost for no benefit.
- **Structured-output support varies.** The schema path already falls back to
  system-prompt extraction for providers lacking native `response_format`.
  Confirm that fallback still works when call 2 is separated from call 1.
- **Cost accounting.** Two calls per turn will surface in BYOK users' bills.
  Worth a line in the settings UI eventually; out of scope here, but do not
  let call 2 use an expensive model by default.
- **`onChunk` on the authored fallback path.** The fallback turn is synchronous
  and has no tokens. It must not be made to fake streaming — a fallback that
  pretends to stream is harder to debug than one that appears at once.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1** — Should call 2 use the same model as call 1, or a configurable
  cheaper/faster one? Affects the settings surface and BYOK cost. **Default
  recommendation: same model**, with the split recorded so a future contract
  can add routing without touching call sites.
- **OQ-2** — What is the timeout value? Must be derived from measured
  local-model latency on a CPU-only machine, not guessed. Measure before
  approving.
- **OQ-3** — Does any current provider adapter fail to honour `signal`?
  AC-3 assumes abort propagates. Verify across the OpenAI-compatible adapter
  and at least one other before implementation.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-16 | Initial draft from `mvp-assessment-2026-08-16.md` §5.1/§6.3. Approach (b), the two-call split, chosen over partial-JSON streaming — rationale recorded in Design Reference. | — |
| 2.0.0 | 2026-08-16 | Critic pass: corrected stale dev view-model paths in Baseline Evidence (`views/chat/chat_view_model.dev.svelte.ts`, `views/chat/chat_modes_sandbox_view_model.svelte.ts`); named the dialogue view files in Target; resolved the AC-2 dice-panel ambiguity (dialogue renders `game_dice.svelte`, not `dice_roll_panel.svelte`); flagged today's `[Generation cancelled]` abort behavior against AC-3; added AC-6 (non-streaming fallback) and AC-7 (call-2 failure degrade) so the Success Measures/Edge Cases each have an observable criterion; clarified the E2E POM approach against the existing GamePage dialogue helpers. | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** — production route plus E2E. Visual assessment is not
meaningful for a temporal behaviour, so `release_verified` is not the bar here.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
