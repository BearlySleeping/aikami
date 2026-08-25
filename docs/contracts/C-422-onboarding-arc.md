---
id: C-422
title: "Guided First-Session Onboarding Arc — widen the hint schema past keybindings, then teach the actual game"
source: "UX review 2026-08-21, re-verified against code 2026-08-21"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/190"
  pr_number: 190
created_at: "2026-08-21"
---

# Contract C-422: Guided First-Session Onboarding Arc

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "empty-state is a dead end; onboarding needs a real arc". Re-verified: the arc already exists but the schema physically cannot express gameplay steps. That blocker is now AC-1. |
| **Target** | `packages/shared/schemas/src/lib/game/onboarding_hints.ts`; `apps/frontend/client/src/lib/services/game/onboarding_hint_service.svelte.ts`; `apps/frontend/client/src/lib/views/game/ui/hud/onboarding_hint.svelte`; `apps/frontend/client/static/content-packs/emberwatch/manifest.json`; `apps/frontend/client/src/lib/views/start/` |
| **Priority** | P1 — first-session retention. Sequenced last of the P1s because it depends on the surfaces the others build. |
| **Sequence** | **5 of 6** — needs C-420's starter chips (AC-4) and C-421's dice (a tutorial step teaches `/roll`) |
| **Dependencies** | C-327 (landed — hint state machine); C-420 (starter chips, sequence 4); C-421 (working dice, sequence 2) |
| **Status** | approved |
| **Promotion** | `integrated` |
| **Docs Impact** | user-facing → `apps/frontend/docs` if the tutorial is documented |
| **Contract version** | 3.0.0 |

## Problem & Baseline Evidence

### Correction: the arc already exists, and is already linear

The review described "a fragmentary hint system, not a tutorial arc, hints
appear contextually but there is no coherent path". Verification does not
support that. `apps/frontend/client/static/content-packs/emberwatch/manifest.json`
ships **five ordered steps chained by `trigger: "after_previous"`**:

```
hint_move      (map_loaded)       "Use {key} to move — try walking around!"
hint_interact  (near_interactable) "Press {key} to interact with people and objects"
hint_quest_log (after_previous)   "Press {key} to open your quest log"
hint_inventory (after_previous)   "Press {key} to check your inventory"
hint_pause     (after_previous)   "Press {key} to pause and save your game"
```

That is a linear arc with keybinding templating. It is not fragmentary.

### The real blocker the review missed

`OnboardingHintStepSchema.action` is a **closed union of nine input action ids**
— `packages/shared/schemas/src/lib/game/onboarding_hints.ts:12-21`:

```
move_up, move_down, move_left, move_right, interact,
open_inventory, open_quest_log, open_character, open_menu
```

You **cannot author** a step for "talk to an NPC", "roll a die", "win a fight",
or "accept a quest" — the schema rejects it at validation. Every gameplay-
teaching step this contract wants requires widening that union first. The
existing arc is keybinding-shaped *because the schema permits nothing else.*

This is why AC-1 exists, and why it must land before any content work.

### What is genuinely missing

- No progress indication — a player cannot tell they are in a tutorial or how
  much is left. `OnboardingHintServiceInterface`
  (`onboarding_hint_service.svelte.ts:29-48`) exposes `currentHint`,
  `hintVisible`, `isComplete` — no index, no total.
- No discoverable skip; `resetOnboarding()` exists on the service but has no
  UI entry point in the start or pause menus.
- Chat's empty state is a dead end (`chat_view.svelte:87`) — addressed by
  C-420 AC-2, which is why this contract sits behind it.
- Nothing teaches conversation, dice, or combat.

- **Reproduction**: fresh profile → drop an API key → open the game. Five
  keybinding toasts fire in order. Nothing teaches what the game *is*.
- **Baseline tests**: `onboarding_hint_service` tests (C-327). Run before starting.

## User Outcome

A **new player** completes a 3–5 minute guided arc that teaches movement,
interaction, conversation, dice and combat, with visible progress and a
discoverable skip. A **returning player** dismisses it once and never sees it
again, but can replay it from the start or pause menu.

## Success Measures

- **Time/latency target**: arc completes in 3–5 minutes; no AI round trip
  required for the core path.
- **Offline/degraded behavior**: every step that can be local is local. Steps
  marked `requiresModel` show a clear message and are skippable without
  blocking the arc.
- **Production journey enabled**: the leap from "dropped a key" to "I
  understand this game" stops being unassisted.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Step schema | `schemas/.../onboarding_hints.ts:12-48` | **modify — widen `action` (AC-1)** |
| Hint state machine | `services/game/onboarding_hint_service.svelte.ts` | modify — expose progress |
| `{key}` templating | same service | reuse — keep for input steps |
| HUD toast | `views/game/ui/hud/onboarding_hint.svelte` | modify — add progress + skip |
| localStorage progress | `OnboardingProgress` (`:21-26`) | reuse — additive migration |
| Authored steps | `content-packs/emberwatch/manifest.json` | modify — extend the arc |
| Starter chips | C-420 AC-2 | reuse — the conversation step |
| Dice | C-421 | reuse — the dice step |

## Overview

Widen the step schema so gameplay can be taught at all, expose progress on the
existing state machine, add skip and replay affordances, then author the
extended arc as content. Schema first, service second, UI third, content last.

## Design Reference

- `schemas/.../onboarding_hints.ts:12-21` — the union to widen.
- `services/game/onboarding_hint_service.svelte.ts:29-48` — the interface to extend.
- `content-packs/emberwatch/manifest.json` — the arc to extend.
- `views/game/ui/hud/onboarding_hint.svelte` — the toast to extend.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Widen `action` to a discriminated shape rather than one flat union, so input
  hints keep `{key}` templating and gameplay steps do not pretend to be
  keybindings:
  `{ kind: 'input', actionId: InputActionId } | { kind: 'event', eventId: string }`.
  Keep `InputActionId` as the input-side source of truth.
- **Additive migration.** Existing manifests use a bare string `action`. Accept
  both shapes at parse time, normalising the legacy form to
  `{ kind: 'input', actionId }`, so Emberwatch's current five steps keep working
  without a content edit.
- Extend `OnboardingHintServiceInterface` with `stepIndex`, `totalSteps` and
  `skipOnboarding()`. Do not restructure the state machine — it works.
- Gameplay steps complete via a new `onEventPerformed(eventId)` alongside the
  existing `onActionPerformed(actionId)`; emit those events from the surfaces
  that already exist (dialogue open, chip tap, roll resolved, combat won).
- Progress in text ("Step 3 of 8"), never colour alone. Esc dismisses the
  current toast; skip is explicit and persists completion.
- Gate the extended arc behind a feature flag so it can be disabled without a
  redeploy.
- Inherits the C-423 baseline — skip/replay are real buttons, keyboard-reachable.

## State & Data Models

```typescript
/** Widened step action. Legacy bare-string `action` normalises to the input form. */
type OnboardingStepAction =
  | { kind: 'input'; actionId: InputActionId }
  | { kind: 'event'; eventId: string };

type OnboardingHintStep = {
  id: string;
  action: OnboardingStepAction;
  /** "{key}" is substituted for input steps only. */
  text: string;
  trigger: 'map_loaded' | 'near_interactable' | 'after_previous';
  /** Step needs a configured model; skippable when none. */
  requiresModel?: boolean;
};
```

Persistence keeps the existing `OnboardingProgress`
(`{ packId, learned, completedAt }`, localStorage). New step ids default to
unlearned; unknown legacy ids are ignored rather than erroring.

**Deliberately not modelled:** `surface`, `title`, and `requiresStepId` from the
v2.0.0 draft. `trigger: 'after_previous'` already sequences steps, the toast has
no title slot, and no step yet needs a non-linear prerequisite. Add them when a
step needs them.

## Quality Requirements

- **Offline/degraded mode**: input and UI steps are fully local. `requiresModel`
  steps show a clear "needs a model" message and can be skipped without
  blocking the remaining steps.
- **Accessibility/input**: progress in text; steps keyboard-reachable; Esc
  dismisses; skip and replay are focusable buttons. Inherits C-423.
- **Performance budget**: DOM/UI only; no engine-loop impact.
- **Security/privacy**: no new data; progress stays in localStorage.
- **Persistence/migration**: legacy bare-string `action` must keep parsing —
  covered by AC-1. Existing `learned` maps stay valid.
- **Cancellation/retry/idempotency**: skip, replay and reset are idempotent.
- **Observability**: log arc start, per-step advance and completion at debug
  level, including the step id at drop-off.

## Migration & Rollback

**Old data compatibility**: existing `OnboardingProgress` records remain valid;
unknown ids ignored, new ids default unlearned. Existing content-pack manifests
parse unchanged via legacy-form normalisation.
**Rollback**: the feature flag disables the extended arc; the schema change is
backward-compatible, so reverting the UI leaves the original five hints working.

## Scope Boundaries

- **In Scope:** widened step schema with legacy compatibility; `stepIndex` /
  `totalSteps` / `skipOnboarding()`; `onEventPerformed`; progress + skip in the
  HUD toast; replay entry points in start and pause menus; the extended default
  arc for Emberwatch; graceful `requiresModel` degradation; feature flag; tests.
- **Out of Scope:** authoring tutorial content for every content pack (this
  ships the framework plus one default arc); the chat empty state (C-420 AC-2);
  changing combat or dialogue mechanics; redesigning the start menu beyond
  adding the replay entry point; onboarding analytics beyond debug logging.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**Four independently-mergeable increments, in this order:**
1. **Schema** — widen `action`, legacy normalisation, tests. *Blocks everything.*
2. **Service** — progress, `skipOnboarding`, `onEventPerformed`.
3. **UI** — progress tracker, skip, replay entry points.
4. **Content** — the extended Emberwatch arc.

## Acceptance Criteria

### AC-1: Step schema can express gameplay, and legacy content still parses

**Given** `OnboardingHintStepSchema`
**When** a step is authored as `{ kind: 'event', eventId: 'npc_dialogue_opened' }`
**Then** it validates; **and** Emberwatch's existing five steps — which use a
bare string `action` — still parse unchanged and behave identically.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `onboarding_hints.test.ts` — both shapes; manifest-parse regression | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run schemas:test`, `moon run client:test-unit`
- Integration: parse the live Emberwatch manifest in a test; assert five steps
  normalise to `kind: 'input'`. **A content edit to make this pass is a fail.**

### AC-2: Service exposes progress and skip

**Given** a loaded arc
**When** the service is queried
**Then** it exposes `stepIndex`, `totalSteps` and `skipOnboarding()`; steps
advance on `onActionPerformed` (input) and `onEventPerformed` (event);
completion persists and `isComplete` reports it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `onboarding_hint_service.test.ts` (extended) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: advance a mixed input/event arc; assert index, persistence, skip.

### AC-3: Visible progress, skip, and discoverable replay

**Given** a player in the arc
**When** the hint toast renders
**Then** it shows "Step 3 of 8" as text, a focusable Skip that persists
completion, and Esc dismisses the current toast; a "How to play / Replay
tutorial" entry exists in **both** the start menu and the pause menu.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | `onboarding_hint.test.ts`; `onboarding_arc.spec.ts` | start + in-game | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:test-client`
- Integration: walk the arc, skip mid-way, reload, assert it stays skipped,
  replay from the pause menu.

### AC-4: The arc teaches the game, not just the keys

**Given** a fresh profile with a configured model
**When** the extended Emberwatch arc runs
**Then** it covers movement, interaction, **conversation** (using C-420 starter
chips), **a dice roll** (using C-421), and **a combat encounter** — in 3–5
minutes — with each gameplay step completing via a real emitted event.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `onboarding_arc.spec.ts` — full walkthrough | new-player journey | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test-client`
- Integration: drive the whole arc end to end; assert every step completes from
  a real gameplay event, not a test-only hook. The E2E must enable the extended-arc
  feature flag (or assert the flag is on by default) before walking the arc —
  otherwise the test silently exercises only the legacy five-step arc.

### AC-5: Model-dependent steps degrade

**Given** a `requiresModel: true` step and no configured provider
**When** the step is reached
**Then** the player sees a clear "needs a model" message and can skip that step
without blocking the rest of the arc.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `onboarding_hint_service.test.ts` (no-model case) | onboarding | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: run the arc with no provider; assert it reaches completion.

## Implementation Sequence

1. **Phase 1 (Schema)** — Widen `action` to the discriminated shape with legacy
   normalisation. Prove the live Emberwatch manifest parses untouched. Ship.
2. **Phase 2 (Service)** — Add `stepIndex`, `totalSteps`, `skipOnboarding()`,
   `onEventPerformed`. Emit the gameplay events from existing surfaces. Ship.
3. **Phase 3 (UI)** — Progress tracker and Skip in the toast; replay entries in
   the start and pause menus. Ship.
4. **Phase 4 (Content)** — Author the extended arc behind the feature flag;
   write the E2E walkthrough. Ship.
5. **Phase 5 (Validation)** — `moon run schemas:test`,
   `moon run client:test-unit`, `moon run e2e:test-client`, `bun run typecheck`.

## Edge Cases & Gotchas

- **Do not edit the Emberwatch manifest to make AC-1 pass.** The point of the
  legacy-normalisation path is that shipped content keeps working; editing the
  content hides a real compatibility break from every other pack.
- `{key}` templating is meaningless for event steps. Substitution must be
  skipped for `kind: 'event'`, not left to emit a literal `{key}`.
- `hint_interact` uses `trigger: 'near_interactable'`, which the service tracks
  with a one-shot `_nearInteractableTriggered` flag
  (`onboarding_hint_service.svelte.ts:70`). Adding steps after it must not
  depend on that flag re-arming.
- The arc spans surfaces the player can leave — a step waiting on a combat win
  strands the arc if they flee. Every gameplay step needs a skip path or a
  timeout, or the tutorial deadlocks.
- The service is keyed per content pack (`packId`). A player switching packs
  mid-arc must not inherit half-learned state from another pack.
- 3–5 minutes is a real constraint. Eight steps at 30 seconds each is already
  the ceiling — resist adding a ninth.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1 — is the combat step (AC-4) in the first cut?** Combat is the longest,
  most failure-prone step, it is the one that can strand the arc, and it is the
  hardest to E2E deterministically. **Recommendation: yes, but last and
  skippable** — a player who never sees combat has not been taught the game;
  a player stuck in it has been taught to quit.
- **OQ-2 — which event ids do gameplay steps listen to?** These must come from
  events the game already emits, or they become new instrumentation.
  **Resolve by grepping the existing event surface before Phase 2**, and
  prefer an existing event over a new one in every case.
  **Partially resolved from codebase evidence (2026-08-21):** the engine bridge
  already emits `NPC_DIALOG_START` (conversation step), `COMBAT_ENDED` /
  `ENCOUNTER_COMPLETED` (combat step), and `MAP_LOADED` /
  `INTERACTION_TARGET_CHANGED` (movement/interaction). The **dice-roll event is
  the one genuinely open item** — it must come from C-421's `/roll`
  implementation, which is still `draft`. If C-421 has not landed a roll event
  by Phase 2, the dice step must listen to whatever C-421 emits, or be dropped
  from the first cut (see OQ-1).

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-08-21 | Initial draft from UX review. | — |
| 3.0.0 | 2026-08-21 | Re-verified against code. Corrected the premise: the arc is already linear — Emberwatch ships five ordered steps chained by `after_previous` — so "fragmentary hints, not an arc" was false. Surfaced the blocker the review missed and promoted it to AC-1: `OnboardingHintStepSchema.action` is a closed union of nine `InputActionId` values (`onboarding_hints.ts:12-21`), so no gameplay step can be authored at all; added a discriminated `action` shape with legacy normalisation so shipped content keeps parsing. Dropped `surface`, `title` and `requiresStepId` from the data model as unused. Added AC-4 (the arc must teach gameplay via real events) and AC-5. Added the arc-deadlock and pack-switch gotchas, Implementation Sequence, and lifecycle sections. Resequenced to 5 of 6, behind C-420 and C-421 whose surfaces it teaches. | review 2026-08-21 |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`**; AC-4 requires `release_verified`-level evidence — a
full new-player walkthrough recording.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
