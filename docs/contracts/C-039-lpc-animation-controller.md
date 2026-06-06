<!-- completed: 2026-06-02 -->
# Contract: C-039 LPC Animation Controller

## Metadata
| Source | Target | Priority | Dependencies | Status | Version |
|--------|--------|----------|--------------|--------|---------|
| Engine Architecture | Game Client View | High | C-036, C-038 | completed | 1.0.0 |

## Overview
This contract establishes a zero-allocation sprite state and animation controller that wires bitECS entity velocity/movement directional vectors to individual LPC spritesheet frames. It calculates runtime frame indices using continuous tick counters, updating the UV textures processed by the custom multi-layer shader without invalidating pipeline or geometry structures.

## Design Reference
- `packages/frontend/engine/src/rendering/texture_manager.ts`: Grayscale sub-texture grid slice coordinates and frame lookups.
- `packages/frontend/engine/src/components/velocity.ts`: Directional movement tracking array inputs.
- `packages/frontend/engine/src/systems/render_system.ts`: Unified sprite tick compilation loop.

## Changes Detail
### New Files

#### `packages/frontend/engine/src/rendering/animation_controller.ts`
- Define `LpcAnimationState` enum mapping standard LPC rows to animation actions: `SPELLCAST` (0-3), `THRUST` (4-7), `WALK` (8-11), `SLASH` (12-15), `SHOOT` (16-19), `DIE` (20).
- Define `LpcDirection` enum mapping directions to rows offsets: `UP` (0), `LEFT` (1), `DOWN` (2), `RIGHT` (3).
- Implement an optimized `getLpcFrameIndex(state: LpcAnimationState, direction: LpcDirection, tickCount: number): number` pure index computer that performs safe modulus wrapping against the frame limits of each cycle.

### Modified Files

#### `packages/frontend/engine/src/systems/render_system.ts`
- Introduce an internal frame update system `animateEntitySystem(world)` running right before uniform buffer flushes.
- Query active bitECS matching groups containing `Velocity` and `Appearance` components.
- Derive `LpcDirection` from non-zero velocity thresholds, step the local entity animation timer, compute the structural frame index string, and update the target sprite descriptor via `TextureManager.getFrameAt()`.

## Acceptance Criteria
### AC-1: Velocity Vector to Directional Row Translation
- **Given** an active entity with directional components mapped inside the ECS engine.
- **When** velocity changes from stable rest to traveling vectors (e.g., `vx: 0, vy: -2`).
- **Then** the animation runtime must shift the target frame range instantly to row 8 (`WALK_UP` starting offset).
- *Test Hook*: Assert coordinate row calculations match design definitions inside tests.

### AC-2: Modulus Frame Wrapping Without Index Overflow Boundary Leaks
- **Given** an entity stuck inside a long-duration action block sequence.
- **When** global tick counts advance sequentially past the max frames of the state loop (e.g., walk frame 9).
- **Then** the returned sub-texture index must wrap back within its boundaries (frame 0-8 offset arrays) avoiding lookups out of range.
- *Test Hook*: Stress loop indices with extreme tick variations inside validation specs.

## Implementation Notes
1. Create `packages/frontend/engine/src/rendering/animation_controller.ts` following strict snake_case layouts.
2. Update the sync mechanics within `render_system.ts` to couple state rows to visible texture updates.
3. Validate entire package configurations across code and formatting rules.
