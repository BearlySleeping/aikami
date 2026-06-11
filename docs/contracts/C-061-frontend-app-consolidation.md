# Contract: C-061 — Frontend App Consolidation

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-060 |
| Status | not_started |
| Version | 1.0 |

## Overview
To simplify our architecture and unify our state management, we are deprecating the isolated `apps/frontend/game` package and migrating its PixiJS core directly into the SvelteKit `apps/frontend/client` package. The game will now render inside dedicated SvelteKit routes, allowing us to easily overlay Svelte UI components (like dialogue and HUDs) directly over the WebGL canvas while sharing the exact same `$state` primitives.

## Design Reference
- SvelteKit documentation on disabling SSR (`export const ssr = false;` in `+page.ts` files).
- Existing PixiJS v8 integration within Svelte components using `onMount`.

## Architecture Directives
- **Code Migration**: Move all game-specific source code from `apps/frontend/game/src/lib/` to `apps/frontend/client/src/lib/client/game/`.
- **Import Resolution**: Refactor all relative imports in the migrated files to use the PWA's `$lib` aliases.
- **Route Integration**: Create the necessary SvelteKit routes to host the game canvas. We need a `(dev)/dev/sandbox` route for isolated engine testing and update the main `(authenticated)/game` route for the actual player experience.
- **SSR Safety**: PixiJS relies on DOM APIs (`window`, `document`) that do not exist during Server-Side Rendering. You must ensure the game engine only instantiates on the client by disabling SSR on the game routes and booting the Pixi application inside an `onMount` lifecycle hook.
- **Workspace Cleanup**: Completely remove the `apps/frontend/game` package from the repository and detach it from the Moonrepo workspace configuration.

## State & Data Models
No new data models are introduced, but SvelteKit route configuration requires specific exports to ensure client-side only execution.

In the `+page.ts` for the game routes:

    export const ssr = false;
    export const prerender = false;

In the `+page.svelte` component holding the canvas:

    import { onMount, onDestroy } from 'svelte';
    
    let canvasContainer: HTMLElement;
    
    onMount(async () => {
        // Initialize Pixi application and append to canvasContainer
    });
    
    onDestroy(() => {
        // Destroy Pixi application to prevent WebGL memory leaks
    });

## Acceptance Criteria

- **AC1: Code Relocation & Import Fixing**
  - Given the `apps/frontend/game` directory
  - When the migration script/manual move is complete
  - Then all game logic resides in `apps/frontend/client/src/lib/client/game/` and all imports correctly resolve via `$lib/client/game/...` without TypeScript errors.
  - Test Hook: Run `bun run typecheck` inside the PWA package to ensure 0 errors.

- **AC2: SvelteKit SSR Enforcement**
  - Given the new game routes (`/dev/sandbox` and `/game`)
  - When the SvelteKit server attempts to render them
  - Then SSR is explicitly bypassed, preventing `window is not defined` crashes.
  - Test Hook: Assert the presence of `export const ssr = false;` in the associated `+page.ts` files.

- **AC3: PixiJS Lifecycle Hooking**
  - Given the Svelte component hosting the game canvas
  - When the component mounts and unmounts
  - Then the PixiJS application correctly instantiates on mount and cleanly calls `.destroy(true, true)` on unmount to free VRAM.
  - Test Hook: Render the component in a test environment, unmount it, and assert the mock Pixi application's destroy method was called.

- **AC4: Workspace Deprecation**
  - Given the Moonrepo workspace configuration (`.moon/workspace.yml`)
  - When the consolidation is complete
  - Then `apps/frontend/game` is physically deleted from the file system and completely removed from the workspace configuration.
  - Test Hook: Run `moon project client` to ensure the workspace graph remains valid and does not reference the deleted project.

## Implementation Notes
1. Start by moving the code from `apps/frontend/game/src/lib` to `apps/frontend/client/src/lib/client/game`.
2. Do a mass search-and-replace for imports if necessary to align with the SvelteKit `$lib` structure.
3. Move the tests over as well and ensure they run under the PWA's test runner.
4. Set up the `+page.ts` and `+page.svelte` wrappers for `/dev/sandbox` and `/game` (you may need to replace the existing `/game` placeholder).
5. Ensure the PixiJS `onMount` and `onDestroy` lifecycle methods are strictly observed so we don't leak WebGPU contexts during route navigation.
6. Finally, delete the old `apps/frontend/game` folder and remove it from `.moon/workspace.yml`.

## Edge Cases & Gotchas
- **Static Assets**: If the game package had static assets (like placeholder sprites or tilesets) in its `public` or `static` folder, those MUST be moved to the PWA's `static` directory so PixiJS can fetch them.
- **Vite Config Conflicts**: Ensure any special Vite configurations from the game package (e.g., specific asset loaders or WebGPU flags) are ported over to the PWA's `vite.config.ts` if they don't already exist.
