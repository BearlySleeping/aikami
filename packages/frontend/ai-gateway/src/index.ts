// packages/frontend/ai-gateway/src/index.ts
//
// Public API of @aikami/frontend/ai-gateway — the unified AI provider
// gateway (offline / byok / service) built by C-320.

export { type AiAdapterRegistry, createAdapterRegistry } from './lib/adapter_registry.ts';
export {
  createGatewayDeadline,
  createUnboundedGatewayDeadline,
  DEFAULT_GATEWAY_PHASE_LIMITS,
  describeTimeout,
  GATEWAY_UNBOUNDED_WATCHDOG_MS,
  type GatewayClock,
  type GatewayDeadline,
  type GatewayPhaseLimits,
  type GatewayPhaseWindow,
  type GatewayStopReason,
  type GatewayTimeoutKind,
  type GatewayTimer,
} from './lib/deadline.ts';
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
  isCancellationFailure,
  isRetryableGatewayCode,
  toAiGatewayError,
} from './lib/errors.ts';
export { type AiProviderGatewayOptions, createAiProviderGateway } from './lib/gateway.ts';
export type {
  AiAdapter,
  AiAdapterContext,
  AiAttemptOutcome,
  AiDetector,
  AiImageAdapter,
  AiImageGenerationOptions,
  AiImageGenerationResult,
  AiModeResolver,
  AiProviderGateway,
  AiTextAdapter,
  AiTextGenerationOptions,
  AiTextGenerationResult,
  AiTextUsage,
  AiTransportAttemptDraft,
  AiTransportAttemptEvent,
  AiTransportShape,
  AiVoiceAdapter,
  AiVoiceGenerationOptions,
  AiVoiceGenerationResult,
} from './lib/gateway_types.ts';
export { createDelegatingImageAdapter, raceWithAbort } from './lib/image_adapter.ts';
export { createLocalTextAdapter } from './lib/local_text_adapter.ts';
export { createModeResolver } from './lib/mode_resolver.ts';
export {
  buildNativeFormat,
  isSchemaShapeRejection,
  NATIVE_STRUCTURED_FALLBACK_BUDGET,
  type NativeFormatCapability,
  type NativeFormatRequest,
  type NativeStructuredOutcome,
} from './lib/native_format.ts';
export {
  buildNativeOptions,
  type NativeOptionField,
  type NativeOptionsReport,
  resolveNativeMaxTokens,
} from './lib/native_options.ts';
export {
  combineNativeUsage,
  type NativePhaseTimings,
  readNativePhaseTimings,
  readNativeUsage,
} from './lib/native_usage.ts';
export {
  type NativeStreamOutcome,
  type NativeStreamReport,
  NDJSON_MAX_BUFFER_BYTES,
  readNativeNdjsonStream,
} from './lib/ndjson.ts';
export {
  buildReasoningParams,
  type ReasoningControl,
  resolveChatSurface,
  type TextApiSurface,
} from './lib/reasoning_control.ts';
export {
  type ChatSseOutcome,
  GATEWAY_FETCH_TIMEOUT_MS,
  GATEWAY_FIRST_CHUNK_TIMEOUT_MS,
  GATEWAY_IDLE_TIMEOUT_MS,
  type ReadChatSseOptions,
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
  EMPTY_RETRY_BACKOFF_MS,
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
