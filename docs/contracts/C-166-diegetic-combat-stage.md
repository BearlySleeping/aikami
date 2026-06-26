## Metadata

| Field | Value |
|---|---|
| **Source** | Architect UX Polish |
| **Target** | `packages/frontend/engine/src/` and Diegetic UI components |
| **Priority** | P0 — Visual Combat Representation |
| **Dependencies** | C-161, C-164 |
| **Status** | ✅ completed |
| **Contract version** | 1.0.0 |

## Overview

The right-side PixiJS canvas must transform into a dedicated "Battle Stage". We need to reposition sprites to face each other (JRPG style), trigger animations during custom actions, and project world coordinates to Svelte to render diegetic floating health bars.

## Design Reference

Follow the projection matrix logic established in the Spatial UI (C-161) contract. 

## Architecture Directives

- **Battle Scene Swap**: Upon entering combat, create a system that disables free-roaming camera tracking. Snap the player's LPC sprite to a fixed left-side coordinate (e.g., `x: screenWidth * 0.2`) and the enemy to a right-side coordinate (`x: screenWidth * 0.8`), facing each other.
- **Diegetic HP Bars**: The engine `Bridge` must emit `COMBAT_STATE_UPDATE` every frame (or on camera/entity move) containing the screen-space `X, Y` coordinates of all active combatants. Create `diegetic_health_bar.svelte` components that absolutely position themselves over these coordinates.
- **Action Visualization**: When the player submits a "Custom Action", trigger the PixiJS `AnimationController` to play a looping `walk` or `attack` animation, and tween the sprite a few pixels forward to indicate they are "acting" while the LLM generates the text.

## State & Data Models

    export interface CombatantScreenState {
        entityId: number;
        hp: number;
        maxHp: number;
        screenX: number;
        screenY: number;
        isActiveTurn: boolean;
    }

## Acceptance Criteria

### AC-1: JRPG Stage Positioning
**Given** the game transitions to combat
**When** the canvas resizes
**Then** the player and enemy sprites are instantly repositioned into a standoff formation (Left vs Right), ignoring their previous overworld positions.

### AC-2: Floating Health Bars
**Given** combatants are on screen
**When** the Svelte UI mounts
**Then** health bars are rendered in the DOM, positioned perfectly above the PixiJS sprites based on the engine's projected coordinates.

### AC-3: Custom Action Animation
**Given** the player submits a custom text action
**When** the LLM is processing
**Then** the player's sprite animates (steps forward) to provide immediate visual feedback of the pending action.

**Test Hooks**:
- E2E: Validate that the `.diegetic-hp-bar` DOM nodes have dynamic `top` and `left` inline styles applied.

## Implementation Notes

1. **Files to modify**: 
    - `packages/frontend/engine/src/systems/combat_render_system.ts` (New or repurposed)
    - `packages/frontend/engine/src/worker/ecs_worker.ts`
    - `apps/frontend/client/src/lib/views/combat/components/diegetic_health_bar.svelte`
2. **Order of operations**: 
    - Build the engine logic to lock the camera and reposition sprites for the "Stage".
    - Export the screen-space projection coordinates.
    - Wire the Svelte HP bars to the projected coordinates.

## Edge Cases & Gotchas

- **State Reversion**: When combat ends and the game reverts to `EXPLORE`, ensure the sprites snap back to their actual overworld map coordinates and the free-roaming camera tracking resumes.
