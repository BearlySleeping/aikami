# Contract — C-044 LPC Fallback Grid Projection

## Metadata
| Field | Value |
|---|---|
| Source | Code Review / Visual Alignment Sync |
| Target | PWA Rendering Layer / Mock Pipeline |
| Priority | P1 |
| Dependencies | C-042, C-043 |
| Status | completed |
| Version | 1.0.0 |

## Overview
This contract wires the exact layout coordinates of the LPC community standard directly into the structural fallback layout of the `LpcCharacterRenderer` debugging view. It replaces static procedural shapes with an animated, directional coordinate frame system. This system responds to animation states, directions, frames, and asset variants, ensuring your controls function correctly even when running in canvas fallback mode.

## Design Reference
- `apps/frontend/pwa/src/routes/(authenticated)/dev/lpc-component/+page.svelte`: Split debugger view layout.
- `packages/frontend/engine/src/rendering/animation_controller.ts`: Frame and row index lookups (`getLpcFrameIndex`).
- LPC Layout Standard: 64x64 cell dimensions, 4 directional rows per action state layer block.

## Changes Detail

### 1. Modify `apps/frontend/pwa/src/lib/components/game/lpc_character_renderer.svelte`
Update the procedural rendering script block to integrate grid calculations:
- Parse the current active combination of `animationState` and `facing` properties to calculate the correct structural vertical row index offset ($0 - 20$) based on the LPC layout rules.
- Update the procedural asset layer rendering loops (`drawLayerShape`) to draw offset vectors using the active frame counter:
  * **Body Layer**: Instead of a static square, render an offset character shape whose body orientation (e.g., width-to-height ratio, limb extensions) changes based on the directional row index.
  * **Hair / Equipment Variant Layer**: Read the specific variant asset ID string (e.g., `variant-1`, `variant-2`). Apply an automated transformation factor (such as varying heights or adding accessory outlines) to prove the selector functions.
- Draw a subtle $64 \times 64$ crosshair bounding grid box around the active layout slot to visually track frame clipping boundaries.

### 2. Connect Palette Index Ramps to Component Color Outputs
- Update the tint generation model to look up the exact active palette color index index pointer rather than averaging all colors. This ensures the output updates instantly when tweaking individual sliders on the swatch interface.

## Acceptance Criteria

### AC-1: Row and Frame Grid Calculation Accuracy
- **Given** the visual developer workspace is open with the canvas fallback layer active,
- **When** the developer changes the direction selector (e.g., from Down to Up) or ticks frames,
- **Then** the fallback graphic representation must dynamically alter its shape properties to match the corresponding row index calculation.

### AC-2: Variant ID Rendering Variations
- **Given** an active layer rendering inside the component view box,
- **When** the variant dropdown selection changes to a different asset lookup target,
- **Then** the shape must modify its geometry configuration (e.g., scale shifts or feature additions) to confirm the properties are binding correctly.

### AC-3: Multi-Index Palette Swapping
- **Given** an active composite entity matching the selector layout configuration,
- **When** the developer modifies a color index on the panel,
- **Then** the component must rewrite that color to the corresponding layer index slice without resetting unaffected colors.

## Test Hooks
- Expose calculated layout variables to the automated test runner via `window.__lpc_current_row` and `window.__lpc_current_col`.

## Implementation Notes
- Use exact arithmetic grid boundaries to map animation state actions cleanly.
- Keep calculations lean to maintain a 60fps frame budget during active preview cycles.

## Edge Cases & Gotchas
- **Frame Index Overflow Protection**: Different actions have different total frame caps (e.g., Slash has 6 frames, while Shoot has 13). Clamp frame loop calculations using defensive lookups (`getLpcFrameIndex`) to prevent asset index execution exceptions.
