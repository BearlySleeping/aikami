# Execution Contract: C-033 - LPC Multi-Layer UBO Batching and Reactive Buffer Pipeline

## 1. Design References

- **Reactive Core Constraints**: PixiJS v8 avoids per-frame CPU scene graph evaluation. Modifying transforms or changing textures outside explicitly flagged dirty states stalls performance metrics.
- **Buffer Management**: Following insights from PixiJS v8 Advanced Rendering Strategies, multi-texture blending operations can be consolidated by updating uniform parameter tables inside standard Uniform Buffer Objects (UBO) via `BufferUsage.UNIFORM` and `GpuUboSystem`.
- **Zero-Stall Layer Composition**: Pack up to 8 character animation layout layers into a single high-performance shader draw call pass using array lookups on shared 2D texture arrays, matching fixed layout configurations (`rgba8unorm`).

## 2. Detailed Changes

### `packages/frontend/engine/src/rendering/sprite_composer.ts`

- Upgrade `LPC_PROGRAM` to process multi-layer arrays via GLSL ES 3.0 Uniform Blocks.
- Implement structured uniform mappings matching active visual slots:

```glsl
layout(std140) uniform LpcCharacterData {
    vec4 u_layer_tints[8]; // Array of hex-recolor swatches
    float u_active_layers[8]; // Layer activation flags (1.0 = active, 0.0 = skip)
};
```

- Optimize the texture compositor to sample from texture arrays (`sampler2DArray`) or batch sequences using indices rather than triggering dynamic render path switches.

### `packages/frontend/engine/src/rendering/texture_manager.ts`

- Implement tracking arrays for texture layers to cache base grayscale character geometries inside shared multi-page allocations.
- Expose `getLayeredTextureBatch(recipe: LpcLayerRecipe[])` to match asset slots to uniform map references.

### `packages/frontend/engine/src/systems/render_system.ts`

- Update lookups to utilize custom high-performance uniform blocks via `UboSystem` updates.
- Track reactive structural variations to alter uniform block arrays inside GPU allocations only when entity configurations explicitly undergo structural mutation:

```typescript
// packages/frontend/engine/src/systems/render_system.ts
if (hasAppearanceChanged(entityId)) {
    const ubo = renderer.ubo.getBuffer(entityId);
    ubo.update(packRecipeToBuffer(recipe));
}
```

## 3. Acceptance Criteria

### Given/When/Then Setup

- **Given**: An entity exhibiting 8 discrete active character equipment layers managed inside bitECS storage tables.
- **When**: The entity moves across active maps, modifying look direction sequences or triggering animation loop frames.
- **Then**: The runtime updates frame parameters natively inside a single batch execution pass, utilizing UBO memory pipelines to eliminate driver-level texture swaps and achieve zero thread stalls.

## 4. Watch Points

- Ensure uniform data matches rigid WebGL `std140` padding alignments (every vector or array field must occupy standard 16-byte boundaries) to protect memory offsets from extraction corruptions.
- Verify that uniform modifications map to specific asset structural modifications, avoiding raw frame coordinate modifications that could trigger unneeded buffer re-allocations on the main layout thread.
