# Contract: C-038 LPC Spritesheet Texture Arrays

## Metadata
| Source | Target | Priority | Dependencies | Status | Version |
|--------|--------|----------|--------------|--------|---------|
| Engine Architecture | Game Client View | High | C-034, C-037 | completed | 1.0.0 |

## Overview
This contract implements the asset loading and slicing architecture inside `TextureManager` to supply our custom multi-layer shader with batchable sprite arrays. It converts Universal LPC grayscale spritesheet texture frames into unified, runtime-accessible layer configurations, completely eliminating draw-call fragmenting and pipeline splits when character equipment slots are modified.

## Design Reference
- `packages/frontend/engine/src/rendering/texture_manager.ts`: `getLayeredTextureBatch()` method signature shell.
- `packages/frontend/engine/src/rendering/sprite_composer.ts`: Multi-layer fragment shader texture bindings.

## Changes Detail
### Modified Files

#### `packages/frontend/engine/src/rendering/texture_manager.ts`
- Implement robust texture slicing matrix logic to subdivide source LPC sheets into crisp, 64x64 grid-aligned sub-textures per animation frame.
- Build `getLayeredTextureBatch(recipes: LpcRecipe[])`: Combine sub-textures matching requested asset sheet layouts, assign explicit sample indices [0..7] mapped to specific equipment nodes (body, hair, torso, etc.).
- Prevent engine asset leaks by configuring cleanup lifecycles on dynamically generated texture slices when reference counts drop to zero.

## Acceptance Criteria
### AC-1: Zero Pipeline Split Texture Binding Mappings
- **Given** an engine pool rendering multiple characters with varied equipment configurations.
- **When** textures are batched and processed inside `TextureManager`.
- **Then** all 8 layers must be accurately routed to corresponding sampler array channels without altering any active pipeline state or bind groups.
- *Test Hook*: Validate target sampler configurations inside test rendering blocks.

### AC-2: Grid Alignment and Slice Accuracy
- **Given** a standard Universal LPC grayscale layout asset sheet source.
- **When** frames are sliced based on layout criteria parameters.
- **Then** geometry dimensions must align to exact boundaries without coordinate bleeding or interpolation artifacts.
- *Test Hook*: Verify coordinate data boundaries match rigid grid values.

## Implementation Notes
1. Open `packages/frontend/engine/src/rendering/texture_manager.ts`.
2. Flesh out slicing mechanisms to handle rigid asset partitions.
3. Invoke `validate()` to ensure code format and type constraints check out cleanly.
