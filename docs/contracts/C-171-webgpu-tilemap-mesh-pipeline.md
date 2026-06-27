## Metadata

| Field | Value |
|---|---|
| **Source** | `PixiJS v8 Tilemap Rendering Strategies` (Deep Research) |
| **Target** | `packages/frontend/engine/src/systems/tilemap_render_system.ts`, `assets/map_loader.ts` |
| **Priority** | P0 — Replaces VRAM-heavy RenderTexture baking with high-performance WebGPU chunking |
| **Dependencies** | C-170 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

The current tilemap rendering system relies on baking static backgrounds into `RenderTexture` objects. This legacy WebGL paradigm is hostile to large-scale, dynamic RPG maps and fails to utilize PixiJS v8's WebGPU capabilities. This contract replaces the baking system with a custom WebGPU-optimized chunking architecture. It utilizes raw `Float32Array` buffers bound directly to PixiJS `MeshGeometry`, achieving zero-cost CPU frustum culling and massive rendering throughput.

## Design Reference

Follow the "Designing a Custom WebGPU Mesh and Buffer System" and "Advanced Chunking and Off-Screen Culling Architecture" sections from the `PixiJS v8 Tilemap Rendering Strategies` research document.

## Architecture Directives

1. **Eradicate RenderTexture Baking**: Remove all `RenderTexture` generation logic from `tilemap_render_system.ts`.
2. **Implement Spatial Chunking**: Divide the map into uniform chunks (e.g., 32x32 tiles). Each chunk corresponds to a single PixiJS `Mesh` object.
3. **Data-Oriented Geometry Buffers**: For each chunk, pre-allocate a `Float32Array` for vertex positions/UVs and a `Uint32Array` for indices.
4. **GC Mitigation (Critical)**: You MUST set `autoGarbageCollect = false` on both the chunk `MeshGeometry` and its underlying `Buffer` objects (`aPosition`, `aUv`). This prevents PixiJS v8's silent unbinding bug when chunks are temporarily culled from the screen.
5. **CPU-Side Frustum Culling**: The system must calculate the camera's AABB every frame. If a chunk's bounds fall outside the camera's view (plus an overdraw margin), `removeChild()` it from the scene graph. If it enters the view, `addChild()` it.
6. **Texture Array Migration**: Load tilesets as `texture2d_array` rather than flat spritesheets to eliminate edge bleeding and simplify UV coordinate mapping.

## State & Data Models

```typescript
// ECS Components for Tilemap
export const ChunkData = {
    gridX: new Int32Array(MAX_CHUNKS),
    gridY: new Int32Array(MAX_CHUNKS),
    isActive: new Uint8Array(MAX_CHUNKS), // 1 = visible in scene graph, 0 = culled
    isDirty: new Uint8Array(MAX_CHUNKS)   // 1 = needs buffer upload to GPU
};

export const TileVisual = {
    // Points to the specific layer in the WebGPU texture2d_array
    textureLayer: new Uint32Array(MAX_TILES), 
    tint: new Uint32Array(MAX_TILES)
};

// Note: Ensure bitECS hierarchical relation is used to bind Tile eids to Chunk eids.
// const ChildOfChunk = createRelation(withAutoRemoveSubject);

```

## Scope Boundaries

* **In Scope:** - Restructuring `tilemap_render_system.ts` to use `Mesh` and `MeshGeometry`.
* Implementing spatial chunking and CPU-side frustum culling.
* Updating `map_loader.ts` to populate the `ChunkData` and `TileVisual` components.
* Configuring WebGPU `texture2d_array` for tilesets.


* **Out of Scope:** - Shader-driven tile animation (e.g., flowing water WGSL compute).
* Map transitions and Staging Worlds (handled in C-172).



## Acceptance Criteria

### AC-1: Chunk-Based Mesh Generation

**Given** a loaded tilemap with dimensions exceeding 32x32 tiles
**When** the `TilemapRenderSystem` processes the map
**Then** the map is rendered using multiple PixiJS `Mesh` objects (one per chunk) backed by `Float32Array` buffers, and no `RenderTexture` baking is performed.

**Test Hooks**:

* Integration: Assert that `tilemap_render_system.ts` instantiates `MeshGeometry` and that `RenderTexture` is no longer imported/used.

### AC-2: CPU-Side Frustum Culling

**Given** an active game world with a camera smaller than the total map size
**When** the camera pans across the map
**Then** chunks outside the camera AABB are actively removed from the PixiJS scene graph, and chunks entering the AABB are added back, ensuring zero-cost GPU culling.

**Test Hooks**:

* Integration: Mock a camera position shift and assert that off-screen chunk meshes have `.parent === null` (removed from stage).

### AC-3: GC Mitigation Enforcement

**Given** the instantiation of a new chunk `MeshGeometry`
**When** the geometry and its buffers are configured
**Then** `autoGarbageCollect` must be strictly set to `false` on the geometry and its position/UV buffers to prevent the PixiJS v8 unbinding bug.

**Test Hooks**:

* Integration: Assert that `geometry.autoGarbageCollect === false` and `geometry.getBuffer('aPosition').autoGarbageCollect === false`.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Define `ChunkData` and `TileVisual` components. Update `map_loader.ts` to partition the map into chunks and populate these components during initialization.
2. **Phase 2 (Integration)**: Rewrite `tilemap_render_system.ts`. Construct the `MeshGeometry` buffers, implement the AABB frustum culling logic, and apply the `autoGarbageCollect = false` mitigations.
3. **Phase 3 (Validation)**: Run E2E visual tests (e.g., `tilemap_visual.spec.ts`) to ensure the map renders correctly and seamlessly during camera panning.

## Edge Cases & Gotchas

* **Buffer Updates**: When a chunk is marked `isDirty`, you must update the raw `Float32Array` in JavaScript and explicitly call `geometry.getBuffer('aPosition').update()` to flush the new data to the GPU. Do not rebuild the entire Mesh object.
* **WebGPU Texture Arrays**: Standard WebGL shaders expect flat textures. You will need to construct a basic custom WGSL shader for the chunk `Mesh` that samples from a `texture_2d_array<f32>` using the `textureLayer` ID as the Z-index.
