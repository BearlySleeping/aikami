# C-076: Dev UI Image Sandbox Checkpoint Selection

| Field | Value |
|-------|-------|
| Source | architecture |
| Target | apps/frontend/pwa |
| Priority | P2 |
| Dependencies | C-066 |
| Status | not_started |
| Version | 1.0.0 |

## Overview

Enhance the existing Dev Image Sandbox with a dynamic ComfyUI checkpoint (model) selector. Following the pattern established in the Voice Sandbox (`TtsService` / `VoiceViewModel`), the logic for fetching and storing available checkpoints will live in the `ImageGenerationService`. The `ImageViewModel` will act as a thin bridge, and the UI will feature a dropdown to select the model used for generation.

## Design Reference

- Voice Sandbox Pattern: `apps/frontend/pwa/src/lib/views/dev/voice/` and `apps/frontend/pwa/src/lib/client/services/media/tts.svelte.ts`.
- Thin ViewModel Pattern: ViewModels own minimal local state (like text input) and proxy complex business logic and arrays (like available voices/checkpoints) via native getters to the underlying `$state`-equipped service.

## Architecture Directives

1.  **Image Generation Service**: 
    - Define a `CheckpointInfo` type representing a ComfyUI model.
    - Add reactive state arrays for `checkpoints` and a string for `selectedCheckpoint`.
    - Implement a `loadCheckpoints()` method that fetches from a backend endpoint (e.g., `/api/image/v1/checkpoints` or similar).
    - Update `generateImage()` to accept and utilize the selected checkpoint in its payload.
2.  **Image View Model**:
    - Expose `checkpoints` and `selectedCheckpoint` via getters/setters bridging to the service.
    - Override the `initialize()` method to call `loadCheckpoints()` on the service, ensuring data is fetched when the view mounts.
3.  **Image View UI**:
    - Add a DaisyUI `<select>` dropdown populated by `viewModel.checkpoints` and bound to `viewModel.selectedCheckpoint`.
    - Disable the dropdown while images are generating or if checkpoints are still loading.
4.  **Testing**:
    - Write unit tests for the service validating `loadCheckpoints` fetch behavior and state updates.
    - Update/write unit tests for the ViewModel to ensure it properly bridges the checkpoint state and passes the selected checkpoint to the generation call.

## State & Data Models

    export type CheckpointInfo = {
      readonly id: string;
      readonly description: string;
    };

    // Service state additions
    checkpoints: CheckpointInfo[] = $state([]);
    selectedCheckpoint = $state('');

## Acceptance Criteria

**AC-1: Service Checkpoint Loading**
- **Given** the `ImageGenerationService` is initialized
- **When** `loadCheckpoints()` is called
- **Then** it fetches from the checkpoints API endpoint and populates the `checkpoints` array, setting a default `selectedCheckpoint` if none is set.
- **Test Hook**: Verify mock fetch is called and state is updated in `image_generation.test.ts`.

**AC-2: ViewModel Bridging & Initialization**
- **Given** the `ImageViewModel` is mounted in a view
- **When** `initialize()` is invoked
- **Then** it calls `service.loadCheckpoints()` and accurately reflects the service's `checkpoints` array and `selectedCheckpoint` state.
- **Test Hook**: Verify `initialize` triggers the service load and getters return expected mock data.

**AC-3: UI Dropdown Integration**
- **Given** the user navigates to `/dev/image`
- **When** the available checkpoints load
- **Then** a dropdown appears displaying the checkpoints, bound to `selectedCheckpoint`, and it becomes disabled during active generation.

**AC-4: Generation Payload Inclusion**
- **Given** a specific checkpoint is selected in the UI
- **When** the user clicks "Generate Image"
- **Then** the `generateImage` fetch request payload includes the selected checkpoint ID.

## Implementation Notes

1.  Update `ImageGenerationServiceInterface` and `ImageGenerationService` in `apps/frontend/pwa/src/lib/client/services/media/image_generation.svelte.ts`. Add the `CheckpointInfo` type, `loadCheckpoints()`, and update `generateImage()`.
2.  Create/update the corresponding unit tests for the service. Use the `test_preload.ts` setup if `$state` runes need polyfilling in the test environment.
3.  Update `ImageViewModelInterface` and `ImageViewModel` in `apps/frontend/pwa/src/lib/views/dev/image/image_view_model.svelte.ts` to bridge the new state and call `loadCheckpoints()` during `initialize()`.
4.  Update `image_view.svelte` to include the DaisyUI card/form-control for the checkpoint selector, mimicking the voice selector layout.

## Edge Cases & Gotchas

- **Empty State**: Ensure the UI gracefully handles the period before checkpoints are loaded (e.g., showing "Loading checkpoints..." in the label-text-alt).
- **Demo Mode**: If `isDemoMode()` is true, `loadCheckpoints()` should probably just load a hardcoded mock checkpoint so the UI still functions without a backend.
- **Fetch Errors**: Handle endpoint failures in `loadCheckpoints()` securely (log the error, leave array empty) without crashing the view.
