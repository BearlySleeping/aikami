# Contract: C-126 Headless App Shell & Initialization

## Goal
Resolve the `RouterService not initialized` error by implementing a headless `AppShell` at the root layout. This shell will silently initialize core services (Router, Auth, Config) without wrapping the application in unnecessary UI layers like navigation drawers or app bars.

## Context
During the SPA routing simplification (C-119), the root `+layout.svelte` was stripped down to a bare `{@render children()}`. This bypassed the initialization logic previously handled by `AppView` and `AppViewModel`. Because we want the `/game` route to remain a pure fullscreen canvas without inherited UI bloat, we need to refactor `AppViewModel` into a purely logical, UI-less bootstrapper.

## Tasks

1. **Refactor `AppViewModel` (Logic Only):**
   - Strip out all UI-specific state from `src/lib/views/app/app_view_model.svelte.ts` (e.g., `isNavigationDrawerMinified`, `showAppBar`, `isFullscreen`).
   - Retain the core initialization sequence: `$effect` or `onMount` logic that calls `routerService.init()`, `authService` listeners, and global app config checks.
   - Clean up the routing rules (remove legacy `login`/`register` redirects if they no longer apply, or adjust them for the new offline-first flow).

2. **Create the Headless `AppShell` View:**
   - Refactor `src/lib/views/app/app_view.svelte` to serve as a logical wrapper.
   - Remove the HTML structure (headers, footers, drawers).
   - It should strictly instantiate the updated `AppViewModel` and render its children, perhaps wrapping them in a single generic `div` if absolutely necessary for context providers, but otherwise keeping the DOM flat:
     ```svelte
     <script lang="ts">
       import { getAppViewModel } from './app_view_model.svelte';
       let { children } = $props();
       const vm = getAppViewModel({...});
     </script>
     {@render children()}
     ```

3. **Wire the Root Layout:**
   - Update `src/routes/+layout.svelte` to import and wrap the application in the new `AppShell`:
     ```svelte
     <script lang="ts">
       import AppShell from '$lib/views/app/app_view.svelte';
       let { children } = $props();
     </script>
     <AppShell>
       {@render children()}
     </AppShell>
     ```

4. **Isolate Settings UI (Optional Prep):**
   - Create `src/routes/settings/+layout.svelte`.
   - If the old `AppView` had a navigation drawer that is still needed for the settings/config pages, move that UI layout code here so it only applies to the `/settings` sub-routes.

## Out of Scope
- Rebuilding the actual settings UI components.
- Fixing downstream UI bugs caused by the removal of the old global CSS framework (just ensure the game and start menus still render).

## Acceptance Criteria
- Navigating to `/` or `/game` no longer throws the `RouterService not initialized` error.
- The `AppViewModel` successfully executes its boot sequence and SvelteKit routing works correctly.
- The DOM on the `/game` route contains no leftover navigation drawers, app bars, or padding elements.
- Typecheck and tests pass.
