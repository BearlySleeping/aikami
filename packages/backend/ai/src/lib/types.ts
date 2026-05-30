// packages/backend/ai/src/lib/types.ts
import type { ChatOptions, CompletionOptions, EmbeddingOptions } from '@aikami/types';

/**
 * AI-specific error codes for provider failures.
 *
 * These supplement the general {@link ErrorType} codes from `@aikami/types`.
 */
export type AiServiceErrorCode =
  | 'rate_limited'
  | 'token_exceeded'
  | 'content_filtered'
  | 'network_timeout'
  | 'authentication_failed'
  | 'invalid_response'
  | 'provider_unavailable'
  | 'circuit_open';

/**
 * Configuration for the token-bucket rate limiter.
 */
export type RateLimiterConfig = {
  /** Maximum number of requests allowed in the window. */
  maxRequests: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Maximum tokens allowed in the bucket (for burst). */
  maxTokens?: number;
  /** Token refill rate per second. */
  refillRate?: number;
};

/**
 * Configuration for the circuit breaker state machine.
 */
export type CircuitBreakerConfig = {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold: number;
  /** Cooldown period in milliseconds before attempting a half-open probe. */
  cooldownMs: number;
  /** Number of successful requests in half-open state to close the circuit. */
  successThreshold: number;
  /** Maximum time in milliseconds a half-open state can last. */
  halfOpenMaxMs: number;
};

/**
 * Options for configuring retry behavior on transient failures.
 */
export type RetryConfig = {
  /** Maximum number of retry attempts. */
  maxRetries: number;
  /** Initial backoff delay in milliseconds. */
  initialDelayMs: number;
  /** Maximum backoff delay in milliseconds. */
  maxDelayMs: number;
  /** Backoff multiplier for exponential backoff (e.g. 2.0). */
  backoffMultiplier: number;
  /** Whether to add random jitter to backoff delays. */
  jitter: boolean;
};

/**
 * Base options shared by all AI service constructors.
 */
export type BaseAiServiceOptions = {
  /** Human-readable name for logging (e.g. 'OpenAI', 'Gemini'). */
  name: string;
  /** API key for the provider. */
  apiKey?: string;
  /** Default model identifier (e.g. 'gpt-4o', 'gemini-2.0-flash'). */
  model?: string;
  /** Rate limiter configuration override. */
  rateLimiter?: Partial<RateLimiterConfig>;
  /** Circuit breaker configuration override. */
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  /** Retry configuration override. */
  retry?: Partial<RetryConfig>;
  /** Debug mode — logs additional provider internals. */
  debug?: boolean;
};

/**
 * OpenAI-specific constructor options.
 */
export type OpenAiServiceOptions = BaseAiServiceOptions & {
  /** OpenAI organization ID (multi-org accounts). */
  organization?: string;
  /** Base URL override for proxy/custom endpoints. */
  baseUrl?: string;
  /** Default options applied to every chat completion call. */
  defaultChatOptions?: ChatOptions;
  /** Default options applied to every completion call. */
  defaultCompletionOptions?: CompletionOptions;
  /** Default options applied to every embedding call. */
  defaultEmbeddingOptions?: EmbeddingOptions;
};

/**
 * Gemini-specific constructor options.
 */
export type GeminiServiceOptions = BaseAiServiceOptions & {
  /** Base URL override for proxy/custom endpoints. */
  baseUrl?: string;
  /** Default options applied to every chat completion call. */
  defaultChatOptions?: ChatOptions;
  /** Default options applied to every completion call. */
  defaultCompletionOptions?: CompletionOptions;
  /** Default options applied to every embedding call. */
  defaultEmbeddingOptions?: EmbeddingOptions;
  /** Safety filter thresholds (BLOCK_NONE, BLOCK_ONLY_HIGH, BLOCK_MEDIUM_AND_ABOVE, BLOCK_LOW_AND_ABOVE). */
  safetyThreshold?: string;
};

/**
 * Factory configuration for creating an AI service at runtime.
 */
export type CreateAiServiceOptions = {
  /** Provider type selector. */
  provider: 'openai' | 'gemini';
  /** API key (falls back to OPENAI_API_KEY or GEMINI_API_KEY env vars). */
  apiKey?: string;
  /** Model identifier override. */
  model?: string;
  /** Debug mode. */
  debug?: boolean;
};
