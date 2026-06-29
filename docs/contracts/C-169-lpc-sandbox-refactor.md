<!-- completed: 2026-06-29 -->
# Contract: C-169 LPC Sandbox Refactor & Polish

| Field | Value |
| --- | --- |
| Source | Architect |
| Target | apps/frontend/client/src/lib/views/dev/lpc/, apps/frontend/client/src/lib/data/lpc_models.ts |
| Priority | High |
| Dependencies | C-168 |
| Status | completed |
| Contract version | 1.0 |

## Overview
Polish the `/dev/lpc` sandbox UI by fixing layout bugs and adding per-layer tint controls. More importantly, we are decoupling the UI category presentation from the raw Universal-LPC file structure, reorganizing the chaotic asset slots into a logical, game-ready hierarchy without renaming the underlying files.

## Design Reference
- Existing Dev UI components and Tailwind stacking contexts.
- PixiJS `Sprite.tint` pipeline for color application.

## Architecture Directives
- **Z-Index & Dropdowns:** Fix the dropdown menu clipping. Ensure the layer selection dropdowns have a high enough `z-index` and are broken out of any `overflow-hidden` containers so they render cleanly over the layer list.
- **Synchronized Grid Zoom:** The background grid overlay must scale exactly with the PixiJS canvas. Bind the CSS `transform: scale(...)` of the grid to the exact same zoom `$state` variable driving the canvas, ensuring both share `transform-origin: center`.
- **Per-Layer Tinting:** Inject a native HTML color picker (`<input type="color">`) into each row of the active layers list. Wire this value to update the layer's configuration state, which the PixiJS renderer will apply via the Sprite's `tint` property.
- **Sane Category Abstraction:** Do not move the 6,000+ physical `.webp` files. Instead, create a mapping layer in the ViewModel (or `lpc_models.ts`) that groups the raw path directories into logical UI categories. 

## State & Data Models
    // Update the layer model to support color
    interface LpcLayerConfig {
        id: string;
        slot: string; // The raw LPC path (e.g., 'body/male')
        variant: string; 
        colorHex?: string; // e.g., '#ffffff'
        isVisible: boolean;
        zIndex: number;
    }

    // New logical grouping for the UI
    const UI_CATEGORIES = {
        'Anatomy': ['body', 'head', 'faces', 'ears', 'nose', 'wrinkles'],
        'Appendages': ['wings', 'tail', 'horns', 'fins', 'prosthesis'],
        'Hair': ['hair', 'beard'],
        'Clothing Top': ['torso', 'dress', 'shoulders', 'neck', 'cape'],
        'Clothing Bottom': ['legs'],
        'Footwear': ['feet'],
        'Accessories': ['eyes', 'hat', 'glasses', 'earrings', 'patches'],
        'Equipment': ['weapon', 'shield']
    };

## Acceptance Criteria

- **AC1: Category Restructure**
  - **Given** the user is in the `/dev/lpc` sandbox
  - **When** they open the slot selection menu
  - **Then** the slots are grouped by the new logical UI categories (Anatomy, Hair, Clothing Top, etc.) instead of the raw Universal-LPC directory structure.
  
- **AC2: Dropdown Visibility**
  - **Given** the active layers list is populated
  - **When** the user clicks a dropdown to change a variant
  - **Then** the dropdown menu fully overlaps the list items below it without being clipped or hidden.

- **AC3: Grid Zoom Synchronization**
  - **Given** the user zooms in on the character
  - **When** the character scales up
  - **Then** the background grid scales proportionally and maintains perfect alignment with the character's feet/center.

- **AC4: Per-Layer Color Tinting**
  - **Given** a multi-layer character is rendered
  - **When** the user selects a red hex color (`#ff0000`) for the "Hair" layer
  - **Then** only the hair sprite updates its tint to red in the PixiJS canvas, leaving all other layers unchanged.

## Implementation Notes
1. Update `apps/frontend/client/src/lib/views/dev/lpc/lpc_view.svelte`. Adjust the Tailwind classes on the layer list (`z-index`, `relative/absolute` positioning) to fix the dropdown clipping.
2. In the same view, find the grid overlay `<div>` and apply an inline style for `transform: scale({viewModel.zoom})` matching the canvas zoom logic.
3. Update the layer list UI to include `<input type="color" bind:value={layer.colorHex} />`.
4. In `lpc_view_model.svelte.ts` (or the respective renderer class), map `layer.colorHex` to `sprite.tint` using PixiJS's `Color` utility (e.g., `new Color(layer.colorHex).toNumber()`).
5. Define the `UI_CATEGORIES` map. Refactor the UI rendering loop to iterate over these UI groups rather than the flat/chaotic list of raw slots, passing the raw slot ID under the hood for actual asset resolution.

## Edge Cases & Gotchas
- **Tinting White vs Black:** PixiJS `tint` is multiplicative. Tinting a white pixel works perfectly; tinting a black pixel keeps it black. LPC assets usually have baked shading, so tinting might look slightly darker than the exact hex chosen. This is expected and acceptable for the MVP.
- **Default Color:** If no color is selected, the layer should default to white (`#ffffff` or `0xffffff`) so the original asset colors render correctly.
