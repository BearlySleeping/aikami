# Contract: C-059 — Client-Side Stream Sync

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-056, C-057, C-058 |
| Status | completed |
| Version | 1.0 |

## Overview
We need to build the client-side orchestration layer that consumes the three AI generation streams (Text SSE, Voice WebSocket, Image WebSocket) simultaneously. This system must synchronize the incoming data, update the Svelte dialogue UI, queue and play audio chunks seamlessly, and inject binary image frames into the PixiJS WebGPU context. Crucially, it must manage a unified `AbortController` to instantly sever all three connections if the player skips the dialogue or closes the menu.

## Design Reference
- Review existing Svelte state management (runes/stores) in the frontend package.
- Review `.pi/skills-pixijs/` for the correct way to handle dynamic texture creation from raw binary buffers in PixiJS v8.
- Utilize the mock endpoints built in C-056, C-057, and C-058 for testing.

## Architecture Directives
- **Stream Orchestrator**: The master controller. Exposes a `generateDialogue` method that triggers all three backend services using a shared `AbortSignal`.
- **Dialogue State Store**: Svelte state container tracking the progressive text stream and current speaker metadata.
- **Audio Queue Player**: Service that receives binary audio chunks from the WS, decodes them, and plays them sequentially using the Web Audio API without gaps.
- **PixiJS Texture Injector**: Receives the binary image buffer from the ComfyUI WS, converts it to a `Blob`/`ImageBitmap`, and swaps the texture on the active NPC Sprite/Mesh in the PixiJS scene.

## State & Data Models
The orchestrator needs a clean interface to represent the active generation state. Conceptual structure:

    {
        isGenerating: boolean;
        currentText: string;
        currentAudioQueueSize: number;
        cancelGeneration: () => void;
    }

For PixiJS Texture creation from the binary buffer:

    // Conceptually:
    const blob = new Blob([buffer], { type: 'image/webp' }); 
    const bitmap = await createImageBitmap(blob);
    // Apply bitmap to Pixi Texture...

## Acceptance Criteria

- **AC1: Unified Lifecycle & Abort Management**
  - Given a triggered dialogue generation
  - When `cancelGeneration` is called
  - Then the shared `AbortSignal` aborts the SSE text fetch, closes the Audio WS, and closes the Image WS immediately.
  - Test Hook: Mock the three network interfaces, trigger an abort, and assert that all three abort handlers/close methods are invoked.

- **AC2: Progressive Text Consumption**
  - Given an active SSE text stream
  - When chunks arrive
  - Then the Dialogue State Store updates its `currentText` reactively.
  - Test Hook: Provide a mock SSE stream and assert the Svelte state updates accordingly.

- **AC3: Seamless Audio Queueing**
  - Given incoming binary audio chunks from the TTS worker
  - When chunks are received out of sync with playback
  - Then the Audio Queue Player buffers and plays them in strict sequential order without overlapping.
  - Test Hook: Unit test the queueing logic with mocked AudioBuffer/AudioContext nodes to ensure sequential playback scheduling.

- **AC4: PixiJS Dynamic Texture Injection**
  - Given a completed image generation buffer
  - When the buffer is passed to the PixiJS Texture Injector
  - Then it successfully converts the binary data into a valid PixiJS Texture and updates the target display object.
  - Test Hook: Mock the PixiJS application context, pass a dummy image buffer, and verify the texture assignment on a dummy Sprite.

## Implementation Notes
1. Start with the `Stream Orchestrator` and `Dialogue State Store` to nail down the `AbortController` logic and text syncing.
2. Implement the `Audio Queue Player`. Web Audio API `AudioBufferSourceNode` scheduling (using `audioContext.currentTime`) is usually best for gapless playback of chunks.
3. Implement the `PixiJS Texture Injector`. Consult the PixiJS v8 docs via `.pi/skills-pixijs` to ensure you are using the optimal texture update path for WebGPU (avoiding memory leaks by destroying the old texture if necessary).
4. Do NOT attempt to hook this into the real backend services for your automated tests; rely entirely on mocking the network layer or using the synthetic endpoints built previously.

## Edge Cases & Gotchas
- **Web Audio API Autoplay Policy**: The `AudioContext` must be resumed/created following a user interaction. Ensure the orchestrator handles suspended audio contexts gracefully.
- **Texture Memory Leaks**: When swapping a PixiJS texture with a new one dynamically generated from a buffer, the old texture must be explicitly destroyed (`texture.destroy(true)`) so we don't bleed VRAM on the client.
- **Out-of-Order Audio**: WebSockets guarantee order, but if chunk processing takes variable time, ensure the queue explicitly plays chunk $N$ only after chunk $N-1$ has finished.
