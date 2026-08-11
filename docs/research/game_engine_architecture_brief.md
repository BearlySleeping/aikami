# Game Engine / World Setup — Research Brief for Critical Review

**Audience:** Claude (Opus 5) — asked to take a critical, honest look at the
whole game runtime: rendering, coordinates/grid, collision, pathfinding, NPC
population, content packs, asset caching (Firebase Storage / Turso / OPFS /
Tauri), boot, persistence, and DX. **Do not be afraid of major refactoring,
deleting code, or switching providers/tools.** The user plans to polish map
rendering and the default "Emberwatch" starter map next — we want to know the
foundation is right first.

**Repo:** `aikami` — SvelteKit 2 + PixiJS v8 + Tauri v2 client, Firebase
backend, bitECS ECS running in a Web Worker, Bun + Moon + Biome. Modes:
emulator / staging / production. Stack docs: `.context/CONTEXT.md`,
`.context/index.md`, `docs/` (architecture/, decisions/, contracts/, guides/).

> ⚠️ This brief is a map, not a substitute for reading the code. Claude should
> open the listed files and follow imports. Also actively hunt for things this
> brief missed — it was compiled by scanning, not by a full read of every line.
> Contract docs in `docs/contracts/` (e.g. C-135, C-171, C-173, C-192, C-315,
> C-326, C-331–C-334, C-370–C-376) contain the design rationale and are gold.

---

## 1. The three files the user pointed at

| File | Role |
|---|---|
| `apps/frontend/client/src/lib/views/game/game_view.svelte` | Thin view: canvas + UI overlay + combat sidebar. Delegates everything to ViewModels. |
| `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` (1494 lines) | **Active boot path** (C-326): 7-stage cancellable boot pipeline (`loading_campaign → validating_save → initializing_asset_registry → preloading_content → creating_engine → hydrating_snapshot → spawning_entities`), 30s per-stage timeout, generation-token cancellation. This is the "seeding/setup/boot" heart. |
| `packages/frontend/engine/src/index.ts` | Engine barrel export — the entire public surface (~200 exports). Read this to see everything the engine offers. |

**⚠️ Dead code found:** `GameEngineService.bootWithCanvas()` (in
`game_engine_service.svelte.ts`) is a *second, older* full boot path (LPC
pipeline + GameWorld creation + loadMap) that is only referenced by a unit
test — the real boot goes through `GameBootService.boot()` (triggered by
`game_canvas_view_model.svelte.ts` with hardcoded `contentPackId: 'emberwatch'`).
It should probably be deleted or consolidated.

---

## 2. Boot / composition / service layers (client)

- `apps/frontend/client/src/lib/views/game/game_view_model.svelte.ts` — owns composition root + child VMs.
- `apps/frontend/client/src/lib/views/game/canvas/game_canvas_view_model.svelte.ts` — canvas binding → `gameBootService.boot({ canvas, contentPackId: 'emberwatch' })`.
- `apps/frontend/client/src/lib/views/game/canvas/game_canvas_view.svelte` — canvas + HUD overlays + boot UI.
- `apps/frontend/client/src/lib/views/game/boot/game_boot_view_model.svelte.ts` / `game_boot_view.svelte` — boot progress UI.
- `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` — single owner of ~13 game services (campaign, player/world/quest state, inventory, equipment, mode, engine, overlay, session, npc dialogue, relationship, vendor).
- `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts` (single-instance singleton, owns GameWorld + bridge; **contains the dead boot path**).
- `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` — engine events → reactive state (incl. `ZONE_TRIGGERED → loadMap` portal handling).
- Other services in `apps/frontend/client/src/lib/services/game/`: `game_state_service`, `world_state_service`, `game_save_service`, `session_service`, `time_service`, `party_follow_service`, `input_action_service`, `idle_detection_service`, `npc_dialogue_service`, `onboarding_hint_service`, `quest_service`, `quest_state_service`, `player_journal_service`, `relationship_service`, `vendor_service`, `equipment_service`, `inventory_service`, `combat_service`, `gameplay_settings`, `serializable_service`, `save_map_block`, `game_state_facts`, `game_mode_service`, `game_overlay_service`, `player_state_service`, `pixi_texture_injector`, `content_pack_catalog` (items → runtime catalog).

---

## 3. Engine architecture (packages/frontend/engine)

**Pattern:** bitECS world **inside a Web Worker** (`worker/ecs_worker.ts`,
~2200 lines, 56 static imports, bootstrap with error trapping in
`worker/ecs_worker_bootstrap.ts`). Main thread owns PixiJS; per-frame the
worker's SoA component buffers are copied/synced to the main thread via
`render_worker.ts` (LpcBatchManager) / `render_system.ts` and drawn.
`GameWorld` (`game_world.ts`, 2800 lines) is the main-thread facade:
PixiJS app, camera transform on `_worldContainer` (**scaled 4×**),
SharedArrayBuffer-style buffer pool, worker lifecycle, `loadMap()`,
save/restore, input.

### Key engine files
- `game_world.ts` — lifecycle, `loadMap()` (parse map → render tilemap → post LOAD_MAP to worker), destroy.
- `engine_bridge.ts` — the sole UI↔game boundary (typed `GameCommand`/`GameEvent`).
- `pixi_app.ts` — PixiJS v8 app wrapper, renderer `webgpu | webgl` (default webgl), `import 'pixi.js/unsafe-eval'` for Tauri CSP.
- `systems/` — the tick pipeline (see §4) plus: `camera_system`, `encounter_system`, `combat_stage_system`, `context_system` (proximity via SpatialHashGrid), `interaction_proximity_system`, `interaction_target_selector`, `dialog_trigger_system`, `pressure_plate_system`, `environment_system` (day/night UBO + weather), `turn_manager_system`, `combat_tactics` (GOAP), `macro_simulation_system` (off-screen zones), `spatial_vision_system` (FOV), `progression_system`, `economy_system`, `puzzle_resolver`, `keybinding_config`.
- `math/` — `jps/` (JPS A*-style pathfinding: generational table, min-heap, cooperative stepping), `goap/` (bitmask planner), `vision/` (DDA raycaster + shadowcasting), `spatial_hash_grid.ts`, `bresenham.ts`.
- `components/` — 40+ bitECS components: `position`, `velocity`, `grid_position`, `collision_data` (layer bitmask), `spatial_link` (intrusive list), `visual`, `appearance` (LPC layers), `tile_visual`, `transition`, `spawn_point`, `interactable`(+`_state`), `chunk_data`, `zone_status`, `map_location`, `goap_agent`, `vision_*`, `camera_focus`, `engine_state`, `turn_order`, `combat_stats`, etc.
- `entities/` — `create_player.ts`, `create_npc.ts`, `create_sandbox_avatar.ts`.
- `serialization/ecs_serializer.ts` — world/player snapshot (save/restore).
- `services/` — `api_service` (GameState/Action orchestration), `ai_service`, `streaming_orchestrator`, `string_registry_service` (C-195).
- `sync/firebase_sql_connect_sync.ts` + `persistence/turso_registry_hydration.ts` — experimental string-registry sync via Firebase SQL Connect (C-195).

---

## 4. Per-frame pipeline (worker `ecs_worker.ts` tick)

1. `updateExpressions` (streaming payload drain)
2. Macro-sim time gate (500 ms interval; inactive zones get coarse GOAP ticks — `macro_simulation_system.ts`)
3. **Perception** — `updateSpatialVision` (FOV: DDA cones / shadowcasting)
4. **Cognition** — `updateGoapScheduler` (bitmask GOAP) + `updateGoapCombatTactics`
5. **Navigation** — `tickJpsPathfinder()` (cooperative, 2 ms budget) — ⚠️ *see §6: nothing ever calls `requestPath`*
6. **Resolution** — `updateMovement` (axis-independent continuous collision, per-axis sliding)
7. Camera lerp, encounters, combat stage, dialog triggers, **zoning (portal overlap)**, context (spatial hash), interaction proximity

---

## 5. Rendering pipeline

### Tilemap (C-171) — chunked Mesh rendering
- `systems/tilemap_render_system.ts` + `rendering/tilemap_chunk_renderer.ts` (717 lines):
  - Map divided into **32×32-tile chunks**, each chunk = one PixiJS `Mesh` with `Float32Array` vertex/UV + `Uint32Array` index buffers.
  - **CPU frustum culling** (`frustumCullChunks`) adds/removes chunks per frame; `autoGarbageCollect = false` on geometry to dodge a PixiJS v8 unbinding bug.
  - **Custom WGSL shader** (`GpuProgram.from`) for WebGPU + **GLSL fallback** for WebGL2 (static texture — no animation support on WebGL).
  - Tileset texture shared across chunks; `Assets.load` resolved via custom-scheme URL resolver (Tauri).
  - Animation: `tilemap_animation_shader.ts` + `uTime` uniform + storage buffer (C-177) — GPU-side animated tiles.
- Z-order: `rendering/layer_bands.ts` — declarative world-container z-bands. Tilemap `-1000`, debug grid `-2000`, zone overlays `-750`, entities `zIndex = clamp(y, MIN_ENTITY_Y=-512, ∞)` with `sortableChildren` stable sort (C-376 AC-4). **No explicit per-layer tilemap z (ground/decor/overhead all in one container)** — a single `Container` per map holds all chunk meshes in layer order.

### Entities — LPC sprites
- `rendering/sprite_composer.ts` (766 lines): **zero-branch LUT palette shader** — grayscale LPC sheets, R channel = palette index, 256×1 palette texture; `initLpcShaders`, `packRecipeToUboBuffer`, `SpriteComposer`.
- `rendering/texture_manager.ts` (925 lines): LRU GPU texture cache + grayscale LPC sheet cache + **procedurally generated Spritesheet JSON atlas** from regular grid.
- `rendering/animation_controller.ts`: LPC state rows (`walk/idle/slash/…` × 4 directions), `velocityToDirection`.
- `systems/render_system.ts` (1515 lines): bitECS `Visual` observer → placeholder Graphics → async texture swap; per-frame position sync, spatial culling (`visible=false` off-screen), **LpcBatchManager** (worker-side composition into batches — `render_worker.ts`).
- Props: `rendering/prop_texture_resolver.ts` (C-375) — **deterministic spritesheet-based frame resolution** from pack manifest (atlas + fallbackTile), replacing the old global `Texture.from(frame)` white-square bug. Built in `client/.../prop_frame_resolver.ts`, injected into GameWorld.
- Weather: `rendering/weather_overlay.ts` (rain over stage), environment day/night: `environment/environment_ubo.ts` + `systems/environment_system.ts`.
- `rendering/scene_background.ts`, `rendering/depth_sort.ts`.

---

## 6. Coordinates, grid, collision, movement, pathfinding

### Coordinate systems
- **World pixels** (`Position` x/y, float, bottom-centre anchor, 32×32 collision box: ±16 horizontal, 32 up from feet).
- **Grid tiles** (`GridPosition` x/y int, `CELL_PIXEL_SIZE = 32`).
- `toGridCellCenter` / `toCellDisplayPosition` in render_system.
- Camera: `systems/camera_system.ts` — follows `CameraFocus` (player), lerp, map-bounds clamp, dialogue zoom; world container scaled 4×.

### THREE overlapping spatial structures (⚠️ review candidate)
1. **Legacy boolean `CollisionGrid`** (`systems/collision_system.ts`) — `grid: boolean[]` + `tileSize`; `isWalkable(px,py)` pure terrain oracle (C-376 AC-3).
2. **Dense spatial grid** — flat `Uint32Array` cell → head EID of an **intrusive doubly-linked list** (`SpatialLink` component); `insertIntoSpatialGrid`/`removeFromSpatialGrid`; **solid terrain tiles become real wall entities** with `CollisionLayer.wall` (each wall = a bitECS entity! a 200×200 map with 40% walls = 16k entities).
3. **`math/spatial_hash_grid.ts`** (SpatialHashGrid) — separate structure used *only* by `context_system` (proximity/interaction queries).

### Collision
- `CollisionData { layer, mask }` bitmask (wall | npc | player | enemy | prop | item…).
- `isCellBlocked(destX, destY, moverMask)` walks the linked list; `PLAYER_COLLISION_MASK = wall|npc|enemy`; `COMBATANT_COLLISION_MASK = wall|npc|player|enemy`.
- Movement (`movement_system.ts`, 298 lines): axis-independent continuous collision with **per-axis bounding-box sweep** (multi-tile check at candidate X/Y), wall sliding, map-pixel-bounds enforcement, NaN guard.

### Walkability / terrain costs (⚠️)
- Walkability comes from the **content-pack manifest** (`buildCollisionGrid` in `map_loader.ts` — `tiles[gid].isWalkable`, unknown GID = fail-closed solid; explicit `collision` layer is additive-only). Props have `isWalkable` too (e.g. village_gate).
- **`movementCost` is declared in the schema** (`packages/shared/schemas/.../content_pack.ts` line 674), carried through `PackConfig` (game_engine_service `_buildPackConfig`), and surfaced in `manifest_atlas_resolver.ts` — **but NO system reads it**. There are no "slow tiles" today. `isWall` similarly declared but unused.

### Pathfinding (⚠️ big finding)
- **JPS** (`math/jps/*`, `systems/jps_pathfinder_system.ts`): full cooperative time-sliced implementation (generational O(1) reset, flat min-heap, 2 ms budget) — `initJpsPathfinder` is called in the worker on LOAD_MAP, `tickJpsPathfinder()` runs every frame… **but `requestPath()` is never called anywhere in the codebase.** Pathfinding is 100% scaffold, zero consumers.
- **No NPC locomotion at all:** the only writes to `Velocity` are the player (input_system / worker MOVE_PLAYER) and combat freeze. GOAP selects actions but **nothing translates GOAP state into walking**. NPCs stand still. `party_follow_service` (client) follows via position sync, not engine pathing.
- A*: there is no A*; JPS was chosen instead (fine) — but it's unused.

---

## 7. Content packs & game data (authoring format)

- `apps/frontend/client/static/content-packs/index.json` — pack registry.
- `apps/frontend/client/static/content-packs/emberwatch/manifest.json` — the schema: `id, name, version, startingMapId, tileSize, atlas {textureUrl, spritesheetUrl}, fallbackTile, tiles {gid → {name, frame, isWalkable, isWall}}, props {id → {name, frame, isWalkable?, collision?}}, entities, maps, npcs, items, dialogues, quests, encounters, factions, credits, onboarding`. Validated at runtime by TypeBox (`ContentPackManifestSchema` in `@aikami/schemas`).
- Maps are **Tiled JSON** (`.json`, "JTON"): `width/height/tilewidth/tileheight`, tilesets (image atlas), `tilelayer` `data` arrays (GIDs), **`collision` tilelayer**, `objectgroup` layers with typed objects + custom properties:
  - `type: 'npc'` → npcId, npcName, dialogueKey, interactionRadius, appearanceLayers
  - `type: 'prop'` → propId/frame
  - `type: 'transition'` → targetMap, targetX/Y, targetSpawnId (portal)
  - `type: 'spawn'` → spawnId (C-172 named spawn points)
- Parsers: `assets/jton_parser.ts` (540 lines, custom compact format support), `assets/map_loader.ts` (900 lines — TilemapData, extractSpawnPoints/TransitionZones/SpawnPointEntities, collision extraction, djb2Hash).
- Engine loader: `assets/content_pack_loader.ts` (388 lines) — validate + resolve map URLs, dialogues, npcs/items/quests/encounters/factions; module-level cache + `clearContentPackCache()`.
- `apps/frontend/client/static/game-data/` — all binaries: `manifest.json` (asset tree: ~204k-entry tag → path/meta), `asset_hashes.json` (**1.6 MB single-line JSON** of tag → sha256+size — ⚠️ boot cost), `sprites/tilesets/atlas.webp` + `atlas.json`, `lpc/` (~12k+ per-state/per-layer `.webp` files), music/sfx.
- Asset manifests: `engine/src/assets/asset_manifest.ts` + `asset_manifest_node.ts` (Node-only filesystem scan/build — deliberately not exported from barrel).

---

## 8. Asset pipeline: import, cache, Firebase Storage, Turso, web+Tauri

**Data flow:** static files (bundled) → SHA-256 verified local cache → Firebase Storage fallback.

- `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` — loads `game-data/manifest.json`, `resolveUrl(tag)`.
- `apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts` (C-373) — hybrid resolution **registry → cache → sources**; SHA-256 verify on download; refcounted `blob:` URLs (`acquireUrl`/`releaseUrl`, revoked after decode); dedupe in-flight; abortable; LRU eviction (protected packs); boot reconcile (interrupted downloads, stale-hash eviction).
- `apps/frontend/client/src/lib/services/assets/cache_backend.ts` — content-hash-keyed contract (`put/get/has/remove/listHashes`).
  - `opfs_cache_backend.ts` — web/PWA Origin Private File System (+ `requestPersistence`).
  - `tauri_fs_cache_backend.ts` — desktop via `@tauri-apps/plugin-fs` at `$APPDATA/aikami-assets`.
- **Turso/libSQL registry** (`packages/frontend/storage/src/lib/assets.ts` — AssetRegistryRepository): tables `assets`, `asset_sources`, `install_state`; **metadata only, binaries never in SQLite**; idempotent chunked seeding (500 rows) from manifest + hash sidecar; `addFirebaseStorageSources` adds the Firebase Storage origin (priority 1 after bundled) for every asset.
- DB adapters: `local_database_factory.ts` (platform select), `turso_storage_adapter.ts` (native libSQL, Tauri desktop), `wasm_storage_adapter.ts` (web WASM + OPFS), `storage_adapter.ts` (interface + `AIKAMI_SCHEMA_DDL`).
- **Firebase Storage:** `scripts/src/lib/ops/upload_assets.ts` (mirrors `static/game-data` tree + uploads the two seed files as online registry catalog), `upload_lpc_assets.ts` (12k+ LPC files, own uploader). Storage bucket per mode (`aikami-staging.firebasestorage.app` etc.).
- Boot stage `initializing_asset_registry` (game_boot_service) is the seeder: open DB → fetch manifest → fetch sidecar → seed registry → add storage sources → init platform backend → `assetManager.initialize` + `reconcile`. **Deliberately non-fatal** (degrades to online mode).
- LPC URL resolution: `client/src/lib/data/lpc_asset_catalog.ts` (wires `assetStore.resolveUrl` via `wireLpcUrlResolver`), `lpc_asset_catalog_generated.ts` (huge generated slot catalog — check size), `lpc_renderer.ts`, `lpc_tags.ts`, `lpc_url_config.ts`.
- Tauri: `apps/frontend/client/src-tauri/tauri.conf.json` (frontendDist `../build`), capabilities `default.json` (fs: `$APPDATA/aikami-assets/**`), `custom_scheme_url_resolver.ts` fixes PixiJS `tauri://` rootPath bug.

---

## 9. Persistence (Turso/libSQL + saves)

- `game_save_service.svelte.ts` (C-321/C-334): Turso-backed save slots, **v3 envelope** `{ ecsSnapshot, serviceSnapshots, map {packId, mapId, playerX, playerY, spawnId?} }`, SHA-256 checksum validation, corruption recovery (previous valid save), auto-save. **Map-authoritative restore**: boot re-loads the map file, then overlays the player-scoped ECS snapshot.
- `serializable_service.ts` — domain-service snapshots (collected pickups, defeated enemies, interactable states).
- Local DB is the same shared connection as the asset registry.
- Cloud: campaign/persona/quest state in Firestore (campaign_service, persona_firestore, campaign_storage); experimental `FirebaseSqlConnectSync` (C-195) syncs the string registry over Firebase SQL Connect.

---

## 10. NPC AI / population

- **Spawning:** `systems/entity_spawner.ts` (846 lines) — `spawnEntities`, `spawnSpawnPointEntities`, `spawnTransitionEntities`; spawn-point entities carry appearance layers, dialogue keys, interactable config; defeated-enemy / collected-pickup suppression on map (re)load.
- **GOAP** (`math/goap/*`, `systems/goap_scheduler_system.ts`): bitmask world states, action registry (idle/eat/pub/work/rest/flee…), faction relations, crime events + witness reactions; `goap_combat_tactics_system.ts` (C-197) for enemies in combat.
- **Vision:** `spatial_vision_system.ts` + `math/vision/*` (DDA cones, shadowcasting) — writes `VisionVisible` bitmasks.
- **Zones:** `zoning_system.ts` (117 lines) + `chunk_data.ts` + `macro_simulation_system.ts` — off-screen zones simulated coarsely on 500 ms ticks (virtual grid positions), hydrated on entry. `zone_status` / `map_location` components.
- **Movement:** see §6 — NPCs have no locomotion today.

---

## 11. Portals / transitions

- Authoring: `transition` objects in Tiled (rect trigger + targetMap/targetX/Y/targetSpawnId).
- Runtime: `spawnTransitionEntities` creates Position+Transition entities; `updateZoningSystem` detects player overlap → `ZONE_TRIGGERED` bridge event → `bridge_listeners.ts` → `gameEngineService.loadMap({...})` → `GameWorld.loadMap()` (destroy old tilemap + render entries, parse new map, render, post LOAD_MAP to worker, MAP_LOADED/MAP_ENTERED events, fade overlay).
- Spawn resolution on arrival: `targetSpawnHash` (djb2 of spawnId) matched against `spawn` objects (C-172); fallback to hardcoded targetX/Y.

---

## 12. Input (⚠️ point-and-click gap)

- `systems/input_system.ts` + `keybinding_config.ts`: **keyboard-only** (WASD/arrows via keybinding map, localStorage rebindable). `INTERACT` (E) triggers `handleInteract` → nearest interactable within radius.
- **There is NO pointer/click input anywhere** — no `pointerdown`, no click-to-move, no mouse picking, no screen→world unproject (would need to invert the 4× world container + camera). The user explicitly wants point-and-click; this is greenfield.
- `interaction_target_selector.ts` + `interaction_proximity_system.ts` pick the nearest interactable (circle radius), `context_system` uses SpatialHashGrid.

---

## 13. Known red flags / review candidates (compiled during scan)

1. **JPS pathfinding fully implemented but zero callers** — no NPC walking, no click-to-move. Either wire it up or cut it.
2. **No NPC locomotion** — GOAP has no movement executor; NPCs are statues. "NPC walk around" doesn't exist yet.
3. **`movementCost`/slow tiles declared but unused** — schema + manifest + PackConfig carry it; no system consumes it.
4. **`isWall` declared but unused**.
5. **Three overlapping spatial structures** (boolean grid + dense spatial grid with wall entities + SpatialHashGrid). Wall-as-entity for every solid tile is heavy (entity budget: `MAX_ENTITIES`).
6. **Dead boot path** (`bootWithCanvas`) vs staged `GameBootService` — duplication, drift risk.
7. **1.6 MB single-line `asset_hashes.json`** fetched at boot — parse cost on the main thread.
8. **Boot is highly serialized** — 7 stages, each awaited; asset seeding + preload + engine creation could overlap. 30 s stage timeouts.
9. `hardcoded contentPackId: 'emberwatch'` in the canvas ViewModel boot call.
10. WebGL tilemap fallback = static (no animated tiles); WGSL path only on WebGPU.
11. Tilemap has **no per-layer z-bands** (ground/decor/overhead tiles are one container); entities sort by y only — fine for top-down, but check y-sorting correctness for tall props vs. entities (props have no `Position`? verify — props render via prop frame resolver path, are they entities with y-based z?).
12. **Two render sync paths** — `render_system.ts` (main thread, per-entity sprite swap) AND `render_worker.ts` (worker-side batching + LpcBatchManager). Verify they're not duplicating work / fighting each other.
13. `Texture.from` global cache still used for tilesets/atlas frames vs the deterministic prop resolver — mixed patterns.
14. `party_follow_service` — how do followers move? (client-side follow, verify it doesn't fight collision).
15. `game_state_sync.svelte.ts` in `packages/frontend/services` — another state-sync layer; check overlap with bridge listeners.
16. E2E determinism (`?e2e=true`, frozen ticker, `__AIKAMI_ENGINE_STATE__`) — good, but only one frame.
17. Boot/asset-stage failure is non-fatal by design — verify degraded mode actually works offline (OPFS/Tauri FS rehydration).

---

## 14. Questions for Claude to answer

1. Is the **bitECS-in-worker + main-thread PixiJS** split (SoA buffer copy per frame) the right call vs. keeping the sim on the main thread, or moving rendering into the worker? What's the actual per-frame sync cost?
2. Is **JPS** the right pathfinder for a top-down 2D JRPG with 32px grid + click-to-move + NPC wandering + party follow? Should it be A*/flow fields/hierarchical? How should NPC locomotion be driven (GOAP → waypoints → path)?
3. How should **walkability/cost** be modeled? (tiles manifest `isWalkable`/`movementCost`, props, doors, dynamic obstacles) — and where should the grid live so pathfinding + collision + click-picking share one source of truth?
4. Is **wall-as-entity** for every solid tile sane, or should the spatial grid store terrain directly?
5. **Click-to-move UX**: where to unproject screen→world (camera + 4× scale), and how to route clicks (move vs interact vs portal)?
6. **Content-pack authoring**: is Tiled JSON + custom properties + generated `asset_hashes.json` the right authoring pipeline? Consider LDTK, tilemap binary formats, or a custom editor; consider delta/compression of the hash sidecar.
7. **Boot/asset pipeline**: is the registry(metadata) + content-hash cache + Firebase Storage fallback architecture right, or over-engineered? Is Turso/libSQL the right local DB vs IndexedDB/OPFS-direct?
8. Is the **7-stage serialized boot** optimal? What can parallelize, what should move to a service worker / streaming?
9. **Depth sorting**: is `zIndex = y` with stable sort + bands enough for tall props, walls, bridges, and the upcoming map polish? Should the tilemap split into ground/decor/overhead containers?
10. Which parts are **dead weight** to delete (two boot paths, unused isWall/movementCost, unused JPS, duplicated spatial grids, legacy boolean grid, `depth_sort.ts` if unused)?

---

## 15. Full file map (paths, relative to repo root)

```
# ── Entry points the user named ──
apps/frontend/client/src/lib/views/game/game_view.svelte
apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts
packages/frontend/engine/src/index.ts

# ── Views (game) ──
apps/frontend/client/src/lib/views/game/game_view_model.svelte.ts
apps/frontend/client/src/lib/views/game/canvas/game_canvas_view.svelte
apps/frontend/client/src/lib/views/game/canvas/game_canvas_view_model.svelte.ts
apps/frontend/client/src/lib/views/game/boot/game_boot_view.svelte
apps/frontend/client/src/lib/views/game/boot/game_boot_view_model.svelte.ts
apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte (+ hud/, overlays/)

# ── Client game services ──
apps/frontend/client/src/lib/services/game/*.svelte.ts   (30+ services, see §2)

# ── Engine ──
packages/frontend/engine/src/game_world.ts
packages/frontend/engine/src/engine_bridge.ts
packages/frontend/engine/src/pixi_app.ts
packages/frontend/engine/src/base_engine_class.ts
packages/frontend/engine/src/worker/ecs_worker.ts
packages/frontend/engine/src/worker/ecs_worker_bootstrap.ts
packages/frontend/engine/src/systems/*.ts                (see §3–§6)
packages/frontend/engine/src/rendering/*.ts              (see §5)
packages/frontend/engine/src/assets/*.ts                 (map/jton/content-pack/manifest/LPC catalog)
packages/frontend/engine/src/math/*.ts                   (jps/, goap/, vision/, spatial_hash_grid, bresenham)
packages/frontend/engine/src/components/*.ts             (40+ ECS components)
packages/frontend/engine/src/entities/*.ts
packages/frontend/engine/src/serialization/ecs_serializer.ts
packages/frontend/engine/src/services/*.ts
packages/frontend/engine/src/sync/firebase_sql_connect_sync.ts
packages/frontend/engine/src/persistence/turso_registry_hydration.ts
packages/frontend/engine/src/config/memory_config.ts
packages/frontend/engine/src/types.ts
packages/frontend/engine/src/state/game_mode.ts
packages/frontend/engine/src/environment/*.ts

# ── Client data / assets ──
apps/frontend/client/src/lib/data/lpc_asset_catalog.ts
apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts   (generated, big)
apps/frontend/client/src/lib/data/lpc_renderer.ts
apps/frontend/client/src/lib/data/lpc_tags.ts / lpc_url_config.ts / lpc_models.ts
apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts
apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts
apps/frontend/client/src/lib/services/assets/asset_hasher.ts
apps/frontend/client/src/lib/services/assets/cache_backend.ts
apps/frontend/client/src/lib/services/assets/opfs_cache_backend.ts
apps/frontend/client/src/lib/services/assets/tauri_fs_cache_backend.ts
apps/frontend/client/src/lib/services/assets/blob_url_loader.ts
apps/frontend/client/src/lib/services/game/prop_frame_resolver.ts
apps/frontend/client/src/lib/services/game/pixi_texture_injector.ts

# ── Storage package (Turso / OPFS / WASM) ──
packages/frontend/storage/src/index.ts
packages/frontend/storage/src/lib/assets.ts               (AssetRegistryRepository)
packages/frontend/storage/src/lib/local_database_factory.ts
packages/frontend/storage/src/lib/storage_adapter.ts
packages/frontend/storage/src/lib/turso_storage_adapter.ts
packages/frontend/storage/src/lib/wasm_storage_adapter.ts
packages/frontend/storage/src/lib/opfs_asset_cache.ts

# ── Content packs / game data ──
apps/frontend/client/static/content-packs/index.json
apps/frontend/client/static/content-packs/emberwatch/manifest.json
apps/frontend/client/static/content-packs/emberwatch/maps/{village,inn,merchant_shop}.json
apps/frontend/client/static/content-packs/whispering-caves/...
apps/frontend/client/static/game-data/manifest.json
apps/frontend/client/static/game-data/asset_hashes.json      (1.6 MB single line!)
apps/frontend/client/static/game-data/sprites/tilesets/atlas.{webp,json}
apps/frontend/client/static/game-data/lpc/**                 (12k+ webp)

# ── Upload scripts ──
scripts/src/lib/ops/upload_assets.ts
scripts/src/lib/ops/upload_lpc_assets.ts
scripts/src/lib/ops/download_lpc_assets.ts

# ── Tauri ──
apps/frontend/client/src-tauri/tauri.conf.json
apps/frontend/client/src-tauri/capabilities/default.json
packages/frontend/engine/src/assets/custom_scheme_url_resolver.ts

# ── Shared types/schemas ──
packages/shared/schemas/src/lib/game/content_pack.ts         (ContentPackManifestSchema — incl. movementCost)
packages/shared/types/...                                     (PackConfig, AssetManifest, AssetHashesFile…)
packages/shared/constants/...                                 (ASSET_CATEGORIES, DEFAULT_LPC_RECIPE…)

# ── Docs / context ──
.context/CONTEXT.md
.context/index.md
docs/architecture/, docs/decisions/, docs/contracts/ (C-135, C-171–C-173, C-190–C-195, C-243, C-314, C-315, C-321, C-326, C-331–C-334, C-370–C-376 …)
docs/guides/, docs/gotchas/, docs/TODO.md
```

---

## 16. What Claude should verify / hunt for (things this scan may have missed)

- The **full worker tick** (lines ~950–1060+ of `ecs_worker.ts`) — read the whole thing, check system order, double-ticking, and the LOAD_MAP / LOAD_GAME / restore paths.
- `render_worker.ts` vs `render_system.ts` — exact division of labor and the per-frame buffer sync cost.
- `systems/entity_spawner.ts` — how props are spawned as entities (do they have Position? y-sorting?), how defeated-enemy/collected-pickup suppression works, and the `InteractableState` flow.
- `systems/interaction_system.ts` full file (doors/chests/levers/pressure plates/puzzles).
- `systems/turn_manager_system.ts` + `combat_stage_system.ts` — combat mode gating and the sidebar.
- `game_save_service.svelte.ts` + `serializable_service.ts` — full save/restore correctness (v2 vs v3).
- `packages/frontend/services/src/lib/services/game_state_sync.svelte.ts` — what it syncs and whether it's redundant.
- `party_follow_service.svelte.ts` — follower movement mechanics.
- `session_service` / `time_service` / `gameplay_settings.ts` — pacing/time-of-day.
- The **audio** layer (`services/audio/`) — assets + streaming orchestrator integration.
- The **campaign** layer (`services/campaign/`) — state machine, storage, default Emberwatch campaign creation (relevant for the "starter default emberwatch" polish).
- `assets/jton_parser.ts` in full — the JTON format vs Tiled JSON; whether the dual format is worth keeping.
- Check `static/game-data/manifest.json` structure (204k entries — what's in it, what tags map to).
- Tauri `src-tauri/src/*` (main.rs, console log plugin) and the `http:allow-fetch` capability (localhost:11434 Ollama, 8188 ComfyUI — the AI microservices).
- Search for **TODO/FIXME/HACK** markers in engine + game services.
- `docs/decisions/` — ADRs that explain *why* choices were made (important before proposing reversals).
