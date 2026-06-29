<!-- completed: 2026-06-29 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory: "Abstraction & Wrappers First" — "Never lock the project into a single vendor or library. Always create a base interface or abstract class for services (e.g., `AiService`)." Existing pattern: `ImageGenerationProviderInterface` in schemas |
| **Target** | New `packages/backend/ai/` — AiServiceInterface, BaseAiService, OpenAiService, GeminiService; `packages/shared/mocks/` — MockAiService; `apps/backend/functions/` — refactor existing AI functions to use the abstraction |
| **Priority** | P1 — Core service abstraction; prevents vendor lock-in for AI (OpenAI, Gemini, Anthropic, etc.) |
| **Dependencies** | C-005 (packages/shared structure already done), C-014 (database abstraction — same tier, follows same interface-first pattern) |
| **Status** | **completed** ** |
| **Contract version** | 1.0.0 |

## Overview

Create a vendor-agnostic AI service abstraction layer to replace the current direct coupling to Google Genkit in `apps/backend/functions/src/controllers/api/prompt_ai.ts`. Following the "Abstraction & Wrappers First" mandate and the existing `ImageGenerationProviderInterface` pattern already in `packages/shared/schemas/`, define an `AiServiceInterface` for text-based AI operations (dialogue generation, structured JSON extraction, embeddings). Create an abstract `BaseAiService` with shared error handling, retry logic, rate-limiting, and Zod-based response validation. Implement two concrete providers — `OpenAiService` and `GeminiService` — that extend the base. Provide a `MockAiService` for fast, deterministic TDD without API costs or network calls.

This contract re-establishes the `packages/backend/ai/` package that was removed in C-005 — this time with proper abstraction, not vendor-specific code.

## Design Reference

**Existing abstraction precedent**: `packages/shared/schemas/src/lib/image-generation.ts`
```typescript
// Already exists — the AI text service follows this exact pattern:
export interface ImageGenerationProviderInterface {
  readonly name: string;
  readonly provider: ImageGenerationProvider;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  getCapabilities(): ProviderCapabilities;
}
```

**Current broken state**: `apps/backend/functions/src/controllers/api/prompt_ai.ts`
```typescript
// DIRECT vendor lock-in — no abstraction:
import { googleAI } from '@genkit-ai/googleai';
const ai = genkit({ plugins: [googleAI()], model: googleAI.model('gemini-2.0-flash') });
```

**Goal state**: Functions use `AiServiceInterface` — swap provider via config, test with `MockAiService`.

## Changes Detail

### 1. AiServiceInterface (`packages/backend/ai/`)

Define a pure TypeScript `interface` (OOP contract — correct use per coding rules) with three operation categories:

**Dialogue generation**:
- `generateChat(messages: AIChatMessage[], options?: ChatOptions): Promise<ChatResponse>` — multi-turn chat with system/user/assistant messages
- `generateCompletion(prompt: string, options?: CompletionOptions): Promise<string>` — single-turn text completion

**Structured extraction**:
- `extractStructuredJSON<T>(prompt: string, schema: z.ZodSchema<T>, input: string): Promise<T>` — extract typed JSON from unstructured text using Zod schema validation
- `classifyText(input: string, labels: string[], options?: ClassificationOptions): Promise<ClassificationResult>` — classify text into predefined labels

**Embeddings**:
- `generateEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]>` — single text embedding
- `generateEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]>` — batch embeddings

The interface must NOT import any vendor-specific types. All method signatures use domain types (`AIChatMessage`, `ChatResponse`, etc.) defined in `@aikami/types`.

### 2. BaseAiService (`packages/backend/ai/`)

Abstract class implementing cross-cutting concerns shared by all providers:

- **Error handling**: Wraps every provider call in try/catch; maps vendor errors to standardized `AiServiceError` types (rate limited, token exceeded, content filtered, network timeout)
- **Rate limiting**: Token-bucket or sliding-window rate limiter configurable per provider — prevent 429 errors before they happen
- **Response validation**: All structured extraction responses pass through Zod `parseAsync` before returning to callers; invalid responses trigger automatic retry with correction prompt
- **Retry logic**: Exponential backoff with jitter for transient failures (network, 429, 5xx); configurable max retries
- **Logging**: Structured debug logs for every call (provider, model, prompt tokens, completion tokens, latency)
- **Circuit breaker**: After N consecutive failures, stop calling the provider for a cooldown period to avoid cascading failures

The abstract class defines `abstract` methods that each concrete provider implements:
```typescript
abstract class BaseAiService implements AiServiceInterface {
  // Concrete: error handling, rate limiting, retry, logging, circuit breaker
  async generateChat(...) { /* wrapper logic → calls this._generateChatRaw() */ }

  // Abstract: provider-specific API calls
  protected abstract _generateChatRaw(...): Promise<RawChatResponse>;
  protected abstract _generateEmbeddingRaw(...): Promise<number[]>;
  // ...
}
```

### 3. Concrete Implementations

#### OpenAiService (`packages/backend/ai/src/lib/openai-service.ts`)
- Uses `openai` npm SDK (v4+) for OpenAI API access
- Supports GPT-4o, GPT-4o-mini, O-series models
- Handles OpenAI-specific error codes, streaming (optional), function calling for structured extraction
- Rate limiting aware of OpenAI tier limits (RPM/TPM per key)

#### GeminiService (`packages/backend/ai/src/lib/gemini-service.ts`)
- Uses `@google/generative-ai` SDK for Gemini API access
- Supports gemini-2.0-flash, gemini-2.5-pro, gemini-2.5-flash
- Handles Gemini-specific safety filters, content blocking, citation metadata
- Rate limiting aware of Gemini free/paid tier quotas

### 4. MockAiService (`packages/shared/mocks/`)

Zero-dependency in-memory mock implementing `AiServiceInterface`:

- `generateChat()`: Returns predefined or pattern-matched responses (no network)
- `extractStructuredJSON()`: Returns the Zod schema's default/example value
- `generateEmbedding()`: Returns a deterministic pseudo-random embedding of correct dimension
- `seedResponse(pattern: string, response: ChatResponse)`: Allows tests to prime specific responses
- `getCallHistory()`: Returns all calls made to the mock for assertion (`expect(mock.getCallHistory()).toHaveLength(3)`)
- Fast, no API keys, no network — suitable for CI and watch-mode TDD

### 5. Package Structure

```
packages/backend/ai/
├── moon.yml
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # Public exports
    └── lib/
        ├── ai-service-interface.ts  # AiServiceInterface
        ├── base-ai-service.ts       # Abstract BaseAiService
        ├── openai-service.ts        # OpenAiService extends BaseAiService
        ├── gemini-service.ts        # GeminiService extends BaseAiService
        ├── errors.ts                # AiServiceError, error codes
        ├── rate-limiter.ts          # Token bucket rate limiter
        ├── circuit-breaker.ts       # Circuit breaker state machine
        └── types.ts                 # ChatOptions, CompletionOptions, EmbeddingOptions, etc.
```

Shared types (`AIChatMessage`, `ChatResponse`, `ChatContext`, etc.) already exist in `packages/shared/types/src/lib/client/endpoint-ai.ts` — extend them there rather than duplicating.

## Acceptance Criteria

### AC-1: AiServiceInterface Defined Without Vendor Imports
**Given** the project currently has vendor-locked AI code (`genkit`, `googleAI`)
**When** `AiServiceInterface` is created
**Then** `packages/backend/ai/src/lib/ai-service-interface.ts` exports a pure TypeScript `interface` with zero imports from `openai`, `@google/generative-ai`, `genkit`, `@genkit-ai/*`, `anthropic`, or any vendor SDK

**Test Hooks**:
- Unit: `test -f packages/backend/ai/src/lib/ai-service-interface.ts`
- Unit: `grep -c "import" packages/backend/ai/src/lib/ai-service-interface.ts` shows only imports from `@aikami/types` and `zod`
- Unit: Interface exports `generateChat`, `generateCompletion`, `extractStructuredJSON`, `classifyText`, `generateEmbedding`, `generateEmbeddings`

**Watch Points**:
- Must use `interface` (not `type`) — this is an OOP abstraction contract
- Type parameters must be generic: `extractStructuredJSON<T>(schema: z.ZodSchema<T>, ...): Promise<T>`
- No `any` in method signatures

### AC-2: BaseAiService Provides Shared Infrastructure
**Given** the `AiServiceInterface`
**When** `BaseAiService` is implemented as an abstract class
**Then** it implements all non-provider-specific logic: error wrapping, retry with backoff, rate limiting, Zod response validation, circuit breaker, structured logging

**Test Hooks**:
- Unit: `test -f packages/backend/ai/src/lib/base-ai-service.ts`
- Unit: `test -f packages/backend/ai/src/lib/rate-limiter.ts`
- Unit: `test -f packages/backend/ai/src/lib/circuit-breaker.ts`
- Unit: `test -f packages/backend/ai/src/lib/errors.ts`
- Unit: TypeScript `abstract class BaseAiService implements AiServiceInterface` compiles
- Unit: Rate limiter test: 100 rapid calls → first N pass, subsequent ones throw `AiServiceError('rate_limited')`
- Unit: Circuit breaker test: N consecutive failures → circuit opens → subsequent calls throw immediately for cooldown period → circuit half-opens → success resets

**Watch Points**:
- Rate limiter must be configurable per provider (OpenAI has different limits than Gemini)
- Retry must NOT retry on 4xx errors except 429 (rate limit) and 408 (timeout)
- Circuit breaker cooldown must be configurable (default: 30 seconds)

### AC-3: OpenAiService and GeminiService Implement Interface
**Given** the abstract `BaseAiService`
**When** concrete providers are created
**Then** both `OpenAiService` and `GeminiService` extend `BaseAiService` and implement all abstract methods

**Test Hooks**:
- Unit: `test -f packages/backend/ai/src/lib/openai-service.ts`
- Unit: `test -f packages/backend/ai/src/lib/gemini-service.ts`
- Unit: `OpenAiService` constructor accepts `{ apiKey: string, model?: string, organization?: string }`
- Unit: `GeminiService` constructor accepts `{ apiKey: string, model?: string }`
- Unit: Both classes instantiate without errors (no network call on construction)
- Unit: `const service: AiServiceInterface = new OpenAiService({ apiKey: 'test' })` compiles

**Watch Points**:
- Model selection must be constructor-injected, NOT hardcoded — no `model: 'gemini-2.0-flash'` baked into the class
- API key must come from constructor options or environment variable (`OPENAI_API_KEY` / `GEMINI_API_KEY`), never hardcoded
- Services must NOT initialize connections at module import time (lazy init)

### AC-4: MockAiService for TDD
**Given** the `AiServiceInterface`
**When** unit tests need deterministic AI responses without API costs
**Then** `MockAiService` implements the interface with seedable responses and call history

**Test Hooks**:
- Unit: `test -f packages/shared/mocks/src/lib/mock-ai-service.ts`
- Unit: `MockAiService implements AiServiceInterface` compiles
- Unit: `mock.seedResponse('hello', { text: 'hi there' })` → `mock.generateChat([...])` returns `{ text: 'hi there' }`
- Unit: `mock.extractStructuredJSON(personaSchema, ...)` returns valid persona data matching the schema
- Unit: `mock.generateEmbedding('test')` returns `number[]` of fixed length (e.g., 1536)
- Unit: `mock.getCallHistory()` returns chronological list of all method calls with arguments
- Unit: `mock.reset()` clears all seeded responses and call history

**Watch Points**:
- `generateEmbedding()` must return deterministic values — same input → same output (use a hash-based approach)
- `extractStructuredJSON()` must return data that passes the provided Zod schema (use `zocker` or the existing `mock-generators.ts` infrastructure)
- Mock must NOT throw unless explicitly configured to (`mock.setFailMode('rate_limited')`)

### AC-5: TDD Workflow Verified — Mock → Real Integration
**Given** the full AI abstraction stack
**When** a test suite is written
**Then** it demonstrates: fast unit tests with MockAiService → same tests pass against OpenAiService and GeminiService with real API keys

**Test Hooks**:
- Unit: `packages/backend/ai/tests/ai-service.test.ts` exists with at least:
  - Test suite for `AiServiceInterface` contract (runs against MockAiService, OpenAiService, GeminiService)
  - Chat generation test: given system + user messages, returns assistant response
  - Structured extraction test: given text + Zod schema, returns typed object
  - Embedding test: given text, returns vector of correct dimension
  - Rate limit test: rapid calls trigger rate limiting
  - Error handling test: invalid API key → `AiServiceError('authentication_failed')`
- Integration: `bun test` passes using MockAiService (fast, no API keys)
- Integration: `OPENAI_API_KEY=sk-... bun test -- --tag integration` passes against real OpenAI
- Integration: `GEMINI_API_KEY=... bun test -- --tag integration` passes against real Gemini

**Watch Points**:
- Integration tests must be opt-in (tagged) — never run against real APIs in CI without explicit intent
- Mock tests must be the default — `bun test` without flags runs mock only
- Test must validate that `OpenAiService` and `GeminiService` produce semantically similar results for the same input (provider agnosticism)

### AC-6: Existing prompt_ai Function Refactored
**Given** the AI service abstraction
**When** `apps/backend/functions/src/controllers/api/prompt_ai.ts` is updated
**Then** it imports and uses `AiServiceInterface` instead of direct Genkit calls, with provider selected via environment config

**Test Hooks**:
- Unit: `prompt_ai.ts` imports `AiServiceInterface` from `@aikami/backend-ai` (not `genkit`)
- Unit: `prompt_ai.ts` imports `createAiService()` factory from `@aikami/backend-ai`
- Unit: Provider type comes from `AI_PROVIDER` environment variable (`openai` | `gemini`), defaults to `gemini`
- Integration: Setting `AI_PROVIDER=openai` + valid API key → function uses OpenAI
- Integration: Setting `AI_PROVIDER=gemini` + valid API key → function uses Gemini

**Watch Points**:
- The refactor must maintain backward compatibility — existing API contract (request/response shapes) must not change
- The `generate_image.ts` callable stub should also be wired to use the abstraction (though image generation is a separate concern from text AI)

## Implementation Notes

### Coding Rules (must be followed throughout implementation)

1. **Prefer `const` over `function`** — Arrow functions for all callbacks, module-level functions, and factory functions. `function` reserved for generator functions (`function*`) and method overrides in classes.
2. **Escape early** — Every method begins with guard clauses. Check API key validity, input not empty, schema provided — return or throw before proceeding.
3. **Always `{}` for `if`** — Every `if`, `else if`, `else`, `for`, `while`, `try/catch` body wrapped in curly braces `{}`, even single-line.
4. **`type` for data, `interface` for contracts** — `type` for `ChatOptions`, `CompletionOptions`, `EmbeddingOptions`, `ChatResponse`. `interface` exclusively for `AiServiceInterface` (the OOP contract).
5. **Tests first** — Write the test suite against `MockAiService` first. Then implement `BaseAiService` + `OpenAiService` to pass the same contract tests. Add `GeminiService` last.
6. **No vendor types in public API** — The interface and all shared types must never reference `openai` types, `@google/generative-ai` types, or `genkit` types. Vendor types stay confined to their respective service files.

### Files to create
- `packages/backend/ai/moon.yml` — moon project config
- `packages/backend/ai/package.json` — dependencies
- `packages/backend/ai/tsconfig.json` — TypeScript config
- `packages/backend/ai/src/index.ts` — public exports
- `packages/backend/ai/src/lib/ai-service-interface.ts` — `AiServiceInterface`
- `packages/backend/ai/src/lib/base-ai-service.ts` — abstract `BaseAiService`
- `packages/backend/ai/src/lib/openai-service.ts` — `OpenAiService`
- `packages/backend/ai/src/lib/gemini-service.ts` — `GeminiService`
- `packages/backend/ai/src/lib/errors.ts` — `AiServiceError`, error codes
- `packages/backend/ai/src/lib/rate-limiter.ts` — token bucket implementation
- `packages/backend/ai/src/lib/circuit-breaker.ts` — circuit breaker state machine
- `packages/backend/ai/src/lib/types.ts` — options types, response types
- `packages/backend/ai/src/lib/factory.ts` — `createAiService(provider, config)` factory function
- `packages/backend/ai/tests/ai-service.test.ts` — contract test suite
- `packages/shared/mocks/src/lib/mock-ai-service.ts` — `MockAiService`

### Files to modify
- `packages/shared/types/src/lib/client/endpoint-ai.ts` — extend with `ChatResponse`, `ClassificationResult`, `EmbeddingOptions`, etc.
- `apps/backend/functions/src/controllers/api/prompt_ai.ts` — refactor to use `AiServiceInterface`
- `apps/backend/functions/src/controllers/callable/generate_image.ts` — wire to abstraction (text-to-image prompt enhancement)
- `apps/backend/functions/package.json` — add `@aikami/backend-ai` dependency
- `.moon/workspace.yml` — add `backend-ai` project entry
- `packages/shared/mocks/package.json` — add `@aikami/backend-ai` dependency (for interface import)
- `packages/shared/mocks/src/index.ts` — export `MockAiService`

### Files to delete
- None (existing code is refactored, not removed)

### Order of operations
1. Extend shared types in `packages/shared/types/` (domain types: `ChatResponse`, `ClassificationResult`, etc.)
2. Create `AiServiceInterface` — pure contract, no deps except types + zod
3. Create `MockAiService` — implements interface, zero network deps
4. Write contract test suite against `MockAiService` — **verify tests pass against mock**
5. Implement `BaseAiService` with rate limiter, circuit breaker, error handling
6. Implement `OpenAiService` extending `BaseAiService`
7. Run contract tests against `OpenAiService` with real API key (integration tag) — **verify same tests pass**
8. Implement `GeminiService` extending `BaseAiService`
9. Run contract tests against `GeminiService` with real API key (integration tag) — **verify same tests pass**
10. Create `createAiService()` factory for runtime provider selection
11. Refactor `prompt_ai.ts` to use the abstraction
12. Refactor `generate_image.ts` to use the abstraction for text-based prompt enhancement
13. Run `bun test` (mock, fast) + `bun test --tag integration` (real APIs)

### Verification
- `bun test` in `packages/backend/ai/` passes (mock only, < 1 second)
- `OPENAI_API_KEY=sk-... bun test -- --tag integration` passes
- `GEMINI_API_KEY=... bun test -- --tag integration` passes
- `bun run typecheck` across all affected packages (backend-ai, functions, types, mocks)
- `bunx moon run :typecheck --affected` reports zero errors
- Swapping `AI_PROVIDER` env var changes which service the functions use — verified via logs
- No `genkit` imports remain in `prompt_ai.ts`

## Edge Cases & Gotchas

- **Provider API differences**: OpenAI uses `messages` array with `role` field; Gemini uses `contents` with `role: 'user' | 'model'`. The base service must normalize between these — the interface uses OpenAI's format as the canonical representation, GeminiService translates internally
- **Embedding dimensions vary**: OpenAI `text-embedding-3-small` returns 1536; Gemini `text-embedding-004` returns 768. The interface must not assume a fixed dimension — callers should not hardcode vector sizes
- **Structured extraction approaches differ**: OpenAI has native JSON mode + function calling; Gemini has `responseSchema` in generation config. The `BaseAiService.extractStructuredJSON()` must handle both paths, with Zod as the universal post-processing validator
- **Rate limit granularity**: OpenAI has separate RPM (requests per minute) and TPM (tokens per minute) limits; Gemini has RPM + RPD (requests per day) on free tier. The rate limiter must be parameterized per provider
- **Safety filters**: Gemini may block responses for safety (returns `promptFeedback.blockReason`). The base service must translate safety blocks to `AiServiceError('content_filtered')` and optionally retry with a sanitized prompt
- **Streaming vs non-streaming**: This contract implements non-streaming (request → full response). Streaming (`generateChatStream`) is a follow-up contract — the interface can be extended later
- **OpenAI organization ID**: OpenAI API supports `organization` header for multi-org accounts. The constructor must accept this optionally
- **Mock embedding determinism**: Use a simple hash function (e.g., DJB2) seeded by the input text to generate deterministic pseudo-embeddings. They don't need to be semantically meaningful — just consistent
- **API key rotation**: Production deployments may use key rotation. The factory function should support a `getApiKey: () => Promise<string>` callback instead of a static string for advanced use cases (out of scope for initial implementation but do not design against it)
