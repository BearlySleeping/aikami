---
title: Asset Management
description: How Aikami resolves sprites, maps, music, and SFX — the published catalog origin, the local content-addressed cache, and the first-run download.
---

Aikami's art and audio live in a **published catalog** rather than inside the
app. The client resolves every asset by tag through a local registry, caches
the bytes on disk keyed by content hash, and verifies them before use. The
practical result: a one-time download on first run, then full offline play.

## Where assets come from

Assets are published to a content-addressed origin on Cloudflare R2 by the
catalog publish pipeline. See
[Publishing Assets to the Catalog Origin](/guides/publishing-catalog-assets/)
for the pipeline itself.

Each file is identified by a **tag** derived from its path — for example,
`sprites/generic-fantasy/elf.png` becomes `sprites:generic-fantasy:elf`, and
`lpc/body/bodies_male.walk.webp` becomes `lpc:body:bodies_male:walk`. The
engine resolves these tags at runtime and loads textures through PixiJS with
transparent caching.

Categories are declared in `packages/shared/constants/src/lib/game_assets.ts`:
`music`, `sfx`, `ambient`, `sprites`, `backgrounds`, `lpc`, `maps`,
`tilesets`, and `contentPacks`.

## First run needs a connection

**The app does not ship with the asset library.** On first launch — desktop,
web, or Docker — it fetches the catalog seed and downloads the starter content
it needs, verifying each file's SHA-256 before writing it to disk. You will
see a download stage in the boot progress while this happens.

After that first run, everything is served from the local cache and the game
plays with **no network connection at all**. Launching for the first time with
no connection reports that starter content still needs downloading, rather than
failing silently.

This applies to the native desktop app the same as the browser: the Tauri
bundle is small precisely because the art library is not inside it.

## Offline asset cache

Once assets have been fetched, every sprite, LPC layer, map, and audio file is
served from a local content-hash-keyed cache with zero network round-trips.

1. The publish pipeline emits a **boot seed** describing every catalog asset —
   tag, category, extension, SHA-256, and byte size.
2. On boot, the `initializing_asset_registry` stage seeds a local Turso
   registry (`assets`, `asset_sources`, `install_state` tables) from that seed.
   Seeding is idempotent — later boots only run a meta guard check.
3. The **AssetManager** resolves each tag through registry → cache → sources.
   On a miss it fetches from the origin, **verifies the SHA-256 against the
   registry hash before writing or serving**, and records the install state.
4. Binaries are stored hash-named in OPFS (Web/PWA) or the Tauri native disk
   cache (Desktop). Writes go to a temporary file first and are atomically
   renamed into place, so readers never observe a partially-written entry;
   reads verify the file's SHA-256 again before serving (a corrupted entry is
   discarded and re-fetched). Cached assets resolve to `blob:` object URLs —
   PixiJS loads them transparently via a registered blob-URL loader.
5. When a published asset's hash changes, the old binary is **automatically
   evicted** and re-fetched on the next request; interrupted downloads are
   reconciled at boot.

Missing or optional assets degrade gracefully to the existing fallbacks with a
logged warning — never a crash.

Because objects are addressed by content hash, an asset is never "updated" in
place: a changed file is a new object with a new hash, and the old bytes stay
valid for anyone still referencing them.

## Background crossfade

Scene backgrounds transition smoothly using a 500 ms alpha crossfade. Call
`setBackground(tag)` on the game world to load and crossfade between background
images through the PixiJS render pipeline.

## Browsing assets

Two surfaces:

- **The hub catalog** at [the community hub](https://hub.bearlysleeping.com) —
  browse published assets by category with licence and attribution for each.
  This is the one available in a shipped build.
- **`/dev/asset-browser`** — a development-only route with a folder tree, file
  grid, and category tabs. It is compiled out of production builds, so it is
  available only when running from source or with
  `AIKAMI_INCLUDE_DEV_ROUTES=true`.

## Source

- Engine scanner: `packages/frontend/engine/src/assets/asset_manifest.ts`
- CLI scanner: `scripts/src/lib/ops/scan_assets.ts`
- Publish pipeline: `scripts/src/lib/catalog/`
- Registry: `packages/frontend/storage/src/lib/assets.ts`
- Cache + manager: `apps/frontend/client/src/lib/services/assets/`
- Store: `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`
- Dev UI: `apps/frontend/client/src/lib/views/asset-browser/`
