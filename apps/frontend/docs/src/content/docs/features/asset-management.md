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

## Source

- Engine scanner: `packages/frontend/engine/src/assets/asset_manifest.ts`
- CLI scanner: `scripts/src/lib/ops/scan_assets.ts`
- UI: `apps/frontend/client/src/lib/views/asset-browser/`
- Store: `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`
