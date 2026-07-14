<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-133 Flexible AI Provider Onboarding

## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory — C-130 Boot Diagnostics UX refinement |
| **Target** | `apps/frontend/client/src/lib/views/app/boot/` |
| **Priority** | P1 — Removes strict dual-local AI requirement for broader hardware support |
| **Dependencies** | C-130 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Goal

Refactor the Boot Diagnostics screen introduced in C-130. Remove the strict dual-local requirement. The game must only enforce a **Text Provider** (Local Ollama OR Cloud OpenRouter) to boot. Image and Voice providers should be made optional and gracefully degrade if missing, allowing players with lower-end PCs to still play the game using hybrid or text-only setups.

## Tech Stack

- **Framework:** Svelte 5 (Runes: `$state`, `$derived`, `$effect`)
- **State Management:** MVVM (Refactoring `BootDiagnosticsViewModel`)

---

## Task 1: Refactor Diagnostics ViewModel

**File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.svelte.ts`

- **Update State (`$state`):**
    - Track active configurations: `activeTextProvider: 'ollama' | 'openrouter'`, `activeImageProvider: 'comfyui' | 'cloud' | 'none'`.
    - Track statuses: `textStatus: 'pending' | 'online' | 'offline' | 'unconfigured'`, `imageStatus: 'pending' | 'online' | 'offline' | 'disabled'`.
    - Note: Voice relies on the native WebGPU Kokoro worker (from C-131), so it defaults to `online` (browser native) unless explicitly disabled or falling back to cloud.
- **Update Logic:**
    - `checkProviders()` should conditionally ping endpoints based on the `active` providers. If `openrouter` is selected, verify an API key exists in `ConfigService` (or local storage).
- **Update Gate (`$derived`):**
    - Change `canBoot` to evaluate to `true` **strictly** based on `textStatus === 'online'`. Image and Voice statuses should no longer block the boot process.

## Task 2: Refactor Diagnostics View UI

**File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view.svelte`

- **Visual Hierarchy:** Clearly separate **Required Systems** (Text/Logic) from **Optional Subsystems** (Image/Audio).
- **Provider Toggles:** Add inline segmented controls (DaisyUI `join`) to let the user flip their Text Provider between "Local (Ollama)" and "Cloud (OpenRouter)" directly on the boot screen.
- **Hardware Recommendations Text:** Add stylized lore-friendly text:
    - _Note: Cloud Text + Local Image recommended for standard rigs. Full Local execution requires high-tier hardware._
- **Graceful Degradation:** If `canBoot` is true but `imageStatus` is offline/disabled, the "Initialize Core" button should still be clickable, perhaps with a minor warning tooltip ("Booting without Image Generation").

## Task 3: Graceful Degradation in Dialogue Overlay

**File:** `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts`

- Ensure that if the Image provider is marked as `disabled` or `offline`, the system skips sending requests to ComfyUI and simply displays the fallback NPC avatars (from `lpc_asset_catalog`) without throwing unhandled exceptions.

## Task 4: Update Unit & Visual Tests

- **File:** `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.test.ts`
    - Update tests to ensure `canBoot` is true when only Text is online.
    - Add tests for switching active providers.
- **File:** `apps/e2e/tests/client/boot_diagnostics_visual.spec.ts`
    - Capture new visual regression states: "Hybrid Setup (OpenRouter + Local Comfy)", "Text-Only Setup (Ollama Online, Comfy Offline)", ensuring the boot button is enabled in these states.

## Acceptance Criteria

- [ ] The game allows booting as long as a valid Text provider (Local or Cloud) is active.
- [ ] Users can seamlessly toggle between Cloud and Local text generation on the boot screen.
- [ ] Offline Image or Voice providers do not block game initialization.
- [ ] Updated Unit tests and Playwright visual snapshots pass.
