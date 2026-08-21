---
id: C-424
title: "Unified Message Surfaces — shared RichMessageList + GuidedComposer across chat, dialogue overlay, and vendor"
source: "UX review 2026-08-21 — 'Duplicated surfaces (chat vs dialogue overlay vs vendor) re-implement list-of-messages + input'; 'chat_view_model 1100 lines, combat_view_model 1640 lines'"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-424: Unified Message Surfaces

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "Unify chat/dialogue/vendor message surfaces; reduce duplicated ViewModels". |
| **Target** | `apps/frontend/client/src/lib/views/chat/chat_view.svelte`; `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` (1100 lines); `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` (1640 lines); `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` (692 lines); `apps/frontend/client/src/lib/views/vendor/vendor_view.svelte` (628 lines) |
| **Priority** | P2 — maintainability + consistency; high payoff (removes duplicated logic and forces coherent UX) but not a first-session blocker |
| **Dependencies** | C-420 (planned — shared guided chips); C-421 (planned — shared dice card); C-231 (landed — rich chat streaming / `EnhancedChatMessage`) |
| **Status** | draft |
| **Promotion** | `sandbox` |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Aikami re-implements the "list of messages + input/composer" pattern in at least three surfaces that are currently divergent:
  - **Chat** (`chat_view.svelte` + `chat_view_model.svelte.ts`, 1100 lines) — `EnhancedChatMessage`, CYOA choices, slash-command autocomplete, streaming TTS, impersonation.
  - **Dialogue overlay** (`dialogue_overlay.svelte`, 692 lines + its ViewModel) — a parallel dialogue implementation with its own choice rendering.
  - **Vendor** (`vendor_view.svelte`, 628 lines) — its own list/interaction surface.
  These surfaces have drifted: chat got rich streaming (C-231), CYOA (C-245), and branching; dialogue/vendor did not get the same treatment. The large ViewModels (chat 1100, combat 1640 lines) indicate too much responsibility in one object, which accrues bugs and merge pain.
- **Reproduction**: Interact with an NPC in chat, then in an in-game dialogue — the choice/message UX differs. The `EnhancedChatMessage` rich features (swipe/alternatives, action bar, dice card after C-421) don't appear in dialogue or vendor because those are separate implementations.
- **Existing implementation to reuse**: `EnhancedChatMessage` (rich message), `ChoiceButtonsView`/`GuidedChipsView` (C-420), `AutoResizeTextarea`, `CombatDiceUi`/`DiceCard` (C-421), `BaseViewModel`/`BaseViewModelContainer` patterns, `npc_dialogue_service`.
- **Known gaps**: (a) three divergent message/composer surfaces; (b) no shared `RichMessageList` component; (c) ViewModels too large; (d) rich chat features don't propagate to dialogue/vendor.
- **Baseline tests**: `chat_view_model` tests, `dialogue_overlay_view_model.test.ts`, `combat_view_model.test.ts`, `choice_buttons_view_model.test.ts`. Run all before starting.

## User Outcome

After this contract, a **player** gets a consistent rich-message and composer experience whether chatting with an NPC in the chat view, in an in-game dialogue, or at a vendor — the same dice cards, guided chips, streaming, and action affordances. A **developer** maintains one `RichMessageList` + `GuidedComposer` rather than three divergent implementations, and ViewModels are decomposed into focused sub-services.

## Success Measures

- **Time/latency target**: no regression; shared components are at least as fast as the current surfaces.
- **Offline/degraded behavior**: the shared surfaces preserve current offline behavior (chat works offline; dialogue/vendor behavior unchanged when AI is down).
- **Production journey enabled**: a consistent, coherent NPC interaction model across all surfaces; a healthier codebase that's cheaper to extend.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Rich message rendering | `components/chat/enhanced_chat_message.svelte` | reuse — extract to shared `RichMessageList` |
| Composer/input | `components/chat/auto_resize_textarea.svelte` | reuse — shared `GuidedComposer` |
| Choice/guided chips | `views/chat/choice_buttons_view.svelte` + C-420 `GuidedChipsView` | reuse — shared |
| Dice card | C-421 `DiceCard` (planned) | reuse — shared |
| Dialogue surface | `views/game/ui/overlays/dialogue/dialogue_overlay.svelte` | modify — consume shared components |
| Vendor surface | `views/vendor/vendor_view.svelte` | modify — consume shared components |
| Large ViewModels | `chat_view_model.svelte.ts` (1100), `combat_view_model.svelte.ts` (1640) | refactor — decompose into focused sub-services |

## Overview

Extract a shared **`RichMessageList`** and **`GuidedComposer`** from the chat implementation, then rewire the dialogue overlay and vendor surfaces to consume them, so all NPC-interaction surfaces share the same rich message, guided-chip, dice-card, streaming, and action-bar behavior. In parallel, decompose the largest ViewModels (chat 1100, combat 1640 lines) into focused sub-services the ViewModel composes, so each object has a single responsibility.

## Design Reference

- `views/chat/chat_view.svelte` — the richest current surface; the source for the shared components.
- `components/chat/enhanced_chat_message.svelte`, `auto_resize_textarea.svelte`, `message_action_bar.svelte` — building blocks.
- `views/game/ui/overlays/dialogue/dialogue_overlay.svelte` + `views/vendor/vendor_view.svelte` — surfaces to converge.
- `BaseViewModel`/`BaseViewModelContainer` — the ViewModel pattern to keep (and decompose within).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Extract `RichMessageList` and `GuidedComposer` as shared components under `components/`, consuming `EnhancedChatMessage`, `GuidedChipsView` (C-420), `DiceCard` (C-421), `AutoResizeTextarea`, and `MessageActionBar`.
- Rewire `dialogue_overlay.svelte` and `vendor_view.svelte` to consume the shared components, preserving their surface-specific concerns (e.g. vendor buy/sell actions, dialogue skill checks) as wrappers.
- Decompose `chat_view_model.svelte.ts` and `combat_view_model.svelte.ts`: extract cohesive sub-services (e.g. turn state, dice, combat log for combat; message state, composer, choices for chat) that the ViewModel composes. Do not change external behavior — this is structural.
- Keep each surface's unique behavior (vendor economy, dialogue checks) intact; only unify the message/composer layer.

## State & Data Models

No new persistent state. The decomposition introduces internal sub-service objects (not serialized). Where shared message types exist, they are reused; new shared component props are typed interfaces.

```typescript
type RichMessageListProps = {
  messages: RichMessage[]; // shared message shape (C-231 + dice/choice kinds)
  characterName?: string;
  avatarUrl?: string;
  onAction?(messageId: string, action: MessageAction): void;
  renderFooter?: (messageId: string) => Snippet; // surface-specific extras
};

type GuidedComposerProps = {
  onSend(text: string): void;
  chips?: GuidedChipSet; // C-420
  placeholder?: string;
  disabled?: boolean;
  extras?: Snippet; // surface-specific actions (e.g. vendor buy)
};
```

## Quality Requirements

- **Offline/degraded mode**: preserve per-surface offline behavior; shared components must not introduce online requirements.
- **Accessibility/input**: the shared components inherit the accessibility baseline from C-423 (no hover-only actions, keyboard-reachable). Refactor must not regress.
- **Performance budget**: shared components must not exceed current render cost; keep within DOM layer (no engine-loop impact). Watch for re-render overhead in large message lists (keyed `{#each}`).
- **Security/privacy**: no new data exposure; reuse existing message schemas.
- **Persistence/migration**: no persistent state change; message rendering is presentational. No migration.
- **Cancellation/retry/idempotency**: composer/streaming behavior preserved.
- **Observability**: ViewModel decomposition should not lose existing logging; add coverage where the refactor touches.

## Migration & Rollback

N/A — no persistent state changes (structural refactor + shared components). **Rollback** = revert the extraction/rewire; chat implementation remains as the source of truth. Because this is a large refactor, **land it incrementally** (shared components first, then rewire dialogue, then vendor, then decompose ViewModels) with tests green at each step.

## Scope Boundaries

- **In Scope:** shared `RichMessageList` + `GuidedComposer`; rewiring dialogue + vendor to consume them; decomposing `chat_view_model` + `combat_view_model` into sub-services; tests.
- **Out of Scope:** changing chat/gameplay behavior; rewriting the engine; changing vendor economy or combat rules; redesigning the composer UX beyond unification.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** must be split into independently-mergeable increments to be safe:
1. Extract shared `RichMessageList` + `GuidedComposer` (no behavior change in chat).
2. Rewire dialogue overlay to shared components.
3. Rewire vendor to shared components.
4. Decompose `chat_view_model`; then `combat_view_model`.
Each increment is independently mergeable with green tests.

## Acceptance Criteria

### AC-1: Shared RichMessageList + GuidedComposer extracted
**Given** the chat surface
**When** the shared components are extracted and chat is rewired to use them
**Then** chat behavior is unchanged (rich streaming, choices, action bar, dice cards all render identically), and the shared components exist with tests.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Visual | shared component tests + existing chat tests still green | chat | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: chat regression — full chat session works identically.

### AC-2: Dialogue overlay consumes shared components
**Given** an in-game dialogue
**When** the dialogue overlay is rewired to `RichMessageList`/`GuidedComposer`
**Then** the dialogue gets the same rich message, guided-chip (C-420), and dice-card (C-421) behavior as chat, while preserving its skill-check and surface-specific concerns.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `dialogue_overlay_view_model.test.ts` (extended) | in-game dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: in-game dialogue — assert rich messages + chips render.

### AC-3: Vendor consumes shared components
**Given** a vendor interaction
**When** the vendor surface is rewired to the shared components
**Then** vendor messages use the shared rich rendering while preserving buy/sell/economy actions.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Visual | vendor view test | vendor | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: vendor — assert shared rendering + buy/sell intact.

### AC-4: ViewModels decomposed
**Given** `chat_view_model.svelte.ts` and `combat_view_model.svelte.ts`
**When** they are decomposed into focused sub-services
**Then** each ViewModel is meaningfully smaller, behavior is unchanged (all existing tests green), and each sub-service has a single responsibility with its own tests.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | refactored ViewModel tests + sub-service tests | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: run full client test suite; assert all pre-existing tests still pass and line-count reduction is verified.
