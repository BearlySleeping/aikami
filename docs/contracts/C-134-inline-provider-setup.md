# Contract: C-134 Inline Provider Setup & Routing Fix

## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory — C-133 provider onboarding UX gap |
| **Target** | `apps/frontend/client/src/lib/views/app/boot/`, `apps/frontend/client/src/lib/views/app/app_view.svelte` |
| **Priority** | P2 — Quality of life UX improvement |
| **Dependencies** | C-133 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Goal
Add an inline API key input directly on the Boot Diagnostics screen when a cloud provider (OpenRouter) is selected. Additionally, fix the global App View gatekeeper so that it does not block navigation to the `/settings` route.

## Tech Stack
- **Framework:** Svelte 5 (Runes: `$state`, `$derived`, `$effect`)
- **Routing:** SvelteKit (`$app/stores` for page state)

---

## Task 1: Inline API Key ViewModel Logic
**File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.svelte.ts`
- **Add State:**
  - `tempOpenRouterKey: string = ''` (to bind to the new input field).
- **Add Action:**
  - `async saveOpenRouterKey()`: 
    - Writes `this.tempOpenRouterKey` to the application's `ConfigService` (or localStorage, depending on where the settings are stored).
    - Clears `tempOpenRouterKey`.
    - Immediately calls `this.checkProviders()` to re-verify and turn the status indicator green.

## Task 2: Update the Boot Diagnostics View UI
**File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view.svelte`
- Inside the **Text AI** card, locate the block that renders when `activeTextProvider === 'openrouter'` and `textStatus === 'unconfigured'` (or 'offline').
- Replace the "Please configure your OpenRouter API key in Settings" text with an inline input form:
  - Add a Svelte binded input: `<input type="password" bind:value={viewModel.tempOpenRouterKey} placeholder="sk-or-v1-..." class="input input-bordered input-sm w-full max-w-xs font-mono" />`
  - Add a save button next to it: `<button onclick={() => viewModel.saveOpenRouterKey()} class="btn btn-primary btn-sm">Save Key</button>`
- Ensure it uses existing DaisyUI classes to match the retro-terminal aesthetic.

## Task 3: Fix the Global Routing Gate
**File:** `apps/frontend/client/src/lib/views/app/app_view.svelte` (or `src/routes/+layout.svelte` where the gate is implemented)
- Import SvelteKit's page store: `import { page } from '$app/stores';`
- Update the rendering condition. Instead of just checking `if (showBootDiagnostics)`, it should be:
  - `if (showBootDiagnostics && !$page.url.pathname.startsWith('/settings'))`
- This ensures that if the user explicitly navigates to `/settings` (via URL or sidebar), the boot gate drops away and allows the settings view to mount.

## Task 4: Unit Testing
- **File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.test.ts`
  - Add a test verifying `saveOpenRouterKey` updates the config and triggers a provider check.

## Acceptance Criteria
- [ ] Users can paste and save their OpenRouter API key directly on the Boot Diagnostics screen.
- [ ] Saving a valid key immediately updates the Text AI status to `ONLINE`.
- [ ] Users can manually navigate to `/settings` without being trapped by the Boot Diagnostics gate.
- [ ] Unit tests pass.
