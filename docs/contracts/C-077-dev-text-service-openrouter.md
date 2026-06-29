<!-- completed: 2026-06-29 -->
# Contract: C-077 — Dev UI Text Sandbox Refactor & OpenRouter Toggle

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | P2 |
| Dependencies | C-065, C-072 |
| Status | completed |
| Version | 1.0 |

## Overview
The current Text Generation Sandbox handles Server-Sent Events (SSE) streaming directly inside its ViewModel. We need to refactor this to match the Voice and Image sandboxes by moving all network and stream parsing logic into a dedicated client-side `DevTextService`. Concurrently, we will add a UI toggle to let developers switch between the local Ollama container and OpenRouter, utilizing free-tier models for testing.

## Design Reference
- `DevVoiceService` and `DevImageService` for service extraction patterns.
- `VoiceViewModel` and `ImageViewModel` for thin proxy bridging.
- The hybrid text gateway built in C-056 (already supports `request.provider` overrides).

## Architecture Directives
- **Dev Text Service**: Create a client-side singleton service that manages the `AbortController`, the `fetch` to `/api/text`, and the SSE chunk accumulator.
- **Text View Model**: Refactor to be a thin wrapper around the Dev Text Service. It should only expose state getters/setters and lifecycle proxies.
- **Text View Sandbox**: Update the DaisyUI interface to include a Provider selector (Local Ollama vs OpenRouter). 
- **API Integration**: When OpenRouter is selected, the service must inject the provider override into the request payload and specify a free-tier model string (e.g., a known free HuggingFace or openrouter/auto model) to prevent credit burn during manual QA.
- **E2E Validation**: Update the text streaming E2E suite to interact with the new Provider dropdown and ensure the blackbox runner executes it cleanly.

## State & Data Models
The `DevTextService` should conceptually hold:

    {
        prompt: string;
        output: string;
        isGenerating: boolean;
        provider: 'ollama' | 'openrouter';
        model: string; // Used when OpenRouter is active
        generate(): Promise<void>;
        cancel(): void;
    }

## Acceptance Criteria

- **AC1: Service Extraction**
  - Given the Text Generation Sandbox
  - When the user generates text
  - Then the request and SSE streaming are handled entirely by a new `DevTextService` extending `BaseFrontendClass`, keeping the ViewModel clear of network logic.
  - Test Hook: Unit tests for `DevTextService` verify SSE chunk accumulation and abort behavior.

- **AC2: Provider Toggle & Payload**
  - Given the Text Sandbox UI
  - When the user selects "OpenRouter (Free Model)" from the provider dropdown and clicks Generate
  - Then the POST request to `/api/text` includes `{ provider: 'openrouter', model: '<free-model-identifier>' }` in its JSON body.
  - Test Hook: Mock the fetch call in service tests and assert the JSON body contains the correct provider and model fields.

- **AC3: E2E and Blackbox Coverage**
  - Given the automated Playwright suite
  - When the Dev Text Stream tests run
  - Then the tests successfully select the provider dropdown, submit a prompt, and assert the output container receives streamed text.
  - Test Hook: Run `bun run test:blackbox client` to ensure the E2E flow passes without hanging or failing to find locators.

## Implementation Notes
1. Create `DevTextService` and move the `_readStream` and `generate` methods from the current `TextViewModel` into it.
2. Update the `TextViewModel` to proxy to the new service.
3. Update the UI to include a `<select>` for the Provider. 
4. For the free OpenRouter model, investigate standard free identifiers (like `openrouter/auto` or specific free endpoints) and hardcode that as the default when the OpenRouter option is selected.
5. Ensure `.env.example` and local emulator `.env` files document `OPENROUTER_API_KEY` (even if it's already there from C-056, verify it's clear).
6. Update the Playwright tests to account for the new dropdown UI element before triggering generation.

## Edge Cases & Gotchas
- **SSE Stream Mocking in Tests**: Ensure the `DevTextService` tests correctly mock the `ReadableStream` reader just like the old ViewModel tests did, to avoid actual network calls.
- **State Reactivity**: Remember to export the `DevTextService` instance from the central services barrel file so it maintains a singleton lifecycle across sandbox mounts, matching Voice and Image.
