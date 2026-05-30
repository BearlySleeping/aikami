// packages/backend/ai/src/lib/base-ai-service.ts

import type {
  AIChatMessage,
  ChatOptions,
  ChatResponse,
  ClassificationOptions,
  ClassificationResult,
  CompletionOptions,
  EmbeddingOptions,
} from '@aikami/types';
import { z } from 'zod';
import { logger } from '$logger';
import type { AiServiceInterface } from './ai-service-interface.ts';
import { CircuitBreaker } from './circuit-breaker.ts';
import { AiServiceError } from './errors.ts';
import { TokenBucketRateLimiter } from './rate-limiter.ts';

import type {
  BaseAiServiceOptions,
  CircuitBreakerConfig,
  RateLimiterConfig,
  RetryConfig,
} from './types.ts';

/** Default retry configuration. */
const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/** Default rate limiter configuration (100 RPM). */
const DEFAULT_RATE_LIMITER: RateLimiterConfig = {
  maxRequests: 100,
  windowMs: 60000,
};

/** Default circuit breaker configuration. */
const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30000,
  successThreshold: 2,
  halfOpenMaxMs: 30000,
};

/**
 * Compute a random jitter value between 0 and the given delay.
 */
const jitter = (delay: number): number => {
  return Math.random() * delay;
};

/**
 * Sleep for a given number of milliseconds.
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Abstract base class for AI service providers.
 *
 * Wires together rate limiting, circuit breaker, retry with exponential
 * backoff, Zod response validation, and structured logging.
 *
 * Concrete implementations (OpenAiService, GeminiService) implement
 * the `_raw` methods for provider-specific API calls.
 */
export abstract class BaseAiService implements AiServiceInterface {
  abstract readonly name: string;

  protected readonly _model: string;
  protected readonly _debug: boolean;
  protected readonly _rateLimiter: TokenBucketRateLimiter;
  protected readonly _circuitBreaker: CircuitBreaker;
  protected readonly _retryConfig: RetryConfig;

  constructor(options: BaseAiServiceOptions) {
    this._model = options.model ?? 'default';
    this._debug = options.debug ?? false;

    this._rateLimiter = new TokenBucketRateLimiter({
      ...DEFAULT_RATE_LIMITER,
      ...options.rateLimiter,
    });

    this._circuitBreaker = new CircuitBreaker({
      ...DEFAULT_CIRCUIT_BREAKER,
      ...options.circuitBreaker,
    });

    this._retryConfig = {
      ...DEFAULT_RETRY,
      ...options.retry,
    };
  }

  // ── Public interface methods ──────────────────────────────────────────────

  /** @inheritDoc */
  generateChat = async (
    messages: AIChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> => {
    this._debugLog('generateChat', { messageCount: messages.length, model: options?.model });

    this._checkCircuit();
    await this._checkRateLimit();

    return this._withRetry(() => this._generateChatRaw(messages, options));
  };

  /** @inheritDoc */
  generateCompletion = async (prompt: string, options?: CompletionOptions): Promise<string> => {
    this._debugLog('generateCompletion', { promptLength: prompt.length, model: options?.model });

    this._checkCircuit();
    await this._checkRateLimit();

    const response = await this._withRetry(() => this._generateCompletionRaw(prompt, options));
    return response.text;
  };

  /** @inheritDoc */
  extractStructuredJSON = async <T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    input: string,
  ): Promise<T> => {
    this._debugLog('extractStructuredJSON', {
      promptLength: prompt.length,
      inputLength: input.length,
    });

    this._checkCircuit();
    await this._checkRateLimit();

    // Use extraction-specific retry that validates through Zod
    return this._withExtractionRetry(prompt, schema, input);
  };

  /** @inheritDoc */
  classifyText = async (
    input: string,
    labels: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult> => {
    this._debugLog('classifyText', { inputLength: input.length, labelCount: labels.length });

    this._checkCircuit();
    await this._checkRateLimit();

    return this._withRetry(() => this._classifyTextRaw(input, labels, options));
  };

  /** @inheritDoc */
  generateEmbedding = async (text: string, options?: EmbeddingOptions): Promise<number[]> => {
    this._debugLog('generateEmbedding', { textLength: text.length, model: options?.model });

    this._checkCircuit();
    await this._checkRateLimit();

    return this._withRetry(() => this._generateEmbeddingRaw(text, options));
  };

  /** @inheritDoc */
  generateEmbeddings = async (texts: string[], options?: EmbeddingOptions): Promise<number[][]> => {
    this._debugLog('generateEmbeddings', { textCount: texts.length, model: options?.model });

    this._checkCircuit();
    await this._checkRateLimit();

    return this._withRetry(() => this._generateEmbeddingsRaw(texts, options));
  };

  // ── Abstract methods (implemented by concrete providers) ───────────────────

  /**
   * Provider-specific chat generation — called by {@link generateChat}
   * after rate limiting, circuit breaker, and retry wrappers.
   */
  protected abstract _generateChatRaw(
    messages: AIChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse>;

  /**
   * Provider-specific completion — called by {@link generateCompletion}.
   */
  protected abstract _generateCompletionRaw(
    prompt: string,
    options?: CompletionOptions,
  ): Promise<ChatResponse>;

  /**
   * Provider-specific structured extraction — called by {@link extractStructuredJSON}.
   */
  protected abstract _extractStructuredJSONRaw<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    input: string,
  ): Promise<T>;

  /**
   * Provider-specific text classification — called by {@link classifyText}.
   */
  protected abstract _classifyTextRaw(
    input: string,
    labels: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult>;

  /**
   * Provider-specific single embedding — called by {@link generateEmbedding}.
   */
  protected abstract _generateEmbeddingRaw(
    text: string,
    options?: EmbeddingOptions,
  ): Promise<number[]>;

  /**
   * Provider-specific batch embedding — called by {@link generateEmbeddings}.
   */
  protected abstract _generateEmbeddingsRaw(
    texts: string[],
    options?: EmbeddingOptions,
  ): Promise<number[][]>;

  // ── Infrastructure ────────────────────────────────────────────────────────

  /**
   * Check the circuit breaker before making a call.
   * Throws {@link AiServiceError} with `circuit_open` if the circuit is open.
   */
  protected _checkCircuit(): void {
    if (!this._circuitBreaker.allowRequest()) {
      throw new AiServiceError(
        'circuit_open',
        `Circuit is open for ${this.name}. Requests are rejected.`,
      );
    }
  }

  /**
   * Check the rate limiter before making a call.
   * Throws {@link AiServiceError} with `rate_limited` if the limit is exceeded.
   */
  protected async _checkRateLimit(): Promise<void> {
    if (!this._rateLimiter.tryConsume()) {
      throw new AiServiceError('rate_limited', `Rate limit exceeded for ${this.name}.`);
    }
  }

  /**
   * Retry wrapper with exponential backoff and jitter.
   *
   * Only retries on transient errors (rate_limited, network_timeout,
   * provider_unavailable, circuit_open). Non-retryable errors
   * (authentication_failed, content_filtered, token_exceeded) are re-thrown immediately.
   */
  protected async _withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this._retryConfig.maxRetries; attempt++) {
      try {
        const result = await operation();
        this._circuitBreaker.recordSuccess();
        return result;
      } catch (error) {
        lastError = error;

        // Map unknown errors to AiServiceError
        const aiError = this._mapError(error);

        this._circuitBreaker.recordFailure();

        // Non-retryable — re-throw immediately
        if (!aiError.retryable || attempt >= this._retryConfig.maxRetries) {
          throw aiError;
        }

        // Compute backoff delay with optional jitter
        const baseDelay = Math.min(
          this._retryConfig.initialDelayMs * this._retryConfig.backoffMultiplier ** attempt,
          this._retryConfig.maxDelayMs,
        );
        const delay = this._retryConfig.jitter ? jitter(baseDelay) : baseDelay;

        this._debugLog('_withRetry', {
          attempt: attempt + 1,
          maxRetries: this._retryConfig.maxRetries,
          delayMs: Math.round(delay),
          errorCode: aiError.code,
        });

        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Specialized retry for structured extraction that validates through Zod.
   *
   * On Zod validation failure, retries with a correction prompt appended.
   */
  protected async _withExtractionRetry<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    input: string,
  ): Promise<T> {
    let lastError: unknown;
    let correctionHint = '';

    for (let attempt = 0; attempt <= this._retryConfig.maxRetries; attempt++) {
      try {
        const fullPrompt = correctionHint
          ? `${prompt}\n\nPrevious attempt produced invalid output. ${correctionHint}`
          : prompt;

        const rawResult = await this._withRetry(() =>
          this._extractStructuredJSONRaw<T>(fullPrompt, schema, input),
        );

        // Validate through Zod
        const parsed = await schema.parseAsync(rawResult);
        return parsed;
      } catch (error) {
        lastError = error;

        // Zod validation error — retry with correction
        if (error instanceof z.ZodError) {
          if (attempt >= this._retryConfig.maxRetries) {
            throw new AiServiceError(
              'invalid_response',
              'Structured extraction failed after max retries',
              {
                originalError: error,
              },
            );
          }

          correctionHint = this._buildZodCorrectionHint(error);
          this._debugLog('_withExtractionRetry', {
            attempt: attempt + 1,
            zodErrors: error.issues.length,
          });

          const delay = this._retryConfig.jitter
            ? jitter(this._retryConfig.initialDelayMs)
            : this._retryConfig.initialDelayMs;
          await sleep(delay);
          continue;
        }

        // Non-Zod error — re-throw immediately
        throw this._mapError(error);
      }
    }

    throw lastError;
  }

  /**
   * Build a correction hint from Zod validation errors to guide the retry.
   */
  private _buildZodCorrectionHint(zodError: z.ZodError): string {
    const issues = zodError.issues.slice(0, 5);
    const issueMessages = issues.map((issue: z.ZodIssue) => {
      const path = issue.path.join('.') || 'root';
      return `- ${path}: ${issue.message}`;
    });

    return `Please correct the following issues in your JSON output:\n${issueMessages.join('\n')}`;
  }

  /**
   * Map an unknown error to a standardized {@link AiServiceError}.
   *
   * Defaults to `provider_unavailable` for unknown error shapes.
   */
  protected _mapError(error: unknown): AiServiceError {
    if (error instanceof AiServiceError) {
      return error;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (
        message.includes('rate limit') ||
        message.includes('429') ||
        message.includes('too many requests')
      ) {
        return new AiServiceError('rate_limited', error.message, { originalError: error });
      }

      if (message.includes('timeout') || message.includes('etimedout')) {
        return new AiServiceError('network_timeout', error.message, { originalError: error });
      }

      if (
        message.includes('401') ||
        message.includes('403') ||
        message.includes('unauthorized') ||
        message.includes('authentication')
      ) {
        return new AiServiceError('authentication_failed', error.message, { originalError: error });
      }

      if (message.includes('token') && (message.includes('exceed') || message.includes('limit'))) {
        return new AiServiceError('token_exceeded', error.message, { originalError: error });
      }

      if (
        message.includes('content filter') ||
        message.includes('safety') ||
        message.includes('blocked')
      ) {
        return new AiServiceError('content_filtered', error.message, { originalError: error });
      }

      return new AiServiceError('provider_unavailable', error.message, { originalError: error });
    }

    // Non-Error throw
    return new AiServiceError('provider_unavailable', String(error));
  }

  /**
   * Emit a debug log entry if debug mode is enabled.
   */
  private _debugLog(method: string, data: Record<string, unknown>): void {
    if (this._debug) {
      logger.debug(`[${this.name}] ${method}`, data);
    }
  }
}
