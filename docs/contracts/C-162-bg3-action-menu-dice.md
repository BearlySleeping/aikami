## Metadata

| Field | Value |
|---|---|
| **Source** | Architect UX Polish |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/` — Action Context Menu & Dice |
| **Priority** | P0 — Latency masking and gameplay loop |
| **Dependencies** | C-148, C-161 |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

To prevent "blank canvas paralysis" and mask the 2-5 second LLM extraction latency, we are introducing a BG3-style action menu and making the d20 roll interactive. The player clicks to roll the dice, covering the LLM network wait time.

## Design Reference

Extend the `CombatDiceUi` component created in C-148 to be generic and interactive.

## Architecture Directives

- Replace the standard chat input in `dialogue_overlay.svelte` with a radial or horizontal Action Context Menu featuring pre-written intent buttons: `[Persuasion]`, `[Intimidation]`, `[Stealth]`, `[Attack]`, and `[Custom]`.
- Clicking `[Attack]` must bypass the LLM entirely, emit `trigger_combat` via the bridge, and swap modes.
- When an action requires a roll (e.g., Persuasion), pause the `textGenerationService` request. Mount a massive, interactive 3D/CSS d20 in the center of the screen.
- Require the player to physically click the dice to roll. Only *after* the animation lands and displays the result should the prompt (+ dice result) be sent to the LLM to stream the outcome.

## State & Data Models

    export interface ActionOption {
        id: string;
        label: string;
        type: 'skill_check' | 'direct_combat' | 'custom';
        skill?: string;
    }

## Acceptance Criteria

### AC-1: Action Context Menu
**Given** the player is in dialogue
**When** it is the player's turn to act
**Then** the UI displays discrete action buttons (Persuade, Attack, Custom) instead of just a raw text box.

### AC-2: Interactive Latency Masking
**Given** the player selects a skill check action
**When** the action is clicked
**Then** a large d20 appears. The LLM request does NOT fire until the player clicks the dice, the roll animation finishes, and the result is appended to the context.

**Test Hooks**:
- E2E: Use Playwright to click the `[Persuasion]` button, assert the LLM network request has *not* fired, click the `.dice-trigger` element, wait 2 seconds, and assert the network request fires with the roll result.

## Implementation Notes

1. **Files to modify**: 
    - `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`
    - `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts`
    - `apps/frontend/client/src/lib/views/combat/components/combat_dice_ui.svelte` (Extract to shared component)
2. **Order of operations**: 
    - Build the Action Menu UI.
    - Hook `[Attack]` directly to `gameStateService.setMode('COMBAT')`.
    - Refactor the dice component to require a click event to trigger the spin animation.

## Edge Cases & Gotchas

- **State Locks**: Disable all other UI interactions (inventory, escape menu) while the dice is waiting to be clicked to prevent state de-syncs.
