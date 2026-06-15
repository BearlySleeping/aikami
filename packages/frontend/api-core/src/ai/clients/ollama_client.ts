/** biome-ignore-all lint/style/useNamingConvention: Ollama API uses snake_case fields */
// packages/frontend/api-core/src/ai/clients/ollama_client.ts

import type { TSchema } from 'typebox';

import type { FrontendAiInterface } from '../frontend_ai_interface.ts';
import type {
  AiProviderCapabilities,
  ContentDescriptionOptions,
  DialogueContext,
  DialogueOptions,
  DialogueResponse,
  HealthCheckResult,
  ImageOptions,
  ImageResult,
  OllamaClientOptions,
  SpeechResult,
  TtsOptions,
} from '../types.ts';

// ---------------------------------------------------------------------------
// Ollama-specific error types
// ---------------------------------------------------------------------------

/** Thrown when Ollama is not reachable (connection refused). */
export class OllamaConnectionError extends Error {
  constructor(baseUrl: string, cause?: unknown) {
    super(
      `Ollama connection refused at ${baseUrl}${cause instanceof Error ? `: ${cause.message}` : ''}`,
    );
    this.name = 'OllamaConnectionError';
  }
}

/** Thrown when an Ollama request times out. */
export class OllamaTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Ollama request timed out after ${timeoutMs}ms`);
    this.name = 'OllamaTimeoutError';
  }
}

/** Thrown when the Ollama stream encounters an error (non-200 response or parse failure). */
export class OllamaStreamError extends Error {
  constructor(status: number, message: string) {
    super(`Ollama stream error (${status}): ${message}`);
    this.name = 'OllamaStreamError';
  }
}

/**
 * Ollama local provider — connects directly to a local Ollama instance.
 *
 * Uses plain `fetch()` against `http://localhost:11434`. Does NOT route
 * through the backend. Requires Ollama to be running on the user's machine.
 *
 * API: https://github.com/ollama/ollama/blob/main/docs/api.md
 */
class OllamaClient implements FrontendAiInterface {
  readonly name = 'ollama';
  readonly capabilities: AiProviderCapabilities = {
    dialogue: true,
    contentDescription: true,
    speech: false,
    image: false,
    structured: true,
    requiresBackend: false,
    isLocal: true,
  };

  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private defaultOptions: Required<NonNullable<OllamaClientOptions['defaultOptions']>>;

  /**
   * @param options - Ollama client configuration.
   */
  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.model = options.model ?? 'llama3';
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.defaultOptions = {
      temperature: options.defaultOptions?.temperature ?? 0.7,
      topP: options.defaultOptions?.topP ?? 0.9,
      maxTokens: options.defaultOptions?.maxTokens ?? 2048,
    };
  }

  // -----------------------------------------------------------------------
  // Dialogue
  // -----------------------------------------------------------------------

  async generateDialogue(
    context: DialogueContext,
    options?: DialogueOptions,
  ): Promise<DialogueResponse> {
    const messages: Array<{ role: string; content: string }> = [];

    if (context.systemPrompt) {
      messages.push({ role: 'system', content: context.systemPrompt });
    }

    if (context.history) {
      for (const msg of context.history) {
        messages.push({
          role: msg.role === 'npc' ? 'assistant' : 'user',
          content: msg.text,
        });
      }
    }

    messages.push({ role: 'user', content: context.playerInput });

    const body = {
      model: options?.model ?? this.model,
      messages,
      options: {
        temperature: options?.temperature ?? this.defaultOptions.temperature,
        top_p: this.defaultOptions.topP,
        num_predict: options?.maxTokens ?? this.defaultOptions.maxTokens,
      },
      stream: false,
    };

    const data = await this.post<OllamaChatResponse>('/api/chat', body);

    return {
      text: data.message?.content ?? '',
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Content Description
  // -----------------------------------------------------------------------

  async generateContentDescription(
    prompt: string,
    options?: ContentDescriptionOptions,
  ): Promise<string> {
    const body = {
      model: options?.model ?? this.model,
      messages: [
        { role: 'system', content: 'You generate concise game content descriptions.' },
        { role: 'user', content: prompt },
      ],
      options: {
        temperature: options?.temperature ?? this.defaultOptions.temperature,
        top_p: this.defaultOptions.topP,
        num_predict: options?.maxTokens ?? this.defaultOptions.maxTokens,
      },
      stream: false,
    };

    const data = await this.post<OllamaChatResponse>('/api/chat', body);

    return data.message?.content ?? '';
  }

  // -----------------------------------------------------------------------
  // Speech — not supported
  // -----------------------------------------------------------------------

  async synthesizeSpeech(_text: string, _options?: TtsOptions): Promise<SpeechResult> {
    throw new Error('Ollama does not support speech synthesis. Use LocalTtsClient.');
  }

  // -----------------------------------------------------------------------
  // Image — not supported (Ollama has vision models but that's a different pattern)
  // -----------------------------------------------------------------------

  async generateImage(_prompt: string, _options?: ImageOptions): Promise<ImageResult> {
    throw new Error('Ollama does not support image generation. Use ComfyUiClient.');
  }

  // -----------------------------------------------------------------------
  // Structured
  // -----------------------------------------------------------------------

  async generateStructured<T>(instruction: string, _schema: TSchema, context?: string): Promise<T> {
    const fullContext = context ? `${instruction}\n\nContext: ${context}` : instruction;

    const body = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You generate structured JSON output only. No explanations, no markdown formatting.',
        },
        { role: 'user', content: fullContext },
      ],
      options: {
        temperature: 0.1, // Low temperature for structured output
        top_p: 0.9,
        num_predict: 1024,
      },
      format: 'json', // Ollama's JSON mode
      stream: false,
    };

    const data = await this.post<OllamaChatResponse>('/api/chat', body);

    try {
      return JSON.parse(data.message?.content ?? '{}') as T;
    } catch {
      throw new Error('Failed to parse Ollama response as JSON');
    }
  }

  // -----------------------------------------------------------------------
  // Health Check
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const start = performance.now();
      await this.get<OllamaTagsResponse>('/api/tags');
      const latencyMs = Math.round(performance.now() - start);

      return { available: true, latencyMs, message: 'Ollama running' };
    } catch (err) {
      return {
        available: false,
        latencyMs: 0,
        message: err instanceof Error ? err.message : 'Ollama unreachable',
      };
    }
  }

  // -----------------------------------------------------------------------
  // HTTP Helpers
  // -----------------------------------------------------------------------

  /**
   * Streams NPC dialogue from Ollama's /api/generate endpoint using
   * application/x-ndjson streaming. Yields text chunks as they arrive.
   *
   * Unlike generateDialogue() which uses /api/chat, this uses the raw
   * generate endpoint for token-by-token streaming into the dialogue UI.
   *
   * @param prompt - The full prompt text (includes system prompt and conversation).
   * @param context - Optional model override and generation parameters.
   * @yields Text chunks as Ollama generates them.
   * @throws {OllamaConnectionError} If Ollama is not reachable.
   * @throws {OllamaTimeoutError} If the request times out.
   * @throws {OllamaStreamError} If the stream encounters an API error.
   */
  async *streamChat(
    prompt: string,
    context?: Array<{ role: string; content: string }>,
  ): AsyncGenerator<string, void, undefined> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: true,
      options: {
        temperature: this.defaultOptions.temperature,
        top_p: this.defaultOptions.topP,
        num_predict: this.defaultOptions.maxTokens,
      },
    };

    // If context messages are provided, build a formatted prompt from them
    if (context && context.length > 0) {
      const formattedContext = context.map((m) => `${m.role}: ${m.content}`).join('\n');
      body.prompt = `${formattedContext}\nassistant:`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new OllamaStreamError(response.status, text);
      }

      if (!response.body) {
        throw new OllamaStreamError(response.status, 'No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) {
              continue;
            }

            try {
              const parsed = JSON.parse(trimmed) as OllamaGenerateResponse;
              if (parsed.response) {
                yield parsed.response;
              }
              if (parsed.done) {
                return;
              }
            } catch {
              // Skip unparseable lines (partial buffers at stream start)
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new OllamaTimeoutError(this.timeoutMs);
      }

      if (err instanceof OllamaStreamError) {
        throw err;
      }

      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new OllamaConnectionError(this.baseUrl, err);
      }

      throw err;
    }
  }

  /**
   * POST to Ollama's local API.
   */
  private async post<TResponse>(path: string, body: unknown): Promise<TResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');

        throw new Error(`Ollama API error (${response.status}): ${text}`);
      }

      return response.json() as Promise<TResponse>;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Ollama request timed out');
      }

      throw err;
    }
  }

  /**
   * GET from Ollama's local API.
   */
  private async get<TResponse>(path: string): Promise<TResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error (${response.status})`);
      }

      return response.json() as Promise<TResponse>;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Ollama health check timed out');
      }

      throw err;
    }
  }
}

export { OllamaClient };

// ---------------------------------------------------------------------------
// Ollama API types (internal — not exported from package)
// ---------------------------------------------------------------------------

/** Response from POST /api/chat */
type OllamaChatResponse = {
  model: string;
  created_at: string;
  message?: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
};

/** Response from GET /api/tags */
type OllamaTagsResponse = {
  models: Array<{ name: string; modified_at: string; size: number }>;
};

/** Response chunk from POST /api/generate (streaming). */
type OllamaGenerateResponse = {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
};
