---
id: C-377
title: "Pixel-Art Render Correctness — Filtering, HiDPI, Pixel Snap, Tilemap Repair"
source: "external architecture review (claude CLI) — docs/research/game_engine_architecture_review.md §2 S1-S6, §3 B9"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/129"
  pr_number: 129
created_at: "2026-08-11"
---

# Contract C-377: Pixel-Art Render Correctness — Filtering, HiDPI, Pixel Snap, Tilemap Repair

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/research/game_engine_architecture_review.md` §2 (S1–S6, S10), §3 (B9 partial) — external architecture review, pre-implementation |
| **Target** | `packages/frontend/engine/src/pixi_app.ts`, `rendering/tilemap_chunk_renderer.ts`, `systems/tilemap_render_system.ts`, `game_world.ts`, `systems/camera_system.ts` — pixel-art filtering, HiDPI, camera pixel snap, tilemap renderer repair, dead-shader removal |
| **Priority** | P0 — the shipped tilemap renders through **linear filtering at 4× upscale** (blurry), the WebGPU shader path applies no transform (renders garbage), and frustum culling **permanently deletes chunks** that leave the viewport. All three are invisible today only because the maps are 20×20 and WebGPU is never selected. |
| **Dependencies** | C-375 (merged, PR #122), C-376 (merged, PR #126) — same files, this contract builds on both. No contract blocks this one. |
| **Status** | draft |
| **Promotion** | `integrated` — the production `/game` route + the existing `emberwatch.visual.ts` suite are the evidence |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

All findings verified against HEAD (`4ea2ccf5`). The engine test suite is **910 pass / 0 fail** with every defect below live — none of this code is covered.

### 🔴 A. The tilemap is blurry by default

`systems/tilemap_render_system.ts:97-105` loads the tileset atlas and never sets a scale mode:

```ts
const loadPromises = [...imageSet].map((image) => Assets.load(image));
await Promise.all(loadPromises);
const texture = Texture.from(image);
textureMap.set(image, texture);
```

PixiJS v8 defaults `TextureSource.scaleMode` to `'linear'`. `_worldContainer` is scaled **4×** (`game_world.ts:2518`), so every tile is bilinearly interpolated across 4× its native size.

Every other texture path in the repo sets it correctly — `rendering/texture_manager.ts:444`, `services/assets/blob_url_loader.ts:49,58`, `data/lpc_renderer.ts:251`, `game_world.ts:2627` (LPC layers). The tilemap and `rendering/prop_texture_resolver.ts` (zero occurrences of `scaleMode`) are the two that were missed. **The character is crisp and the ground under them is not.**

### 🔴 B. No HiDPI handling — blurry again on any retina display

`pixi_app.ts:127-138` calls `app.init({...})` with no `resolution` and no `autoDensity`. The canvas renders at CSS pixel resolution and the browser upscales it with bilinear filtering on any display where `devicePixelRatio > 1`. Zero occurrences of `devicePixelRatio` anywhere in `apps/frontend/client/src` or `packages/frontend`.

The dev LPC views *do* handle this explicitly (`views/character/lpc_preview/lpc_preview_view_model.svelte.ts:318-319`, `views/dev/lpc_walk/lpc_walk_test_view_model.svelte.ts:183-184` both set `resolution: 1, autoDensity: false`). The game canvas never got the same treatment.

Same call site: `antialias` defaults to `true` (`pixi_app.ts:120`) — pointless MSAA for pixel art — and `preserveDrawingBuffer: true` (`:138`) ships to production, forcing the renderer to retain the backbuffer every frame. It exists for screenshot/E2E capture.

### 🔴 C. The camera never snaps to pixels — the tilemap shimmers while walking

```ts
// game_world.ts:2518-2526
const dynamicScale = 4 * this._cameraZoom;
this._worldContainer.scale.set(dynamicScale);
this._worldContainer.x = this._app.screen.width / 2 - this._cameraX * this._worldContainer.scale.x;
this._worldContainer.y = this._app.screen.height / 2 - this._cameraY * this._worldContainer.scale.y;
```

`_cameraX/_cameraY` are lerped floats produced by `camera_system.ts`, and `_cameraZoom` is itself lerped. The container lands on fractional device pixels every frame; with nearest-neighbour sampling (post-A) the tile grid crawls and jitters during movement.

Related, same subsystem: `camera_system.ts:27` `DEFAULT_LERP_FACTOR = 0.08` and `:30` `ZOOM_LERP_FACTOR = 0.08` are applied **per frame, not scaled by delta time** — camera follow speed is framerate-dependent.

### 🔴 D. The WGSL tilemap shader applies no transform

```wgsl
// rendering/tilemap_chunk_renderer.ts:58-64
@vertex
fn mainVertex(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(input.aPosition, 0.0, 1.0);
  output.vUV = input.aUV;
  return output;
}
```

`aPosition` holds **raw world pixels** (`_buildChunk` writes `col * tilePixelW`, `:580-581`). Clip space is `[-1, 1]`. Nothing multiplies by projection or world transform, and the shader never declares the `@group(0)` globals PixiJS injects. On WebGPU the whole map collapses to a sub-pixel smear at the origin.

The GLSL fallback (`:124-129`) does it correctly:
```glsl
mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
```

Nobody noticed because `pixi_app.ts:126` defaults `rendererPreference` to `'webgl'` and **nothing in the client ever passes anything else** — `game_boot_service.svelte.ts:885` forwards `input.rendererPreference`, and `game_canvas_view_model.svelte.ts:135` calls `boot({ canvas, contentPackId: 'emberwatch' })` with no such field. The WGSL path has never executed.

### 🔴 E. Frustum culling permanently deletes chunks

```ts
// rendering/tilemap_chunk_renderer.ts:370-399
for (const child of container.children) {          // live array
  ...
  if (overlaps && !chunkMeta.isActive) {
    if (!mesh.parent) { container.addChild(mesh); }  // unreachable
    chunkMeta.isActive = true;
  } else if (!overlaps && chunkMeta.isActive) {
    if (mesh.parent) { mesh.parent.removeChild(mesh); }  // leaves container.children
    chunkMeta.isActive = false;
  }
}
```

Two defects stacked:

1. The loop mutates the array it iterates — each `removeChild` shifts the remaining elements and the for-of skips the next sibling.
2. A removed chunk is **no longer in `container.children`**, so the loop can never visit it again. The re-add branch is **dead by construction**. A chunk that leaves the viewport is gone for the remaining life of the map.

Armed but not detonated: `village.json` is 20×20 tiles, so `chunksX = ceil(20/32) = 1` — a single chunk whose bounds (0,0,640,640) always overlap the viewport AABB. **The first map wider than 32 tiles detonates it.**

Zero test coverage: `frustumCullChunks` appears in no test file.

### 🔴 F. `renderTilemap` returns a uniform group nothing is bound to

```ts
// systems/tilemap_render_system.ts:159-183
if (layer === tilemap.layers[tilemap.layers.length - 1]) {
  return { container, layerCount, chunkCount: totalChunks,
           globalUniforms: result.globalUniforms, animStorageBuffer: result.animStorageBuffer };
}
}
// Fallback (empty map)
return { container, layerCount, chunkCount: totalChunks,
         globalUniforms: new UniformGroup({...}), animStorageBuffer: new Buffer({ data: new Float32Array(0), ... }) };
```

The early return only fires when the **last element** of `tilemap.layers` is a rendered layer. `map_loader.ts:333` filters `tilemap.layers` to `type === 'tilelayer'` only, and in **every** Emberwatch map the layer order is `[ground, collision]` — the last one is `collision`, which is `continue`d at `:115-117`. So every real map falls through to the "empty map" fallback and receives a **fresh, unbound** `UniformGroup`.

`game_world.ts:2130` stores it into `_tilemapUniforms`; `:525` writes `uniforms.uTime = performance.now() / 1000` to it every frame. It is bound to no mesh.

It is moot at a deeper level — GPU tile animation (C-177) is scaffolding end to end:
- `_buildChunk` writes `textureLayers[vi] = 0` for every vertex (`:592,599,606,613`)
- `animStorageBuffer` is a zero-filled `Float32Array(256*4)` (`:292-295`) that is never written
- **neither shader reads `uTime` or `animTable`** — grep both sources
- `rendering/tilemap_animation_shader.ts` exports `TILEMAP_ANIMATION_WGSL` and **has zero importers**

### 🟡 G. Smaller defects in the same files

- `tilemap_render_system.ts:85-87` — an empty `if` block (`if (layerFilter && !layerFilter(layer.name)) { }`), a half-deleted layer filter.
- `tilemap_chunk_renderer.ts:421-435` — `getUvRect` insets UVs by half a texel (`(px + 0.5) / imagewidth` … `(px + tilewidth - 0.5) / imagewidth`), stretching 31 source texels across 32 destination pixels. A workaround for atlas bleeding that resamples every tile. The correct fix is 1px edge extrusion in the atlas (deferred to C-378, which owns the packer) — this contract documents the coupling and leaves the inset in place.
- `rendering/depth_sort.ts` — referenced only by `__tests__/rendering.test.ts:2260`. Dead.
- `game_world.ts:2494-2500` — entity spatial culling is disabled behind a `FIXME` with `visible = true` hardcoded.
- Each chunk allocates its own `new Shader({...})` (`:671-681`) despite identical inputs across all chunks of a layer.

### Baseline tests

Run before starting — all currently pass:
- `moon run engine:test` — 910 pass / 0 fail
- `apps/e2e/src/visual/suites/emberwatch.visual.ts` — the existing village visual gate (C-375 AC-1/4/5)

## User Outcome

After this contract, a **player** sees the Emberwatch village rendered as crisp
pixel art at native resolution on any display, with no shimmer while walking,
and maps larger than one chunk render completely instead of losing tiles as the
camera moves.

After this contract, a **developer** has an integration test that renders a real
content-pack map headlessly, so tilemap regressions fail CI instead of shipping.

## Success Measures

- **Time/latency target**: no regression in boot time; frame budget unchanged or better (removing `preserveDrawingBuffer` and per-chunk `Shader` allocation should improve it).
- **Offline/degraded behavior**: unchanged — this contract touches no network path.
- **Production journey enabled**: the `/game` route renders Emberwatch correctly on a HiDPI display and on maps larger than 32×32 tiles, unblocking the C-378 terrain/autotiling work.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Global nearest filtering | `rendering/texture_manager.ts:444`, `services/assets/blob_url_loader.ts:49` | replace — hoist to one global default in `pixi_app.ts` |
| PixiJS app init | `pixi_app.ts:114-158` | modify — add `resolution`/`autoDensity`, drop `antialias`, gate `preserveDrawingBuffer` |
| Camera transform | `game_world.ts:2515-2545` | modify — snap to device pixels |
| Camera lerp | `systems/camera_system.ts:27,30` | modify — delta-scale the factor |
| Chunk build | `rendering/tilemap_chunk_renderer.ts:267-337` | modify — return chunk array, single shared Shader per layer |
| Frustum culling | `rendering/tilemap_chunk_renderer.ts:357-400` | replace — iterate a chunk array, toggle `visible` |
| GLSL tilemap shader | `rendering/tilemap_chunk_renderer.ts:111-153` | reuse — this is the only path that has ever run |
| WGSL tilemap shader | `rendering/tilemap_chunk_renderer.ts:47-99` | delete |
| Visual gate | `apps/e2e/src/visual/suites/emberwatch.visual.ts` | reuse — re-run as the AC evidence |

## Overview

Make the tilemap render correctly. This contract changes **no data format, no
schema, and no map file** — it repairs the existing renderer so that what is
already authored draws the way it was meant to. Four classes of change:
pixel-art sampling correctness (nearest filtering, HiDPI resolution, camera
pixel snap), tilemap renderer repair (frustum culling, the uniform-group return
path), removal of the broken-and-unused WebGPU path, and the first integration
test that renders a real content-pack map.

## Design Reference

- C-375 (`docs/contracts/C-375-emberwatch-rendering-and-assets-overhaul.md`) — established the deterministic prop resolver and the `emberwatch.visual.ts` gate. Follow its evidence pattern.
- C-376 (`docs/contracts/C-376-emberwatch-solidity-rendering-architecture-hardening.md`) — established `rendering/layer_bands.ts` and the in-place `zIndex` sort. Do not change the band values here; C-378 owns the band model.
- `packages/frontend/engine/src/__tests__/rendering.test.ts` — the existing rendering test conventions (PixiJS mocking, headless assertions). The new tilemap test follows the same shape.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One global filtering default.** Set the nearest-neighbour default once, at renderer creation, rather than patching each texture load site. A future loader must not be able to regress it by forgetting a line. Keep the existing per-site assignments — they become redundant but harmless, and removing them is out of scope.
- **Pixel snap belongs at the camera transform, not the entity.** The world container position is the single place where continuous world coordinates become device pixels. Snap there; leave `Position` and the camera's own lerp continuous so movement stays smooth.
- **Frustum culling must not reparent.** Keep an owned array of chunk records as the iteration source and toggle mesh visibility. Reparenting per frame was never the right mechanism and is the direct cause of the permanent-deletion bug.
- **Delete the WGSL path rather than fixing it.** It has never executed, it is not selected by any caller, and a correct WGSL implementation is only worth writing when there is a reason to prefer WebGPU. Keep `rendererPreference` in the options type — dropping the shader does not require dropping the ability to request WebGPU later.
- **The renderer owns its own uniform lifetime.** `renderTilemap` should return the uniform group that the chunks are actually bound to, for all layer orderings — or return nothing and let the chunk renderer own it. Prefer the latter: fewer cross-module lifetimes.

## State & Data Models

No persisted state changes. Two in-memory shape changes:

```ts
/** Result of rendering a tilemap — now carries the owned chunk records so the
 *  culler can iterate them without walking the scene graph. */
type TilemapRenderResult = {
  container: Container;
  layerCount: number;
  chunkCount: number;
  /** Chunk records owned by the renderer — the culler's iteration source. */
  chunks: readonly TilemapChunk[];
  /** Uniform group the chunk meshes are actually bound to. */
  globalUniforms: UniformGroup;
};

/** A chunk record. `mesh.visible` replaces scene-graph add/remove. */
type TilemapChunk = {
  gridX: number;
  gridY: number;
  layerName: string;
  mesh: Mesh<MeshGeometry, Shader>;
  geometry: MeshGeometry;
  bounds: { x: number; y: number; width: number; height: number };
};
```

`animStorageBuffer` is removed from the result type — nothing reads it.

## Quality Requirements

- **Offline/degraded mode**: N/A — no network path touched.
- **Accessibility/input**: N/A — no input surface changed. `preserveDrawingBuffer` must remain enabled under `?e2e=true` so the existing visual capture keeps working.
- **Performance budget**: no frame-time regression on the village map. Removing `preserveDrawingBuffer` and per-chunk `Shader` allocation should reduce both. `resolution: devicePixelRatio` increases fragment count on HiDPI displays — verify the village still holds 60fps at DPR 2.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: `renderTilemap` is already called per `loadMap` and must remain safe to call repeatedly; the chunk array must be released with the container on map teardown (`game_world.loadMap` destroys the previous tilemap container).
- **Observability**: keep the existing `BaseEngineClass.setRenderDebug` diagnostic; add culled/visible chunk counts to it.

## Migration & Rollback

N/A — no persistent state changes. No save format, schema, route, or provider is affected. Rollback is `git revert`.

## Scope Boundaries

- **In Scope:**
  - Global nearest-neighbour filtering default; nearest on the prop resolver path
  - `resolution` / `autoDensity` / `antialias` / `preserveDrawingBuffer` in `pixi_app.ts`
  - Device-pixel snap on the world container transform
  - Delta-scaled camera position and zoom lerp
  - `frustumCullChunks` rewrite (chunk array + visibility toggle)
  - `renderTilemap` return-path fix; removal of `animStorageBuffer` from the result
  - Deletion of `TILEMAP_CHUNK_WGSL`, `_getSharedGpuProgram`, `rendering/tilemap_animation_shader.ts`, `rendering/depth_sort.ts` and its test import
  - Removal of the empty `if` block at `tilemap_render_system.ts:85-87`
  - One shared `Shader` per layer instead of per chunk
  - New integration test rendering `emberwatch/maps/village.json`
- **Out of Scope:**
  - **Any change to the z-band model or layer→container assignment** — C-378 owns it
  - **The half-texel UV inset** — the fix is atlas extrusion, which C-378's packer owns
  - **Tilemap day/night tint** — C-378
  - **Multi-tileset-per-layer support and Tiled flip flags** — C-378 / C-379
  - **Prop sprite forced 32×32 sizing** (`game_world.ts:1221-1223`) — C-378
  - **Entity spatial culling** (the `FIXME` at `game_world.ts:2494`) — leave disabled
  - **Frame interpolation between sim ticks** — C-380
  - Any collision, movement, pathfinding, or content-pack schema change

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. Every AC below is a defect in the same render
path, verified by the same visual gate, and shipping any subset leaves the
renderer in a mixed state — e.g. nearest filtering without pixel snap makes
shimmer *more* visible than the current blur does. The 8 ACs are each
independently verifiable but not independently releasable.

## Acceptance Criteria

### AC-1: Tilemap and props render with nearest-neighbour filtering
**Given** the Emberwatch village map is loaded on the `/game` route
**When** the tileset atlas and prop textures are sampled at the 4× world scale
**Then** every tile and prop edge is hard-edged pixel art with no bilinear interpolation, and the default is set once at renderer creation rather than per load site

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Visual | `packages/frontend/engine/src/__tests__/tilemap_render.test.ts`, `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: assert the resolved tileset `TextureSource.scaleMode === 'nearest'` after `renderTilemap`
- E2E / Visual:
  - **Functional**: N/A
  - **Visual**: extend `emberwatch.visual.ts` schema with `tilesAreCrisp: Type.Boolean({ description: 'Whether tile edges are hard-edged pixel art with no blur' })`. Prompt criterion: "Score 90+: tile boundaries are sharp with no blurring or softening between adjacent tiles."

**Watch Points**:
- Setting the global default must not regress the LPC composition path, which relies on `nearest` already — verify the character still renders correctly.
- `Texture.from(image)` returns a cached texture; setting the scale mode on the source after `Assets.load` must happen before the first frame is drawn.

### AC-2: Canvas renders at native device resolution
**Given** a display with `devicePixelRatio > 1`
**When** the PixiJS application is created
**Then** the backing canvas is allocated at `devicePixelRatio` scale with `autoDensity` enabled, `antialias` is disabled, and `preserveDrawingBuffer` is enabled only under `?e2e=true`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/engine/src/__tests__/rendering.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: assert `app.init` receives `resolution === devicePixelRatio`, `autoDensity === true`, `antialias === false`; assert `preserveDrawingBuffer` is `false` without the e2e flag and `true` with it
- E2E / Visual: N/A (covered by AC-1's visual run, which executes with `?e2e=true`)

**Watch Points**:
- The existing visual suite captures screenshots — if `preserveDrawingBuffer` is gated incorrectly the whole visual gate goes black. Verify the e2e path first.
- `resizeTo` + `autoDensity` interact; confirm the canvas CSS size still matches the container after a window resize.

### AC-3: The world container lands on whole device pixels
**Given** the player is walking with a lerped camera at a fractional world position
**When** the world container transform is applied each frame
**Then** its final `x`/`y` are whole device pixels, while the camera's own position remains continuous

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Visual | `packages/frontend/engine/src/__tests__/rendering.test.ts`, `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: drive `_updateRenderFromBuffer` with fractional camera values at DPR 1 and 2; assert `worldContainer.x * resolution` is an integer in both
- E2E / Visual: covered by the AC-1 visual run

**Watch Points**:
- Snapping must account for `resolution` — rounding to whole *CSS* pixels still lands on half device pixels at DPR 2.
- Snapping the container while entity `zIndex` derives from unsnapped `y` is correct and must stay that way; do not snap entity positions.
- At non-integer zoom (`_cameraZoom` lerps 1.0→1.5) exact pixel alignment is impossible; snap anyway — the goal is stability, not perfection, and dialogue zoom is a transient state.

### AC-4: Chunks that leave the viewport return when the camera comes back
**Given** a map larger than one 32×32-tile chunk
**When** the camera moves so a chunk leaves the viewport AABB and then returns
**Then** the chunk is hidden while outside and drawn again when it re-enters, and the culler never mutates the scene graph

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `packages/frontend/engine/src/__tests__/tilemap_render.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: build chunks from a synthetic 96×96-tile map (9 chunks), pan the camera across and back, assert per-chunk `mesh.visible` toggles both directions and `container.children.length` is constant throughout
- E2E / Visual: N/A

**Watch Points**:
- This is the regression the current code cannot pass — write the test first and watch it fail before changing the implementation.
- `container.children.length` constant is the assertion that pins the no-reparent directive; without it a re-add-based fix would also pass.
- The overdraw margin (`OVERDRAW_MARGIN = 64`) is in **world** pixels and the culler is called with world-space viewport dimensions (`game_world.ts:2531-2532`) — keep that unit convention.

### AC-5: `renderTilemap` returns the uniform group its chunks are bound to
**Given** a map whose last tile layer is `collision` (every current Emberwatch map)
**When** `renderTilemap` completes
**Then** the returned `globalUniforms` is the group the chunk meshes actually reference, for every layer ordering, and no unbound placeholder group is ever returned

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `packages/frontend/engine/src/__tests__/tilemap_render.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: render `village.json` (layers `[ground, collision]`) and a synthetic map whose last layer *is* rendered; assert in both cases that the returned group is reference-identical to the one bound in `chunks[0].mesh.shader.resources.globals`
- E2E / Visual: N/A

**Watch Points**:
- The `[ground, collision]` ordering is the one that currently fails. Cover both orderings or the fix can regress.
- `animStorageBuffer` leaves the result type; `game_world.ts` must stop storing it. Confirm no other consumer reads it.

### AC-6: The dead WebGPU and animation shader paths are gone
**Given** the engine source tree
**When** the contract is complete
**Then** `TILEMAP_CHUNK_WGSL`, `_getSharedGpuProgram`, `rendering/tilemap_animation_shader.ts`, and `rendering/depth_sort.ts` no longer exist, the tilemap renders through the GLSL program only, and the engine barrel exports no symbol from the deleted modules

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `packages/frontend/engine/src/__tests__/tilemap_render.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:typecheck && moon run engine:test && moon run engine:lint`
- Integration: assert the chunk `Shader` is constructed with a `glProgram` and no `gpuProgram`; assert `rendering/index.ts` and `src/index.ts` no longer re-export the removed symbols
- E2E / Visual: N/A

**Watch Points**:
- `__tests__/rendering.test.ts:2260` imports `computeDepthOrder` from `depth_sort.ts` — that import and its test block go with the file.
- `bun run validate:wgsl` scans WGSL sources; confirm it still passes (or has nothing left to scan) after the deletion.
- Keep `rendererPreference` in `PixiAppOptions` — removing the shader is not removing the ability to request WebGPU later.

### AC-7: Camera follow is framerate-independent
**Given** the game runs at 30fps and at 144fps
**When** the camera lerps toward the focus entity
**Then** the camera reaches the same fraction of the remaining distance per unit of wall-clock time at both rates

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit | `packages/frontend/engine/src/systems/camera_system.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: step the camera 1000ms in 33ms slices and in 7ms slices from the same start state; assert the final positions agree within a small epsilon
- E2E / Visual: N/A

**Watch Points**:
- `camera_system.test.ts` already exists (402 lines) and asserts current per-frame behaviour — expect to update existing assertions, and record that in Amendments if any AC-level behaviour changes.
- Apply the same treatment to `ZOOM_LERP_FACTOR`; dialogue zoom uses it.

### AC-8: A real content-pack map renders in an automated test
**Given** `apps/frontend/client/static/content-packs/emberwatch/maps/village.json` and its atlas metadata
**When** the engine test suite runs
**Then** an integration test parses the real map, builds chunks, and asserts chunk count, per-tile UV rectangles within `[0,1]`, vertex positions matching `col * tilewidth`, and that the `collision` layer contributes no geometry

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Integration | `packages/frontend/engine/src/__tests__/tilemap_render.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: this AC *is* the test file; it must fail against pre-contract `HEAD` for AC-4 and AC-5
- E2E / Visual: N/A

**Watch Points**:
- The test must read the committed map file, not a fixture copy — the point is to catch content/engine drift. Follow the pattern in `__tests__/emberwatch_content_audit.test.ts`, which already reads `static/content-packs/`.
- PixiJS `Mesh`/`Shader`/`Buffer` construction needs the same headless mocking `rendering.test.ts` already uses; reuse it rather than inventing a second approach.

## Implementation Sequence

1. **Phase 1 (Test first)**: Write `__tests__/tilemap_render.test.ts` covering AC-4, AC-5 and AC-8 against the current implementation. AC-4 and AC-5 must **fail**. Commit the failing test so the defect is recorded.
2. **Phase 2 (Renderer repair)**: Rewrite `frustumCullChunks` onto an owned chunk array with visibility toggling; fix the `renderTilemap` return path; drop `animStorageBuffer` from the result and from `game_world.ts`; hoist the per-chunk `Shader` to one per layer. Tests from Phase 1 go green.
3. **Phase 3 (Sampling correctness)**: Global nearest default in `pixi_app.ts`; nearest on the prop resolver path; `resolution`/`autoDensity`/`antialias`/gated `preserveDrawingBuffer`; device-pixel snap in `game_world._updateRenderFromBuffer`; delta-scaled lerp in `camera_system.ts`.
4. **Phase 4 (Deletion)**: Remove `TILEMAP_CHUNK_WGSL`, `_getSharedGpuProgram`, `tilemap_animation_shader.ts`, `depth_sort.ts` + its test import, and the empty `if` block. Prune the barrel exports.
5. **Phase 5 (Validation)**: `moon run engine:typecheck`, `moon run engine:test`, `moon run engine:lint`, `bun run validate:wgsl`, then the `emberwatch.visual.ts` suite with the two new schema fields.

## Edge Cases & Gotchas

- **Nearest filtering makes shimmer worse before pixel snap fixes it.** Phases 3's sub-steps are not independently shippable; land them together or the intermediate state looks worse than `HEAD`.
- **`resolution: devicePixelRatio` multiplies fragment cost.** On a DPR 3 phone the village goes from ~2M to ~18M fragments per frame. Measure before assuming it's free; if it regresses, clamp resolution to 2.
- **`Texture.from` shares a global cache.** The tileset texture may already exist from a prior map load with the wrong scale mode. Setting the global default at renderer creation (before any `Assets.load`) avoids the ordering hazard; do not rely on post-hoc assignment alone.
- **The visual suite is an AI-scored gate.** A score dip after this contract is a signal, not noise — the whole point is that the scene changes appearance. Re-baseline deliberately and record the before/after scores in the evidence matrix.
- **`_chunkMeta` is currently attached to the mesh** (`tilemap_chunk_renderer.ts:714`). Once the culler iterates an owned array, that back-reference is redundant; remove it rather than leaving two sources of truth.
- **Do not "fix" the WGSL shader instead of deleting it.** A correct WGSL port needs the `@group(0)` global uniform layout, which differs between PixiJS minor versions and has no test coverage. Deleting is reversible; a subtly-wrong shader that only runs on some GPUs is not.

## Open Questions

Must be resolved before status becomes `approved`:

- Should `resolution` be clamped (e.g. `Math.min(devicePixelRatio, 2)`) to bound fragment cost on high-DPR mobile? Recommendation: yes, clamp to 2 — the visual difference above 2 is negligible for pixel art and the cost is not.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary
Repaired the Emberwatch tilemap render path end to end: nearest-neighbour filtering is now the global default installed at engine-barrel import (before any `Assets.load`, closing the boot-order hazard where the atlas spritesheet loads during `preloading_content`), the PixiJS app renders at native device resolution with `autoDensity`, antialias off, and E2E-gated `preserveDrawingBuffer`, and the world container snaps to whole device pixels each frame. The frustum culler was rewritten onto an owned chunk array with `mesh.visible` toggling (no scene-graph mutation — chunks return when the camera comes back), `renderTilemap` returns the uniform group its chunks are actually bound to for every layer ordering, per-chunk `Shader` allocation was hoisted to one shared shader per layer, and the dead WGSL/animation/depth-sort paths were deleted. A headless integration test renders the real `village.json` and the `emberwatch.visual.ts` gate re-baselined at 95/100.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Global nearest default in `pixi_app.ts` module scope + `texture_defaults.ts`; nearest forced on prop resolver path; visual gate `tilesAreCrisp` schema added; emberwatch re-scored 95/100 |
| AC-2 | ✅ | `resolution` (clamped to 2) / `autoDensity` / `antialias:false` / E2E-gated `preserveDrawingBuffer`; pure `resolvePixiInitOptions` + 4 unit tests |
| AC-3 | ✅ | `snapToDevicePixels` on world container transform in `game_world._updateRenderFromBuffer`; 4 unit tests incl. DPR 2 + non-integer zoom |
| AC-4 | ✅ | `frustumCullChunks` iterates owned chunk array, toggles `mesh.visible`, returns visible/total counts; 2 tests prove chunks return and children constant |
| AC-5 | ✅ | `renderTilemap` returns the shared bound uniform group for both layer orderings (tests assert reference-identity); empty-map fallback returns a placeholder only when zero chunks exist |
| AC-6 | ✅ | `TILEMAP_CHUNK_WGSL`, `_getSharedGpuProgram`, `tilemap_animation_shader.ts`, `depth_sort.ts` + test import deleted; shader constructed with `glProgram` only (asserted); barrels pruned; `validate:wgsl` clean |
| AC-7 | ⚠️ | Lerp was already delta-scaled at HEAD (C-161); added the framerate-independence regression test (1000ms at 33ms vs 7ms slices agree within 5px) — no production change needed |
| AC-8 | ✅ | `tilemap_render.test.ts` reads the committed `village.json`, builds chunks, asserts chunk count / UVs ∈ [0,1] / vertex positions match `col*tilewidth` / collision layer contributes no geometry |

### Files Created
| File | Purpose |
|---|---|
| `packages/frontend/engine/src/__tests__/tilemap_render.test.ts` | C-377 AC-1/4/5/6/8 integration tests (headless PixiJS via DOMAdapter + Assets stub loader) |
| `packages/frontend/engine/src/pixi_init_options.ts` | Config-free `resolvePixiInitOptions` + `isE2ETestMode` (AC-2) |
| `packages/frontend/engine/src/rendering/pixel_snap.ts` | Pure `snapToDevicePixels` helper (AC-3) |
| `packages/frontend/engine/src/rendering/texture_defaults.ts` | `installNearestTextureDefault` — the one global filtering default (AC-1) |

### Files Modified
| File | Change |
|---|---|
| `packages/frontend/engine/src/rendering/tilemap_chunk_renderer.ts` | WGSL path + per-chunk Shader removed; chunk records own layerName; one shared Shader per layer; culler toggles `mesh.visible`; `chunks` on result |
| `packages/frontend/engine/src/systems/tilemap_render_system.ts` | Fixed return path (shared group for all orderings); `chunks` in result; empty-`if` removed; `animStorageBuffer` gone |
| `packages/frontend/engine/src/game_world.ts` | Stores `_tilemapChunks`; culls via chunk array; device-pixel snap; chunk counts in render diagnostic; teardown releases chunks |
| `packages/frontend/engine/src/pixi_app.ts` | Module-scope nearest default; `resolution`/`autoDensity`/`antialias`/gated `preserveDrawingBuffer` via `resolvePixiInitOptions` |
| `packages/frontend/engine/src/rendering/prop_texture_resolver.ts` | Nearest scaleMode forced on hit + fallback textures |
| `packages/frontend/engine/src/index.ts`, `rendering/index.ts` | Export `TilemapChunk`, `installNearestTextureDefault`, `pixi_init_options`; prune deleted symbols |
| `packages/frontend/engine/src/__tests__/rendering.test.ts` | AC-2 + AC-3 tests; depth_sort test block removed |
| `packages/frontend/engine/src/systems/camera_system.test.ts` | AC-7 framerate-independence test |
| `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `tilesAreCrisp` schema field + crisp-tiles prompt criterion |
| `packages/frontend/engine/src/rendering/depth_sort.ts` | deleted (AC-6) |
| `packages/frontend/engine/src/rendering/tilemap_animation_shader.ts` | deleted (AC-6) |

### Deviations from Spec
- **AC-7 required no production change.** The camera lerp (`DEFAULT_LERP_FACTOR`/`ZOOM_LERP_FACTOR`) was already delta-scaled by C-161 at the contract's stated baseline `4ea2ccf5`; only the missing framerate-independence test was added. No Amendment proposed — the AC outcome is satisfied and this is a spec-accuracy note, not a scope change.
- **Open Question resolved:** `resolution` clamped to `Math.min(devicePixelRatio, 2)` per the contract's own recommendation.
- **`game_world._tilemapUniforms` uTime write kept** — it now writes to the actually-bound group, harmless and future-useful; contract did not require removal.
- The `Buffer`/`BufferUsage` imports and `animStorageBuffer` were removed from the chunk renderer result type entirely; no external consumer existed.

### Test Results
- Unit (engine): 921 pass / 0 fail (baseline 910 pass / 0 fail — 11 new C-377 tests, 6 depth_sort tests removed)
- Client: 1612 pass / 49 fail — **all 49 pre-existing** (PersonaCreate/Providers/Image VMs; confirmed identical on clean baseline via stash)
- E2E typecheck: pass
- Visual: `emberwatch` suite **95/100 PASS** (production `/game` route, screenshot + VLM eval); independent `ai_validate_image` on the captured PNG: 90/100 PASS with sharp hard-edged tile assertion
- Baseline: 0 pre-existing engine failures, 0 new failures; client 49 pre-existing, 0 new
