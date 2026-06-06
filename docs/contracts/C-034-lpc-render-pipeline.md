# Contract: C-034 LPC Render Pipeline

## Metadata
| Source | Target | Priority | Dependencies | Status | Version |
|--------|--------|----------|--------------|--------|---------|
| Engine Architecture | Game Client View | High | C-033 | completed | 1.0.0 |

## Overview
This contract establishes the operational runtime rendering pipeline that bridges bitECS entity appearance components with PixiJS v8 custom multi-layer batching. It guarantees optimal data bus usage across both WebGL2 and WebGPU pipelines by using a reusable, single-allocation shared buffer model for high-density sprite groups.

## Design Reference
- `rendering/sprite_composer.ts`: Shader strings and `packRecipeToUboBuffer()` layout packing logic.
- `systems/render_system.ts`: Unified engine cache tracking framework.

## Changes Detail
### Modified Files
#### `packages/frontend/engine/src/systems/render_system.ts`
- Implement a centralized `LpcBatchManager` class tracking an internal allocation pool.
- Allocate a static Mega-UBO `UniformGroup` sized to hold uniform fields for up to 64 concurrent entity instances per render pass layer.
- Integrate pass processing logic: Loop through active bitECS entities, write packed bytes directly to a single shared array buffer using `packRecipeToUboBuffer()`, and push index descriptors down to individual sprites using custom vertex attributes (`aInstanceIndex`).
- Schedule exactly one `Buffer.update()` command per system tick before passing execution off to the standard container draw pipeline.

## Acceptance Criteria
### AC-1: Zero Bind Group Reallocation Under WebGPU
- **Given** an engine pool running under a headless Chromium WebGPU environment.
- **When** 100 active entities continuously change their structural appearance data recipes every single frame.
- **Then** the engine must execute successfully using a static pool of shared `UniformGroup` instances, triggering zero pipeline re-allocations or bind group cache invalidations.
- *Test Hook*: Monitor console metrics to verify no structural re-hashes are issued by the renderer.

### AC-2: WebGL2 Driver Sub-Data Streaming Stability
- **Given** an engine pool fallback operating under a WebGL2 environment.
- **When** the unified execution loop runs its render cycle.
- **Then** changes must pass sequentially via concentrated dirty array segment offsets using single-pass unified updates.
- *Test Hook*: Validate frame execution completion across standard engine performance tests.

## Implementation Notes
1. Open `packages/frontend/engine/src/systems/render_system.ts`.
2. Construct the layout matrix configuration to support structured array groupings up to max uniform tracking boundaries (16KB minimum guarantees).
3. Connect bitECS tracking loops to write sequential instance configurations down directly into the interleaved view layer data structures.
4. Call `validate()` and ensure all local lint, formatting, and type constraints resolve without error.
