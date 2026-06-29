<!-- completed: 2026-06-29 -->
# Contract: C-040 Grid Movement Transform Pipeline
<!-- completed: 2026-06-02 -->

## Metadata
| Source | Target | Priority | Dependencies | Status | completed |
|--------|--------|----------|--------------|--------|---------|
| Engine Architecture | Game Client View | High | C-036, C-039 | completed | 1.0.0 |

## Overview
This contract establishes a high-performance tile-grid movement and transform integration pipeline. It bridges bitECS position components (`Position`) and movement commands with pixel space coordinates, mapping cellular configurations cleanly onto structural view transforms. This ensures sprite position synchronization scales cleanly without causing pipeline or matrix invalidation stalls in the rendering thread.

## Design Reference
- `packages/frontend/engine/src/components/position.ts`: bitECS continuous floating point coordinate array slices (`x`, `y`).
- `packages/frontend/engine/src/systems/movement_system.ts`: Spatial translation mechanics.
- `packages/frontend/engine/src/systems/render_system.ts`: `LpcBatchManager` matrix updates.

## Changes Detail
### Modified Files

#### `packages/frontend/engine/src/systems/movement_system.ts`
- Implement standard 2D grid cell constraint matching loops (32x32 pixel stride definitions).
- Interpolate positions smoothly from source cell coordinates to target cell paths based on the entity's active `Velocity`.
- Block out diagonal drift patterns to ensure rigid directional velocity alignment remains accurate for the `LpcAnimationController`.

#### `packages/frontend/engine/src/systems/render_system.ts`
- Integrate cell position calculation layers to convert floating point simulation data into visual screen transforms.
- Synchronize spatial translations cleanly with standard custom container layout bounds before flushing frame drawing allocations to the screen context.

## Acceptance Criteria
### AC-1: Fixed Pixel Stride Cell Grid Lock alignment
- **Given** an active entity spawned at localized point origins (`x: 0, y: 0`).
- **When** movement commands trigger directional velocity offsets along axes.
- **Then** coordinate integration must step accurately between cell centers, avoiding rounding bleeding.
- *Test Hook*: Monitor calculation precision steps across simulated engine ticks.

### AC-2: Coordinated Target Transform Resolution Bounds
- **Given** continuous high-density matrix tracking updates across multiple instances.
- **When** positions rewrite dirty vector coordinates inside the processing system pass.
- **Then** coordinates must bridge down to custom projection frames without forcing parent pipeline reallocations.
- *Test Hook*: Validate that sprite matrices update successfully without triggering structure updates.

## Implementation Notes
1. Open `packages/frontend/engine/src/systems/movement_system.ts`.
2. Construct structural tile conversion macros using fixed bitwise or grid matrix sizes.
3. Call `validate()` to enforce compliance rules across changed module spaces.
