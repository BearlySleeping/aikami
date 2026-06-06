# Contract — C-045 Pixi Graphics Dirty Flag Synchronizer

## Metadata
| Field | Value |
|---|---|
| Source | Client Runtime Visual Debugging |
| Target | PWA Rendering Layer / Component Sync |
| Priority | P0 (Blocking Visualization) |
| Dependencies | C-044 |
| Status | not_started |
| Version | 1.0.0 |

## Overview
This contract resolves the static canvas rendering bug in the fallback pipeline of the `LpcCharacterRenderer` component. It enforces an explicit redrawing mechanic inside PixiJS by wiring runtime reactive props directly to a canvas clearing command loop. This setup forces the browser graphics engine to reinitialize, redraw, and visually repaint the canvas container whenever variant dropdowns, color selectors, directions, or frame counters update.

## Design Reference
- `apps/frontend/pwa/src/lib/components/game/lpc_character_renderer.svelte`: Manages the local graphics array context variables.
- `packages/frontend/engine/src/rendering/sprite_composer.ts`: Regulates standard layout coordinate conversions and compilation boundaries.
- Svelte 5 Reactive Execution Limits: Effects compile on state evaluation passes and bundle multiple asset modifications.

## Changes Detail

### 1. Modify `apps/frontend/pwa/src/lib/components/game/lpc_character_renderer.svelte`
Overhaul the internal reactive loops to handle canvas cleaning commands:
- Line 1 Path comment header: `// apps/frontend/pwa/src/lib/components/game/lpc_character_renderer.svelte`.
- Locate the main Svelte 5 dynamic updating `$effect` block that watches incoming character variables (`animationState`, `facing`, `frame`, `recipes`, `paletteIndex`).
- Enforce an explicit clear command loop right before executing any geometric painting instructions:
  ```typescript
  // For each graphic layer boundary instance:
  graphic.clear();

    Re-trigger the complete configuration pipeline block: invoke _drawCrosshairGrid() and iterate down the active layer arrays to execute drawLayerShape() using the newly selected coordinates, variant metrics, and custom color hex tokens.

    Add an optimization flag to ensure redrawing requests execute only when the browser canvas viewport is inside a live visible tab layout, protecting performance budgets.

Acceptance Criteria
AC-1: Instant Visual Repainting across Input Variations

    Given the visual developer workbench is running inside an active browser view context,

    When the developer interacts with directional controls or steps through frame sliders,

    Then the canvas container must clear its old shapes instantly and paint the updated coordinate geometry layout vectors matching the new frame variables.

AC-2: Layer Stack Order Consistency

    Given an updated entity structure rendered on the canvas viewport,

    When multi-layered parameters clear and rebuild dynamically,

    Then the visual stacking priority must maintain back-to-front sorting rules across variables: Body base → Torso accessories → Head items → Hair assets → Weapons.

AC-3: Safe Fallback Error Recovery Boundaries

    Given a composite element rendering shapes on the screen,

    When invalid palette index references are passed down to lookup properties,

    Then the execution code must catch index range limits safely, fall back to high-visibility boundary blocks, and preserve active panel slider telemetry updates.

Test Hooks

    Expose a window hook to verify render triggers: window.__lpc_fallback_render_cycles.

Implementation Notes

    Restrict all graphic modification instructions safely within single animation frames.

    Run clear actions using memory-safe operations to prevent system layer leaks.
