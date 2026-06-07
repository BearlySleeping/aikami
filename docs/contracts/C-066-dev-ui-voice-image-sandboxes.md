# Contract: C-066 — Dev UI Voice & Image Sandboxes

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-065 |
| Status | not_started |
| Version | 1.0 |

## Overview
We are expanding the Developer Console by implementing functional sandboxes for Voice (TTS) and Image (ComfyUI) generation, replacing their placeholder files. These sandboxes will use Tailwind/DaisyUI for a clean interface. Concurrently, we must repair the 6 pre-existing failures in the `dev_layout_view_model.test.ts` test suite to ensure our CI/CD pipeline remains green.

## Design Reference
- Review `apps/frontend/pwa/src/lib/views/dev/text/text_view.svelte` (built in C-065) for the DaisyUI layout structure.
- Review `apps/frontend/pwa/src/lib/client/services/media/audio_queue_player.ts` and `pixi_texture_injector.ts` for how to handle incoming binary media streams.

## Architecture Directives
- **Test Suite Repair**: Resolve the `BaseViewModel` export resolution issue causing `dev_layout_view_model.test.ts` to fail under the Bun test runner.
- **Voice Sandbox (`voice_view_model.svelte.ts` & `voice_view.svelte`)**: 
  - Input: Textarea for the script.
  - Action: "Generate Audio" button, "Cancel" button.
  - Output: Visual indication of the audio queue status and a way to play/listen to the returned binary chunks (using the `AudioQueuePlayer` or native Web Audio API).
- **Image Sandbox (`image_view_model.svelte.ts` & `image_view.svelte`)**:
  - Input: Textarea for the image prompt.
  - Action: "Generate Image" button, "Cancel" button.
  - Output: An `<img>` tag that renders the resulting ComfyUI binary buffer (converted to a Blob/Object URL) and a loading spinner while generating.

## State & Data Models
For the `ImageViewModel`:

    {
        prompt: string;
        imageUrl: string | null;
        isGenerating: boolean;
        generate(): Promise<void>;
        cancel(): void;
    }

For the `VoiceViewModel`:

    {
        text: string;
        isPlaying: boolean;
        queueSize: number;
        generateAndPlay(): Promise<void>;
        cancel(): void;
    }

## Acceptance Criteria

- **AC1: Test Suite Repair**
  - Given the PWA test suite
  - When executing `bun test`
  - Then `dev_layout_view_model.test.ts` passes successfully, and the entire suite returns 0 failures.
  - Test Hook: Run `bun test apps/frontend/pwa/src/lib/views/dev/layout/dev_layout_view_model.test.ts`.

- **AC2: Voice Sandbox UI & Logic**
  - Given the `/dev/voice` route
  - When the user inputs text and clicks generate
  - Then the view model triggers the audio generation service, receives chunks, and safely queues them for playback without locking the UI.
  - Test Hook: Unit test `VoiceViewModel.generateAndPlay()` using a mocked audio service and assert `queueSize` increments and `isPlaying` toggles.

- **AC3: Image Sandbox UI & Logic**
  - Given the `/dev/image` route
  - When the user inputs a prompt and clicks generate
  - Then the view model triggers the image generation service, displays a loading state, and successfully resolves the binary output to a DOM-usable Object URL.
  - Test Hook: Mock the image generation endpoint to return a static Blob, trigger generation, and assert `imageUrl` contains a valid `blob:` string.

- **AC4: Unified Abort Flow**
  - Given an active generation in either the Voice or Image sandbox
  - When the user clicks the "Cancel" button
  - Then the underlying `AbortController` fires, instantly severing network requests and resetting the UI state.
  - Test Hook: Trigger generations in both ViewModels, call `.cancel()`, and verify the mocked network abort signals are invoked.

## Implementation Notes
1. Fix the test suite first (AC1). This might require adjusting how `BaseViewModel` is imported or mocked in the test file.
2. Build the `VoiceViewModel` and `voice_view.svelte`. Use DaisyUI components (`textarea`, `btn`, `progress`, etc.) to match the aesthetics established in C-065.
3. Build the `ImageViewModel` and `image_view.svelte`. 
4. Ensure you use `URL.createObjectURL(blob)` for the image rendering and remember to call `URL.revokeObjectURL()` if you overwrite the image to prevent memory leaks in the browser.

## Edge Cases & Gotchas
- **Web Audio Autoplay**: Browsers block audio playback if not triggered by a direct user interaction. Ensure the `AudioContext` resumption is tightly bound to the "Generate" button click handler in the Voice sandbox.
- **Memory Leaks**: Every time you generate a new image and create an Object URL, the old one stays in memory unless explicitly revoked.
