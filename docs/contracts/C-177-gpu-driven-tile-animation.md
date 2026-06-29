<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | `PixiJS v8 Tilemap Rendering Strategies` (Deep Research) |
| **Target** | `packages/frontend/engine/src/rendering/tilemap_chunk_renderer.ts`, `packages/frontend/engine/src/assets/jton_parser.ts` |
| **Priority** | P1 — Prevents severe CPU-to-GPU bus saturation by offloading environmental animations to the shader |
| **Dependencies** | C-171, C-175 |
| **Status** | **completed**  |
| **Contract version** | 1.0.0 |

## Overview

Traditional ECS architectures struggle with environmental animations (water, torches) because mutating tile states on the CPU forces massive, constant geometry buffer uploads, negating the benefits of static chunking. This contract shifts tilemap animation entirely to the GPU. The CPU will provide a static base layer, a global time uniform, and an animation lookup table (Storage Buffer), allowing a custom WGSL shader to calculate the correct animation frame mathematically without any CPU intervention.

## Design Reference

Follow the "Handling Animated Tiles within a Data-Oriented Paradigm" and "Shader-Driven Animation via Storage Buffers" sections from the `PixiJS v8 Tilemap Rendering Strategies` deep research document.

## Architecture Directives

1. **Animation Lookup Table**: Parse animation metadata (frame count, speed, start offset) from your tileset definitions. Pack this into a flat `Float32Array` where the index correlates to the tile's base `textureLayer`.
2. **WebGPU Storage Buffer**: Wrap this array in a PixiJS `Buffer` with `usage: BufferUsage.STORAGE | BufferUsage.COPY_DST`.
3. **Global Time Uniform**: Create a simple uniform buffer containing `u_time`. Bind this to the PixiJS application `Ticker` so it increments every frame.
4. **Custom WGSL Shader**: Replace the default `TextureShader` used in C-171. Write a custom `GpuProgram` using WGSL. The fragment shader must read the base texture ID, lookup the animation data from the storage buffer, calculate the current frame using `u_time` modulo math, and sample the `texture_2d_array`.
5. **Zero ECS Mutation**: Ensure that the bitECS world *never* mutates `TileVisual.textureLayer` for environmental animations once the chunk is built.

## State & Data Models

```typescript
// Conceptual WGSL struct mapping (must be 16-byte aligned for WebGPU)
/*
struct AnimData {
    frameCount: f32,
    speed: f32,
    offsetStart: f32,
    padding: f32, 
}
*/

// Conceptual JS Buffer construction
const animTableData = new Float32Array(MAX_TILE_TYPES * 4); // 4 floats per struct
// Populate animTableData during JTON/Map loading...

const animStorageBuffer = new Buffer({
    data: animTableData,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
});

```

## Scope Boundaries

* **In Scope:** - Writing the custom WGSL Vertex and Fragment shaders for the chunk meshes.
* Creating the Animation Storage Buffer and the Time Uniform group.
* Updating `jton_parser.ts` or `map_loader.ts` to extract animated tile definitions.
* Hooking the time uniform to the render loop ticker.


* **Out of Scope:** - Entity/NPC animations (these remain CPU-driven sprites/spritesheets).
* CPU-side logic triggers relying on specific environmental animation frames (e.g., puzzle mechanics).



## Acceptance Criteria

### AC-1: Zero-Mutation CPU Loop

**Given** a chunk containing animated water tiles
**When** the game loop runs
**Then** the `ChunkData.isDirty` flag remains `0` and no geometry buffer `.update()` calls are executed, yet the water visibly animates on screen.

**Test Hooks**:

* Integration: Add a spy/mock to the chunk buffer's `update()` method. Assert it is called exactly 0 times over 60 frames while an animated tile is on screen.

### AC-2: Custom WGSL Program Compilation

**Given** the tilemap chunk generation logic
**When** the chunks are instantiated
**Then** they utilize a `new Shader({ glProgram: ..., gpuProgram: ... })` containing custom WGSL that explicitly declares the `@group(2) @binding(0) var<storage, read> anim_table` and samples the `texture_2d_array`.

**Test Hooks**:

* Unit: Validate that the chunk renderer initializes a custom `Shader` instead of relying on the default PixiJS `TextureShader`.

### AC-3: Accurate Modulo Frame Calculation

**Given** an animated tile with 3 frames and a speed of 100ms per frame
**When** the global `u_time` uniform advances
**Then** the custom shader accurately cycles through `offsetStart`, `offsetStart + 1`, and `offsetStart + 2` without interpolating between layers.

**Test Hooks**:

* E2E / Visual: Run `tilemap_visual.spec.ts`. Verify via snapshot testing that the tile texture visually shifts to the correct frame at the specified time intervals.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Update your tileset parsing logic (JTON or otherwise) to extract animation definitions. Pack this data into the 16-byte aligned `Float32Array`.
2. **Phase 2 (Shaders)**: Write the raw WGSL strings for the vertex (standard projection) and fragment (Storage buffer lookup + modulo math + texture array sampling).
3. **Phase 3 (Integration)**: Create the PixiJS `UniformGroup` for time, the `Buffer` for storage, and bind them to your custom `Shader` via bind groups. Hook `u_time` to the global `Ticker`.

## Edge Cases & Gotchas

* **16-Byte Alignment**: WebGPU is brutally strict about memory alignment in Storage Buffers. Ensure your `Float32Array` stride is exactly 4 floats (16 bytes) per tile type, even if you only need 3 variables.
* **Static Tiles**: For tiles that do not animate, set their `frameCount` to `1.0` and `speed` to `0.0` in the lookup table. The WGSL math will naturally evaluate this to `0` offset, displaying the static base layer without branching logic.
* **WGSL Types**: Remember to cast the `f32` texture layer ID to `u32` inside the WGSL fragment shader before passing it to `textureSample()`.
