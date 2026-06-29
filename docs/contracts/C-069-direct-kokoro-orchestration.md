# Contract: C-069 — Direct Kokoro Orchestration

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-068 |
| Status | not_started |
| Version | 1.0 |

## Overview
We are removing the Bun/Hono proxy layer from the Voice microservice to reduce architectural complexity. `apps/backend/voice` will become a pure infrastructure package containing a Dockerfile that serves the headless Kokoro TTS engine. Simultaneously, we will shift the sentence boundary chunking logic directly into the Client frontend, allowing the Svelte application to orchestrate TTS via direct HTTP REST calls to the Kokoro container.

## Design Reference
- Review `packages/backend/audio/src/lib/sentence_boundary_chunker.ts` (to be relocated to the frontend).
- Review `apps/frontend/client/src/lib/client/services/media/stream_orchestrator.svelte.ts` for where the chunking and HTTP calls will now occur.

## Architecture Directives
- **Headless Kokoro Container**: Strip `apps/backend/voice/src/main.ts` and the Hono setup. Replace the `Dockerfile` with a simple implementation extending `hwdsl2/kokoro-server:latest`. Update `package.json` to handle building and running this container via Podman/Docker on the assigned voice port (8089).
- **Frontend Sentence Chunker**: Port the pure TypeScript `SentenceBoundaryChunker` logic from the backend audio package directly into the Client's media services.
- **Direct TTS HTTP Client**: Create a utility in the Client that takes a completed sentence and makes a POST request to the Kokoro server's `/v1/audio/speech` endpoint, returning the audio buffer.
- **Stream Orchestrator Refactor**: Remove the old WebSocket logic from the `StreamOrchestrator`. It must now feed incoming SSE text to the inline Sentence Chunker, and dispatch HTTP calls to Kokoro as sentences complete.
- **Deprecation Cleanup**: Completely delete the `packages/backend/audio` package and remove it from the workspace, as its worker pool and WebSocket handlers are no longer needed.

## State & Data Models
Kokoro expects an OpenAI-compatible completion payload. The Direct TTS HTTP Client should POST this to `http://127.0.0.1:8089/v1/audio/speech`:

    {
        "model": "kokoro",
        "input": "The sentence to speak.",
        "voice": "af_bella", // Standard fallback voice
        "response_format": "wav"
    }

## Acceptance Criteria

- **AC1: Headless Container Infrastructure**
  - Given the `apps/backend/voice` directory
  - When inspected
  - Then it contains a `Dockerfile` `FROM hwdsl2/kokoro-server:latest`, and `package.json` scripts to build/run it (`docker run --rm -p 8089:8880...`). All Bun/Hono source files are deleted.
  - Test Hook: Run `moon run voice:dev` and assert the Kokoro server boots up.

- **AC2: Frontend Chunker Relocation**
  - Given the Client media services
  - When chunking logic is tested
  - Then the `SentenceBoundaryChunker` correctly buffers text and splits on terminal punctuation, matching the original backend implementation.
  - Test Hook: Port the existing chunker unit tests into the Client test suite and assert they pass.

- **AC3: Direct TTS HTTP Trigger**
  - Given the `StreamOrchestrator`
  - When an SSE text stream arrives
  - Then it successfully chunks the sentences and fires `fetch` POST requests directly to the Kokoro API endpoint using the active `AbortSignal`.
  - Test Hook: Mock the `fetch` API in the orchestrator test, feed it an SSE stream, and assert the Kokoro endpoint is called with the correct JSON payload.

- **AC4: Audio Package Deprecation**
  - Given the repository workspace
  - When inspected
  - Then `packages/backend/audio` is entirely deleted and removed from `.moon/workspace.yml` and all `package.json` dependencies.
  - Test Hook: Run `bun run typecheck` across the workspace to ensure zero dangling imports.

## Implementation Notes
1. Start with the cleanup (AC4 and AC1). Delete `packages/backend/audio`, strip `apps/backend/voice/src/`, rewrite the `Dockerfile`, and update `apps/backend/voice/package.json` scripts. (Note: Kokoro internally runs on 8880, so map `-p 8089:8880`).
2. Move the `SentenceBoundaryChunker` into `apps/frontend/client/src/lib/client/services/media/` and get its tests passing in the Client (AC2).
3. Build the HTTP client logic for Kokoro in the Client.
4. Refactor `StreamOrchestrator` to use the inline chunker and HTTP client instead of the old WebSocket setup (AC3). Ensure `AbortController` handles canceling active `fetch` calls to Kokoro if the user skips dialogue.

## Edge Cases & Gotchas
- **CORS**: Kokoro might reject direct browser requests due to CORS depending on the image configuration. If this happens during your testing, you may need to configure the `Dockerfile` or startup script to explicitly allow origins.
- **Sequential Playback**: Since HTTP requests for Sentence 1 and Sentence 2 might resolve out of order depending on generation time, ensure the frontend's `AudioQueuePlayer` strictly enforces sequential playback based on the sentence index.
