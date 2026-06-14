# Contract: C-119 Routing and Layout Simplification

## Goal
Transition the SvelteKit routing architecture from an SSR/Auth-guarded paradigm to a flat, SPA-friendly, offline-first structure. This serves as the foundation for the new MVP.

## Context
Previously, routes were nested inside `(authenticated)`, `(unauthenticated)`, and `(public)` to handle server-side redirects and layouts based on user authentication state. We are pivoting to an offline-first SPA running in Tauri. Navigation should be simple, and fullscreen game states (like Combat/Trading) will be handled via ECS state-driven UI overlays rather than route navigation.

## Tasks

1. **Delete Legacy Route Groups:**
   - Remove the `apps/frontend/client/src/routes/(authenticated)` directory and all its contents completely.
   - Remove the `apps/frontend/client/src/routes/(unauthenticated)` directory (including `login` and `register`) and all its contents.
   - Remove the `apps/frontend/client/src/routes/(public)` directory (including `about` and `auth/game`) and all its contents.
   - *Note: Leave `(dev)` exactly as it is for now.*

2. **Establish the Root SPA Layout (`src/routes/+layout.svelte`):**
   - Ensure the root layout initializes global app providers (like `ConfigService`, `AiSettings`, etc.) but *does not* block rendering based on authentication.
   - Ensure the `+layout.ts` has `export const ssr = false;` and `export const prerender = true;` to enforce SPA behavior.

3. **Create the Core MVP Routes (Placeholders):**
   - **Start Menu:** Create `apps/frontend/client/src/routes/+page.svelte`. Just put a simple placeholder heading `<h1>Start Menu</h1>` for now.
   - **Settings:** Create `apps/frontend/client/src/routes/settings/+page.svelte`. Placeholder: `<h1>Settings</h1>`.
   - **Setup:** Create `apps/frontend/client/src/routes/setup/+page.svelte`. Placeholder: `<h1>Character & World Creation</h1>`.
   - **Game:** Create `apps/frontend/client/src/routes/game/+page.svelte`. Placeholder: `<h1>Fullscreen Game Canvas</h1>`. Ensure this route does not inherit a layout that adds padding/margins, as it needs to be edge-to-edge.

4. **Cleanup Unused Constants/Utils:**
   - Review `src/lib/constants/routes.ts` and remove any references to deleted routes (e.g., `LOGIN`, `REGISTER`, `DASHBOARD`).

## Out of Scope
- Do not implement the actual complex Svelte UI components or ViewModels for the Start Menu, Settings, or Game in this contract. Just establish the skeletons and the routing logic.
- Do not refactor the `src/lib/views/...` directory yet (this is C-120).

## Acceptance Criteria
- Running `bun dev` boots the app without errors.
- Navigating to `/`, `/settings`, `/setup`, and `/game` shows the placeholder texts.
- There are no 404s for the expected base routes.
- The `login` and `register` routes are completely gone and inaccessible.
