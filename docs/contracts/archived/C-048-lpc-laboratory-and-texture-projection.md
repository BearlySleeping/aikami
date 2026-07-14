<!-- completed: 2026-06-29 -->
# Contract — C-048 LPC Laboratory and Texture Projection

## Metadata
| Field | Value |
|---|---|
| Source | User Visual Audit / Pipeline Implementation Gap |
| Target | Client Rendering Layer / Dev Tools View & Component |
| Priority | P1 |
| Dependencies | C-044, C-045, C-047 |
| Status | completed |
| Version | 1.0.0 |

## Overview
This contract transitions the developer sandbox from synthetic procedural geometries into a comprehensive, pixel-accurate LPC Asset Laboratory workspace. It replaces placeholder shapes with true `TextureManager` sub-texture slice calculations utilizing the strict $64 \times 64$ universal grid standard. It integrates a dedicated animation playback clock ticker, a complete asset layout slot matrix, and deep visualization controls to verify lookups and palette index modifications under local conditions.

## Design Reference
- `apps/frontend/client/src/routes/(public)/dev/lpc-component/+page.svelte`: Split debugger layout structure.
- `packages/frontend/engine/src/rendering/texture_manager.ts`: Controls runtime sheet slicing, grayscale resource allocation, and base assets.
- `LPC Asset Conventions and Attribution`: Establishes the uniform 21-row layout architecture and layered "paper-doll" stacking rules.

## Changes Detail

### 1. Upgrade `apps/frontend/client/src/routes/(public)/dev/lpc-component/+page.svelte`
Overhaul the layout into a feature-complete visual laboratory:
- Line 1 File path comment: `// apps/frontend/client/src/routes/(public)/dev/lpc-component/+page.svelte`.
- **Granular Asset Library Selectors**: Introduce drop-down menus for every physical composite slot (`body`, `head`, `hair`, `torso`, `legs`, `feet`, `weapon`). Populate variants using actual open-source asset naming references.
- **Animation Ticker Controls**: Add an interactive player layout section:
  * Play / Pause toggle switch.
  * Loop playback speed slider (Frames Per Second control: 1 to 60 FPS).
  * Manual frame stepping buttons (Step Next / Step Prev) active when paused.
- **Palette Management Panel**: Expose an interactive hex input dashboard linked directly to the selected layer's color array index points to allow real-time palette recoloring verification.
- **Diagnostic Inspection Overlays**: Add toggleable layout checkboxes to render visualization frames on canvas:
  * `Show Grid Layout`: Toggles the $64 \times 64$ crosshair bounding box.
  * `Isolate Layer Layer`: Dropdown choice to view only a single selected slot (e.g., just Hair) to check edge blending.

### 2. Update `apps/frontend/client/src/lib/components/game/lpc_character_renderer.svelte`
- Line 1 File path comment: `// apps/frontend/client/src/lib/components/game/lpc_character_renderer.svelte`.
- Completely strip the hardcoded procedural graphics routines (`drawLayerShape`, ellipses, rectangles).
- Wire the component to consume actual image paths parsed through the engine's `TextureManager` and `LpcBatchManager` sub-texture structures.
- Implement a rigid grid dimension projection logic block inside the drawing pass:
  $$\text{Source X Offset} = \text{frame} \times 64$$
  $$\text{Source Y Offset} = \text{currentRow} \times 64$$
- Ensure that color alterations passed down via the `recipes` prop map cleanly onto the asset's index lines, modifying rendering outputs in real-time.

### 3. Add Diagnostic Engine State Mapping
- If the browser environment cannot resolve an asset texture file locally, automatically generate a high-visibility $64 \times 64$ placeholder block containing the slot name to keep development workflows stable.

## Acceptance Criteria

### AC-1: Granular Asset Ingestion and Grid Alignment Mapping
- **Given** the upgraded LPC Laboratory page is initialized in a browser window,
- **When** different slots are populated with variants and directional or frame configurations change,
- **Then** the renderer must dynamically adjust source coordinates to cut exactly $64 \times 64$ pixel boxes, altering output postures without visual bleeding or layout drift.

### AC-2: Animated Ticker Playback and Frame-Wrapping Execution
- **Given** an active layer stack displayed inside the laboratory viewport,
- **When** the Animation Ticker state is set to Play,
- **Then** frames must iterate automatically at the selected frame rate, wrapping smoothly at action boundaries (e.g., frame index 9 resetting to 0 during Walk cycles) without heap leakage.

### AC-3: Dynamic Multi-Layer Palette Recolor Interception
- **Given** a composite character instance visible on the workspace canvas,
- **When** individual layer palette hex colors are modified via the panel controls,
- **Then** the updated color mapping values must immediately apply to that specific asset index channel while keeping structural layout dimensions un-affected.

## Test Hooks
- Expose laboratory states to the automated suite: `window.__lpc_lab_play_state`, `window.__lpc_lab_current_frame`, and `window.__lpc_lab_active_slots`.

## Implementation Notes
- Wrap all context layout checks defensively to protect server-side pre-rendering execution limits.
- Force immediate canvas repaints during slider manipulation by setting clear dirty flags inside microtask update boundaries.
