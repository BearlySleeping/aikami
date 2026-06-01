# Execution Contract: C-032 - LPC Spritesheet Shader and Pipeline Integration

## 1. Design References

- **Dynamic Content Loop**: AI generates modular metadata manifests specifying character asset layers and target swatches.
- **Texture Strategy**: Modern HTML5 execution metrics from WebGL LPC Sprite Optimization Research validate that CPU-based canvas swapping takes 190ms–230ms, while WebGL Zero-Branch LUT (Lookup Texture) Shaders complete within 90ms–120ms with zero thread divergence or main-thread garbage collection stall.
- **Rendering Architecture**: Zero-Branch LUT lookup utilizing base grayscale sheets where the red channel maps directly to 8-bit palette indices, updated dynamically via a 256x1 Uint8Array texture format `rgba8unorm`.

## 2. Detailed Changes

### `packages/frontend/engine/src/rendering/texture_manager.ts`

- Update internal cache maps to track base grayscale LPC sheets independent of character color states.
- Implement `preparePaletteLUT(hexColors: Record<string, string>): Uint8Array` to map customized hex strings into raw 8-bit normalized indices matching standard LPC color ramps.

### `packages/frontend/engine/src/rendering/sprite_composer.ts`

- Implement a shader composer using PixiJS v8 GL Program setups (`GlProgram`).
- Embed GLSL ES 3.0 conformant vertex and fragment shaders:
  - **Vertex Shader**: Transform layout vectors matching unified PixiJS input dimensions.
  - **Fragment Shader**: Use the source texture's red channel normalized index scaled by 255.0 with a uniform half-pixel shift (`+ 0.5 / 256.0`) to index a 256x1 LUT palette texture without sampling bleed.

### `packages/frontend/engine/src/components/appearance.ts`

- Define a typed representation tracking active asset segments and swatches:

```typescript
export interface LpcLayerRecipe {
  slot: string;
  assetId: string;
  hexPalette: Uint8Array; // 1024 bytes (256 RGBA pixels)
}
```

### `packages/frontend/engine/src/systems/render_system.ts`

- Integrate custom WebGL filters inside bitECS entity parsing blocks.
- Apply optimization flags to character visual entities:
  - Set `eventMode` to `'none'` on character visual nodes to bypass layout hit-tests.
  - Assign fixed `filterArea` dimensions matching cell geometry sizes to avoid frame boundaries recalculation overhead.
  - Tag off-screen instances with `cullable = true` or manage through explicit `cullArea` configurations.

## 3. Acceptance Criteria

### Given/When/Then Setup

- **Given**: A dynamic character manifest received via AI containing structured layer layouts and hex strings.
- **When**: The `RenderSystem` encounters bitECS entities configured with these active appearance layers inside the PixiJS v8 WebGL context.
- **Then**: The engine applies a pixel-perfect Zero-Branch lookup mapping using GLSL ES 3.0 code, skipping CPU canvas loops completely, rendering smoothly within a single target execution pass under 120ms with culling optimizations engaged.

## 4. Watch Points

- Ensure `scaleMode` on the generated palette lookup texture is explicitly set to nearest (`gl.NEAREST`) to preserve accurate indexing without color interpolation artifacts.
- Avoid multi-branch conditionals (`if`/`else` on vector matching) inside the fragment loop to maintain parallel processing paths across the active GPU batch pipeline.

