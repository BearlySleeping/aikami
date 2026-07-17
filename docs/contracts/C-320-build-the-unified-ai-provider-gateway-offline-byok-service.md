# Contract C-320: Build the Unified AI Provider Gateway (Offline / BYOK / Service)

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-320 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | New `packages/frontend/ai-gateway` package (moon id `frontend-ai-gateway`) + shared types/schemas — one `AiProviderGateway` call surface for text/image/voice across `offline` / `byok` / `service` modes |
| **Priority** | P0 — every AI-dependent contract in the backlog (C-318, C-322, C-323, C-324, C-328, C-330, C-348…) needs one call surface that does not care whether it runs against a local model, a user's cloud key, or Aikami's hosted service |
| **Dependencies** | C-056 (completed — hybrid text gateway logic in `packages/backend/ai` to absorb), C-133 (completed — flexible provider onboarding), C-134 (completed — inline provider setup), C-230 (completed — Connection abstraction in `config_service`), packages: `@aikami/schemas`, `@aikami/types`, `@aikami/backend/ai` |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → none (developer-facing gateway; player-facing surfaces are C-318/C-322) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: AI calls are split across at least four independent surfaces, each with its own routing, streaming, error, and detection logic:
  1. `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` — client SSE streaming + TypeBox structured extraction, resolves provider/model/key from `configService`, hand-rolls endpoint fallbacks (`resolveChatUrl`), timeouts (`FETCH_TIMEOUT_MS`, `FIRST_CHUNK_TIMEOUT_MS`), and abort handling.
  2. `apps/frontend/client/src/lib/services/ai/ai_service.svelte.ts` — a completely separate path that calls the Firebase callable `ai` function (`firebaseFunctionsService.call('ai', …)`), i.e. an implicit "service" mode with no shared interface.
  3. `packages/backend/ai` — the C-056 hybrid text gateway (`routeTextGeneration`, `createOllamaStream`, `createOpenRouterStream`, `OpenAiService`, `GeminiService`, `CircuitBreaker`, `SyntheticSseMock`) consumed only by `apps/backend/firebase/src/controllers/callable/ai.ts` and `.../api/prompt_ai.ts` via `handleAIEndpoint`.
  4. `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts` — standalone `_pingOllama()` + `checkCloudTextConfig()` detection that duplicates provider knowledge.
  Image (`image_generation_service.svelte.ts` → ComfyUI REST) and voice (`tts_service.svelte.ts` → Kokoro WebGPU/REST) each have their own ad hoc availability checks and no common mode concept. No code expresses the product's three-mode vision (`offline` / `byok` / `service`); "which provider handles this call" is re-decided ad hoc at every call site.
- **Reproduction**: grep `fetch(` + provider URLs across `apps/frontend/client/src/lib/services/{ai,capability,image,audio}` — four unrelated resolution paths for "call an AI". Compare `text_generation_service.streamChat()` (direct provider SSE) vs `ai_service.sendMessageToAI()` (Firebase callable): same product intent, disjoint interfaces, disjoint error shapes.
- **Existing implementation to reuse**:
  - `packages/backend/ai/src/lib/{text_generation_router,ollama_adapter,openrouter_adapter,openai_service,gemini_service,circuit_breaker,rate_limiter,synthetic_sse_mock,errors}.ts` (C-056; fetch-based, environment-agnostic).
  - `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` (SSE parsing, structured extraction, first-chunk timeout, `cancelAll()`).
  - `apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts` + `packages/backend/image` (`ImageGenerationOrchestrator`, `ComfyUIRestClient`).
  - `apps/frontend/client/src/lib/services/audio/tts_service.svelte.ts` (Kokoro WebGPU + REST detection).
  - `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts` (`_pingOllama()` proxy/native fallback, timeout discipline).
  - `apps/frontend/client/src/lib/utils/crypto_vault.ts` (AES-GCM key storage) and `config_service.svelte.ts` Connections (C-230).
- **Known gaps**: no `AiMode`/`AiCapability` types anywhere; no unified error shape (client throws raw `Error`, backend has `AiServiceError`); no per-capability mode resolution; `service` mode exists only implicitly as the Firebase callable; detection logic is not exposed as a reusable API; retry/cancellation semantics differ per surface.
- **Baseline tests** (run before starting):
  - `apps/frontend/client/src/lib/services/ai/text_generation_service.test.ts`
  - `apps/frontend/client/src/lib/services/ai/stream_orchestrator_service.test.ts`
  - `apps/frontend/client/src/lib/services/capability/capability_service.test.ts`
  - `apps/frontend/client/src/lib/services/config/config_service.test.ts`
  - `packages/backend/ai/tests/ai_service.test.ts`
  - `packages/backend/image/tests/{orchestrator,rest_client}.test.ts`
  - `apps/frontend/client/src/lib/services/audio/tts_service.test.ts`

## User Outcome

After this contract, a **developer** can call `aiProviderGateway.generateText()` / `generateImage()` / `generateVoice()` from any client feature without knowing or re-checking which provider serves it; mode (`offline` / `byok` / `service`) is resolved once per capability at the gateway boundary. A **player** experiences identical streaming/cancellation behavior as today (no regression), and gains a consistent, typed failure surface that later contracts (C-318 capability UX, C-323 AI gate, C-328 dialogue fallbacks) build on.

## Success Measures

- **Time/latency target**: zero added latency vs. current direct calls — gateway resolution is synchronous in-memory dispatch; existing streaming timeouts preserved (90s fetch, 15s first chunk); local detection pings bounded at ≤3s (current `PING_TIMEOUT_MS`).
- **Offline/degraded behavior**: `offline` mode works with zero network (Ollama/ComfyUI/Kokoro on localhost); a failed call surfaces a typed `AiGatewayError` with `mode`, `capability`, and `reason` so callers can apply authored fallbacks (C-328) — never a silent hang.
- **Production journey enabled**: single provider surface that C-318/C-322 wire into capability setup and settings, and that C-323 gates campaign creation on. Prevents a second migration when the Phase 5 hosted `service` mode activates.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Engine-level AI client interface (game-loop) | `packages/shared/types/src/lib/ai/frontend_ai_interface.ts` (`FrontendAiInterface`) + implementations (`OllamaClient`, `OpenAiClient`, `GeminiClient`, `ComfyUiClient`, `LocalTtsClient`, `MockAiClient`) in `apps/frontend/client/src/lib/services/ai/clients/` | note — this contract builds a **service-layer** gateway, not an engine-level interface. `FrontendAiInterface` is game-domain-specific (`generateDialogue`, `generateStructured`); `AiProviderGateway` is app-service-generic (`generateText`, `generateImage`, `generateVoice`, `detect`). They serve different consumers and the gateway wraps service code paths (`text_generation_service`, `ai_service`), not engine client implementations. No conflict, but implementers must be aware both exist. |
| Text SSE streaming + structured extraction (client) | `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` | modify — becomes a thin consumer of the gateway; its SSE/extraction internals move into the gateway's text adapters |
| Text provider routing + adapters (server) | `packages/backend/ai/src/lib/{text_generation_router,ollama_adapter,openrouter_adapter,openai_service,gemini_service}.ts` | reuse — wrapped by gateway adapters, not rewritten |
| Circuit breaker / rate limiter / SSE mock | `packages/backend/ai/src/lib/{circuit_breaker,rate_limiter,synthetic_sse_mock}.ts` | reuse — gateway retry policy and test doubles |
| Firebase callable AI path | `apps/frontend/client/src/lib/services/ai/ai_service.svelte.ts` + `apps/backend/firebase/src/controllers/callable/ai.ts` | modify (client) — `ai_service` routes through the gateway `service` adapter; backend controller migration is C-324 |
| Image generation (ComfyUI) | `apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts`, `packages/backend/image` (`ImageGenerationOrchestrator`, `ComfyUIRestClient`) | reuse — gateway `generateImage()` delegates to the existing client service/orchestrator |
| Voice synthesis (Kokoro WebGPU/REST) | `apps/frontend/client/src/lib/services/audio/tts_service.svelte.ts` | reuse — gateway `generateVoice()` delegates to `ttsService.synthesize` path |
| Provider detection (Ollama ping, cloud config check) | `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts` (`_pingOllama`, `checkCloudTextConfig`, `detectImage`) | modify — ping/config-check logic moves into gateway detection API; `capability_service` consumer swap is C-322 |
| Key storage | `apps/frontend/client/src/lib/utils/crypto_vault.ts` | reuse — byok adapters read keys via existing config/vault path; no new storage |
| Connection model (per-scope provider selection) | `config_service.svelte.ts` + `$types/connection` (C-230) | reuse — gateway resolves byok config from Connections; UX layer stays separate |
| Capability shapes | `packages/shared/schemas/src/lib/capability.ts`, `.../game/campaign.ts` (`CapabilitySnapshot`, `CapabilityProfile`) | reuse — unchanged; gateway detection results are convertible to `DetectionStatus` |

## Overview

Build one `AiProviderGateway` — a typed, mode-resolving dispatch layer for the three AI capabilities (`text`, `image`, `voice`). Each capability independently resolves to exactly one of three adapter families: `offline` (Ollama / ComfyUI / Kokoro), `byok` (OpenRouter / OpenAI / Gemini / custom OpenAI-compatible, keys from the existing vault), or `service` (Aikami-hosted; interface + stub only in this contract). Existing, working provider code is wrapped, not rewritten. Client text call sites (`text_generation_service`, `ai_service`) migrate to the gateway; streaming (SSE), cancellation (`AbortSignal`), retry, and error shape become uniform across capabilities and modes.

## Design Reference

- `packages/backend/ai` (C-056) — adapter quality bar: dependency-injectable adapter functions, `SyntheticSseMock` for deterministic streaming tests, `AiServiceError` typed errors, `OLLAMA_VRAM_EVICTION_PARAMS`.
- `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` — SSE parsing, first-chunk timeout, `cancelAll()` abort registry, structured extraction with TypeBox `schemaCheck`.
- `packages/frontend/services` (`BaseFrontendClass` + singleton `create()` pattern) — the client-facing gateway service follows this exactly.
- Schema-first typing: `packages/shared/schemas/src/lib/capability.ts` → `packages/shared/types/src/lib/capability.ts` (`Static<typeof Schema>` derivation) — new gateway schemas follow this pattern.
- C-230 Connection abstraction (`config_service.svelte.ts`) — UX precedent for per-scope provider selection, deliberately kept **above** this lower-level gateway.
- `.pi/skills/new-project/SKILL.md` — scaffold for the new `packages/frontend/ai-gateway` moon project.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

1. **Shared contract types** — `packages/shared/schemas/src/lib/ai_gateway.ts` (TypeBox) + `packages/shared/types/src/lib/ai_gateway.ts` (`Static<>`-derived): `AiMode`, `AiCapability`, `AiGatewayErrorCode`, request/response/config shapes. Exported from each package's `src/index.ts` barrel.
2. **Gateway package** — new `packages/frontend/ai-gateway` (moon id `frontend-ai-gateway`, import alias `@aikami/frontend/ai-gateway`, consistent with the `@aikami/frontend/<name>` slash pattern). 🔴 After scaffolding, register the alias in `apps/frontend/client/svelte.config.js` (add `@aikami/frontend/ai-gateway` → `toPackagesPath('frontend/ai-gateway/src')` and the `/*` variant) so the client can resolve imports from the new package. Contains:
   - `AiProviderGateway` type (the call surface) and its default implementation.
   - Mode resolution: one `AiModeResolution` per capability, computed once from provided config (not re-checked per call site).
   - Adapter contract (`AiTextAdapter`, `AiImageAdapter`, `AiVoiceAdapter` — `type` aliases) + registry keyed by `(capability, mode)`.
   - Cross-cutting policy: retry (reuse `CircuitBreaker`/`TokenBucketRateLimiter` semantics from `@aikami/backend/ai` where environment-agnostic), cancellation propagation, error normalization to `AiGatewayError`.
   - Detection API: `detect(capability)` returning availability info (wraps today's Ollama proxy/native ping, ComfyUI `object_info` ping, Kokoro checks, cloud config presence check) with bounded timeouts.
   - `service` mode: adapter that conforms to the contract; text `service` adapter may delegate to the existing Firebase callable path; plus a deterministic stub/mock implementation for tests. No billing/metering.
3. **Client integration** — `apps/frontend/client`:
   - `text_generation_service.svelte.ts` keeps its public interface (`streamChat`, `extractStructure`, `cancelAll`) but delegates to the gateway; its provider-specific internals move into gateway text adapters (`offline` = Ollama/local OpenAI-compatible endpoints, `byok` = cloud endpoints with vault keys).
   - `ai_service.svelte.ts` routes `sendMessageToAI`/`createPersona` through the gateway (`service`-mode text adapter wrapping the existing callable), preserving current behavior.
   - Gateway singleton exposed via the `$services` barrel per svelte-conventions.
4. **Server mirror** — the gateway core (types, adapter contract, error shape) must be importable server-side; `packages/backend/ai` remains the server adapter source. Migrating `apps/backend/firebase/src/controllers/{callable/ai.ts,api/prompt_ai.ts}` onto the gateway is **C-324**, not this contract — but nothing in the gateway core may depend on browser globals except inside client-only adapters.
5. **Boundaries respected** — no types/schemas/constants defined in `apps/**` (Pillar 2); no `+server.ts` (Pillar 1); snake_case files; `type` aliases only; `ClassName.create()` for services.

## State & Data Models

TypeBox schemas in `packages/shared/schemas/src/lib/ai_gateway.ts`; types derived via `Static<>` in `packages/shared/types/src/lib/ai_gateway.ts`. Conceptual shapes:

```typescript
/** Which adapter family serves a capability. */
type AiMode = 'offline' | 'byok' | 'service';

/** The three AI capabilities behind the gateway. */
type AiCapability = 'text' | 'image' | 'voice';

/** Normalized gateway error codes across all modes/capabilities. */
type AiGatewayErrorCode =
	| 'provider_unreachable'
	| 'not_configured'
	| 'auth_failed'
	| 'rate_limited'
	| 'cancelled'
	| 'timeout'
	| 'invalid_response'
	| 'mode_unavailable'; // e.g. selecting 'service' before Phase 5 activation

/** Typed error surfaced by every gateway call. */
type AiGatewayError = {
	code: AiGatewayErrorCode;
	capability: AiCapability;
	mode: AiMode;
	provider?: string;
	message: string;
	retryable: boolean;
};

/** Per-capability resolved routing, computed once at the gateway boundary. */
type AiModeResolution = {
	capability: AiCapability;
	mode: AiMode;
	provider: string; // 'ollama' | 'openrouter' | 'openai' | 'gemini' | 'openai_compatible' | 'comfyui' | 'kokoro' | 'aikami_service'
	endpoint?: string;
	model?: string;
};

/** Detection result per capability (convertible to existing DetectionStatus). */
type AiDetectionResult = {
	capability: AiCapability;
	available: boolean;
	mode?: AiMode;
	provider?: string;
	detail?: string;
	checkedAt: string; // ISO timestamp
};

/** The single call surface. Streaming via onChunk; cancellation via AbortSignal. */
type AiProviderGateway = {
	resolveMode(capability: AiCapability): AiModeResolution;
	detect(capability: AiCapability): Promise<AiDetectionResult>;
	generateText(options: {
		messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
		onChunk?: (text: string) => void;
		schema?: Record<string, unknown>; // structured extraction path
		schemaName?: string;
		model?: string;
		signal?: AbortSignal;
	}): Promise<{ text: string; structured?: unknown }>;
	generateImage(options: {
		prompt: string;
		checkpoint?: string;
		signal?: AbortSignal;
	}): Promise<{ url: string }>;
	generateVoice(options: {
		text: string;
		voiceId?: string;
		signal?: AbortSignal;
	}): Promise<{ audio: ArrayBuffer | ReadableStream<Uint8Array> }>;
	cancelAll(): void;
};
```

Existing shapes reused unchanged: `CapabilitySnapshot`, `DetectionStatus` (`packages/shared/schemas/src/lib/capability.ts`), `CapabilityProfile` (`.../game/campaign.ts`), `Connection` (`$types/connection`). No persisted shape changes.

## Quality Requirements

- **Offline/degraded mode**: `offline` adapters work with zero network beyond localhost; unreachable providers fail fast (≤3s detection, 15s first-chunk / 90s total streaming timeouts) with typed `AiGatewayError` — never hang, never silently degrade to a different mode without the resolution saying so.
- **Accessibility/input**: N/A — headless service layer; UI surfaces are C-318/C-322.
- **Performance budget**: mode resolution is synchronous in-memory (<1ms); no extra network hops vs. today; Ollama calls preserve `OLLAMA_VRAM_EVICTION_PARAMS` (`keep_alive: 0`, `num_parallel: 1`) from C-056 to avoid VRAM deadlocks with image generation.
- **Security/privacy**: byok keys read via existing `crypto_vault`/`config_service` path only; keys never appear in logs, error messages, or `AiGatewayError.detail`; no new key storage introduced.
- **Persistence/migration**: N/A for gateway state (in-memory); provider config continues to live where it lives today (vault/localStorage via `config_service`).
- **Cancellation/retry/idempotency**: every `generate*` accepts `AbortSignal` and propagates it to the upstream fetch (client disconnect must abort the provider stream — C-056 VRAM lesson); `cancelAll()` aborts all in-flight calls; retry policy is per-adapter and never retries after `cancelled`; detection calls are idempotent.
- **Observability**: gateway is a `BaseFrontendClass` subclass on the client (auto-logged public methods via `create()`); each call logs resolved `(capability, mode, provider)` once at dispatch; errors logged with code but with secrets redacted.

## Migration & Rollback

N/A — no persistent state changes. Provider configuration, vault format, and capability profile schemas are unchanged. Code-level rollback: call sites keep their existing public interfaces (`streamChat`, `extractStructure`, `sendMessageToAI`, `generateImage`, `synthesize`), so reverting the gateway wiring is a localized import change; no data migration in either direction.

## Scope Boundaries

- **In Scope:**
  - `AiMode`, `AiCapability`, `AiGatewayError`, resolution/detection/request/response schemas in `packages/shared/schemas` + derived types in `packages/shared/types`.
  - New `packages/frontend/ai-gateway` package: gateway core, adapter registry, retry/cancellation/error normalization, detection API.
  - `offline` + `byok` adapters for **text** (wrapping existing Ollama/OpenRouter/OpenAI/Gemini/custom OpenAI-compatible logic), and `offline` adapters for **image** (ComfyUI via existing client service/orchestrator) and **voice** (Kokoro); `byok` image/voice adapters only insofar as existing cloud config already supports them (wrap, don't invent new providers).
  - `service` mode: interface conformance, hidden/disabled selection guard (`mode_unavailable`), deterministic stub for tests; text `service` adapter may wrap the existing Firebase callable to preserve `ai_service` behavior.
  - Migrating client call sites `text_generation_service.svelte.ts` and `ai_service.svelte.ts` onto the gateway behind their existing public interfaces.
  - Moving Ollama-ping / cloud-config-check / ComfyUI-ping logic into the gateway detection API (logic relocation only).
- **Out of Scope:**
  - Migrating `capability_service.svelte.ts`, `config_service.svelte.ts`, `providers_view_model.svelte.ts` consumers onto gateway detection — **C-322**.
  - The mandatory text-AI product gate and removal of the zero-AI campaign path — **C-323**.
  - Migrating `apps/backend/firebase/src/controllers/{callable/ai.ts,api/prompt_ai.ts}` and deleting/folding `packages/backend/ai` — **C-324**.
  - `service`-mode billing, metering, quotas, hosted activation — Phase 5 contract.
  - Capability setup UI / guided connection flow — **C-318**.
  - Any new cloud provider integrations not already present in the codebase.
  - Local model lifecycle management (download, warmup) — **C-356**.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs, 4 projects touched (`schemas`, `types`, new `frontend-ai-gateway`, `client`). This is at the upper bound but cohesive: the backlog has already pre-split the consumer migrations into C-322 (capability/settings), C-323 (product gate), and C-324 (backend retirement) — splitting further would leave the gateway without a proving consumer. The only independently releasable seam inside this contract (text vs. image/voice wrapping) is kept because image/voice adapters are thin delegations to existing clients (AC-3), not new systems. No deferred phases hidden inside; `service` billing is explicitly another contract.

## Acceptance Criteria

### AC-1: Shared Gateway Contract Types Exist and Validate
**Given** `packages/shared/schemas` and `packages/shared/types`
**When** the gateway contract is defined
**Then** `AiMode`, `AiCapability`, `AiGatewayErrorCode`, `AiGatewayError`, `AiModeResolution`, and `AiDetectionResult` exist as TypeBox schemas with `Static<>`-derived types exported from both package roots, valid/invalid payloads are accepted/rejected by `schemaCheck`, and no gateway type is defined inside `apps/**` or the gateway package itself.

### AC-2: Text Calls Route Through the Gateway with Preserved Behavior
**Given** the existing client call sites `text_generation_service.streamChat()` / `extractStructure()` and `ai_service.sendMessageToAI()` / `createPersona()`
**When** they are migrated to `AiProviderGateway.generateText()`
**Then** their public interfaces and observable behavior (SSE chunk delivery order, first-chunk/total timeouts, `AbortSignal` cancellation aborting the upstream fetch, structured extraction with TypeBox validation, Ollama VRAM-eviction payload params) are preserved — the existing test suites pass with gateway-backed internals — and the `(capability, mode, provider)` resolution happens exactly once at the gateway boundary, with no provider/endpoint conditionals remaining at the call sites.

### AC-3: Image and Voice Wrap Existing Clients Unchanged
**Given** the existing ComfyUI image path (`image_generation_service` / `ImageGenerationOrchestrator`) and Kokoro voice path (`tts_service`)
**When** `generateImage()` and `generateVoice()` are called in `offline` mode
**Then** they delegate to the existing implementations (same request payloads, same outputs), current callers of those services keep working unchanged, and both methods accept and honor `AbortSignal` and normalize failures to `AiGatewayError`.

### AC-4: Service Mode Conforms but Is Guarded, and Errors Are Uniform
**Given** the `service` mode is not activated for any capability
**When** a caller resolves or selects `service` mode for a capability where it is unavailable
**Then** the gateway returns/throws a typed `AiGatewayError` with code `mode_unavailable` (never a crash or a silent fallback), a deterministic stub `service` adapter passes the same adapter-contract test suite as `offline`/`byok` adapters, and all adapters across all modes/capabilities surface failures exclusively as `AiGatewayError` (asserted by a shared contract test run against every registered adapter with the synthetic SSE mock).

### AC-5: Detection API Reaches Parity with Current Capability Pings
**Given** the detection logic currently in `capability_service.svelte.ts` (Ollama proxy ping with native fallback, cloud text config check, ComfyUI `object_info` ping, Kokoro availability)
**When** `gateway.detect(capability)` is called for each capability
**Then** it returns `AiDetectionResult`s equivalent to today's `DetectionStatus` outcomes for the same environment conditions (reachable / unreachable / configured), each check completes within the 3s timeout budget without blocking other capability checks, and results are convertible to the existing `DetectionStatus` union so C-322 can swap `capability_service` internals without shape changes.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/tests/ai_gateway.test.ts` | N/A | Filled during verification |
| AC-2 | Unit + Integration | `packages/frontend/ai-gateway/tests/text_adapters.test.ts`; existing `apps/frontend/client/src/lib/services/ai/text_generation_service.test.ts` passing against gateway internals | `/game` dialogue + `/setup` extraction flows (unchanged) | Filled during verification |
| AC-3 | Unit | `packages/frontend/ai-gateway/tests/image_voice_adapters.test.ts`; existing `image_generation_service` + `tts_service` tests remain green | N/A (headless) | Filled during verification |
| AC-4 | Unit | `packages/frontend/ai-gateway/tests/adapter_contract.test.ts` (shared contract suite over all adapters incl. service stub) | N/A | Filled during verification |
| AC-5 | Unit + Integration | `packages/frontend/ai-gateway/tests/detection.test.ts` (parity fixtures vs. `capability_service.test.ts` scenarios) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task` → `schemas:test`, `types:build`, `frontend-ai-gateway:test`, `client:test`; full `:validate` before handoff.
- Integration: with local Ollama running (herdr `text` service), run a `streamChat` through the migrated `text_generation_service` in the client dev sandbox and confirm streaming + mid-stream cancel; with Ollama stopped, confirm `detect('text')` returns unavailable within 3s and `generateText` fails with `provider_unreachable`.
- E2E / Visual:
    - **Functional**: N/A — headless service layer; behavior preservation is proven by existing unit/integration suites. (C-322/C-318 own the E2E surfaces that exercise detection UX.)
    - **Visual**: N/A.

**Watch Points**:
- AC-2: `extractStructure` falls back to system-prompt extraction when the provider lacks native `response_format: json_schema` — the fallback branch must survive the migration.
- AC-2: `ai_service` currently swallows errors and returns `undefined` (logs via `this.error`) — preserve that call-site behavior while the gateway itself throws typed errors internally.
- AC-3: `tts_service` has two engines (WebGPU worker vs. REST server auto-detect) — the gateway must delegate to the service's existing engine selection, not re-implement it.
- AC-4: "hidden/disabled in UI" is C-318/C-322's job; this contract only guarantees the typed `mode_unavailable` guard exists for them to build on.
- AC-5: the Ollama ping uses the Vite dev proxy (`/api/text/`) first and native `localhost:11434` second, sharing one aggregate deadline — keep both paths and the shared deadline.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Define TypeBox schemas + derived types in `packages/shared/schemas` / `packages/shared/types` (AC-1). Scaffold `packages/frontend/ai-gateway` via the `new-project` skill. Build the adapter contract, registry, mode resolver, error normalization, and the shared adapter contract test suite with the synthetic SSE mock (AC-4 skeleton).
2. **Phase 2 (Integration)**: Implement text `offline`/`byok` adapters by relocating `text_generation_service` internals and reusing `@aikami/backend/ai` payload builders/parsers where environment-agnostic (AC-2); wrap image/voice clients (AC-3); implement the `service` text adapter over the Firebase callable + deterministic stub (AC-4); implement `detect()` by relocating capability ping logic (AC-5). Migrate `text_generation_service` and `ai_service` call sites behind unchanged public interfaces; expose the gateway singleton via `$services`.
3. **Phase 3 (Validation)**: Run `validate()` plus `schemas:test`, `frontend-ai-gateway:test`, `client:test`; run the local-Ollama integration checks (streaming, cancel, detection timing); confirm zero remaining direct provider-endpoint conditionals at migrated call sites (grep evidence).

## Edge Cases & Gotchas

- **Client disconnect mid-stream**: abort must propagate to the upstream fetch immediately or Ollama stays resident in VRAM until the hidden stream ends (C-056 lesson) — pass `AbortController` signals all the way down.
- **Mixed modes per campaign**: text `offline` + image `byok` simultaneously is a supported state — resolution is per capability, never global; tests must cover a mixed-resolution fixture.
- **Vault access failures**: `crypto_vault` reads can throw (fingerprint change, corrupted payload) — byok resolution must degrade to `not_configured`, not crash detection.
- **Ollama endpoint duality**: dev uses the Vite proxy path, Tauri/production uses direct `localhost:11434` — endpoint resolution must keep both, mirroring `resolveChatUrl` + `_pingOllama` behavior.
- **`packages/backend/ai` reuse boundary**: only environment-agnostic pieces (payload builders, SSE parsers, error codes) may be imported client-side; anything touching Node-only APIs stays server-side. Do not create a client → backend-package dependency that breaks the client build. In particular, `OLLAMA_VRAM_EVICTION_PARAMS` is a pure data constant in `@aikami/backend/ai` and is safe to import client-side, but `@aikami/backend/ai` is not aliased in the client's `svelte.config.js` — the implementer should either add the alias, duplicate the constant locally in the gateway, or move it to `@aikami/constants` (preferred but out of current scope).
- **Error-swallowing call sites**: some existing callers rely on `undefined`-on-error semantics (`ai_service`); the gateway throws typed errors, so migrated wrappers must translate at the boundary, not change caller contracts.
- **Voice "always available" assumption**: `capability_service.detect()` currently hardcodes voice as detected (Kokoro WebGPU) — `detect('voice')` should report real engine status but remain convertible to today's optimistic snapshot so C-322 decides the UX policy.

## Open Questions

None — package placement (`packages/frontend/ai-gateway`), consumer split (C-322/C-323/C-324), and `service`-mode stub boundary are resolved above per the TODO.md item.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary
Built the unified AI Provider Gateway — a typed, mode-resolving dispatch layer for text/image/voice across `offline`/`byok`/`service` modes. Created `packages/frontend/ai-gateway` (new moon project `frontend-ai-gateway`), added shared gateway schemas/types to `packages/shared/`, migrated the client's `text_generation_service` and `ai_service` onto the gateway behind unchanged public interfaces, and relocated provider-ping logic into the gateway detection API. All gateway tests pass; client test suite shows zero new failures vs baseline (360 pass / 50 pre-existing env failures).

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | 21 TypeBox schema tests pass; types derived via `Static<>` exported from `@aikami/schemas` and `@aikami/types` barrels; no gateway type defined in `apps/**` or the gateway package. |
| AC-2 | ✅ | All 20 text_generation_service tests pass (up from 4 at baseline in main repo); streaming order, timeouts, abort propagation to upstream fetch, structured extraction + fallback, VRAM eviction params, OpenRouter headers preserved. ai_service routes through gateway `service`-mode adapter. Grep-verified: no provider/endpoint conditionals at call sites; resolution happens once via `onResolve` hook. |
| AC-3 | ✅ | Image adapter delegates to `imageGenerationService` unchanged; voice adapter delegates to `ttsService.speak` (engine selection preserved inside tts_service). Both honor `AbortSignal` and normalize failures to `AiGatewayError`. Existing image_generation_service suite (20/20) green. |
| AC-4 | ✅ | Shared adapter-contract suite runs against every registered adapter family (offline/byok text, service stub, image, voice) with synthetic SSE streams; all failures surface as `AiGatewayException`. `resolveMode` throws `mode_unavailable` when `serviceActivated` is false; explicit `service` dispatch with no registered adapter also throws `mode_unavailable`. |
| AC-5 | ✅ | Detection parity tests: text (cloud config → configured; proxy → native fallback under one shared deadline; not_found within 3s), image (config → configured; ComfyUI ping → detected), voice (real engine status, optimistic-convertible). `toDetectionStatus` converts results to the existing `DetectionStatus` union. Hanging detectors time out within budget; throwing detectors yield unavailable results, never crashes; checks run independently. |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/ai_gateway.ts` | TypeBox schemas: AiMode, AiCapability, AiGatewayErrorCode, AiGatewayError, AiModeResolution, AiDetectionResult, AiChatMessage, AiGatewayModeConfig |
| `packages/shared/schemas/tests/ai_gateway.test.ts` | AC-1 schema validation tests (21 cases) |
| `packages/shared/types/src/lib/ai_gateway.ts` | `Static<>`-derived types from gateway schemas |
| `packages/frontend/ai-gateway/` (moon.yml, package.json, tsconfig.json, README.md) | New moon project `frontend-ai-gateway`, alias `@aikami/frontend/ai-gateway` |
| `packages/frontend/ai-gateway/src/lib/gateway.ts` | Default AiProviderGateway (dispatch, cancelAll, bounded detect, error normalization) |
| `packages/frontend/ai-gateway/src/lib/gateway_types.ts` | Call surface + adapter contracts (`AiTextAdapter`, `AiImageAdapter`, `AiVoiceAdapter`) |
| `packages/frontend/ai-gateway/src/lib/adapter_registry.ts` | (capability, mode) adapter registry |
| `packages/frontend/ai-gateway/src/lib/mode_resolver.ts` | Config-backed mode resolution with service guard |
| `packages/frontend/ai-gateway/src/lib/errors.ts` | `AiGatewayException` + normalization (`toAiGatewayError`, HTTP-status mapping, retryability) |
| `packages/frontend/ai-gateway/src/lib/sse.ts` | Chat-completions SSE reader (relocated; first-chunk/idle timeouts) |
| `packages/frontend/ai-gateway/src/lib/structured.ts` | Strict-schema compilation w/ caching, JSON sanitization, TypeBox validation |
| `packages/frontend/ai-gateway/src/lib/text_adapter_openai_compatible.ts` | offline + byok text transport (relocated from text_generation_service) |
| `packages/frontend/ai-gateway/src/lib/text_adapter_service.ts` | service-mode adapter over hosted callable + deterministic stub |
| `packages/frontend/ai-gateway/src/lib/image_adapter.ts` | Delegating image adapter + `raceWithAbort` |
| `packages/frontend/ai-gateway/src/lib/voice_adapter.ts` | Delegating voice adapter |
| `packages/frontend/ai-gateway/src/lib/detection.ts` | Detection API (Ollama proxy/native, ComfyUI, Kokoro) + `toDetectionStatus` |
| `packages/frontend/ai-gateway/tests/{helpers,adapter_contract.test,text_adapters.test,image_voice_adapters.test,detection.test}.ts` | 56 tests incl. synthetic SSE mocks and mixed-mode fixture |
| `apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts` | Client gateway singleton (BaseFrontendClass) — composes core with client adapters/detectors, exposed via `$services` |

### Files Modified
| File | Change |
|---|---|
| `packages/shared/schemas/src/index.ts` | Export `./lib/ai_gateway.ts` |
| `packages/shared/types/src/index.ts` | Export `./lib/ai_gateway.ts` |
| `.moon/workspace.yml` | Registered `frontend-ai-gateway` |
| `apps/frontend/client/svelte.config.js` | Added `@aikami/frontend/ai-gateway` aliases |
| `apps/frontend/client/tsconfig.test.json` | Added gateway paths for bun test |
| `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` | Thin gateway consumer; public interface (`streamChat`/`extractStructure`/`cancelAll`) and diagnostics globals preserved; provider internals removed (667 lines → delegation) |
| `apps/frontend/client/src/lib/services/ai/ai_service.svelte.ts` | Routes `sendMessageToAI`/`createPersona` through gateway service-mode adapter; undefined-on-error preserved |
| `apps/frontend/client/src/lib/services/index.ts` | Barrel export for `ai_gateway_service` |
| `apps/frontend/client/src/lib/services/ai/text_generation_service.test.ts` | Fixed hardcoded main-repo absolute mock paths → relative (tests now run in worktrees); merged image-state default to prevent cross-file singleton pollution |

### Deviations from Spec
1. **Cloud endpoint defaults restored**: current `resolveChatUrl` had lost well-known cloud chat endpoints (openai/openrouter/deepseek), which is why 16/20 C-080 tests failed at baseline even in the main repo. The gateway adapter injects defaults from the existing `PROVIDER_MODEL_FETCH` registry (`chatTestUrl`), restoring the C-080-specified behavior. No Amendment needed — AC-2 explicitly requires these suites to pass.
2. **`OLLAMA_VRAM_EVICTION_PARAMS` duplicated** in the gateway package (contract watch point explicitly allows this) because `@aikami/backend/ai` is not aliased in the client build. Moving it to `@aikami/constants` is noted as preferred future work (out of scope).
3. **`generateVoice` result `audio` is optional**: the existing Kokoro path (`ttsService.speak`) plays audio through the client pipeline and never exposes raw buffers; forcing a required `audio` field would have required re-implementing engine selection (forbidden by AC-3 watch point). Adapters that do produce raw audio return it.
4. **Explicit `mode` override on `generateText`**: `ai_service` must keep calling the Firebase callable (current behavior) while `service` mode remains un-activated for resolution. The gateway therefore accepts an explicit `mode` override that dispatches to a registered adapter directly; `resolveMode` selection of `service` stays guarded with `mode_unavailable` (AC-4 tests cover both paths).
5. **Baseline test environment**: the worktree had no `node_modules` (ran `bun install`) and lacked generated paraglide i18n files (copied from main repo; gitignored). Client baseline recorded after install: 279 pass / 101 fail (pre-existing, mostly env/mock issues). Post-implementation: 360 pass / 50 fail, zero new failures.

### Test Results
- Unit (schemas): 21/21 (0 failures)
- Unit (frontend-ai-gateway): 56/56 (0 failures)
- Unit (client): 360 pass / 50 fail — 0 new failures vs baseline (101 → 50; 16 text_generation_service failures eliminated)
- Typecheck: schemas ✅, types ✅, frontend-ai-gateway ✅, client ✅ (0 errors, 1 pre-existing warning)
- Build: client:build ✅
- Dev-server smoke: vite dev serves 200, no errors in log
- Visual: N/A — headless service layer
- E2E: N/A per Evidence Matrix (C-322/C-318 own detection UX surfaces)
- Live-Ollama integration check: not executed in pipeline environment (no herdr); adapter paths covered by unit suites — verifier may exercise with a running Ollama.
