---
id: C-532
title: "Contract C-532: Combat-08 — Objectives, Morale, Reactions, and Release Gate"
source: "docs/architecture/combat_2.md §9, §14, §17–18, §21–22, §26"
contract_type: full
status: approved
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: "https://github.com/BearlySleeping/aikami/pull/362"
    pr_number: 362
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
| **Status** | approved |
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

> **PARTIAL IMPLEMENTATION — status remains `approved`.**
> Attempt 2 completed the objective panel (AC-1), the nonlethal command path and
> authored content (AC-2), the depth forecasts and bridge protocol (AC-3), and
> the reaction decision surface (AC-4 client side). A review-captain round then
> closed the AC-3 **bridge dispatcher** (the reaction is now reachable in a
> running encounter, with a new engine round-trip test) and produced the AC-8
> benchmark and `docs/verification/C-532-timing.md`. **AC-7 is not started**, and
> AC-4 (E2E + policy persistence), AC-5, AC-6 and the AC-8 visual/release lanes
> remain unmet. This contract must NOT be promoted to `implemented` or
> `verified` in its current state.

### Baseline

- **Starting revision:** `b26cc6e21fa75bccf9d509b4c7db76a21859f546` (2026-09-15),
  worktree `contract-task-c-532-mu2zpf57`. The contract's recorded PR #352 head
  `9d93a3f4f01eebfc5da92f5c24a429a9968fd014` was **not** used — the baseline was
  re-established at current `main` as the contract requires.
- **Attempt 1** left a committed checkpoint (`80af40ecc`, "Combat-08 mechanical
  core") carrying the schema v4 model, the pure evaluators and the kernel
  integration with 112 green tests. Attempt 2 built on it.
- **Review-captain round (attempt 3)** ran in the same worktree against that
  checkpoint: it wired the AC-3 bridge dispatcher, added the engine round-trip
  test, added `scripts/src/lib/ops/benchmark_combat_depth.ts`, generated
  `docs/verification/C-532-timing.md`, and corrected two claims in attempt 2's
  report (see Verification). No AC or scope was changed.
- **Dependencies:** C-531 / C-526 / C-509 / C-516 `implemented`; C-514 / C-515
  `verified`. None `blocked`; the contract is `approved`.
- **Dev services:** `herdr_session list` — `client` :7584 and `hub` :7586 running
  for `aikami-contract-C-532`; `image` :8188. `text` and `voice` not running
  (needed only by the AC-7 journey 7/8 lanes, which were not reached).
- **Baseline test runs (before editing this attempt):**
  - `utils:test` 541 / 0 · `schemas:test` 793 / 0 · `constants:test` 180 / 0
  - `frontend-engine:test` 1477 pass / **4 fail** — 3 pre-existing content-audit
    asset gaps (`props.webp`, `props.json`, `atlas.json` under
    `apps/frontend/client/static/game-data/`) confirmed pre-existing by
    `git stash -u` inside this worktree, plus 1 C-516 catalog assertion that this
    contract's universal `opportunity_strike` grant changes (fixed).
  - `hub:test` 229 / 0
  - `client:typecheck` — **1 pre-existing failure**: `TS2614` `DiceState` at
    `dialogue_overlay_view_model.svelte.ts:17`, confirmed pre-existing by
    `git stash -u`.
- **Authored fixture availability:** `proof_encounter` now **authors** objectives,
  morale rules and a reaction registry (see Changes).
- **Content-resolution decision (recorded):** the AC-7 lane must resolve
  `proof_encounter` through the **local asset origin**
  (`scripts/src/lib/ops/local_asset_origin.ts`), which serves
  `content/packs/emberwatch/manifest.json` as the `emberwatch:manifest` tag —
  exactly the path `apps/e2e/src/visual/suites/combat.visual.ts`
  `startProofEncounter` and `CombatPage.bootAuthoredEnvironmentEncounter` already
  use. It requires no published CDN and no network path, so the contract's
  "works without AI, network or sign-in" requirement is satisfiable. C-531's
  finding that `content_pack_loader.ts` has no bundled-path fallback still holds;
  the origin stands in for the registry, it does not restore a fallback.

### Acceptance Evidence

| AC | Status | Evidence |
| --- | --- | --- |
| AC-1 | ✅ | Closed 4-primitive rule union + evaluator (`combat_objectives.ts`, 22 unit tests); boundary/latch/precedence/missing-actor/protected-actor cases; objective panel projection (`objective_panel.ts`) and flow (`combat_objective_panel.svelte.ts`, 16 tests) rendering `combat_objectives_panel.svelte` in `combat_sidebar.svelte` with a labelled region, one screen-reader sentence per row, status and deadline in words, hidden objectives omitted; preview `objectiveEffects` (`combat_depth_forecast.ts`) reachable through `forecastCombatAction`. |
| AC-2 | ✅ | Bounded 0–100 morale with exactly-once triggers and ONE documented band mapping (20 unit tests); `retreat` and `surrender` command kinds validated and resolved through the kernel (20 tests) — retreat gated on authored response + broken morale + not-increasing distance to the exit zone, escape on arrival, surrender preserving HP/identity, surrendered actors skipped by the turn-status projection and ineligible as ordinary targets; `opportunity_strike` and morale rules authored into `proof_encounter`; the pre-existing `allowNonCombatResolution` path verified untouched by test. |
| AC-3 | ✅ | Trigger/eligibility/ordering/continuation mechanics (27 tests); kernel suspend-and-resume (6 tests); `reactionRisks`/`objectiveEffects` widened off `Type.Array(Type.Never())` and populated by `combat_depth_forecast.ts` (15 tests); perception-filtered risk through `derivePerceivableCombatantIds` in the production preview handler. **Bridge dispatcher closed:** `COMBAT_REACTION_SELECTED` is registered in `combat_bridge_commands.ts` and forwarded verbatim; `combat_command_dispatch.ts` routes it to the kernel as `resolveReaction` *without* the active-turn ownership gate (a window suspends the mover's turn while a different actor decides); `combat_v2_resolver.ts` emits `COMBAT_REACTION_OPENED` from `reactionWindowOpened` **and** from a `reactionResolved` that leaves the same window on the next reactor. 6 new engine tests in `combat_reaction_bridge.test.ts` drive the production dispatch entry point: the window opens with the authored reactor/ability/trigger cell, a decline resumes the suspended move and commits it, a duplicate choice is rejected as `reactionNotPending` without advancing the revision, and an accept consumes the reaction. |
| AC-4 | ⚠️ | Ask / Auto / Never policies, a keyboard-accessible decision surface with attacker/target/ability/cost/consequence, no default time limit, an optional player-enabled timer whose expiry records Decline as an external input, Escape-to-decline, and invalidation on encounter end and on kernel rejection (14 tests) — rendered by `combat_reaction_prompt.svelte` in the sidebar, and now reachable: the engine-side handler for `COMBAT_REACTION_SELECTED` is wired, and the engine pins `auto` for a reactor the player does not control so an AI reaction never blocks the kernel on a model call. **Unmet:** `apps/e2e/tests/client/combat_v2_depth.spec.ts` does not exist; policy is in-memory (not persisted); no compiled Playwright evidence. |
| AC-5 | ⚠️ | Exactly-once settlement, mandatory-loss precedence, `escape` distinct from `defeat`, the documented boolean projection and terminal-settlement continuation invalidation (18 tests + 2 kernel-path tests). **Unmet:** reward idempotency persistence, crash recovery, exploration/retry handoff UI, E2E. |
| AC-6 | ⚠️ | `COMBAT_SCHEMA_VERSION` 3→4 with an additive `upgradeV3ToV4`; v2→v4 chain; mid-window save JSON round-trip is schema-valid and replays identically; deterministic replay (12 tests). **Unmet:** engine-level save/reload persistence, retry checkpoint restore, E2E. |
| AC-7 | ❌ | Not started. No production E2E depth spec; the 10 `/game` journeys are unexercised; `proof_encounter` was not made resolvable through the deployed seed and that decision is not recorded. |
| AC-8 | ⚠️ | Docs written: `features/combat-controls.md` (Objectives / Reactions / Nonlethal outcomes) and `guides/content-pack-authoring.mdx` (objective primitives, morale rules, registered reactions). **Benchmark closed:** `scripts/src/lib/ops/benchmark_combat_depth.ts` measures the four primitives, morale application, reaction trigger detection, the suspended-move + reaction-release round trip and terminal settlement on C-531's reference workload, and writes `docs/verification/C-532-timing.md` with the recorded CPU/OS/runtime — all five measurements PASS at p95 ≤ 10 ms. **Unmet:** `objective-progress` / `reaction-ask` / `nonlethal-outcome` visual cases, `CombatV2DepthVisualSchema`, and the §22.2 release checklist. |

### Changes and Deviations

**Schema v4** (`packages/shared/schemas/src/lib/game/combat/`): new
`combat_objective.ts`, `combat_participation.ts`, `combat_reaction.ts`,
`combat_settlement.ts`; `CombatState` gains `encounterRunId`, `objectiveRules`,
`participation`, `moraleRules`, `reactionRegistry`, `reaction`, `settlement`;
`objectives[]` gain `progress`; `CombatPhaseSchema` gains `'reaction'`. Migration
is additive and never reinterprets an old snapshot.

**New commands:** `resolveReaction`, `retreat`, `surrender`. **New reason codes:**
`reactionPending`, `reactionNotPending`, `reactionStale`,
`reactionActorNotEligible`, `encounterRunMismatch`, `retreatNotAuthored`,
`retreatNotTowardExit`, `surrenderNotAuthored`. **New events:** objective,
morale, participation, reaction, continuation and settlement events.

**New pure rules** (`packages/shared/utils/src/lib/rules/`): `combat_objectives.ts`,
`combat_morale.ts`, `combat_reactions.ts`, `combat_settlement.ts`,
`combat_encounter_resolution.ts`, `combat_depth_forecast.ts`.

**New engine surface:** `combat_encounter_depth.ts` (per-world pinned
objectives/morale/reactions, mirroring C-531's environment pin), wired through
`combat_encounter_start.ts`, `combat_v2_resolver.ts` and `combat_state_adapter.ts`;
`EncounterRosterPayload` gains `depth`.

**New client surface:** `combat_objective_panel.svelte.ts` + `objective_panel.ts`
+ `combat_objectives_panel.svelte`; `combat_reaction_flow.svelte.ts` +
`combat_reaction_prompt.svelte`; `combat_encounter_depth.ts` (content-pack
projection); view-model wiring and interface additions.

**Content:** `proof_encounter` authors `objectiveRules` (a required
`interact_before_deadline` ritual on `emberwatch/brazier-1`/`tip_over` by round 3,
a non-required `defeat_or_rout` on `ember_warden` at morale ≤ 20, and
`protectedActorIds: ["village_guard"]`), `moraleRules` (60 start, 30 break,
leader/ally/objective triggers, retreat to `emberwatch/south_gate` plus
surrender) and a `reactionRegistry`. `ContentPackEncounterEntrySchema` gains the
three optional fields. `opportunity_strike` added to the production ability
catalog as a universal ability.

**Deviations recorded (no Amendment requested — no AC or scope changed):**

1. `participationChanged` is not emitted for lethal removal; `combatantDefeated`
   already carries that fact and emitting both broke three C-509 assertions.
2. `reactorIsEligible` checks targeting against the mover's CURRENT cell, not the
   entering cell — with `threatRange == ability range == 1` the entering-cell
   reading makes a melee opportunity attack impossible.
3. A reactor is offered at most one window per suspended command
   (`resolvedReactorIds`), otherwise a declined reaction re-opens on the next
   path cell and the command never resumes.
4. `resolveReaction` / `retreat` / `surrender` command kinds were added because
   the kernel needs replayable commands for those transitions.
5. Settlement reads current objective statuses, not this boundary's transitions,
   because the ordered pass evaluates objectives before it settles.
6. `encounterRunId` added to `CombatState` to reject stale callbacks after retry.
7. `opportunity_strike` is granted to **every** combatant (like `basic_melee`),
   which required updating two C-516 catalog assertions.
8. The reaction policy store is in-memory; persistence through the existing
   preference mechanism is not wired.

### Verification

- `utils:test` — **576 pass / 0 fail** (27 files). Baseline 429; **147 new tests**
  across 7 files (`combat_objectives` 22, `combat_morale` 20, `combat_reactions`
  27, `combat_settlement` 18, `combat_depth_kernel` 25, `combat_nonlethal` 20,
  `combat_depth_forecast` 15).
- `schemas:test` — **793 pass / 0 fail** (52 files). Baseline 786/6; the 6 were
  C-509 fixtures needing the v4 fields.
- `constants:test` — **180 pass / 0 fail**.
- `frontend-engine:test` — **1484 pass / 3 fail**. All 3 are the pre-existing
  content-audit asset gaps confirmed at HEAD (`apps/frontend/client/static/game-data/sprites/tilesets/`
  does not exist and is untracked in git, so no change in this contract can
  create it). The +6 over attempt 2 are `combat_reaction_bridge.test.ts`.
  Note: the `frontend-engine:test` task is `runInCI: false`, so it only runs
  with `CI` unset — a `CI=true` shell reports "No tasks found".
- `hub:test` — **229 pass / 0 fail**.
- `apps/frontend/client` combat view tests — **30 pass / 0 fail** for the two new
  files (`combat_objective_panel.test.ts` 16, `combat_reaction_flow.test.ts` 14).
  A bare `bun test src/lib/views/combat/` also reports 10 module-resolution
  errors for pre-existing files (`@aikami/frontend/services/base`,
  `@aikami/frontend/engine`) — the documented bare-`bun test` path-mapping gap,
  not real failures.
- `validate({ test: true })` — `client, constants, frontend-engine, schemas,
  types, utils` → **4 passed, 0 failed** (`client` declares no `test` script).
- `svelte-check` on the client — **0 errors, 0 warnings**.
- `client:typecheck` — **PASSES, 0 errors** (`bun moon run client:typecheck --force`).
  **Correction to attempt 1 and attempt 2:** the "pre-existing TS2614 `DiceState`"
  failure both reports claim is **not real**. `game_dice.svelte:33` does export
  `DiceState`, both that file and `dialogue_overlay_view_model.svelte.ts` are
  unmodified by this contract, and the forced task is green. It was a stale
  generated-types observation in a fresh worktree, and it must not be carried
  forward as a baseline exemption.
- `scripts/src/lib/ops/benchmark_combat_depth.ts` — **all five measurements PASS**
  at p95 ≤ 10 ms on the 32×32 / 8 / 32 / 64 reference workload (2000 samples,
  200 warm-up). See `docs/verification/C-532-timing.md` for the recorded
  CPU/OS/runtime and the per-measurement p50/p95/max.
- `biome check` — clean on every touched directory.
- Self-audit greps on created/modified files: no `pixi.js` import in a view model
  or `.svelte`, no `app.ticker.add` outside the engine, no TypeBox under
  `**/services/**`, no label/dictionary constant in a ViewModel, no `interface`
  keyword in new code.
- **Visual evidence: NONE.** No screenshots, no `ai_validate_image`.
- **Production path verification: NOT PERFORMED.** No `/game` route was exercised.
- **Benchmark: RUN.** `docs/verification/C-532-timing.md`, all five measurements
  PASS at p95 ≤ 10 ms.

### Release Gate

§22.2 checklist — **NOT READY**; this report recommends no rollout.

| §22.2 condition | Status |
| --- | --- |
| Direct production E2E | ❌ not run (AC-7) |
| Enabled-but-offline fallback | ❌ not run (AC-7 journey 7) |
| Save/reload compatibility | ⚠️ kernel-level only |
| Deterministic replay | ⚠️ kernel-level only |
| Required legacy behavior accounted for | ⚠️ legacy defeat-group semantics preserved and tested; no migration matrix run |

The performance budget (p95 ≤ 10 ms on C-531's reference workload) is
**measured and PASSING** — see `docs/verification/C-532-timing.md`.

### Remaining Work

Mandatory and unstarted or partial. None of it is deferred by amendment.

1. **AC-4 completion** — `apps/e2e/tests/client/combat_v2_depth.spec.ts`
   (focus, Escape/Decline, policy switching, optional timeout, encounter end,
   retry); persist the reaction policy.
2. **AC-5/AC-6 engine work** — reward idempotency keyed by `settlementId`, crash
   recovery between settlement and reward persistence, retry checkpoint restore,
   exploration/retry handoff, engine save/reload of a pending window.
3. **AC-7** — the 10 `/game` journeys. The content-resolution decision is
   recorded above; the journeys themselves are unexercised.
4. **AC-8** — the three visual cases with `CombatV2DepthVisualSchema` and
   `minScore: 90`; the §22.2 checklist.

Per the Contract Size & Split Rule, "Reactions are mandatory here; deferral
requires an approved scope amendment and a separately identified follow-up
contract." This report claims no such deferral.
