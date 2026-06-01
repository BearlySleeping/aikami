// packages/backend/ai/src/lib/base_ai_service.ts

import type {
  AIChatMessage,
  ChatOptions,
  ChatResponse,
  ClassificationOptions,
  ClassificationResult,
  CompletionOptions,
  EmbeddingOptions,
} from '@aikami/types';
import type { TSchema } from 'typebox';
import { logger } from '$logger';
import type { AiServiceInterface } from './ai_service_interface.ts';
import { CircuitBreaker } from './circuit_breaker.ts';
import { AiServiceError } from './errors.ts';
import { TokenBucketRateLimiter } from './rate_limiter.ts';

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

const jitter = (delay: number): number => {
  return Math.random() * delay;
};

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

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

  generateChat = async (
    messages: AIChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> => {
    this._debugLog('generateChat', { messageCount: messages.length, model: options?.model });
    this._checkCircuit();
    await this._checkRateLimit();
    return this._withRetry(() => this._generateChatRaw(messages, options));
  };

  generateCompletion = async (prompt: string, options?: CompletionOptions): Promise<string> => {
    this._debugLog('generateCompletion', { promptLength: prompt.length, model: options?.model });
    this._checkCircuit();
    await this._checkRateLimit();
    const response = await this._withRetry(() => this._generateCompletionRaw(prompt, options));
    return response.text;
  };

  extractStructuredJSON = async <T>(prompt: string, schema: TSchema, input: string): Promise<T> => {
    this._debugLog('extractStructuredJSON', {
      promptLength: prompt.length,
      inputLength: input.length,
    });
    this._checkCircuit();
    await this._checkRateLimit();
    return this._withExtractionRetry(prompt, schema, input);
  };

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

  generateEmbedding = async (text: string, options?: EmbeddingOptions): Promise<number[]> => {
    this._debugLog('generateEmbedding', { textLength: text.length, model: options?.model });
    this._checkCircuit();
    await this._checkRateLimit();
    return this._withRetry(() => this._generateEmbeddingRaw(text, options));
  };

  generateEmbeddings = async (texts: string[], options?: EmbeddingOptions): Promise<number[][]> => {
    this._debugLog('generateEmbeddings', { textCount: texts.length, model: options?.model });
    this._checkCircuit();
    await this._checkRateLimit();
    return this._withRetry(() => this._generateEmbeddingsRaw(texts, options));
  };

  protected abstract _generateChatRaw(
    messages: AIChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse>;

  protected abstract _generateCompletionRaw(
    prompt: string,
    options?: CompletionOptions,
  ): Promise<ChatResponse>;

  protected abstract _extractStructuredJSONRaw<T>(
    prompt: string,
    schema: TSchema,
    input: string,
  ): Promise<T>;

  protected abstract _classifyTextRaw(
    input: string,
    labels: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult>;

  protected abstract _generateEmbeddingRaw(
    text: string,
    options?: EmbeddingOptions,
  ): Promise<number[]>;

  protected abstract _generateEmbeddingsRaw(
    texts: string[],
    options?: EmbeddingOptions,
  ): Promise<number[][]>;

  protected _checkCircuit(): void {
    if (!this._circuitBreaker.allowRequest()) {
      throw new AiServiceError(
        'circuit_open',
        `Circuit is open for ${this.name}. Requests are rejected.`,
      );
    }
  }

  protected async _checkRateLimit(): Promise<void> {
    if (!this._rateLimiter.tryConsume()) {
      throw new AiServiceError('rate_limited', `Rate limit exceeded for ${this.name}.`);
    }
  }

  protected async _withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this._retryConfig.maxRetries; attempt++) {
      try {
        const result = await operation();
        this._circuitBreaker.recordSuccess();
        return result;
      } catch (error) {
        lastError = error;
        const aiError = this._mapError(error);
        this._circuitBreaker.recordFailure();

        if (!aiError.retryable || attempt >= this._retryConfig.maxRetries) {
          throw aiError;
        }

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

  protected async _withExtractionRetry<T>(
    prompt: string,
    _schema: TSchema,
    input: string,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this._retryConfig.maxRetries; attempt++) {
      try {
        const rawResult = await this._withRetry(() =>
          this._extractStructuredJSONRaw<T>(prompt, _schema, input),
        );

        // TODO: Add TypeBox runtime validation when available
        // TypeBox v1.x schemas are JSON Schema — validation needs a separate validator
        return rawResult;
      } catch (error) {
        lastError = error;

        if (attempt >= this._retryConfig.maxRetries) {
          throw this._mapError(error);
        }

        const delay = this._retryConfig.jitter
          ? jitter(this._retryConfig.initialDelayMs)
          : this._retryConfig.initialDelayMs;
        await sleep(delay);
      }
    }

    throw lastError;
  }

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

    return new AiServiceError('provider_unavailable', String(error));
  }

  private _debugLog(method: string, data: Record<string, unknown>): void {
    if (this._debug) {
      logger.debug(`[${this.name}] ${method}`, data);
    }
  }
}
