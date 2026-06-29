<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Architect UX Polish |
| **Target** | `apps/frontend/client/src/lib/views/` and `packages/frontend/engine/src/` — Visual/Audio Juice |
| **Priority** | P1 — Game feel |
| **Dependencies** | C-145, C-153 |
| **Status** | **completed**  |
| **Contract version** | 1.0.0 |

## Overview

Game actions currently lack weight. We need to implement visceral feedback: syncing inventory changes to the on-screen Pixi sprite (Paper doll sync), adding floating damage numbers during combat, and triggering screen shake.

## Design Reference

Follow the audio hook patterns from C-150 and the spatial UI concept from C-161.

## Architecture Directives

- **Paper Doll Sync**: In `inventory_view_model.svelte.ts`, when `equipItem()` is called, immediately trigger a re-compilation of the player's `Appearance` component in the ECS. Play `sfx_pickup.wav` synchronously.
- **Floating Damage**: Modify `turn_manager_system.ts` to emit a `DAMAGE_DEALT` event containing the target entity's screen coordinates and the damage amount. Use a temporary Svelte component (`floating_text.svelte`) injected into the UI overlay that CSS-animates upward and fades out over 1 second.
- **Screen Shake**: When `DAMAGE_DEALT` fires for the player, apply a CSS `transform: translate()` jitter animation to the `#game-canvas-container` for 200ms.

## State & Data Models

    // Bridge event payload
    export interface DamageDealtPayload {
        entityId: number;
        amount: number;
        isCritical: boolean;
        screenX: number;
        screenY: number;
    }

## Acceptance Criteria

### AC-1: Paper Doll Equip Sync
**Given** the player equips a visible item (e.g., armor)
**When** the action resolves
**Then** `sfx_pickup.wav` plays and the player's on-canvas LPC sprite updates instantly to reflect the new layer.

### AC-2: Visceral Combat Hits
**Given** an attack connects in the combat loop
**When** damage is applied
**Then** red text floating from the target's coordinates floats upward in the Svelte UI, `sfx_hit.wav` plays, and the screen shakes if the player was hit.

**Test Hooks**:
- Visual: Use `combat_sandbox.spec.ts` to trigger an attack and verify via screenshot that the red `.floating-damage-text` node is present in the DOM.

## Implementation Notes

1. **Files to create**: `apps/frontend/client/src/lib/components/game/floating_text.svelte`
2. **Files to modify**: 
    - `packages/frontend/engine/src/systems/turn_manager_system.ts`
    - `apps/frontend/client/src/lib/views/inventory/inventory_view_model.svelte.ts`
    - `apps/frontend/client/src/lib/views/game/canvas/game_view.svelte`
3. **Order of operations**: 
    - Wire equipment state directly to the ECS `Appearance` component update loop.
    - Add the `DAMAGE_DEALT` event to the engine bridge.
    - Build the floating text component and coordinate tracker.

## Edge Cases & Gotchas

- **Garbage Collection**: Floating text components must aggressively clean themselves up (e.g., unmount after 1s) to prevent DOM node leaks during extended combat.
- **CSS Shake vs Canvas Shake**: Shake the CSS container housing the canvas, not the internal PixiJS camera, to avoid recalculating all entity projections.
