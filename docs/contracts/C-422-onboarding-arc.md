---
id: C-422
title: "Guided First-Session Onboarding Arc — replace dead empty-states with a real tutorial that bridges chat → combat → world"
source: "UX review 2026-08-21 — 'Empty-state is a dead end', 'Onboarding needs a real tutorial arc, not just hint bubbles'"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-422: Guided First-Session Onboarding Arc

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "Empty-state + onboarding arc" improvement. |
| **Target** | `apps/frontend/client/src/lib/services/game/onboarding_hint_service.svelte.ts`; `apps/frontend/client/src/lib/views/chat/chat_view.svelte`; `apps/frontend/client/src/lib/views/start/`; `apps/frontend/client/src/lib/views/onboarding/`; `apps/frontend/client/src/lib/views/game/ui/hud/onboarding_hint.svelte` |
| **Priority** | P1 — first-session retention is the make-or-break for an AI RPG; the infrastructure (hint state machine) already exists |
| **Dependencies** | C-327 (landed — onboarding hint state machine); C-420 (planned — guided-choice chips for starter chips) |
| **Status** | draft |
| **Promotion** | `sandbox` |
| **Docs Impact** | user-facing → `apps/frontend/docs` (if the tutorial is documented) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The onboarding hint system (`onboarding_hint_service.svelte.ts`, contract C-327) is a capable **state machine** — it shows contextual tutorial toasts, marks hints learned when the player performs the action, persists per-pack in localStorage, and supports replay/reset. But it is a **fragmentary hint system**, not a tutorial **arc**: hints appear contextually but there is no coherent first-session path that takes a new player from "dropped an API key" through "I understand this is a chat, this is combat, this is my world." Empty-states are dead ends — the chat view shows `"No messages yet. Start the conversation!"`, and the first-run experience (drop a key → here's the world) is a large leap for a non-technical player.
- **Reproduction**: Create a new account, drop an API key, open the game. There is no guided 3-minute walkthrough; onboarding hints fire opportunistically but don't form a structured path. A new player may not know how to talk to an NPC, how to roll dice, or how combat works.
- **Existing implementation to reuse**: `OnboardingHintService` (state machine, `loadOnboarding`, `onActionPerformed`, `resetOnboarding`, `currentHint`, `isComplete`, localStorage persistence); `OnboardingHint` HUD component; C-420's starter chips (planned); the start menu and onboarding routes.
- **Known gaps**: (a) no structured multi-step arc, just independent hints; (b) no progress indicator / sense of "this is a tutorial"; (c) empty-states don't guide; (d) no skip-and-replay UX that's discoverable.
- **Baseline tests**: `onboarding_hint_service` tests exist (C-327). Run before starting.

## User Outcome

After this contract, a **new player** completes a guided 3–5 minute onboarding arc in their first session: it introduces the character, the chat/dialogue, dice rolling, the HUD, and combat, with clear progress and the ability to skip or replay at any time. A **player** who already knows the game can dismiss onboarding once and never see it again.

## Success Measures

- **Time/latency target**: onboarding arc is 3–5 minutes; zero added latency (purely UI/UX orchestration, no AI round trips required for the core path).
- **Offline/degraded behavior**: the tutorial is entirely local and works offline; AI-dependent steps (e.g. "talk to an NPC") degrade to a simulated/dry-run path or a "this needs a model" message.
- **Production journey enabled**: a first-time player goes from sign-up to a coherent first gameplay loop without getting stuck — the highest-leverage retention lever.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Hint state machine | `services/game/onboarding_hint_service.svelte.ts` | reuse — extend into a sequence/arc |
| HUD hint toast | `views/game/ui/hud/onboarding_hint.svelte` | reuse — extend with progress + step UI |
| Starter chips | C-420 `GuidedChipsView` (planned) | reuse — starter chips in empty state |
| Start/onboarding routes | `views/start/`, `views/onboarding/` | modify — wire an arc |
| Empty-state text | `views/chat/chat_view.svelte` | modify — replace dead-end with guided content |

## Overview

Turn the fragmentary hint system into a structured, guided **onboarding arc** that walks a first-time player through the core loops: meet your character, learn chat/dialogue (with starter chips), learn dice, understand the HUD, and experience combat. Add a visible progress indicator, a discoverable skip/replay affordance, and replace dead empty-states with guided content that points toward the next step.

## Design Reference

- `services/game/onboarding_hint_service.svelte.ts` — the existing state machine to extend.
- `views/game/ui/hud/onboarding_hint.svelte` — the existing hint HUD to extend.
- C-420 `GuidedChipsView` (planned) — starter chips in the empty state.
- `views/start/` and `views/onboarding/` — existing onboarding surfaces.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Extend `OnboardingHintService` to model a **sequence of steps** (an arc) in addition to independent hints, with a `currentStep`, `stepIndex`, and `totalSteps` exposed for progress UI.
- Add a visible onboarding progress indicator (e.g. a slim step tracker) and a persistent "How to play / Replay tutorial" affordance in the start menu and pause menu.
- Replace the chat empty-state dead-end with a guided panel that uses starter chips (from C-420) and contextual next-step prompts.
- Add skip and replay; persist "onboarding complete" per user so it shows once.
- AI-dependent steps degrade gracefully offline (dry-run/simulated path or clear messaging).

## State & Data Models

```typescript
type OnboardingStep = {
  id: string;
  title: string;
  /** Short instruction shown to the player. */
  body: string;
  /** The action that marks this step learned. */
  learnActionId: string;
  /** Where in the UI this step is anchored (chat, combat, hud, start). */
  surface: 'start' | 'chat' | 'combat' | 'hud' | 'dialogue';
  /** Optional prerequisite step id. */
  requiresStepId?: string;
  /** Optional: AI required for this step? */
  requiresModel?: boolean;
};

type OnboardingArc = {
  id: string;
  title: string;
  steps: OnboardingStep[];
};
```

Progress is persisted via the existing `OnboardingProgress` (localStorage): `{ packId, learned, completedAt }`. A step is "learned" when its `learnActionId` fires through `onActionPerformed`.

## Quality Requirements

- **Offline/degraded mode**: core tutorial steps are local and offline; `requiresModel` steps show a clear "needs a model" message when AI is unavailable, and can be skipped without blocking the arc.
- **Accessibility/input**: onboarding steps are keyboard-reachable; progress is conveyed in text ("Step 2 of 5") not color alone; hints dismissible by Esc.
- **Performance budget**: pure DOM/UI; no engine-loop impact.
- **Security/privacy**: no new data; progress is local. No exposure.
- **Persistence/migration**: onboarding completion persists in localStorage via existing mechanism; old hint progress remains compatible (a completed hint set simply maps to "arc done"). Migration: reconcile `learned` map with new step ids.
- **Cancellation/retry/idempotency**: skip/replay are idempotent; reset restores a fresh arc.
- **Observability**: log arc start/complete and where players drop off (step id) at debug level for onboarding analytics.

## Migration & Rollback

**Old data compatibility**: existing `OnboardingProgress` records remain valid; new steps get default unlearned state. **Migration**: map old hint-ids to new step-ids where they overlap; anything unknown defaults to unlearned. **Rollback**: revert the arc UI; hints fall back to the existing fragmentary mode. No persistent game-world state changes. **Feature flag**: gate the arc behind a flag so it can be disabled without redeploy.

## Scope Boundaries

- **In Scope:** onboarding arc model + service extension; progress step tracker; skip/replay affordances; empty-state replacement (chat + dialogue); graceful degradation for model-dependent steps; tests.
- **Out of Scope:** content-authoring for every world's tutorial (arc is framework + default content); changing combat mechanics; redesigning the start menu beyond adding the tutorial affordance; multiplayer onboarding.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the service-level arc model + progress is one independently-mergeable unit; the UI (step tracker, skip/replay, empty-state replacement) is a second; content (default arc steps) is a third.

## Acceptance Criteria

### AC-1: Onboarding arc model in the service
**Given** the `OnboardingHintService`
**When** an arc is loaded
**Then** it exposes `currentStep`, `stepIndex`, `totalSteps`, and advances steps as `learnActionId`s fire; completion persists and is reported via `isComplete`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `onboarding_hint_service.test.ts` (extended) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: unit test arc advance + persistence.

### AC-2: Visible progress + skip/replay
**Given** a player in the onboarding arc
**When** the arc renders
**Then** a step tracker shows "Step 2 of 5", a Skip button dismisses the arc (persisting completion), and a "Replay tutorial / How to play" affordance is discoverable in start and pause menus.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Visual + Unit | HUD/onboarding component test | start + game | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: browser — walk the arc, assert progress, skip, and replay.

### AC-3: Empty-state replacement with starter chips
**Given** a fresh chat (or dialogue) with no messages
**When** the surface renders
**Then** instead of a dead-end text, a guided panel renders with starter chips (from C-420) and a contextual next-step prompt, so the player always has a clear action.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Visual | `chat_view`/`dialogue_overlay` component test | chat + dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: browser — fresh chat, assert guided panel + starter chips.

### AC-4: Model-dependent steps degrade gracefully
**Given** an onboarding step with `requiresModel: true` while the AI is unavailable
**When** the step is reached
**Then** the player sees a clear "needs a model" message and can skip the step without blocking the rest of the arc.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | service test with no model | onboarding | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: simulate no-model, assert step degrades and is skippable.
