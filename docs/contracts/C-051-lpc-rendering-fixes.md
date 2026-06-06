| Metadata | Value |
| --- | --- |
| Source | User |
| Target | apps/frontend/pwa |
| Priority | High |
| Dependencies | C-050 |
| Status | not_started |
| Version | 1.0 |

# Overview
Fix the visual rendering bugs in the Universal LPC Spritesheet Character Generator component. The current implementation suffers from incorrect layer sorting (Z-indexing) and broken color tinting for customizable layers (like hair and skin). We will enforce a strict layer hierarchy in the bitECS rendering system, fix the PixiJS tint applications, and add a zoom control to the main dev component.

# Design Reference
- `apps/frontend/pwa/src/lib/components/game/lpc_character_renderer.svelte` for the PixiJS/bitECS rendering bridge.
- `apps/frontend/pwa/src/routes/(dev)/dev/lpc/component/+page.svelte` for the dev UI.
- Universal LPC layer ordering standards.

# Architecture Directives

## LPC Layer Sorting System
Update the ECS sprite rendering logic to enforce a strict, deterministic Z-index order based on the equipment "slot" rather than the order of insertion. Create a constant mapping of slots to Z-indexes.

## LPC Tinting System
Ensure the ECS components handling color (e.g., `Palette Index` or specific hex colors) correctly parse and apply the `tint` property to the underlying PixiJS `Sprite` instances. Ensure the base textures are loading properly before tinting is applied.

## Dev Component Zoom UI
Add a zoom slider to the main `/dev/lpc/component` route, mirroring the parameter support we built for the lite route, to allow users to inspect the sprites closely.

# State & Data Models

    // Conceptual Z-Index Mapping
    export const LPC_LAYER_Z_INDEX: Record<string, number> = {
        body: 10,
        head: 20,
        eyes: 30,
        legs: 40,
        feet: 50,
        torso: 60,
        hands: 70,
        hair: 80,
        headwear: 90,
        weapon: 100,
        shield: 110,
        effects: 120
    };

# Acceptance Criteria

- **AC1: Deterministic Layer Sorting**
  - **Given** an LPC character with randomized insertion order of body, hair, and torso
  - **When** rendered by the PixiJS bitECS system
  - **Then** the hair and torso always render on top of the body, regardless of configuration order.

- **AC2: Color Tinting**
  - **Given** an LPC character layer configured with a specific hex color or palette index
  - **When** the sprite is rendered
  - **Then** the PixiJS sprite `tint` property is correctly applied and visible on the canvas.

- **AC3: Dev Component Zoom Control**
  - **Given** the main LPC dev component
  - **When** the user adjusts the new zoom slider
  - **Then** the PixiJS container scales accordingly and the `zoom` URL parameter is updated via our sync logic.

- **AC4: Passing AI Validation**
  - **Given** the visual testing harness from C-050
  - **When** the validation script is run against the newly rendered configurations
  - **Then** the AI reports passing scores with correct layer alignments and color applications.

# Implementation Notes
1. Define the `LPC_LAYER_Z_INDEX` map in an appropriate constants file within the LPC domain.
2. Modify the ECS system responsible for syncing sprite components to PixiJS. Ensure it applies the `zIndex` to the PixiJS `Sprite` and sets `sortableChildren = true` on the parent `Container`.
3. Check the color passing logic. PixiJS expects numeric values for tints (e.g., `0xFFFFFF`). If we are passing `#HEX` strings or palette indices from the UI, ensure they are converted correctly before assigning to `sprite.tint`.
4. Add the zoom slider to `+page.svelte` in `/dev/lpc/component`. Bind it to the existing URL config logic.
5. Run the visual validation script to confirm the bugs are resolved.

# Edge Cases & Gotchas
- **PixiJS Sortable Children:** Modifying `zIndex` on a child sprite does nothing unless its parent container has `sortableChildren = true`.
- **White Tint Default:** Ensure that layers without a specified color default to `0xFFFFFF` (no tint), not `0x000000` (black).
