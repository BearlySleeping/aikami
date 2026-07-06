// packages/backend/ai/src/index.ts

export type {
  AstCacheProvider,
  FootprintResult,
  MessagePayload,
  OpenRouterPayload as AgentRouterPayload,
  RouterInput,
} from './lib/agent_router.ts';
// ── Agent Router (C-301) ───────────────────────────────────
export {
  buildRouterPayload,
  extractTypeFootprint,
  extractTypeFootprintWithCache,
  prepareAgentPayload,
} from './lib/agent_router.ts';
export type { AiServiceInterface } from './lib/ai_service_interface.ts';
export { handleAIEndpoint } from './lib/api_handler.ts';
export { BaseAiService } from './lib/base_ai_service.ts';
export { CircuitBreaker } from './lib/circuit_breaker.ts';
export { AiServiceError } from './lib/errors.ts';
export { createAiService } from './lib/factory.ts';
export { GeminiService } from './lib/gemini_service.ts';
export { buildOllamaPayload, createOllamaStream, parseOllamaStream } from './lib/ollama_adapter.ts';
export { OpenAiService } from './lib/openai_service.ts';
export {
  buildOpenRouterPayload,
  createOpenRouterStream,
  parseOpenRouterStream,
} from './lib/openrouter_adapter.ts';
export { TokenBucketRateLimiter } from './lib/rate_limiter.ts';
export { SyntheticSseMock } from './lib/synthetic_sse_mock.ts';
export { routeTextGeneration } from './lib/text_generation_router.ts';
export type {
  SseStreamEvent,
  SyntheticSseMockOptions,
  TextGenerationConfig,
  TextGenerationProvider,
  TextGenerationRequest,
} from './lib/text_generation_types.ts';
export { OLLAMA_VRAM_EVICTION_PARAMS } from './lib/text_generation_types.ts';
export type {
  AiServiceErrorCode,
  BaseAiServiceOptions,
  CircuitBreakerConfig,
  CreateAiServiceOptions,
  GeminiServiceOptions,
  OpenAiServiceOptions,
  RateLimiterConfig,
  RetryConfig,
} from './lib/types.ts';
