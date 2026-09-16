---
id: C-532
title: "Contract C-532: Combat-08 — Objectives, Morale, Reactions, and Release Gate"
source: "docs/architecture/combat_2.md §9, §14, §17–18, §21–22, §26"
contract_type: full
status: in_progress
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: null
created_at: "2026-09-14T00:00:00Z"
---

# Contract C-532: Combat-08 — Objectives, Morale, Reactions, and Release Gate

## Metadata

| Field                  | Value                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**             | `docs/architecture/combat_2.md` §9, §14, §17–18, §21.4, §22.2–22.3, §26                                                                                            |
| **Target**             | Encounter objective/morale resolution, reaction continuation, outcome persistence, production proof encounter, release evidence                                   |
| **Type**               | full                                                                                                                                                              |
| **Priority**           | P1 — Combat 2.0 needs encounter depth and complete production evidence before rollout                                                                             |
| **Dependencies**       | C-531 🛠️ `implemented` (PR #359) — supplies the environmental contract and the authored proof content, but its own AC-4/AC-6/AC-8 carry written-and-unexecuted production evidence; C-526 🛠️ `implemented` (PR #354 approval/continuation corrections landed; amendments 3.0.1–3.0.4 still pending maintainer confirmation); C-509 / C-516 🛠️ `implemented`; C-514 / C-515 / C-525 ✅ `verified`. No dependency is `blocked` |
| **Status** | in_progress |
| **Promotion**          | —                                                                                                                                                                 |
| **Docs Impact**        | user-facing → `apps/frontend/docs/src/content/docs/features/combat-controls.md`; creator-facing encounter rules → `apps/frontend/docs/src/content/docs/guides/content-pack-authoring.mdx` (objective + morale authoring sections); release evidence → `docs/architecture/combat_2.md` §22.2 and `docs/verification/C-532-timing.md` |
| **Contract version**   | 1.0.0                                                                                                                                                             |
| **Production Surface** | `/game` → authored encounter → objectives/reactions/morale → outcome → exploration or defeat/retry                                                                |

## Problem & Baseline Evidence

Baseline reviewed on 2026-09-14 against PR #352 head
`9d93a3f4f01eebfc5da92f5c24a429a9968fd014`. **That revision is not an
ancestor of `main`** (verified: `git merge-base --is-ancestor` fails), exactly
as C-531 recorded for its own baseline. Re-establish the baseline at the
current revision (`b26cc6e21fa75bccf9d509b4c7db76a21859f546`, 2026-09-15)
before editing, and re-run the commands below there.

- `packages/shared/schemas/src/lib/game/combat/combat_state.ts` deliberately
  omits a reaction phase — `CombatPhaseSchema` is
  `'starting' | 'active' | 'ended'` (the omission is documented in the file
  header as Combat-08 work). `TurnBudgetSchema.reactionAvailable` exists and is
  explicitly marked "Present but unused in Combat-01".
- Existing objective state is a placeholder, not an evaluator:
  `CombatObjectiveStateSchema` carries only
  `{ objectiveId, kind: string, status }` — no rule, no progress, no deadline,
  no precedence. `combat_kernel.ts` only clones the array into state; nothing
  evaluates it.
- `ActionForecastSchema` reserves `reactionRisks` and `objectiveEffects` as
  `Type.Array(Type.Never())` — they validate only `[]` today, with a comment
  stating Combat-08 may widen the element type without changing the object
  shape.
- `CombatOutcomeSchema` is `{ victory: boolean, reason: string }` — a boolean
  projection that cannot express rout, escape, or surrender without inventing
  a death.
- A second, unrelated morale vocabulary already exists:
  `CombatMoraleSchema` (`'steady' | 'shaken' | 'wavering' | 'broken'`) in
  `combat_ai_decision.ts`, consumed as AI decision context via
  `combat_ai_perception.ts`. It is a qualitative band, not bounded mechanical
  state, and this contract must not create a competing morale authority.
- A nonlethal resolution path already ships:
  `ContentPackEncounterEntrySchema.allowNonCombatResolution` /
  `nonCombatSkillCheck` (persuasion DC + success/failure dialogue), consumed by
  `combat_service.svelte.ts` and the dialogue overlay. `proof_encounter` sets
  `allowNonCombatResolution: false`. This is a second, pre-existing nonlethal
  path that must be reconciled with, not silently re-implemented by, morale.
- The dev-only combat view model still derives `'FLEE'` from a narration
  keyword list (`combat_view_model.dev.svelte.ts`), and
  `combat_narration_policy.ts` lists `'surrenders'` among outcome words — free
  prose currently shapes outcomes. Neither may become an authority here.
- C-526 adds character policy and companion control, but character intent alone
  cannot determine mechanical surrender, retreat, objectives, or rewards.
- C-531 supplies environmental state, effects, and the authored proof content:
  `proof_encounter` in `content/packs/emberwatch/manifest.json` is
  player + `village_guard` + `ash_hound` / `cinder_thrall` / `ember_warden`
  (asserted by `combat_proof_encounter.test.ts`), with a table, brazier, oil
  pool and breakable support. It carries **no objectives and no morale rules**
  today.
- C-531 recorded that `proof_encounter` is unreachable through the deployed
  content seed and is only resolvable through the **dev asset origin**
  (`scripts/src/lib/ops/local_asset_origin.ts`), which itself needs a catalog
  snapshot and a network path to the published CDN. `content_pack_loader.ts`
  documents that "the bundled-path fallback has been removed". AC-7's offline
  journeys therefore depend on a content-resolution decision, not just on
  mechanics.
- The architecture requires real `/game` journeys, AI-offline completion,
  save/replay evidence, and a legacy-removal gate (§21.4, §22.2, §26).
- PR #352 retains legacy/default flags and does not complete this release gate.

**Reproduction:** Inspect a v2 fight for a live non-kill objective, a legal
surrender/retreat outcome, and a reaction interrupting movement. A status label,
empty forecast array, or narrated outcome without kernel events is insufficient.

**Baseline tests:** Run the complete C-526/C-531 regression and production lanes
before editing. Record actual results and any content provisioning requirements.

## User Outcome

A player can win or lose an encounter for reasons beyond reducing every enemy
to zero HP, respond to opportunity attacks, and see enemies retreat or surrender
without those outcomes being represented as fabricated deaths.

The full Combat 2.0 proof encounter can be played through direct controls,
language-assisted controls, companion proposals, environmental interactions,
and offline fallback, with trustworthy saves and replay.

## Success Measures

- Every objective, morale transition, reaction, and outcome is a kernel fact.
- One encounter produces at most one terminal settlement and one reward grant.
- Player reaction/companion deliberation never triggers unintended AI actions.
- AI reaction resolution does not require an additional live model call.
- Objective/morale/reaction evaluation meets p95 ≤10 ms on C-531's committed
  reference workload — 32×32 battlefield, 8 combatants, 32 authored objects,
  64 active surface cells (`docs/verification/C-531-timing.md`) — excluding
  rendering, player waiting, and model latency, and with the CPU/OS/runtime
  recorded as C-531 did.
- Accepted input replay reproduces state, events, outcomes, and RNG without AI.
- All mandatory production and migration gates pass before recommending rollout.

## Existing System & Reuse Map

| Capability           | Existing source                                                                 | Reuse / modify / replace                   |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| State and budgets    | `packages/shared/schemas/src/lib/game/combat/combat_state.ts`                   | Add objective/morale/reaction state        |
| State round trip     | `packages/frontend/engine/src/combat/combat_state_adapter.ts`                    | Extend the read/apply projection (C-531's pattern) |
| Kernel and forecasts | `packages/shared/utils/src/lib/rules/`                                          | Extend ordered resolution; widen `reactionRisks`/`objectiveEffects` off `Type.Array(Type.Never())` |
| Turn driver          | `packages/frontend/engine/src/combat/combat_turn_driver.ts`                     | Integrate suspended/resumed actions        |
| Existing nonlethal path | `allowNonCombatResolution` / `nonCombatSkillCheck` (`content_pack_encounter.ts`, `combat_service.svelte.ts`, dialogue overlay) | Retain unchanged; reconcile with morale-driven surrender, never duplicate |
| AI morale band       | `CombatMoraleSchema` (`combat_ai_decision.ts`) → `combat_ai_perception.ts`        | Map numeric morale onto it deterministically; do not add a second morale authority |
| Timing/benchmark     | `scripts/src/lib/ops/benchmark_combat_environment.ts` → `docs/verification/C-531-timing.md` | Extend the workload/report for objective/morale/reaction evaluation |
| Commit/bridge        | `combat_v2_resolver.ts`, `combat_command_dispatch.ts`, `combat_bridge_types.ts` | Extend typed input and event protocol      |
| AI ownership         | Corrected C-526 coordinator and companion flow                                  | Reuse run identity, approval, cancellation |
| Environment          | C-531 object/effect/surface registry                                            | Reuse hazards, movement, objective targets |
| Outcome/exit         | Existing production combat end and retry paths                                  | Centralize exactly-once settlement         |
| Saves/replay         | Existing versioned combat persistence                                           | Extend without live provider dependency    |
| E2E/visual           | Existing combat specs and `combat.visual.ts`                                    | Extend production coverage                 |

## Overview

Complete the encounter resolution lifecycle: objectives determine progress,
morale permits nonlethal outcomes, reactions suspend and resume actions, and one
ordered settlement process decides the result.

Keep the initial mechanics bounded. This is the release integration of those
mechanics, not a mandate to implement every tabletop rule or every objective in
the architecture's future catalog.

## Design Reference

Follow the current architecture, approved dependency contracts, `AGENTS.md`,
and relevant repository guidance. Retain one combat authority, quantized cells,
explicit budgets, named RNG streams, and shared manual/language command paths.

> Testing conventions:
> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

### Authored objectives

Implement these initial objective primitives:

- `defeat_or_rout`: specified hostile group no longer contests the encounter.
- `survive_rounds`: required friendly actors remain eligible through a declared
  number of completed rounds.
- `interact_before_deadline`: complete a registered interaction on an authored
  target before a declared round boundary.
- `reach_zone`: required eligible actors enter an authored destination zone.

Support an optional protected-actor constraint and bounded declarative
composition of these primitives. Do not execute arbitrary content expressions.

“Stop the ritual” uses `interact_before_deadline`; “escape” uses `reach_zone`.
These are presentations of primitives, not separate hand-coded evaluators.

Rules:

- Evaluate after committed command effect batches and at defined round
  boundaries, not from narration or renderer ticks.
- Authored objectives specify their target IDs, thresholds, deadline boundary,
  required actors, and success/failure consequences.
- An objective that is already complete stays complete unless its definition
  explicitly uses a maintained condition.
- Completed-round counting must be defined and tested; starting a round does
  not count as surviving it.
- Mandatory loss constraints have precedence over success at the same
  evaluation boundary. Record all changed objective facts before the single
  terminal result.
- A required ritual/escape objective prevents ordinary enemy elimination from
  silently selecting an incompatible default victory.
- Preview reports immediate objective consequences and conditional risks;
  hidden objectives remain hidden.
- Surface authored objective progress (and a declared deadline where one
  exists) in the combat UI, keyboard-accessible and screen-reader labelled. No
  objective panel exists today; `combat_sidebar.svelte` is the host surface.
  Hidden objectives must not be listed.

### Morale and nonlethal participation

- Store morale as bounded mechanical state, initially 0–100.
- Pin authored starting value, break threshold, trigger magnitudes, and
  available responses in the encounter's rules input.
- Initial triggers: leader defeat, allied participant removal, and authored
  objective failure. Apply each source event once.
- Crossing a threshold permits authored responses; it does not allow an LLM
  to declare an outcome directly.
- Support `retreat` and `surrender` through ordinary validated commands.
- Retreat requires legal movement to an authored exit zone. A fleeing actor
  still on the battlefield remains a participant until it exits or surrenders.
- Accepted surrender ends that actor's hostile participation while preserving
  HP and identity. The initial policy makes surrendered actors non-hostile and
  ineligible for ordinary attack targeting for the remainder of the encounter.
- Enemies can choose another legal action if retreat is blocked. A deterministic
  fallback follows the same authored response policy.
- Bargaining dialogue, changing sides, captives management, and attacking
  surrendered actors are out of scope; do not imply those systems exist.
- The existing `allowNonCombatResolution` / `nonCombatSkillCheck` negotiation
  path is a different mechanism and stays exactly as it is. Do not route it
  through morale, do not re-author it as a morale response, and do not disable
  it for encounters that already declare it.
- Numeric morale is the mechanical authority; the existing qualitative
  `CombatMorale` band consumed by AI decisions is derived from it by one
  documented mapping. Never let the AI band mutate mechanical morale.

### Bounded reactions

Implement one complete initial reaction: an opportunity attack on a hostile
actor voluntarily leaving a reactor's melee threat range.

- Trigger before committing the movement step that exits the threat range.
- Forced movement, teleport-like authored movement, and reaction-generated
  movement do not trigger opportunity attacks in this release.
- An eligible reactor must be active in the encounter, able to react, have its
  reaction budget, and satisfy the registered ability's targeting rules.
- Reset reaction availability at the start of that reactor's normal turn.
- Order simultaneous eligible reactors by initiative order, then stable ID.
- Revalidate each eligibility immediately before resolution.
- Reaction attacks do not open further reaction windows: maximum nesting is one.
- A declined or no-longer-legal reaction spends no reaction resource or RNG.
- An accepted legal attack consumes one reaction whether it hits or misses.
- After reactions, revalidate the original movement. If the mover is downed,
  removed, or otherwise unable to continue, cancel the remainder.
- Spend movement only for committed cells. Do not replay previous path cells,
  reroll already-resolved attacks, or charge the original action twice.
- Show known opportunity risk in movement previews without revealing unseen
  reactors. Explain an unexpected reaction only when it becomes observable.

### Bridge and input protocol

Extend the typed bridge protocol rather than overloading the generic action
path (§16). Introduce `COMBAT_REACTION_SELECTED` (request) and
`COMBAT_REACTION_OPENED` (event) alongside the existing request/event/rejected
unions in `combat_bridge_types.ts`; neither name exists today. Reuse the
existing `COMBAT_PREVIEW_REQUESTED` / `COMBAT_PREVIEW_READY` /
`COMBAT_PLAN_REJECTED` / `COMBAT_COMMAND_REJECTED` shapes for objective and
reaction forecasts so a rejected or stale choice has one rejection channel.
The reaction request carries window identity + version and the encounter-run
identity; the worker revalidates both.

### Player and AI policy

Each controllable actor exposes Ask / Auto / Never for the supported reaction.

- Ask opens a keyboard-accessible decision surface with attacker, target,
  ability, cost, and consequence.
- Ask has no default time limit. Player deliberation is not a provider timeout.
- An optional player-enabled timer may default to Decline when it expires;
  record the timeout choice as an external input.
- Auto applies the configured legal policy; Never declines.
- AI uses a pinned deterministic reaction policy or an already-available valid
  decision. Never block the kernel on a new model call.
- Normal actions and stale companion approvals cannot execute while a reaction
  window suspends their turn.
- Encounter end, retry, ownership changes, and actor removal invalidate pending
  windows and continuations as appropriate.

### Resolution and settlement

Use one explicit ordering:

1. Validate the initiating command and commit any already-completed path prefix.
2. Open/resolve eligible reaction windows when a trigger is reached.
3. Resume and resolve the remaining legal command effects, including C-531
   environmental consequences.
4. Apply resulting participation and morale transitions.
5. Evaluate objectives and mandatory loss constraints.
6. Produce at most one terminal outcome and settlement identity.
7. Project state, render/narrate events, and perform external persistence.

A partial movement interrupted by a reaction is an explicit committed prefix
plus a continuation, not a falsely atomic whole-path command.

Terminal settlement invalidates all remaining continuations. No subsequent AI,
reaction, narration callback, or duplicate event may grant another reward,
advance another turn, or overwrite the outcome.

## State & Data Models

Conceptual model; use strict TypeBox schemas and derived public types.

```ts
type ObjectiveDefinition = {
	objectiveId: string;
	kind: "defeat_or_rout" | "survive_rounds" | "interact_before_deadline" | "reach_zone";
	required: boolean;
	rule: RegisteredObjectiveRule;
};

type ObjectiveProgress = {
	objectiveId: string;
	status: "pending" | "complete" | "failed";
	progress: number;
};

type ParticipationState = {
	status: "active" | "retreating" | "escaped" | "surrendered" | "defeated";
	morale: number;
	appliedTriggerIds: string[];
};

type ReactionWindow = {
	windowId: string;
	version: number;
	initiatingCommandId: string;
	moverId: string;
	reactorQueue: string[];
	currentReactorId: string | null;
	continuation: SerializableCommandContinuation;
};

type EncounterSettlement = {
	settlementId: string;
	result: "victory" | "defeat" | "escape";
	reasonCode: string;
	objectiveResults: ObjectiveProgress[];
};
```

Requirements:

- Extend phase/state to represent a reaction suspension explicitly.
- Reaction input includes window identity/version, actor, choice, and command
  identity; the worker also validates encounter-run identity.
- Persist continuation cursor, remaining path/effects, spent budgets, and
  already-recorded RNG outcomes. Do not serialize closures.
- Add registered reaction policy, objective definitions/progress, participation,
  and settlement state to snapshot/replay input.
- Bound trigger history by encounter limits or compact it without losing
  exactly-once semantics.
- `SerializableCommandContinuation` and `RegisteredObjectiveRule` do not exist
  today — introduce them as named schemas under
  `packages/shared/schemas/src/lib/game/combat/` with derived public types in
  `packages/shared/types/`. A registered rule is a closed, declared kind, never
  an arbitrary content expression.
- `EncounterSettlement.result` classifies the encounter for the player's side.
  A nonlethal resolution (rout, enemy surrender, objective completion, escape)
  still resolves to `victory` / `defeat` / `escape`; the distinguishing detail
  lives in `reasonCode` plus `objectiveResults`. Do not add a fourth result
  variant that leaves `CombatOutcome.victory` unmappable.
- Do not reduce escape/surrender to `hp = 0` or `defeated = true`.
- If existing consumers require a boolean victory projection, define the
  mapping explicitly while retaining the richer authoritative outcome.
- Add objective, morale, reaction, surrender, escape, and settlement events to
  narration fact rendering. Free prose never determines those facts.

## Quality Requirements

- **Offline/degraded mode:** Objectives, morale, reactions, settlement, direct
  controls, and saves work without AI, network, or sign-in. This includes
  reaching the authored proof encounter: the AC-7 offline journeys must not
  depend on the dev asset origin's catalog snapshot or on the published CDN.
  Either ship an offline content path or record, with evidence, why the
  remaining network dependency is outside this contract's authority — a
  silently network-dependent "offline" lane does not count.
- **Accessibility/input:** Reaction dialogs support keyboard focus, explicit
  choices, screen-reader labels, reduced motion, and no forced default timer.
- **Performance budget:** Meet the reference target; no unbounded reaction
  recursion or synchronous provider calls.
- **Security/privacy:** Planning and forecasts respect perception, objective
  visibility, and approved knowledge-sharing rules.
- **Persistence/migration:** Save/reload retains objectives, participation,
  pending windows, budgets, RNG, and settlement state.
- **Cancellation/retry/idempotency:** Duplicate/stale choices cannot consume
  reactions, resume a command, or grant rewards twice.
- **Observability:** Correlate initiating command, window, continuation,
  objective transition, participation event, and settlement.

## Migration & Rollback

- Version state/rules explicitly and retain the repository's compatibility
  policy. `COMBAT_SCHEMA_VERSION` moves 3→4 for the objective / participation /
  reaction / settlement additions, with an additive
  `migrateCombatStateToCurrentVersion` step following C-531's v2→v3 pattern.
  Do not reinterpret old commands under new reaction rules.
- Per §19, choose and record one explicit behavior for saves that are *inside*
  legacy combat: resume through the legacy implementation, or restart from the
  stored pre-combat checkpoint. Do not leave it implicit.
- Migrate older encounters with no authored objectives to their existing
  defeat-group semantics; do not inject new ritual deadlines into old saves.
- Older actors default to active participation with no newly invented morale
  history. Existing defeated state maps explicitly.
- A save made during a reaction restores the same continuation and available
  reaction. Ask prompts reopen without consuming a choice.
- An optional timed prompt preserves remaining time and starts counting again
  after the restored UI becomes interactive; offline elapsed time does not
  silently consume the player's choice.
- Persist reward application through an idempotent settlement ID. Test recovery
  after a crash between combat completion and reward persistence.
- Retry restores the complete pre-encounter checkpoint according to existing
  policy, including objectives, object changes, morale, RNG, and run identity.
- Rollout/kill-switch changes affect new encounters. Compatible active saves
  remain loadable; never hot-switch an encounter into the legacy resolver.
- No destructive legacy deletion or production default flip is authorized by
  this draft alone.

## Scope Boundaries

**In scope:** The four objective primitives, protected-actor constraint,
morale triggers, legal retreat/surrender, one opportunity-attack reaction,
reaction policies/continuation, exactly-once settlement, migrations, and the
complete production release evidence.

**Out of scope:** Counterspell, reaction chains, grouped initiative, expanded
stealth, diplomacy simulation, arbitrary boss scripting, new classes,
large content campaigns, multiplayer authority, UI/theme redesign, and
automatic legacy deletion.

**Deliberately deferred within morale** (bounded subset of architecture §14,
which also lists overwhelming damage, fear conditions, and personality):
overwhelming-damage, fear-condition, and personality morale triggers are not
part of this release. They require a later contract or an approved amendment,
not a silent expansion of this one. Objective kinds outside the four declared
primitives (hold/protect/destroy targets, protect civilians, negotiate
surrender) are deferred for the same reason.

C-531 owns environmental mechanics. C-526 owns agent service and companion
approval repairs. Do not duplicate those systems here.

## Contract Size & Split Rule

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

This is the reserved Combat-08 encounter-resolution and release integration
contract. Its bounded mechanics share command ordering, participation,
continuation, and terminal-settlement invariants.

Review in checkpoints: objective/morale state, reaction continuation, then
integrated release evidence. Every AC remains independently verifiable.
Independent expansion beyond these mechanics must be split into a new contract.

Do not declare this parent complete after only one checkpoint. Reactions are
mandatory here; deferral requires an approved scope amendment and a separately
identified follow-up contract.

## Acceptance Criteria

### AC-1: Objectives resolve from authored rules with explicit precedence

**Given** an encounter using each supported objective primitive,
**When** commands or round boundaries change its progress,
**Then** progress and completion/failure are deterministic, deadlines have
tested boundaries, protected-actor failure wins same-boundary ties, and
default enemy elimination cannot bypass a required objective.

| AC   | Test Level         | Required Artifact                               | Production Path                                  | Evidence |
| ---- | ------------------ | ----------------------------------------------- | ------------------------------------------------ | -------- |
| AC-1 | Unit + integration | Objective evaluator, boundary, precedence tests | `/game` objective panel and encounter resolution | Pending  |

**Test Hooks:** Utils/engine Moon tests; initial/last valid/first expired boundary.
**Watch Points:** Multiple objectives, dead/missing targets, maintained conditions.

### AC-2: Morale supports real nonlethal outcomes

**Given** authored morale rules and retreat/surrender capabilities,
**When** a trigger crosses a threshold and an actor chooses a response,
**Then** triggers apply once, movement/surrender validate normally, participation
changes without invented damage, and outcome/rewards use the resulting state.

| AC   | Test Level               | Required Artifact                        | Production Path                        | Evidence |
| ---- | ------------------------ | ---------------------------------------- | -------------------------------------- | -------- |
| AC-2 | Unit + integration + E2E | Morale, blocked-retreat, surrender tests | `/game` nonlethal encounter resolution | Pending  |

**Test Hooks:** Engine tests and production fixture with deterministic policy.
The authored morale rules (starting value, break threshold, trigger
magnitudes, responses) must be added to the shipped Emberwatch manifest for
`proof_encounter`; they do not exist there today.
**Watch Points:** Leader and ally triggers from the same event; blocked exits;
surrendered units in initiative and target selectors; the pre-existing
`allowNonCombatResolution` path must still behave identically for encounters
that declare it.

### AC-3: Opportunity attacks suspend and resume commands correctly

**Given** a path leaving one or more eligible hostile threat ranges,
**When** opportunity reactions are accepted, declined, or become invalid,
**Then** the window order, reaction costs, attack rolls, movement prefix,
continuation, and cancellation match the declared rules without duplication.

| AC   | Test Level         | Required Artifact                          | Production Path           | Evidence |
| ---- | ------------------ | ------------------------------------------ | ------------------------- | -------- |
| AC-3 | Unit + integration | Reaction window/continuation and RNG tests | `/game` tactical movement | Pending  |

**Test Hooks:** Utils/engine tests for multiple reactors, misses, downed mover,
forced movement, stale/duplicate choices, and no recursive reactions.
**Watch Points:** A consumed reaction must remain consumed after continuation.

### AC-4: Reaction controls preserve ownership and usability

**Given** Ask, Auto, or Never policies,
**When** a reaction window opens or a policy/ownership changes,
**Then** only the permitted choice executes; Ask remains usable without a
default timeout; optional expiry records Decline; stale companion approvals
cannot execute through the suspended turn.

| AC   | Test Level                 | Required Artifact                               | Production Path           | Evidence |
| ---- | -------------------------- | ----------------------------------------------- | ------------------------- | -------- |
| AC-4 | Compiled integration + E2E | `apps/e2e/tests/client/combat_v2_depth.spec.ts` (new) | `/game` reaction controls | Pending  |

**Test Hooks:** Compiled Playwright for focus, Escape/Decline, policy switching,
optional timeout, encounter end, and retry.
**Watch Points:** Provider timers are separate from player deliberation.

### AC-5: Encounter settlement and exploration handoff happen once

**Given** an encounter reaching victory, defeat, escape, or surrender-based
success while effects/reactions are pending,
**When** terminal settlement is committed and persistence receives retries,
**Then** one outcome is retained, pending work is invalidated, rewards/world
changes apply once, and the correct exploration or defeat/retry UI appears.

| AC   | Test Level        | Required Artifact                                    | Production Path                        | Evidence |
| ---- | ----------------- | ---------------------------------------------------- | -------------------------------------- | -------- |
| AC-5 | Integration + E2E | Settlement duplication/crash recovery and exit tests | `/game` outcome → exploration or retry | Pending  |

**Test Hooks:** Replay terminal events; simulate interrupted reward persistence.
**Watch Points:** Do not unlock exploration input while a terminal overlay still
owns it; do not resume the engine twice.

### AC-6: Save/reload and replay preserve pending and terminal state

**Given** saves before a deadline, during a reaction, after surrender, and
between terminal settlement and reward application,
**When** they reload or replay without AI,
**Then** state, RNG, future outcomes, pending choices, and reward identity match
the recorded rules version; migrations preserve old encounter semantics.

| AC   | Test Level        | Required Artifact                                        | Production Path                  | Evidence |
| ---- | ----------------- | -------------------------------------------------------- | -------------------------------- | -------- |
| AC-6 | Integration + E2E | Versioned fixtures, reaction resume, settlement recovery | `/game` save → reload → continue | Pending  |

**Test Hooks:** Include pre-C-531 and C-531-era fixtures.
**Watch Points:** Same authored encounter retried under a new runtime generation.

### AC-7: The complete authored proof encounter works in production

**Given** the C-531 authored fixture — `proof_encounter`, asserted as
player + one real companion (`village_guard`) versus three enemies
(`ash_hound`, `cinder_thrall`, `ember_warden`) — **extended** with a ritual
objective and morale rules (Implementation Sequence step 6),
**When** its ritual objective, environmental interactions, morale outcome, and
opportunity reaction are exercised through `/game`,
**Then** the following journeys pass without synthetic resolved-event injection:

1. Entirely direct control.
2. Language-assisted control with grounded previews and explicit confirmation.
3. Mixed clicks and language.
4. Companion Suggest → edit → approve, including a multi-step turn.
5. Environmental action affecting authoritative world state.
6. A non-kill objective or morale outcome.
7. Enabled agents with an unreachable provider and deterministic proposals.
8. Agents disabled, with no agent/narration provider calls.
9. Save/reload and deterministic replay.
10. Defeat, retry, and successful return to exploration.

| AC   | Test Level | Required Artifact                                        | Production Path                         | Evidence |
| ---- | ---------- | -------------------------------------------------------- | --------------------------------------- | -------- |
| AC-7 | E2E        | Depth spec, C-531 environment spec, existing C-526 lanes | `/game` real authored encounter journey | Pending  |

**Test Hooks:** Seed content through the actual loader. For successful language
and model-decision cases, use bounded deterministic fixtures at the existing
provider boundary. Keep an independent unreachable-provider lane. Reuse the
existing production start seam (`__AIKAMI_TEST__.startRealEncounter` after
`isCombatStartRoutable()`, as `combat_v2_environment.spec.ts` and the visual
suite's `startProofEncounter` helper do) — not a sandbox-only boot. Record
exactly how the fixture was made resolvable, because C-531 could not resolve it
through the deployed seed.
**Watch Points:** Model-disabled play does not imply free-form language can be
interpreted offline; unavailable interpretation must offer normal direct play.
Do not use QA bypass flags as proof of provider failure handling.

### AC-8: Visual, documentation, performance, and release gates are evidenced

**Given** completed mechanical and production tests,
**When** the existing visual runner, performance checks, and release checklist
execute,
**Then** all mandatory evidence is recorded and the release recommendation
accurately reflects the results without weakening requirements.

| AC   | Test Level                          | Required Artifact                                   | Production Path               | Evidence |
| ---- | ----------------------------------- | --------------------------------------------------- | ----------------------------- | -------- |
| AC-8 | Visual + benchmark + release review | `combat.visual.ts`, `docs/verification/C-532-timing.md`, release checklist, updated docs | `/game` complete combat shell | Pending  |

**Test Hooks:** Extend the existing `defineConfig`/default-export suite with
`objective-progress`, `reaction-ask`, and `nonlethal-outcome` cases using `/game`
fixture setup (reuse the suite's `startProofEncounter` helper; do not add a
fourth ad-hoc starter). Declare a `CombatV2DepthVisualSchema` beside
`CombatEnvironmentVisualSchema` with TypeBox fields: `score`, `combatUIVisible`,
`objectiveReadable`, `reactionChoicesVisible`, `turnOwnershipClear`,
`outcomeConsistent`, `layoutCorrect`, `issues`. Each case declares its own
`requiredTrueFields` and `minScore: 90`, matching the established pattern — a
generous score must not paper over a missing objective panel or an empty
reaction prompt. Assess visible objective/deadline, reaction cost/target,
unobscured controls, and accurate outcome labels. Functional tests establish
mechanics.

Extend `scripts/src/lib/ops/benchmark_combat_environment.ts` (or a sibling
script) so the objective/morale/reaction measurement is reproducible and
committed to `docs/verification/C-532-timing.md` with the recorded CPU/OS/
runtime, as C-531 did.

Record the §22.2 checklist:

- direct production E2E;
- enabled-but-offline fallback;
- save/reload compatibility;
- deterministic replay;
- required legacy behavior accounted for.

**Watch Points:** Screenshots are not evaluated visual results. An unmet
mandatory gate prevents verified/completed status. Passing this contract
produces a rollout recommendation; it does not itself authorize deletion or
a production default change.

## Implementation Sequence

1. Re-establish the baseline at current `main` (PR #352's head is not an
   ancestor); confirm the `implemented`-but-unverified C-526 / C-531 state and
   inventory current settlement/reward consumers, the
   `allowNonCombatResolution` path, and persistence behavior. Decide the
   content-resolution path that makes `proof_encounter` reachable for AC-7.
2. Implement objective/participation/morale state and pure evaluators with
   deterministic precedence and exactly-once event handling.
3. Implement serializable opportunity-reaction continuation and input protocol.
4. Integrate reaction UI, forecasts, AI policy, and existing companion ownership.
5. Integrate terminal settlement, reward idempotency, world handoff, and saves.
6. Extend the authored proof encounter with ritual deadline and morale rules.
7. Run the full production matrix, migrations/replay, visual and timing checks.
8. Complete the execution report and obtain independent release verification.

Use direct OpenCode execution with durable checkpoint notes. Do not treat
context exhaustion as permission to drop remaining criteria.

## Edge Cases & Gotchas

- Killing the last hostile and losing a protected actor in the same batch.
- Completing the ritual interaction at the last legal deadline boundary.
- Retreating units still on the map when another objective completes.
- A reaction downs the mover before its next path cell.
- A second reactor loses eligibility after the first reaction.
- Environmental damage ends combat while a continuation exists.
- A companion mode change arrives during reaction/approval UI.
- Save/reload occurs after RNG consumption but before continuation.
- A stale callback arrives after retrying the same authored encounter.
- Reward persistence succeeds but acknowledgment is lost.
- Disabled agents must not disable morale mechanics or reaction policy.

## Open Questions

No unresolved implementation choices are required to start after approval.
This draft proposes the objective primitives, failure precedence, morale
semantics, opportunity trigger, reaction reset timing, no-default-timeout
policy, and settlement behavior above.

Two deliberate interpretations of the architecture are recorded here so they
are not re-litigated during implementation:

- §9 says an `Ask` reaction should "pause briefly". This contract makes `Ask`
  have no default time limit, because player deliberation is not a provider
  timeout and a forced timer is an accessibility failure. Any timer is
  player-enabled and defaults to Decline.
- §22.3 permits reactions to be descoped to a post-gate contract. This contract
  makes them mandatory; deferral requires an approved scope amendment plus a
  separately identified follow-up contract, not a quiet checkpoint exit.

Before approval, reconcile any concrete conflict with the latest dependencies.
Additional objective families or reactions require a later contract/amendment,
not silent expansion of this one.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date       | Change                                                         | Approved by |
| ------- | ---------- | -------------------------------------------------------------- | ----------- |
| 1.0.0   | 2026-09-14 | Initial draft; bounded encounter-depth and release integration | Pending     |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Baseline

Reviewed head refreshed to `c78392244` (branch `contract-task-c-532-mu2zpf57`),
base `9a8e2efe2` on `main`. The branch forked before the approval commit
`995b35701` (`docs(contracts): approve C-532`), so its tracked contract had
regressed to `status: draft`. This repair restores the approved contract body
from `9a8e2efe2` and moves the status to `in_progress` (implementation started,
not verified). No past approval is invented, and the PR description's
"approved/everything shipped" claims are not treated as tracked evidence.

Dependency baselines were reproduced locally rather than taken from the PR
body:

| Project | Command | Result |
| --- | --- | --- |
| `schemas` | `bun test` (project dir) | 799 pass / 0 fail |
| `utils` | `bun test` (project dir) | 587 pass / 0 fail |
| `constants` | `bun test` (project dir) | 180 pass / 0 fail |
| `frontend-engine` | `bun test` (project dir) | 1519 pass / 0 fail |
| `client` | `bun moon run client:typecheck` | passed (0 errors, 0 warnings) |
| `schemas`, `utils`, `types`, `frontend-engine`, `scripts` | `tsgo --noEmit` | passed |

The three reported Emberwatch asset-audit failures and the heavy Moon CI job
were not reproduced or provisioned in this environment; they remain unverified
baseline claims, not evidence. No DiceState typecheck exemption was re-added.

### Acceptance Evidence

| AC | Implementation | Test | Command / result | Artifact |
| --- | --- | --- | --- | --- |
| AC-1 | Objective evaluator: required-objective precedence, mandatory loss wins ties, latched progress preserved, deadline boundaries, default elimination blocked by unmet required objectives. Morale thresholds no longer remove actors. An interaction is an objective fact only on a successful authored check. | `combat_objectives.test.ts`, `combat_settlement.test.ts`, `combat_depth_kernel.test.ts`, `combat_environment.test.ts` | `bun test` (utils): 587 pass | `combat_objectives.ts`, `combat_settlement.ts`, `combat_kernel.ts` |
| AC-2 | Morale is a participation transition, not a raw threshold; multi-turn retreat toward an authored exit; surrender; AI policy wired into the deterministic chooser; surrendered/escaped actors rejected as attack targets at the authoritative boundary (`targetNotParticipating`); AI morale band derived from authoritative state. | `combat_morale.test.ts`, `combat_nonlethal.test.ts`, `combat_v2_resolver.test.ts` | `bun test` (utils): 587 pass; `bun test` (engine): 1519 pass | `combat_morale.ts`, `combat_kernel.ts`, `combat_v2_ai.ts`, `combat_ai_perception.ts` |
| AC-3 | Reaction continuation resumes active AND retreating movers; remainder revalidated against current terrain/budget before charging a cell; a reaction's removals run the ordered resolution pass immediately (settlement precedence before another reactor); newly ineligible reactors advance instead of hard-rejecting. | `combat_depth_kernel.test.ts`, `combat_reactions.test.ts` | `bun test` (utils): 587 pass | `combat_reactions.ts`, `combat_kernel.ts` |
| AC-4 | **Partial.** Owner-correlated reaction UI state machine and rendered Ask/Auto/Never controls are **not** completed; reason/cost message keys (incl. `combat.invalid.target_not_participating`) are registered in `en`/`es`. | controller tests only | `client:typecheck` passed; no reactive/E2E lane run | `combat_view_model.svelte.ts`, `messages/*.json` |
| AC-5 | Settlement identity now includes the encounter-execution id and the freshly committed revision (`envelope.stateRevision`, not the stale `state.stateRevision`); settlement remains exactly-once. | `combat_settlement.test.ts` | `bun test` (utils): 587 pass | `combat_settlement.ts`, `combat_encounter_resolution.ts` |
| AC-6 | **Not completed.** Production save envelope still lacks the versioned authoritative V2 combat block; reaction-window resume/replay and retry checkpoint parity remain open. | — | not run | — |
| AC-7 | **Not completed.** The authored proof encounter still needs a real companion with `combatStats`, protected-reference validation, and the ten `/game` journeys. | — | not run | `content/packs/emberwatch/manifest.json` (partial) |
| AC-8 | **Partial.** `docs/verification/C-532-timing.md` regenerated from the real resolver path on recorded hardware (all p95 ≤ 10 ms). Evaluated visual cases (`objective-progress`, `reaction-ask`, `nonlethal-outcome`) and the §22.2 release checklist remain. | benchmark | `bun scripts/src/lib/ops/benchmark_combat_depth.ts` → PASS | `docs/verification/C-532-timing.md` |

### Changes and Deviations

- Removed `defeat_or_rout.routMoraleThreshold` from the objective schema, the
  evaluator, fixtures, the benchmark and the authored Emberwatch manifest. A
  morale threshold now only *permits* an authored retreat/surrender; it never
  removes an actor. This is a schema change (still draft/pre-release) with no
  migration impact: v2→v3→v4 migration already installs empty authored rules,
  so no stored snapshot carries the field.
- Added the typed rejection `targetNotParticipating` (schema + kernel message
  key + `en`/`es` catalog entries) for attacks on surrendered/escaped actors.
- `settlementIdFor` signature changed to
  `(encounterId, encounterRunId, stateRevision, reasonCode)` and now scopes
  identity to the encounter execution.
- Interaction objective facts are recorded only when the authored check
  succeeds (read from the committed check event, never re-rolled).
- The authored Emberwatch proof encounter now gives `village_guard` real
  `combatStats`, so roster construction can build the one real companion the
  proof encounter requires. Protected-reference validation and the ten `/game`
  journeys remain.
- Restored the approved C-532 contract body; no scope amendment was made.
- No legacy behavior was deleted and the production default was not flipped.

### Verification

Commands actually run, with results, in this environment:

- `packages/shared/schemas`: `bun test` → 799 pass / 0 fail.
- `packages/shared/utils`: `bun test` → 587 pass / 0 fail.
- `packages/shared/constants`: `bun test` → 180 pass / 0 fail.
- `packages/frontend/engine`: `bun test` → 1519 pass / 0 fail.
- `apps/frontend/client`: `bun moon run client:test` → 3515 pass / 0 fail
  (1 skip, 2 todo) across 270 files.
- `bun moon run client:typecheck` → passed (0 errors, 0 warnings; paraglide
  regenerated as a task dependency).
- `tsgo --noEmit` in `schemas`, `utils`, `types`, `frontend-engine`, `scripts`
  → passed.
- `bun scripts/src/lib/ops/benchmark_combat_depth.ts` → regenerated
  `docs/verification/C-532-timing.md` on this machine (Intel i9-14900HX,
  linux 7.1.4 x64, Bun 1.4.0, 2000 samples after warm-up). All five
  measurements pass p95 ≤ 10 ms; the suspension round trip — now using the
  opened window's current reactor and draining every eligible reactor — is p95
  5.568 ms across 2000 sampled moves (4000 resolved reaction choices).

Not run / blocked: production Playwright E2E lanes, evaluated visual suite,
hub/worker integration lanes, and the full `bun moon run :validate` sweep. No
browser or local AI provider is available here, and the Emberwatch asset audit
could not be provisioned.

### Release Gate

§22.2 checklist, recorded separately:

- Direct production E2E — **NOT MET** (not run).
- Enabled-but-offline fallback — **NOT MET** (no unreachable-provider journey run).
- Save/reload compatibility — **NOT MET** (no V2 combat save block yet).
- Deterministic replay — **PARTIAL** (kernel replay tests pass; production
  recorded-input replay not run).
- Required legacy behavior accounted for — **PARTIAL** (legacy paths retained;
  FLEE/V2 routing audit not completed).

**Recommendation: NOT READY.** Mandatory AC-4, AC-6, AC-7 and AC-8 remain
unmet. Passing this contract produces a rollout recommendation; it does not
authorize legacy deletion or a production-default change.

### Remaining Work

- AC-4: ship owner-correlated Ask/Auto/Never controls with persistence and the
  rendered reactive lifecycle (focus, Escape, timer, mid-window reload).
- AC-5/AC-7: durable reward/world idempotency and crash-recovery integration
  tests; worker/bridge run-identity lifecycle.
- AC-6: versioned V2 combat save block, retry checkpoint parity, and
  cross-version fixtures.
- AC-7: make the proof encounter load one real companion and three enemies
  through the production content path and validate protected references.
- AC-8: the ten production journeys, the three evaluated visual cases, and a
  regenerated `docs/verification/C-532-timing.md` from the real resolver path.
- Section 13: reconcile the PR review threads and correct the creator-guide
  `kind`/`rule.kind` wording and the §22.3 mapping note in
  `docs/architecture/combat_2.md`.
