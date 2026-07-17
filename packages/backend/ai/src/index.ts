// packages/backend/ai/src/index.ts
//
// Server-side AI service module — the "service"-mode implementation backing
// the C-320 AiProviderGateway.  Provides the single `handleAIEndpoint` call
// surface consumed by Firebase controllers and the `createAiService` factory
// consumed by backend packages.
// Contract: C-056, C-320, C-324

export type { AiServiceInterface } from './lib/ai_service_interface.ts';
export { handleAIEndpoint } from './lib/api_handler.ts';
export { BaseAiService } from './lib/base_ai_service.ts';
export { CircuitBreaker } from './lib/circuit_breaker.ts';
export { AiServiceError } from './lib/errors.ts';
export { createAiService } from './lib/factory.ts';
export { GeminiService } from './lib/gemini_service.ts';
export { OpenAiService } from './lib/openai_service.ts';
export { TokenBucketRateLimiter } from './lib/rate_limiter.ts';
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
