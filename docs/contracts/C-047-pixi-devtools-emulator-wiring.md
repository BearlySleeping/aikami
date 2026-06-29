# Contract — C-047 Pixi DevTools Emulator Wiring

## Metadata

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| Source       | Environment Audit / Sidebar Diagnostics Stall     |
| Target       | Client Rendering Layer / Engine Initialization Setup |
| Priority     | P1                                                |
| Dependencies | C-013, C-035, C-042, C-046                        |
| Status       | completed                                          |
| Version      | 1.0.0                                             |

## Overview

This contract wires the official PixiJS DevTools bridge hooks directly into the frontend canvas execution loops. It limits this instrumentation window to local developer modes and running emulator sessions (`EMULATOR / locall`). This wiring connects the underlying scene graph hierarchy, component structures, and dirty slot state boundaries to the browser extension interface without injecting analytical overhead or debug hooks into production build scripts.

## Design Reference

- `packages/frontend/engine/src/pixi_app.ts`: Coordinates engine boot steps, viewport mounts, and base asset array caching.
- `packages/frontend/configs/src/lib/environment.ts`: Houses runtime parameters and flags (`isLocal`, `useEmulators`).
- PixiJS Extension Integration Paradigm: Programmatic attachments using the `window.__PIXI_DEVTOOLS__` global layout bridge.

## Changes Detail

### 1. Modify `packages/frontend/engine/src/pixi_app.ts`

Integrate conditional diagnostic initialization hooks into the application creation loop:

- Line 1 File path comment: `// packages/frontend/engine/src/pixi_app.ts`.
- Locate the primary asynchronous application creator function (`createPixiApp`).
- Import the active environment parsing flags from the shared configuration package (`@aikami/frontend/configs`).
- Right after the `app.init()` initialization step completes successfully, add a conditional check to flag local or emulator-backed tracking spaces:
    ```typescript
    // Verify configuration boundaries match local or emulator environments
    if (
    	import.meta.env.DEV ||
    	environment.useEmulators ||
    	environment.isLocal
    ) {
    	// Inject global pointers safely into window scopes for DevTools interception
    	(window as any).__PIXI_DEVTOOLS__ = {
    		app: app,
    		stage: app.stage,
    		renderer: app.renderer,
    	};

    	// Provide a legacy backup locator hook for backwards tracking safety
    	(window as any).__PIXI_APP__ = app;
    }
    ```

2. Clean Up Component Fallback Listeners

    Ensure that the visual canvas updates (\_drawCrosshairGrid, drawLayerShape) bind an immediate dirty loop check inside updating $effect microtasks, causing immediate repaints whenever panel configurations mutate.

Acceptance Criteria
AC-1: Environment-Locked Extension Bridge Initialization

    Given an engine instance starting up inside a local test session or an emulator window,

    When the createPixiApp pipeline executes its initialization hooks,

    Then it must expose window.__PIXI_DEVTOOLS__ with direct references to the active application parameters.

AC-2: Production Environment Leak Protection

    Given a production compilation build pipeline running via Moon orchestration tasks,

    When the bundling system compiles optimization paths,

    Then the global devtools tracking hooks must be stripped or guarded by compiler constants to prevent debugging leakage.

Edge Cases & Gotchas

    Asynchronous Inspection Races: If the extension panel initializes before the app.init() promise finishes resolving, the global window parameters may read as undefined. Explicitly update the devtools pointers immediately upon resolution inside browser microtask blocks to ensure consistent discovery.
