<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Visual Sandbox Debugging Validation |
| **Target** | `apps/e2e/tests/game/map_rendering_visual.spec.ts`, `apps/e2e/tests/game/collision_e2e.spec.ts`, `packages/frontend/engine/src/__tests__/spatial_grid.test.ts` |
| **Priority** | P0 — Locks in engine stability via strict visual and behavioral automated testing |
| **Dependencies** | C-178, C-179 |
| **Status** | **completed**  |
| **Contract version** | 1.0.0 |

## Overview

With the Data-Oriented engine rewrite complete, we must secure it against future regressions. This contract implements strict boundary unit tests for the Spatial Hash Grid, sets up pixel-perfect visual regression snapshots using Playwright for the WebGPU/WebGL2 chunk renderer, and implements end-to-end keyboard simulation tests to guarantee collision bitmasks operate correctly in the live browser environment.

## Design Reference

Follow the Playwright testing patterns defined in `docs/guides/PLAYWRIGHT.md` and `apps/e2e/tests/client/sandbox_visual.spec.ts`.

## Architecture Directives

1. **Unit Test Grid Boundaries**: Update or create `spatial_grid.test.ts` to explicitly test moving entities outside `0` and `MAP_WIDTH`/`MAP_HEIGHT`. Assert that the arrays do not throw out-of-bounds exceptions and that `MoveIntent` is safely zeroed.
2. **Visual Regression Snapshot**: Update `map_rendering_visual.spec.ts` to navigate to `/dev/sandbox/map`, wait for `GAME_READY` / network idle, and assert `expect(canvas).toHaveScreenshot('debug-map-baseline.png')`.
3. **E2E Collision Playwright Test**: Create `collision_e2e.spec.ts`. 
   - Load the debug sandbox.
   - Dispatch `ArrowRight` or `w`/`a`/`s`/`d` keyboard events to move the player into the grey wall at `(2,2)` or `(4,2)`.
   - Read the player's coordinate from the DOM debug overlay (or window variable expose).
   - Assert the coordinate has clamped and the player did not pass through the wall.

## State & Data Models

```typescript
// Conceptual E2E Test Flow
test('Player respects collision bitmasks', async ({ page }) => {
    await page.goto('/dev/sandbox/map');
    await page.waitForSelector('canvas');
    
    // Move into the wall
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(500); // let the ECS tick
    await page.keyboard.up('ArrowUp');

    // Assert using your exposed debug UI or window.__ENGINE__
    const playerY = await page.evaluate(() => window.debug_player_y);
    expect(playerY).toBeGreaterThanOrEqual(WALL_Y_BOUNDARY); 
});

```

## Scope Boundaries

* **In Scope:** - Unit tests for spatial bounds clamping.
* Visual regression testing of `debug_map.jton`.
* Keyboard E2E testing for wall collisions and map boundaries.


* **Out of Scope:** - Testing complex AI pathfinding.
* Creating new maps or visual assets.



## Acceptance Criteria

### AC-1: Strict Boundary Unit Testing

**Given** an entity at the edge of the map `(0, y)`
**When** a `MoveIntent` of `dx: -1` is processed by the `CollisionSystem`
**Then** the intent is zeroed out, the `GridPosition` remains `0`, and no typed array out-of-bounds errors occur.

**Test Hooks**:

* Unit: Run `bun run moon run engine:test` to validate the boundary assertions.

### AC-2: WebGPU Visual Consistency

**Given** the Playwright test runner executing against the dev server
**When** it evaluates the `/dev/sandbox/map` route
**Then** it captures a screenshot of the canvas that matches `debug-map-baseline.png` within a 1% pixel variance threshold.

**Test Hooks**:

* E2E / Visual: Run `bun run moon run e2e:test -- -g "map_rendering_visual"`.

### AC-3: End-to-End Collision Enforcement

**Given** the Playwright test runner in the map sandbox
**When** keyboard inputs attempt to drive the player through the grey collision blocks
**Then** the test runner verifies via DOM state or window variables that the player's position was clamped by the ECS bitmask logic.

**Test Hooks**:

* Integration: Run `bun run moon run e2e:test -- -g "collision_e2e"`.

## Implementation Sequence

1. **Phase 1 (Unit)**: Harden the `collision_system.ts` tests for map edge boundaries (`< 0` and `>= MAX`).
2. **Phase 2 (Visual)**: Configure the Playwright screenshot test. *Note: You may need to run Playwright with `--update-snapshots` on the first pass to generate the baseline image.*
3. **Phase 3 (Behavioral E2E)**: Implement the keyboard testing. If the player's exact X/Y isn't currently exposed to the DOM for Playwright to read, temporarily expose it via a debug HTML element or attach it to `window.__AIKAMI_DEBUG__` in `game_view_model.svelte.ts`.
