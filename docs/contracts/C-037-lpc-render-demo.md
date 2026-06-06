# Contract: C-037 LPC Render Demo

## Metadata
| Source | Target | Priority | Dependencies | Status | Version |
|--------|--------|----------|--------------|--------|---------|
| Engine Architecture | PWA Dev Tooling | Medium | C-035, C-036 | completed | 1.0.0 |

## Overview
This contract implements an interactive sandbox route (`/dev/lpc-demo`) inside the SvelteKit frontend client workspace to validate the performance metrics of the unified `LpcBatchManager` mega-UBO pipeline. The demo provisions real-time configuration arrays to spawn up to 64 active concurrent bitECS entities with live apparel layer randomization controls, tracking structural fingerprints and update metrics directly on screen.

## Design Reference
- `apps/frontend/pwa/src/lib/components/game/game_canvas.svelte`: Core canvas lifecycle node template.
- `packages/frontend/engine/src/systems/render_system.ts`: `LpcBatchManager` and sync loop hooks.

## Changes Detail
### New Files

#### `apps/frontend/pwa/src/routes/(authenticated)/dev/lpc-demo/+page.svelte`
- Implement an explicit development sandbox viewport container using Svelte 5 structure properties.
- Mount an instance of `pixi_app.ts`, ensuring it invokes `initLpcShaders()` inside its initialization lifecycle hooks.
- Provide interactive controls (sliders, input matrices) to:
  - Spawn individual or batch groups of bitECS entities (up to 64 max slots).
  - Mutate colors/tints or apparel layer combinations across active entity arrays simultaneously.
  - View real-time framework telemetry counters (`structuralHashesIssued`, `batchUpdatesPerformed`, FPS, and frame compile cost latency metrics).

### Modified Files

#### `packages/frontend/engine/src/pixi_app.ts`
- Expose an explicit debug accessor reference returning internal system performance properties and metrics from the active `LpcBatchManager` lifecycle trackers.

## Acceptance Criteria
### AC-1: Sandbox Lifecycle Setup & Viewport Rendering
- **Given** an authenticated client browser navigating to the workspace path `/dev/lpc-demo`.
- **When** the canvas element finishes initialization under the Svelte `$effect` hook profile.
- **Then** a clean PixiJS v8 window context must render, confirming completion of shader compilation without throwing canvas or environment target exceptions.
- *Test Hook*: Validate error-free canvas mounting via browser screenshot debugging.

### AC-2: Telemetry Validation Under Continuous Apparel Mutations
- **Given** 64 concurrently rendered character models running inside the sandbox.
- **When** clicking the "Randomize Apparel" trigger button to force configuration recipe modifications across all nodes.
- **Then** the screen telemetry log must capture incremental value steps within `batchUpdatesPerformed` while proving frame processing speeds stay safely below the 16.6ms standard frame budget.
- *Test Hook*: Evaluate performance counters via `browser_inspect` console evaluations.

## Implementation Notes
1. Create `apps/frontend/pwa/src/routes/(authenticated)/dev/lpc-demo/+page.svelte`.
2. Connect input state bindings directly to engine manipulation methods using standard Svelte 5 reactive arrays.
3. Verify formatting, lint compliance, and strict code ordering layout by invoking the integrated validation wrapper commands.
