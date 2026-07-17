// packages/frontend/ai-gateway/src/index.ts
//
// Public API of @aikami/frontend/ai-gateway — the unified AI provider
// gateway (offline / byok / service) built by C-320.

export { type AiAdapterRegistry, createAdapterRegistry } from './lib/adapter_registry.ts';
export {
  DEFAULT_COMFYUI_PING_URL,
  DEFAULT_OLLAMA_NATIVE_URL,
  DEFAULT_OLLAMA_PROXY_PATH,
  DETECTION_TIMEOUT_MS,
  detectImageAvailability,
  detectTextAvailability,
  detectVoiceAvailability,
  fetchWithTimeout,
  toDetectionStatus,
} from './lib/detection.ts';
export {
  AiGatewayException,
  createAiGatewayError,
  httpStatusToGatewayCode,
  isAbortError,
  isAiGatewayError,
  isRetryableGatewayCode,
  toAiGatewayError,
} from './lib/errors.ts';
export { type AiProviderGatewayOptions, createAiProviderGateway } from './lib/gateway.ts';
export type {
  AiAdapter,
  AiAdapterContext,
  AiDetector,
  AiImageAdapter,
  AiImageGenerationOptions,
  AiImageGenerationResult,
  AiModeResolver,
  AiProviderGateway,
  AiTextAdapter,
  AiTextGenerationOptions,
  AiTextGenerationResult,
  AiVoiceAdapter,
  AiVoiceGenerationOptions,
  AiVoiceGenerationResult,
} from './lib/gateway_types.ts';
export { createDelegatingImageAdapter, raceWithAbort } from './lib/image_adapter.ts';
export { createModeResolver } from './lib/mode_resolver.ts';
export {
  GATEWAY_FETCH_TIMEOUT_MS,
  GATEWAY_FIRST_CHUNK_TIMEOUT_MS,
  GATEWAY_IDLE_TIMEOUT_MS,
  readChatSseStream,
} from './lib/sse.ts';
export {
  createSchemaCompiler,
  enforceStrictSchema,
  type SchemaCompiler,
  sanitizeJsonResponse,
  validateAgainstSchema,
} from './lib/structured.ts';
export {
  createOpenAiCompatibleTextAdapter,
  DEFAULT_LOCAL_TEXT_ENDPOINTS,
  OLLAMA_VRAM_EVICTION_PARAMS,
  OPENROUTER_ATTRIBUTION_HEADERS,
  type OpenAiCompatibleTextAdapterOptions,
} from './lib/text_adapter_openai_compatible.ts';
export {
  createServiceStubTextAdapter,
  createServiceTextAdapter,
  type ServiceStubTextAdapterOptions,
  type ServiceTextCallable,
} from './lib/text_adapter_service.ts';
export { createDelegatingVoiceAdapter } from './lib/voice_adapter.ts';
