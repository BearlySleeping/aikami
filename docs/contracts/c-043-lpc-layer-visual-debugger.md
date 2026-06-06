# Contract — C-043 LPC Layer Visual Debugger

## Metadata

| Field        | Value                                   |
| ------------ | --------------------------------------- |
| Source       | Technical Audit / Visual Pipeline Stall |
| Target       | PWA Rendering Layer / Dev Tools View    |
| Priority     | P1                                      |
| Dependencies | C-042                                   |
| Status       | not_started                             |
| Version      | 1.0.0                                   |

## Overview

This contract introduces an interactive visual debugger (`/dev/lpc-component`) modeled on the open-source Universal LPC Generator paradigm. It integrates a structural asset catalog, fallback canvas mocking, and an interactive palette color-swapping pane. This setup enables developers to test, verify, and isolate multi-layered character configurations visually while ensuring the underlying engine runs with zero runtime heap allocations.

## Design Reference

- `apps/frontend/pwa/src/routes/(authenticated)/dev/lpc-component/+page.svelte`: Sandboxed runtime evaluation tab.
- `LPC Spritesheet Pipeline Tool Comparison`: Standard hierarchical sheet categories (Body, Head, Hair, Torso, Legs, Feet) and palette ramp shifts.
- `Svelte, PixiJS, WebGL2 Shader Integration`: Explicit microtask batch boundaries via `$effect` hooks and isolated SSR contexts.

## Changes Detail

### 1. Create `apps/frontend/pwa/src/lib/data/lpc_asset_catalog.ts`

Scaffold a comprehensive metadata schema that maps asset files to memory slots:

- Line 1 File path comment: `// apps/frontend/pwa/src/lib/data/lpc_asset_catalog.ts`.
- Export a immutable lookup definition structure grouping available standard LPC variants (e.g., `Body`: `light`, `dark`, `skeleton`; `Hair`: `short_brown`, `long_blonde`).
- Provide an automatic 256-color gradient builder (`buildDefaultPaletteRamp()`) mapping baseline color arrays (Skin, Hair, Cloth, Metal) to raw color coordinates matching standard WebGL-accelerated generators.

### 2. Update `apps/frontend/pwa/src/routes/(authenticated)/dev/lpc-component/+page.svelte`

Overhaul the verification tab into a 3-column debugger workspace:

- **Left Panel (Viewport Canvas)**: Displays the `LpcCharacterRenderer` centrally. If textures fail to load, use a canvas-backed fallback matrix to render a fallback magenta indicator so the entity is visible.
- **Center Panel (Layer Assembly Controller)**: Add interactive Svelte 5 selection drop-downs:
    - Layer Slot Adder/Remover.
    - Hierarchical select filters for `Slot` type and asset `Variant`.
    - Real-time palette color parameters: include an index range slider and an interactive HTML color picker (`<input type="color">`) writing adjustments directly into the target layer's palette memory slice.
    - Animation state controller: select lists for `LpcAnimationState` (Walk, Slash, Thrust, Spellcast, Shoot) and direction vectors (Up, Left, Down, Right).
- **Bottom Status Banner**: Provide an auto-dismissing indicator block that intercepts loading exceptions from the texture manager, printing diagnostic warnings for broken paths.

### 3. Modify `packages/frontend/engine/src/systems/render_system.ts`

Optimize state change checks to isolate structural modifications from palette swaps:

- Add a lightweight signature check (`recipePaletteFingerprint(recipe)`) utilizing a low-overhead hashing loop over active palette points.
- Refactor `writeEntityUbo()` to run an in-place update over buffer slot variables when palette shifts occur, preventing unneeded increments to the `structuralHashesIssued` counter.

## Acceptance Criteria

### AC-1: Dynamic Layer Ingestion and Frame Selection

- **Given** the upgraded `/dev/lpc-component` route page is loaded in a browser view,
- **When** the developer changes drop-down items or triggers frame stepping parameters,
- **Then** the component must calculate texture frame positions, reissue precisely one structural hash modification, and update the viewport composition.

### AC-2: Zero-Allocation Real-time Palette Recoloring

- **Given** an active character instance rendered inside the debugger workspace,
- **When** the developer alters color indices or inputs hex values via the picker tool,
- **Then** changes must update the character data array using in-place cache lines, completely bypassing dynamic allocations or engine re-allocations.

### AC-3: Error Interception and Fallback Safety

- **Given** an asset configuration request pointing to a missing or broken file path,
- **When** the texture compilation loop catches a loading exception,
- **Then** the renderer must switch to a temporary magenta bounds block, send a warning log to the bottom status banner, and maintain active engine updates without hanging the browser session.

## Test Hooks

- Expose the collection of active layers via a window hook: `window.__lpc_debug_active_recipes`.

## Implementation Notes

1. Group control wrappers cleanly into dedicated cards to keep layout regions organized.
2. Schedule state transformations inside a browser microtask (`$effect`) block to combine multi-property selections cleanly into a single buffer update.
3. Validate data integrity during testing by matching active slot indices against telemetry readouts.
