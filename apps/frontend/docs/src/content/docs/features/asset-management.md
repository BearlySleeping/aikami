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
4. Binaries are stored hash-named in OPFS (Web/PWA) or the Tauri native disk cache (Desktop). Cached assets resolve to `blob:` object URLs — PixiJS loads them transparently via a registered blob-URL loader.
5. When a new game build bumps an asset's hash, the old binary is **automatically evicted** and re-fetched on the next request; interrupted downloads are reconciled at boot.

Missing or optional assets degrade gracefully to the existing fallbacks with a logged warning — never a crash.

## Source

- Engine scanner: `packages/frontend/engine/src/assets/asset_manifest.ts`
- CLI scanner: `scripts/src/lib/ops/scan_assets.ts`
- Registry: `packages/frontend/repositories/src/lib/assets.ts`
- Cache + manager: `apps/frontend/client/src/lib/services/assets/`
- UI: `apps/frontend/client/src/lib/views/asset-browser/`
- Store: `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`
