---
title: Asset Management
description: Manage custom sprites, backgrounds, music, and SFX locally for your game.
---

The **Asset Management System** lets you use custom visual and audio assets in Aikami through a simple local filesystem workflow. Assets live under `static/game-assets/` and are indexed by a manifest scanner into tag-based lookups.

## How It Works

1. **Place files** in `apps/frontend/client/static/game-assets/` under the appropriate category subdirectory (`sprites/`, `backgrounds/`, `music/`, `sfx/`, `ambient/`).

2. **Run the scanner** to index your files:
   ```bash
   bun run scripts/src/lib/ops/scan_assets.ts
   ```
   This generates `manifest.json` with tag→path mappings.

3. **Browse** your assets at `/dev/asset-browser` in the dev sandbox.

Each file is indexed by a **tag** derived from its path — for example, `sprites/generic-fantasy/elf.png` becomes `sprites:generic-fantasy:elf`. The game engine resolves these tags at runtime, loading textures through PixiJS with transparent caching.

## Asset Browser

Access the asset browser from the **Dev Sandbox** at `/dev/asset-browser`. It provides:

- **Folder tree** navigation by category
- **File grid** with image and audio file previews
- **Category tabs** to filter by asset type
- **Upload instructions** modal showing the local workflow

## Background Crossfade

Scene backgrounds transition smoothly using a 500ms alpha crossfade. Call `setBackground(tag)` on the game world to load and crossfade between background images through the PixiJS render pipeline.

## Offline Asset Cache (C-373)

Once assets have been fetched, the game runs **fully offline**: every sprite, LPC layer, and audio file is served from a local content-hash-keyed cache with zero network round-trips.

How it works:

1. `scan_assets.ts` additionally emits `asset_hashes.json` — the SHA-256 + size of every file, alongside `manifest.json`.
2. On boot, the `initializing_asset_registry` stage seeds a local Turso registry (`assets`, `asset_sources`, `install_state` tables) from the manifest + sidecar. Seeding is idempotent — later boots only run a meta guard check.
3. The **AssetManager** resolves each tag through registry → cache → sources. On a miss it fetches from the bundled source, **verifies the SHA-256 against the registry hash before writing or serving**, and records the install state.
4. Binaries are stored hash-named in OPFS (Web/PWA) or the Tauri native disk cache (Desktop). Writes go to a temporary file first and are atomically renamed into place, so readers never observe a partially-written entry; reads verify the file's SHA-256 again before serving (a corrupted entry is discarded and re-fetched). Cached assets resolve to `blob:` object URLs — PixiJS loads them transparently via a registered blob-URL loader.
5. When a new game build bumps an asset's hash, the old binary is **automatically evicted** and re-fetched on the next request; interrupted downloads are reconciled at boot.

Missing or optional assets degrade gracefully to the existing fallbacks with a logged warning — never a crash.

## Firebase Storage sources & the online registry seed

Assets are mirrored to Firebase Storage so the AssetManager can fall back to an
online origin (C-373 `asset_sources`). The bucket layout mirrors the bundled
`static/game-data` tree:

```text
gs://<project>.firebasestorage.app/
  lpc/…                # LPC spritesheets (upload_lpc_assets.ts)
  music/… sfx/… ambient/…   # audio assets
  sprites/… backgrounds/…   # image assets (tilesets, portraits, backgrounds)
  game-data/manifest.json    # online registry seed — the available-asset catalog
  game-data/asset_hashes.json
```

How it works:

1. `upload_assets.ts` uploads `static/game-data/{music,sfx,ambient,sprites,backgrounds}`
   plus the registry seed (`manifest.json`, `asset_hashes.json`) to the bucket.
   `upload_lpc_assets.ts` does the same for LPC (separate script — 12k+ files).
2. At boot, `AssetRegistryRepository.addFirebaseStorageSources(bucket)` adds a
   `firebase-storage` source row (priority 1) for every seeded asset — the
   download URL `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media`.
   The bundled source (priority 0) is tried first; the bucket mirror is the
   fallback when the bundled path is unavailable.
3. Storage rules allow **public read** for `music/**`, `sfx/**`, `ambient/**`,
   `sprites/**`, `backgrounds/**`, `lpc/**` and `game-data/**` (admin-only
   write), matching the anonymous browser fetches the AssetManager issues.
4. The online `game-data/manifest.json` is the discoverable catalog — the app
   reads the `music` / `sfx` categories from the manifest, so adding a track to
   `static/game-data/music/…`, re-running `scan_assets.ts`, bundling and
   uploading makes it playable with no hardcoded references
   (`audio_asset_resolver.ts` matches tracks by manifest tag, not name).

## Source

- Engine scanner: `packages/frontend/engine/src/assets/asset_manifest.ts`
- CLI scanner: `scripts/src/lib/ops/scan_assets.ts`
- Registry: `packages/frontend/repositories/src/lib/assets.ts`
- Cache + manager: `apps/frontend/client/src/lib/services/assets/`
- UI: `apps/frontend/client/src/lib/views/asset-browser/`
- Store: `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`
