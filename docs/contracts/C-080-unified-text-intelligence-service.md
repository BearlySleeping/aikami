<!-- completed: 2026-06-29 -->
# Contract C-080: Unified Text & Structural Intelligence Service

## Metadata
- **Source:** Architectural Consolidation Review
- **Target:** Client Core Services
- **Priority:** P1
- **Dependencies:** C-077, C-079
- **Status:** not_started
- **Contract Version:** 1.0.0

## Overview
This contract establishes a centralized, client-side unified intelligence service that abstracts all text-generation workflows. It eliminates raw endpoint fetches across frontend components by encapsulating vanilla token streaming, history-aware chat, and performance-critical TypeBox structural extraction. The service interfaces directly with the central configuration service to resolve providers, API keys, and models dynamically.

## Design Reference
- Following the reactive, singleton service encapsulation pattern seen in `dev_text.svelte.ts` and `config_service.svelte.ts`.
- Utilizing TypeBox's compiled JSON Schema generation structures directly for strict LLM constraint matching, mirroring the OpenAI JSON Schema specifications.

## Architecture Directives
- Build a new text intelligence orchestration service to serve as the unified frontend gateway for LLM interaction.
- Refactor the existing chat view models, dev sandboxes, and character builders to fully consume this central service, removing raw `/api/text` network calls.

## State & Data Models
The service must explicitly implement and expose the following data shapes:

    type ChatMessageRole = 'user' | 'assistant' | 'system';

    interface UnifiedChatMessage {
        role: ChatMessageRole;
        content: string;
    }

    interface ChatStreamingOptions {
        onChunk: (text: string) => void;
        signal?: AbortSignal;
    }

    interface StructuredExtractionOptions<T> {
        schema: T; // TypeBox TSchema
        schemaName: string;
        prompt: string;
        systemPrompt?: string;
        signal?: AbortSignal;
    }

The runtime execution must respect `configService` variables for current provider routing ('ollama' or 'openrouter'), custom endpoint overrides, and active model targets.

## Acceptance Criteria

### AC-1: Dynamic Provider & Model Resolution
- **Given:** An active `ConfigService` set to use OpenRouter with a fallback model.
- **When:** A text generation or structured extraction request is initiated without explicit parameter overrides.
- **Then:** The service reads the provider configuration, applies the resolved endpoint and API keys, and appends the proper model metadata fields to the text gateway payload.
- **Test Hook:** `window.__ai_service_resolved_routing` must expose the active provider, resolved model string, and active endpoint for the current session.

### AC-2: Unified Token Streaming Chat
- **Given:** A sequence of conversation messages and a target container.
- **When:** `streamChat()` is called with an `onChunk` streaming callback.
- **Then:** The service handles the underlying SSE text reader pipeline, passes down client abort signals, accumulates incoming tokens reactively, and issues terminal completion states.
- **Test Hook:** `window.__ai_service_active_stream_count` tracks the current number of concurrent active textual network connections.

### AC-3: High-Performance TypeBox Structural Extraction
- **Given:** A TypeBox object schema (e.g., `Type.Object({ name: Type.String() })`).
- **When:** `extractStructure()` is executed with an active schema definition.
- **Then:** The service strips TypeBox structures down to standard JSON schemas, enforces `additionalProperties: false` (or standard strict constraints depending on the active provider target), forwards it as a strict structural completion schema, parses the final token string response, and returns a fully typed TypeScript object.
- **Test Hook:** `window.__ai_service_compiled_schema_cache_size` tracks the count of distinct TypeBox definitions compiled into target formats.

## Implementation Notes
1. Create the unified intelligence service class with explicit TypeBox imports.
2. Inject the central `configService` dependency to evaluate provider profiles reactively.
3. Port the streaming SSE reader logic into the service core, supporting clean cancellation frames.
4. Add the `extractStructure` compiler method: strip runtime tracking wrappers and adapt parameters dynamically depending on whether the destination router points to OpenAI-compliant endpoints or local Ollama configurations.
5. Search the codebase for occurrences of raw `/api/text` network calls (such as in `dev_text.svelte.ts` and `character_view_model.svelte.ts`) and swap them to use the newly created text service interface.

## Edge Cases & Gotchas
- **TypeBox Options Mapping:** When routing via OpenAI or OpenRouter strict JSON Schema modes, the schema MUST have `additionalProperties: false` or it will reject the entire inference pass at the API gate. Ensure the compiler defensively appends or enforces this configuration.
- **Abort Signaling:** Ensure that aborting a structured or streaming request gracefully drops the network frame without throwing uncaught runtime leak exceptions in the application viewport.
