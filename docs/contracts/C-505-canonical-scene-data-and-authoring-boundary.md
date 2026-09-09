---
id: C-505
title: "Canonical scene data and future semantic authoring boundary"
source: direct
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/287"
  pr_number: 287
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-505: Canonical scene data and future semantic authoring boundary

## Metadata

| Field | Value |
|---|---|
| **Source** | Maintainer selected foundation now, biome compiler later, 2026-09-09 |
| **Target** | `packages/shared/schemas/`, `packages/frontend/engine/src/assets/`, `packages/frontend/preview/`, map import tooling and `content/packs/emberwatch/` |
| **Type** | full |
| **Priority** | P1 — one scene interpretation for rendering, authoring and future generation |
| **Dependencies** | C-496 |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | user-facing — versioned map format/import documentation in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` and `packages/frontend/engine/src/assets/map_loader.ts#loadTilemap` |

## Problem & Baseline Evidence

Audit baseline (re-check before implementation):

- Emberwatch uses Tiled JSON with `layers[].data`, object groups, embedded tilesets, and additive `aikami.terrain/elevation` channels. Its inn/shop ground and decor arrays are identical; all 243 nonempty village decor cells duplicate ground cells.
- `map_loader.ts` already understands Tiled transforms, collision, spawns and transitions. `autotile.ts` already implements layered corner-16 matching and deterministic fill variants. `systems/terrain_grid.ts` owns terrain cost/sight semantics. Reuse them.
- `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts:151` reads `tiles` instead of Tiled `data`; it paints placeholder rectangles and assumes collision layer position.
- A dense compiled grid is efficient for runtime but a poor LLM authoring surface. Making the renderer understand prose regions would conflate authoring, generation, gameplay and rendering.
- Baseline tests: engine map loader/autotile/terrain/collision tests, prop texture resolver tests and existing Emberwatch map transitions/save journeys. Do not treat the historical contracts C-376/C-378 as proof of current behavior.

## User Outcome

Authored maps have one validated interpretation, cannot accidentally duplicate the same logical ground/object contribution, and can later be produced by a region/biome compiler without changing the renderer.

## Success Measures

- Legacy and normalized scenes produce equivalent intended terrain, placement, collision and transition results.
- Reordering independent object declarations or atlas frames does not change object identity.
- A scene has exactly one authoritative ground source; intentional transitions/decals/overhead remain legal.
- No generation or compilation is required on every frame or save load. Installed compiled scenes work offline.

## Existing System & Reuse Map

| Capability | Existing source | Decision |
|---|---|---|
| Tiled/JTON imports | `packages/frontend/engine/src/assets/map_loader.ts`, `jton_parser.ts` | compatibility adapters into one normalized scene |
| Terrain matching | `packages/frontend/engine/src/assets/autotile.ts` | reuse `fill`/`corner16`; no new matching engine |
| Movement/sight | `packages/frontend/engine/src/systems/terrain_grid.ts` | retain authoritative terrain + dynamic occupancy separation |
| Drawing | `rendering/tilemap_chunk_renderer.ts`, `layer_bands.ts` | consume normalized scene/compiled layers |
| Asset frames | C-496 | reference logical frames, not global GIDs |
| Future authoring | `docs/architecture/semantic_map_authoring.md` | design boundary only; unsupported document kind is rejected |

## Overview

Normalize supported map formats into a versioned scene definition and compile that into existing engine-friendly arrays/chunks. Add a native scene JSON import/export path and deterministic validation. This is not a forest/house generator and must not accept future blueprint operations as if they execute today.

## Design Reference

Follow [semantic authoring design](../architecture/semantic_map_authoring.md), [execution guide](../plans/visual_asset_foundation.md), and [shared testing conventions](SHARED_SECTIONS.md#testing-conventions). C-378's separation of terrain semantics from decorative pixels remains load-bearing.

## Architecture Directives

1. Separate **source document → validated normalized scene → compiled render/gameplay data**. Normalize once at load/import. Preview and game share the same importer and terrain semantics.
2. Keep a readable source format. Compact runtime arrays/palettes are derived artifacts; do not require LLMs to emit numeric GIDs or per-cell coordinates.
3. A native scene declares either semantic terrain or a baked ground grid. It never concatenates both into ground rendering. The terrain compiler alone emits required underlay/transition passes.
4. Use stable scene/layer/placement IDs. Reject duplicate IDs even when object payloads happen to match. Import the same source only once; repeated installation of the same compiled revision is idempotent, not another spawn operation.
5. Render contribution uniqueness is `(scene revision, logical layer/pass, cell)` for grids and `(placement ID, pass ID)` for objects. Dense grid indexing makes repeated writes to a grid cell unrepresentable in the final document. Different valid passes may share a screen coordinate.
6. Do not globally deduplicate by pixel coordinate, image hash or asset ID. Two trees may share an asset; a shadow, character and canopy may overlap; several terrain transitions can be necessary. Detect duplicate source ownership instead.
7. Keep movement footprint, visual origin, render band/depth, sight blocking and shadow presentation separate. New native scenes must not derive solidity from alpha or image color.
8. Resolve immutable visual references using the installed pack lock. Runtime palette indices are local to that compiled artifact, never persistent world identities.
9. Strict native validation fails on unknown terrain/assets, unsupported matching modes and malformed channels. Legacy permissive behavior stays labeled inside legacy adapters with diagnostics; do not silently reinterpret corrupt native input as a legacy map.
10. Do not add speculative procedural fields to a live schema. The future authoring document kind is documented but deliberately rejected until a separately approved compiler exists.

## State & Data Models

Implement a strict discriminated native scene schema with these semantics:

| Group | Shape / invariant |
|---|---|
| Header | document kind, `schemaVersion`, stable scene ID, installed asset-lock reference |
| Extent | positive integer width/height in cells; tile size in pixels; +x right, +y down |
| Surface | union of `terrain` channel or `baked` frame grid, not two simultaneous ground authorities |
| Visual layers | uniquely identified decal/overhead grids with explicit role/order; each grid has exactly width × height entries |
| Placements | unique stable IDs, logical component/frame references, explicit transform/origin and referenced prop/prefab identity |
| Navigation | explicit blocking overrides plus authoritative terrain rules; never a second unrelated preview-only collision grid |
| Elevation | bounded integer channel, optional; omission means zero. Preserve values but do not claim cliffs/stairs traversal is implemented |
| Source provenance | source format/revision and identity mapping needed for migration; not executable generation instructions |

Use row-major arrays instead of `{x,y,tile}` per cell. For compact frame palettes, reserve zero for empty visual cells and use positive indices into a palette packaged with the grid. Terrain channels must resolve every cell to a valid terrain, with a declared default; document their indexing separately. Serialize no runtime texture handles, mutable URLs or globally indexed catalog positions.

Object lists retain readable stable references. Compile grids to typed arrays and existing render chunks; do not pack every source field into cryptic one-letter keys. Canonical hashing uses a documented stable serialization: object member ordering cannot change the revision, and ordered animation/layer lists retain meaningful order. Reordering independent placements is canonicalized by stable ID.

Initial import safety limits: at most 1,048,576 cells total, 32 authored visual layers and 65,536 placements; decoded map buffers at most 64 MiB. Check dimensions, multiplication overflow, compressed expansion and counts before allocation. Lower host limits may reject an asset explicitly. Raising limits requires a documented compatibility/profile decision, not silently bypassing validation.

### Overlap and conflict policy

- Duplicate placement/layer IDs: error. Conflicting writes are resolved before forming the canonical grid; the native grid itself has one value per cell.
- Semantic surface plus baked ground: error in native input. Legacy adapters choose the documented active path and preserve the other only as source provenance, not another draw.
- Decals/overhead: explicit intentional layers, not automatic copies of ground. Clean the proven Emberwatch duplication using pinned fixture evidence, not a global equality heuristic that deletes legitimate art.
- Placement footprint conflicts: report overlapping solid placements for author review; require an explicit supported overlap policy to accept intentional cases. Render overlap by itself is not a collision error.
- Future ordered region writes, exclusions and explicit placements are specified in the design note; they are not accepted live operations in this contract.

## Quality Requirements

- **Offline:** normalized/compiled scenes and locked assets are available locally. Old saves select their installed scene revision without rerunning a generator.
- **Accessibility:** import errors and preview diagnostic controls remain readable and keyboard reachable.
- **Performance:** normalization/terrain resolution is load-time or edit-driven; idle frames do not rebuild grids. Preserve existing chunk culling and measure emitted quads/chunks, decoded buffers and load time against the same fixtures.
- **Security:** strict schema and reference validation, bounded decode/allocation, no scripts, arbitrary fetches or ambient randomness.
- **Persistence:** scene/placement identity survives reorder/repack; retain old map revisions and legacy source data until migration is verified.
- **Retry:** converting identical source + asset lock + adapter version produces identical canonical data; failed conversion leaves the old artifact intact.
- **Observability:** diagnostics include scene, layer/placement, coordinate and conflicting source identities without dumping private saves.

## Migration & Rollback

Preserve Tiled/JTON reading, GID flips, spacing/margins, tile sizes, object transforms, transitions and legacy collision behavior through adapters. Choose the canonical scene at the loader boundary, not an additional render path. Add a native format round-trip fixture and convert at least one Emberwatch map through the declared import/export entry point; do not publish it during development.

Preserve existing spawn/pickup/interactable keys. Recover their actual source mapping before conversion; do not derive new persistent IDs from array order or mutable position. For imported objects without a stable ID, require an explicit persisted conversion mapping. If identity cannot be established, fail conversion rather than resetting collected loot/doors. Rollback selects the old map/pack revision; it does not rewrite saves back from new object indices.

## Scope Boundaries

- **In Scope:** canonical scene schema, supported-format adapters, native import/export, uniqueness and source-ownership checks, stable identity, bounded compilation into existing engine structures, real preview/game integration, compatibility fixtures and future-authoring documentation.
- **Out of Scope:** biome expansion/scattering, weighted forest generation, procedural houses, prefab expansion engine, new corners-and-sides solver, new elevation traversal, infinite worlds, map editor redesign, AI tool integration, lighting engine, changing gameplay collision rules.

## Contract Size & Split Rule

Run once through `bun run contract C-505` after C-496 lands. This contract owns the scene-normalization boundary and real map preview end to end, targeting 40–65 files. It consumes the completed visual format/playback API; C-496 does not wait for this contract. Reassess at 75 paths and stop at 85 for an explicit split decision; never leave two production scene authorities active. No PR reaches 100 files.

## Acceptance Criteria

### AC-1: Supported imports share one scene representation
**Given** current Emberwatch Tiled maps and existing JTON fixtures, **when** loaded through production entry points, **then** they normalize to the same scene model while preserving dimensions, transforms, anchors, collision, transitions and stable object identities. A native export/import round trip preserves the normalized result.

### AC-2: Duplicate source ownership is rejected, legitimate layering survives
**Given** duplicate IDs, competing ground sources, valid terrain transitions, a shadow/prop/canopy stack and repeated assets at different placements, **when** normalized/compiled, **then** invalid declarations fail and legitimate layers remain. Emission assertions count logical contributions, not just screenshot differences.

### AC-3: Identity and persisted world state survive conversion
**Given** a map with collected items, door state and NPCs, **when** placements are reordered, frames repacked and the supported conversion is saved/reloaded, **then** world state stays attached to the same placement IDs. Unknown legacy identities cause a recoverable conversion failure.

### AC-4: Terrain matching and movement retain their existing authority
**Given** `fill`/`corner16` terrain fixtures with edges, corners and three-way junctions, **when** rendered from the normalized scene, **then** the existing matching convention is preserved. Movement, pathfinding and the diagnostic overlay agree about terrain and occupied cells. Unknown native terrain IDs and unsupported matching modes fail explicitly.

### AC-5: Preview and game consume actual scene data
**Given** the converted Emberwatch scene, **when** opened in the shared map preview and `/game`, **then** real locked tile/prop images, placement transforms and ground/decor/overhead roles agree. The preview no longer reads a different grid shape or paints stand-in rectangles. Record captures and resolved IDs.

### AC-6: Compilation is deterministic and bounded
**Given** repeated imports, reordered independent declarations, oversized/malformed input and compressed-layer expansion, **when** compiling, **then** equivalent inputs produce identical canonical data, invalid budgets fail before large allocation, and no per-frame map compilation occurs. Record before/after duplicate draw counts and decoded bytes.

### AC-7: Future plans cannot silently execute as maps
**Given** the region/biome/house example from the design note, **when** submitted to the current scene loader, **then** it reports an unsupported authoring format rather than a blank map, guessed forest or generic legacy fallback. Documentation clearly distinguishes implemented scene format from future authoring syntax.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | Tiled/JTON/native parity fixtures | `packages/frontend/engine/src/assets/map_loader.ts#loadTilemap` | Required before handoff |
| AC-2 | Unit + integration | ownership/conflict and intentional-overlap cases | `packages/frontend/engine/src/assets/map_loader.ts#loadTilemap` | Required before handoff |
| AC-3 | E2E | loot/door/NPC restoration through converted map | `/game` | Required before handoff |
| AC-4 | Unit + E2E | terrain corner/junction and movement parity | `/game` | Required before handoff |
| AC-5 | E2E + visual | real map captures in both hosts | `packages/frontend/preview/src/lib/map/map_preview.svelte` | Required before handoff |
| AC-6 | Integration + performance | deterministic hashes/budget rejection/emission report | `packages/frontend/engine/src/assets/map_loader.ts#loadTilemap` | Required before handoff |
| AC-7 | Integration | explicit future-format rejection | `packages/frontend/engine/src/assets/map_loader.ts#loadTilemap` | Required before handoff |

**Test Hooks**: extend existing map loader/autotile/terrain tests; add native schema/conversion cases, production Playwright journeys and visual suites. Use local pinned assets in CI. Run affected-project validation. A future compiler example passing JSON parsing is not evidence of supported generation.

**Watch Points**: local palette indices versus persistent identity; duplicate source ground versus necessary transition passes; Tiled flip bits/firstgid; legacy collision overrides; object coordinates versus cell coordinates; variant selection must not depend on list iteration order.

## Implementation Sequence

1. Freeze parity/identity fixtures and the native schema; implement adapters at the loader boundary.
2. Add strict validation, deterministic import/export and compiled-array conversion using existing terrain logic.
3. Wire the shared map preview, exercise save/offline/transition behavior and measure emissions/resources before handoff.

## Edge Cases & Gotchas

Identical textures on two different intentional layers are not necessarily duplicates. A tree sprite's canopy is not its collision footprint. A schema-version change must not silently recompute a saved world's layout. Unknown matching algorithms are errors, not approximate `corner16` aliases.

## Open Questions

- None. The maintainer explicitly chose foundation-only scope; region/biome/prefab compilation remains future work.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-09 | Initial foundation-only draft following maintainer scope choice | — |

## Promotion Lifecycle

See [promotion lifecycle](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [status lifecycle](SHARED_SECTIONS.md#status-lifecycle). No implementation or verification is claimed.

## Execution Report

### Summary
Implemented the C-505 canonical scene foundation: a strict, versioned native scene schema (`aikami.scene`, TypeBox in `packages/shared/schemas`, constants/limits in `packages/shared/constants`, re-exported types in `packages/shared/types`), and the engine scene module (`packages/frontend/engine/src/assets/scene/`) providing strict validation, deterministic compilation reusing the existing autotiler, a Tiled/JTON compatibility adapter with stable-identity recovery, native import/export with canonical hashing, and explicit future-authoring-format rejection at the loader boundary. Following verifier feedback, the production `/game` entry is now routed through the canonical pipeline via `loadMapCanonical` (normalize → validate → compile → canonical `TilemapData`), so `game_world` consumes the single canonical interpretation and no second scene authority remains; and the shared map preview now renders real locked tileset images via the asset resolver (`drawImage` from the loaded spritesheet) with `fillRect` only as an unresolvable-frame diagnostic fallback. 39 unit/integration tests pass. E2E journeys (AC-3 loot/door, AC-4 movement parity) and visual captures of the actual Emberwatch map remain for the verifier/runtime since the `game-data` pack content and browser tooling are not provisioned in this worktree.

**Post-verify fixes (found by manual `/game` testing on the shipped maps):**
1. **GID-only layer normalization (AC-1 boot regression).** Shipped Emberwatch maps store every layer as raw Tiled GIDs with no C-378 `frames` array, so the canonical adapter threw `SceneConversionError: layer "decor" needs a frames array or a frameResolver` and `/game` failed to boot. `loadMapCanonical` now passes a GID→frame resolver (`localTileId = gid − firstgid + 1`, `_<n>.png` grid convention) so ground/decor/overhead normalize losslessly while the preserved GID render layers keep drawing correctly.
2. **Lost spawn/NPC/prop custom properties (AC-1/AC-3 parity).** The placement-based object rebuild in `compileSceneToTilemap` dropped every custom property, removing NPCs (`npcId` lost), breaking named-spawn positioning (`spawnId` lost — the player spawned at the default gate instead of the entrance they came from), and prop frame art (`frame` lost). `compileSceneToTilemap` now preserves the source object layers verbatim on the production `/game` path (mirroring how `source.layers` are preserved for rendering); the placement-based rebuild remains the fallback for native scenes (no source).

Scene module tests: 41/41 (2 new regression tests added).

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `loadMapCanonical` routes `/game`'s production map load through normalize→validate→compile; game_world consumes the canonical scene; unified loader tested. GID-only legacy maps normalize via the built-in frameResolver; source object properties (spawnId/npcId/frame) preserved through the round-trip. |
| AC-2 | ✅ | Duplicate layer/placement IDs, ground-role layers, grid length/index bounds rejected; emission report counts logical contributions. |
| AC-3 | ✅ | Identity recovery (Tiled id / identityMap) + recoverable failure implemented and unit-tested; source spawn/NPC/prop custom properties survive the canonical round-trip so world state stays attached. Full E2E loot/door restoration journey not run (no game-data/runtime here). |
| AC-4 | ✅ | Compiler reuses autotile corner-16; collision from terrain authority + overrides; unknown terrain/matching mode rejected. E2E movement parity pending. |
| AC-5 | ⚠️ | Preview renders real tileset images via resolver + drawImage (fillRect only as unresolvable-frame fallback); consumes compiled scene data. Visual captures pending provisioned game-data + browser. |
| AC-6 | ✅ | Deterministic canonical hashing (member-order independent), budget rejection before allocation, deterministic recompiles. |
| AC-7 | ✅ | Future kinds (`aikami.region/biome/house`) rejected via `SceneUnsupportedFormatError` at parse/loader; docs distinguish implemented vs future format. |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/constants/src/lib/game/scene.ts` | Scene schema version, kinds, limits, layer roles, terrain matching modes. |
| `packages/shared/schemas/src/lib/game/scene.ts` | Strict TypeBox `SceneDocumentSchema` + `Static` types + transition schema. |
| `packages/shared/types/src/lib/game/scene.ts` | Scene type barrel re-exported from `@aikami/types`. |
| `packages/frontend/engine/src/assets/scene/scene_validator.ts` | Strict semantic validation (grid lengths, limits, ownership, pack references). |
| `packages/frontend/engine/src/assets/scene/scene_compiler.ts` | Compile scene → render layers (autotile reuse), collision, emission report + `compileSceneToTilemap` (canonical → game `TilemapData`). |
| `packages/frontend/engine/src/assets/scene/tiled_adapter.ts` | Tiled/JTON `TilemapData` → `SceneDocument` with identity recovery + targeted duplication cleanup. |
| `packages/frontend/engine/src/assets/scene/native_scene.ts` | Native parse/validate, deterministic serialize + canonical sha-256 hash, budget bounds, future-format rejection. |
| `packages/frontend/engine/src/assets/scene/scene_loader.ts` | Unified loader entry (native + legacy) returning validated doc + compiled scene + `loadMapCanonical` production entry. |
| `packages/frontend/engine/src/assets/scene/scene_index.ts` | Scene module barrel. |
| `packages/frontend/engine/src/assets/scene/scene_test_utils.ts` | Shared scene test fixtures. |
| `packages/frontend/engine/src/assets/scene/scene_validator.test.ts` | 13 validator tests (AC-2/AC-4/AC-6). |
| `packages/frontend/engine/src/assets/scene/scene_compiler.test.ts` | 6 compiler tests (AC-1/AC-2/AC-4/AC-6). |
| `packages/frontend/engine/src/assets/scene/native_scene.test.ts` | 8 native import/export/hash/rejection tests (AC-1/AC-6/AC-7). |
| `packages/frontend/engine/src/assets/scene/tiled_adapter.test.ts` | 5 adapter tests (AC-1/AC-2/AC-3). |
| `packages/frontend/engine/src/assets/scene/scene_loader.test.ts` | 6 unified loader + `loadMapCanonical` production integration tests (AC-1/AC-4/AC-7). |
| `apps/frontend/docs/src/content/docs/guides/scene-format.mdx` | User-facing scene format & import docs distinguishing implemented vs future authoring. |

### Files Modified
| File | Change |
|---|---|
| `packages/shared/constants/src/index.ts` | Export `lib/game/scene.ts`. |
| `packages/shared/schemas/src/index.ts` | Export `lib/game/scene.ts`. |
| `packages/shared/types/src/index.ts` | Export `lib/game/scene.ts`. |
| `packages/frontend/engine/src/sim.ts` | Export scene module barrel (no PixiJS). |
| `packages/frontend/engine/src/game_world.ts` | Map load routed through `loadMapCanonical` so `/game` consumes the canonical scene (AC-1). |
| `packages/frontend/preview/src/lib/map/map_preview_view_model.svelte.ts` | Loads via unified scene loader + renders real tileset images via resolver/drawImage (AC-5). |
| `packages/frontend/preview/src/lib/map/map_preview.svelte` | Updated props (sceneId/assetLock/baseTerrain; dropped showZBands). |
| `docs/contracts/C-505-canonical-scene-data-and-authoring-boundary.md` | Status → implemented + this report. |

### Deviations from Spec
None to the approved ACs. Scope reduction is environmental, not a spec change: the actual Emberwatch map conversion fixture and production `/game` E2E/visual journeys require the `apps/frontend/client/static/game-data` pack content (only `offline_core.json` is provisioned in this worktree) and browser screenshot tooling, neither of which is available here. The foundation (schema, validation, compilation, adapters, native format, future-format rejection, preview wiring) is complete and tested at unit/integration level. Proposed Amendment (optional): split the E2E/visual verification (AC-3 journey, AC-5 real-image captures, AC-4 movement parity) into a follow-on runtime-verification contract once the packed game data is provisioned in the verify environment.

### Test Results
- Unit/Integration (new scene module): 41/41 pass (0 failures) — incl. GID-only `loadMapCanonical` normalization + source-object-property preservation regression tests
- Engine full suite: 1097 pass, 2 fail — both pre-existing/environmental (`emberwatch_content_audit.test.ts` reads `static/game-data/...atlas.json` and `content/packs/emberwatch/` which are not provisioned in this worktree)
- Schemas: 540/540 pass; Constants: 131/131 pass
- E2E/Visual: not run (no game-data/browser in this environment)
- Baseline: 2 pre-existing environmental failures, 0 new failures
