---
title: Hub Catalog Browsing
description: Browse and preview assets in the Aikami Hub catalog — LPC characters, tilesets, maps, props, and content packs.
---

The Aikami Hub provides a public catalog of published assets. You can browse
categories, view asset details, and interact with live previews of supported
asset types.

## Catalog Landing

The catalog landing page (`/catalog`) shows all available categories with
their total asset counts. Click any category to browse its assets.

## Category Browsing

Each category page (`/catalog/{category}`) displays a grid of asset tiles with
thumbnails. The grid shows the display name, size, and type for each asset.

## Asset Detail Page

Clicking an asset opens its detail page (`/catalog/{category}/{tag}`) with:

- **Preview**: A server-rendered thumbnail that is replaced by an interactive
  preview when available.
- **Metadata**: Size, type, category, and tag.
- **License**: License information with attribution links.
- **Stats**: Pack count for the asset.

### Interactive Previews

The following asset types support interactive previews:

| Category | Preview Type | Description |
|---|---|---|
| `lpc` | LPC Character | Composed character with animation state and direction controls. Layers can be added, removed, and customized. |
| `tilesets` | Tileset Grid | Atlas rendered at integer scale with optional grid overlay. |
| `maps` | Tilemap | Rendered tilemap with layers in order. |
| `props` / `sprites` | Single Sprite | Centered sprite at configurable zoom. |
| `contentPacks` | Pack Listing *(planned)* | Lists the pack's constituent entries. |

Audio categories (`music`, `sfx`, `ambient`) and `backgrounds` show the
server-rendered thumbnail only.

### LPC Preview URL State

LPC preview configuration (layers, direction, animation state, zoom) is
encoded in the URL search parameters. You can share a specific character
configuration by copying the URL.

### Degraded Behavior

If the interactive preview fails to load or the resolver cannot resolve the
asset, the server-rendered thumbnail remains visible and a notice explains
that the interactive preview is unavailable. The page never regresses below
the thumbnail-only experience.

## Source

The catalog browsing interface is implemented in
`apps/frontend/hub/src/lib/views/catalog/`. Preview components live in
`packages/frontend/preview/src/lib/`.
