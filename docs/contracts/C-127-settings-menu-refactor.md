# Contract: C-127 Settings Menu Refactor

## Goal

Overhaul the `/settings` route to function as a traditional Game Options menu, replacing the legacy web-app profile management UI with game-centric tabs, our AI Provider configurations, and explicit UI-based back navigation.

## Context

The previous settings page was built for a standard web application (Profile, Email, Phone, Danger Zone). As an offline-first SPA game running in Tauri, we need a standard game options layout. We will split the settings into two primary categories: "Game" (Audio, Display, Controls) and "AI Engine" (Text, Image, Voice providers). Furthermore, we must implement an explicit "Close/Back" button that routes the user to their previous screen without relying on the browser's history stack.

## Tasks

1. **Purge Legacy Web Settings:**
    - Delete the "Profile Information", "Security", and "Danger Zone" components and logic from the settings views.
    - Strip out any ViewModels related to updating user emails, phones, or profile data.

2. **Establish New Tabbed Layout (`src/lib/views/settings/settings_view.svelte`):**
    - Create a clean, game-style sidebar or top-nav tab system.
    - **Primary Category 1: Game**
        - Sub-tab: `Display` (Placeholders for Resolution, Fullscreen toggle)
        - Sub-tab: `Audio` (Placeholders for Master, SFX, Music volume sliders)
        - Sub-tab: `Controls` (Placeholders for Keybindings)
    - **Primary Category 2: AI Engine**
        - Sub-tab: `Text` (Mount the existing `ProvidersView` promoted in C-120 here)
        - Sub-tab: `Image` (Placeholder for Image Gen config)
        - Sub-tab: `Voice` (Placeholder for TTS config)

3. **Implement Explicit UI Back Navigation:**
    - Update the `SettingsViewModel` to read the current URL query parameters (e.g., `?from=game`).
    - Add a prominent "Close" or "Back" button to the settings UI layout.
    - Implement a `closeSettings()` method in the ViewModel that reads the `from` parameter and calls the `RouterService` to navigate explicitly to `/game` or `/`. If no parameter exists, default to `/`.
    - _Note: Ensure the Start Menu and Pause Menu update their navigation calls to include this parameter (e.g., `routerService.goTo('/settings?from=start')`)._

4. **Integrate C-120 Providers:**
    - Ensure the `ProvidersViewModel` is properly instantiated within the new AI Engine -> Text tab, giving the user access to configure their local/cloud LLMs.

## Out of Scope

- Implementing the actual logic for Keybindings, Volume Control, or Display scaling. Just build the UI placeholders and ViewModels so they are ready to be wired to the engine later.
- Changing how the AI Providers save data (keep the existing C-120 logic).

## Acceptance Criteria

- Navigating to `/settings` shows the new Game/AI Engine tab structure.
- The old Profile and Danger Zone UI elements are completely gone.
- The AI Provider configuration is accessible and functional under the "AI Engine -> Text" tab.
- Clicking the "Close/Back" button successfully triggers explicit route navigation back to the origin page based on the query parameter.
- Typechecks and builds pass with 0 errors.
