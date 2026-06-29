<!-- completed: 2026-06-29 -->
# Contract: C-074 — LPC Screenshot Isolation and Element Bounding Box Target

## Metadata

- Source: Client Frontend Component Quality Audit
- Target: apps/e2e
- Priority: P1 (Foundation Automation)
- Dependencies: C-073
- Status: not_started
- Contract Version: 1.0.0

## Overview

The existing LPC visual smoke runner captures full-viewport layouts, inadvertently bundling the user interface control sidebars, slider decks, and debugging tables into the analysis frame. This contract modifies the Playwright capture orchestration layer to target the specific PixiJS canvas locator element bounding box directly. It applies an isolated element-level capture combined with a high-ratio query zoom scale to maximize the screen space of the target equipment recipes.

## Design Reference

- `apps/e2e/tests/client/lpc_visual.spec.ts`: The unified visual suite holding the parameterized canvas route loops.
- `apps/frontend/client/src/routes/(dev)/dev/lpc/component-lite/+page.svelte`: Isolated, zero-chrome rendering route group using symmetrically centered anchors.

## Architecture Directives

- **Element-Targeted Capture Loop**: Update the Playwright test specification assertions to drop raw `page.screenshot()` calls in favor of locator-specific node element snapshots.
- **Dynamic Scale Maximization**: Enforce a rigid structural query parameter chain that sets the rendering camera zoom profile directly through the serialization setup utility.

## State & Data Models

No changes to our underlying repository schemas. The target interaction flow maps explicitly to the browser context viewport configuration properties:

    interface PlaywrightCaptureOptions {
        elementSelector: "#game-canvas" | "[data-testid='lpc-render-container']";
        path: string;
        omitBackground: boolean;
        scale: "css" | "device";
    }

## Acceptance Criteria

### AC-1: Bounding Box Locator Isolation

- Given the unified `apps/e2e` test environment is processing an LPC rendering recipe sequence
- When the runner executes the snapshot loop step
- Then it must resolve the targeted element locator string (e.g., `page.locator('#game-canvas')` or its primitive container) and execute `.screenshot()` directly on that element.
- Test Hook: Verification that generated images strictly clip out all DaisyUI panels, text dropdown selections, and telemetry sliders, matching a clean square layout frame.

### AC-2: Symmetric Component Zoom Expansion

- Given a parameterized component route request string
- When the URL parameters specify an amplified testing zoom factor (e.g., `&zoom=6`)
- Then the underlying PixiJS application canvas view sizing must scale up symmetrically from the asset frame anchor bounds without clipping coordinates or suffering lower-right canvas drifting artifacts.
- Test Hook: Images generated show high-visibility magnification of individual layer segments (e.g., fingers, weapon edges) filling at least 80% of the graphic frame bounds.

### AC-3: Error Element Style Blinding

- Given an unexpected rendering warnings overlay or layout flash during browser boot
- When the capture loop processes execution frames
- Then the browser must inject an authoritative style mask (e.g., `.vite-error-overlay, #tailwind-indicator { display: none !important; }`) prior to element target sizing to prevent pointer block overlaps.
- Test Hook: Continuous generation verification under mock runtime errors to confirm formatting bars never pollute the captured graphic.

## Implementation Notes

1. Open `apps/e2e/tests/client/lpc_visual.spec.ts` (or the core visual suite).
2. Locate the line performing `page.screenshot({ path: ... })`.
3. Refactor this signature to locate the specific canvas wrapper reference:

    ```typescript
    await page.locator('#game-canvas').screenshot({ path, omitBackground: true });

     Update the test data mapping config to automatically inject a scale query parameter &zoom=6 or zoom=8 into every isolation endpoint loop request string to fill up the bounding frame.
    ```

Edge Cases & Gotchas

    Zero Sizing Canvas Collapse: Capturing an element screenshot on a canvas whose width and height parameters default to flexible reactive definitions can force a 0x0 element layout computation. Ensure the rendering canvas container enforces a rigid, non-zero static pixel box constraint (e.g., 64x64 base scaled cleanly up to the targeted output size) during headless testing.
