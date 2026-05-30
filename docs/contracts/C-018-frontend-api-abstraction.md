## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory: "Never lock the project into a single vendor or library. Always create a base interface or abstract class for services." — Abstraction & Wrappers First mandate. Existing pattern: `AiServiceInterface` in `packages/shared/types/` (backend-facing, C-015). |
| **Target** | New `packages/frontend/api-core/` — `GameApiClient`, `FrontendAiInterface`, `OpenAiClient`, `GeminiClient`, `OllamaClient`, `ComfyUiClient`, `LocalTtsClient`, `MockAiClient`; game engine integration in `apps/frontend/game/src/engine/services/` |
| **Priority** | P1 — Foundational layer for the PixiJS+bitECS game engine (C-016); without this, the game cannot communicate with the backend or leverage AI providers. Unblocks NPC dialogue, procedural content generation, and image synthesis features. |
| **Dependencies** | C-015 (backend `AiServiceInterface` — provides API shapes to mirror), C-016 (game engine boundary — this package communicates through EngineBridge), C-005 (packages/shared structure — types/schemas already defined), C-006 (frontend-configs — provides Firebase function URLs) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Create a frontend-facing API and AI abstraction layer for the PixiJS+bitECS game engine (`apps/frontend/game/`). The game engine runs client-side as a standalone application — it needs its own communication layer to call backend services and interact with AI providers, distinct from the SvelteKit UI layer's `FirebaseFunctionsService`.

This contract defines two core abstractions:

1. **`GameApiClient`** — A generic HTTP wrapper for backend communication from the game engine. Provides typed request/response handling against Firebase Functions endpoints, with configurable base URL, auth token injection, error mapping, and retry support. Used for features like fetching NPC data, submitting player actions, and saving game state.

2. **`FrontendAiInterface`** — An agnostic AI provider interface implemented by both cloud clients (OpenAI, Gemini — routed through the backend) and local clients (Ollama for text generation, ComfyUI for image generation, a browser TTS fallback). The interface mirrors the backend `AiServiceInterface` in spirit but is tailored for the client-side game engine context — methods are limited to what the game engine needs (dialogue generation, image prompt synthesis, text-to-speech, structured content generation).

Both abstractions are consumed inside the game engine's services layer and communicated to the SvelteKit UI through the existing `EngineBridge` — never directly bridging reactive state.

### Why a separate frontend-facing layer?

The backend already has `AiServiceInterface` (`packages/backend/ai/`, C-015) for server-side AI operations. The game engine needs a separate abstraction because:

- **Runtime context**: The game engine runs client-side in the browser (or Tauri webview) — it can call local services (Ollama, ComfyUI, browser TTS) that the backend cannot reach
- **Routing distinction**: Cloud providers (OpenAI, Gemini) are routed through the Firebase backend (keeping API keys server-side); local providers connect directly to user's localhost services
- **Game-specific methods**: The game engine needs AI capabilities like NPC dialogue generation and item description synthesis — different granularity than backend's general-purpose chat/embedding interface
- **Engine boundary**: The game engine is architecturally isolated from the SvelteKit UI — it cannot (and must not) import packages that depend on `firebase` or Svelte runes

## Design Reference

**Existing abstraction precedent** — backend `AiServiceInterface` (`packages/shared/types/src/lib/pwa/ai-service-interface.ts`):

```typescript
export interface AiServiceInterface {
  readonly name: string;
  generateChat(messages: AIChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  generateCompletion(prompt: string, options?: CompletionOptions): Promise<string>;
  extractStructuredJSON<T>(prompt: string, schema: z.ZodSchema<T>, input: string): Promise<T>;
  classifyText(input: string, labels: string[], options?: ClassificationOptions): Promise<ClassificationResult>;
  generateEmbedding(text: string, options?: EmbeddingOptions): Promise<number[]>;
  generateEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;
}
```

**Existing backend API pattern** — callable Firebase Functions routed through `FirebaseFunctionsService` (`packages/frontend/services/`):

```typescript
class FirebaseFunctionsService extends BaseClass {
  async getHttpsCallable<RequestData, ResponseData>(name: string): Promise<HttpsCallable<...>>;
}
```

**Engine boundary pattern** (from C-016):

```
Game Engine (PixiJS + bitECS)       EngineBridge       SvelteKit UI
┌────────────────────────┐          typed msgs          ┌──────────────┐
│  services/api-core/    │  ──────────────►             │ GameViewModel │
│  GameApiClient ────────┤  send(command)               │  $state()     │
│  FrontendAiInterface   │  ◄──────────────             │              │
└────────────────────────┘  emit(event)                 └──────────────┘
```

**Key design principle**: The API core package lives inside the game engine as its service layer. It does NOT import from Svelte, Firebase SDKs, or the SvelteKit UI layer. It communicates with the backend through plain `fetch()` calls (cloud providers) or direct HTTP to local services (local providers), never through Firebase client SDKs.

## Changes Detail

### 1. New Package: `packages/frontend/api-core/`

A moon-managed library package providing the API client and AI provider abstractions. The game engine (`apps/frontend/game/`) depends on this package.

```
packages/frontend/api-core/
├── moon.yml                              # Moon project config
├── package.json                          # Deps: zod (server compat), @aikami/types, @aikami/schemas
├── tsconfig.json                         # TypeScript config
├── src/
│   ├── index.ts                          # Public exports
│   ├── api/
│   │   ├── game_api_client.ts            # GameApiClient — generic HTTP wrapper
│   │   ├── game_api_client_interface.ts  # GameApiClientInterface
│   │   ├── errors.ts                     # ApiError, error codes
│   │   └── types.ts                      # Request/response types, options
│   └── ai/
│       ├── frontend_ai_interface.ts      # FrontendAiInterface
│       ├── clients/
│       │   ├── openai_client.ts          # OpenAiClient — cloud (via backend proxy)
│       │   ├── gemini_client.ts          # GeminiClient — cloud (via backend proxy)
│       │   ├── ollama_client.ts          # OllamaClient — local (direct HTTP)
│       │   ├── comfyui_client.ts         # ComfyUiClient — local (direct HTTP)
│       │   └── local_tts_client.ts       # LocalTtsClient — browser Web Speech API
│       ├── factory.ts                    # createAiClient() — runtime provider selection
│       └── mock/
│           └── mock_ai_client.ts         # MockAiClient — deterministic TDD mock
├── tests/
│   ├── api/
│   │   ├── game_api_client.test.ts       # Unit tests for GameApiClient
│   │   └── game_api_client.contract.test.ts  # Contract tests (mock → real backend)
│   └── ai/
│       ├── frontend_ai_interface.test.ts # Contract test suite (runs against all implementations)
│       ├── ollama_client.test.ts         # Unit tests for Ollama client
│       ├── comfyui_client.test.ts        # Unit tests for ComfyUI client
│       ├── local_tts_client.test.ts      # Unit tests for TTS client
│       └── mock_ai_client.test.ts        # Tests for mock implementation
└── playground/
    └── frontend-ai-playground.spec.ts    # Playwright integration test
```

### 2. GameApiClient (`packages/frontend/api-core/src/api/`)

A generic typed HTTP wrapper for game engine ↔ backend communication. Does NOT use Firebase SDKs — uses plain `fetch()` with configurable auth token injection.

```typescript
// GameApiClientInterface — pure contract, zero vendor imports
interface GameApiClientInterface {
  readonly baseUrl: string;

  /** POST request to a backend endpoint. Returns typed response. */
  post<TResponse, TRequest = unknown>(
    path: string,
    body: TRequest,
    options?: RequestOptions,
  ): Promise<TResponse>;

  /** GET request to a backend endpoint. Returns typed response. */
  get<TResponse>(
    path: string,
    options?: RequestOptions,
  ): Promise<TResponse>;

  /** Sets the auth token for subsequent requests. */
  setAuthToken(token: string | null): void;

  /** Returns the current auth state. */
  isAuthenticated(): boolean;
}
```

**Key behaviors**:
- All requests go through `fetch()` with a configurable `baseUrl` (defaults to the Firebase Functions URL from frontend-configs)
- Auth tokens are injected as `Authorization: Bearer <token>` headers — set via `setAuthToken()`
- 4xx/5xx responses are mapped to typed `ApiError` instances (not thrown blindly — structured error types)
- Transient failures (network timeout, 5xx) retry with exponential backoff (configurable)
- Request/response bodies are validated against Zod schemas when provided
- CORS headers are handled transparently

### 3. FrontendAiInterface (`packages/frontend/api-core/src/ai/`)

An AI provider interface tailored for game engine consumption. Fewer methods than the backend `AiServiceInterface` — focused on what the game engine actually needs.

```typescript
// FrontendAiInterface — vendor-agnostic, game-focused, zero vendor imports
interface FrontendAiInterface {
  /** Human-readable provider name (e.g. 'ollama', 'openai', 'gemini', 'local-tts'). */
  readonly name: string;

  /** Provider capability flags — allows the game engine to check what's available. */
  readonly capabilities: AiProviderCapabilities;

  /**
   * Generate NPC dialogue given context.
   * Returns a natural-language response suitable for in-game NPC conversations.
   */
  generateDialogue(
    context: DialogueContext,
    options?: DialogueOptions,
  ): Promise<DialogueResponse>;

  /**
   * Generate a text description or structured data used to construct
   * image-generation prompts for procedural content.
   */
  generateContentDescription(
    prompt: string,
    options?: ContentDescriptionOptions,
  ): Promise<string>;

  /**
   * Synthesize speech from text (TTS).
   * For local TTS, returns a base64-encoded audio blob or a reference to a
   * generated audio element. For cloud providers, returns similarly shaped data.
   */
  synthesizeSpeech(text: string, options?: TtsOptions): Promise<SpeechResult>;

  /**
   * Generate an image given a prompt (for in-game assets, item icons, etc.).
   * Typically delegates to the backend (cloud) or ComfyUI (local).
   */
  generateImage(prompt: string, options?: ImageOptions): Promise<ImageResult>;

  /**
   * Generate structured game content (item descriptions, quest text, NPC names)
   * using a prompted Zod schema as validation guard.
   */
  generateStructured<T>(
    instruction: string,
    schema: z.ZodSchema<T>,
    context?: string,
  ): Promise<T>;

  /** Check if the provider is currently reachable (local services may be offline). */
  healthCheck(): Promise<HealthCheckResult>;
}
```

**Provider capabilities** — the game engine uses these to decide which provider to invoke:

```typescript
type AiProviderCapabilities = {
  /** Can generate natural-language dialogue. */
  dialogue: boolean;
  /** Can generate content descriptions (text-to-text). */
  contentDescription: boolean;
  /** Can synthesize speech (text-to-speech). */
  speech: boolean;
  /** Can generate images (text-to-image). */
  image: boolean;
  /** Can generate structured game data (JSON). */
  structured: boolean;
  /** Provider requires backend API keys (cloud). */
  requiresBackend: boolean;
  /** Provider runs entirely local (no network to cloud). */
  isLocal: boolean;
};
```

### 4. Cloud Provider Implementations

#### OpenAiClient (`packages/frontend/api-core/src/ai/clients/openai_client.ts`)

- Routes all requests through the **backend proxy endpoint** (Firebase Functions `prompt_ai` / `generate_image`) — API keys stay server-side
- Does NOT bundle the `openai` npm SDK client-side — uses the generic `GameApiClient` to call backend endpoints
- Capabilities: `{ dialogue: true, contentDescription: true, speech: false, image: true, structured: true, requiresBackend: true, isLocal: false }`
- Supports GPT-4o, GPT-4o-mini via backend model selection

#### GeminiClient (`packages/frontend/api-core/src/ai/clients/gemini_client.ts`)

- Also routes through the backend proxy — same pattern as `OpenAiClient`
- Uses `GameApiClient` to call backend endpoints with provider-selector headers
- Capabilities: `{ dialogue: true, contentDescription: true, speech: false, image: true, structured: true, requiresBackend: true, isLocal: false }`
- Supports gemini-2.0-flash, gemini-2.5-pro via backend model selection

### 5. Local Provider Implementations

#### OllamaClient (`packages/frontend/api-core/src/ai/clients/ollama_client.ts`)

- Connects **directly** to a local Ollama instance via HTTP (`http://localhost:11434/api/generate` or `api/chat`)
- Does NOT go through the backend — uses `fetch()` directly against localhost
- Capabilities: `{ dialogue: true, contentDescription: true, speech: false, image: false, structured: true, requiresBackend: false, isLocal: true }`
- Supports configurable model name (default: `llama3`), base URL, and timeout
- Compatible with Ollama's streaming and non-streaming chat/generate API
- The `healthCheck()` method pings `http://localhost:11434/api/tags` to verify Ollama is running

**Configuration**:
```typescript
type OllamaClientOptions = {
  /** Ollama server base URL. Default: 'http://localhost:11434'. */
  baseUrl?: string;
  /** Model name. Default: 'llama3'. */
  model?: string;
  /** Request timeout in ms. Default: 30000. */
  timeoutMs?: number;
  /** Chat generation options (temperature, top_p, etc.). */
  defaultOptions?: Partial<OllamaChatOptions>;
};
```

#### ComfyUiClient (`packages/frontend/api-core/src/ai/clients/comfyui_client.ts`)

- Connects **directly** to a local ComfyUI instance via HTTP (`http://localhost:8188/prompt` or websocket API for streaming)
- Does NOT go through the backend
- Capabilities: `{ dialogue: false, contentDescription: false, speech: false, image: true, structured: false, requiresBackend: false, isLocal: true }`
- Required workflow ID to be configured (ComfyUI uses workflow JSONs)
- The `healthCheck()` method pings `http://localhost:8188/` to verify ComfyUI is reachable

**Configuration**:
```typescript
type ComfyUiClientOptions = {
  /** ComfyUI server base URL. Default: 'http://localhost:8188'. */
  baseUrl?: string;
  /** Pre-configured workflow JSON path or ID. */
  workflowId: string;
  /** Image generation timeout in ms. Default: 60000 (image gen is slow). */
  timeoutMs?: number;
  /** Output format. Default: 'png'. */
  outputFormat?: 'png' | 'webp' | 'jpeg';
};
```

#### LocalTtsClient (`packages/frontend/api-core/src/ai/clients/local_tts_client.ts`)

- Uses the **Web Speech API** (`window.speechSynthesis`) for browser-based TTS — no external service needed
- Falls back gracefully when `window.speechSynthesis` is unavailable (SSR, headless)
- Capabilities: `{ dialogue: false, contentDescription: false, speech: true, image: false, structured: false, requiresBackend: false, isLocal: true }`
- Supports voice selection, rate, pitch, and volume configuration
- The `synthesizeSpeech()` method returns a `SpeechResult` with:
  - `audioData` — base64-encoded WAV (if using Web Audio API capture) or `null` (live playback)
  - `durationMs` — estimated duration
  - `voicesAvailable` — list of available voice names for discovery

**Configuration**:
```typescript
type LocalTtsClientOptions = {
  /** Preferred voice name (fuzzy-matched). Default: system default. */
  preferredVoice?: string;
  /** Speech rate (0.1 — 10.0). Default: 1.0. */
  rate?: number;
  /** Speech pitch (0 — 2.0). Default: 1.0. */
  pitch?: number;
  /** Volume (0 — 1.0). Default: 1.0. */
  volume?: number;
  /** If true, captures audio via Web Audio API instead of live playback. Default: false. */
  captureAudio?: boolean;
};
```

### 6. MockAiClient (`packages/frontend/api-core/src/ai/mock/mock_ai_client.ts`)

Zero-dependency in-memory mock implementing `FrontendAiInterface`:

- `generateDialogue()`: Returns pre-seeded responses or pattern-matched templates (no network)
- `generateContentDescription()`: Returns a canned or configurable description
- `synthesizeSpeech()`: Returns a minimal `SpeechResult` with zero-duration and a flag indicating mock mode
- `generateImage()`: Returns a minimal `ImageResult` referencing a placeholder asset path
- `generateStructured()`: Returns the Zod schema's default/example value
- `healthCheck()`: Always returns `{ available: true, latencyMs: 0 }` unless configured to simulate failure
- `seedDialogue(pattern: string, response: DialogueResponse)`: Allows tests to prime specific responses
- `getCallHistory()`: Returns all calls made to the mock for assertion
- `reset()`: Clears all seeded responses and call history
- Fast, no API keys, no network — suitable for CI and watch-mode TDD

### 7. Game Engine Integration

The game engine (`apps/frontend/game/`) consumes the API core package through a new `services/` layer:

```
apps/frontend/game/src/engine/services/
├── api_service.ts        # Wraps GameApiClient — exposes game-specific methods
├── ai_service.ts         # Wraps FrontendAiInterface — exposes game-specific AI methods
└── ai_config.ts          # Provider selection + configuration (reads env/feature flags)
```

**`api_service.ts`** — high-level methods that the game engine systems call:
```typescript
class GameApiService {
  constructor(client: GameApiClientInterface) {}

  /** Fetch NPC data from the backend (character sheet, dialog, quests). */
  async fetchNpcData(npcId: string): Promise<NpcData>;

  /** Submit a player action to the backend (quest progress, dialog choice). */
  async submitPlayerAction(action: PlayerAction): Promise<ActionResult>;

  /** Save game state checkpoint. */
  async saveCheckpoint(state: GameState): Promise<void>;

  /** Load game state checkpoint. */
  async loadCheckpoint(slotId: string): Promise<GameState | null>;
}
```

**`ai_service.ts`** — bridges the AI provider with game engine systems:
```typescript
class GameAiService {
  constructor(aiClient: FrontendAiInterface) {}

  /** Generate NPC dialogue triggered by interaction. Returns text to show in dialog UI. */
  async generateNpcDialogue(npcId: string, playerContext: string): Promise<string>;

  /** Generate an item description for a procedurally created item. */
  async generateItemDescription(item: ItemData): Promise<string>;

  /** Synthesize NPC speech from dialog text (only if a TTS provider is configured). */
  async speakNpcDialog(text: string): Promise<void>;
}
```

The `GameWorld` class (already implemented in C-016) will receive these services via constructor injection:

```typescript
class GameWorld {
  constructor(bridge: EngineBridge, apiService?: GameApiService, aiService?: GameAiService) {
    // ...
  }
}
```

### 8. Factory Function

**`createAiClient(provider: AiProvider, options: AiClientOptions): FrontendAiInterface`**

Creates the appropriate AI client based on provider configuration:

```typescript
type AiProvider = 'openai' | 'gemini' | 'ollama' | 'comfyui' | 'local-tts' | 'mock';

type AiClientOptions = {
  openai?: OpenAiClientOptions;
  gemini?: GeminiClientOptions;
  ollama?: OllamaClientOptions;
  comfyui?: ComfyUiClientOptions;
  localTts?: LocalTtsClientOptions;
};
```

Provider selection flows:
- **Cloud providers** (`openai`, `gemini`): Requires a `GameApiClient` instance to pass to the constructor — routes through backend
- **Local providers** (`ollama`, `comfyui`, `local-tts`): Self-contained, no backend needed
- **Mock** (`mock`): Zero-dependency, for testing and development

### 9. Package Dependencies

| Package | Direction | Purpose |
|---------|-----------|---------|
| `@aikami/types` | dep | `AIChatMessage`, `ChatOptions`, shared types |
| `@aikami/schemas` | dep | Zod schemas for request/response validation |
| `@aikami/logger` | dep | Structured logging (client-side) |
| `@aikami/constants` | dep | Enums, config constants |
| `@aikami/utils` | dep | `AppError`, utility helpers |
| `zod` | dep | Runtime schema validation |

The game engine package `@aikami/game` (apps/frontend/game) has `@aikami/api-core` as a dependency:
```json
{
  "dependencies": {
    "@aikami/api-core": "workspace:*",
    "pixi.js": "^8.18.1",
    "bitecs": "^0.4.0"
  }
}
```

### 10. Future-Proofing

The `FrontendAiInterface` is designed to be extended without breaking existing implementations:

- New methods can be added with default implementations in abstract base classes (future `BaseAiClient`)
- New local providers (e.g., `StableDiffusionWebUiClient`) implement the same interface
- The `capabilities` field allows the game engine to discover provider features at runtime without type narrows
- The `AiProvider` union in the factory function is extended when new providers are added

## Acceptance Criteria

### AC-1: GameApiClient — Generic HTTP Wrapper Exists and Is Typed
**Given** the game engine needs to communicate with the Firebase backend
**When** `GameApiClient` is created
**Then** it provides typed `post()` and `get()` methods, auth token management, error mapping, and configurable base URL — all without importing any Firebase SDK

**Test Hooks**:
- Unit: `test -f packages/frontend/api-core/src/api/game_api_client_interface.ts`
- Unit: `test -f packages/frontend/api-core/src/api/game_api_client.ts`
- Unit: Interface defines `post<TResponse, TRequest>()`, `get<TResponse>()`, `setAuthToken()`, `isAuthenticated()`
- Unit: Interface imports ZERO Firebase SDK modules (`firebase`, `@firebase/*`, `@aikami/frontend-services`)
- Unit: `new GameApiClient({ baseUrl: 'http://localhost:5001' })` instantiates without errors
- Unit: `client.post('/path', { data: 1 })` makes a `fetch()` call with correct URL, headers, body
- Unit: `client.setAuthToken('token123')` → subsequent request sends `Authorization: Bearer token123`
- Unit: HTTP 500 response → throws `ApiError` with status code and error message
- Unit: Network timeout → throws `ApiError('network_timeout')` after configurable timeout
- Unit: Exponential backoff: 3 consecutive 503s → retries 3 times before throwing final error

**Watch Points**:
- Must NOT use Firebase `callable` SDK — only `fetch()`. The game engine has no Firebase dependency
- Auth token is injected as a header, not through Firebase Auth SDK — the token is obtained from `FirebaseAuthService` (SvelteKit side) and passed into the game engine via the bridge
- Retry must NOT retry on 4xx errors except 408 (timeout) and 429 (rate limited)
- `RequestOptions` must allow: `timeout`, `signal` (AbortController), `retryConfig`, `headers` (additional)

### AC-2: FrontendAiInterface Defined Without Vendor Imports
**Given** the game engine needs AI capabilities
**When** `FrontendAiInterface` is created
**Then** it exports a pure TypeScript `interface` with zero imports from `openai`, `@google/generative-ai`, or any AI vendor SDK

**Test Hooks**:
- Unit: `test -f packages/frontend/api-core/src/ai/frontend_ai_interface.ts`
- Unit: Interface exports `generateDialogue()`, `generateContentDescription()`, `synthesizeSpeech()`, `generateImage()`, `generateStructured()`, `healthCheck()`
- Unit: Interface has `readonly name: string` and `readonly capabilities: AiProviderCapabilities`
- Unit: File imports only from `@aikami/types`, `zod`, and local types — zero vendor SDKs
- Unit: `AiProviderCapabilities` type has all required boolean fields (`dialogue`, `contentDescription`, `speech`, `image`, `structured`, `requiresBackend`, `isLocal`)

**Watch Points**:
- Must use `interface` (OOP contract), not `type`
- `generateStructured<T>(instruction, schema, context?)` must use a generic `z.ZodSchema<T>` parameter
- Every method must have a documented return type — no `any` in method signatures
- `generateImage()` must accept prompt string at minimum — additional options via `ImageOptions`

### AC-3: Cloud Providers (OpenAiClient, GeminiClient) Route Through Backend Proxy
**Given** cloud AI providers require API keys
**When** `OpenAiClient` or `GeminiClient` is instantiated
**Then** both route all AI requests through the Firebase Functions backend using `GameApiClient` — API keys never leave the server

**Test Hooks**:
- Unit: `test -f packages/frontend/api-core/src/ai/clients/openai_client.ts`
- Unit: `test -f packages/frontend/api-core/src/ai/clients/gemini_client.ts`
- Unit: Both clients implement `FrontendAiInterface` — TypeScript compiles
- Unit: Both constructors accept `{ apiClient: GameApiClientInterface, model?: string }`
- Unit: `openaiClient.generateDialogue(...)` calls `this.apiClient.post('/api/prompt_ai', body)` under the hood
- Unit: `geminiClient.generateDialogue(...)` also calls `this.apiClient.post('/api/prompt_ai', body)` but with `provider: 'gemini'` in the body
- Unit: Neither `openai_client.ts` nor `gemini_client.ts` import from `openai`, `@google/generative-ai`, or any vendor SDK

**Watch Points**:
- `OpenAiClient` and `GeminiClient` are thin wrappers — they format requests for the backend and unmarshal responses. The actual AI calls happen server-side
- The backend `prompt_ai` endpoint (from C-015) already supports provider selection — these clients set the provider flag
- API keys are NEVER stored or used client-side — the `GameApiClient` authenticates via auth token (not API key)

### AC-4: Local Providers (Ollama, ComfyUI, TTS) Connect Directly
**Given** local AI services run on the user's machine
**When** `OllamaClient`, `ComfyUiClient`, or `LocalTtsClient` is instantiated
**Then** they connect directly to localhost endpoints without routing through the backend

**Test Hooks**:
- Unit: `test -f packages/frontend/api-core/src/ai/clients/ollama_client.ts`
- Unit: `test -f packages/frontend/api-core/src/ai/clients/comfyui_client.ts`
- Unit: `test -f packages/frontend/api-core/src/ai/clients/local_tts_client.ts`
- Unit: `OllamaClient` constructor defaults `baseUrl` to `'http://localhost:11434'`
- Unit: `ComfyUiClient` constructor defaults `baseUrl` to `'http://localhost:8188'`
- Unit: `OllamaClient.generateDialogue(...)` calls `fetch('http://localhost:11434/api/chat', body)`
- Unit: `ComfyUiClient.generateImage(prompt)` calls `fetch('http://localhost:8188/prompt', { workflow })`
- Unit: `LocalTtsClient.synthesizeSpeech('hello')` calls `window.speechSynthesis.speak(utterance)` or gracefully degrades when unavailable
- Unit: `LocalTtsClient` guards against SSR: accessing `window.speechSynthesis` inside a try/catch
- Unit: All three implement `FrontendAiInterface` — TypeScript compiles
- Unit: `healthCheck()` returns `{ available: true }` when local service responds, `{ available: false }` when it doesn't
- Unit: All three have `capabilities.isLocal === true`

**Watch Points**:
- Local services may not be running — `healthCheck()` must return `{ available: false }` without throwing
- `LocalTtsClient` must work as a no-op in environments without `window.speechSynthesis` (SSR, headless CI) — never throw
- `ComfyUiClient` needs a configured workflow — if none provided, `generateImage()` should throw a clear error
- All local clients must support configurable timeouts (local services may be slow on first request)
- `OllamaClient` should support both `/api/generate` and `/api/chat` endpoints (Ollama provides both)

### AC-5: MockAiClient for Deterministic TDD
**Given** the `FrontendAiInterface`
**When** unit tests need deterministic AI responses without API costs or local services
**Then** `MockAiClient` implements the interface with seedable responses, call history, and `reset()` — all zero-dependency

**Test Hooks**:
- Unit: `test -f packages/frontend/api-core/src/ai/mock/mock_ai_client.ts`
- Unit: `MockAiClient implements FrontendAiInterface` compiles
- Unit: `mock.seedDialogue('hello', { text: 'Hi there, traveller!' })` → `mock.generateDialogue(...)` returns `{ text: 'Hi there, traveller!' }`
- Unit: `mock.generateStructured(personaSchema, ...)` returns valid data matching the Zod schema
- Unit: `mock.synthesizeSpeech('hello')` returns `{ audioData: null, durationMs: 0, voicesAvailable: ['mock'] }`
- Unit: `mock.generateImage('a castle')` returns `{ imageUrl: 'mock://placeholder.png', width: 512, height: 512 }`
- Unit: `mock.healthCheck()` returns `{ available: true, latencyMs: 0 }`
- Unit: `mock.getCallHistory()` returns chronological list of all method calls with arguments
- Unit: `mock.reset()` clears all seeded responses and call history
- Unit: `mock` can be configured to simulate failures: `mock.setFailMode('network_error')` → subsequent calls throw

**Watch Points**:
- `generateStructured()` must return data that passes the provided Zod schema (use `zocker` or manual mock factory)
- `getCallHistory()` must record ALL method calls, not just dialogue
- Mock must NOT throw unless `setFailMode()` is explicitly configured
- `generateImage()` must return a mock URL, not a real image blob

### AC-6: Factory Function Creates Correct Provider at Runtime
**Given** the provider configuration
**When** `createAiClient(provider, options)` is called
**Then** it returns the correct implementation based on the provider string

**Test Hooks**:
- Unit: `test -f packages/frontend/api-core/src/ai/factory.ts`
- Unit: `createAiClient('openai', { apiClient })` returns instance of `OpenAiClient`
- Unit: `createAiClient('gemini', { apiClient })` returns instance of `GeminiClient`
- Unit: `createAiClient('ollama', { ollama: { model: 'llama3' } })` returns instance of `OllamaClient`
- Unit: `createAiClient('comfyui', { comfyui: { workflowId: 'wf-1' } })` returns instance of `ComfyUiClient`
- Unit: `createAiClient('local-tts', {})` returns instance of `LocalTtsClient`
- Unit: `createAiClient('mock', {})` returns instance of `MockAiClient`
- Unit: `createAiClient('unknown' as any, {})` throws a clear `AiClientError('unsupported_provider')`

**Watch Points**:
- Factory must validate that required options are present (e.g., `comfyui` needs `workflowId`, `openai`/`gemini` need `apiClient`)
- Factory must NOT eagerly initialize connections — construction is lazy, `healthCheck()` is the connection test
- The factory function must not import all implementation files eagerly — use dynamic `import()` or lazy require to keep the bundle lean

### AC-7: Game Engine Services Layer Integrates Both Abstractions
**Given** the `GameApiClient` and `FrontendAiInterface`
**When** the game engine's `GameApiService` and `GameAiService` are created
**Then** they provide game-specific methods (fetch NPC data, generate dialogue, etc.) consumed by game systems

**Test Hooks**:
- Unit: `test -f apps/frontend/game/src/engine/services/api_service.ts`
- Unit: `test -f apps/frontend/game/src/engine/services/ai_service.ts`
- Unit: `test -f apps/frontend/game/src/engine/services/ai_config.ts`
- Unit: `GameApiService` accepts a `GameApiClientInterface` in its constructor
- Unit: `GameAiService` accepts a `FrontendAiInterface` in its constructor
- Unit: `GameApiService.fetchNpcData(npcId)` calls `this.client.get('/npc/' + npcId)` and returns typed NpcData
- Unit: `GameAiService.generateNpcDialogue(npcId, context)` calls `this.aiClient.generateDialogue(...)` and returns string
- Unit: `ai_config.ts` reads provider selection from `localStorage`, URL params, or `import.meta.env.VITE_AI_PROVIDER` (with sensible defaults)
- Unit: Game services import ZERO Svelte, ZERO Firebase SDK modules

**Watch Points**:
- Services are optional — `GameWorld` constructor accepts them as optional parameters (`apiService?: GameApiService`)
- Without services, the game engine still works (offline mode with local rendering — no network dependency)
- `ai_config.ts` must have a priority chain: URL param > localStorage > env var > default ('ollama')
- Services must be destroyable — provide a `destroy()` method that aborts pending requests

### AC-8: Unit Test Suite Covers All Implementations
**Given** all API and AI abstractions
**When** the test suite runs
**Then** every abstraction has Vitest (bun:test) unit tests covering happy path, error cases, and edge cases

**Test Hooks**:
- Unit: `test -f packages/frontend/api-core/tests/api/game_api_client.test.ts`
- Unit: `test -f packages/frontend/api-core/tests/api/game_api_client.contract.test.ts`
- Unit: `test -f packages/frontend/api-core/tests/ai/frontend_ai_interface.test.ts`
- Unit: `test -f packages/frontend/api-core/tests/ai/ollama_client.test.ts`
- Unit: `test -f packages/frontend/api-core/tests/ai/comfyui_client.test.ts`
- Unit: `test -f packages/frontend/api-core/tests/ai/local_tts_client.test.ts`
- Unit: `test -f packages/frontend/api-core/tests/ai/mock_ai_client.test.ts`
- Unit: `bun test` passes in `packages/frontend/api-core/` (no network, no API keys needed)
- Unit: Contract test `frontend_ai_interface.test.ts` verifies:
  - All 6 methods exist on all implementations
  - All implementations return types matching the interface
  - `capabilities` flags match the provider type (local vs cloud)
  - `name` property matches the provider

**Watch Points**:
- All tests must pass without network (mock `fetch()`, mock `window.speechSynthesis`, no real Ollama/ComfyUI)
- `ollama_client.test.ts` must use `mock.fetch` or a spy to verify HTTP calls without hitting localhost
- `local_tts_client.test.ts` must have separate test blocks for `window.speechSynthesis` available vs unavailable
- `comfyui_client.test.ts` must test both HTTP prompt submission and polling for result

### AC-9: Playwright Integration Test Validates Local Provider Discovery
**Given** the local provider implementations
**When** the Playwright integration test runs
**Then** it verifies that local provider health checks work (gracefully reporting unavailable when no local service is running) and the mock provider returns correct data in a browser-like context

**Test Hooks**:
- Integration: `test -f packages/frontend/api-core/playground/frontend-ai-playground.spec.ts`
- Integration: Test creates a `MockAiClient` and verifies all 6 methods return correct shapes
- Integration: Test creates an `OllamaClient` with a mock `fetch` override — verifies no real network call happens
- Integration: Test creates a `LocalTtsClient` — verifies it gracefully reports TTS unavailable (no crash) in headless Playwright
- Integration: Test imports `createAiClient` factory from the package's public API — verifies the package exports are correct
- Integration: Test creates a `GameApiClient` with a mock base URL — verifies fetch interception works end-to-end

**Watch Points**:
- Playwright tests must NOT require real Ollama/ComfyUI instances — all tests use mocked HTTP
- The integration test is a "smoke test" — validates the package loads and constructs correctly in a browser context
- Test must run in the `apps/frontend/game/` Playwright suite (that's where the game engine E2E tests live) OR in a standalone Playwright config in the `api-core` package
- If running in the game engine's Playwright, the `api-core` package must be importable as `@aikami/api-core`

## Implementation Notes

### Coding Rules (must be followed throughout implementation)

1. **Prefer `const` over `function`** — Arrow functions for callbacks, module-level functions, and factory functions. `function` reserved for generator functions (`function*`) and method overrides in classes.
2. **Escape early** — Every method begins with guard clauses. Check URL validity, auth state, provider availability — return or throw before proceeding.
3. **Always `{}` for `if`** — Every `if`, `else if`, `else`, `for`, `while`, `try/catch` body wrapped in curly braces `{}`, even single-line.
4. **`type` for data, `interface` for contracts** — `type` for `AiProviderCapabilities`, `DialogueOptions`, `TtsOptions`, `ImageResult`. `interface` exclusively for `GameApiClientInterface` and `FrontendAiInterface` (the OOP contracts).
5. **Tests first** — Write `mock_ai_client.test.ts` before `game_api_client.ts`. Write the contract test suite against `MockAiClient` first. Add real provider implementations to pass the same contract tests.
6. **Snake_case filenames** — Match the game engine's convention: `game_api_client.ts`, `frontend_ai_interface.ts`, `openai_client.ts`, `ollama_client.ts`.
7. **No Svelte runes** — This package is for the game engine. Zero imports from `svelte`, `$state`, `$derived`, `$effect`, `@aikami/frontend-services`, or any SvelteKit modules.
8. **No Firebase SDKs** — The game engine communicates with the backend via plain `fetch()`. Zero imports from `firebase`, `@firebase/*`, or Firebase client SDKs.
9. **No vendor SDKs in public API** — The interface and all shared types must never reference `openai`, `@google/generative-ai`, Ollama types, or ComfyUI types. Vendor types stay confined to their respective client files.

### Files to create

**Package scaffolding:**
- `packages/frontend/api-core/moon.yml` — moon project config (library, frontend stack)
- `packages/frontend/api-core/package.json` — dependencies
- `packages/frontend/api-core/tsconfig.json` — TypeScript config
- `packages/frontend/api-core/src/index.ts` — public exports

**API Client:**
- `packages/frontend/api-core/src/api/game_api_client_interface.ts` — `GameApiClientInterface`
- `packages/frontend/api-core/src/api/game_api_client.ts` — `GameApiClient` implementation (fetch-based)
- `packages/frontend/api-core/src/api/errors.ts` — `ApiError`, error codes
- `packages/frontend/api-core/src/api/types.ts` — `RequestOptions`, `AuthConfig`, response types

**AI Interface and Types:**
- `packages/frontend/api-core/src/ai/frontend_ai_interface.ts` — `FrontendAiInterface`
- `packages/frontend/api-core/src/ai/types.ts` — `AiProviderCapabilities`, `DialogueContext`, `DialogueResponse`, `ImageOptions`, `ImageResult`, `TtsOptions`, `SpeechResult`, `ContentDescriptionOptions`, `DialogueOptions`, `HealthCheckResult`

**Cloud Clients:**
- `packages/frontend/api-core/src/ai/clients/openai_client.ts` — `OpenAiClient`
- `packages/frontend/api-core/src/ai/clients/gemini_client.ts` — `GeminiClient`

**Local Clients:**
- `packages/frontend/api-core/src/ai/clients/ollama_client.ts` — `OllamaClient`
- `packages/frontend/api-core/src/ai/clients/comfyui_client.ts` — `ComfyUiClient`
- `packages/frontend/api-core/src/ai/clients/local_tts_client.ts` — `LocalTtsClient`

**Mock and Factory:**
- `packages/frontend/api-core/src/ai/mock/mock_ai_client.ts` — `MockAiClient`
- `packages/frontend/api-core/src/ai/factory.ts` — `createAiClient()` factory function

**Tests:**
- `packages/frontend/api-core/tests/api/game_api_client.test.ts`
- `packages/frontend/api-core/tests/api/game_api_client.contract.test.ts`
- `packages/frontend/api-core/tests/ai/frontend_ai_interface.test.ts`
- `packages/frontend/api-core/tests/ai/ollama_client.test.ts`
- `packages/frontend/api-core/tests/ai/comfyui_client.test.ts`
- `packages/frontend/api-core/tests/ai/local_tts_client.test.ts`
- `packages/frontend/api-core/tests/ai/mock_ai_client.test.ts`
- `packages/frontend/api-core/tests/ai/factory.test.ts`

**Playwright integration:**
- `packages/frontend/api-core/playground/frontend-ai-playground.spec.ts`

**Game engine integration:**
- `apps/frontend/game/src/engine/services/api_service.ts` — `GameApiService`
- `apps/frontend/game/src/engine/services/ai_service.ts` — `GameAiService`
- `apps/frontend/game/src/engine/services/ai_config.ts` — provider configuration

### Files to modify

- `.moon/workspace.yml` — add `frontend-api-core` project entry
- `apps/frontend/game/package.json` — add `@aikami/api-core: "workspace:*"` dependency
- `apps/frontend/game/src/engine/game_world.ts` — add optional `apiService` and `aiService` constructor parameters
- `packages/shared/types/src/index.ts` — add any game-specific types if needed (DialogueContext, etc.)

### Files to delete

- None (this is additive — no existing files are replaced)

### Order of operations

1. **Create package scaffolding**: `moon.yml`, `package.json`, `tsconfig.json`, `src/index.ts`
2. **Register in workspace**: Add `frontend-api-core` to `.moon/workspace.yml`
3. **Write types**: `types.ts` for API client, `types.ts` for AI interface (capabilities, options, results)
4. **Write GameApiClientInterface + GameApiClient**: Pure fetch-based HTTP wrapper
5. **Write ApiError and error codes**
6. **Write MockApiClient test helper** (to test GameApiClient without real HTTP)
7. **Write GameApiClient tests**: Unit tests with mock fetch — **tests pass**
8. **Write FrontendAiInterface**: Pure TypeScript interface, zero vendor imports
9. **Write MockAiClient**: Implements FrontendAiInterface, zero deps
10. **Write contract test suite** (`frontend_ai_interface.test.ts`): Runs against MockAiClient — **tests pass**
11. **Write OpenAiClient**: Routes through GameApiClient to backend proxy
12. **Write GeminiClient**: Routes through GameApiClient to backend proxy
13. **Write OllamaClient**: Direct HTTP to localhost:11434
14. **Write ComfyUiClient**: Direct HTTP to localhost:8188
15. **Write LocalTtsClient**: Web Speech API wrapper with graceful fallback
16. **Write provider tests**: Each client tested in isolation with mocked network
17. **Write factory**: `createAiClient()` with lazy initialization
18. **Write factory tests**
19. **Write game engine services**: `GameApiService`, `GameAiService`, `ai_config.ts`
20. **Update GameWorld**: Optional service injection
21. **Write Playwright integration test**: Mock provider end-to-end in browser context
22. **Run full test suite**: `bun test` in `packages/frontend/api-core/` — all pass
23. **Run typecheck across dependents**: `bun run typecheck` in game + api-core + types

### Verification

- `bun test` in `packages/frontend/api-core/` passes (all mock, no network, < 2 seconds)
- `bun run typecheck` passes in `packages/frontend/api-core/`
- `bun run typecheck` passes in `apps/frontend/game/` (with `@aikami/api-core` dependency)
- `bunx moon run :typecheck --affected` reports zero errors
- All game engine service files import zero Svelte/Firebase modules (verified via grep)
- All AI provider client files import zero vendor SDKs (verified via grep)
- `FrontendAiInterface` has zero imports from `openai`, `@google/generative-ai` (verified via grep)
- `GameApiClientInterface` has zero imports from `firebase`, `@firebase/*` (verified via grep)

## Edge Cases & Gotchas

- **GameApiClient auth flow**: Auth tokens expire (Firebase ID tokens last ~1 hour). The `GameApiClient` provides `setAuthToken()` — the SvelteKit `GameViewModel` refreshes tokens and pushes them through the `EngineBridge` as a command. The client does NOT handle token refresh internally (that's the UI layer's responsibility).
- **Local service not running**: `OllamaClient.healthCheck()` returns `{ available: false }` — the game engine should degrade gracefully (use mock, show "AI not available" in dialog, or skip NPC dialogue generation). Never crash the game.
- **ComfyUI workflow configuration**: ComfyUI requires a pre-defined workflow JSON to function. The `ComfyUiClient` constructor requires `workflowId` — if not provided, `generateImage()` throws a clear error. The game engine's `ai_config.ts` should validate this at startup.
- **Web Speech API availability**: `window.speechSynthesis` is not available in all browsers (notably, some mobile browsers). `LocalTtsClient` must check availability in the constructor and set `capabilities.speech = false` if unavailable. All methods must be safe to call even when speech is unavailable (return a no-op result).
- **Ollama model availability**: Ollama serves models on-demand — the requested model may not be downloaded yet. `OllamaClient.generateDialogue()` should handle `404` or `model not found` errors gracefully, translating them to a user-friendly `AiClientError('model_not_found')`. The `healthCheck()` only checks that the server is running, not that specific models are loaded.
- **CORS**: Cloud providers route through the backend (same origin — no CORS issues). Local providers (Ollama, ComfyUI) are cross-origin (localhost:11434, localhost:8188 from the game's port). These local services may not set `Access-Control-Allow-Origin` headers. The `GameApiClient` and local clients must handle CORS errors gracefully (report as `AiClientError('cors_blocked')` with guidance to configure the local service's CORS settings).
- **ComfyUI request/response pattern**: ComfyUI is asynchronous — POST to `/prompt` returns a `prompt_id`, then you poll `/history/{prompt_id}` until the result is ready. The `ComfyUiClient.generateImage()` must handle this two-phase protocol internally, returning a single `Promise<ImageResult>`.
- **Circular dependency prevention**: The game engine (`apps/frontend/game`) depends on `@aikami/api-core`. `api-core` must NOT depend on any SvelteKit package (`@aikami/frontend-services`, `@aikami/frontend-components`, etc.) — this would create a circular dependency and bundle Svelte into the game engine's standalone build.
- **Fetch polyfill in Tauri**: Tauri's webview supports `fetch()` natively (same as modern Chrome). No polyfill needed. However, WS connections (ComfyUI streaming) may require Tauri's IPC for low-level socket access — keep ComfyUI as HTTP-only for now (poll-based pattern avoids websockets).
- **Mock AiClient determinism**: `generateImage()` returns a fixed placeholder URL. `synthesizeSpeech()` returns zero-duration data. These are sufficient for TDD — they validate the type contract without producing real media.
- **Bundle size**: `api-core` is imported by the game engine, which loads on the game route (not the landing page). Still, keep bundling lean: cloud clients (OpenAiClient, GeminiClient) are thin wrappers (~50 lines each). The `openai` or `@google/generative-ai` SDKs are NOT bundled — they live on the backend only. Local clients have minimal deps (Ollama is just `fetch`, TTS uses browser API, ComfyUI uses `fetch` with polling).
