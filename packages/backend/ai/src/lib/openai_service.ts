// packages/backend/ai/src/lib/openai-service.ts

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

import { BaseAiService } from './base_ai_service.ts';
import { AiServiceError } from './errors.ts';
import type { OpenAiServiceOptions } from './types.ts';

/**
 * Minimal type interface for the dynamically loaded OpenAI SDK client.
 * Only covers the API surface we use (chat completions, embeddings).
 *
 * The actual `openai` npm package is loaded via `require()` at runtime,
 * not imported at module level — this prevents vendor lock-in.
 */
type OpenAIClient = {
  chat: {
    completions: {
      create: (params: Record<string, unknown>) => Promise<OpenAICompletion>;
    };
  };
  embeddings: {
    create: (params: Record<string, unknown>) => Promise<OpenAIEmbeddingResponse>;
  };
};

type OpenAICompletion = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null };
  }>;
  model?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type OpenAIEmbeddingResponse = {
  data?: Array<{ embedding: number[] }>;
};

/**
 * OpenAI driver implementing {@link AiServiceInterface}.
 *
 * Uses the `openai` v4 SDK. Handles:
 * - GPT-4o, GPT-4o-mini, O-series models
 * - Native JSON mode for structured extraction
 * - OpenAI-specific error code mapping
 */
export class OpenAiService extends BaseAiService {
  readonly name = 'openai';

  private readonly _apiKey: string;
  private readonly _organization?: string;
  private readonly _baseUrl?: string;
  private readonly _defaultChatOptions?: ChatOptions;
  private _client: OpenAIClient | undefined = undefined;

  constructor(options: OpenAiServiceOptions) {
    super({
      name: 'OpenAI',
      model: options.model ?? 'gpt-4o',
      apiKey: options.apiKey,
      rateLimiter: options.rateLimiter,
      circuitBreaker: options.circuitBreaker,
      retry: options.retry,
      debug: options.debug,
    });

    this._apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this._organization = options.organization;
    this._baseUrl = options.baseUrl;
    this._defaultChatOptions = options.defaultChatOptions;
  }

  // ── Abstract method implementations ───────────────────────────────────────

  /** @inheritDoc */
  protected _generateChatRaw = async (
    messages: AIChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> => {
    const client = this._getClient();
    const model = options?.model ?? this._model;

    const openaiMessages = messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    const completion = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      max_tokens: options?.maxTokens ?? this._defaultChatOptions?.maxTokens,
      temperature: options?.temperature ?? this._defaultChatOptions?.temperature,
      top_p: options?.topP ?? this._defaultChatOptions?.topP,
      stop: options?.stopSequences ?? this._defaultChatOptions?.stopSequences,
    });

    return {
      text: completion.choices?.[0]?.message?.content ?? '',
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
      metadata: {
        model: completion.model,
        finishReason: completion.choices?.[0]?.finish_reason,
      },
    };
  };

  /** @inheritDoc */
  protected _generateCompletionRaw = async (
    prompt: string,
    options?: CompletionOptions,
  ): Promise<ChatResponse> => {
    return this._generateChatRaw([{ role: 'user', content: prompt }], options);
  };

  /** @inheritDoc */
  protected _extractStructuredJSONRaw = async <T>(
    prompt: string,
    _schema: TSchema,
    input: string,
  ): Promise<T> => {
    const client = this._getClient();

    const completion = await client.chat.completions.create({
      model: this._model,
      messages: [
        {
          role: 'system',
          content: `${prompt}\n\nRespond ONLY with valid JSON. Do not include markdown formatting, explanation, or code blocks.`,
        },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const rawText = completion.choices?.[0]?.message?.content ?? '{}';

    try {
      return JSON.parse(rawText) as T;
    } catch {
      throw new AiServiceError(
        'invalid_response',
        'OpenAI returned invalid JSON in extraction mode',
      );
    }
  };

  /** @inheritDoc */
  protected _classifyTextRaw = async (
    input: string,
    labels: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult> => {
    const model = options?.model ?? this._model;
    const labelList = labels.map((l) => `"${l}"`).join(', ');

    const response = await this._generateChatRaw(
      [
        {
          role: 'system',
          content: `Classify the user's text into exactly one of these labels: [${labelList}]. Respond with only the label name, nothing else.`,
        },
        { role: 'user', content: input },
      ],
      { model, temperature: 0 },
    );

    const selectedLabel = response.text.trim();
    const result: ClassificationResult = { label: selectedLabel };

    if (options?.includeScores) {
      result.score = labels.includes(selectedLabel) ? 1 : 0;
    }

    return result;
  };

  /** @inheritDoc */
  protected _generateEmbeddingRaw = async (
    text: string,
    options?: EmbeddingOptions,
  ): Promise<number[]> => {
    const client = this._getClient();
    const model = options?.model ?? 'text-embedding-3-small';

    const response = await client.embeddings.create({
      model,
      input: text,
    });

    return response.data?.[0]?.embedding ?? [];
  };

  /** @inheritDoc */
  protected _generateEmbeddingsRaw = async (
    texts: string[],
    options?: EmbeddingOptions,
  ): Promise<number[][]> => {
    if (texts.length === 0) {
      return [];
    }

    const client = this._getClient();
    const model = options?.model ?? 'text-embedding-3-small';

    const response = await client.embeddings.create({
      model,
      input: texts,
    });

    return (response.data ?? []).map((item: { embedding: number[] }) => item.embedding);
  };

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Lazily initialize the OpenAI client.
   *
   * The client is not created at import time — only on first API call.
   * The `openai` SDK is loaded via `require()` to prevent vendor lock-in
   * at module import time.
   */
  private _getClient(): OpenAIClient {
    if (this._client) {
      return this._client;
    }

    if (!this._apiKey) {
      throw new AiServiceError(
        'authentication_failed',
        'OpenAI API key is required (set OPENAI_API_KEY or pass apiKey in options)',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    const { default: OpenAICtor } = require('openai');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this._client = new OpenAICtor({
      apiKey: this._apiKey,
      organization: this._organization,
      baseURL: this._baseUrl,
    }) as OpenAIClient;

    return this._client;
  }
}
