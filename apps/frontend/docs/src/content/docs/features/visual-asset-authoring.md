---
title: Authoring Visual Assets
description: How sprites, props, and tilesets are described, validated, and played back through a single shared visual definition so they render identically in the game and in previews.
---

Every character, prop, and tileset in Aikami is described by a **visual
definition** — one small, versioned document that determines the asset's
frames, timing, origin, and supported color behavior. Both the in-game
renderer and the Hub/client previews read the same definition, so a sprite
looks identical wherever it appears, and a generic (non-LPC) atlas works
alongside an LPC character in one scene without a second renderer.

This is the format that replaces guessing a sheet's layout from its pixel
dimensions or from provider-specific conventions. Definitions are validated
before they are published or allocated, so an invalid asset never reaches a
save.

## What a Definition Contains

| Section | What it declares |
|---|---|
| **Identity** | Stable id, schema version, and a content-hash revision pinned by pack/release locks |
| **Images** | Stable image ids, immutable artifact references, dimensions, and color/alpha encoding |
| **Frames** | Unique frame ids, which image each slices from, pixel rectangles, trim offsets, and pixel-space origin |
| **Clips** | Named animations such as `walk.east`, ordered frame ids, per-frame duration, loop behavior, and explicit fallback clips |
| **Components** | Rig/body/pose compatibility, stable render passes (e.g. rear `behind` and front), and deterministic ordering |
| **Presentation** | Pixel density, sampling policy, and the one supported color operation (multiplicative tint) |
| **Provenance** | Original source and license/attribution records |

## Playback

Animation uses an **elapsed-time clock**, not a display refresh count, so a
clip advances at the same wall-clock speed on a 60 Hz screen and a 30 Hz
screen. One actor clock drives every compatible layer, keeping layered passes
in frame-lock; a missing action follows an explicit actor-level fallback
(e.g. `slash.down` → `idle.down`) instead of each layer guessing on its own.

During steady playback the renderer reuses cached frame views and allocates
no new textures, sprites, or containers per frame.

## Validation

Before a definition is published or allocated, it is checked for:

- Frames that extend outside their image bounds
- Duplicate frame, image, or clip ids
- Clips that reference missing frames
- Fallback clips that are unresolved or form a cycle
- Unsupported rendering modes (indexed-palette playback is deferred; use
  RGBA or explicit multiplicative tint)

A definition that fails any check is rejected with a structured diagnostic
that names the asset, clip, profile, or failed reference.

## Publishing

Catalog publication is **revision-consistent**: immutable shards and required
seed/metadata files are uploaded first, and only then is the release pointer
advanced. A shard, seed, or validation failure preserves the previous complete
release — readers never see a mix of old and new revisions. The existing
`index/v1/` path stays readable for older clients.

## Reference

- Shared visual definition schema and validator:
  `packages/shared/schemas/src/lib/visual/visual_definition.ts`
- LPC → visual-definition adapter:
  `packages/shared/lpc/src/lib/visual_adapter.ts`
- Elapsed-time playback clock:
  `packages/shared/lpc/src/lib/elapsed_time.ts`
- Catalog publish pipeline:
  `scripts/src/lib/catalog/pipeline.ts`
