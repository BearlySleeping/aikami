---
id: C-532
title: "Contract C-532: Combat-08 — Objectives, Morale, Reactions, and Release Gate"
source: "docs/architecture/combat_2.md §9, §14, §17–18, §21–22, §26"
contract_type: full
status: draft
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
| **Source**             | `docs/architecture/combat_2.md` §9, §14, §21.4, §22.2–22.3, §26                                                                                                   |
| **Target**             | Encounter objective/morale resolution, reaction continuation, outcome persistence, production proof encounter, release evidence                                   |
| **Type**               | full                                                                                                                                                              |
| **Priority**           | P1 — Combat 2.0 needs encounter depth and complete production evidence before rollout                                                                             |
| **Dependencies**       | C-531 verified; C-526 approval/continuation/lifecycle corrections verified; C-509/C-514/C-515/C-516/C-525 behavior retained                                       |
| **Status**             | draft                                                                                                                                                             |
| **Promotion**          | —                                                                                                                                                                 |
| **Docs Impact**        | user-facing → `apps/frontend/docs/src/content/docs/features/combat-controls.md`; creator-facing encounter rules; `docs/architecture/combat_2.md` release evidence |
| **Contract version**   | 1.0.0                                                                                                                                                             |
| **Production Surface** | `/game` → authored encounter → objectives/reactions/morale → outcome → exploration or defeat/retry                                                                |

## Problem & Baseline Evidence

Baseline reviewed on 2026-09-14 against PR #352 head
`9d93a3f4f01eebfc5da92f5c24a429a9968fd014`; C-531 is a planned dependency.

- `packages/shared/schemas/src/lib/game/combat/combat_state.ts` deliberately
  omits a reaction phase. `reactionAvailable` exists without the full reaction
  resolution requested here.
- Existing objective state is a placeholder rather than a complete authored
  objective evaluator with terminal precedence.
- Tactical forecasts reserve reaction/objective information that must become
  meaningful for supported mechanics.
- C-526 adds character policy and companion control, but character intent alone
  cannot determine mechanical surrender, retreat, objectives, or rewards.
- C-531 supplies environmental state, effects, and the authored proof content.
- The architecture requires real `/game` journeys, AI-offline completion,
  save/replay evidence, and a legacy-removal gate.
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
- Objective/morale/reaction evaluation meets p95 ≤10 ms on C-531's reference
  workload, excluding rendering, player waiting, and model latency.
- Accepted input replay reproduces state, events, outcomes, and RNG without AI.
- All mandatory production and migration gates pass before recommending rollout.

## Existing System & Reuse Map

| Capability           | Existing source                                                                 | Reuse / modify / replace                   |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ |
| State and budgets    | `packages/shared/schemas/src/lib/game/combat/combat_state.ts`                   | Add objective/morale/reaction state        |
| Kernel and forecasts | `packages/shared/utils/src/lib/rules/`                                          | Extend ordered resolution and previews     |
| Turn driver          | `packages/frontend/engine/src/combat/combat_turn_driver.ts`                     | Integrate suspended/resumed actions        |
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
	currentReactorId: string;
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
- Do not reduce escape/surrender to `hp = 0` or `defeated = true`.
- If existing consumers require a boolean victory projection, define the
  mapping explicitly while retaining the richer authoritative outcome.
- Add objective, morale, reaction, surrender, escape, and settlement events to
  narration fact rendering. Free prose never determines those facts.

## Quality Requirements

- **Offline/degraded mode:** Objectives, morale, reactions, settlement, direct
  controls, and saves work without AI, network, or sign-in.
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
  policy. Do not reinterpret old commands under new reaction rules.
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
**Watch Points:** Leader and ally triggers from the same event; blocked exits;
surrendered units in initiative and target selectors.

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
| AC-4 | Compiled integration + E2E | `apps/e2e/tests/client/combat_v2_depth.spec.ts` | `/game` reaction controls | Pending  |

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

**Given** the C-531 authored fixture with one real companion and three enemies,
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
provider boundary. Keep an independent unreachable-provider lane.
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
| AC-8 | Visual + benchmark + release review | `combat.visual.ts`, release checklist, updated docs | `/game` complete combat shell | Pending  |

**Test Hooks:** Extend existing `defineConfig`/default-export suite with
`objective-progress`, `reaction-ask`, and `nonlethal-outcome` cases using `/game`
fixture setup. TypeBox fields: `score`, `objectiveReadable`,
`reactionChoicesVisible`, `turnOwnershipClear`, `outcomeConsistent`,
`layoutCorrect`, `issues`. Require applicable booleans and score ≥90.
Assess visible objective/deadline, reaction cost/target, unobscured controls,
and accurate outcome labels. Functional tests establish mechanics.

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

1. Confirm corrected C-526 and verified C-531 baseline; inventory current
   settlement/reward consumers and persistence behavior.
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

Not executed. Record actual starting revision, verified dependency evidence,
authored fixture availability, and baseline commands/results.

### Acceptance Evidence

AC-1 through AC-8: Pending. Replace with per-AC implementation and evidence.

### Changes and Deviations

Pending. List state/protocol changes, migrations, reward handling, files,
decisions, and approved amendments.

### Verification

Pending. Record exact unit/integration/E2E commands and results, visual
evaluation artifacts, benchmark hardware/results, and baseline failures.

### Release Gate

Pending. Record each §22.2 condition separately and recommend ready/not ready.
Do not mark verified/completed while any mandatory AC remains unmet.

### Remaining Work

Pending. Any deferred mandatory behavior requires an explicit scope amendment;
a follow-up task alone does not make this contract complete.
