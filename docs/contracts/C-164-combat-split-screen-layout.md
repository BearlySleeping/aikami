## Metadata

| Field | Value |
|---|---|
| **Source** | Architect UX Polish |
| **Target** | `apps/frontend/client/src/lib/views/combat/` — Core Layout & Action Bar |
| **Priority** | P0 — Foundation for the new combat UX |
| **Dependencies** | C-145 |
| **Status** | ✅ completed |
| **Contract version** | 1.0.0 |

## Overview

We are tearing down the floating combat modal and replacing it with a dedicated, full-viewport split-screen architecture (35% Left Svelte UI / 65% Right PixiJS Canvas). The left pane will act as the "DM Screen," housing the scrollable narrative log and bottom-anchored action controls.

## Design Reference

Refer to modern CRPG split-view dialogue/combat interfaces (e.g., Disco Elysium's dialogue pane, or BG3's combat log).

## Architecture Directives

- **CSS Grid Layout**: Refactor the main `game_view.svelte` (or the parent container handling overlays) to transition into a `display: grid; grid-template-columns: 35vw 1fr;` layout when `gameState.mode === 'COMBAT'`.
- **Canvas Resizing**: Ensure the PixiJS canvas container dynamically resizes to fill the remaining 65% of the viewport. The engine's resize observer must trigger immediately to prevent stretching.
- **The Left Pane**: Create `combat_sidebar.svelte`. It must feature a flex column layout: 
  - Top: Header/Tabs (Log | Gallery).
  - Middle: `flex-grow: 1; overflow-y: auto;` for the narrative combat log.
  - Bottom: Fixed Action Bar containing "Attack", "Defend", "Flee", and the custom action text input.

## State & Data Models

    // No major data model changes, primarily CSS/DOM structural refactoring.
    // Ensure `gameStateService.mode` accurately triggers the layout shift.

## Acceptance Criteria

### AC-1: Split-Screen Transition
**Given** the player is in the EXPLORE state (full-screen canvas)
**When** combat is triggered
**Then** the screen smoothly splits, with the Svelte UI occupying the left 35% and the PixiJS canvas instantly resizing to occupy the right 65% without aspect ratio distortion.

### AC-2: Fixed Action Bar
**Given** the combat sidebar is open
**When** the combat log fills with text and scrolls
**Then** the action buttons and custom text input remain permanently anchored to the bottom of the left pane.

**Test Hooks**:
- Visual/E2E: Assert that the bounding box of the `#game-canvas` changes width upon entering combat, and that `.combat-action-bar` is visible at the bottom of the screen regardless of log scroll position.

## Implementation Notes

1. **Files to modify**: 
    - `apps/frontend/client/src/lib/views/game/canvas/game_view.svelte`
    - `apps/frontend/client/src/lib/views/combat/combat_overlay.svelte` (Refactor to `combat_sidebar.svelte`)
2. **Order of operations**: 
    - Implement the CSS grid state toggle based on game mode.
    - Wire the PixiJS resize observer to handle the sudden viewport change.
    - Migrate existing combat controls into the new Left Pane layout.

## Edge Cases & Gotchas

- **Canvas Resize Jitter**: Ensure `pixi_app.resize()` is called synchronously when the CSS grid transition finishes so the engine doesn't render blurry or stretched pixels.
