<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
# Contract: C-131 Native WebGPU Voice via Kokoro

## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami Feature Spec — Browser-native TTS via WebGPU Worker |
| **Target** | `apps/frontend/client/src/lib/workers/voice/`, `apps/frontend/client/package.json` |
| **Priority** | P2 — Optional quality-of-life feature; enables voice without cloud dependencies |
| **Dependencies** | None |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Goal
Implement a native, zero-setup text-to-speech engine using the 82M Kokoro TTS model running directly in the browser via WebGPU. This will be orchestrated through an isolated Web Worker to ensure the Svelte 5 UI and PixiJS canvas maintain a strict 60 FPS while synthesizing audio.

## Tech Stack
- **Framework:** Svelte 5 (Runes: `$state`, `$effect`)
- **ML Runtime:** `kokoro-js`, `@huggingface/transformers` (^4.2.0), `onnxruntime-web` (^1.19.0)
- **Concurrency:** Dedicated ES6 Web Worker
- **Audio:** Web Audio API

---

## Task 1: Package Dependencies
**File:** `apps/frontend/client/package.json`
- Add `@huggingface/transformers`, `kokoro-js`, and `onnxruntime-web` to dependencies.
- *Note:* Ensure the Vite configuration (`vite.config.ts`) allows `.wasm` files to be served correctly by explicitly excluding `onnxruntime-web` from Vite's dependency pre-bundling if necessary.

## Task 2: Create the Kokoro Web Worker
**File:** `apps/frontend/client/src/lib/services/audio/kokoro_worker.ts`
- Create a dedicated Web Worker script.
- **Initialization (`action: 'initialize'`):**
  - Import `kokoro-js`, `onnxruntime-web/webgpu`, and `@huggingface/transformers`.
  - Disable local model fallback: `env.allowLocalModels = false`.
  - Set `ort.env.wasm.wasmPaths` to a reliable CDN (e.g., jsDelivr) to fetch `ort-wasm-simd-threaded.jsep.wasm`.
  - Initialize the Kokoro inference session with explicit WebGPU configurations: `executionProviders: ['webgpu', 'wasm']`, and `enableGraphCapture: true`.
- **Synthesis (`action: 'synthesize'`):**
  - Accept text and a voice key (e.g., `af_bella`).
  - Pass the inputs through the tokenizer and model forward-pass.
  - Return the raw `Float32Array` PCM buffer to the main thread via `postMessage`. Catch and serialize any errors.

## Task 3: Update the TTS Service (ViewModel)
**File:** `apps/frontend/client/src/lib/services/audio/tts_service.svelte.ts`
- Update the existing `TtsService` class.
- **State (`$state`):**
  - `status: 'uninitialized' | 'initializing' | 'ready' | 'error'`
  - `errorMessage: string | null`
- **Properties:**
  - Maintain a reference to the spawned `Worker` and the `AudioContext`.
- **Actions:**
  - `initialize()`: Spawn `new Worker(new URL('./kokoro_worker.ts', import.meta.url), { type: 'module' })`. Set up the `onmessage` listener to handle `ready`, `complete`, and `error` payloads.
  - `synthesize(text: string, voice: string)`: Push a message to the worker. 
  - `playAudioBuffer(pcmData: Float32Array, sampleRate: number)`: Convert the incoming raw Float32 array into an `AudioBuffer` and schedule playback via `AudioContext`.

## Task 4: Connect Dialogue Stream to TTS
**File:** `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts`
- Inject the updated `TtsService`.
- Implement a sentence-boundary chunker (utilizing the existing `SentenceBoundaryChunker` if available, or write a simple regex delimiter for `.` `!` `?`).
- As the Ollama `streamChat` resolves text chunks in real-time, aggregate them. When a full sentence is formed, send it to `TtsService.synthesize()` to queue the audio generation. 
- Await the initialization of `TtsService` when the dialogue overlay mounts.

## Task 5: Unit & Integration Testing
- **File:** `apps/frontend/client/src/lib/services/audio/tts_service.test.ts`
  - Mock the `Worker` global object and the `AudioContext`.
  - Verify that `initialize()` properly transitions the `$state` to `ready`.
  - Verify that sending a `synthesize` call correctly posts a message to the worker mock.
- **File:** `apps/e2e/tests/client/tts_worker.spec.ts`
  - Write a basic Playwright test navigating to the sandbox/dev TTS route. Validate that the UI reflects the "Initializing" and "Ready" states without throwing console errors related to WebGPU or WASM instantiation.

## Acceptance Criteria
- [ ] Dependencies are correctly installed and Vite resolves the worker imports.
- [ ] Web Worker successfully initializes ONNX Runtime with the `webgpu` execution provider.
- [ ] Dialogue text is successfully chunked and synthesized into playable Web Audio API buffers without freezing the Svelte UI thread.
- [ ] Unit tests pass with mocked workers.
