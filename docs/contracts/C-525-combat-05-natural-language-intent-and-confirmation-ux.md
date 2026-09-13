---
id: C-525
title: "Contract C-525: Combat-05 — Natural-Language Intent and Confirmation UX (with Combat-04 remediation)"
source: "docs/architecture/combat_2.md §7.2, §11, §16, §20, §22 — Combat-05 slice; plus the Combat-04 remediation (C-516 / PR #342 merged; first remediation slice landed in PR #345)"
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-13T00:00:00Z"
---

# Contract C-525: Combat-05 — Natural-Language Intent and Confirmation UX (with Combat-04 remediation)

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/architecture/combat_2.md` §7.2 (natural-language player action), §11 (NL action compiler), §16 (bridge), §20 (prompt-injection boundaries), §22 (rollout — Combat-05); plus the outstanding Combat-04 remediation (§A.3) |
| **Target** | `ActionIntent`/`IntentStep` schemas + types, intent interpreter + deterministic compiler, clarification/confirmation UX, `COMBAT_LANGUAGE_INTENT_SUBMITTED`/`COMBAT_DECISION_PENDING` bridge, deterministic offline parser; **and** the Combat-04 remediation clauses that are still outstanding |
| **Type** | full |
| **Priority** | P0 for the remaining remediation (R-1 ViewModel decomposition, the R-5 client-feedback clauses, the R-7 test-quality items) then P1 for the NL slice |
| **Dependencies** | C-516 / PR #342 (`implemented`; **PR #342 merged 2026-09-13**, AC-10 amended 2.1.0 with an approved asset-seed exception), C-509/514/515 (`verified`), C-015/C-320 (AI service abstraction / provider gateway; `completed` / `implemented`), C-499 (intent envelope extraction resilience; `implemented`) |
| **Status** | approved |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/features/combat-controls.md` (add the language/confirmation flow) |
| **Contract version** | 2.1.0 |
| **Production Surface** | `/game` — combat language input → `COMBAT_LANGUAGE_INTENT_SUBMITTED` → interpreter/compiler → preview/confirmation → existing v2 commit |

## Problem & Baseline Evidence

### A. Combat-04 state at critique time (PR #342 merged; #345 landed the first remediation slice)

The Combat-04 slice is **merged**. PR #342 (`C-516`) merged on 2026-09-13T17:58Z, and PR #345
(`C-525: Combat-04 remediation (deterministic retry, roster, unsupported reason) + contract
hygiene`, commit `d3d208828`, merged 2026-09-13T20:51Z) landed the first remediation slice of
this contract. State verified against the tree at critique time:

1. **CI and size gates are green.** `apps/e2e/playwright_attach.config.ts` is Biome-clean;
   `herdr_adapter.ts` (1545) and `herdr/session.ts` (2299) now sit exactly at their reviewed
   exception ceilings rather than over them; `packages/frontend/engine/src/types.ts` is at its
   grandfathered 957-line ceiling (so new bridge types must not be inlined there).
2. **Already landed in PR #345 — verify, do not re-implement**: R-2 (tactical canvas visible with
   reachable-cell/legal-target highlights, a real actionability-checked canvas click, the
   `combat.visual.ts` move-highlights case), the deterministic-retry clause of R-3
   (`combat_encounter_retry.ts`, `combat_v2_retry.test.ts`), R-4 (engine-reported player id,
   revision-bound previews), R-6 (`unsupportedInV2` added to `CombatInvalidReasonSchema`,
   `combat-controls.md` fallback docs, C-516 hygiene), R-5's roster clause
   (`combat_encounter_roster.ts` refuses to place a hostile npc in the companion slot), several
   further R-5 engine clauses (legacy spawned-eid reporting, live-position refresh before a
   commit, `COMBAT_COMMAND_REJECTED` emission), and the AC-10 E2E-assertion plus ViewModel
   view-purity items of R-7.
3. **Still outstanding — the P0 remediation work that remains**:
   - **R-1** — `combat_view_model.svelte.ts` is **2402 lines**, and #345 *raised* its reviewed
     exception ceiling to 2402 (from the C-516 ceiling of 2330). The decomposition is still owed.
   - **R-5** — the overlay-failure path in `game_overlay_service.svelte.ts#startCombat` returns
     silently instead of rejecting with a typed reason, and no client ViewModel subscribes to
     `COMBAT_COMMAND_REJECTED`, so a rejected v2 command still produces no user feedback.
   - **R-7** — the remaining test-quality items (v2 env branch, proof-roster assertions, the
     wrong-turn fixture, the missing approach case, per-combatant ability grants, the Defend
     assertion, the duplicated visual emulator offset).
4. **C-516 AC-10** is amended 2.1.0: the proof-encounter clause is an approved **external deploy
   dependency** (the published asset seed lags `content/packs/emberwatch/manifest.json` and cannot
   be republished from this checkout — raw offline-core art absent, R2 credentials unset). Do not
   re-litigate it; R-3 carries the matching exception. Deterministic v2 retry is met.

Line references in this contract are as of `d3d208828` (or older) and may have drifted.

### B. CodeRabbit review (PR #342) — 23 actionable findings

Grouped; all must be fixed or explicitly rebutted. Most were fixed in PR #342/#345 before merge —
the clauses that remain are tracked by R-1/R-5/R-7 (see §A.3):

- **Correctness (engine)**: `combat_encounter_start.ts` returns no spawned eids from the legacy branch (`:728`) and does not disambiguate world-derived enemy combatant ids (`:581`); `combat_v2_resolver.ts` does not refresh cached positions before a commit (`:167`); `combat_command_dispatch.ts` gives no user feedback on a rejected v2 command (`:162`) and should reject unsupported actions before mapping (`:218`); `game_world.ts` does not reset combat move mode on exit (`:1553`); `pointer_controller.ts` bypasses the selection commit owner (`:198`).
- **Correctness (client)**: roster builder passes the combat target as the **companion** when its id is also an enemy (`game_composition_root.svelte.ts:494`); `COMBAT_START_ENCOUNTER` is dispatched even when `setActive('COMBAT')` failed (`game_overlay_service.svelte.ts:1323`); the outstanding preview is not invalidated when `stateRevision` changes (`combat_view_model.svelte.ts:827`); every non-player log target is routed to the primary enemy (`:1147`); the synergy header uses literal entity `1` instead of the engine-reported player id (`:1017`).
- **Maintainability**: `combat_sidebar.svelte` contains presentation logic that belongs in the ViewModel (`:270`); `combat-controls.md` does not document the per-encounter fallback (`:41`); `docs/contracts/C-516...md` is marked `implemented` while AC-10 is unmet.
- **Test quality**: `combat_proof_encounter.test.ts` imports `node:fs`/`node:path` inside `packages/frontend` (`:16`) and asserts only 3 enemies, not the full 1+1+3 roster (`:63`); the AC-10 E2E assertion can pass with no combat (`combat_v2.spec.ts:344`); the v2 env branch is never exercised (`combat_engine_flag.test.ts:35`); the "wrong-turn" test is not a wrong-turn test (`combat_v2_resolver.test.ts:346`); the approach case is missing (`:567`); per-combatant ability grants are not asserted (`combat_v2_start.test.ts:442`); Defend is never asserted (`combat_v2_view_model.test.ts:308`); the visual suite applies the emulator offset twice (`combat.visual.ts:21`).

### C. Natural-language combat today is freeform prose classified after the fact

- The only NL combat is `combat_view_model.svelte.ts#executeCustomAction` (`L1378–1580`) through `combat_action_schema.ts`: prose → `ATTACK | DEFEND | FLEE` plus a model-authored narrative and `bonusDamage`/`advantage`. The **narrative is logged before resolution** (`L1441–1451`), and the model is asked to judge `actionValid` (`combat_action_schema.ts:65`) and to write the outcome (`COMBAT_ACTION_SYSTEM_PROMPT` L106–121).
- There is **no `ActionIntent`/`IntentStep` schema, no deterministic selector compiler, no clarification, and no confirmation-before-commit**. The architecture's required order (interpret → compile → validate → preview → confirm → resolve → narrate) is not implemented.

- **Baseline tests**: PR #342's suites (`combat_v2.spec.ts`, `combat_v2_resolver.test.ts`, `combat_v2_start.test.ts`, `combat_battlefield.test.ts`, `combat_turn_flow.test.ts`); `combat_view_model.test.ts`/`combat_v2_view_model.test.ts`; `text_generation_service.test.ts`; `apps/e2e/tests/client/combat.spec.ts`.

## Prerequisite Remediation (Combat-04 — PR #342 merged, #345 landed the first slice)

These must be green before Combat-05 is verifiable. They are part of this contract, not a separate one (the maintainer asked for a single next contract). **At critique time most of R-2, the retry clause of R-3, R-4, R-6 and several R-5/R-7 clauses are already landed (PR #345) — for those, the work is verification, not implementation. Only the clauses in §A.3 remain open.**

## User Outcome

After this contract, a player can type "move to the nearest enemy and use my melee attack" (or click, or mix both), see a compiled preview with a deterministic path/target/cost/forecast, correct or confirm it, and watch the same v2 kernel resolve it. When the model is unavailable or ambiguous, a deterministic parser or a clarification keeps combat playable. And, in the same change, the Combat-04 slice actually merges: CI green, the tactical grid visible, the proof encounter playable, and no unresolved review findings.

## Success Measures

- **Time/latency target**: intent interpretation soft budget 1.5 s / hard 4 s with immediate deterministic fallback (§18); compile + preview within one frame after interpretation; no engine frame waits on the model.
- **Offline/degraded behavior**: with AI unavailable, ordinary "move/attack/ability" instructions parse deterministically, enemies/companions use the existing deterministic AI, and narration uses authored templates; late/queued model output can never mutate resolved state.
- **Production journey enabled**: `/game` combat can be completed through natural language (with confirmation) and through mixed click + language input; the proof encounter completes on v2.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Structured LLM extraction | `text_generation_service.svelte.ts#extractStructure` (L349), task preset `combat-intent` (`combat_composition.ts:51`) | reuse — new schema/task |
| Freeform combat classification | `data/ai_prompts/combat_action_schema.ts`, `combat_view_model.svelte.ts#executeCustomAction` (`L1378–1580`) | replace for v2 — the intent envelope supersedes the prose classifier; the legacy resolver keeps `executeCustomAction` until a later contract retires it. `CombatActionIntent` is **not** the `ActionIntent` of AC-1. |
| Tactical queries/forecast | C-515 `combat_tactical.ts`, `combat_preview_handler.ts` | reuse — deterministic grounding |
| v2 commit path | C-516 `combat_v2_resolver.ts`, `combat_command_dispatch.ts` | reuse — commit a compiled command |
| Bridge command/event pattern | `combat_bridge_commands.ts`, `combat_bridge_types.ts` | modify — add intent messages |
| Encounter/roster/UI | C-516 modules, `combat_sidebar.svelte`, `combat_view_model.svelte.ts` | modify — remediation + intent controls |
| Provider gateway/offline | C-320 `aiGatewayService`, `text_generation_service` local-first path | reuse |
| Outcome/attempt narration | `text_generation_service` generation + authored templates | reuse — new narration module (see Architecture Directives) |
| Deterministic offline parsing | none — new pure module | create — `combat_intent_parser.ts` |

## Overview

Combat-05 splits semantic interpretation from deterministic grounding. A new `ActionIntent` schema expresses desire with selectors ("nearest hostile", "somewhere safe", "strongest fire ability") and never ids, coordinates, or dice. An LLM interpreter (through the existing `extractStructure` gateway task) maps player language to that schema; a deterministic compiler grounds selectors against the live `CombatState`/battlefield using the C-515 queries, producing a `CombatCommand` + `ActionForecast`. The player sees an editable preview and confirms (always, in this first release), or the system asks a bounded clarification when interpretations differ materially. A deterministic parser handles ordinary instructions offline, and narration is produced only from resolved events. In the same contract, the Combat-04 remediation makes PR #342 mergeable and verified.

## Design Reference

- **Governing architecture**: `combat_2.md` §7.2 (NL action), §11.1 (interpret vs ground), §11.2 (clarification), §11.3 (confirmation), §8.2/§8.3 (intent/plan), §16 (messages), §18 (budgets), §20 (injection).
- **Interpreter pattern**: `dialog_action_schema.ts`/`vendor_action_schema.ts` + `extractStructure` — TypeBox schema, `additionalProperties: false`, derived types.
- **Commit path**: the compiled command reuses C-516's `COMBAT_ACTION`/`COMBAT_MOVE` and C-515's preview; no second resolver.
- **Offline**: deterministic parser mirrors the architecture's "AI failure changes presentation, not rules" (§5.5).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Intent schemas**: `packages/shared/schemas/src/lib/game/combat/combat_intent.ts` (TypeBox) + `packages/shared/types/src/lib/game/combat/combat_intent.ts` (`Static<>`), both re-exported from the combat `index.ts` barrels. Exports `ActionIntentSchema`/`ActionIntent`, `IntentStepSchema`/`IntentStep`, `EntitySelectorSchema`, `LocationSelectorSchema`, `AbilitySelectorSchema`, `CompiledPlanSchema`/`CompiledPlan`, `ClarificationRequestSchema`, `IntentInterpreterResultSchema` and `COMBAT_INTENT_BOUNDS`; `additionalProperties: false`; free text capped by the bounds constant.
- **Interpreter**: client adapter `apps/frontend/client/src/lib/services/game/combat_intent_service.svelte.ts` behind the existing AI abstraction — it consumes the `text.extractStructure` capability already injected at `combat_composition.ts:48–51` (task `combat-intent`) and returns only typed intent; no ids, coordinates, dice, HP, or hidden entities; schema-validated with bounded retry; unknown props rejected. Service-convention exports only (interface/options/singleton — never types or schemas).
- **Compiler**: pure shared module `packages/shared/utils/src/lib/rules/combat_intent_compiler.ts` — grounds selectors using `getLegalActions`/`computeReachableEndpoints`/`hasLineOfSight` (C-515) and emits a `CompiledPlan` (`CombatCommand` + `ActionForecast` + assumptions/warnings). Never invents capabilities. The clarification-vs-preview decision (AC-5) is a pure function of the compiled candidate plans in this module.
- **Bridge**: declare `CombatLanguageIntentSubmittedCommand` / `CombatDecisionPendingEvent` in `packages/frontend/engine/src/combat/combat_bridge_types.ts` and compose them into the `GameCommand`/`GameEvent` unions **by reference** (the C-514 pattern — `packages/frontend/engine/src/types.ts` is pinned at its 957-line ceiling, so nothing is inlined there). Reuse `COMBAT_PREVIEW_READY`/`COMBAT_PLAN_REJECTED`; confirmation commits the compiled command through the existing v2 path.
- **Offline parser**: deterministic fallback for ordinary `move`/`attack`/`ability` phrases, in the pure module `packages/shared/utils/src/lib/rules/combat_intent_parser.ts` (tests under `src/lib/rules/__tests__/`); always legal.
- **Narration**: `apps/frontend/client/src/lib/views/combat/combat_narration.ts` — pure attempt/outcome prompt builders plus authored fallback templates; attempt narration before resolution is allowed; outcome narration derives only from `CombatEvent[]`.
- **Remediation**: fix every still-outstanding item in the remediation ACs (§A.3); no new oversized files, no raised baselines (the ceilings PR #345 raised come down), no `node:*` imports under `packages/frontend`.

## State & Data Models

```ts
// ── Intent envelope (semantic only — never ids/coordinates/dice) ──

type EntitySelector =
  | { kind: 'nearest_hostile' }
  | { kind: 'nearest_ally' }
  | { kind: 'last_attacker' }
  | { kind: 'previous_target' }
  | { kind: 'explicit'; namedRef: string }; // resolved deterministically or clarified

type LocationSelector =
  | { kind: 'relative'; relativeTo: EntitySelector; band: RangeBand; direction?: 'toward' | 'away' | 'behind' | 'beside' }
  | { kind: 'nearest_safe' };

type AbilitySelector =
  | { kind: 'tag'; value: string }                  // e.g. "basic_melee"
  | { kind: 'strongest'; damageType?: DamageTypeKey };

// Exact UI selections never enter the model-facing ActionIntent. Trusted UI
// inputs use separate types and are validated against the current battlefield
// and ability grants, then grounded before deterministic plan compilation.
type TrustedCellInput = { cell: GridPoint };
type TrustedAbilityInput = { abilityId: string };

type IntentStep =
  | { kind: 'move'; destination: LocationSelector; stopAt?: RangeBand }
  | { kind: 'use_ability'; ability: AbilitySelector; target: EntitySelector }
  | { kind: 'defend' }
  | { kind: 'wait' }
  | { kind: 'end_turn' };
// interact / attempt_improvised_action are reserved for Combat-07.

type ActionIntent = {
  intentId: string;
  encounterId: string;
  actorId: string;
  basedOnRevision: number;
  source: 'player_language' | 'fallback_parser';
  steps: IntentStep[];
  fallback?: IntentStep[];
  rawText?: string; // bounded, untrusted, never concatenated into privileged prompts
};
```

```ts
// ── Compiled plan + interpreter/clarification results ──

type CompiledPlan = {
  planId: string;
  intentId: string;
  encounterId: string;
  actorId: string;
  basedOnRevision: number;
  command: CombatCommand; // single-step in Combat-05
  forecast: ActionForecast;
  assumptions: string[];
  warnings: CombatPreviewWarning[];
};

type ClarificationRequest = {
  questionKey: string;
  options: Array<{ optionId: string; labelKey: string; steps: IntentStep[] }>;
};

type IntentInterpreterResult =
  | { ok: true; intent: ActionIntent }
  | { ok: false; reason: 'unparseable' | 'unknown_capability' | 'refused'; }
  | { ok: false; reason: 'ambiguous'; clarification: ClarificationRequest };
```

```ts
// ── Bridge additions ──

| {
    type: 'COMBAT_LANGUAGE_INTENT_SUBMITTED';
    requestId: string;
    encounterId: string;
    basedOnRevision: number;
    text: string;              // capped length; untrusted
    context?: { selectedCombatantId?: string; selectedObjectId?: string };
  }

| {
    type: 'COMBAT_DECISION_PENDING';
    requestId: string;
    state: 'interpreting' | 'compiling' | 'awaiting_confirmation';
  }

// Confirmation commits via the existing COMBAT_ACTION / COMBAT_MOVE with the
// compiled command; preview/rejection reuse COMBAT_PREVIEW_READY /
// COMBAT_PLAN_REJECTED.
```

## Quality Requirements

- **Offline/degraded mode**: deterministic parser + deterministic AI + authored narration; no model on the critical path; late output cannot mutate resolved state.
- **Accessibility/input**: language input and every selection/confirmation action reachable by keyboard; preview and clarification are announced; the existing controls remain.
- **Performance budget**: interpreter soft 1.5 s / hard 4 s (§18); compile+preview within a frame of interpretation; no frame waits on the model; requests cancellable by `requestId`.
- **Security/privacy**: player/player-authored text is untrusted data; structured fields only; `additionalProperties: false`; cap free text; reject model-returned ids/numbers/claims unless deterministically resolved; exclude hidden entities, secrets, and unrelated campaign history; never execute model code/expressions.
- **Persistence/migration**: no persisted schema change; intent/plan records are in-memory request state keyed by `requestId` and never enter `CombatReplaySchema` (see Migration & Rollback).
- **Cancellation/retry/idempotency**: interpreter requests cancellable and idempotent by `requestId`; a stale intent (revision changed) is recompiled or discarded; compiled commands commit at most once.
- **Observability**: log interpretation failure, ambiguity, provider timeout, fallback use, and compile rejection distinctly (architecture §17 — Determinism, replay, and observability); never log private chain-of-thought.

## Migration & Rollback

- **Old data compatibility**: N/A — no persisted state change.
- **Migration**: none.
- **Replay/save compatibility**: `CombatReplaySchema` (`COMBAT_REPLAY_VERSION = 1`) is unchanged — no intent, plan or clarification field is added to it. `ActionIntent`/`CompiledPlan`/`ClarificationRequest` are in-memory request/response state keyed by `requestId`; committing one emits only the existing `CombatCommand` variants, so an old replay artifact still resolves byte-identically.
- **Rollback**: disable language input (UI toggle/flag) — direct controls remain; the remediation is standard bug-fix rollback.
- **Feature flag or kill switch**: language input is gated through the existing flag layer (`packages/frontend/configs/src/lib/feature_flags.ts` + a `PUBLIC_*` env key in `apps/frontend/client/src/env.ts`, following the `PUBLIC_COMBAT_ENGINE` pattern); the `combatEngine` flag continues to select the resolver, so disabling language input leaves click controls and the resolver untouched.
- **Failure recovery**: provider failure/timeout/invalid output falls back to the deterministic parser; if that fails too, the UI shows a clarification/typed rejection, never an unvalidated action.

## Scope Boundaries

- **In Scope:**
  - Combat-04 remediation (all grouped remediation ACs).
  - `ActionIntent`/`IntentStep` schemas/types + bounds.
  - LLM interpreter via `extractStructure` (`combat-intent`); deterministic compiler (selectors → command + forecast).
  - Clarification policy and always-confirm preview UX; attempt/outcome narration split.
  - Deterministic offline parser for ordinary move/attack/ability.
  - `COMBAT_LANGUAGE_INTENT_SUBMITTED`/`COMBAT_DECISION_PENDING` bridge + client wiring.
  - Security/prompt-injection boundaries, cancellation/deadlines, replay metadata.
  - Superseding the freeform prose classifier for **v2** encounters (the intent envelope replaces `executeCustomAction`'s model judgment there); legacy encounters keep their current behaviour.
  - Lowering the `combat_view_model.svelte.ts` / `game_world.ts` reviewed size ceilings to the post-split sizes (R-1).
  - Production E2E: NL completion, mixed input, clarification, offline fallback.

- **Out of Scope:**
  - Object affordances/improvised actions (Combat-07).
  - LLM enemy/companion agents and prefetch (Combat-06).
  - Reactions, cover, threat zones, objectives, morale (Combat-08/07).
  - Multi-step plan fitting beyond a single compiled command (revisit after Combat-03 budget queries and confirmation UX stabilize).
  - Save/reload combat parity and `CombatIdentity`/`CombatMovement` persistence.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** The maintainer elected one contract that both completes the Combat-04 remediation and delivers Combat-05. The remediation and the NL slice are not independently shippable here: the NL confirmation UX consumes the same v2 commit path the remediation makes correct, the Combat-04 slice is already merged (so the outstanding remediation is a correctness prerequisite, not a rescue), and each remediation clause stays independently verifiable. **Size: large but intentional — proceed; if staging is required, land the remediation phase first and do not declare partial completion.**

## Acceptance Criteria

### R-1: CI and guard gate are green (Combat-04 remediation)
**Given** the working branch (PR #342 is merged; the ceilings raised by PR #345 are the starting point)
**When** `bun run fix`, `bun moon run e2e:format`, and `bun moon run scripts:guard-source-file-size` run
**Then** `e2e:format` is clean; the two pipeline files (`herdr_adapter.ts` 1545, `herdr/session.ts` 2299) hold valid reviewed exceptions at exact ceilings; **no new** oversized file is introduced; and the files PR #345 re-exceptioned shrink in this change — specifically `combat_view_model.svelte.ts` (2402 lines against a 2402 ceiling) is decomposed into focused sub-modules (intent/preview, selection, log presentation) and its reviewed ceiling is lowered to the post-split size, never above the C-516 ceiling of 2330; `game_world.ts` likewise comes down from 2320. The guard's production hard limit is 800 lines, so a split that leaves the ViewModel near its current size does not satisfy this AC.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| R-1 | Tooling | `scripts:guard-source-file-size` output + `bun run fix` | tooling: `bun moon run scripts:guard-source-file-size` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run fix`, `bun moon run scripts:guard-source-file-size`, `bun moon run e2e:format`
- Integration: `bun moon run :validate` reports Moon CI green for the branch.
- E2E / Visual: N/A.

**Watch Points**: do not raise a baseline to hide new debt; a reviewed exception needs a real owner and `reviewBy`. The ViewModel split must preserve the public ViewModel surface used by tests/E2E. A ceiling must come down in the same change that extracts the code, and the split lands before the intent-loop work adds anything back to that file.

### R-2: The tactical battlefield is visible and click-to-move is user-performable (Combat-04 remediation)
**Given** a v2 encounter in production `/game`
**When** the player enters move selection
**Then** the world/tactical canvas (with reachable-cell and legal-target highlighting) is visible rather than replaced by the opaque portrait stage — or the portrait stage is redesigned to carry the highlight/selection surface; the player can complete a move with a real pointer click (not a synthetic bypass); and AC-10's visual "reachable-cell/target highlights" criterion passes.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| R-2 | E2E + Visual | `apps/e2e/tests/client/combat_v2.spec.ts` + `combat.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: manual `/game` smoke — enter move mode, see highlights, click a cell.
- E2E / Visual:
    - **Functional**: `combat_v2.spec.ts` uses a real click that respects actionability (no synthetic dispatch on a hidden element).
    - **Visual**: `combat.visual.ts` v2 case with `requiredTrueFields` including visible highlights; OpenRouter prompt states the highlight requirement.

**Watch Points**: this is a product/layout decision (replace vs overlay the portrait stage) — record the choice in the Execution Report. *(Landed in PR #345: replace/suppress was chosen and recorded — verification-only.)*

### R-3: AC-10 proof encounter and deterministic retry are real (Combat-04 remediation)
**Given** the authored `proof_encounter` (1 player + 1 companion + 3 enemies) *(the deterministic-retry half is landed in PR #345 — verification-only)*
**When** the encounter starts from `/game`
**Then** the client resolves the authored roster — the asset-seed/index republish is the **approved external deploy dependency** (C-516 Amendments 2.1.0), so this clause is excepted rather than performed here — the fight is playable on v2, `RETRY_ENCOUNTER` reinitializes the **v2** engine with the preserved seed (`combat_encounter_retry.ts`, `combat_v2_retry.test.ts` — landed), `combat_proof_encounter.test.ts` asserts the full 1 player + 1 companion + 3 enemies roster, and the E2E keeps driving the resolvable authored encounter while pinning the deterministic replay outcome.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| R-3 | Integration + E2E | `combat_proof_encounter.test.ts`, `combat_v2.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run client:test`
- Integration: roster = 1 player + 1 companion + 3 enemies; retry same seed → identical event stream.
- E2E / Visual: `combat_v2.spec.ts` proof-encounter + retry case.

**Watch Points**: the asset seed republish is a deploy action; if it cannot be performed in-contract, the contract must amend AC-10 with an approved exception rather than claim it.

### R-4: Preview, target routing, and player identity are revision-correct (Combat-04 remediation)
**Given** a v2 encounter
**When** `ACTION_ECONOMY_CHANGED`/`TURN_CHANGED` changes the revision, a non-player target takes damage, or the player is not entity `1`
**Then** the outstanding preview is invalidated/cancelled on revision change (a stale reply is rejected on `requestId` **and** revision); combat-log targets route by their actual event target ids (not the primary enemy); and all player-specific rows use the engine-reported `playerEntityId`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| R-4 | Unit | `combat_v2_view_model.test.ts` | `combat_view_model.svelte.ts` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: revision-bump then late preview → ignored; multi-target log target ids preserved; non-1 player id.
- E2E / Visual: N/A.

**Watch Points**: invalidate by revision, not just request id; do not drop legitimate logs whose target is neither player nor primary enemy. *(Player-identity and revision-binding landed in PR #345 — verification-only.)*

### R-5: Roster, overlay, pointer, and resolver correctness (Combat-04 remediation)
**Given** the Combat-04 code paths
**When** the fixes are applied
**Then** the roster never duplicates the combat target as a companion (`game_composition_root.svelte.ts:494`); `COMBAT_START_ENCOUNTER` dispatches only after the overlay opens, with a typed rejection otherwise (`game_overlay_service.svelte.ts:1323`); the legacy branch returns spawned eids and world-derived enemy ids are disambiguated (`combat_encounter_start.ts:728,581`); cached v2 positions refresh before each commit (`combat_v2_resolver.ts:167`); combat move mode resets on exit (`game_world.ts:1553`); pointer clicks route through the selection commit owner (`pointer_controller.ts:198`); and a rejected v2 command surfaces user feedback to the player — the engine already emits `COMBAT_COMMAND_REJECTED` (`combat_command_dispatch.ts`), but **no client ViewModel subscribes to it yet**: that, plus the typed rejection when the overlay fails to open, is what still needs work. **Re-verify every clause against the current tree before changing it** — PR #342/#345 already satisfied the roster, legacy spawned-eid, position-refresh and pointer-routing clauses; record per-clause status in the Execution Report instead of re-implementing.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| R-5 | Integration | `combat_v2_start.test.ts`, `combat_v2_resolver.test.ts`, `combat_bridge_commands.test.ts` | `combat_command_dispatch.ts`, `combat_encounter_start.ts`, `game_overlay_service.svelte.ts#startCombat` + `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run client:test`
- Integration: duplicate-target roster rejected with a typed reason; failed overlay open → no engine start; two same-named enemies keep distinct ids.
- E2E / Visual: N/A.

**Watch Points**: preserve the public exports/re-exports so existing tests stay valid.

### R-6: Typed v2 unsupported rejection, docs, and contract hygiene (Combat-04 remediation)
**Given** `SUPPORT`/`REVIVE` on a v2 encounter and the C-516 documentation
**When** they are submitted
**Then** they reject with a dedicated, schema-valid reason (e.g. `unsupportedInV2`, added to `CombatInvalidReasonSchema`; no longer `invalidCommandShape`); `combat-controls.md` documents the per-encounter `v2 → legacy` fallback; and the C-516 contract is corrected (link PR #342; AC-10 status truthfully recorded / amended per the status lifecycle). *(Landed in PR #345 — verification-only.)*

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| R-6 | Unit | schemas test + resolver test | `CombatInvalidReasonSchema`, `combat_command_dispatch.ts` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run schemas:test`, `bun moon run frontend-engine:test`
- Integration: `SUPPORT` → `unsupportedInV2`; docs mention fallback.
- E2E / Visual: N/A.

**Watch Points**: adding a reason literal is an additive schema change; keep existing reasons stable.

### R-7: Test-quality remediation (Combat-04 remediation)
**Given** the reviewed Combat-04 tests
**When** they are corrected
**Then** the AC-10 E2E assertion cannot pass without HP changing on both sides; the v2 env branch is exercised with `PUBLIC_COMBAT_ENGINE=v2`; the proof-encounter test asserts 1 player + 1 companion + 3 enemies and imports no `node:*` in `packages/frontend`; the wrong-turn test starts with the enemy active; the missing approach case runs; per-combatant ability grants are asserted; `defend()` is exercised; and the visual suite applies the emulator offset once.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| R-7 | Unit + E2E | `combat_v2.spec.ts`, `combat_proof_encounter.test.ts`, `combat_v2_resolver.test.ts`, `combat_v2_start.test.ts`, `combat_v2_view_model.test.ts`, `combat_engine_flag.test.ts`, `combat.visual.ts` | tooling + `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run client:test`
- Integration: each corrected test fails when the behavior is removed.
- E2E / Visual: N/A.

**Watch Points**: tests must assert behavior, not implementation; keep fixtures runtime-neutral. *(The AC-10 E2E assertion and the ViewModel view-purity item landed in PR #345; the remaining items at critique time are the v2 env branch, proof-roster assertions, the wrong-turn fixture, the missing approach case, per-combatant ability grants, the Defend assertion, and the duplicated visual emulator offset.)*

### AC-1: Intent schemas are typed, bounded, and selector-only
**Given** the intent module
**When** `ActionIntentSchema`/`IntentStepSchema` are validated
**Then** valid intent envelopes pass; unknown `kind`/extra props are rejected; free text is length-capped through the exported `COMBAT_INTENT_BOUNDS` (`rawText`, `steps`, `fallback` steps, clarification options); and no schema field accepts a raw id, coordinate, dice value, HP, or hidden-entity reference. The module exports `ActionIntentSchema`/`ActionIntent`, `IntentStepSchema`/`IntentStep`, the three selector schemas, `CompiledPlanSchema`/`CompiledPlan`, `ClarificationRequestSchema` and `IntentInterpreterResultSchema`, and both combat `index.ts` barrels re-export them.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/src/lib/game/combat/combat_intent.test.ts` | `combat_intent.ts` + tooling: `bun moon run schemas:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run schemas:test`
- Integration: import `ActionIntent` from `@aikami/types`; typecheck.
- E2E / Visual: N/A.

**Watch Points**: bounded selectors; `additionalProperties: false`.

### AC-2: The LLM interpreter returns typed intent only
**Given** player language and a legal encounter context
**When** the interpreter runs through `extractStructure` (task `combat-intent`)
**Then** it returns a schema-valid `ActionIntent` (or a typed refusal/ambiguity), never ids/coordinates/dice/HP or hidden entities; malformed/partial/timeout responses are handled with bounded retry then deterministic fallback; and late responses for a stale revision are discarded.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `apps/frontend/client/src/lib/services/game/combat_intent_service.test.ts` with valid/invalid/partial/timeout fixtures | `/game` via `combat_intent_service.svelte.ts` (`text_generation_service.svelte.ts#extractStructure`, task `combat-intent`) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: fixture outputs for each failure mode; no id leakage.
- E2E / Visual: N/A.

**Watch Points**: never assert live-model prose; test schema/policy/fallback.

### AC-3: The deterministic compiler grounds selectors against live state
**Given** a valid `ActionIntent`
**When** the compiler runs
**Then** selectors resolve deterministically ("nearest", "safest", "behind", "melee range", "strongest fire") using C-515 queries; the output is a `CompiledPlan` with a `CombatCommand`, forecast, assumptions, and warnings; an unsatisfiable selector produces a typed rejection or clarification, never a fabricated capability; and tie-breaks are stable.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/shared/utils/src/lib/rules/__tests__/combat_intent_compiler.test.ts` | `combat_intent_compiler.ts` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: nearest/safest/behind/melee-range/strongest fixtures; deterministic tie-breaks; no hidden-info leakage.
- E2E / Visual: N/A.

**Watch Points**: the compiler must not call AI or mutate state; compiler + preview must equal the committed command for the same revision.

### AC-4: The preview/confirm flow is explicit and editable
**Given** a compiled plan
**When** the player sees the preview
**Then** it shows the resolved path/cost/target/forecast and warnings; the player can edit (change target/destination) or cancel; **every** compiled plan requires explicit confirmation in this release — there is no auto-commit path, not even for a “low-risk” plan (architecture §25, decision 5; risk-based auto-commit is a deferred preference); confirmation sends the existing v2 command; and no plan is committed before confirmation.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + E2E | `combat_view_model.test.ts` / `combat_v2_view_model.test.ts` intent tests + `combat_v2.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: ambiguous/consequential plans require confirmation; the lowest-risk plan previews and commits only after confirmation; cancel/edit commits nothing.
- E2E / Visual: `combat_v2.spec.ts` language → preview → confirm step.

**Watch Points**: preview binding by revision; resolving dice/events are never rewound as a normal correction.

### AC-5: Clarification asks only when it materially changes the outcome
**Given** an ambiguous intent (e.g. three equally visible goblins, two potions)
**When** interpretations differ materially in cost/risk/target/outcome
**Then** the system asks a bounded clarification with concrete options (at most one round, capped by `COMBAT_INTENT_BOUNDS`); when one interpretation is uniquely safe/reasonable it previews directly without asking; and clarifying never blocks the deterministic offline path.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + E2E | `packages/shared/utils/src/lib/rules/__tests__/combat_intent_compiler.test.ts` clarification fixtures + `combat_v2.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`, `bun moon run client:test`
- Integration: ambiguous fixture → clarification; unique fixture → direct preview.
- E2E / Visual: clarification step.

**Watch Points**: cap the number of options; no infinite clarification loops.

### AC-6: AI failure changes presentation, not rules
**Given** the provider is offline, slow, rate-limited, or returns invalid/refused output
**When** the player submits language
**Then** ordinary move/attack/ability instructions are parsed deterministically; enemies/companions use deterministic AI; mechanical text uses authored templates; the encounter remains completable; and queued/late model output cannot modify already-resolved state.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit + Integration + E2E | `packages/shared/utils/src/lib/rules/__tests__/combat_intent_parser.test.ts` + `combat_v2.spec.ts` offline case | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`, `bun moon run frontend-engine:test`, `bun moon run client:test`
- Integration: provider stubbed unavailable; deterministic parse completes the encounter.
- E2E / Visual: offline fallback case.

**Watch Points**: fallback actions must always be legal; hard deadline executes fallback immediately.

### AC-7: Narration follows resolution
**Given** a committed command
**When** events resolve
**Then** outcome narration is produced only from `CombatEvent[]` and adds no mechanics; attempt narration before resolution is allowed but claims no success/damage/movement/death; narration differences never affect replay or state.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit + Integration | `apps/frontend/client/src/lib/views/combat/combat_narration.test.ts` (no outcome absent from events) | `/game` via `combat_narration.ts#buildOutcomeNarration` / `#buildAttemptNarration` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: event → narration; assert no invented facts.
- E2E / Visual: N/A.

**Watch Points**: never assert exact live prose.

### AC-8: Language input is injection-safe
**Given** hostile player/content-pack text (ids, numbers, tool-like instructions, secret-exfiltration attempts)
**When** it reaches the interpreter
**Then** only structured schema fields are extracted; text is capped and rejected on unknown props; model-returned ids/numbers/claims are deterministically resolved and bounds-checked; hidden entities, secrets, and unrelated campaign history are excluded from prompts; and no model-supplied code/expression executes.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Unit + Integration | `combat_intent_service.test.ts` prompt-snapshot + injection fixtures; `combat_intent_compiler.test.ts` bounds fixtures | `combat_intent_service.svelte.ts` + `combat_intent_compiler.ts` → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: injection fixtures cannot select hidden/out-of-range targets or alter mechanics.
- E2E / Visual: N/A.

**Watch Points**: structured output only; separate system rules from player text.

### AC-9: Production language + mixed-input journey completes
**Given** `combatEngine = v2` in `/game`
**When** the player completes an encounter using natural language (with confirmation), then mixed click + language input, and then with AI disabled
**Then** all three complete to victory/defeat through the v2 kernel, with deterministic replay for the same seed; direct controls remain available throughout; and the existing Combat-04 E2E plus C-500/C-514/C-516 specs pass.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | E2E + Visual | `apps/e2e/tests/client/combat_v2.spec.ts` + visual suite | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: manual `/game` smoke — language → preview → confirm → resolve; provider off.
- E2E / Visual:
    - **Functional**: extend `combat_v2.spec.ts` with language, mixed-input, and AI-offline cases.
    - **Visual**: combat visual suite includes the language/confirmation surface.

**Watch Points**: no engine frame waits on the model; deterministic retry reproduces.

## Implementation Sequence

1. **Phase 0 (Remediation)**: only the clauses still outstanding per §A.3 — the `combat_view_model.svelte.ts` decomposition with its ceiling lowered (R-1), the overlay typed rejection and the client `COMBAT_COMMAND_REJECTED` feedback (R-5), and the remaining test-quality items (R-7). The rest of R-2/R-3/R-4/R-5/R-6/R-7 is verification-only (landed in PR #342/#345). Do not start Phase 1 until this phase is green.
2. **Phase 1 (Schemas + compiler)**: `combat_intent.ts` schemas/types; pure compiler over C-515 queries; unit tests.
3. **Phase 2 (Interpreter + bridge)**: interpreter adapter via `extractStructure`/`combat-intent`; `COMBAT_LANGUAGE_INTENT_SUBMITTED`/`COMBAT_DECISION_PENDING`; deterministic offline parser; cancellation/deadlines.
4. **Phase 3 (UX)**: language input, preview/edit/confirm, clarification, narration-after-resolution, accessibility.
5. **Phase 4 (Validation)**: `bun run fix`; `schemas:test`, `utils:test`, `frontend-engine:test`, `client:test`; `/game` language/mixed/offline E2E + visual; `bun moon run :validate`; Execution Report.

## Edge Cases & Gotchas

- **Revision staleness**: recompile or discard an intent whose `basedOnRevision` no longer matches; never apply a stale plan.
- **Model output is a proposal**: never trust returned ids/numbers/abilities; resolve and bound-check deterministically.
- **Ambiguity loops**: cap clarification rounds; fall back to the safest legal interpretation with a visible preview.
- **Object references**: "that barrel" has no affordance until Combat-07 — reject clearly rather than inventing an interaction.
- **Multi-step intents**: Combat-05 compiles a single command; if a two-step intent cannot fit the budget, explain the partial/alternatives rather than silently dropping a step.
- **Free text caps**: bound `rawText` and reject oversized input.
- **Narration vs state**: attempt narration may precede; outcome narration may not.
- **Late responses**: cancel by `requestId`; a response for an ended encounter is ignored.
- **Remediation overlap**: touching `combat_view_model.svelte.ts` for both the split and the intent loop must land coherently; do not double-emit.

## Open Questions

Resolved at critique time — the pipeline stamps `approved` on a passing critique, so no question may remain open:

- **Q1 — Confirmation default. RESOLVED** — always confirm in the first release; risk-based auto-commit is an opt-in follow-up (architecture §25, decision 5). AC-4 encodes this and forbids any auto-commit path in this release.
- **Q2 — Multi-step intents. RESOLVED** — single-command compilation in Combat-05 (move *or* ability); two-step “move then attack” is deferred to a follow-up (see Out of Scope). `CompiledPlan.command` is a single `CombatCommand`, and a multi-step intent that cannot fit explains the partial rather than dropping a step silently.
- **Q3 — Tactical grid resolution (R-2). RESOLVED** — decided and implemented in PR #345 as *replace*: during v2 direct control the tactical world canvas stays visible with reachable-cell/target highlights and the full-height portrait stage is suppressed (not demoted to a side panel). Legacy combat keeps the portrait stage. Recorded in the Execution Report (R-2 deviation).
- **Q4 — Proof encounter asset seed (R-3). RESOLVED — exception approved.** The deployed asset seed cannot be republished from this checkout (no R2 catalog credentials; the raw offline-core art is absent), so C-516 AC-10 is amended with an explicit exception (C-516 Amendments 2.1.0) and the republish is recorded as an external deploy dependency. The retry clause of AC-10 is met.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.1.0 | 2026-09-13 | Critique-stage refresh: §A restated (PR #342 merged, PR #345 landed the first remediation slice, R-1/R-5/R-7 clauses narrowed); Q1–Q3 resolved (Q3 per the recorded R-2 layout decision); AC-4 made explicitly always-confirm (removing its contradictory low-risk test hook); concrete artifact/module paths and guard-ceiling targets added; §17/§25 citations corrected; replay/save-compatibility clause added. | critique stage (pre-approval) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

_Combat-04 remediation slice landed: R-2 (visible tactical battlefield + user-performable click-to-move + highlight visual criterion), the player-identity and view-purity clauses of R-4/R-7, and the AC-10 E2E assertion item of R-7. R-6 (typed `unsupportedInV2` + C-516 hygiene) and the deterministic-retry clause of R-3 are also landed; R-3's proof-encounter clause is carried by the approved C-516 2.1.0 external-deploy exception. The Combat-05 NL slice, R-1 and the remaining R-5 clauses remain pending._

### Summary

During v2 direct control the tactical world canvas is now the interaction surface. `game_view.svelte` suppresses the opaque `CombatPortraitStage` for encounters running on the v2 engine (legacy keeps it), so the always-mounted `GameCanvasView` is visible and clickable. Reachable move cells and engine-declared legal target cells are painted by the engine as a Pixi overlay above the battlefield (drawn from the existing `walkability_overlay.ts`/`scene_overlays.ts` pattern), driven by a new `COMBAT_SELECTION_HIGHLIGHTS` bridge command carrying the ViewModel's `combatSelection.legalEndpoints` plus the engine-projected `legalTargetCells`. A real Playwright `locator.click` on a published highlight now commits through the production `COMBAT_MOVE_REQUESTED → commitMoveToCell` path; a click outside the reachable set is a no-op. The AC-10 visual criterion is asserted by a dedicated 90+ move-highlights case with `highlightsVisible` as a required-true field.

**Layout choice (R-2): replace, not overlay.** The portrait stage is hidden (`isDirectControl`) rather than demoted to a compact panel: the component is designed for a full-height pane, and a compact variant would have needed component surgery or clipped portraits. Suppressing it for v2 keeps the least invasive DOM while leaving the canvas fully visible/interactive; legacy combat is unchanged, so the C-500 portrait-stage assertions still pass.

### AC Status

| AC | Status | Notes |
|---|---|---|
| R-1 | ⬜ | Pending (the `combat_view_model.svelte.ts` selection/preview split is still the named follow-up; only the two reviewed size ceilings were bumped for this slice). |
| R-2 | ✅ | Canvas visible with reachable-cell/target highlights; real pointer click commits; outside-set click is a no-op; `combat.visual.ts` v2 move-highlights case at `minScore: 90` with `requiredTrueFields: ['combatUIVisible','highlightsVisible']`. |
| R-3 | ⚠️ | Partial under an approved exception. Deterministic v2 retry is met (`combat_encounter_retry.ts`, `combat_v2_retry.test.ts`). The proof-encounter E2E clause is blocked by an external deploy dependency — the published asset seed lags `content/packs/emberwatch/manifest.json` and cannot be republished here (raw offline-core art absent; R2 credentials unset); C-516 AC-10 carries the matching 2.1.0 exception. |
| R-4 | ✅ | The player initiative row now uses the engine-reported `_playerEntityId` instead of the literal `1`; stale "always entity 1" comments removed. Revision invalidation and multi-target routing were already revision-correct from C-516. |
| R-5 | ⬜ | Pending. |
| R-6 | ✅ | SUPPORT/REVIVE now reject as the dedicated `unsupportedInV2` reason (additive `CombatInvalidReasonSchema` literal + `COMBAT_MESSAGE_KEYS` entry); `combat-controls.md` documents the per-encounter v2 → legacy fallback; C-516 is corrected (PR #342 linked via `pr_url`; AC-10 truthfully recorded and amended per the status lifecycle). |
| R-7 | ⚠️ | Partial: the AC-10 E2E assertion now requires a real resolved turn (turn counter advanced + engine-resolved enemy-HP change / fight resolution) and the ViewModel view-purity item is done (ability/target button classes exposed as `abilityButtonClasses`/`targetButtonClasses`). The remaining test-quality items (v2 env branch, proof roster assertions, wrong-turn fixture, approach case, per-combatant grants, Defend assertion, visual emulator-offset) are untouched. |
| AC-1..AC-9 | ⬜ | Pending (Combat-05 NL slice). |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/engine/src/rendering/combat_selection_overlay.ts` | Pure projection from `legalEndpoints`/`legalTargetCells` to per-cell highlight styles (mirrors `walkability_overlay.ts`). |
| `packages/frontend/engine/src/rendering/combat_selection_overlay.test.ts` | Unit coverage for the merge/dedupe rule and deterministic ordering. |
| `packages/frontend/engine/src/game_world/combat_selection_highlights.ts` | Main-thread controller: stores the selection, paints/clears the Pixi highlight overlay, publishes canvas-local cell centres for E2E. |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/game/game_view.svelte` | Suppress `CombatPortraitStage` while `activeCombatViewModel.isDirectControl`. |
| `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` | `legalTargetCells` projection + highlight sync; reactive `_combatEngine` (`$state`); `isDirectControl`; `abilityButtonClasses`/`targetButtonClasses`; engine-reported player id. |
| `apps/frontend/client/src/lib/views/combat/types/combat_direct_control.ts` | Added `legalTargetCells` to `CombatSelectionState`/`IDLE_COMBAT_SELECTION`. |
| `apps/frontend/client/src/lib/views/combat/combat_sidebar.svelte` | Ability/target button classes now read ViewModel properties. |
| `packages/frontend/engine/src/game_world.ts` | `COMBAT_SELECTION_HIGHLIGHTS` registration + controller wiring; clears on mode exit/scene reset. |
| `packages/frontend/engine/src/game_world/scene_overlays.ts` | `drawCombatSelectionHighlights`/`clearCombatSelectionHighlights`. |
| `packages/frontend/engine/src/game_world/diagnostics.ts` | `publishCombatHighlights` (`__AIKAMI_DEBUG__.combatHighlights`). |
| `packages/frontend/engine/src/rendering/layer_bands.ts` | `WORLD_Z_BANDS.combatSelection`. |
| `packages/frontend/engine/src/combat/combat_bridge_types.ts` | `CombatSelectionHighlightsCommand` + `CombatPreviewReadyEvent.legalTargetCells`. |
| `packages/frontend/engine/src/combat/combat_preview_handler.ts` | Projects each legal target id to its cell. |
| `packages/shared/schemas/src/lib/game/combat/combat_preview.ts` | Additive optional `legalTargetCells` on the preview success. |
| `apps/e2e/tests/client/combat_v2.spec.ts` | AC-8 now uses a real actionability-checked click on a published highlight (no synthetic dispatch) + outside-set no-op; AC-10 assertion strengthened. |
| `apps/e2e/src/visual/suites/combat.visual.ts` | New 90+ move-highlights case + `highlightsVisible`; per-case `minScore` support. |
| `apps/e2e/src/visual/core/{capture,evaluate}.ts`, `apps/e2e/src/visual/runner.ts` | Per-case `minScore` thread-through. |
| `scripts/src/lib/ops/guard_source_file_size_exceptions.json` | Reviewed ceilings bumped for `combat_view_model.svelte.ts` (2402) and `game_world.ts` (2320) for this slice. |

### Deviations from Spec

1. **Layout: replace (suppress), not demote-to-panel.** The R-2 watch point asks for the choice to be recorded; the portrait stage is suppressed during v2 direct control instead of moved to a compact side panel, because the component is full-height by design and a compact variant would clip or need a redesign. Legacy behaviour is untouched.
2. **Guard ceilings.** R-1 wanted `combat_view_model.svelte.ts` decomposed rather than re-exceptioned. This remediation slice did not perform that split; both touched grandfathered files had their reviewed exception ceilings bumped with rationale instead. The split remains the named follow-up.
3. **Target highlights need target cells.** `legalTargetIds` are authored ids, so the engine preview now projects and returns `legalTargetCells` (additive optional schema field) for the canvas overlay; the ViewModel still drives the projection from `legalTargetIds`.

### Test Results

- `bun run fix`: clean (Biome).
- `bun moon run scripts:guard-source-file-size`: passed (3077 files checked).
- `bun moon run frontend-engine:test`: 1432 pass / 0 fail.
- `bun moon run schemas:test`: 655 pass / 0 fail.
- `bun moon run client:test`: 3090 pass / 1 skip / 2 todo / 0 fail.
- `svelte-check` (client:typecheck): 0 errors / 0 warnings; `tsgo --noEmit` clean for `frontend-engine`, `schemas`, `e2e`.
- `/game` E2E against the production route: `combat_v2.spec.ts` 6/6 and `combat.spec.ts` (C-500/C-514) 3/3 pass, including a real actionability-checked canvas click and the strengthened AC-10 assertion.
- Visual suite (`--suite=combat`): 8/8 pass; the new move-highlights case scored 95/100 with `highlightsVisible: true` and the v2 tactical case passed.
