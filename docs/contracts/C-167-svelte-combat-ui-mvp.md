<!-- completed: 2026-06-29 -->
# Contract: C-167 Svelte Native Combat UI MVP

| Field | Value |
| --- | --- |
| Source | Architect |
| Target | apps/frontend/client/src/lib/views/combat/, apps/e2e/tests/client/ |
| Priority | High |
| Dependencies | None |
| Status | completed |
| Contract version | 1.0 |

## Overview
Pivot the combat system MVP away from PixiJS/WebGL rendering to a pure SvelteKit DOM-based UI. We are replacing the dynamic sprite canvas with static, high-resolution character portraits positioned on the left (player) and right (enemy). This contract also establishes rigorous Playwright end-to-end and visual regression tests for the new, stable DOM structure.

## Design Reference
- Existing SvelteKit layout patterns in `apps/frontend/client/src/lib/views/`.
- Playwright visual testing conventions in `apps/e2e/tests/client/`.
- Persona-style or visual novel dialogue layouts (large bust portraits, clean UI panels).

## Architecture Directives
- **Rip and Replace:** Completely remove `game_canvas.svelte` (or equivalent PixiJS mounting components) from the `combat_view.svelte` hierarchy. 
- **Portrait Stage:** Implement a new layout (e.g., `combat_portrait_stage.svelte`) using standard CSS Grid/Flexbox. 
- **Visual Feedback:** Use standard CSS transitions/animations for combat feedback (e.g., a brief CSS transform shake on hit, a CSS filter flash for damage).
- **Testing Infrastructure:** Because we are back in standard DOM land, leverage Playwright's visual comparison extensively. Create dedicated tests that mock the combat state and screenshot the pure UI.

## State & Data Models
    interface CombatantDisplayState {
        id: string;
        name: string;
        portraitUrl: string;
        currentHealth: number;
        maxHealth: number;
        isTakingDamage: boolean;
        isActiveTurn: boolean;
    }

    interface CombatStageState {
        player: CombatantDisplayState;
        enemy: CombatantDisplayState;
        combatLog: string[];
    }

## Acceptance Criteria

- **AC1: Pure DOM Rendering**
  - **Given** the user enters a combat sequence
  - **When** the combat view mounts
  - **Then** the UI renders using standard HTML/CSS portraits without initializing a PixiJS Application or `<canvas>` element.
  - *Test Hook:* `[data-testid="combat-portrait-stage"]` must be visible, `canvas` must not exist in this view.

- **AC2: Responsive Portrait Layout**
  - **Given** the combat stage is active
  - **When** viewed on desktop and mobile viewports
  - **Then** the player portrait anchors left, the enemy anchors right, and they scale properly using `object-fit` without breaking the layout.
  - *Test Hook:* Playwright visual test covering mobile and desktop viewport sizes.

- **AC3: CSS Combat Feedback**
  - **Given** the enemy attacks the player
  - **When** the player's `isTakingDamage` state becomes true
  - **Then** a CSS animation triggers (e.g., a shake or red flash) on the player portrait container.
  - *Test Hook:* E2E test verifying that the `.damage-flash` (or equivalent) CSS class is temporarily applied during the hit state.

- **AC4: Visual Regression Stability**
  - **Given** the newly implemented static combat UI
  - **When** the e2e visual test suite runs
  - **Then** it captures and compares screenshots of the idle state, ensuring 100% match with the baseline (no rendering flakiness).

## Implementation Notes
1. Navigate to `apps/frontend/client/src/lib/views/combat/` and remove the PixiJS canvas dependency.
2. Create the `combat_portrait_stage.svelte` component. Use temporary placeholder image URLs if the high-res assets aren't in the public folder yet (e.g., grab a static happy/angry image from the `apps/backend/firebase/assets/images/npc/` stash to serve as mocks).
3. Wire up the existing combat view model to feed data into the new portrait stage instead of the old ECS/Pixi bridge.
4. Add simple CSS `@keyframes` for a damage shake and wire it to a reactive class toggle.
5. Create `apps/e2e/tests/client/combat_static_visual.spec.ts`. Mock the state so the player and enemy are loaded, then assert the layout and take a baseline screenshot using Playwright's `expect(page).toHaveScreenshot()`.

## Edge Cases & Gotchas
- **Image Aspect Ratios:** Mismatched image sizes can break the flex layout. Enforce strict aspect ratios and use `object-fit: contain` or `cover` on the portrait wrappers.
- **Preloading:** Static images might pop in late. Ensure the images are either preloaded or have a sensible skeleton/fallback background color before the portrait loads.
- **E2E Flakiness:** CSS animations can cause visual tests to fail if they run while an animation is playing. Ensure the visual tests explicitly disable animations or wait for the idle state before taking screenshots.
