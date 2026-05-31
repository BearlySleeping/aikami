# Contract: C-025 TTS Audio Streaming & Synchronization

## Design References

- Svelte 5 TTS Audio Sync Blueprint
- Web Audio API `AudioContext` and `AudioBufferSourceNode`
- Target System: `apps/frontend/pwa/src/lib/client/services/media/tts.svelte.ts`

## Detailed Changes

1. **Audio Manager Engine**: Create `apps/frontend/pwa/src/lib/client/services/media/audio_context_manager.ts`. This file will encapsulate a singleton `AudioContext`. It must include an `unlock()` method bound to a window event listener to satisfy browser autoplay policies.
2. **Chunk Scheduling Queue**: Update `tts.svelte.ts`. Implement an asynchronous queue that accepts incoming ArrayBuffer chunks from the TTS SSE stream, decodes them via `audioContext.decodeAudioData()`, and schedules them gaplessly using a `nextStartTime` tracker.
3. **State Synchronization**: Introduce Svelte 5 `$state` runes in `tts.svelte.ts` for `is_playing` (boolean) and `current_word_index` (number). Implement a `requestAnimationFrame` loop (or Web Worker timer) that compares `audioContext.currentTime` against chunk boundaries to update `current_word_index`.
4. **UI Highlighting**: Modify the relevant chat message UI component (e.g., `apps/frontend/pwa/src/lib/components/chat/message_bubble.svelte` or `tts_player.svelte`) to wrap words in `<span>` tags. Apply a CSS highlight class conditionally based on `tts_service.current_word_index`.

## Acceptance Criteria

- **Given** a user is interacting with the chat.
- **When** the first click occurs.
- **Then** the `AudioContext` successfully resumes from its suspended state.
- **When** the TTS service receives sequential audio chunks.
- **Then** the chunks are scheduled and played gaplessly without audio popping.
- **Then** the `current_word_index` Svelte `$state` updates in real-time.
- **Then** the UI highlights the spoken words synchronously with the audio playback.

## Watch Points

- **Decode Failures**: `decodeAudioData` will throw exceptions if a chunk is truncated mid-frame. Ensure the backend TTS pipeline is configured to stream complete WAV/PCM boundaries, or implement a byte-buffer accumulator before decoding.
- **Memory Leaks**: Ensure `AudioBufferSourceNode` instances are properly garbage collected by assigning `source.onended` handlers that nullify references.
- **Reactivity Thrashing**: Ensure the `requestAnimationFrame` loop updating `current_word_index` does not trigger excessive DOM layouts. Svelte 5's fine-grained reactivity handles this well, but ensure the binding is scoped tightly to the word spans.
