## Metadata

| Field | Value |
|---|---|
| **Source** | Architect UX Polish |
| **Target** | `apps/frontend/client/src/lib/views/game/` — Spatial Svelte UI and Camera |
| **Priority** | P0 — Core immersion |
| **Dependencies** | C-137, C-128 |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

We need to anchor our Svelte UI to the PixiJS game world so it feels like a unified experience. Instead of static sidebars, dialogue bubbles should float over NPC heads, and the camera should dynamically zoom to frame interactions, mirroring modern JRPGs.

## Design Reference

Follow the existing ECS bridge pattern to push screen-space coordinates to the UI layer.

## Architecture Directives

- Update `camera_system.ts` and the `EngineBridge` to emit a `STATE_UPDATE` payload that includes the screen-space (X, Y) coordinates of the active `dialogueNpc`.
- Modify `dialogue_overlay.svelte` to use these coordinates to absolutely position a Svelte-driven speech bubble above the NPC.
- Introduce a `zoom` factor to `camera_system.ts`. When `NPC_INTERACTED` fires, tween the zoom from `1.0` to `1.5` and center the midpoint between the player and the NPC. Revert to `1.0` on `NPC_DIALOG_END`.

## State & Data Models

    // In types.ts, extend the bridge update payload:
    export interface GameStateUpdatePayload {
        // ... existing fields ...
        cameraZoom: number;
        activeNpcScreenX?: number;
        activeNpcScreenY?: number;
    }

## Acceptance Criteria

### AC-1: Spatial Speech Bubbles
**Given** the player triggers dialogue with an NPC
**When** the dialogue UI mounts
**Then** the NPC's speech bubble is absolutely positioned in the Svelte DOM directly over the NPC's rendered PixiJS sprite, updating smoothly if the camera moves.

### AC-2: Cinematic Camera Zoom
**Given** the player is exploring at 1.0x zoom
**When** dialogue begins
**Then** the camera lerps to 1.5x zoom centered on the interaction, and lerps back to 1.0x when the dialogue overlay closes.

**Test Hooks**:
- Visual: Use `sandbox_visual.ts` to trigger a mock dialogue and capture a screenshot verifying the speech bubble overlaps the NPC's head bounding box.
- E2E: Assert the `transform: translate` or `top`/`left` CSS properties of the speech bubble exist and are > 0.

## Implementation Notes

1. **Files to modify**: 
    - `packages/frontend/engine/src/systems/camera_system.ts`
    - `packages/frontend/engine/src/worker/ecs_worker.ts`
    - `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`
2. **Order of operations**: 
    - Implement camera zoom and midpoint calculation.
    - Export projection coordinates from the engine to the View Model.
    - Wire the Svelte dialogue view to track the exported coordinates.

## Edge Cases & Gotchas

- **Coordinate Projection**: Remember that Pixi world coordinates differ from DOM screen coordinates. Apply the current world scale and camera offset before sending X/Y to Svelte.
- **Off-screen Bubbles**: Ensure the speech bubble stays clamped to the viewport edges if the NPC is near the top of the screen.
