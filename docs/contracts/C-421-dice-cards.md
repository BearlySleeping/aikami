---
id: C-421
title: "Mechanically-Authoritative Dice Cards — rich roll rendering in chat and combat, with mechanical results fed to NPC narration"
source: "UX review 2026-08-21 — 'Dice are functional but not dramatized; mechanical results should be authoritative and visible'"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-421: Mechanically-Authoritative Dice Cards

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "Mechanically-authoritative dice cards in chat" improvement. |
| **Target** | `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts`; `apps/frontend/client/src/lib/views/chat/`; `apps/frontend/client/src/lib/views/combat/`; `packages/shared/schemas` (dice event schema); `apps/frontend/client/src/lib/components/game/game_dice.svelte` |
| **Priority** | P1 — makes Aikami feel like a real TTRPG rather than "AI pretend dice"; builds directly on the existing seeded dice service |
| **Dependencies** | C-148 (landed — combat dice / `GameDice`); C-231 (landed — rich chat streaming / message types) |
| **Status** | draft |
| **Promotion** | `sandbox` |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The dice service (`dice_service.svelte.ts`) is fully capable — `roll`, `rollD20` (with `isCriticalSuccess`/`isCriticalFailure`), `rollCheck` (success/DC/difference), `rollNotation`, seeded RNG, and a `history` array. But in the **chat view**, a `/roll 1d20+3` renders as **plain text** — the rich dice experience (`GameDice` animated d20, `CombatDiceUi`) exists only in **combat**. More importantly, the mechanical result is **not authoritative**: combat narration flows through the LLM, and the rolled outcome isn't visibly enforced or fed back into the prompt as a ground-truth constraint. So the AI can narrate a hit that the mechanics said missed (or vice versa), and the player can't see the actual math.
- **Reproduction**: In a chat, type `/roll 1d20+3`. Observe a plain-text result with no die face, no crit flash, no DC comparison. Then in combat, note that the NPC's narration is not visibly constrained by the rolled success/failure.
- **Existing implementation to reuse**: `DiceService` (all roll methods + history + seeding); `GameDice` component (`DiceState`: `phase`, `value`, `isSuccess`, `labels`); `CombatDiceUi` mapping; `rollCheck` already returns `{ success, total, difference }`.
- **Known gaps**: (a) no rich *dice card* message type in chat; (b) DC/advantage/check comparison not visualized; (c) mechanical result not injected into NPC prompt as authoritative ground truth; (d) dice history not surfaced as a browsable feed.
- **Baseline tests**: `dice_service.test.ts` exists (C-148). `combat_view_model.test.ts` exists. Run both before starting.

## User Outcome

After this contract, a **player** who rolls dice in chat sees a rich animated dice card: the die face, the modifier, the total, and (for checks) a `Nat 20 + 3 = 23 vs DC 15 ✓` comparison with crit highlighting. The same visual language appears in combat. The NPC narration is constrained to respect the rolled result. A **player** can open a dice history feed to review past rolls.

## Success Measures

- **Time/latency target**: dice card renders instantly (client-side roll); no added latency.
- **Offline/degraded behavior**: dice are deterministic, seeded, client-side — fully offline. No AI required for the roll itself.
- **Production journey enabled**: players trust that rolls are real and respected — the core emotional contract of a tabletop RPG.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Roll mechanics (d20, checks, notation, seeding) | `services/dice/dice_service.svelte.ts` | reuse — unchanged |
| Animated die face | `components/game/game_dice.svelte` (`DiceState`) | reuse — extend for multi-die / card layout |
| Combat dice overlay | `views/combat/components/combat_dice_ui.svelte` | reuse — keep, add card message type |
| Chat message types | `packages/shared` message schema (C-231) | modify — add a `dice` message kind |
| Roll history | `DiceService.history` | reuse — surface as a feed |

## Overview

Add a rich **dice card** message type to the chat view (and reuse the same component in combat) that renders rolls with die faces, modifiers, totals, and check comparisons with crit highlighting. Make the mechanical result **authoritative**: the resolved success/failure and total are injected into the NPC/game prompt as ground truth, and the narration is instructed to respect it. Surface the existing roll history as a browsable feed.

## Design Reference

- `services/dice/dice_service.svelte.ts` — the source of truth for roll resolution.
- `components/game/game_dice.svelte` — existing `DiceState` animation to reuse.
- `views/chat/chat_view.svelte` message list — where the new message kind is rendered.
- `packages/shared` message schema (C-231 `EnhancedChatMessage`) — where the `dice` message type is defined.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Define a `dice` chat message kind in `packages/shared` with the full resolved shape (dice, modifiers, total, check context, crit flags).
- Create a shared `DiceCard` component (reusing `GameDice`) rendered by both chat and combat.
- Resolve rolls through `DiceService` so the card reflects the *same* source of truth as combat.
- On a check, emit the result (success/total/DC/difference) into the NPC prompt as authoritative context, and instruct narration to respect it.
- Add a roll-history feed view surfaced from `DiceService.history`.

## State & Data Models

```typescript
type DiceCardData = {
  id: string;
  /** Raw notation, e.g. "1d20+3". */
  notation: string;
  /** Individual die results. */
  dice: { sides: number; value: number }[];
  /** Sum of dice + modifiers. */
  total: number;
  /** Optional check context. */
  check?: {
    dc: number;
    success: boolean;
    difference: number;
    ability?: string; // e.g. "Persuasion"
    advantage?: boolean;
    disadvantage?: boolean;
  };
  /** Crit flags from rollD20. */
  isCriticalSuccess?: boolean;
  isCriticalFailure?: boolean;
  timestamp: Date;
};
```

```typescript
type AuthoritativeRollResult = {
  total: number;
  success: boolean | null; // null for non-check rolls
  dc?: number;
  difference?: number;
  natural: number;
  isCriticalSuccess: boolean;
  isCriticalFailure: boolean;
};
```

The `AuthoritativeRollResult` is injected into the NPC/game prompt as ground truth before the narration turn, with an instruction to narrate consistently with it.

## Quality Requirements

- **Offline/degraded mode**: fully offline — rolls are seeded client-side; no AI required for the roll, only for narration which degrades gracefully.
- **Accessibility/input**: dice cards must convey outcome in text (not color alone) for color-blind users; `✓`/`✗` plus "Success"/"Failure" text. Keyboard-focusable where interactive.
- **Performance budget**: animation via existing `GameDice`; card render is DOM, outside the 60fps engine loop. No engine impact.
- **Security/privacy**: rolls are local player data; no new exposure. Validate notation parsing to prevent abuse.
- **Persistence/migration**: dice cards are part of the chat transcript; already persisted as messages. No new migration for the card; history feed reads existing `history` state.
- **Cancellation/retry/idempotency**: rolls are deterministic given a seed; re-rolling is a new roll. Idempotent rendering.
- **Observability**: log injection of authoritative roll results at debug level to verify prompt-fidelity.

## Migration & Rollback

Old chat transcripts contain plain-text roll messages; the new `dice` kind is additive. **Old data compatibility**: existing text rolls remain as text (optionally re-rendered client-side into cards if parseable). **Migration**: none required — new rolls use the new kind. **Rollback**: revert message kind + card component; old rolls unaffected.

## Scope Boundaries

- **In Scope:** `dice` chat message kind; shared `DiceCard` component (chat + combat); authoritative roll-result injection into NPC prompt; roll-history feed; tests.
- **Out of Scope:** changing the seeded RNG semantics (C-148); redesigning combat turn logic; changing dice-service API surface; multiplayer roll syncing.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the shared `DiceCard` component + message kind is independently mergeable and should land first (pure visualization). Authoritative prompt-injection is a second independently-mergeable increment (behavioral). Roll-history feed is a third.

## Acceptance Criteria

### AC-1: Dice card message kind in chat
**Given** a user issues `/roll 1d20+3` in chat
**When** the roll resolves through `DiceService`
**Then** a rich dice card renders with the die face, modifier, total, and — for a check — a `Nat 20 + 3 = 23 vs DC 15 ✓` comparison with crit highlighting; the card conveys outcome in both text and color.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Visual | `dice_service.test.ts` (extended) + card component test | chat | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: browser — issue `/roll`, assert card renders with correct math.

### AC-2: Dice card in combat reuses same component
**Given** combat resolves an attack/check roll
**When** the roll completes
**Then** the same `DiceCard` component renders the result, consistent with the existing `GameDice` animation, with check comparison when a DC is present.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `combat_view_model.test.ts` (extended) | combat | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: enter combat, assert roll card renders.

### AC-3: Mechanical result is authoritative in narration
**Given** a check resolves with a concrete `AuthoritativeRollResult`
**When** the NPC narration turn is generated
**Then** the result (total, success, DC, crits) is injected into the prompt as ground truth and the narration is instructed to respect it; a logged assertion verifies the injection.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | prompt-injection test | combat + chat checks | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: run a mock narration with an injected failed check; assert the narration prompt contains the authoritative result and a "respect it" instruction.

### AC-4: Roll-history feed
**Given** the player has made rolls
**When** the player opens the roll-history feed
**Then** past rolls (from `DiceService.history`) render with notation, result, and timestamp, browsable in a compact feed.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Visual | history-feed test | settings/chat | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: make several rolls, open feed, assert all present.
