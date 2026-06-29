<!-- completed: 2026-06-29 -->
# Contract: C-056 — Hybrid Text Generation Gateway

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | None |
| Status | completed |
| Version | 1.0 |

## Overview
We need to stand up the foundational Text Generation Gateway for our NPC orchestration. This service handles incoming dialogue requests and streams SSE text back to the client. It defaults to OpenRouter for cloud offloading, but falls back to a local Ollama instance. The critical mechanic here is aggressively evicting the Ollama model from VRAM the millisecond the stream ends to prevent memory deadlocks with our upcoming image generation services.

## Design Reference
- Review `packages/backend/ai/src/lib/gemini_service.ts` or `openai_service.ts` for existing API handler patterns.
- Follow standard Web API `ReadableStream` patterns for the SSE implementation.

## Architecture Directives
- **AI Provider Router**: Service that reads the environment/config to determine the active text provider.
- **OpenRouter Adapter**: Standard OpenAI-compatible streaming client.
- **Ollama Adapter**: Wraps the standard completion stream but forcefully injects VRAM eviction flags.
- **Synthetic SSE Mock Service**: Intercepts requests during testing to yield fake SSE streams without hitting a real LLM.

## State & Data Models
When routing to Ollama, the payload must forcibly merge these parameters to ensure instant VRAM eviction and prevent thread locking:
    
    {
        "stream": true,
        "keep_alive": 0,
        "options": {
            "num_parallel": 1
        }
    }

## Acceptance Criteria

- **AC1: Provider Routing Configuration**
  - Given a chat completion request
  - When the system processes the request
  - Then it routes to the correct adapter (OpenRouter or Ollama) based on the active config.
  - Test Hook: Unit test the router logic with mock configurations.

- **AC2: Ollama Aggressive VRAM Eviction**
  - Given a request routed to the local Ollama adapter
  - When the payload is constructed
  - Then it strictly includes `keep_alive: 0` and `options.num_parallel: 1`.
  - Test Hook: Intercept the outgoing fetch/HTTP request to Ollama and assert the payload structure.

- **AC3: SSE Streaming**
  - Given a successful connection to a provider
  - When the provider yields chunks
  - Then the gateway properly formats them as Server-Sent Events and streams them to the client.
  - Test Hook: Consume the endpoint in a test and verify the `text/event-stream` headers and chunk formatting.

- **AC4: Synthetic Mocking (Testing Mandate)**
  - Given the test environment is active
  - When a completion request is made
  - Then the Synthetic SSE Mock Service intercepts the call and returns a static, pre-defined stream of chunks.
  - Test Hook: Assert that the mock stream completes successfully without triggering any external HTTP requests.

## Implementation Notes
1. Start by building the `Synthetic SSE Mock Service` to establish your test baseline.
2. Implement the `OpenRouter Adapter` and `Ollama Adapter`.
3. Build the `AI Provider Router` to manage the handoff.
4. Wire it up to a SvelteKit API route endpoint.
5. Ensure the API route properly handles client disconnects (abort signals) by terminating the upstream request to free resources immediately.

## Edge Cases & Gotchas
- **Connection Drops**: If the client closes the browser/game midway through a stream, the backend must instantly abort the upstream fetch to Ollama/OpenRouter. If we don't, Ollama will stay resident in VRAM until the hidden stream finishes. Pass `AbortController` signals all the way down.
- **Ollama Unavailability**: If the fallback is triggered but the Ollama container isn't running, fail fast with a clear error rather than hanging.
