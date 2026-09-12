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

## Current scope (Phase 1 — preview-first MVP)

**In:** manifest input (paste / upload / sample / published), live preview,
honest error surfacing, catalog asset resolution.

**Not yet:** editing the map visually, saving or publishing a manifest,
per-user drafts. Those are later phases — the preview contract is deliberately
stable first.

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
| `apps/frontend/hub/src/lib/constants/routes.test.ts` | `/map-studio` is public and resolves under `(public)` |
| `packages/frontend/engine/src/assets/scene/scene_loader.test.ts` | Raw Tiled JSON with objectgroup layers loads |
