// packages/backend/ai/src/lib/gemini-service.ts

import type {
  AIChatMessage,
  ChatOptions,
  ChatResponse,
  ClassificationOptions,
  ClassificationResult,
  CompletionOptions,
  EmbeddingOptions,
} from '@aikami/types';
import type { z } from 'zod';

import { BaseAiService } from './base_ai_service.ts';
import { AiServiceError } from './errors.ts';
import type { GeminiServiceOptions } from './types.ts';

/**
 * Minimal type interface for the dynamically loaded Gemini SDK.
 * Only covers the API surface we use.
 *
 * The actual `@google/generative-ai` package is loaded via `require()` at runtime,
 * not imported at module level — this prevents vendor lock-in.
 */
type GeminiClient = {
  model: (name: string) => GeminiModel;
};

type GeminiModel = {
  generateContent: (params: Record<string, unknown>) => Promise<GeminiGenerateResponse>;
  embedContent: (text: string) => Promise<GeminiEmbedResponse>;
};

type GeminiGenerateResponse = {
  response: GeminiResponse;
};

type GeminiResponse = {
  text?: () => string;
  promptFeedback?: {
    blockReason?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  candidates?: Array<{
    finishReason?: string;
  }>;
};

type GeminiEmbedResponse = {
  embedding?: {
    values?: number[];
  };
};

/**
 * Gemini content format (maps from our canonical AIChatMessage).
 */
type GeminiContent = {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
};

/**
 * Gemini driver implementing {@link AiServiceInterface}.
 *
 * Uses the `@google/generative-ai` SDK. Handles:
 * - gemini-2.0-flash, gemini-2.5-pro, gemini-2.5-flash
 * - Safety filter translation to AiServiceError
 * - Message format normalization (OpenAI canonical → Gemini contents)
 */
export class GeminiService extends BaseAiService {
  readonly name = 'gemini';

  private readonly _apiKey: string;
  private readonly _defaultChatOptions?: ChatOptions;
  private readonly _safetyThreshold: string;
  private _client: GeminiClient | undefined = undefined;

  constructor(options: GeminiServiceOptions) {
    super({
      name: 'Gemini',
      model: options.model ?? 'gemini-2.0-flash',
      apiKey: options.apiKey,
      rateLimiter: options.rateLimiter,
      circuitBreaker: options.circuitBreaker,
      retry: options.retry,
      debug: options.debug,
    });

    this._apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? '';
    this._defaultChatOptions = options.defaultChatOptions;
    this._safetyThreshold = options.safetyThreshold ?? 'BLOCK_ONLY_HIGH';
  }

  // ── Abstract method implementations ───────────────────────────────────────

  /** @inheritDoc */
  protected _generateChatRaw = async (
    messages: AIChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> => {
    const client = this._getClient();
    const model = client.model(options?.model ?? this._model);

    const { systemMessage, contents } = this._canonicalToGemini(messages);

    const generationConfig: Record<string, unknown> = {};
    if (options?.maxTokens ?? this._defaultChatOptions?.maxTokens) {
      generationConfig.maxOutputTokens = options?.maxTokens ?? this._defaultChatOptions?.maxTokens;
    }
    if (options?.temperature ?? this._defaultChatOptions?.temperature) {
      generationConfig.temperature = options?.temperature ?? this._defaultChatOptions?.temperature;
    }
    if (options?.topP ?? this._defaultChatOptions?.topP) {
      generationConfig.topP = options?.topP ?? this._defaultChatOptions?.topP;
    }
    if (options?.stopSequences ?? this._defaultChatOptions?.stopSequences) {
      generationConfig.stopSequences =
        options?.stopSequences ?? this._defaultChatOptions?.stopSequences;
    }

    const requestPayload: Record<string, unknown> = {
      contents,
      safetySettings: this._getSafetySettings(),
    };

    if (Object.keys(generationConfig).length > 0) {
      requestPayload.generationConfig = generationConfig;
    }

    if (systemMessage) {
      requestPayload.systemInstruction = { parts: [{ text: systemMessage }] };
    }

    const result = await model.generateContent(requestPayload);
    const response = result.response;

    // Check for safety blocks
    if (response.promptFeedback?.blockReason) {
      throw new AiServiceError(
        'content_filtered',
        `Gemini blocked response: ${response.promptFeedback.blockReason}`,
      );
    }

    const text = response.text?.() ?? '';
    const usageMetadata = response.usageMetadata;

    return {
      text,
      usage: usageMetadata
        ? {
            promptTokens: usageMetadata.promptTokenCount ?? 0,
            completionTokens: usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: usageMetadata.totalTokenCount ?? 0,
          }
        : undefined,
      metadata: {
        model: this._model,
        finishReason: response.candidates?.[0]?.finishReason,
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
    _schema: z.ZodSchema<T>,
    input: string,
  ): Promise<T> => {
    const client = this._getClient();
    const model = client.model(this._model);

    const combinedPrompt = `${prompt}\n\nRespond ONLY with valid JSON. Do not include markdown formatting, explanation, or code blocks.\n\nInput: ${input}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
      safetySettings: this._getSafetySettings(),
    });

    const response = result.response;
    const rawText = response.text?.() ?? '{}';

    // Strip markdown code fences if present
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    try {
      return JSON.parse(jsonText) as T;
    } catch {
      throw new AiServiceError(
        'invalid_response',
        'Gemini returned invalid JSON in extraction mode',
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
          role: 'user',
          content: `Classify the following text into exactly one of these labels: [${labelList}]. Respond with only the label name.\n\nText: ${input}`,
        },
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
    const embeddingModel = client.model(options?.model ?? 'text-embedding-004');

    const result = await embeddingModel.embedContent(text);
    return result.embedding?.values ?? [];
  };

  /** @inheritDoc */
  protected _generateEmbeddingsRaw = async (
    texts: string[],
    options?: EmbeddingOptions,
  ): Promise<number[][]> => {
    if (texts.length === 0) {
      return [];
    }

    // Gemini doesn't support batch embedding natively — embed sequentially
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this._generateEmbeddingRaw(text, options);
      embeddings.push(embedding);
    }

    return embeddings;
  };

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Lazily initialize the Gemini client.
   */
  private _getClient(): GeminiClient {
    if (this._client) {
      return this._client;
    }

    if (!this._apiKey) {
      throw new AiServiceError(
        'authentication_failed',
        'Gemini API key is required (set GEMINI_API_KEY or pass apiKey in options)',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    const { GoogleGenerativeAI } = require('@google/generative-ai');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    this._client = new GoogleGenerativeAI(this._apiKey) as GeminiClient;

    return this._client;
  }

  /**
   * Convert canonical AIChatMessage array to Gemini's contents format.
   *
   * Gemini uses `role: 'user' | 'model'` (not 'assistant') and the
   * system prompt is passed as `systemInstruction` separately.
   */
  private _canonicalToGemini(messages: AIChatMessage[]): {
    systemMessage: string | null;
    contents: GeminiContent[];
  } {
    let systemMessage: string | null = null;
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Combine multiple system messages
        systemMessage = systemMessage ? `${systemMessage}\n${msg.content}` : msg.content;
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const prevContent = contents[contents.length - 1];

      // Merge consecutive messages from the same role
      if (prevContent && prevContent.role === role) {
        prevContent.parts.push({ text: msg.content });
      } else {
        contents.push({ role, parts: [{ text: msg.content }] });
      }
    }

    return { systemMessage, contents };
  }

  /**
   * Build Gemini safety settings based on the configured threshold.
   */
  private _getSafetySettings(): Array<Record<string, string>> {
    const categories = [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ];

    return categories.map((category) => ({
      category,
      threshold: this._safetyThreshold,
    }));
  }
}
