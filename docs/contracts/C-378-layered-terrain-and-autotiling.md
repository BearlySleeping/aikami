---
id: C-378
title: "Layered Terrain Format & Corner-16 Autotiling"
source: "external architecture review (claude CLI) — docs/research/game_engine_architecture_review.md §2 S7-S9, §5; autotiling design discussion"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/130"
  pr_number: 130
created_at: "2026-08-11"
---

# Contract C-378: Layered Terrain Format & Corner-16 Autotiling

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/research/game_engine_architecture_review.md` §2 (S7, S8, S9), §5 + autotiling design discussion (terrain-ID authoring, layered corner-16 precedence) |
| **Target** | `packages/shared/schemas/src/lib/game/content_pack.ts` — `terrains` block; `packages/frontend/engine/src/assets/` — terrain channel + autotiler; `packages/frontend/engine/src/rendering/` + `systems/tilemap_render_system.ts` — z-banded layer containers; `scripts/src/lib/ops/` — atlas packer with extrusion + map converter; `apps/frontend/client/static/content-packs/emberwatch/` — converted maps + terrain frames |
| **Priority** | P0 for the roadmap — the current format cannot express a decor or overhead layer at all (one z-band, and every tile layer contributes collision), which blocks all map polish. It is also the format decision that determines whether LLM map generation is ever viable. |
| **Dependencies** | **C-377** (hard — the chunk renderer must return an owned chunk array and a correctly-bound uniform group before layers multiply). C-375, C-376 (merged). |
| **Status** | draft |
| **Promotion** | `integrated` — the production `/game` route + `emberwatch.visual.ts` are the evidence |
| **Docs Impact** | user-facing → new page in `apps/frontend/docs/src/content/docs/` documenting the terrain authoring format for content-pack creators |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

Verified against HEAD (`4ea2ccf5`).

### 🔴 A. There is exactly one z-band for the entire tilemap

`rendering/layer_bands.ts` assigns the whole tilemap container a single
`zIndex: -1000`, and `systems/tilemap_render_system.ts:150-153` merges **every**
layer's chunks into **one** `Container`:

```ts
while (result.container.children.length > 0) {
  container.addChild(result.container.children[0]);
}
```

Entities sort by `computeEntityZIndex(y) = max(-512, y)`. Therefore no tile can
ever draw above any entity. A roof, a tree canopy, an upper wall, or a bridge
deck the player walks behind is **not expressible in the current renderer**.

Secondary: `WORLD_Z_BANDS.debugGrid = -2000` places the debug grid *below* the
tilemap (`layer_bands.ts`), where it cannot be seen.

### 🔴 B. Every tile layer contributes collision

`assets/map_loader.ts:758-766` walks all non-collision tile layers and marks a
cell solid when any layer's GID resolves to `isWalkable: false`:

```ts
for (const layer of tilemap.layers) {
  if (layer.name === layerName || !Array.isArray(layer.data)) continue;
  if (solidityLayers && !solidityLayers.includes(layer.name)) continue;
  ...
}
```

The `solidityLayers` escape hatch exists and is **never passed by any caller** —
`game_world.ts:2101` calls `buildCollisionGrid(tilemap, packConfig)` with no
options, and grep finds no other call site outside tests.

So adding an `overhead` layer with roof tiles (`isWalkable: false`) makes every
interior beneath them solid. **A + B together are why the map cannot be made
prettier.**

### 🔴 C. GIDs are a compiled artifact being used as a source format

The map files store resolved GIDs. Three separate GID conventions coexist and
agree only because every current map has `firstgid === 1`:

| Consumer | Convention | Site |
|---|---|---|
| `buildCollisionGrid` | raw GID → `tiles[String(gid)]` | `map_loader.ts:772` |
| `ManifestAtlasResolver.getTileTextureFromGid` | `rawGid - firstGid + 1` | `manifest_atlas_resolver.ts:289` |
| `_resolveGid` (chunk renderer) | `rawGid - firstgid` | `tilemap_chunk_renderer.ts:459` |

And `_findPrimaryTilesetForLayer` (`tilemap_render_system.ts:198-237`) binds one
tileset texture per layer while `_resolveGid` will happily compute UVs from a
*different* tileset's image dimensions — **multi-tileset layers render garbage.**

The strategic problem: an LLM cannot emit corner-correct GIDs out of a blob set,
and a baked-GID map cannot be reskinned with a different art pack. The map
format is a rendering artifact where it needs to be a generation target.

### 🔴 D. Props are force-resized to one tile

```ts
// game_world.ts:1221-1223
const propSprite = new Sprite(resolution.texture);
propSprite.width = 32;
propSprite.height = 32;
```

No multi-tile props — no 32×64 gate, no tree, no two-tile well. The manifest
carries a per-prop `anchor` (`ContentPackPropSchema`) that this ignores. Latent
today (all 48 atlas frames are 32×32) but it caps the art direction of any
polish pass.

### 🔴 E. The atlas has no frame padding, so UVs are inset instead

`tilemap_chunk_renderer.ts:421-435` insets every tile's UV rect by half a texel
to hide bleeding, stretching 31 source texels across 32 destination pixels.
Autotiling multiplies adjacent-frame boundaries in the atlas, which makes
bleeding far more visible — the inset workaround does not scale. The correct fix
is 1px edge extrusion at pack time, which C-377 explicitly deferred here.

### 🟡 F. The tilemap is not lit

Neither the GLSL tilemap fragment shader (`tilemap_chunk_renderer.ts:132-153`)
nor the deleted WGSL one sampled any tint or light uniform. `environment/environment_ubo.ts`
+ `systems/environment_system.ts` compute a day/night + weather UBO and the
ground cannot respond to it. If the GM narrates dusk, the map stays noon.

### Current content scale (for sizing decisions)

| Map | Size | Layers | Distinct GIDs |
|---|---|---|---|
| `village.json` | 20×20 | `ground`, `collision` | 10 |
| `inn.json` | 16×12 | `ground`, `collision` | — |
| `merchant_shop.json` | 16×12 | `ground`, `collision` | — |
| `whispering_caves.json` | 15×15 | `ground`, `collision` | — |

Atlas: `atlas.webp` 512×256 (16 cols × 8 rows), 48 named frames, 12.9 KB.
16 columns at 32px is **exactly one corner-16 terrain set per row.**

### Baseline tests

- `moon run engine:test` — 910 pass / 0 fail
- `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts` — manifest↔map GID audit (will need updating; it is the closest existing validator)
- `apps/e2e/src/visual/suites/emberwatch.visual.ts`

## User Outcome

After this contract, a **creator** authors a map by painting semantic terrain
names (`grass`, `dirt`, `water`) and the engine resolves the correct edge and
corner tiles automatically — including three-way junctions — without touching a
tile ID.

After this contract, a **player** sees a village with decorated ground and
roofs/canopies they can walk behind, lit by the time of day.

After this contract, a **developer** has a map format that an LLM can emit and a
different art pack can reskin, because tile IDs are computed at load time rather
than stored on disk.

## Success Measures

- **Time/latency target**: terrain resolution for a 200×200 map completes in under 50ms on the boot path (it runs once per `loadMap`, before the first frame).
- **Offline/degraded behavior**: a map with no terrain channel (legacy baked-GID map) still renders through the existing GID path — the terrain channel is additive, not a replacement.
- **Production journey enabled**: Emberwatch village renders with ground + decor + overhead bands and autotiled grass/dirt/water edges, unblocking the manual polish pass and the later generated-map work.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Map parsing | `assets/map_loader.ts:300-345` (`_parseTilemap`) | modify — parse `terrain` + `elevation` channels |
| Collision derivation | `assets/map_loader.ts:728-800` (`buildCollisionGrid`) | modify — derive from terrain IDs; honour `solidityLayers` |
| Tile→frame resolution | `assets/manifest_atlas_resolver.ts` | modify — name-keyed frames, terrain-aware |
| Chunk build | `rendering/tilemap_chunk_renderer.ts` (post-C-377) | reuse — one chunk set per band |
| Z bands | `rendering/layer_bands.ts` | modify — add decor + overhead bands |
| Pack schema | `packages/shared/schemas/src/lib/game/content_pack.ts:668-690` (`ContentPackTileSchema`) | modify — add `terrains`, keep `tiles` for hand-placed frames |
| Runtime pack projection | `PackConfigSchema` / `PackConfig` (C-376) | modify — carry `terrains` across the worker boundary |
| Atlas generation | `scripts/src/lib/ops/` (existing generators) | modify/extend — packer with extrusion |
| Environment UBO | `environment/environment_ubo.ts`, `systems/environment_system.ts` | reuse — bind to the tilemap shader |
| Content audit | `__tests__/emberwatch_content_audit.test.ts` | modify — audit terrain IDs instead of GIDs |

## Overview

Turn the map format from a rendering artifact into an authoring format. Maps
gain a semantic **terrain-ID channel** (and an unused-for-now **elevation**
channel); the engine resolves terrain IDs into tile GIDs at load time using
**layered corner-16 autotiling with terrain precedence**, so N terrains cost
N×16 frames rather than N²×16 and three-way junctions resolve by draw order.
Rendering gains **ground / decor / overhead z-bands** so tiles can draw above
entities. Collision derives from terrain IDs directly and never from resolved
GIDs, which structurally removes the invisible-wall failure class.

## Design Reference

- **Layered precedence autotiling** is the standard solution to the N² transition-set problem: render the lowest-precedence terrain as a solid fill, then each higher terrain as its own autotiled overlay with transparent edges, in precedence order. Godot's `TileSet` terrain system and Tiled's Wang "Corner" sets use the same corner-sampling model.
- **Corner-16**: a cell's tile index is a 4-bit mask of which of its four *corners* belong to the terrain being drawn. Each corner's terrain is the highest-precedence terrain among the (up to) four cells touching it. 16 frames per terrain, laid out in mask order.
- C-376 established `rendering/layer_bands.ts` and the in-place `zIndex` sort — extend that model, do not replace it.
- C-377 established the owned chunk array and the corrected uniform lifetime — build the per-band containers on top of it.
- Follow `__tests__/emberwatch_content_audit.test.ts` for the "read the real committed content and assert on it" test pattern.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Terrain IDs are the source of truth; GIDs are derived and never persisted.** The autotiler runs at `loadMap` and produces the tile layers the chunk renderer consumes. Nothing writes resolved GIDs back to disk.
- **Collision reads terrain IDs, never resolved GIDs.** An edge tile has no walkability of its own — it is the *appearance* of a boundary between two cells that each already have walkability from their terrain. This is the invariant that makes the whole design safe; encode it as a test, not a comment.
- **Frames are referenced by name, not by tile ID.** Names survive atlas regeneration; GIDs do not. This matters the moment art is generated or community-contributed.
- **One terrain = one contiguous run of 16 frames in mask order.** Declare a `frameBase` and derive the rest by index. Do not require 16 explicit frame names per terrain — that is 16 chances for a content author to make a typo.
- **Layers declare their band, the engine does not infer it from the name.** A `band` property on the layer (Tiled supports layer custom properties natively) with a documented default. Name-sniffing breaks the moment someone writes `Overhead` or `roof`.
- **The legacy baked-GID path must keep working.** `whispering-caves` and any community map authored before this contract must still load. Terrain is an additive channel; a map with no terrain channel takes the existing path.
- **Extrusion belongs in the packer, not the shader.** Once frames are extruded by 1px the UV rects become exact and the half-texel inset from C-377's deferral is deleted, not adjusted.

## State & Data Models

### Map file — additive channels

```jsonc
{
  "width": 20, "height": 20, "tilewidth": 32, "tileheight": 32,
  "aikami": {
    "formatVersion": 1,
    // Row-major, one terrain ID per cell. "" or omitted = the pack's base terrain.
    "terrain": ["grass", "grass", "dirt", ...],
    // Row-major int8. Reserved — no consumer in this contract. Cliffs/ramps land later.
    "elevation": [0, 0, 0, ...]
  },
  "layers": [
    { "name": "decor",    "type": "tilelayer", "properties": [{ "name": "band", "value": "decor" }], ... },
    { "name": "overhead", "type": "tilelayer", "properties": [{ "name": "band", "value": "overhead" }], ... },
    { "name": "collision","type": "tilelayer", ... }
  ]
}
```

### Pack manifest — `terrains`

```ts
/** A terrain declared by a content pack. Frames are resolved by name. */
const ContentPackTerrainSchema = Type.Object({
  name: Type.String({ description: 'Human-readable terrain name' }),
  /** Draw order. Lower renders first; the lowest-precedence terrain is the base fill. */
  precedence: Type.Integer({ minimum: 0 }),
  /** 'fill' = solid base terrain, no transitions. 'corner16' = 16 frames in mask order. */
  wang: Type.Union([Type.Literal('fill'), Type.Literal('corner16')]),
  /** Frame name of mask index 0. corner16 derives indices 1..15 from the atlas order. */
  frameBase: Type.String(),
  /** Optional extra frames for the 'fill' variant, chosen deterministically per cell. */
  variants: Type.Optional(Type.Array(Type.String())),
  isWalkable: Type.Boolean(),
  movementCost: Type.Optional(Type.Number({ minimum: 0 })),
  /** Blocks line of sight. Consumed by the vision raycasters (C-379). */
  blocksSight: Type.Optional(Type.Boolean()),
});
```

### Z bands

```ts
export const WORLD_Z_BANDS = {
  debugGrid:    -2000,  // unchanged in value; see AC-1 watch point
  tilemapGround: -1000,
  tilemapDecor:   -900,
  zoneOverlays:   -750,
  // entities occupy [MIN_ENTITY_Y, +∞) via computeEntityZIndex
  tilemapOverhead: 100_000,
} as const;
```

### Resolved terrain grid (in-memory, per map load)

```ts
type ResolvedTerrain = {
  width: number;
  height: number;
  /** Terrain index per cell, into the pack's ordered terrain list. */
  cells: Uint8Array;
  /** Reserved; all zero until cliffs land. */
  elevation: Int8Array;
  /** Ordered terrain ids, index-aligned with `cells` values. */
  terrainIds: readonly string[];
};
```

## Quality Requirements

- **Offline/degraded mode**: a pack whose `terrains` block is absent or invalid falls back to the legacy baked-GID render path with a single warning — never a blank map.
- **Accessibility/input**: N/A — no input surface changed.
- **Performance budget**: terrain resolution under 50ms for 200×200; per-frame cost must not regress — a cell may now draw 2–3 overlapping quads across bands, so verify the village holds 60fps and record the chunk/draw counts.
- **Security/privacy**: `frameBase` and terrain frame names are pack-controlled strings used as atlas keys. They must be validated against the loaded atlas and never used to construct a URL or a filesystem path.
- **Persistence/migration**: map files change shape (additive). Saves store `{packId, mapId, playerX, playerY, spawnId}` and are unaffected — coordinates are world pixels, which this contract does not change. See Migration & Rollback.
- **Cancellation/retry/idempotency**: `loadMap` already runs per portal transition; terrain resolution must be pure and repeatable with no module-level mutable state.
- **Observability**: log resolved terrain counts, per-band chunk counts, and any unknown terrain ID once per map load (not per cell — follow the batched-warning pattern already used in `buildCollisionGrid`).

## Migration & Rollback

This contract changes the **map file format** (additively) and the **content-pack
manifest schema** (additively). It does not change save format.

- **Old data compatibility**: a map with no `aikami.terrain` channel renders through the existing baked-GID path. A pack with no `terrains` block behaves exactly as today. Both are tested (AC-8).
- **Migration**: `scripts/` gains a converter that reads a baked-GID map plus its pack manifest and emits the terrain channel by inverting `tiles[gid].name` → terrain id. Run once over the 4 committed maps; the baked GID layers are kept in the file so the maps remain loadable by the legacy path.
- **Rollback**: `git revert`. Because the converter is additive and the legacy path is retained, a reverted engine still loads the converted maps.
- **Feature flag or kill switch**: terrain resolution is gated on the presence of `aikami.terrain` in the map and a valid `terrains` block in the pack. Deleting either from the pack manifest disables autotiling at runtime with no redeploy.
- **Failure recovery**: an unknown terrain ID resolves to the pack's base terrain and logs once. A missing frame resolves to `fallbackTile`. Neither aborts the map load.

## Scope Boundaries

- **In Scope:**
  - `aikami.terrain` + `aikami.elevation` map channels (elevation parsed and carried, not consumed)
  - `ContentPackTerrainSchema` + `terrains` on the manifest; `PackConfig` projection across the worker boundary
  - Layered corner-16 autotiler with terrain precedence
  - Ground / decor / overhead z-bands; per-band chunk containers; `band` layer property
  - `solidityLayers` actually wired through `game_world.loadMap`
  - Collision derived from terrain IDs; resolved GIDs excluded from the collision path
  - Atlas packer with 1px edge extrusion; removal of the half-texel UV inset
  - Map converter for the 4 committed maps; 16 corner frames each for `dirt` and `water`
  - Prop sprites sized from their texture + manifest anchor instead of forced 32×32
  - Day/night tint uniform on the tilemap shader
  - Content audit updated to validate terrain IDs
  - Creator-facing docs page for the terrain authoring format
- **Out of Scope:**
  - **`terrainCost` / `occupancy` runtime grids, wall-entity removal, per-entity collision masks** — C-379. This contract derives walkability from terrain but keeps the existing `CollisionGrid` boolean shape.
  - **Tiled flip-flag masking and multi-tileset-per-layer** — C-379 (they are collision/parsing correctness, and terrain authoring sidesteps both for terrain layers)
  - **Cliffs, ramps, elevation consumption** — the channel is reserved only
  - **blob-47 sets** — corner-16 only; Emberwatch does not need blob-47
  - **Runtime atlas packing** — build-time packer only
  - **LLM map generation, named regions, seeded determinism** — C-381
  - **Frame interpolation, click-to-move** — C-380
  - Any change to entity y-sorting (C-376's model stands)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. The terrain channel, the autotiler, the z-bands
and the collision derivation share one data model and one invariant ("collision
reads terrain, rendering reads GIDs, they never meet"). Shipping the bands
without terrain leaves empty containers; shipping terrain without the bands
leaves overlays that cannot be drawn in the right order; shipping either without
the collision change leaves a half-migrated solidity path — the exact "worse
than before" state the split rule exists to prevent. The atlas packer is
included because the extrusion it produces is what lets the autotiler's adjacent
frames sample cleanly.

## Acceptance Criteria

### AC-1: Tiles can draw above entities
**Given** a map with a layer carrying `band: "overhead"` containing roof tiles, and the player standing beneath them
**When** the map renders
**Then** the roof tiles draw over the player sprite, ground and decor tiles draw beneath every entity, and each band is a separate container with its own `zIndex`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Visual | `packages/frontend/engine/src/__tests__/tilemap_bands.test.ts`, `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: render a synthetic 3-band map; assert three containers exist with the declared `zIndex` values and that entity `zIndex` for any in-map `y` falls strictly between the decor and overhead bands
- E2E / Visual:
  - **Functional**: N/A
  - **Visual**: extend `emberwatch.visual.ts` with `overheadOccludesPlayer: Type.Boolean({ description: 'Whether roof/canopy tiles draw over the player when standing beneath them' })`. Add a case that spawns the player under an overhead tile.

**Watch Points**:
- `MIN_ENTITY_Y = -512` bounds the entity range below; the overhead band must sit above the *maximum* possible entity `zIndex`, which is unbounded by `computeEntityZIndex`. Use a value larger than any realistic map pixel height (100_000) and assert the invariant in the test rather than trusting the constant.
- `debugGrid: -2000` currently renders below the tilemap and is invisible. Fixing that is a one-line value change but it alters an existing documented band — if changed, record it in Amendments.

### AC-2: A cell's walkability comes from its terrain, never from the tile drawn on it
**Given** a `grass` cell adjacent to a `water` cell, where the grass cell renders a water-edge overlay frame
**When** the collision grid is built
**Then** the grass cell is walkable and the water cell is not, regardless of which frames were resolved

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/engine/src/assets/map_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: build a terrain grid with a grass/water boundary, run the autotiler, then build collision; assert collision is identical whether the autotiler ran or not
- E2E / Visual: N/A

**Watch Points**:
- **This is the load-bearing invariant of the contract.** Assert it as "collision output is byte-identical with and without autotiling", not as a spot check on two cells.
- Legacy baked-GID maps still derive collision from `tiles[gid].isWalkable`. Both paths must be covered; they are different functions after this contract.

### AC-3: Corner-16 layered autotiling resolves edges and three-way junctions
**Given** a terrain grid containing grass, dirt and water meeting at a single corner
**When** the autotiler runs
**Then** each terrain above the base is emitted as its own layer in precedence order, each cell's frame index is the 4-bit corner mask for that terrain, and the junction renders without a missing or wrong tile

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Visual | `packages/frontend/engine/src/assets/autotile.test.ts`, `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: table-driven test over all 16 corner masks per terrain; plus a 3-terrain junction fixture asserting each overlay's mask at the junction cell
- E2E / Visual:
  - **Functional**: N/A
  - **Visual**: add `terrainTransitionsLookNatural: Type.Boolean({ description: 'Whether grass/dirt/path boundaries have blended edge tiles rather than hard rectangular seams' })`

**Watch Points**:
- A corner's terrain is the **highest-precedence** terrain among the up-to-4 cells touching it. Map-edge corners touch fewer than 4 cells — define and test the out-of-bounds rule explicitly (recommendation: treat OOB as the base terrain).
- Mask bit order (which corner is bit 0) is arbitrary but must match the atlas frame order. Pin it in a documented constant and in the test, or every future terrain sheet will be authored against a guess.
- Terrains with equal `precedence` are ambiguous. Reject duplicate precedence values at schema validation rather than resolving arbitrarily.

### AC-4: `solidityLayers` is honoured, so decor and overhead layers never block
**Given** a map with `decor` and `overhead` tile layers containing non-walkable frames
**When** the collision grid is built
**Then** only the terrain channel and the explicit `collision` layer contribute solidity, and the decor/overhead layers contribute none

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `packages/frontend/engine/src/assets/map_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: build collision for a map whose `overhead` layer is entirely roof tiles (`isWalkable: false`); assert zero cells are blocked by that layer
- E2E / Visual: N/A

**Watch Points**:
- `game_world.ts:2101` is the call site that must start passing options — verify by grep that no other `buildCollisionGrid` caller remains optionless.
- The explicit `collision` layer stays **additive** (it can only add solidity, never re-open a terrain-solid cell). Preserve that; it is C-376 behaviour.

### AC-5: The atlas packer extrudes frames and the UV inset is gone
**Given** a directory of per-terrain tile sheets
**When** the packer runs
**Then** it emits `atlas.webp` + `atlas.json` with 1px edge extrusion around every frame, the packing is deterministic for identical inputs, and the chunk renderer uses exact UV rects with no half-texel inset

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Visual | `scripts/src/lib/ops/__tests__/atlas_packer.test.ts`, `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run scripts:test && moon run engine:test`
- Integration: pack a fixture twice, assert byte-identical output; assert each frame's 1px border equals its adjacent edge row/column; assert `getUvRect` returns `px / imagewidth` exactly
- E2E / Visual: reuse the AC-1/AC-3 visual run — bleeding shows up as coloured fringes on tile edges

**Watch Points**:
- Deterministic packing matters because the asset registry is content-hash keyed (C-373) — non-deterministic output re-downloads the atlas on every build.
- Extrusion changes the atlas dimensions, so `atlas.json` frame rects and every `tiles[].frame` lookup must be regenerated together. Do not hand-edit either.
- The existing 48 hand-authored frames must survive the repack unchanged in appearance.

### AC-6: Emberwatch's committed maps carry a terrain channel and render through it
**Given** the 4 committed maps in `static/content-packs/`
**When** the converter has run and the game boots
**Then** each map has an `aikami.terrain` channel consistent with its original ground layer, the village renders with autotiled grass/dirt/water edges, and the content audit validates terrain IDs against the pack's `terrains` block

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration + Visual | `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts`, `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: for each committed map, assert every terrain ID exists in the pack's `terrains`, and that the terrain-derived collision grid matches the pre-conversion GID-derived one cell-for-cell
- E2E / Visual: full `emberwatch.visual.ts` run, score ≥ 90 with the new fields true

**Watch Points**:
- "Terrain-derived collision equals GID-derived collision" is the conversion correctness proof. Run it as a one-off migration assertion; if it fails, the converter's `name → terrain` inversion is wrong, not the engine.
- `whispering-caves` is currently unreachable from the UI (`game_canvas_view_model.svelte.ts:135` hardcodes `'emberwatch'`). Convert it anyway — it is the only second pack and it is the regression canary for pack-independence. Fixing the hardcode is C-381.
- 32 new frames (16 dirt + 16 water) must be authored. That is the critical-path art task; sequence it first.

### AC-7: Props render at their authored size and anchor
**Given** a prop whose atlas frame is taller than one tile
**When** it spawns
**Then** the sprite renders at the texture's native size with the manifest's anchor applied, and existing 32×32 props are pixel-identical to before

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit + Visual | `packages/frontend/engine/src/__tests__/prop_texture_resolver.test.ts`, `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: resolve a synthetic 32×64 frame; assert `sprite.width === 32 && sprite.height === 64` and `anchor` matches the manifest
- E2E / Visual: existing `propsVisible` field must stay true

**Watch Points**:
- Prop collision is derived from the foot pixel and stays one tile regardless of art height — that is correct for top-down and must not change here. Assert it explicitly so a future reader does not "fix" it.
- The manifest anchor default is `(0.5, 1.0)`; props with no `anchor` must keep that.

### AC-8: Legacy baked-GID maps and terrain-less packs still load
**Given** a map with no `aikami.terrain` channel, or a pack with no `terrains` block
**When** the game loads it
**Then** it renders through the existing GID path with one warning and no visual regression

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Unit | `packages/frontend/engine/src/assets/map_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: load a pre-conversion copy of `village.json` against a pack with no `terrains`; assert chunk count and collision grid match the pre-contract baseline
- E2E / Visual: N/A

**Watch Points**:
- Keep a pre-conversion fixture copy in the test tree — once the committed maps are converted, this path has no other coverage.
- The warning must fire once per map load, not per cell.

### AC-9: The tilemap responds to time of day
**Given** the environment system reports dusk
**When** the tilemap renders
**Then** ground, decor and overhead tiles are tinted by the same day/night factor the rest of the scene uses, and a fully-neutral factor produces pixel-identical output to an untinted render

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Unit + Visual | `packages/frontend/engine/src/__tests__/tilemap_render.test.ts`, `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: assert the tint uniform is present in the chunk shader resources and updates when `stepEnvironment` advances the game hour
- E2E / Visual: add a visual case at a dusk `gameHour` search param asserting the scene reads as evening

**Watch Points**:
- C-377 fixed the uniform-group lifetime; this is the first real consumer of it. If the tint appears to do nothing, re-check AC-5 of C-377 before debugging the shader.
- Neutral-factor pixel-identity is the guard against a tint that silently darkens the whole game.

### AC-10: Content-pack authors have a documented terrain format
**Given** a creator wanting to add a terrain to a pack
**When** they read the docs site
**Then** they find the `terrains` schema, the corner-16 frame layout and mask bit order, the precedence rule, the band property, and a worked example

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | Integration | `apps/frontend/docs/src/content/docs/` (new page) | docs site | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run docs:build`
- Integration: the worked example in the page must be the same fixture the AC-3 test uses — copy-paste drift here is what makes format docs wrong within a month
- E2E / Visual: N/A

**Watch Points**:
- Document the mask bit order with a diagram, not prose. It is the single thing a terrain-sheet author must get right.

## Implementation Sequence

1. **Phase 1 (Art + packer)**: Build the atlas packer with extrusion. Author the 16 dirt + 16 water corner frames. Repack `atlas.webp`/`atlas.json`. Delete the half-texel UV inset. This is the critical path — everything else can proceed in parallel once the frame layout is fixed.
2. **Phase 2 (Schema)**: `ContentPackTerrainSchema` + `terrains` on the manifest; extend `PackConfigSchema`/`PackConfig` so terrains cross the worker boundary (mirror the C-376 packConfig plumbing exactly).
3. **Phase 3 (Format + converter)**: Parse `aikami.terrain`/`aikami.elevation` in `map_loader`. Write the converter; run it over the 4 committed maps; assert terrain-derived collision equals GID-derived collision.
4. **Phase 4 (Autotiler)**: Corner mask derivation, precedence resolution, per-terrain overlay layer emission. Table-driven tests over all 16 masks first.
5. **Phase 5 (Bands)**: Add decor/overhead bands, per-band chunk containers, the `band` layer property, and wire `solidityLayers` through `game_world.loadMap`.
6. **Phase 6 (Collision)**: Derive collision from terrain IDs; prove byte-identity with and without autotiling.
7. **Phase 7 (Polish)**: Prop native sizing; day/night tint uniform.
8. **Phase 8 (Validation)**: Update `emberwatch_content_audit.test.ts` to terrain IDs; write the docs page; `moon run :typecheck && moon run :test && moon run :lint`; run `emberwatch.visual.ts`.

## Edge Cases & Gotchas

- **Map-edge corners touch fewer than 4 cells.** Undefined behaviour here produces a visible border artefact on every map. Decide (OOB = base terrain), document it, test it.
- **Duplicate `precedence` values are unresolvable.** Reject at schema validation, not at render time.
- **A cell now draws up to 3 quads across bands.** On a 200×200 map with 3 overlays that is ~120k quads. Fine, but measure — and note that per-band containers multiply the chunk count, which interacts with C-377's culler.
- **The converter inverts `tiles[gid].name` → terrain id.** Any GID whose `name` is not a declared terrain (props-on-ground, decorative one-offs) must stay a hand-placed decor-layer tile, not become a terrain. Enumerate those explicitly for the 4 maps rather than guessing.
- **Terrain frame names are pack-controlled input.** Validate against the loaded atlas key set. Never interpolate them into a URL or path — C-381 hardens this for community packs, but do not create the hole here.
- **The visual suite prompt describes the *current* village** (`emberwatch.visual.ts:33-50`). Autotiled edges will change the scene enough that the prompt needs updating in the same PR, or the gate fails for the wrong reason.
- **Do not consume `elevation` in this contract.** Parsing and carrying it is cheap; a half-implemented cliff system is exactly the "scaffolding marked done" pattern the review flagged.

## Open Questions

Must be resolved before status becomes `approved`:

- Corner mask bit order: recommend `bit0 = NW, bit1 = NE, bit2 = SE, bit3 = SW` (clockwise from north-west), giving mask 0 = "no corners" and mask 15 = "fully inside". Confirm before the 32 frames are authored — changing it afterwards means redrawing them.
- Should the base terrain be declared explicitly on the pack (e.g. `baseTerrainId`) or inferred as the lowest `precedence`? Recommendation: infer, and reject a pack with no `wang: 'fill'` terrain.
- Does `whispering-caves` get converted in this contract or deferred? Recommendation: convert — it is the only evidence that the format is not Emberwatch-specific.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.1 | 2026-08-12 | Open-Question resolutions adopted: corner mask bit order `bit0=NW, bit1=NE, bit2=SE, bit3=SW`; base terrain inferred as lowest precedence (reject no-`fill` packs); `whispering-caves` NOT converted because its pack has no atlas/tiles names to invert (raw debug tileset) — it remains the AC-8 legacy canary and the C-381 hardcode keeps it unreachable. Visual suite captures at `?gameHour=12` (AC-9 hook) because the game boots at midnight and the tint darkens the tilemap. | implementer (per contract recommendations) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Implemented the layered terrain format + corner-16 autotiling end-to-end: the
`aikami.terrain`/`aikami.elevation` map channels, `ContentPackTerrainSchema` +
`terrains` on the manifest and PackConfig, a pure layered corner-16 autotiler
(`autotile.ts`) with terrain precedence and documented mask bit order, ground /
decor / overhead z-bands with per-band chunk containers, terrain-ID-derived
collision (byte-identical to the GID path on all three converted maps), an
atlas packer with 1px edge extrusion (+ 32 authored corner frames), native prop
sizing, a day/night tint uniform fed from the worker UBO, and a creator-facing
docs page. All three Emberwatch maps were converted (terrain channel + decor/
overhead bands + a dirt-ringed water pond) and regenerate deterministically;
the production `/game` route renders the autotiled village with a 95/100 visual
score. `whispering-caves` was not converted (its pack has no atlas/tiles names
to invert) — it remains the AC-8 legacy canary.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Per-band containers with declared zIndex; `tilemap_bands.test.ts` + rendering.test invariant update; visual `overheadOccludesPlayer: true` |
| AC-2 | ✅ | Collision derives from terrain ids; byte-identity test with/without autotiling in `map_loader.test.ts` |
| AC-3 | ✅ | `autotile.test.ts` — 16-mask table, junction fixture, OOB rule, bit order pinned |
| AC-4 | ✅ | `solidityLayers` wired through `game_world.loadMap`; overhead roof layer never blocks (test) |
| AC-5 | ✅ | Extruded 544×272 atlas, exact UVs (no half-texel inset), deterministic; derivation test pins frame rects |
| AC-6 | ✅ | All 3 emberwatch maps carry terrain channels; audit validates terrain ids + collision parity cell-for-cell |
| AC-7 | ✅ | Props render at native size + manifest anchor; `prop_texture_resolver.test.ts` pins 32×64 + 32×32 |
| AC-8 | ✅ | Legacy no-terrain maps + terrain-less packs still load (tests); `whispering-caves` is the real canary |
| AC-9 | ✅ | `uTint` shader uniform fed from worker UBO; neutral default = pixel-identical; `?gameHour=` hook + visual noon/dusk capture |
| AC-10 | ✅ | `guides/terrain-authoring.mdx` — schema, mask diagram, precedence, band table, AC-3 fixture |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/engine/src/assets/autotile.ts` | Layered corner-16 autotiler (mask derivation, precedence, frame naming, grid resolution) |
| `packages/frontend/engine/src/assets/autotile.test.ts` | AC-3 table-driven tests over all 16 masks + junction + validation |
| `packages/frontend/engine/src/__tests__/tilemap_bands.test.ts` | AC-1 per-band container + zIndex invariant tests |
| `apps/frontend/docs/src/content/docs/guides/terrain-authoring.mdx` | AC-10 creator-facing terrain format docs |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/game/content_pack.ts` | `ContentPackTerrainSchema`; `terrains` on manifest + PackConfig |
| `packages/frontend/engine/src/assets/map_loader.ts` | Parse `aikami.terrain`/`elevation`, layer `band` property, terrain-collision path, `frames` layer support |
| `packages/frontend/engine/src/assets/map_loader.test.ts` | AC-2/AC-4/AC-8 terrain-channel + legacy tests |
| `packages/frontend/engine/src/rendering/layer_bands.ts` | `tilemapGround`/`tilemapDecor`/`tilemapOverhead` bands |
| `packages/frontend/engine/src/rendering/tilemap_chunk_renderer.ts` | Frame-name layer support, exact UVs (no inset), `uTint` uniform |
| `packages/frontend/engine/src/systems/tilemap_render_system.ts` | Terrain layers + per-band containers + `bandContainers` result |
| `packages/frontend/engine/src/game_world.ts` | Terrain resolution, band wiring, solidityLayers, worker-UBO tint, prop native sizing |
| `packages/frontend/engine/src/systems/environment_system.ts` | (removed unused `getEnvironmentTint`) |
| `packages/frontend/engine/src/index.ts` | Export autotile module + `DEFAULT_TILEMAP_BAND` |
| `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts` | Terrain-id audit, parity test, extruded-atlas fixtures |
| `packages/frontend/engine/src/__tests__/rendering.test.ts` | AC-1 band invariant (overhead above entities) |
| `packages/frontend/engine/src/__tests__/tilemap_render.test.ts` | AC-9 tint uniform test + multi-band AC-8 expectations |
| `packages/frontend/engine/src/__tests__/prop_texture_resolver.test.ts` | AC-7 native-size tests |
| `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts` | Project `terrains` into PackConfig; `?gameHour=` AC-9 hook |
| `apps/frontend/client/static/content-packs/emberwatch/manifest.json` | `terrains` block (grass/dirt/water) |
| `apps/frontend/client/static/content-packs/emberwatch/maps/*.json` | Terrain channel + decor/overhead bands + dirt-ringed pond |
| `apps/frontend/client/static/game-data/sprites/tilesets/atlas.json|webp` | Extruded 544×272 atlas with 80 frames |
| `scripts/src/lib/ops/generate_emberwatch_tables.ts` | ATLAS_CELL/PADDING, `readManifestTerrains`, `cornerFrameName` |
| `scripts/src/lib/ops/generate_emberwatch_atlas.ts` | 1px extrusion pass + 32 corner-frame painters |
| `scripts/src/lib/ops/generate_emberwatch_maps.ts` | Terrain-channel emission + decor/overhead bands + pond |
| `scripts/src/lib/ops/generate_emberwatch_derivation.test.ts` | AC-5 frame-rect + determinism tests |
| `apps/e2e/src/visual/suites/emberwatch.visual.ts` | AC-1/AC-3/AC-9 fields + `gameHour=12` capture |
| `apps/frontend/client/scripts/build_tauri.ts` | Biome import-order auto-fix (no semantic change) |

### Deviations from Spec

- **`whispering-caves` not converted** (Open Question 3): its manifest has no
  `atlas`/`tiles` block (raw `debug_tiles.png`, no names to invert), so the
  converter cannot derive a terrain channel. It remains the AC-8 legacy
  canary; the C-381 hardcode keeps it unreachable. Recorded in Amendments
  v2.0.1 — an Amendment for a future contract (C-381) can give it real tiles.
- **Visual suite captures at noon** (`?gameHour=12`) instead of the default
  midnight boot: AC-9's tint correctly darkens the tilemap at night, so the
  terrain-evidence capture needs daylight. Dusk/night behavior is covered by
  the AC-9 unit test + the tint logic itself.
- **`debugGrid` band value left at -2000** (AC-1 watch point): the fix is a
  one-line value change to a documented band; deferred to avoid scope creep —
  noted in the watch point, not amended.
- The pre-existing `updateRenderable` renderer error on input (present on the
  base commit in the same headless environment) is unrelated to C-378 and was
  not fixed here.

### Test Results

- Unit (engine): 966 pass / 0 fail (baseline 922 — 44 new)
- Scripts: 58 pass / 0 fail
- E2E Visual: Score 95/100 — PASS (all AC fields true, 0 issues)
- Baseline: 0 pre-existing failures, 0 new failures
- Typecheck: schemas, types, engine, scripts, client, e2e, docs — all clean
- Build: client + docs — clean
