# Contract: C-121 Start Menu & Optional Authentication ✅

## Goal
Implement the MVP Start Menu at the root route (`/`) and transition to an optional, offline-first authentication model using Google Sign-In.

## Context
With the heavy SSR routing removed, our root page should act like a traditional game start screen. We are abandoning forced registration/login. The user should be able to click "Start Game" immediately and rely on local/anonymous state. If they want cloud sync later, they can use an optional "Sign In with Google" button.

## Tasks

1. **Create Start Menu View & ViewModel:**
   - Create a new isolated directory: `src/lib/views/start/`.
   - Create `start_view.svelte` and `start_view_model.svelte.ts`.
   - The UI should be a clean, centered menu with the following buttons:
     - **Start Game** (For now, just routes to `/game` or `/setup`)
     - **Sign In with Google** (Changes to "Sign Out" if already authenticated)
     - **Options** (Routes to `/settings`)
     - **Credits** (Routes to a credits page or opens a modal)
     - **Quit** (Only visible/active if running inside Tauri)

2. **Implement Optional Google Auth:**
   - Update or utilize `src/lib/services/auth/auth_service.svelte.ts` (or the relevant Firebase auth wrapper) to support a simple `signInWithGooglePopup()` method.
   - The `StartViewModel` should reactively listen to the user's auth state (`authService.user`).
   - Ensure that if the user does *not* sign in, the game still functions (the `AuthService` should ideally initialize anonymously or just allow null users for local-only play).

3. **Wire up Tauri Quit (Desktop Only):**
   - In the `StartViewModel`, detect if the app is running in Tauri (e.g., checking `window.__TAURI__` or using Tauri's core APIs).
   - If true, the "Quit" button should call `exit(0)` from `@tauri-apps/plugin-process` or `@tauri-apps/api/process`.

4. **Update Root Route:**
   - Replace the placeholder in `src/routes/+page.svelte` to instantiate and render `StartView` with `StartViewModel`.

## Out of Scope
- Do not implement the actual Provider verification block yet (that will be C-122).
- Do not build complex animated backgrounds for the start menu. A static image or simple CSS background is sufficient.
- Do not remove the legacy route constants just yet, unless you actively remove the old views that depend on them.

## Acceptance Criteria
- Navigating to `/` displays the Start Menu.
- Clicking "Sign In with Google" triggers a popup and successfully updates the UI to show the user's logged-in state.
- Clicking "Options" navigates to `/settings`.
- The "Quit" button gracefully closes the app when running via `bun tauri dev`, but is hidden or disabled when viewing in a standard web browser.
- `bun run check` passes with 0 errors.
