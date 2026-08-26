---
title: First-Run Download
description: How Aikami handles starter content download on first launch
---

Aikami no longer bundles game content inside the client build. Instead, the
client downloads the starter content pack (Emberwatch) on the very first run
and caches it locally in OPFS (browser) or the Tauri filesystem. Every
subsequent run is fully offline.

## What gets downloaded

On first boot, the client fetches the following from the R2 origin:

- **Pack index** (`index`) — lists available content packs
- **Pack manifest** (`emberwatch:manifest`) — campaign definition, maps, NPCs,
  items, quests, and dialogues (~25 KB)
- **Map files** (`emberwatch:maps:village`, `emberwatch:maps:inn`,
  `emberwatch:maps:merchant_shop`) — the three Emberwatch maps

These tags are declared in `offline_core.json` and are prefetched during the
`prefetching_starter_content` boot stage. Progress is shown through the boot
UI with a visible counter.

## First run with network

1. Boot begins with the `prefetching_starter_content` stage
2. The client fetches the pack index, manifest, and maps from the R2 origin
3. Each file is hash-verified and cached to the local filesystem
4. Boot continues to asset seeding, engine creation, and gameplay

## First run without network

If the client has no cached content and no network is available, boot displays
the message:

> *"Aikami needs to download starter content the first time you play. Connect
> to the internet and try again."*

The game does not hang or show a blank screen — the error is explicit and
actionable.

## Subsequent runs (fully offline)

After the first successful run, all starter content is cached. The client boots
with zero outbound network requests for content packs. This satisfies the
project invariant: *first run requires network; every later run is fully
offline.*

## Upgrading

When the client updates to a new version, the prefetch stage checks the local
cache first. Already-cached tags are skipped (`fetched === 0`). Only tags that
are not yet cached are downloaded. This means upgrading does not re-download
content that is already present.

## Technical details

- The prefetch uses the existing `assetManager.warm()` path, which verifies
  content hashes before caching
- Tags are declared in `static/game-data/offline_core.json` and published to
  R2 under `seed/offline_core.json`
- The boot stage is bounded by the same 30-second timeout as all other stages
- The `basePath` for content packs remains `/content-packs` — published tags
  are byte-identical before and after the de-bundling change
