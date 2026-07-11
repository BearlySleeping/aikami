<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-122 Onboarding & Provider Gate

## Goal
Implement a gatekeeping mechanism on the "Start Game" action to ensure the user has at least one valid Text AI provider (or a local text model) configured before proceeding to character creation or gameplay.

## Context
If a user enters the game world without an LLM configured, the core ECS dialogue and event systems will fail. We need to catch this at the Start Menu. If the configuration is missing, we gracefully inform the user and direct them to the Settings page. If the configuration exists, we let them pass through to the `/setup` route.

## Tasks

1. **Update `StartViewModel` Logic:**
   - Inject or reference the application's configuration state (e.g., `ConfigService`, `AiSettings`, or `ProviderViewModel` depending on your current state management).
   - Update the `startGame()` method to evaluate this state.
   - **Condition:** Check if a default Text Provider is selected and has an API key, OR if a local AI text service is flagged as active.

2. **Create the Missing Providers Dialog:**
   - Create a new Svelte component for the warning modal (e.g., `src/lib/views/start/components/missing_providers_dialog.svelte`).
   - The dialog should have a clear message: *"An AI text provider is required to play the game. We highly recommend configuring Image and Voice generation as well for the full experience."*
   - Add two buttons to the dialog:
     - **"Go to Settings"** -> Navigates to `/settings`.
     - **"Cancel/Close"** -> Closes the dialog and stays on the Start Menu.

3. **Wire the Flow:**
   - If the `startGame()` condition fails (no provider), trigger the `MissingProvidersDialog`.
   - If the `startGame()` condition passes (has provider), route the user to `/setup` (the Character Creation placeholder).

## Out of Scope
- Actually verifying the validity of the API keys via network requests. Just check if the configuration fields are populated in the local state.
- Implementing the save-file loading system (we will just assume a new game and route to `/setup` for now).

## Acceptance Criteria
- Clicking "Start Game" with empty AI configurations prevents navigation and opens the Missing Providers dialog.
- Clicking "Go to Settings" from the dialog successfully routes to `/settings`.
- Populating a dummy API key/provider in the settings, returning to the Start Menu, and clicking "Start Game" successfully navigates to `/setup`.
- Typecheck and tests pass with 0 errors.
