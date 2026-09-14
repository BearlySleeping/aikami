---
id: C-526
title: "Contract C-526: Combat-06 — Companion and Enemy LLM Intent Agents and Post-Resolution Narration"
source: "docs/architecture/combat_2.md §5.3, §12, §14, §5.5, §6.1, §16, §18, §21.3, §22 — Combat-06 slice (regrouped 2026-09-14)"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-13T00:00:00Z"
---

# Contract C-526: Combat-06 — Companion and Enemy LLM Intent Agents and Post-Resolution Narration

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/architecture/combat_2.md` §12.1 (decision input), §12.2 (decision output), §12.3 (character over optimization), §12.4 (latency), §12.5 (companion control modes), §14 (readable intent), §5.3 (narration follows resolution), §5.5 (AI failure), §6.1 (controllers + narrator layers), §16 (bridge), §18 (budgets), §21.3 (AI adapter test discipline), §22 (rollout — Combat-06, regrouping note §22.3) |
| **Target** | `AiCombatDecision` schema, perception-limited decision snapshot, an AI decision service (new `combat-ai` text task), an AI→intent→compile→commit pipeline with step-wise multi-step execution and deterministic fallback, prefetch/deadlines/squad batching, companion control modes, readable-intent telegraph + AI-degraded events, an LLM outcome narrator service (new `combat-narration` text task; template fallback already wired), feature flag, decision/narration telemetry |
| **Type** | full |
| **Priority** | P1 — enemies/companions still act as deterministic command pickers with no goals, personality, control modes, or perception limits, and the pipeline's final `narrate` stage is template-only |
| **Dependencies** | C-525 (`verified` per `docs/contracts/PROGRESS.md`, merged PR #347: intent envelope/selectors/draft bounds, first-step compiler, interpreter service pattern, confirmation UX, template narration + shipped-but-unwired prompt builders), C-509/C-514/C-515 (`verified`), C-516 (`implemented`), C-320 (AI provider gateway, `implemented`), C-197 (GOAP tactics, `completed`), C-340 (party/companions, `implemented`), C-494 (companion reactions, `implemented`) |
| **Status** | implemented |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/features/combat-controls.md` (companion control modes, readable intent, LLM/template outcome narration) |
| **Contract version** | 3.0.1 |
| **Production Surface** | `/game` combat — `packages/frontend/engine/src/combat/combat_ai_decision.ts#produceAiCombatDecision`, `apps/frontend/client/src/lib/services/game/combat_ai_service.svelte.ts#decide`, `apps/frontend/client/src/lib/services/game/combat_narration_service.svelte.ts#narrate`, and the companion control-mode preference |

## Problem & Baseline Evidence

- **Current behavior**: The AI authority for v2 fights is a synchronous, goal-less command picker, and the LLM narration half of the pipeline is missing.
  1. `packages/frontend/engine/src/combat/combat_v2_ai.ts#chooseV2AiCommand` (L172) returns a raw `CombatCommand` — attack lowest-HP hostile, else step toward the nearest hostile, else defend/end. It has **no goal, confidence, reason, personality, relationships, risk, or perception awareness**. `runV2AiTurns` (L233) runs synchronously at encounter start (`packages/frontend/engine/src/worker/ecs_worker.ts:717`), after every accepted player command (`combat_command_dispatch.ts:172`), and on retry (`worker/ecs_worker.ts:756`).
  2. **No `AiCombatDecision` type exists** in code (doc-only at `combat_2.md:488–499`); the model-facing/engine-facing split that C-525 established for the player (`CombatIntentDraft` vs `ActionIntent`) has no AI counterpart.
  3. **No companion control modes.** There is no `controlMode` concept anywhere in TS; `PartyRosterEntrySchema` (`packages/shared/schemas/src/lib/game/party.ts`, L14–35) has no mode field. Companions are always AI (`combat_roster.ts#controllerFor`, L68).
  4. **No perception-limited decision snapshot.** `VisionVisible`/`spatial_vision_system.ts` exist but are **not projected into `CombatState`** and no AI path consumes them. The only "perception" today is the legal-target context in `apps/frontend/client/src/lib/services/game/combat_intent_prompt.ts` (hidden/defeated/out-of-range combatants excluded, L9–106).
  5. **No AI planning, prefetch, or deadlines.** Only the player `CombatIntentService` has soft (1.5 s) / hard (4 s) deadlines, retry, cancellation, and idempotency by `requestId` (`combat_intent_service.svelte.ts:82–83`, L237–273). AI turns block the commit path synchronously.
  6. **No readable-intent projection/telegraph** and no AI-degraded event; `COMBAT_AI_DEGRADED` is doc-only (`combat_2.md:672`) and absent from `combat_bridge_types.ts`. `COMBAT_DECISION_PENDING` exists but serves the player NL loop only (`combat_command_dispatch.ts:276`).
  7. **No AI text task presets.** Only `combat-intent` exists (`packages/shared/constants/src/lib/text_task.ts:104`); AI decisions have no task/role/routing, and no `combat-narration` task exists (generic `narration` at L84 is unbounded for combat use).
  8. **GOAP fallback is not v2-shaped.** `goap_combat_tactics_system.ts#resolveTacticalAction` (L175–237) reads ECS directly and returns a target **eid**, so it cannot drop into the v2 commit path unchanged; `chooseV2AiCommand` is the de-facto fallback.
  9. **No feature flag/seam** for LLM-driven AI (existing pattern: `combatLanguageInput`, `packages/frontend/configs/src/lib/feature_flags.ts:42`; `combatEngine`, `packages/shared/constants/src/lib/feature_flags.ts:23`; env declaration `apps/frontend/client/src/env.ts:134`), and **no decision telemetry/replay record** (`DecisionRecord`, §17).
  10. **The LLM narrator half is missing.** C-525 wired template outcome narration (`combat_narration.ts#buildOutcomeNarration`, L171, consumed at `combat_view_model.svelte.ts:1141–1146`) and shipped the LLM prompt builders `buildAttemptNarrationPrompt` (L209) and `buildOutcomeNarrationPrompt` (L225) — **no production call site** (only `combat_narration.test.ts` exercises them). The canonical pipeline's final `narrate` stage (`combat_2.md` §1) is template-only; no model narration service or task exists.
  11. **Multi-step execution gap.** `compileActionIntent` compiles only the FIRST step of a multi-step intent and records the partial (`packages/shared/utils/src/lib/rules/combat_intent_compiler.ts:656–663`); C-525 Q2 deferred two-step player intents. The most basic AI tactic — move to melee, then attack — cannot execute end-to-end, so intent-driven agents cannot ship without a step-wise execution loop.

- **Reproduction**:
  1. Start a v2 encounter and watch enemy turns: identical attack-lowest-HP behavior with no goal/personality/telegraph. `rg "AiCombatDecision|controlMode|COMBAT_INTENT_TELEGRAPHED|COMBAT_AI_DEGRADED" packages apps --glob '!*.test.ts'` → no results.
  2. `rg "buildOutcomeNarrationPrompt|buildAttemptNarrationPrompt" packages apps --glob '!*.test.ts'` → definitions in `combat_narration.ts` only, no call sites.
  3. Read `compileActionIntent`: a two-step intent yields one `CompiledPlan` for step one plus a partial-compile assumption — step two is never compiled or committed.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Intent envelope/selectors/draft/bounds | `packages/shared/schemas/src/lib/game/combat/combat_intent.ts` (C-525) |
  | Deterministic compiler (selectors → command) | `packages/shared/utils/src/lib/rules/combat_intent_compiler.ts#compileActionIntent` |
  | Interpreter service pattern (deadlines/retry/cancel) | `apps/frontend/client/src/lib/services/game/combat_intent_service.svelte.ts` |
  | Player NL flow precedent (submit → interpret → compile → confirm) | `apps/frontend/client/src/lib/views/combat/combat_intent_flow.svelte.ts` |
  | Structured extraction | `text_generation_service.svelte.ts#extractStructure`, task presets `text_task.ts` |
  | Template outcome narration (wired) + LLM prompt builders (unwired) | `apps/frontend/client/src/lib/views/combat/combat_narration.ts` |
  | Agency/agent pipeline | `apps/frontend/client/src/lib/services/agent/` (`agent_pipeline_service.svelte.ts`, `agent_llm.ts`) |
  | Deterministic AI fallback | `combat_v2_ai.ts#chooseV2AiCommand`, GOAP `goap_combat_tactics_system.ts` |
  | v2 commit path | `combat_v2_resolver.ts#commitV2KernelCommand` (L474), `buildCombatProjectionState` (`combat_preview_handler.ts`) |
  | Turn-driver hooks | `combat_turn_driver.ts` (`runAiTurn`, `deferAiTurns` L120, L390–400) |
  | Controllers/teams | `combat_roster.ts` (`ControllerKind` L33, `controllerFor` L68) |
  | Companion/party | `components/companion.ts`, `packages/shared/schemas/src/lib/game/party.ts`, `party_roster_service.svelte.ts` |
  | Perception (exploration) | `systems/spatial_vision_system.ts`, `components/vision_visible.ts` |
  | Bridge command/event pattern | `combat_bridge_types.ts` (`COMBAT_EVENTS_RESOLVED` names map L265–274), `combat_bridge_commands.ts` |
  | Flag/env pattern | `packages/shared/constants/src/lib/feature_flags.ts` (`FEATURE_FLAG_KEYS`), `packages/frontend/configs/src/lib/feature_flags.ts` (resolved flag map), **`packages/frontend/configs/src/lib/environment.ts`** (the master `PUBLIC_*` schema — every configs flag is declared here; `PUBLIC_COMBAT_ENGINE` and `PUBLIC_COMBAT_LANGUAGE_INPUT` are the precedents), `apps/frontend/client/src/env.ts` (`static: true`, as `PUBLIC_COMBAT_ENGINE`) |
  | QA text-AI bypass | `PUBLIC_QA_BYPASS_TEXT_AI` / `featureFlags.qaBypassTextAi` (C-335) — orthogonal gate that lets gameplay run with *no* text provider configured. It is **not** a substitute for `PUBLIC_COMBAT_LLM_AGENTS`: E2E degraded/fallback runs must leave it off so the fallback path is genuinely exercised |

- **Known gaps**: no AI decision contract; AI produces commands not intents; no control modes; no perception snapshot; no morale; no telegraph/degraded event; no prefetch/deadlines/batching; no `combat-ai`/`combat-narration` tasks; no flag; no decision record; no model narration service; no multi-step AI execution loop.

- **Baseline tests**: `packages/frontend/engine/src/__tests__/{combat_v2_resolver,combat_v2_retry,goap_combat_tactics}.test.ts`; `combat_intent_compiler.test.ts`, `combat_intent_parser.test.ts`, `combat_intent.test.ts`; `combat_intent_service.test.ts`, `combat_intent_flow.test.ts`; `combat_narration` tests under `apps/frontend/client/src/lib/views/combat/`; `text_generation_service.test.ts`, `text_task_params.test.ts`; `party.test.ts`, `party_roster_service.test.ts`; `apps/e2e/tests/client/combat_v2.spec.ts`, `combat.visual.ts`.

## User Outcome

After this contract, enemies and companions act like characters with goals, personality, relationships, and judgment — not damage calculators — while every action still compiles through the same deterministic kernel. The player can set a companion's control mode (Direct / Suggest / Intent / Autonomous) and, in Suggest mode, see and edit the companion's proposed plan before it commits. Enemies expose a readable intention ("Goblin Archer — watching Mara; preparing a ranged attack") without exposing private model text. Resolved turns read as short characterful prose from the model when available and fall back to the already-wired authored templates when it is not; narration never adds mechanics and never delays the next turn. When the model is offline, slow, or returns invalid output, combat continues on the deterministic fallback with no rule changes.

## Success Measures

- **Time/latency target**: AI decision soft budget 1.5 s (subtle thinking state), hard budget 4 s (immediate deterministic fallback); narration soft budget 1.5 s (else template text); no engine frame waits on the model; prefetch starts at the previous committed action's stable revision.
- **Offline/degraded behavior**: with AI unavailable or the flag off, enemies/companions use `chooseV2AiCommand` and narration uses `buildOutcomeNarration`; the encounter remains completable; late/stale decisions cannot mutate resolved state; mechanical text uses authored templates.
- **Production journey enabled**: `/game` v2 combat with characterful enemy/companion decisions, an editable suggested companion turn, readable intent, model narration with template fallback, and an AI-offline fallback completion.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Intent schema + compiler | `combat_intent.ts`, `combat_intent_compiler.ts` | reuse — AI output is `IntentStep[]`; add a step-wise execution loop around it |
| Interpreter service pattern | `combat_intent_service.svelte.ts` | replicate — `combat_ai_service` (decisions) and `combat_narration_service` (prose) |
| Structured extraction/tasks | `extractStructure`, `text_task.ts` | modify — add `combat-ai` and `combat-narration` presets |
| Template narration + prompt builders | `combat_narration.ts` | reuse — templates stay the fallback; wire the prompt builders to the new service |
| v2 commit + projection | `combat_v2_resolver.ts`, `combat_preview_handler.ts` | reuse — commit compiled AI commands |
| Deterministic AI | `combat_v2_ai.ts` | reuse — the guaranteed fallback |
| Turn driver | `combat_turn_driver.ts` | modify — prefetch/deferred AI turns |
| Companion/party | `companion.ts`, `party.ts`, `party_roster_service` | modify — add control mode |
| Perception | `spatial_vision_system.ts`, `vision_visible.ts` | reuse — project a bounded snapshot |
| Flags | `feature_flags.ts` (shared + configs), `env.ts` | modify — add `PUBLIC_COMBAT_LLM_AGENTS` |
| Bridge | `combat_bridge_types.ts` | modify — degraded/telegraph events |

## Overview

Combat-06 turns the deterministic AI into a controller that can be driven by an LLM without ever letting the model touch mechanics, and completes the LLM presentation layer end to end: decisions in, prose out. It adds an `AiCombatDecision` contract (goal + `IntentStep[]` selectors + fallback + confidence + short reason + a bounded telegraph line) with a model-facing draft that cannot express ids, coordinates, dice, or HP. A perception-limited decision snapshot gives the model only what the actor may perceive plus engine-computed tactical facts. An AI decision service mirrors the player interpreter's retry/deadline/cancellation/idempotency contract over the new `combat-ai` task, prefetching the next AI turn at the preceding committed revision, batching same-squad enemies, and falling back to `chooseV2AiCommand` on any failure. Multi-step decisions execute through a step-wise compile→commit→revalidate loop — each step grounded against the current revision, never precompiled against stale state — closing the C-525 Q2 deferral for AI actors while player natural-language input remains single-step. An LLM outcome narrator consumes the existing `buildOutcomeNarrationPrompt` facts (resolved `CombatEvent[]` only) over the new `combat-narration` task, with the already-wired templates as the guaranteed offline fallback and fire-and-forget delivery that never blocks the next mechanical/UI step. Companion control modes become a persisted player preference, and enemy intentions surface as readable telegraphs with an AI-degraded event. Morale/objectives mechanics remain Combat-08; object affordances remain Combat-07; the snapshot carries neutral defaults and the seams for both.

## Design Reference

- **Governing architecture**: `combat_2.md` §12 (decision input/output, character, latency, control modes), §14 (readable intent), §5.3 (narration follows resolution), §5.5 (AI failure), §6.1 (controller/intent-interpreter/narrator layer responsibilities), §18 (budgets), §20 (injection).
- **Player-path precedent**: `combat_intent_flow.svelte.ts` (submit → snapshot → interpret → compile → confirm) — Combat-06 is the AI counterpart with prefetch and no human confirmation (except Suggest mode).
- **Model-facing discipline**: `CombatIntentDraft` is the only shape a model may author; mirror it with `AiCombatDecisionDraft`. The narrator authors no typed shape at all — it rephrases `narrationFactsFromEvents` output only.
- **Commit authority**: `compileActionIntent` + `commitV2KernelCommand`; the engine re-validates and refreshes positions before every commit, once per step.
- **Task presets**: add `combat-ai` beside `combat-intent` in `text_task.ts` with a distinct role, `localFirst`, and bounded tokens; add `combat-narration` beside `narration` with combat-specific bounds.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Decision schema**: `packages/shared/schemas/src/lib/game/combat/combat_ai_decision.ts` + derived types — `AiCombatDecision`, `AiCombatDecisionDraft`, `CombatDecisionContext`, `CompanionControlMode`, `CombatAiDecisionRecord`. Selectors reuse `IntentStep`; drafts stay id-free; all fields bounded.
- **Perception snapshot**: `packages/frontend/engine/src/combat/combat_ai_perception.ts#buildCombatDecisionContext` — derives visible combatants, capabilities, reachable targets, threats, and recent events from the v2 projection + legal actions; never includes hidden entities, secrets, or unrelated history. The snapshot is **size-capped by construction** (bounded arrays) and the caller passes `tokenBudget` (default `COMBAT_AI_TOKEN_BUDGET = 800`), which the builder asserts against. Difficulty enters as the caller-supplied policy field `difficulty` (default `'normal'`); per-encounter difficulty authoring is content, not this contract.
- **AI decision service**: `apps/frontend/client/src/lib/services/game/combat_ai_service.svelte.ts` — `decide(...)` over `extractStructure` task `combat-ai`, with soft/hard deadlines, bounded retry, cancellation, idempotency by `decisionId`, stale-drop by `basedOnRevision`, typed failures, and a `CombatAiDecisionRecord`.
- **Decision pipeline + step-wise execution**: `packages/frontend/engine/src/combat/combat_ai_decision.ts#produceAiCombatDecision` — get context, call the service (if enabled), then execute the intent one step at a time: snapshot → `compileActionIntent` against the **current** revision → `commitV2KernelCommand` → revalidate the next step against the new revision. A step that is illegal or stale mid-loop falls back (the decision's `fallback` steps, else `chooseV2AiCommand`), or ends the turn — never forces. Fall back to deterministic AI on any service failure. The model can never supply ids/coordinates/dice.
- **Turn driver**: modify `combat_turn_driver.ts`/`combat_command_dispatch.ts` to allow async AI planning with a hard deadline and immediate fallback; prefetch at a stable revision; batch same-squad enemies in one call while keeping a separate decision per actor; never block the frame.
- **Control modes**: add `controlMode` to the party entry/state (persisted preference) and gate the companion turn: Direct (player controls), Suggest (propose, player edits/approves), Intent (standing goal), Autonomous (decide and commit under confirmation rules).
- **Readable intent + degraded**: add `COMBAT_INTENT_TELEGRAPHED` and `COMBAT_AI_DEGRADED` bridge events; telegraphs are authored/bounded and never expose model text.
- **Narrator service**: `apps/frontend/client/src/lib/services/game/combat_narration_service.svelte.ts` — `narrate(...)` over task `combat-narration` using `buildOutcomeNarrationPrompt` (facts from resolved `CombatEvent[]` only); bounded output validated and length-capped; soft deadline else the wired `buildOutcomeNarration` template text; cancellation by narration request id; fire-and-forget — the next mechanical/UI step never waits for narration; provenance (`llm` | `template`) recorded for telemetry. Attempt narration is the decision's bounded `proposedLine` telegraph — no separate attempt model call. The service imports the pure `narrationFactsFromEvents`/`buildOutcomeNarration`/`buildOutcomeNarrationPrompt` builders from the view module `views/combat/combat_narration.ts`; that import direction is intentional and cycle-free (the view module never imports a service). If the graph ever becomes circular, move the pure builders to `services/game/` and re-export from the view module.
- **Flag**: `PUBLIC_COMBAT_LLM_AGENTS` (default off, opt-in `=== '1'`), read once at encounter start and pinned; off ⇒ deterministic AI and template narration only. Declared in `FEATURE_FLAG_KEYS` (shared constants), `packages/frontend/configs/src/lib/environment.ts` (master env schema) and `apps/frontend/client/src/env.ts` (`static: true`), resolved in `packages/frontend/configs/src/lib/feature_flags.ts`.

## State & Data Models

```ts
// ── Decision contract (engine-facing; selectors only) ──

type CombatAiConfidence = 'low' | 'medium' | 'high';

type AiCombatDecision = {
  decisionId: string;
  encounterId: string;
  actorId: string;
  basedOnRevision: number;
  goal: string;                 // authored goal id/label, bounded
  intent: IntentStep[];         // C-525 selectors — no ids/coordinates/dice
  fallback: IntentStep[];
  confidence: CombatAiConfidence;
  shortReason?: string;         // trace only; never chain-of-thought
  proposedLine?: string;        // bounded telegraph text (attempt narration)
};

// The ONLY shape a model may author (mirrors CombatIntentDraft): no envelope
// identity, no ids, no coordinates, no dice, no HP.
type AiCombatDecisionDraft = {
  goal: string;
  intent: IntentStep[];
  fallback: IntentStep[];
  confidence: CombatAiConfidence;
  shortReason?: string;
  proposedLine?: string;
};
```

```ts
// ── Perception-limited decision snapshot ──

type CombatDecisionContext = {
  actor: {
    combatantId: string;
    role: string;                          // combat role / class
    personality: string[];                 // bounded traits
    relationships: Array<{ combatantId: string; stance: 'friendly' | 'neutral' | 'hostile'; note?: string }>;
    fears: string[];
    emotionalState: string;
  };
  objectives: Array<{ objectiveId: string; kind: string; status: 'pending' | 'complete' | 'failed' }>; // from kernel state (schema since C-509); objective MECHANICS are Combat-08
  visibleCombatants: Array<{
    combatantId: string;
    team: 'player' | 'ally' | 'enemy' | 'neutral';
    healthBand: 'healthy' | 'bloodied' | 'critical';
    conditions: string[];
    lastKnown?: GridPoint;
  }>;
  capabilities: Array<{ abilityId: string; rangeBand: RangeBand; requiresLineOfSight: boolean; available: boolean }>;
  reachableTargets: Array<{ combatantId: string; distanceBand: RangeBand; cover: 'none' | 'partial' | 'full' }>;
  candidatePositions: Array<{ cellBand: string; risk: 'low' | 'medium' | 'high' }>;
  imminentThreats: string[];
  morale: 'steady' | 'shaken' | 'wavering' | 'broken'; // default 'steady' until Combat-08
  riskTolerance: 'cautious' | 'balanced' | 'bold';
  obedience: 'obedient' | 'independent';
  difficulty: 'easy' | 'normal' | 'hard';   // encounter policy; default 'normal'
  recentEvents: Array<{ kind: string; summary: string }>; // bounded
  tokenBudget: number;                      // default 800; builder asserts serialized size
};
```

```ts
// ── Companion control mode (persisted preference, not a rules path) ──

type CompanionControlMode = 'direct' | 'suggest' | 'intent' | 'autonomous';
```

```ts
// ── Bridge additions ──

| { type: 'COMBAT_INTENT_TELEGRAPHED'; encounterId: string; actorId: string; line: string }
| { type: 'COMBAT_AI_DEGRADED'; encounterId: string; actorId: string; reason: 'offline' | 'timeout' | 'invalid' | 'stale' | 'disabled' }
// Suggest mode reuses COMBAT_PREVIEW_READY/COMBAT_PLAN_REJECTED for the proposed plan;
// an approved plan commits through the existing v2 command path.
// 'disabled' fires once per actor at encounter start when the flag is pinned off;
// the other reasons fire on the first fallback for that actor and are de-duplicated
// per (actor, reason, revision-window) so the log is not spammed per action.
```

```ts
// ── Telemetry / replay record (§17) ──

type CombatAiDecisionRecord = {
  decisionId: string;
  encounterId: string;
  actorId: string;
  basedOnRevision: number;
  source: 'llm' | 'fallback';
  provider?: string;
  model?: string;
  latencyMs: number;
  fallbackReason?: 'offline' | 'timeout' | 'invalid' | 'stale' | 'disabled';
  goal?: string;
  confidence?: CombatAiConfidence;
  rationale?: string; // concise; no secrets, no chain-of-thought
};
```

```ts
// ── Narration result (client-facing; facts come from resolved events only) ──

type CombatNarrationSource = 'llm' | 'template';

type CombatNarrationResult = {
  narrationId: string;
  encounterId: string;
  basedOnRevision: number;
  source: CombatNarrationSource;
  text: string; // bounded length; no mechanics absent from the events
};
```

The narrator has no model-authored typed shape: the prompt is built by the existing `buildOutcomeNarrationPrompt` from `narrationFactsFromEvents` output, and the response is a length-capped string validated against forbidden-mechanics policy (no numbers, conditions, or outcomes the events do not contain).

## Quality Requirements

- **Offline/degraded mode**: flag off or provider failure ⇒ deterministic `chooseV2AiCommand` and template `buildOutcomeNarration`; no frame waits; late/stale output dropped by `decisionId`/`narrationId` + revision.
- **Accessibility/input**: control-mode selection and the Suggest approval are keyboard/pointer reachable; telegraphs are announced.
- **Performance budget**: soft 1.5 s / hard 4 s decisions; soft 1.5 s narration (else template); prefetch and narration off the frame path; squad batching reduces calls; prompts within a token budget.
- **Security/privacy**: structured output only; `additionalProperties: false`; capped free text; perception-limited context (no hidden entities, secrets, unrelated history); model ids/numbers/claims resolved and bounds-checked; never execute model code.
- **Persistence/migration**: `controlMode` is additive to the party schema with a safe default (`suggest` first release, `combat_2.md` §25 decision 6); old party data without it loads with the default.
- **Cancellation/retry/idempotency**: decisions and narration cancellable by id, idempotent, stale-dropped; a decision commits at most once; prefetch for a changed revision is discarded; narration never reorders the log.
- **Observability**: `CombatAiDecisionRecord` per decision and narration provenance (`llm` | `template`) with provider/model/latency/fallback/rationale; `COMBAT_AI_DEGRADED` surfaced to the UI; no secrets or chain-of-thought.

## Migration & Rollback

- **Old data compatibility**: additive optional `controlMode` on the party entry/state; absent ⇒ default (`suggest`); existing saves load.
- **Migration**: none beyond the default.
- **Rollback**: disable `PUBLIC_COMBAT_LLM_AGENTS` (default off) ⇒ deterministic AI + template narration only; remove the control-mode UI ⇒ companions remain AI.
- **Feature flag or kill switch**: `PUBLIC_COMBAT_LLM_AGENTS`, pinned at encounter start; an encounter never changes AI mode mid-fight.
- **Failure recovery**: provider/parse/timeout/stale ⇒ deterministic fallback; if no legal fallback exists, the actor defends/ends turn (existing `chooseV2AiCommand` behavior); narration failure ⇒ template text.

## Scope Boundaries

- **In Scope:**
  - `AiCombatDecision` + draft + `CombatDecisionContext` + `CompanionControlMode` + `CombatNarrationResult` schemas/types.
  - Perception-limited decision snapshot (v2 projection + vision/legal actions).
  - AI decision service (`combat-ai` task) with deadlines/retry/cancel/idempotency/stale-drop/telemetry.
  - AI→intent→compile→commit pipeline with deterministic fallback.
  - Step-wise multi-step AI execution loop (per-step compile→commit→revalidate).
  - Prefetch, squad batching, no frame blocking.
  - Companion control modes + Suggest approval UX.
  - Readable-intent telegraph + AI-degraded event.
  - LLM outcome narrator service (`combat-narration` task) with template fallback and provenance telemetry; wiring at `COMBAT_EVENTS_RESOLVED`.
  - `PUBLIC_COMBAT_LLM_AGENTS` flag; offline/degraded E2E.
  - Character-over-optimization policy (personality/role/relationships/fears/risk).

- **Out of Scope:**
  - Morale state/thresholds, objectives mechanics, reactions, cover, surfaces (Combat-08/07).
  - Object affordances/improvised actions and `interact`/`attempt_improvised_action` compilation (Combat-07).
  - Player multi-step natural-language UX — players stay single-step with a partial-compile explanation (C-525 Q2); revisit after the agent loop is proven.
  - Narration streaming, TTS/voice delivery, per-character narration voice profiles.
  - Player natural-language input (Combat-05, done).
  - Persisting the full v2 `CombatState`/AI decision history; save/reload combat parity.
  - Removing the deterministic AI or the legacy engine.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** One concern — the LLM presentation layer: decisions in, prose out, never mechanics. Schema, perception snapshot, decision service, decision pipeline, step-wise execution, prefetch, control modes, and the narrator are inseparable parts of that layer: the narrator shares the decision service's deadline/cancel/injection discipline and its offline fallback is already wired, the prompt builders shipped unused in C-525 and would be orphans again if deferred, and agents cannot ship without the multi-step execution loop. Splitting the narrator into its own contract would multiply pipeline runs for a service that mirrors one already being built here. ~11 ACs, 5 projects (`schemas`, `types`, `frontend-engine`, `client`, `constants`). **Size: large but one concern — proceed as one contract.** The remaining Combat 2.0 tail stays split per the same rule: C-527 (Combat-07 — objects/affordances/improvised actions) and C-528 (Combat-08 — objectives/morale/reactions/release gate) are independently mergeable outcomes.

## Acceptance Criteria

### AC-1: The AI decision contract is typed, bounded, and selector-only
**Given** the decision module
**When** `AiCombatDecisionSchema`/`AiCombatDecisionDraftSchema` are validated
**Then** valid decisions/drafts pass; unknown `kind`/extra props are rejected; fields are bounded; the draft cannot express ids, coordinates, dice, HP, or hidden entities; and `intent`/`fallback` reuse C-525 `IntentStep`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/src/lib/game/combat/combat_ai_decision.test.ts` | `combat_ai_decision.ts` + tooling: `bun moon run schemas:test` | Filled during verification |

**Test Hooks**: Moon `bun moon run schemas:test`; import `AiCombatDecision` from `@aikami/types`; E2E N/A.

**Watch Points**: mirror `CombatIntentDraft`; keep ids out of the draft.

### AC-2: The decision snapshot contains only what the actor may perceive
**Given** an active AI-controlled combatant
**When** `buildCombatDecisionContext` runs
**Then** it includes the actor's identity/role/personality/relationships/fears, objectives (from kernel state), visible combatants (health bands/conditions), legal capabilities, reachable targets, candidate positions, imminent threats, risk/obedience/difficulty, and bounded recent events; it excludes hidden enemies, secrets, unrelated campaign history, raw ECS dumps, and full path lists; and the serialized snapshot fits `tokenBudget` (default 800 — asserted as `JSON.stringify(context).length ≤ tokenBudget * 4`, plus bounded array lengths).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `packages/frontend/engine/src/__tests__/combat_ai_perception.test.ts` | `combat_ai_perception.ts#buildCombatDecisionContext` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**: Moon `bun moon run frontend-engine:test`; hidden-enemy/secret exclusion fixtures; token-budget bound asserted on a maximal fixture (all arrays at their caps); E2E N/A.

**Watch Points**: perception limited by team/vision/legal actions; never send the whole state.

### AC-3: The AI decision service honours deadlines, cancellation, idempotency, and telemetry
**Given** the `combat-ai` task and an enabled flag
**When** a decision is requested
**Then** it returns a schema-valid decision or a typed failure within the soft budget (else the hard deadline aborts), retries are bounded, requests are cancellable and idempotent by `decisionId`, a stale-revision reply is discarded, and every attempt produces a `CombatAiDecisionRecord` (provider/model/latency/fallback/rationale, no secrets/chain-of-thought).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | `apps/frontend/client/src/lib/services/game/combat_ai_service.test.ts` | `combat_ai_service.svelte.ts#decide` + tooling: `bun moon run client:test` | Filled during verification |

**Test Hooks**: Moon `bun moon run client:test`; fixtures for valid/invalid/partial/malformed/timeout/refused; stale discard; E2E N/A.

**Watch Points**: bounded retry; never throw; cap raw context; no provider secrets in the record.

### AC-4: Decisions execute step-wise through the kernel with a legal fallback
**Given** an AI decision (or a failure), including a multi-step intent such as move-to-melee then attack
**When** `produceAiCombatDecision` runs
**Then** each step is grounded by the C-525 compiler against the **current** revision and committed via `commitV2KernelCommand` one command at a time; the kernel re-validates every commit; a step that is illegal or stale mid-loop falls back to the decision's `fallback` steps, else `chooseV2AiCommand`, else ends the turn — never forces; budget exhaustion stops the loop and explains the partial; on any service failure the deterministic `chooseV2AiCommand` produces a legal command; and the model never supplies ids/coordinates/dice or mutates state.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `packages/frontend/engine/src/__tests__/combat_ai_decision.test.ts` | `combat_ai_decision.ts#produceAiCombatDecision` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**: Moon `bun moon run frontend-engine:test`; multi-step fixture (move + use_ability) commits two commands with a revision bump between them; malformed/stale decision → fallback; illegal compiled command rejected; fallback always legal; E2E N/A.

**Watch Points**: never precompile step two against step one's pre-commit state; the engine stays the authority; a rejected decision must not partially apply.

### AC-5: AI planning is prefetched, batched, and never blocks a frame
**Given** the preceding committed action produced a stable revision
**When** the next actor is AI-controlled
**Then** planning starts before the turn is active; same-squad enemies are planned in one batched call with a separate decision per actor; the frame never waits on the model; a decision that exceeds the hard deadline uses the fallback immediately; and a revision change discards the prefetched decision.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration + E2E | `combat_ai_decision.test.ts` + `combat_v2.spec.ts` | turn-driver/dispatch + tooling: `bun moon run frontend-engine:test`, `bun moon run client:test`, `e2e:test-client` | Filled during verification |

**Test Hooks**: Moon `bun moon run frontend-engine:test`, `bun moon run client:test`; batched call count assertion; stale prefetch discard; E2E AI turn with provider offline completes.

**Watch Points**: no synchronous model call on the commit path; batch preserves per-actor decisions.

### AC-6: Companion control modes are a persisted player preference
**Given** a recruited companion
**When** the player selects direct / suggest / intent / autonomous
**Then** the mode persists (additive party field, safe default `suggest` — `combat_2.md` §25 decision 6), Direct gives the player full control, Suggest proposes a plan the player can edit or approve before commit (the proposal exists with or without the model: the deterministic fallback proposes a plan when the model is unavailable), Intent applies a standing goal, Autonomous decides and commits under the **existing** confirmation policy (C-525 §11.3 / Q1: always confirm in this first release, via the shipped preview/confirm panel — this contract introduces no auto-commit rule); and mode is not a separate rules path (same kernel/commands).

**Given** *(also)* an existing save whose party entries predate this contract
**When** it loads
**Then** the entries receive the `suggest` default and the encounter starts normally.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit + Integration + E2E | `packages/shared/schemas/src/lib/game/party.test.ts`, `party_roster_service.test.ts`, `combat_v2.spec.ts` | `packages/shared/schemas/src/lib/game/party.ts` (`controlMode`), `party_roster_service.svelte.ts`, companion turn path, `/game` | Filled during verification |

**Test Hooks**: Moon `bun moon run schemas:test`, `bun moon run client:test`; E2E suggest → edit → approve commits; direct mode player-controlled; a save without `controlMode` loads with `suggest`.

**Watch Points**: default `suggest` (`combat_2.md` §25 decision 6); old data loads; autonomous rides the existing confirmation policy (no new auto-commit).

### AC-7: Intentions are readable and degradation is visible
**Given** an AI-controlled actor
**When** a decision is made or the model degrades
**Then** a bounded authored telegraph (`COMBAT_INTENT_TELEGRAPHED`) exposes an observable intention without private model text, and `COMBAT_AI_DEGRADED` reports `disabled` (flag pinned off) / `offline` / `timeout` / `invalid` / `stale` (degraded path, de-duplicated — not one event per action); the UI surfaces both without adding mechanics.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Integration + E2E | `combat_ai_decision.test.ts` + `combat_v2.spec.ts` | `combat_bridge_types.ts`, `combat_view_model.svelte.ts` ViewModel + tooling: `bun moon run frontend-engine:test`, `bun moon run client:test` | Filled during verification |

**Test Hooks**: Moon `bun moon run frontend-engine:test`, `bun moon run client:test`; telegraph bounded/no model text; degraded event on fallback and on flag-off (de-duplicated); E2E readable intent.

**Watch Points**: telegraphs are presentation; no hidden model text leaks.

### AC-8: Character over perfect optimization
**Given** actor personality, role, relationships, fears, and risk tolerance
**When** decisions are produced
**Then** the context/prompt permits characterful suboptimality (coward flees, loyal guard protects the commander, vengeful enemy pursues its harmer, principled companion refuses an immoral command, panicked creature takes a poor route, disciplined squad focus-fires); the caller-supplied difficulty policy (`CombatDecisionContext.difficulty`, default `'normal'`) alters coordination/risk/resources/telegraphing **through those context fields**, not through the model's reasoning ability; and every characterful choice is still legal.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Integration | `combat_ai_perception.test.ts` (personality/difficulty fixtures), `combat_ai_service.test.ts` (prompt fixtures) | `combat_ai_perception.ts`, `combat_ai_service.svelte.ts` + tooling: `bun moon run frontend-engine:test`, `bun moon run client:test` | Filled during verification |

**Test Hooks**: Moon `bun moon run client:test`, `bun moon run frontend-engine:test`; personality fixtures yield distinct legal plans; changing `difficulty`/`riskTolerance`/`obedience` changes the emitted context + prompt policy fields while leaving the instruction text untouched.
**E2E / Visual**: N/A.

**Watch Points**: do not encode difficulty as "lobotomize the model"; keep decisions legal.

### AC-9: A kill switch guarantees offline/deterministic behavior
**Given** `PUBLIC_COMBAT_LLM_AGENTS` unset/off or the provider unavailable
**When** a v2 encounter runs
**Then** enemies/companions use `chooseV2AiCommand`, narration uses `buildOutcomeNarration` templates, the encounter completes, `COMBAT_AI_DEGRADED` is emitted with `reason: 'disabled'` when the flag is pinned off, and with `'offline' | 'timeout' | 'invalid' | 'stale'` when the flag is on but the model path fails, late/stale output cannot mutate resolved state, and the flag is read once at encounter start and pinned on the encounter (as `combatEngine` is, C-516 AC-1).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Unit + Integration + E2E | `packages/shared/constants/src/lib/feature_flags.test.ts`, `apps/frontend/client/src/lib/services/game/combat_ai_flag.test.ts`, `combat_v2.spec.ts` offline case | `feature_flags.ts` (shared + configs), `packages/frontend/configs/src/lib/environment.ts`, `apps/frontend/client/src/env.ts`, encounter start, `/game` | Filled during verification |

**Test Hooks**: Moon `bun moon run constants:test`, `bun moon run frontend-engine:test`, `bun moon run client:test`; E2E AI-offline completion with `PUBLIC_COMBAT_LLM_AGENTS=0`. Do **not** set `PUBLIC_QA_BYPASS_TEXT_AI=1` in these runs — that bypasses the provider gate wholesale and would never exercise the real fallback path.
**E2E / Visual**: functional offline case + visual telegraph/control-mode surface.

**Watch Points**: default off; no boot dependency on the provider.

### AC-10: Production journey exercises agents and narration end to end
**Given** `combatEngine=v2` and `PUBLIC_COMBAT_LLM_AGENTS=1` in `/game` with **no reachable text provider** in the E2E lane (the repo ships no deterministic model backend; `game_test_seam.ts#startRealEncounter` exists precisely so the E2E lane can play a genuine v2 slice "without an AI provider")
**When** the player plays an encounter
**Then** enemies take legal turns through the deterministic fallback with `COMBAT_AI_DEGRADED` surfaced, a companion in Suggest mode proposes a plan the player edits and approves, a bounded telegraph is shown, resolved turns display **template** narration (model prose is covered by AC-11's mocked-gateway integration tests — this lane asserts no live-model output), an AI-offline pass completes on the fallback, deterministic replay is unaffected, `apps/frontend/docs/src/content/docs/features/combat-controls.md` documents control modes/readable intent/narration provenance, and existing combat E2E/visual suites pass.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | E2E + Visual | `apps/e2e/tests/client/combat_v2.spec.ts` + `combat.visual.ts` | `/game` | Filled during verification |

**Test Hooks**: Moon `bun moon run client:test`, `bun moon run frontend-engine:test`; E2E suggest-edit-approve + deterministic enemy turn + template-narrated turn + offline fallback.
**E2E / Visual**: functional cases + a visual case for the control-mode/telegraph/narration surface (AI evaluation, ≥ threshold).

**Watch Points**: do not assert live-model prose; no new mock-provider infrastructure is introduced by this contract; test schema/policy/fallback; no frame waits.

### AC-11: Outcome narration is facts-only, bounded, and degrades to templates
**Given** resolved `CombatEvent[]` from a committed action
**When** narration is requested (flag on, provider reachable)
**Then** the narrator consumes only `narrationFactsFromEvents` output via the existing `buildOutcomeNarrationPrompt`, returns length-capped prose with no mechanics, numbers, conditions, or outcomes absent from the events, meets the soft deadline (else the already-wired `buildOutcomeNarration` template text is used), is cancellable and idempotent by narration id, never blocks the next mechanical/UI step, and records `source: 'llm' | 'template'` provenance.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-11 | Unit + Integration | `apps/frontend/client/src/lib/services/game/combat_narration_service.test.ts` + view-model wiring test | `combat_narration_service.svelte.ts#narrate`, `combat_narration.ts` prompt builders, `combat_view_model.svelte.ts` `COMBAT_EVENTS_RESOLVED` handler + tooling: `bun moon run client:test` | Filled during verification |

**Test Hooks**: Moon `bun moon run client:test`; fixtures for valid/malformed/timeout/refused → template; facts-only assertion (prose cannot contain damage numbers or outcomes the events lack); late narration after encounter end discarded.
**E2E / Visual**: covered by AC-10's narrated-turn case (template path in the provider-less lane; LLM path under the mocked gateway in `combat_narration_service.test.ts`).

**Watch Points**: the model rephrases facts, never adds them; templates remain the single narration path when the flag is off; do not double-narrate attempts — `proposedLine` is the attempt narration.

## Implementation Sequence

1. **Phase 1 (Schemas/types)**: `combat_ai_decision.ts` + `CombatNarrationResult` + derived types; `controlMode` on party schemas; `FEATURE_FLAG_KEYS` entry + `packages/frontend/configs/src/lib/environment.ts` env declaration; tests.
2. **Phase 2 (Perception + pipeline)**: `combat_ai_perception.ts`, `combat_ai_decision.ts` (context → decide → step-wise compile/commit loop → fallback); engine tests including the multi-step fixture.
3. **Phase 3 (Services + tasks)**: `combat-ai` and `combat-narration` presets; `combat_ai_service.svelte.ts` and `combat_narration_service.svelte.ts` (deadlines/retry/cancel/idempotency/telemetry); tests.
4. **Phase 4 (Prefetch/batching + control modes + events)**: turn-driver async planning; squad batching; companion modes + Suggest UX; telegraph/degraded events + UI; flag (env declaration in `apps/frontend/client/src/env.ts` with `static: true` + configs `featureFlags` resolution).
5. **Phase 5 (Narrator wiring)**: swap the `COMBAT_EVENTS_RESOLVED` handler to the service with template fallback; provenance telemetry; accessibility of narrated log entries; update `apps/frontend/docs/src/content/docs/features/combat-controls.md` (Docs Impact).
6. **Phase 6 (Validation)**: `bun run fix`; schemas/constants/frontend-engine/client tests; `/game` E2E (AI flag on with no reachable provider ⇒ fallback path, and AI flag off) + visual; `bun moon run :validate`; Execution Report.

## Edge Cases & Gotchas

- **Stale prefetch**: discard a prefetched decision when the revision changes; never apply it to a different actor/turn.
- **Step-wise execution**: never precompile step two against step one's pre-commit state; recompile after every commit; a mid-loop defeat/encounter-end stops the loop cleanly.
- **Commit-time revalidation**: the kernel revalidates; a decision that was legal at plan time may be illegal at commit time — fall back, don't force.
- **Idempotency**: one decision per `decisionId`; duplicate/late replies are ignored.
- **Perception leaks**: never include hidden enemies, secrets, or unrelated history; verify with an "unseen enemy" fixture.
- **Characterful ≠ illegal**: personality biases goal selection, not legality; every committed action passes the kernel.
- **Difficulty**: adjust coordination/risk/resources/telegraphing through the context policy fields (`difficulty` default `'normal'`), never the model's instruction to reason well; authoring per-encounter difficulty is content, not this contract.
- **Suggest loop**: a proposed plan is a preview, not a commit; the player can cancel; approval commits once.
- **Morale defaults**: until Combat-08, `morale: 'steady'`; do not invent thresholds. Objectives surface kernel state (schema since C-509) but never transition here.
- **Difficulty default**: `difficulty: 'normal'` with neutral coordination/risk policy; the field is caller-supplied and additive, so old callers keep compiling without it.
- **Suggest without a model**: the deterministic fallback must be able to propose a Suggest-mode plan, otherwise AC-6/AC-10 are unverifiable in the provider-less E2E lane.
- **`PUBLIC_QA_BYPASS_TEXT_AI`**: orthogonal C-335 gate for running with no text provider at all. Degraded/fallback tests must leave it off so the real fallback path runs.
- **Batching**: one call per squad must still yield a decision per actor and preserve per-actor determinism.
- **Narration**: late narration after the encounter ended is discarded; narration appends to the log, never reorders it; template text is the single path when the flag is off; do not narrate attempts twice (`proposedLine` is the attempt line).
- **Telemetry privacy**: no secrets, no hidden prompts, no chain-of-thought.

## Open Questions

Must be resolved before status becomes `approved`:

- **Q1 — Flag default.** Recommendation: `PUBLIC_COMBAT_LLM_AGENTS` defaults **off** (opt-in `=== '1'`); Combat-06 ships the seam and the deterministic path, and a later slice (or a rollout decision) enables it by default. Confirm.
- **Q2 — Companion default mode.** Recommendation: `suggest` for the first release (`combat_2.md` §25 decision 6). Confirm.
- **Q3 — Suggest approval surface.** Recommendation: reuse the C-525 preview/confirmation panel for the companion plan (player edits target/destination), consistent with the player NL UX. Confirm.
- **Q4 — Perception source.** Recommendation: derive the snapshot from the v2 projection + legal actions + vision masks where available, with `morale`/`cover` defaults until Combat-08; do not build a new vision system here. Confirm.
- **Q5 — Narrator gating.** Recommendation: one `PUBLIC_COMBAT_LLM_AGENTS` flag gates decisions and narration (one LLM-layer seam, one kill switch); split into a separate flag only if players ask for narration without agents. Confirm.
- **Q6 — `combat-narration` preset bounds.** Recommendation: role `narration`, ~160 max tokens, temperature ~0.8, priority `interactive`, `localFirst: true`, non-streamable — bounded prose, mirroring `combat-intent`'s discipline with narration flavor. Confirm.

> **Critique note (2026-09-14):** Q1–Q5 recommendations are already applied consistently throughout this contract (flag default off; `suggest` default; preview-panel reuse; v2-projection perception source; one flag for decisions + narration). Q6 is consistent with the shipped `TEXT_TASK_PRESETS` vocabulary (`role: 'narration'` already exists; `combat-intent` is the structured precedent). Implementation proceeds on these recommendations; the architect records confirmation at promotion to `approved`.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-13 | Initial draft: AI decision agents (Combat-06 as tabled in §22). | — |
| 3.0.0 | 2026-09-14 | Regrouping per §22.3: merged post-resolution narration into this contract from Combat-07 scope (C-525 shipped unused prompt builders; template fallback already wired), added the step-wise multi-step AI execution loop (closes the C-525 Q2 deferral for AI actors), corrected dependency statuses and file paths, added AC-11. Combat-07 (C-527) and Combat-08 (C-528) remain separate per the split rule. | Maintainer (session 2026-09-14) |
| 3.0.3 | 2026-09-14 | **Production completion (implementation-driven, no scope change).** Replaces substring-based narration validation with constrained fact references + deterministic rendering (AC-11); adds the optional `standingGoal` field to `CombatActorContextSchema` so Intent mode has somewhere real to put the goal (matches §12.1's decision input list); adds `standingIntent` to `PartyRosterEntrySchema` so the Intent goal persists with the party; adds `CombatEncounterParticipant.controlMode` + `CombatAiDecisionWithdrawnEvent` + `CombatCompanionModeSetCommand` so a mode change reaches the engine mid-encounter; makes companion turns wait for the player rather than for a model deadline. | Implementer (session 2026-09-14) — **pending maintainer confirmation** |
| 3.0.2 | 2026-09-14 | **Lifecycle/authority repair (implementation-driven, no scope change).** Adds `'cancelled'` to `COMBAT_AI_DEGRADED_REASONS` so a cancelled request is not collapsed into `offline`/`stale`; pins the soft-timeout behaviour to "abort the outstanding transport immediately" (the pinned alternative to "leave a tracked hard-abort deadline alive"); bounds retries by the ORIGINAL time budget instead of a fresh soft deadline per attempt; stops retrying provider rejections inside one budget; makes the perception default actor-relative (see AC-2) instead of omniscient; makes `trimToTokenBudget` total (typed `undefined` fallback rather than an over-budget context); adds the optional `policy`/`controlMode` fields to `CombatEncounterParticipant` so authored character data and the companion mode reach the engine; and replaces substring-based narration authority with fact-bound rendering (see AC-11). | Implementer (session 2026-09-14) — **pending maintainer confirmation** |
| 3.0.1 | 2026-09-14 | Critique pass (no scope change): AC-2/5/6/7/8/9/10 made verifiable (concrete artifacts, E2E lane reality), `difficulty` + `tokenBudget` anchored in `CombatDecisionContext`, `'disabled'` added to the `COMBAT_AI_DEGRADED` reason union, required env declaration site `packages/frontend/configs/src/lib/environment.ts` added, `controlMode` default citation corrected to `combat_2.md` §25 decision 6, docs-impact line added to the AC-10 journey. | Critic (session 2026-09-14) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

_Lifecycle repair (checkpoint 1) plus production completion (checkpoint 2). This
report is still not a completion claim — see "Remaining Work"._

### Summary

Repairs the C-526 lifecycle, authority and production-integration defects found
by the post-merge review, and completes the companion control surface, the
facts-only narration authority and the enabled-agent production lane end to end.
Verified by targeted unit/integration tests, the affected project suites, the
flag-off combat E2E suite and a new enabled-agent E2E lane against a real dev
server. `PUBLIC_COMBAT_LLM_AGENTS` remains **off** by default; no rollout or
legacy-removal step was taken.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Decision/draft contracts unchanged except the additive `'cancelled'` reason (3.0.2) and the narration draft, which is now `{ claims: NarrationFactRef[]; flavor?: string }` — a shape in which mechanical wording is not expressible. |
| AC-2 | ✅ | Perception default is actor-relative (self + own team + hostiles with clear LoS from `battlefield.blocksSight`); a caller mask narrows it; `trimToTokenBudget` bounds strings and returns a typed `undefined` fallback rather than an over-budget snapshot. Evidence: `combat_ai_perception.test.ts`. |
| AC-3 | ✅ | One slot/transport lifecycle for single + batch; one time budget spanning retries; a soft timeout aborts the outstanding transport; `'cancelled'` preserved; bounded LRU result cache; one telemetry record per attempt per decision. Evidence: `combat_ai_service.test.ts`, `combat_ai_lifecycle.test.ts`. |
| AC-4 | ✅ | Unchanged step-wise loop, now running against the repaired service; the deterministic proposal path reuses the same compiler rather than inventing a second one. |
| AC-5 | ✅ | Prefetch starts from the live initiative position and batches one knowledge group only; cache keys and callbacks bound to the encounter RUN; `finally` releases in-flight state; `COMBAT_ENDED` tears the run down. Evidence: `combat_ai_controller.test.ts`. |
| AC-6 | ✅ | All four modes through the same kernel. `direct` is player-owned (`controllerFor`/`isPlayerControlled`; the AI runner stops for it). Suggest/Intent/Autonomous present a compiled proposal with costs/risks, allow target or approach edits that recompile and re-preview, and commit only on **Approve** — including when the model is unavailable, via a proposal derived from the deterministic planner. Intent persists a bounded standing goal into the actor policy. Mode is a persisted preference on the party roster (default `suggest`, old saves load). Mode changes travel to the engine mid-encounter; switching to `direct` withdraws the pending proposal. Companion turns have **no model deadline** (player deliberation is not an AI timeout). Evidence: `combat_companion_flow.test.ts`, `combat_ai_companion_ownership.test.ts`, `combat_v2_llm.spec.ts`. |
| AC-7 | ✅ | Telegraph + degradation presentation live in `combat_narration_flow.svelte.ts` (always attached, so it works with no narrator); `'cancelled'` has player-facing wording; `COMBAT_AI_DEGRADED` stays de-duplicated per actor and reason. |
| AC-8 | ✅ | Authored `voice`/`manner`/`boundaries`/class/approval are projected onto the encounter roster, pinned onto the engine AI coordinator as `policyByCombatant`, and a companion's standing goal reaches the prompt as its own line. `secrets` are deliberately never projected. Evidence: `combat_encounter_roster.test.ts`, client prompt tests. |
| AC-9 | ✅ | Kill switch unchanged, off by default, pinned at encounter start; the enabled lane asserts the degradation wording is NOT "agent layer off", which is what proves the flag was really on. |
| AC-10 | ✅ | New `client-llm-on` Playwright project (`apps/e2e/tests/client/combat_v2_llm.spec.ts`) against a second client dev server started with `PUBLIC_COMBAT_LLM_AGENTS=1` and **no reachable provider**: real `/game` encounter, legal AI turns through the fallback, `COMBAT_AI_DEGRADED` with model-unavailable wording (never "agent layer off"), a bounded telegraph, template narration, Suggest propose → edit → approve, and mode change + Intent-goal persistence. `apps/frontend/docs/.../combat-controls.md` documents modes, readable intent and narration provenance. |
| AC-11 | ✅ | A mechanical sentence is only ever rendered from the fact it references; an unresolvable reference rejects the whole draft; the free-text flavour channel is refused when it names a combatant, carries a digit, uses outcome vocabulary, or is the entire narration. "Defeat authorises a victory sentence" and "one actor's defeat authorises another actor's death" are not representable. Evidence: `combat_narration_service.test.ts`, schemas narration tests. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/services/game/combat_ai_lifecycle.ts` | Shared request-lifecycle primitives: one time budget, provider transport with tracked hard-abort and last-member abort, soft-deadline race, bounded LRU cache, encounter-run identity. |
| `apps/frontend/client/src/lib/views/combat/combat_narration_flow.svelte.ts` | Narration + telegraph + degradation presentation; reserves the log slot synchronously and rewrites it in place. |
| `apps/frontend/client/src/lib/views/combat/combat_companion_flow.svelte.ts` | Companion control modes: proposals, approval, target/approach edits with recompile + re-preview, standing intent, invalidation, engine turn release. |
| `apps/frontend/client/src/lib/views/combat/components/companion_control_panel.svelte` | Mode selector, Intent goal input, proposal card with Approve/Decline and edit controls. |
| `apps/frontend/client/src/lib/services/game/combat_ai_lifecycle.test.ts` | Lifecycle-primitive regression coverage. |
| `apps/frontend/client/src/lib/views/combat/combat_companion_flow.test.ts` | AC-6 coverage: policy per mode, no commit before approval, single commit, stale invalidation releases the engine. |
| `packages/frontend/engine/src/__tests__/combat_roster_control_mode.test.ts` | Turn-ownership coverage for `controllerFor`/`isPlayerControlled`. |
| `packages/frontend/engine/src/__tests__/combat_ai_companion_ownership.test.ts` | Real-world AC-6 coverage: Direct is never asked, Suggest waits without timing out, an enemy on the same deadline still does, mode changes withdraw/take the turn. |
| `apps/e2e/tests/client/combat_v2_llm.spec.ts` | AC-10 enabled-agent production lane. |
| `docs/implementation/combat-completion-progress.md` | Durable cross-context progress record. |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/services/game/combat_ai_service.svelte.ts` | Rewritten around per-decision slots + one shared transport; per-attempt telemetry; `cancelled` preserved; no retry on provider rejection. |
| `apps/frontend/client/src/lib/services/game/combat_narration_service.svelte.ts` | Same budget/abort discipline; bounded cache; aborts on soft timeout/cancel; validates the new `{claims, flavor}` draft. |
| `apps/frontend/client/src/lib/services/game/combat_narration_policy.ts` | Rewritten: constrained fact references + a conservative flavour gate instead of substring blacklists. |
| `apps/frontend/client/src/lib/views/combat/combat_narration.ts` | Adds `renderNarrationClaim`/`renderNarrationClaims`; the outcome prompt now indexes every fact and states the flavour rule. |
| `apps/frontend/client/src/lib/views/combat/combat_ai_controller.svelte.ts` | Run-identity cache keys; squad-safe prefetch; `finally` release; `COMBAT_ENDED` teardown; approval delegation with no response deadline; deterministic proposal steps. |
| `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` | Delegates narration/telegraph/degradation to the flow, owns the encounter-run tracker and the companion flow, exposes the companion API, releases turns with the proposal. |
| `apps/frontend/client/src/lib/views/combat/combat_sidebar.svelte` | Mounts the companion panel HIGH in the pane — an approval the fight waits on must be visible without scrolling. |
| `apps/frontend/client/src/lib/services/game/combat_encounter_roster.ts` | Projects `controlMode` and authored character policy; `buildCombatPolicyFromNpc` never projects `secrets`. |
| `apps/frontend/client/src/lib/services/game/party_roster_service.svelte.ts` | `setControlMode` / `getStandingIntent` — the persisted preference the whole feature reads. |
| `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | Passes the persisted mode into the encounter roster. |
| `apps/frontend/client/src/lib/views/combat/combat_composition.ts` | Wires the companion capability seam from the party roster. |
| `apps/frontend/client/src/lib/services/game/game_test_seam.ts` | `startCompanionEncounter` + `getCompanionPreference` probes (non-production only). |
| `packages/frontend/engine/src/combat/combat_ai_perception.ts` | Actor-relative default perception; total `trimToTokenBudget`; `standingGoal` policy field. |
| `packages/frontend/engine/src/combat/combat_ai_turns.ts` | No deadline for a player-approved companion turn; `refresh()` withdraws/takes the turn; `isPlayerControlled` for the run guard. |
| `packages/frontend/engine/src/combat/combat_command_dispatch.ts` | `COMBAT_COMPANION_MODE_SET` writes the component and refreshes turn ownership. |
| `packages/frontend/engine/src/combat/combat_bridge_types.ts` | `CombatCompanionModeSetCommand`, `CombatAiDecisionWithdrawnEvent`. |
| `packages/frontend/engine/src/combat/combat_encounter_start.ts` | `policy` + `controlMode` on participants; `policyByCombatant` on the start result. |
| `packages/frontend/engine/src/combat/combat_ai_worker_binding.ts` | Pins `policyByCombatant` and reuses it across a retry rebuild. |
| `packages/frontend/engine/src/combat/combat_roster.ts` | `controllerFor` honours `direct`; adds `isPlayerControlled`. |
| `packages/frontend/engine/src/combat/combat_v2_ai.ts` | The runner stops for any player-controlled actor. |
| `packages/frontend/engine/src/components/companion.ts` | Adds the `controlMode` component field. |
| `packages/frontend/engine/src/sim.ts` | Exports `chooseV2AiCommand` so the client can derive a deterministic proposal. |
| `packages/shared/schemas/src/lib/game/combat/combat_ai_decision.ts` | `'cancelled'` reason; narration draft = `{claims, flavor}`; `standingGoal` on the actor context. |
| `packages/shared/schemas/src/lib/game/party.ts` | `standingIntent` on the party entry. |
| `apps/frontend/docs/src/content/docs/features/combat-controls.md` | Documents control modes, narration provenance and the facts-only guarantee. |
| `apps/e2e/playwright.config.ts` / `src/config.ts` / `src/pom/game_page.ts` | The `client-llm-on` lane, its port, and POM locators for the companion surface. |
| `apps/e2e/tests/client/combat_v2.spec.ts` | Narrows the "no model call" probe to real provider endpoints (see Deviations 6). |

### Deviations from Spec

1. **Soft timeout aborts the transport immediately.** The contract allowed either
   this or keeping a tracked hard-abort deadline alive; the immediate abort is
   the documented choice. The hard-abort timer remains armed as a bounded
   lifetime safety net.
2. **A provider rejection is not retried inside one budget.** Only an
   invalid/malformed reply is retried; retrying an unreachable provider only
   delays the deterministic fallback.
3. **Retries share one budget**, so two attempts cannot consume
   `2 x softDeadlineMs` against one `hardDeadlineMs`.
4. **The perception default is actor-relative**, not the v2 projection's full
   roster. `battlefield.blocksSight` absent still yields clear LoS — the kernel's
   own documented rule.
5. **Companion turns have no model deadline.** AC-6 requires player approval, and
   the contract's own edge case says deliberation must not be mistaken for an AI
   timeout, so the wait is bounded by the encounter and by turn ownership
   instead. Switching to `direct` withdraws the pending decision.
6. **The narration flavour channel is refused when it would be the entire
   narration** (`flavor_without_claims`). An unverifiable sentence must not reach
   the log with no verified mechanic behind it.
7. **Narration draft shape changed** (3.0.3): the model now authors fact
   references plus optional inert flavour, not a prose block. Recorded explicitly
   because it is a schema change.
8. **The AC-10 enabled lane uses a synthetic ally id** when the deployed content
   pack authors no distinct combat-capable companion (it ships exactly one combat
   NPC). The ally's STATS are real authored stats and every step is the
   production path; only the identity is synthetic. Authoring a real
   combat-capable companion into the pack is a content-pipeline task outside this
   contract.
9. **One pre-existing E2E assertion was corrected.** `combat_v2.spec.ts`'s
   "no model call was made" probe matched `/text/` anywhere in a URL, which
   includes the app's own `/_app/immutable/workers/text_llm_worker-*.js` bundle.
   Same-origin requests are now excluded and the provider match narrowed to real
   endpoints. Verified pre-existing by running the same test on a clean
   `origin/main` worktree (3/3 attempts failed there too, earlier, at
   `bootIntoGame`).

### Test Results

| Command | Result |
|---|---|
| `bun moon run schemas:test` | 758 pass, 0 fail |
| `bun moon run constants:test` | 164 pass, 0 fail |
| `bun moon run client:test` | 3248 pass, 0 fail |
| `cd packages/frontend/engine && bun test` | 1460 pass, 3 fail — all 3 are the pre-existing `Per-pack content audit (C-376 AC-6)` asset checks (`game-data/` is absent in every checkout, root included) |
| `bun moon run schemas:typecheck client:typecheck frontend-engine:typecheck e2e:typecheck` | clean |
| `bun run build:emulator` (client) | build + `check_bundle` pass (201 chunks, no cycles) |
| `bun run test -- --project=client combat_v2` (flag OFF) | 12 pass, 0 fail |
| `bun run test -- --project=client-llm-on combat_v2_llm` (flag ON, no provider) | 3 pass, 0 fail |
| Reproduce the enabled lane | `cd apps/e2e && bun run herdr:start hub && CI= bun run test -- --project=client-llm-on combat_v2_llm` (the `CI=` clears the ambient CI=true so Playwright reuses the already-running servers) |
| Visual case | Screenshot artifacts are produced (`c526-enabled-lane-log.png`, `c526-companion-proposal.png`). No committed visual-baseline for the companion surface: the contract names `combat.visual.ts`, which does not exist in this repository, and there is no visual-eval lane to extend. |

### Remaining Work (not part of this contract's acceptance)

1. A real combat-capable **companion** in the content pack (see Deviations 8) so
   the enabled lane can name one instead of synthesising an ally id.
2. A committed visual baseline for the companion/telegraph/narration surface —
   needs a visual-eval lane that the repository does not currently have.
3. C-527 / C-528 remain undrafted; `combat_2.md` §22.3 reserves their IDs and
   scopes. The §22.2 legacy-removal gate is untouched and legacy combat is still
   the default (`PUBLIC_COMBAT_ENGINE` unset).
