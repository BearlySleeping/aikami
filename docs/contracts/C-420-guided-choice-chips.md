---
id: C-420
title: "Guided-Choice Chips Everywhere — a shared, model-driven quick-reply primitive for chat and game dialogue"
source: "UX review 2026-08-21 (guided generation / suggestion chips pattern, generalized from Marinara-Engine MARI_SUGGESTION_CHIPS_TASK.md and existing CYOA ChoiceButtonsView)"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-420: Guided-Choice Chips Everywhere

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "Guided generation / suggestion chips" improvement. Pattern generalized from `examples/Marinara-Engine/MARI_SUGGESTION_CHIPS_TASK.md` and Aikami's existing CYOA `ChoiceButtonsView`. |
| **Target** | `packages/shared/schemas/src/lib/game/cyoa.ts`; `packages/shared/types/src/lib/game/cyoa.ts`; `packages/frontend/services` (agent/gateway event channel); `apps/frontend/client/src/lib/views/chat/choice_buttons_view.svelte`; `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`; `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte` |
| **Priority** | P1 — biggest UX win for first-session retention; cheap because the core (CYOA choices, chip rendering) already exists |
| **Dependencies** | C-245 (landed — CYOA Choices Branching Narrative); C-128/C-129 (landed — dialogue overlay + AI chat); C-231 (landed — rich chat streaming) |
| **Status** | draft |
| **Promotion** | `sandbox` |
| **Docs Impact** | internal (no user-facing docs) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Aikami has two *separate* guided-choice mechanisms that never talk to each other:
  1. **CYOA choice buttons** (`ChoiceButtonsView` + `ChoiceButtonsViewModel`, contract C-245) — structured `CyoaChoice[]` (label + optional description + optional `skillCheck`), 2–4 choices, rendered below the latest AI message in **chat only**.
  2. **Dialogue overlay** (`dialogue_overlay.svelte`, 692 lines) — its own choice rendering inside the game view, parallel and divergent from chat.
  There is **no** lightweight "suggestion chip" path: after an NPC reply the model can't emit 3–5 short quick-reply chips unless it goes through the full CYOA structured-output path, and CYOA isn't wired into the game dialogue overlay at all.
- **Reproduction**: Open a fresh chat with an NPC (empty-state shows `"No messages yet. Start the conversation!"`). There are no starter chips or suggested replies — the user faces a blank textarea. In-game, a dialogue has no suggestion chips either. Compare: Marinara's `MARI_SUGGESTION_CHIPS` renders starter chips on empty transcripts and dynamic chips after each model turn.
- **Existing implementation to reuse**: `ChoiceButtonsViewModel` (label truncation via `CYOA_LABEL_MAX_LENGTH`, single-choice → "Continue", selection/dismissal state machine, choice history store); `CyoaChoiceSchema`/`CyoaChoice` in `packages/shared/`; `GameDice`/dice service; the agent event/gateway channel that already carries `CyoaChoiceResult`.
- **Known gaps**: (a) no chip primitive distinct from CYOA — chips should *append to composer* (not auto-send), while CYOA *selects a branch*; (b) not wired into game dialogue; (c) no starter chips on empty state; (d) no `entity`/`tone` coloring on chips.
- **Baseline tests**: `choice_buttons_view_model.test.ts` exists (C-245). `dialogue_overlay_view_model.test.ts` exists. Run both before starting.

## User Outcome

After this contract, a **player** can start a chat and immediately see 3–5 suggested replies (starter chips on a fresh chat, dynamic chips after each NPC turn), tap one to drop it into the composer, refine it, and send — in **both** the chat view and the in-game dialogue overlay. A **creator** sees the same guided-choice behavior in both surfaces, driven by one shared, model-emitted primitive.

## Success Measures

- **Time/latency target**: chips render with the completed assistant turn (no extra round trip); starter chips show <100ms on a fresh chat.
- **Offline/degraded behavior**: chips are model-driven — when the AI is unavailable, chips simply don't render; the composer still works normally. Starter chips (static) can render offline.
- **Production journey enabled**: a first-time player goes from "blank chat" to a guided conversation in one tap — the single biggest drop-off point for AI-RPG onboarding.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Chip/choice button rendering | `views/chat/choice_buttons_view.svelte` | modify — generalize to a shared `GuidedChipsView` |
| Choice selection state machine | `views/chat/choice_buttons_view_model.svelte.ts` | reuse — extend with append-to-composer mode |
| Choice data model | `packages/shared/schemas/src/lib/game/cyoa.ts` (`CyoaChoiceSchema`) | modify — add `GuidedChipSchema` alongside |
| Agent event channel | `packages/frontend/services` (CYOA result delivery) | modify — add a `suggestions`/`guided_chips` event type |
| Game dialogue choices | `views/game/ui/overlays/dialogue/dialogue_overlay.svelte` | modify — render shared chips component |
| Starter chips | `examples/Marinara-Engine/MARI_SUGGESTION_CHIPS_TASK.md` (`MARI_STARTER_CHIPS`) | reference — Aikami-local equivalent |
| NPC dialogue service | `services/game/npc_dialogue_service.svelte` | modify — thread chip delivery through |

## Overview

Introduce a shared, model-driven **guided-choice chip** primitive and render it in both the chat view and the in-game dialogue overlay. The chip set is emitted by the agent after a completed assistant turn (or statically provided as starter chips on an empty transcript). Tapping a chip **inserts its prompt into the composer** (append, don't auto-send) so the user can refine before sending — distinct from CYOA which auto-advances a branch. This unifies two divergent surfaces behind one primitive and eliminates the dead first-session chat.

## Design Reference

- `views/chat/choice_buttons_view.svelte` + `choice_buttons_view_model.svelte.ts` — existing chip-like button pattern (label truncation, single-choice "Continue", selection/dismiss).
- `packages/shared/schemas/src/lib/game/cyoa.ts` — schema conventions (TypeBox, `Type.Object`, maxItems).
- `dialogue_overlay_view_model.svelte.ts` — how the game overlay currently renders dialogue choices.
- Marinara's `MARI_SUGGESTION_CHIPS_TASK.md` interaction model: on empty transcript show starter chips; after each turn show dynamic chips; `onSelect` inserts into draft (append with separating space if non-empty), focus composer, **do not auto-send**.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Add `GuidedChip` to `packages/shared/types` and `GuidedChipSchema` to `packages/shared/schemas` (domain-level; Pi resolves exact file placement).
- Add a new agent event type (e.g. `guided_chips`) delivered over the existing agent event/gateway channel, alongside `CyoaChoiceResult`.
- Render via a shared `GuidedChipsView` component used by both `chat_view.svelte` and `dialogue_overlay.svelte`.
- Chip selection appends to the composer draft and focuses it — it does **not** auto-send. This is the deliberate difference from CYOA.
- Keep the primitive optional/back-compat: no `guided_chips` in a turn ⇒ emit nothing.

## State & Data Models

```typescript
type GuidedChip = {
  id: string;
  /** Short button label (≤ 40 chars). */
  label: string;
  /** Exact message text inserted into the composer on tap (≤ 400 chars). */
  prompt: string;
  /** Optional hint for chip coloring/grouping. */
  entity?: 'characters' | 'lorebooks' | 'personas' | 'presets' | 'connections' | 'agents' | 'settings' | 'chat';
  /** Optional tone for emphasis; use 'danger' only for irreversible actions. */
  tone?: 'danger' | 'caution' | 'success';
};
```

```typescript
type GuidedChipSet = {
  chips: GuidedChip[]; // 1..6
  chatId: string;
};
```

Sanitization rules (server/client-side, mirrored from Marinara): cap at 6 chips; drop entries missing `label` or `prompt`; truncate `label` to 40 chars and `prompt` to 400 chars; coerce `entity`/`tone` to allowed unions (drop invalid); generate an `id` if absent.

## Quality Requirements

- **Offline/degraded mode**: chips are absent when no model output; static starter chips render offline from bundled config.
- **Accessibility/input**: chips are real buttons with visible focus, keyboard-activatable (Enter/Space), and not hover-only.
- **Performance budget**: chip set is ≤6 items; rendering is a static list — negligible frame cost. No impact on the 60fps engine loop.
- **Security/privacy**: chip `prompt` is user-authored text inserted into a local composer; sanitize lengths to prevent layout abuse. No new data exposure.
- **Persistence/migration**: chips are ephemeral per turn; not persisted. No migration.
- **Cancellation/retry/idempotency**: clearing chips on new send / chat switch / reset is idempotent.
- **Observability**: log parse failures of malformed chip payloads at debug level.

## Migration & Rollback

N/A — no persistent state changes. Chips are per-turn ephemeral UI. Rollback = revert the shared component and event handling.

## Scope Boundaries

- **In Scope:** shared `GuidedChip` type + schema; `guided_chips` agent event; shared `GuidedChipsView`; wiring into chat view (starter + dynamic chips); wiring into game dialogue overlay (dynamic chips); append-to-composer selection semantics; tests.
- **Out of Scope:** CYOA branching narrative changes (that's C-245, already landed); redesigning the composer; multiplayer; changing existing NPC dialogue data models beyond adding optional chip delivery.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one cohesive unit (shared primitive + two surface integrations). The shared primitive (type + schema + event) is independently mergeable and should land first; chat wiring and dialogue wiring are each independently mergeable increments.

## Acceptance Criteria

### AC-1: Shared chip primitive exists
**Given** the `packages/shared` packages
**When** a `GuidedChip` / `GuidedChipSchema` and a `guided_chips` agent event type are added
**Then** the type, schema, and event type exist with sanitization (cap 6, truncate label/prompt, coerce entity/tone) and are covered by unit tests.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/.../guided_chip.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `schemas:test` / `types:test`
- Integration: unit tests only

### AC-2: Starter chips on empty chat
**Given** a fresh chat with an NPC that has no messages
**When** the chat view renders
**Then** 3–5 starter chips render above the composer; tapping one appends its prompt to the draft and focuses the composer (does not auto-send).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `choice_buttons_view_model.test.ts` (extended) | `/game/...` chat | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: browser check on a fresh NPC chat; assert chips render and append to draft.

### AC-3: Dynamic chips after each NPC turn (chat)
**Given** an assistant reply completes in the chat view
**When** the model emitted a `guided_chips` payload for that turn
**Then** the chips render above the composer (replacing the previous set); selecting one appends to the draft; chips clear on a new send, chat switch, and reset.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | `chat_view_model.test.ts` (extended) | chat | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: drive a mock agent turn with chips; assert render + append + clear semantics.

### AC-4: Dynamic chips in game dialogue overlay
**Given** an in-game dialogue with an NPC completes a turn
**When** the model emitted `guided_chips` for that turn
**Then** the chips render in the dialogue overlay above its input, using the same shared component, with the same append-to-composer behavior.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Visual | `dialogue_overlay_view_model.test.ts` (extended) | in-game dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: start an in-game dialogue; assert chips appear and append to the overlay composer.

## Open Questions

- **OQ-1 — Should starter chips be static per-NPC (bundled config) or model-generated on first load?** Static is offline-safe and instant; model-generated is more personalized but needs a round trip. Recommendation: static per-NPC default with optional model override, but this is a design call to confirm.
- **OQ-2 — Does the game dialogue overlay already have a composer/draft mechanism to reuse, or does one need adding?** Affects AC-4 scope.
