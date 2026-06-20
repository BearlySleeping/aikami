## Metadata

| Field | Value |
|---|---|
| **Source** | Architect MVP Polish |
| **Target** | `packages/frontend/engine/src/` — Engine Physics, Camera, and Shader Polish |
| **Priority** | P0 — Critical for core gameplay feel and visual correctness |
| **Dependencies** | C-137, C-140 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

We need to fix three critical engine bugs to achieve a fluid, free-roaming RPG feel. First, the LPC multi-layer shader is currently breaking alpha blending and Z-index compositing. Second, the movement system forces rigid grid-snapping that breaks diagonal flow and wall-sliding. Finally, the camera system uses a hardcoded scale that causes premature boundary clamping, creating the illusion that the player is walking off the map.

## Design Reference

Follow the standard Back-To-Front Alpha Blending (painter's algorithm) for GLSL. For movement, replace the grid-resolver with axis-independent continuous collision detection.

## Architecture Directives

- **LPC Shader Fix**: Rewrite `LPC_MULTI_LAYER_FRAGMENT_SHADER` in `sprite_composer.ts`. It must use `src + dst * (1.0 - src.a)` instead of the broken destination-over formula, and avoid double-multiplying the alpha.
- **Fluid Movement**: Gut the strict 32x32 grid behavior in `movement_system.ts`. Remove `resolveDiagonalVelocity` and replace the `updateMovement` loop with an axis-independent position calculator that uses `isWalkable` checks separately for X and Y, allowing the player to slide cleanly along walls.
- **Dynamic Camera Scale**: Update `camera_system.ts` to accept an optional `scale` parameter in `setScreenSize`, replacing the hardcoded `WORLD_SCALE = 4`. Ensure `game_world.ts` passes the active container scale to this function during resize events.

## State & Data Models

    // GLSL Shader Blending (sprite_composer.ts)
    // Replace the main loop with back-to-front compositing:
    if (u_active_layers[0] > 0.5) {
        float a = texture(uTexture0, vUV).r;
        vec4 src = vec4(u_layer_tints[0].rgb * a, a);
        result = src + result * (1.0 - src.a);
    }
    // ... repeat for all 8 layers ...
    
    // Movement Logic (movement_system.ts)
    let nextX = pos.x + vel.x * deltaSeconds;
    let nextY = pos.y + vel.y * deltaSeconds;
    
    if (!isWalkable(nextX, pos.y)) nextX = pos.x; 
    if (!isWalkable(nextX, nextY)) nextY = pos.y; 

## Acceptance Criteria

### AC-1: Correct Z-Index Rendering
**Given** an LPC entity with multiple appearance layers
**When** rendered to the canvas
**Then** hair and clothing layers composite correctly over the body without dark artifacts or rendering behind the base texture.

### AC-2: Fluid Wall Sliding
**Given** the player is moving diagonally into a solid wall
**When** the velocity updates the position
**Then** the player slides smoothly along the unblocked axis rather than stopping entirely or snapping to a grid cell.

### AC-3: Accurate Camera Clamping
**Given** the player moves to the extreme edge of a map
**When** the camera calculates its boundaries
**Then** the camera tracks the player all the way to the visual edge without locking prematurely.

**Test Hooks**:
- Unit: Update `movement_system.test.ts` to verify axis-independent wall sliding. Update `camera_system.test.ts` to verify clamping behavior with different scale values.
- Visual: Use the `sandbox_visual.ts` E2E scripts to verify wall collision and camera tracking visually.

## Implementation Notes

1. **Files to modify**: 
    - `packages/frontend/engine/src/rendering/sprite_composer.ts`
    - `packages/frontend/engine/src/systems/movement_system.ts`
    - `packages/frontend/engine/src/systems/camera_system.ts`
    - `packages/frontend/engine/src/game_world.ts`
2. **Order of operations**: 
    - Apply the shader math fix.
    - Rip out the grid snap logic in the movement system and implement axis-independent AABB checks.
    - Refactor `setScreenSize` to accept the scale and wire it into the `GameWorld` resize handler.

## Edge Cases & Gotchas

- **Movement Tracking**: Ensure `resetMovementTracking` remains exported in `movement_system.ts` to avoid breaking downstream imports, even if its internal grid-clearing logic becomes a no-op.
- **GLSL Precision**: Maintain `precision highp float;` in the shader to avoid mobile artifacting.
- **Scale Fallback**: Default `currentWorldScale` to 4 if the scale parameter is missing to preserve fallback behavior.
