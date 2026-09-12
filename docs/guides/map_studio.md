# Map Studio (Hub)

Preview a map manifest in the browser using **the same scene loader the game
uses**. Paste JSON, upload a file, or open a published catalog map — the
preview renders real catalog textures.

- **Route:** `/map-studio` (public — no sign-in, no account)
- **View model:** `apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts`
- **View:** `apps/frontend/hub/src/lib/views/map_studio/map_studio_view.svelte`

## What it accepts

| Format | Notes |
|---|---|
| Tiled JSON (`.json`) | Normalized through the engine's map loader, then the Tiled adapter |
| JTON (`.jton`) | Compact text map format |
| Native `aikami.scene` | Parsed directly (the canonical authoring document) |

Anything the studio accepts is something the game accepts — the studio is a
thin shell over `loadSceneSync` → `sceneFromTilemap` / `sceneFromNative`, the
same entry points the client uses. It is not a second renderer.

## Using it

1. **Sample map** — the studio boots with an embedded 12×9 sample manifest
   (`sample_manifest.ts`). It needs no network, so the page is never blank.
2. **Paste / upload** — drop manifest text into the editor; the preview
   re-renders on every keystroke through the same ViewModel instance (no
   teardown, no remount).
3. **Format JSON** — pretty-prints the current text (no-op when invalid, so
   the preview error stays visible).
4. **Published map…** — loads a map straight out of the catalog. This is the
   fastest way to check that a published map still loads.

## Asset resolution

The preview draws real textures, resolved by a stateless CDN resolver built
from the catalog entries the server load already fetched
(`apps/frontend/hub/src/lib/client/services/cdn_asset_resolver.ts`).

Manifests reference tileset images by **game-data path**
(`/game-data/sprites/tilesets/atlas.webp`), while catalog entries are keyed by
**tag** (`sprites:tilesets:atlas`). The studio enables
`resolveGameDataPaths: true`, which normalizes the path (strips the leading
slash and the optional `game-data/` prefix) and matches it against each
entry's `tagToAssetPath` derivation. Tag lookups keep priority, and every
other caller keeps the default (`false`) so behavior elsewhere is unchanged.

When a frame cannot be resolved, the preview falls back to a diagnostic fill
rather than silently drawing nothing.

## Why the studio normalizes raw Tiled JSON

`normalizeTilemap()` (exported from the engine's `map_loader.ts`) is applied
before the Tiled adapter runs. It:

- splits `objectgroup` layers (`spawns`, `transitions`) out of `layers` into
  `objectLayers` — without this, the adapter rejects the map with
  `layer "spawns" has no band and its name does not identify ground, decor, or overhead`;
- masks Tiled flip bits (H/V/D) out of every GID;
- reads the `band` custom property and validates layer dimensions.

Casting raw parsed JSON straight to `TilemapData` skips all of that, which is
what both `loadScene`'s raw-JSON branch and the preview's in-memory path used
to do. Both now go through `normalizeTilemap`. Regression tests:
`packages/frontend/engine/src/assets/scene/scene_loader.test.ts`.

## Phase 2 — visual editing (C-507)

Press **Edit scene** to edit the loaded manifest. The studio builds a pure
engine editor document (`packages/frontend/engine/src/assets/scene/scene_editor.ts`)
from the manifest and exposes a tool palette:

| Tool | Action |
|---|---|
| Select | Click a placement/transition to select it by stable id; click an empty cell to move the selected placement there. |
| Paint ground | Paint the selected ground frame (terrain id for terrain-channel maps). |
| Erase | Clear the cell (reserved empty index / default terrain). |
| Block / Unblock | Toggle an explicit collision override; the overlay turns on automatically. |
| Place | Stamp a placement at the cell with the chosen component + frame. |
| Transition | Add a transition zone targeting the entered map id. |
| Delete | Remove the placement or transition under the cell. |

**Undo/redo** cover every edit (snapshot history, 50 entries). **Export
.scene.json** writes the edited document as native `aikami.scene` through the
C-505 serializer, re-validated before download, so it re-imports anywhere the
game accepts scenes.

The preview is not a second renderer: baked and terrain-surface edits are handed
to the same Phase 1 preview as an in-memory frames tilemap, so real catalog
textures survive while the textarea shows the canonical native document.
Terrain surfaces compile through the engine's corner16 autotiler using the pack
terrain definitions the page loads, and the packed atlas frame map resolves the
real source rects (see [Terrain preview](#terrain-preview-c-508) below).

## Phase 3 — drafts and community publishing (C-508)

The studio saves work and shares it through the hub. The curated catalog stays
CI-owned and read-only, so published maps live in a hub-served **community
namespace**.

| Control | Action |
|---|---|
| Draft name + Save draft | Creates a private, owner-scoped draft (or updates the selected one) in D1. |
| My drafts… + Load / Delete | Reopens a saved draft into the editor, or removes it. |
| Publish title + Publish community map | Validates the document, uploads it to the catalog bucket at `community/{slug}/{revision}.json`, and lists it publicly. |

Published community maps appear in the **Published map…** picker alongside
curated maps; selecting one loads its document back into the editor.

**Gates.** Every save/publish runs the canonical `SceneDocumentSchema` plus
cross-field checks (grid length vs extent, unique placement/layer/transition
ids, bounded navigation indices). Publishing additionally runs the C-381
`validatePack` gate when the page can synthesize a source-pack manifest
(terrain definitions), and never writes a row if the upload fails.

**Auth.** Drafts and publishing require a signed-in Better Auth session; the
public route still boots and previews/export without one. A signed-out visitor
simply sees no drafts.

## Terrain preview (C-508)

C-507's deferred gap is closed. The `/map-studio` page load fetches the pack
manifest (best-effort) and returns its `terrains` plus an atlas descriptor
(`textureUrl` / `spritesheetUrl`). The ViewModel threads `terrains` and the
base terrain into the editor and preview, and loads the packed frame map so
corner16 frames (`earth_3.png`, …) sample their real atlas rects rather than
the old numeric-suffix grid heuristic. If the pack context is unavailable the
preview degrades to the grid fallback instead of failing.

## Errors are the point

The studio shows the loader's real error text verbatim instead of a generic
failure. That is how it surfaced that a manifest whose tileset omits
`tileheight` cannot be loaded, and that objectgroup layers used to break the
adapter. If the studio shows an error, the game would hit it too.

## Tests

| File | Guards |
|---|---|
| `apps/frontend/hub/src/lib/client/services/__tests__/cdn_asset_resolver.test.ts` | Path lookup on/off, tag priority, prefix handling |
| `apps/frontend/hub/src/lib/views/map_studio/__tests__/sample_manifest.test.ts` | The sample manifest carries every field the loader requires |
| `apps/frontend/hub/src/lib/views/map_studio/__tests__/map_editor_utils.test.ts` | Canvas→cell mapping, palettes, placement/transition hit-testing, atlas-frame parsing |
| `packages/frontend/engine/src/assets/scene/scene_editor.test.ts` | Editor ops, undo/redo, native round-trip, preview tilemap bridge |
| `packages/frontend/preview/src/lib/map/__tests__/map_preview_scene.test.ts` | Terrain + atlas scene compilation |
| `packages/frontend/preview/src/lib/map/__tests__/map_preview_atlas.test.ts` | Explicit atlas frame resolution |
| `packages/shared/schemas/src/lib/game/community_map.test.ts` | Community document gate |
| `apps/frontend/hub/src/lib/server/api/tests/map_studio.test.ts` | Drafts CRUD + ownership, publish gate, revision bump |
| `apps/frontend/hub/src/lib/client/services/__tests__/map_studio_client.test.ts` | Client URL/error mapping |
| `apps/e2e/tests/hub/map_studio.spec.ts` | Edit-mode/paint/undo/export UI journeys, terrain paste, D1-gated drafts/publish API |
| `apps/frontend/hub/src/lib/constants/routes.test.ts` | `/map-studio` is public and resolves under `(public)` |
| `packages/frontend/engine/src/assets/scene/scene_loader.test.ts` | Raw Tiled JSON with objectgroup layers loads |
