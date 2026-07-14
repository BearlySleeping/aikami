<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-130 In-Game AI Diagnostics & Onboarding

## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory — C-122 Onboarding & Provider Gate UX refinement |
| **Target** | `apps/frontend/client/src/lib/views/app/boot/` |
| **Priority** | P1 — Gates game entry on AI service health |
| **Dependencies** | C-122, C-126 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Goal
Replace the placeholder "Missing Providers" screen with an immersive, retro-terminal "Boot Diagnostics" dashboard. This view will ping the local AI providers (Ollama and ComfyUI) and gate entry to the game loop until the required offline environment is running. 

## Tech Stack
- **Framework:** Svelte 5 (Runes: `$state`, `$derived`, `$effect`)
- **Architecture:** MVVM 
- **Networking:** Tauri v2 HTTP Plugin (`@tauri-apps/plugin-http`) to bypass strict browser CORS policies when pinging `localhost`.

---

## Task 1: Create the Diagnostics ViewModel
**File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.svelte.ts`
- Create a `BootDiagnosticsViewModel` class extending `BaseViewModel`.
- **State (`$state`):**
  - `ollamaStatus: 'pending' | 'online' | 'offline'`
  - `comfyStatus: 'pending' | 'online' | 'offline'`
- **Derived State (`$derived`):**
  - `canBoot: boolean` (true if both are 'online')
- **Actions:**
  - `async checkProviders()`: 
    - Use the Tauri HTTP client (`fetch` from `@tauri-apps/plugin-http`) to ping `http://localhost:11434/` (Ollama) and `http://localhost:8188/system_stats` (ComfyUI).
    - Wrap in `try/catch` blocks. Set state to `online` on a `200 OK` response, otherwise `offline`.
  - `startPolling()`: Set up a `setInterval` to call `checkProviders()` every 3 seconds while on this screen, clearing the interval on destroy.

## Task 2: Build the Diagnostics View (Svelte 5)
**File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view.svelte`
- Instantiate `BootDiagnosticsViewModel`. Use a `$effect` rune to call `viewModel.startPolling()` on mount and return a cleanup function to stop polling.
- **UI Requirements:**
  - Style as an immersive, in-universe computer terminal using DaisyUI components and Aikami's design tokens.
  - Display two distinct status rows (Text AI / Image AI) with reactive red/green indicator dots mapping to `ollamaStatus` and `comfyStatus`.
  - If a service is `offline`, display clear, inline instructions (e.g., "Awaiting connection... Please launch Ollama via your system tray").
  - A primary "Initialize Core" button bound to the `canBoot` state. If disabled, show a tooltip explaining that providers are missing.

## Task 3: Integrate with App Router / Main View
**File:** `apps/frontend/client/src/lib/views/app/app_view.svelte` (or relevant router container)
- Update the mounting logic to render `boot_diagnostics_view.svelte` as the initial gatekeeper.
- Pass an `onBootComplete` callback to the diagnostics view. Once the player clicks the enabled "Initialize Core" button, this callback should trigger the unmounting of the diagnostics screen and the mounting of the main `game_canvas.svelte`.

## Task 4: Unit & Visual Testing
- **File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.test.ts`
  - Write Vitest tests for the ViewModel. Mock the Tauri `fetch` plugin to simulate online/offline responses and verify state transitions and `canBoot` logic.
- **File:** `apps/e2e/tests/client/boot_diagnostics_visual.spec.ts`
  - Create a Playwright visual regression test mocking the endpoints to force the "Both Online" and "Both Offline" states. Take golden snapshots of both variants.

## Acceptance Criteria
- [ ] ViewModel successfully uses Tauri HTTP client to bypass CORS and ping ports `11434` and `8188`.
- [ ] UI is fully reactive using Svelte 5 runes (`$state` / `$derived`).
- [ ] Polling automatically updates the UI from Red to Green if a user starts Ollama/ComfyUI while the screen is open.
- [ ] Player cannot transition to the PixiJS canvas until `canBoot` is true.
- [ ] Unit tests and Visual Regression tests pass.
