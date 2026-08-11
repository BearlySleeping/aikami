# Game Engine / World Setup — Critical Review

**Companion to:** `docs/research/game_engine_architecture_brief.md`
**Method:** read the brief, then read the code it maps and followed imports.
Verified claims against the actual content-pack data, ran the engine test
suite (910 pass / 0 fail, 38 files, 738 ms).

---

## 0. Verdict

**The foundation is not right yet — but the problems are concentrated, and
most of them are cheap.**

The split is not where the brief expected. The ECS / worker / collision /
content-pack layers are sound-to-overbuilt and mostly work. The **rendering
layer — precisely the thing about to be polished — contains several paths
that are outright broken**, and the green test suite does not cover a single
one of them. There is **zero test coverage for `renderTilemap`,
`buildTilemapChunks`, or `frustumCullChunks`.**

If you polish the Emberwatch map on top of the current renderer, you will
spend the whole time fighting blurry output, a z-order model that cannot
express an overhead layer, and a collision builder that makes adding a decor
layer impossible. Fix the ten items in §2 first — most are one-line — and the
polish work becomes ordinary.

The second finding is one the brief could not see because it never opened the
map files: **the machinery is one to two orders of magnitude larger than the
content it serves.** That is the strategic problem behind most of the
tactical ones.

---

## 1. Reality check: what is actually being rendered

| | |
|---|---|
| `village.json` | **20 × 20 tiles** (640 × 640 px). One `ground` tilelayer, one `collision` tilelayer. 10 distinct GIDs. 182 solid cells. |
| `inn.json`, `merchant_shop.json` | **16 × 12 tiles** each |
| `whispering_caves.json` | 15 × 15 |
| Atlas | `atlas.webp` — **12.9 KB**, 512×256, 48 named frames |
| Live content | 1 NPC + 3 props on the starter map |

The machinery pointed at that:

- A **32×32-tile chunked Mesh renderer** with CPU frustum culling. The village
  is `ceil(20/32) = 1` chunk. The culler has never had two chunks to choose
  between.
- A cooperative, time-sliced **JPS pathfinder** with a generational reset
  table and a flat min-heap — **zero callers**.
- A bitmask **GOAP planner**, **DDA + shadowcasting FOV**, **macro zone
  simulation** on a 500 ms tick.
- `MAX_ENTITIES = 10000` buffers; 12,707-row Turso asset registry;
  8.7 MB of JSON parsed at boot to serve ~8 non-LPC assets.
- 53k lines of engine, 59k lines of client services, **385 barrel exports**.

None of this is wrong to have *eventually*. But it means every real bug hides
inside a large surface that looks finished, and the test suite passes while
the assembled render path is broken.

---

## 2. Showstoppers — fix before touching the map

Ordered by (impact on map polish) × (cheapness).

### S1. Tilemap and prop textures are never set to `nearest` → the map is blurry

`tilemap_render_system.ts:97-105` loads the atlas with `Assets.load` /
`Texture.from` and never touches `scaleMode`. PixiJS defaults to **linear**.
The world container is scaled **4×** (`game_world.ts:2518`), so every tile is
bilinearly smeared across 4× its size.

Every *other* texture path in the repo sets it correctly —
`texture_manager.ts:444`, `blob_url_loader.ts:49,58`, `lpc_renderer.ts:251`,
`game_world.ts:2627`. The tilemap and `prop_texture_resolver.ts` are the two
that were missed. So the character is crisp and the ground under them is not.

**This is the single highest-value fix in the report.** Set
`TextureStyle.defaultOptions.scaleMode = 'nearest'` globally in `pixi_app.ts`
rather than patching call sites, so the next loader added cannot regress it.

### S2. No `resolution` / `autoDensity` → blurry again on any HiDPI display

`pixi_app.ts:127-138` passes neither. The canvas renders at CSS resolution and
the browser upscales it with bilinear filtering. Note that the *dev* LPC views
do set `resolution: 1, autoDensity: false` explicitly
(`lpc_preview_view_model.svelte.ts:318`) — the game canvas never got the same
treatment.

Also here: `antialias: true` is pointless for pixel art, and
`preserveDrawingBuffer: true` costs a backbuffer copy every frame in
production — it should be gated to E2E/dev.

### S3. Camera never snaps to pixels → the tilemap shimmers while walking

```ts
// game_world.ts:2523
this._worldContainer.x = this._app.screen.width / 2 - this._cameraX * scale;
```

`_cameraX` is a lerped float (`camera_system.ts`, `DEFAULT_LERP_FACTOR = 0.08`)
and `scale` is `4 * zoom` where zoom is itself lerped. The container lands on
fractional device pixels every frame, so with nearest sampling the tile grid
crawls and jitters. Round the final container position to whole device pixels
(and keep the camera itself continuous).

Related: the lerp factor is applied **per frame, not per delta** — camera
follow speed is framerate-dependent.

### S4. The WGSL tilemap shader applies no transform — the WebGPU path is broken

```wgsl
// tilemap_chunk_renderer.ts:59-64
fn mainVertex(input: VertexInput) -> VertexOutput {
  output.position = vec4<f32>(input.aPosition, 0.0, 1.0);  // raw world pixels → clip space
```

Vertex positions are raw world pixels (`_buildChunk` writes `col * tilePixelW`).
Clip space is `[-1, 1]`. Nothing multiplies by the projection or world
transform, and the shader never declares the `@group(0)` globals PixiJS
injects. On WebGPU the entire map collapses to a sub-pixel smear at the
origin.

The GLSL fallback (`:124-129`) does it correctly. And `rendererPreference`
defaults to `'webgl'` (`pixi_app.ts:126`) with nothing in the client passing
anything else — so **WebGPU is never actually selected, which is why nobody
noticed.**

This is not a shader to fix; it is a shader to delete (see §6). The GLSL path
is the only one that has ever run.

### S5. Frustum culling permanently deletes chunks

```ts
// tilemap_chunk_renderer.ts:370-399
for (const child of container.children) {     // live array
  ...
  if (overlaps && !chunkMeta.isActive) {
    if (!mesh.parent) container.addChild(mesh);   // unreachable
  } else if (!overlaps && chunkMeta.isActive) {
    mesh.parent.removeChild(mesh);                // leaves container.children
  }
}
```

Two bugs stacked. The loop mutates the array it is iterating, so each removal
skips the next sibling. And more fundamentally: once a chunk is removed it is
no longer in `container.children`, so the loop can never visit it again — the
re-add branch is **dead by construction**. A chunk that leaves the viewport is
gone for the rest of the map's life.

This is invisible today only because the village is a single chunk that always
overlaps. It will bite on the first map wider than ~32 tiles — i.e. the first
interesting map.

Fix: keep a `TilemapChunk[]` array as the iteration source and toggle
`mesh.visible` (or `renderable`) instead of reparenting. Reparenting per frame
was never the right mechanism.

### S6. `renderTilemap` returns a uniform group nothing is bound to → tile animation is dead

```ts
// tilemap_render_system.ts:159-167
if (layer === tilemap.layers[tilemap.layers.length - 1]) {
  return { ..., globalUniforms: result.globalUniforms, ... };
}
...
// :171 — "Fallback (empty map)"
return { container, ..., globalUniforms: new UniformGroup({...}) };
```

The early return only fires when the *last element* of `tilemap.layers` is a
rendered layer. `tilemap.layers` holds only tilelayers (`map_loader.ts:333`),
and in every Emberwatch map the last one is `collision`, which is `continue`d.
So **every real map falls through to the "empty map" fallback** and gets a
fresh, unbound `UniformGroup`.

`game_world.ts:2130` stores that into `_tilemapUniforms` and writes
`uniforms.uTime` to it every frame (`:525`). It is bound to nothing.

It doesn't matter yet, because animation is fake at a deeper level:
`_buildChunk` writes `textureLayers[vi] = 0` for every vertex, the
`animStorageBuffer` is a zero-filled `Float32Array(256*4)` that is never
written, and **neither shader reads `uTime` or `animTable` at all.** C-177's
"GPU-side animated tiles" is scaffolding end to end.
`rendering/tilemap_animation_shader.ts` exports `TILEMAP_ANIMATION_WGSL` and
**nothing imports it.**

Animated water in the starter map is a reasonable polish goal. It needs to be
built, not fixed.

### S7. One z-band for the whole tilemap → an overhead layer is impossible

`layer_bands.ts` gives the entire tilemap container a single `zIndex: -1000`,
and `renderTilemap` merges every layer's chunks into **one** container
(`:150-153`). Entities sort by `zIndex = clamp(y, -512, ∞)`.

So there is no way to author a roof, a tree canopy, or a bridge deck that
draws *above* the player. Everything tile-shaped is permanently under
everything entity-shaped. For a top-down village with buildings you can walk
behind, this is a hard blocker.

(Also: `debugGrid: -2000` puts the debug grid *below* the tilemap, where it is
invisible.)

### S8. Every tile layer contributes collision → you cannot add a decor layer

`buildCollisionGrid` (`map_loader.ts:758-766`) walks **all** non-collision tile
layers and marks a cell solid if any layer's GID has `isWalkable: false`.

The moment you add `decor` or `overhead` to make the village look better, a
roof tile over a walkable interior makes that interior solid. The escape hatch
exists — the `solidityLayers` option — but **it is never passed by any caller**
(`game_world.ts:2101` calls `buildCollisionGrid(tilemap, packConfig)`).

S7 and S8 together are why the map cannot currently be made prettier.

### S9. Props are force-resized to exactly 32×32

```ts
// game_world.ts:1221-1223
const propSprite = new Sprite(resolution.texture);
propSprite.width = 32;
propSprite.height = 32;
```

No multi-tile props. No 32×64 gate, no tree, no two-tile well. The manifest
carries per-prop `anchor` and `collision` but no size, and the atlas is
uniformly 32×32 today — so this is latent rather than active, but it caps the
art direction of the polish pass. Use the texture's native size and the
manifest anchor.

### S10. The entire tilemap path has zero test coverage

`rendering.test.ts` is 2,379 lines and mentions neither `renderTilemap`,
`buildTilemapChunks`, nor `frustumCullChunks`. Every bug in S4–S6 sits in
untested code inside a suite that reports 910/910 green.

This is the DX finding that matters most: the test suite validates units in
isolation and never asserts anything about the assembled render path. A single
headless test that builds chunks from `village.json` and asserts chunk count,
UV ranges, and cull re-entry would have caught S5 and S6.

---

## 3. Correctness bugs outside rendering

**B1 — `GridPosition` is written once at spawn and never updated again.**
The only writes are `entity_spawner.ts:139-143` and the wall population in
`collision_system.ts:478`. No system syncs `GridPosition` from `Position`.
Consequences:

- The **player has no `GridPosition` at all** (`create_player.ts` adds
  Position, Velocity, Visual, CameraFocus, Appearance, Inventory, CombatStats,
  TurnOrder — no GridPosition, no CollisionData, no SpatialLink). The player is
  therefore **invisible to `spatial_vision_system`**, which queries
  `[VisionObserver, GridPosition]` for observers and requires
  `GridPosition + VisionVisible` on targets. The whole FOV system can never see
  the player. It is decorative.
- Any entity that *does* move (party followers, see B2) leaves a permanent
  phantom collision cell at its spawn tile and never blocks anywhere else.
- GOAP crime-witness proximity (`goap_scheduler_system.ts:437`) reads stale
  spawn coordinates.

This is the load-bearing bug behind "NPCs feel fake". Fix it before wiring any
NPC movement.

**B2 — the brief is wrong that nothing moves NPCs.** `party_follow_service`
sends `SET_ENTITY_VELOCITY` bridge commands on a **150 ms** interval
(`FOLLOW_TICK_MS`), at `FOLLOW_SPEED = 80` px/s, from the main thread. So
followers do walk — at 6.7 Hz, with pure steering, no pathfinding, and (per B1)
without updating their grid cell. They will pin themselves on the first wall
corner.

**B3 — `movement_system` uses `PLAYER_COLLISION_MASK` for every entity.**
`movement_system.ts:213` and `:255` hardcode the player's mask in the shared
loop. `COMBATANT_COLLISION_MASK` is exported right above it and never used for
movement. The moment anything but the player moves, it collides with the wrong
set — a follower will not be blocked by the player, and enemies will not be
blocked by each other.

**B4 — `movement_system` hardcodes `tileSize = 32`** (`:173`, comment: "Default
tile size"), ignoring the pack's declared `tileSize` and the map's
`tilewidth`/`tileheight`. Any pack that isn't 32px silently gets wrong
collision. The manifest schema advertises `tileSize` as configurable; it isn't.

**B5 — `input_system.ts` is dead code, and so keybinding rebinds do nothing.**
`setupInput` has **no callers**. The live keyboard handler is
`GameWorld._setupKeyboardInput` (`game_world.ts:1570-1708`), which hardcodes
`w/a/s/d/arrow*`. `keybinding_config.ts` (`keyToDirection`) is imported only by
the dead `input_system.ts`. The Settings → Controls UI writes rebinds to
localStorage that nothing reads.

Ironically the dead implementation is also the worse one: its 4-way LUT
overwrites the whole velocity per keydown, so diagonals don't exist and
releasing one of two held keys stops the player dead. The live one in
`game_world` normalizes diagonals correctly. **Delete `input_system.ts` and
wire `keyToDirection` into `_setupKeyboardInput`.**

**B6 — Tiled flip flags are not masked anywhere.** No occurrence of
`0x80000000` / `0x40000000` / `0x20000000` / `0x1FFFFFFF` in the codebase. The
moment anyone flips or rotates a tile in Tiled — the normal way to build
corners and variation during a polish pass — the GID becomes a huge number,
which means: unmatched in `_resolveGid` (tile silently disappears) **and**
unknown in `buildCollisionGrid` (fail-closed → the cell becomes solid). An
invisible wall. This will happen on day one of map polish.

**B7 — GID semantics diverge between collision and texture lookup.**
`buildCollisionGrid` keys the manifest by the **raw GID**
(`tiles[String(gid)]`), while `ManifestAtlasResolver.getTileTextureFromGid`
uses `rawGid - firstGid + 1` (`manifest_atlas_resolver.ts:289`), and
`_resolveGid` in the chunk renderer uses `rawGid - firstgid`. Three
conventions. They coincide only because `firstgid === 1` in every current map.

**B8 — a layer may only use one tileset.** `_findPrimaryTilesetForLayer`
(`tilemap_render_system.ts:198`) picks the tileset with the most tiles in the
layer and binds *its* texture, but `_resolveGid` will happily resolve a GID
against a *secondary* tileset entry and compute UVs from that tileset's
image dimensions — sampled out of the primary's texture. Multi-tileset layers
render garbage. Given the polish pass will likely want a second tileset, this
matters.

**B9 — sim and render are on independent clocks with no interpolation.**
The worker ticks on `setTimeout(tickLoop, 16)` (`ecs_worker.ts:849`); the main
thread renders on the PixiJS rAF ticker. `_updateRenderFromBuffer` snaps
display objects to the last received position with no interpolation. On a 60 Hz
display the beat between ~60 Hz-ish `setTimeout` and vsync produces a visible
hitch roughly once a second; on 120/144 Hz it is continuous judder. **This is
the "why does walking feel cheap" issue**, and it is independent of all the
texture bugs.

**B10 — wall entities consume the render buffer's ID space.**
`serializeEntityStates` indexes the shared buffer by `eid * COMPONENT_STRIDE`
and caps at `MAX_ENTITIES = 10000`. `_populateWallsFromCollisionGrid` creates
one bitECS entity per solid tile and only guards `solidCount > MAX_ENTITIES` —
it does not account for walls plus NPCs plus props plus items sharing the same
eid space. A 200×200 map at 40% solid = 16,000 wall entities, which both trips
the guard and, at lower densities, silently pushes real entities past index
10000 where they vanish from the render buffer.

**B11 — dead spatial culling.** `game_world.ts:2494-2500` has a `FIXME` and
hardcodes `visible = true` for every entity. Fine at current scale, but it
means the culling story is: broken for tiles (S5), disabled for entities.

---

## 4. Answers to the ten questions in §14

### Q1 — Is bitECS-in-worker + main-thread PixiJS right? What's the sync cost?

**The split is right. The implementation of the handoff is not.**

Keeping the sim off the render thread is the correct call for a game that will
run GOAP, vision and macro simulation, and it protects frame pacing from AI
spikes. Don't reverse it. Moving rendering into the worker (OffscreenCanvas) is
not worth it — you'd lose DOM overlay integration and PixiJS DevTools for a
benefit you don't need at this scale.

The measured cost is not the buffer copy — it's trivial. `serializeEntityStates`
does a `view.fill(0)` over 30,000 floats (120 KB memset) plus a linear scan of
the `Position` SoA arrays every tick. At current entity counts that is
microseconds. Two real costs:

1. **`setTimeout(16)` is the wrong clock.** It is not vsync-aligned, it clamps
   and jitters, and it desynchronizes from rAF. Fix: keep the worker's fixed
   timestep (that's correct for determinism) but **interpolate on the main
   thread** between the last two received states using the tick timestamp.
   That single change removes B9 and is worth more than any renderer work.
2. **The `ArrayBuffer` fallback path is the default in practice.**
   `createEngineBuffer` only returns a `SharedArrayBuffer` when
   `crossOriginIsolated` — which requires COOP/COEP headers. Check whether you
   actually ship them; if not you are running the 3-buffer transfer protocol
   with its starvation-copy path (`ecs_worker.ts:1174-1180`) on every frame.
   Setting COOP/COEP is a config change that deletes a whole class of
   buffer-lifecycle bugs.

Also: `serializeEntityStates` should write only entities the main thread
actually renders, keyed by a dense index, not by raw eid — that fixes B10 as a
side effect.

### Q2 — Is JPS right? How should NPC locomotion be driven?

**JPS is the wrong tool, and it should be deleted rather than wired up.**

JPS is a jump-point optimization for *uniform-cost, obstacle-sparse* grids
searching *long* distances. Your maps are 20×20 to 16×12 — 400 cells. A naive
A* on 400 cells completes in tens of microseconds; the cooperative
time-slicing, generational reset table and flat min-heap exist to amortize a
cost you do not have. And JPS actively fights two things you *do* want:
`movementCost` (JPS assumes uniform cost — it is not correct with weighted
tiles) and dynamic obstacles.

Recommendation:

- **Delete `math/jps/*` and `systems/jps_pathfinder_system.ts`** (~950 lines
  plus its 423-line test). It has never had a caller.
- Write a **plain weighted A*** over the terrain grid, ~120 lines, synchronous,
  no time slicing. Cache paths per agent; re-path on a timer or on
  invalidation.
- Drive locomotion as **GOAP → target cell → A* → waypoint list →
  steering**. Add a small `PathFollow` component (waypoint buffer + index) and
  a `path_follow_system` that runs in Resolution *before* `updateMovement` and
  writes `Velocity`. That is the missing executor the brief correctly
  identified.
- **Fold party-follow into the same system.** Right now it is a client service
  posting velocities at 6.7 Hz (B2), which is both laggy and unable to path.
  Followers should be ECS agents with a formation-offset goal.

Flow fields are the right answer later if you ever want 50+ agents converging
on the player. You are nowhere near that.

### Q3 — How should walkability and cost be modeled, and where should the grid live?

**One grid, owned by the worker, built once per map load, storing cost — not a
boolean.**

Today walkability is spread across four places that must agree: the manifest
`isWalkable`, the map's `collision` tilelayer, the boolean `CollisionGrid`, and
the wall entities in the spatial grid. They agree by accident.

Target:

```
Uint8Array terrainCost[w*h]   // 0 = blocked, 1..255 = movement cost ×16
Uint32Array occupancy[w*h]    // head eid of the dynamic-entity linked list
```

- `terrainCost` is built once in `buildCollisionGrid` from
  `manifest.tiles[gid].movementCost` (default 1) and `isWalkable` (→ 0), with
  the `collision` layer applied additively, and **only from the layers named in
  `solidityLayers`** (fix S8 by actually passing it — put the list in the pack
  manifest per map).
- `occupancy` keeps the existing intrusive linked list, but **only for things
  that can move or change** — NPCs, props, doors. Terrain never enters it.
- Doors and bridges become cost writes to `terrainCost` at runtime, which is
  exactly the "runtime layer toggle" the wall-entity design was reaching for,
  without the entities.
- `isWall` should be repurposed as the **vision-blocking** flag (a fence blocks
  movement but not sight; a window blocks movement but not sight; a tall hedge
  blocks both) and fed to the DDA/shadowcasting raycasters, which currently
  take an `isWall` callback that nobody wires to manifest data. That gives the
  declared-but-unused field a real job.

Then pathfinding, collision, and click-picking all read the same two arrays.

### Q4 — Is wall-as-entity sane?

**No. Delete it.**

`_populateWallsFromCollisionGrid` (`collision_system.ts:446-486`) creates one
bitECS entity per solid tile — 182 on the village map alone — and every one of
them is **pure redundancy**. The composite check every caller uses is:

```ts
isCellBlocked(tx, ty, MASK) || !isWalkable(px, py)
```

For terrain, both halves return the same answer, because the wall entities were
generated from the same boolean grid `isWalkable` reads. The entities add zero
information. They cost entity IDs (B10), memory, iteration in every
`query(world, [...])`, and a self-cleaning removal pass on every map load.

The stated justification — "enables doors/bridges/destructibles as runtime
layer toggles" — is better served by writing to `terrainCost` (Q3). Doors are
already separate interactable entities anyway
(`entity_spawner._spawnInteractable`).

Keep the dense grid + `SpatialLink` list for *dynamic* occupants. Delete
`_populateWallsFromCollisionGrid`, `_wallEids`, and the `MAX_ENTITIES` budget
guard with it.

That also collapses the three overlapping structures to two:
`terrainCost`/`occupancy` (worker, authoritative) and `SpatialHashGrid` (used
only by `context_system` for radius queries — a legitimately different access
pattern, keep it).

### Q5 — Click-to-move: where to unproject, how to route clicks?

Unprojection is trivial — the transform is entirely in one place and is a pure
translate+scale:

```ts
// inverse of game_world.ts:2523-2526
const scale = 4 * cameraZoom;
worldX = (screenX - worldContainer.x) / scale;
worldY = (screenY - worldContainer.y) / scale;
```

Do **not** use PixiJS hit-testing. Everything in the scene sets
`eventMode = 'none'` (deliberately, per C-032), and turning that on for picking
would reintroduce per-frame hit-test cost across every sprite. Instead:

1. Attach a single `pointerdown` listener to the **canvas element**, not to
   Pixi display objects.
2. Unproject to world pixels with the formula above, then to a tile via
   `Math.floor(x / tileSize)`.
3. Route by querying the *occupancy grid* at that tile, not the scene graph:
   - occupant with `Interactable`/`NPCDialog` within interaction range → interact
   - occupant with `Transition` → walk to it, then portal
   - `terrainCost > 0` → issue a move goal (Q2's A* + `PathFollow`)
   - `terrainCost === 0` → nearest walkable neighbour, or reject with a click
     feedback marker
4. Send it over the bridge as a new `MOVE_TO_CELL` command so the worker stays
   authoritative. Do not path on the main thread.

The one thing to get right early: **hover feedback**. A tile-highlight cursor
driven by the same unprojection makes the 4× scale legible and is what makes
click-to-move feel deliberate rather than mushy. Budget for it.

### Q6 — Is Tiled JSON + custom properties the right authoring pipeline?

**Yes, keep Tiled. Fix its integration; don't switch tools.**

Tiled JSON is the right format: ubiquitous, stable, human-diffable, no vendor
lock-in, and it already carries everything you use (object layers with typed
custom properties, named spawn points, transition rects). LDTK is nicer to use
but its JSON is more opinionated and you would be rewriting a working parser to
get a marginally better editor. Not worth it before the game is fun.

But the integration currently **rejects normal Tiled workflows**:

- flip/rotate flags break it (B6) — this is table stakes, fix first
- more than one tileset per layer breaks it (B8)
- more than one visual layer breaks collision (S8) and z-order (S7)
- `firstgid ≠ 1` breaks GID lookups (B7)

Fix those four and Tiled is genuinely usable. Until then, "authoring in Tiled"
means "authoring one flat ground layer with one tileset and no flips", which is
what the current maps are.

The dual **JTON** format should go. `jton_parser.ts` is 540 lines plus a test
file, and the only `.jton` files in the tree are two dev sandbox maps
(`debug_map.jton`, `sandbox_textured.jton`). One map format.

On `asset_hashes.json`: the real problem is not compression, it's that
**`manifest.json` is 7 MB of derivable data.** Each of the 12,707 entries
stores `tag` *and* a `path` that is a mechanical transform of the tag
(`lpc:hat:magic:X:Y` → `lpc/hat/magic/X.Y.webp`), plus `category`,
`subcategory` and `name` that are all substrings of the tag. Emit the tag list
and derive the rest at runtime, and merge the hash sidecar into the same file
— 8.7 MB becomes well under 1 MB before compression. See Q7/Q8.

### Q7 — Is the registry + content-hash cache + Storage fallback right? Is Turso right?

**The architecture is right for where you're going. It is deployed against the
wrong problem right now, and one component is a poor fit.**

Content-hash-addressed caching with a metadata registry and a remote fallback
is exactly how you ship a Tauri desktop game that streams 74 MB of LPC art and
verifies integrity. Keep the shape. `asset_manager.svelte.ts` (refcounted blob
URLs, in-flight dedupe, SHA-256 verify, LRU with protected packs, boot
reconcile) is genuinely good code.

Two problems:

**Turso/libSQL is over-chosen for this.** You store three tables of pure
metadata (`assets`, `asset_sources`, `install_state`) — binaries are correctly
never in SQLite. On the web that means shipping the **libSQL WASM build plus an
OPFS VFS** to hold what is effectively a key-value map. IndexedDB (or an OPFS
JSON index) does this with zero bundle cost and no WASM init on the boot
critical path. The desktop native driver is fine, but you're paying for the web
half.

That said: if the local DB is *also* the save-game store (it is — `game_save_service`
shares the connection) and you expect relational queries over quest/journal
state later, keeping one SQL engine is defensible. **The decision hinges on
whether saves stay relational.** If they do, keep Turso and stop worrying. If
saves are just blobs with a checksum — which the v3 envelope suggests — drop it.

**The registry is seeded with 12,707 rows to serve ~10 assets.** All 12,699 LPC
entries are inserted (26 chunked transactions) on first boot regardless of
whether the player's character uses six of them. Seed lazily: register an asset
row the first time it is requested. The manifest is the catalog; the registry
only needs to track *what you actually have*.

### Q8 — Is the 7-stage serialized boot optimal?

**No. Three of the seven stages are on the critical path for no reason.**

Current: `loading_campaign → validating_save → initializing_asset_registry →
preloading_content → creating_engine → hydrating_snapshot → spawning_entities`,
each fully awaited, 30 s timeout apiece.

`_stageInitializeAssetRegistry` is explicitly **non-fatal** — it catches
everything and degrades to online mode (`game_boot_service.svelte.ts:742-745`).
A stage that is allowed to fail silently has no business blocking the five
stages after it. Yet it fetches 7 MB + 1.7 MB of JSON, opens a WASM database,
seeds 12,707 rows, adds Firebase Storage sources, initializes a cache backend,
and reconciles — all before the content pack is even fetched.

Restructure:

- **Fire-and-forget the asset registry stage.** Start it at boot, `await` it
  only where an LPC texture is actually needed (character composition), which
  is after the map is already on screen.
- **Parallelize `preloading_content` and `creating_engine`.** Spawning the
  worker and initializing PixiJS have no dependency on the pack manifest until
  `loadMap`. `Promise.all` them.
- **Start `_spawnWorker` first, in the background.** Worker module import +
  evaluation (56 static imports) is pure latency that overlaps with everything.
- Shrink `manifest.json` per Q6 — that alone removes most of stage 3's cost.

A service worker is the wrong tool here (you already have OPFS + a cache
backend doing content-addressed storage; a SW would be a third caching layer).
Streaming is also premature. Just stop serializing independent work.

Also: the boot pipeline is 1,493 lines in one class. Each stage is
independently testable and mostly independent of the others — this is a
composition-root-shaped problem being solved with a method-per-stage god class.

### Q9 — Is `zIndex = y` with bands enough?

**The sort is fine. The layer model is not.**

`zIndex = clamp(y, -512, ∞)` with `sortableChildren` and a stable sort is the
correct, standard solution for entity depth in a top-down game, and the
"never-reparent, sort in place" note in C-376 is the right instinct. Keep it.

What's missing is that **tiles cannot participate** (S7). You need three
tilemap containers, not one:

| Band | Contents | z |
|---|---|---|
| `ground` | terrain, paths, water | −1000 |
| `decor` | rugs, floor detail, tile-level clutter | −900 |
| *(entities)* | y-sorted, `zIndex = y` | ≥ −512 |
| `overhead` | roofs, canopies, upper walls | +100000 |

Assign layers to bands by name in the map (or by a `band` custom property on
the layer, which Tiled supports natively). Then pair it with `solidityLayers`
(S8) so `overhead` contributes no collision.

For tall props specifically: they are already entities with `Position` and get
y-sorted correctly — the issue is only S9 (forced 32×32) and the fact that a
prop's collision cell is derived from its foot pixel while its art extends
upward, so a 2-tile-tall tree blocks one tile and overlaps the one above. That
is the *right* behaviour for a top-down game; just make sure the art anchors
match.

Bridges (walk over *and* under) are the one case this model can't express.
Don't author them until you need them; the answer then is a second
`terrainCost` layer, not a renderer change.

### Q10 — What is dead weight?

See §6 for the full list with counts. Headline: roughly **4,000–5,000 lines of
engine code have no live caller**, including the entire pathfinder, the entire
`input_system`, most of `render_system.ts`, the WGSL tilemap shader, the
animation shader, `depth_sort.ts`, the JTON parser, and a second boot path.

---

## 5. What the brief missed or got wrong

The brief was accurate on most structural claims. Corrections and additions:

**Wrong:**

- *"No NPC locomotion at all… the only writes to `Velocity` are the player."*
  Party followers move via `SET_ENTITY_VELOCITY` from `party_follow_service` at
  150 ms intervals (B2). Locomotion exists; it's just bad.
- *"Two render sync paths — verify they're not fighting."* They aren't.
  `render_system.ts` (1,515 lines) is **~dead** — `game_world.ts` imports
  exactly one symbol from it (`dirtyCheckAppearance`), and the only other live
  consumer of the module is `LpcBatchManager` in dev/preview views. GameWorld
  does its own entity rendering inline. The real issue is duplication:
  `animateEntitySystem`, `syncAppearanceSystem` and the UBO packing exist in
  **both** `render_system.ts` and `render_worker.ts` ("worker-safe subset"),
  free to diverge.
- *"Hardcoded `contentPackId: 'emberwatch'` in the canvas ViewModel"* — half
  fixed. `game_composition_root.svelte.ts:252` correctly reads
  `campaignService.activeCampaign?.contentPackId`, but
  `game_canvas_view_model.svelte.ts:135` still passes the literal `'emberwatch'`
  into `gameBootService.boot()`. So a campaign started on `whispering-caves`
  boots Emberwatch.
- *"1.6 MB `asset_hashes.json` — boot cost, parse cost on the main thread."*
  It parses in ~10 ms. The real cost is the **7 MB `manifest.json`** next to
  it, which the brief listed without flagging.

**Missed (beyond §2/§3):**

- **`whispering-caves` is unreachable content.** Listed in
  `content-packs/index.json`, referenced only by tests, and unreachable through
  the UI because of the hardcoded pack ID above.
- **Two save systems.** `game_save_service` (Turso, v3 envelope, the real one)
  and `packages/frontend/services/.../game_state_sync.svelte.ts` (Firebase
  Storage blob + DataConnect `SaveSlot` row), the latter used only by
  `views/dev/save_load`. Pick one.
- **`tilemap_render_system.ts:85-87` contains an empty `if` block** — a
  half-deleted layer filter that Biome should be flagging.
- **`resetMovementTracking` is a documented no-op** kept "for downstream
  callers" (`movement_system.ts:293`).
- **`preserveDrawingBuffer: true` ships to production** (`pixi_app.ts:138`).
- **Camera lerp is not delta-scaled** (`camera_system.ts`, `DEFAULT_LERP_FACTOR`
  applied per frame).
- **`FirebaseSqlConnectSync` is a stub** that logs `not-implemented` /
  `stub-mode` warnings during the test run. C-195's registry sync does not
  exist.
- **`docs/decisions/` contains only a `README.md`** — there are no ADRs. The
  rationale lives entirely in `docs/contracts/`, which are per-change contracts,
  not durable decision records. That's why questions like "why JPS?" have no
  written answer to check against before reversing.
- **385 exports from the engine barrel.** Every internal is public, so nothing
  can be refactored without a breaking-change review, and dead code (the
  pathfinder, `input_system`) looks "used" because it's exported.

---

## 6. Delete list

Ordered by confidence. All verified as having no live caller.

| Target | Lines | Note |
|---|---|---|
| `math/jps/*` + `systems/jps_pathfinder_system.ts` + test | ~1,400 | `requestPath` has zero callers; replace with weighted A* (Q2) |
| `systems/input_system.ts` + its dead keybinding wiring | 134 | `setupInput` has zero callers; salvage `keyToDirection` into `GameWorld` (B5) |
| `_populateWallsFromCollisionGrid` + `_wallEids` + budget guard | ~60 | pure redundancy with the boolean grid (Q4) |
| WGSL tilemap shader (`TILEMAP_CHUNK_WGSL`, `_getSharedGpuProgram`) | ~55 | broken and never selected (S4) |
| `rendering/tilemap_animation_shader.ts` | whole file | zero importers |
| `rendering/depth_sort.ts` | whole file | referenced only by its own test |
| `assets/jton_parser.ts` + `loadJtonMap` + test | ~700 | one map format (Q6) |
| `GameEngineService.bootWithCanvas` + its unit test | ~200 | second boot path, test asserts only that the method exists |
| Dead half of `systems/render_system.ts` | ~1,200 of 1,515 | keep `dirtyCheckAppearance` + `LpcBatchManager`; dedupe against `render_worker.ts` |
| `game_state_sync.svelte.ts` **or** `game_save_service` | — | pick one save path |
| `resetMovementTracking` | 6 | documented no-op |
| `movementCost` / `isWall` as currently defined | — | don't delete — *implement* them (Q3) |

Also prune the barrel: export the ~40 symbols the client actually imports, not
385.

---

## 7. Suggested sequencing

**Before any map polish (a day, maybe two):**

1. `scaleMode = 'nearest'` globally + `resolution`/`autoDensity` (S1, S2)
2. Round the world container to whole device pixels (S3)
3. Fix `frustumCullChunks` to iterate a chunk array and toggle `visible` (S5)
4. Mask Tiled flip flags in the parser (B6)
5. Split the tilemap into ground/decor/overhead containers with bands, and pass
   `solidityLayers` (S7, S8)
6. Delete the WGSL shader and the broken `renderTilemap` return path (S4, S6)
7. Add one integration test that builds chunks from `village.json` and asserts
   chunk count, UVs, and cull re-entry (S10)

Steps 1–3 alone will make the existing map look dramatically better with no art
changes. Do them first and re-evaluate — they may change what "polish" needs to
mean.

**Then, before NPCs feel alive:**

8. Sync `GridPosition` from `Position` each tick; give the player one (B1)
9. Interpolate rendering between sim ticks (B9, Q1)
10. Replace JPS with A* + a `PathFollow` component and system; fold party-follow
    into it (Q2)
11. Per-entity collision masks (B3) and pack-driven tile size (B4)

**Then, when you next touch boot:**

12. Shrink `manifest.json` to a derivable tag list; merge the hash sidecar (Q6)
13. Un-block the asset registry stage; parallelize preload/engine creation (Q8)
14. Lazy registry seeding (Q7)

**Ongoing:** the delete list in §6. It is roughly 4,000–5,000 lines, and every
one of them is currently something a future reader has to understand before
changing anything nearby.

---

## 8. One structural note

The pattern behind almost every finding here is the same: **a system was built
to its full designed shape before anything consumed it.** JPS has a cooperative
time-slicer and no callers. The tilemap has GPU animation infrastructure and no
animation. Vision has DDA cones and shadowcasting and cannot see the player.
The asset pipeline verifies SHA-256 across 12,707 files to serve ten. The
contracts (C-171, C-177, C-195, C-373, C-376) are detailed and the code
faithfully implements them — but several implement the *scaffolding* of a
contract and mark it done.

The tests reinforce it: 910 passing tests, and not one of them renders a real
map. The suite tests the parts that were built to spec, and the spec was
per-part.

The cheapest structural fix is not architectural. It is a single end-to-end
test that boots the engine against `emberwatch/village.json` and asserts that
pixels come out — even headlessly, even just asserting chunk geometry and
texture bindings. Everything in §2 would have been caught by it.
