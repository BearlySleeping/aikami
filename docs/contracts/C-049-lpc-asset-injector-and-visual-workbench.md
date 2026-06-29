# Contract — C-049 LPC Asset Injector and Visual Workbench

## Metadata
| Field | Value |
|---|---|
| Source | Technical Audit / Visual Execution Gap |
| Target | Client Rendering Layer / Mocking Infrastructure |
| Priority | P0 (Blocking Visualization) |
| Dependencies | C-048 |
| Status | completed |
| Version | 1.0.0 |

## Overview
This contract resolves the missing artwork limitation by embedding a procedural, pixel-accurate canvas asset generator directly into the `TextureManager` local development fallback hooks. It configures authentic image layers for every distinct equipment category (Body variants, Hair cuts, Clothing layers, Weapons) and wires them into the dropdown menus of the `/dev/lpc-component` route, making the interface completely functional with interactive sprites, real-time colors, and looping animations.

## Design Reference
- `apps/frontend/client/src/routes/(public)/dev/lpc-component/+page.svelte`: Core interactive laboratory framework.
- `packages/frontend/engine/src/rendering/texture_manager.ts`: Controls runtime texture extraction, cache mappings, and fallback handling.
- `LPC Asset Conventions and Attribution`: Universal 21-row layout architecture mapping structural sheets to exact vertical coordinates.

## Changes Detail

### 1. Update `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts`
Expand the structural asset registry to host explicit procedural texture factories:
- Line 1 File path comment: `// apps/frontend/client/src/lib/data/lpc_asset_catalog.ts`.
- Declare detailed configuration matrices for each layer category containing real identifier variants:
  * `body`: `male_light`, `male_dark`, `female_elf`, `skeleton`.
  * `hair`: `mohawk`, `long_braid`, `curly_afro`, `short_crop`.
  * `torso`: `chainmail`, `leather_vest`, `robe`, `plate_armor`.
  * `legs`: `plate_greaves`, `cloth_skirt`, `tattered_pants`.
  * `weapon`: `broadsword`, `spear`, `wood_bow`.

### 2. Create Procedural Sprite Generation Hooks in `lpc_asset_path_mapper.ts`
Implement an automated fallback canvas generator that outputs true indexed texture grids if local filesystem images are missing:
- Build a utility function `generateMockLpcSheet(slotType: string, variantId: string): string` that initializes an offscreen HTML canvas sized to match the uniform LPC grid layout.
- Draw bounding feature shapes into the 21 discrete vertical animation rows using predictable color ramps:
  * Paint distinct directional offsets (Up, Left, Down, Right) inside the designated walk boundaries (Rows 8-11).
  * Render explicit visual features per variant (e.g., long spikes for bows, broad rectangles for armor layers) to make variations highly visible.
- Export the compiled canvas data directly as a clean base64 data-URL string (`canvas.toDataURL()`) to feed directly into PixiJS's `Texture.from()` pipeline.

### 3. Upgrade `apps/frontend/client/src/routes/(public)/dev/lpc-component/+page.svelte`
- Line 1 File path comment: `// apps/frontend/client/src/routes/(public)/dev/lpc-component/+page.svelte`.
- Refactor drop-down elements to iterate over the new extended `lpcAssetCatalog` collections.
- Ensure that choosing an equipment variant forces the manager to instantly re-bind the texture source, slice the target 64x64 sub-rectangle, and execute a visible repaint on the canvas layer tree.

## Acceptance Criteria

### AC-1: Granular Modular Equipment Layering
- **Given** the visual developer workbench is running inside a browser session,
- **When** the developer adds layered items or changes variants from the dropdown lists,
- **Then** the canvas must dynamically stack individual texture layers in the correct visual priority order, tracking variant geometry shifts instantly.

### AC-2: Directional and Frame Grid Looping
- **Given** an assembled character structure visible inside the laboratory viewport,
- **When** the direction slider updates or the play ticker cycles frames automatically,
- **Then** the texture projection coordinates must recalculate smoothly, drawing frame-synchronized walking steps or weapon swings without clipping or visual drift.

### AC-3: Multi-Layer Palette Channel Shifting
- **Given** an active composite entity rendering texture assets on the screen,
- **When** individual color swatches or hex properties update,
- **Then** the associated layer color channels must re-tint instantly while maintaining underlying structural configurations.

## Test Hooks
- Expose the collection of active layers via a window hook: `window.__lpc_workbench_active_layers`.

## Implementation Notes
- Restrict all texture generation logic to local dev and emulator scopes.
- Use explicit 64x64 cell multiplier boundaries to guarantee pixel-accurate slicing.
