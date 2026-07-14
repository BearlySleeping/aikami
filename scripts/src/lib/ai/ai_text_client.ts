// scripts/src/lib/ai/ai_text_client.ts
// Shared text-generation LLM client with SSE streaming and structured extraction.
//
// Supports: OpenRouter (OpenAI-compatible chat completions), custom endpoints.
// Provides: streamChat (SSE token streaming) + extractStructure (JSON Schema).
//
// Used by: client text_generation_service (future), scripts/ops, Pi extensions.
//
// Contract: C-080, C-111

// ── Types ─────────────────────────────────────────────────────

/** Role of a chat message participant. */
export type ChatMessageRole = 'user' | 'assistant' | 'system';

/** A single chat message in an LLM conversation. */
export type TextChatMessage = {
  role: ChatMessageRole;
  content: string;
};

/** Provider routing information. */
export type TextProviderConfig = {
  /** Provider identifier ('openrouter', 'custom', etc.). */
  provider: string;
  /** Fully qualified model slug. */
  model: string;
  /** Base URL for chat completions endpoint. */
  endpoint: string;
  /** API key for authentication. */
  apiKey?: string;
};

/** Options for streaming chat completion. */
export type StreamChatOptions = {
  /** Chat messages (history + current prompt). */
  messages: TextChatMessage[];
  /** Called with each token as it arrives. */
  onChunk: (text: string) => void;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Provider routing config. */
  provider: TextProviderConfig;
};

/** Options for structured extraction. */
export type ExtractStructureOptions = {
  /** JSON Schema for output validation. */
  schema: Record<string, unknown>;
  /** Schema name (for response_format). */
  schemaName: string;
  /** The user prompt / content to parse. */
  prompt: string;
  /** Optional system-level instruction. */
  systemPrompt?: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Provider routing config. */
  provider: TextProviderConfig;
};

// ── Constants ─────────────────────────────────────────────────

/** OpenRouter requires these headers for ranking/attribution on free models. */
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://aikami.app',
  'X-Title': 'Aikami',
} as const;

/** Timeout for the entire fetch+stream operation (90s). */
const FETCH_TIMEOUT_MS = 90_000;

/** Maximum time to wait for the first SSE chunk (15s). */
const FIRST_CHUNK_TIMEOUT_MS = 15_000;

/** Timeout for idle stream reads after content starts flowing (5s). */
const IDLE_TIMEOUT_MS = 5_000;

// ── URL resolution ────────────────────────────────────────────

/**
 * Resolves the chat completions URL from provider config.
 *
 * Strips trailing slash from endpoint and appends /chat/completions.
 * Defaults to OpenRouter if no endpoint is configured.
 */
const _resolveChatUrl = (provider: TextProviderConfig): string => {
  if (provider.endpoint) {
    const base = provider.endpoint.replace(/\/$/, '');
    return `${base}/chat/completions`;
  }
  return 'https://openrouter.ai/api/v1/chat/completions';
};

// ── SSE stream reader ─────────────────────────────────────────

/**
 * Reads an OpenAI-compatible SSE chat completions response stream.
 *
 * Each line is `data: {"id":"...","choices":[{"delta":{"content":"token"}}]}`.
 * The stream ends with `data: [DONE]`.
 *
 * @throws On stream timeout or network errors.
 */
const _readStream = async (options: {
  body: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<void> => {
  const { body, signal, onChunk } = options;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isFirstChunk = true;
  let hasReceivedContent = false;

  try {
    while (true) {
      if (signal.aborted) {
        return;
      }

      // Dynamic timeout: longer for first chunk, shorter for idle detection
      const timeout = isFirstChunk
        ? FIRST_CHUNK_TIMEOUT_MS
        : hasReceivedContent
          ? IDLE_TIMEOUT_MS
          : FIRST_CHUNK_TIMEOUT_MS;

      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Stream read timed out')), timeout),
        ),
      ]);
      isFirstChunk = false;
      const { value, done } = result;
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

        if (!trimmed.startsWith('data: ')) {
          continue;
        }

        const data = trimmed.slice(6);

        // End of stream
        if (data === '[DONE]') {
          return;
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              // biome-ignore lint/style/useNamingConvention: API field
              finish_reason?: string | null;
            }>;
          };

          const choice = parsed.choices?.[0];
          if (!choice) {
            continue;
          }

          const token = choice.delta?.content;
          if (token) {
            hasReceivedContent = true;
            onChunk(token);
          }
        } catch {
          // Skip unparseable lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
};

// ── JSON sanitisation ─────────────────────────────────────────

/**
 * Strips markdown fences and extracts the first JSON object/array from
 * a string that may contain explanatory text.
 *
 * Handles balance-checked brace/bracelet extraction for robustness.
 */
const _sanitizeJsonResponse = (raw: string): string => {
  let text = raw.trim();

  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = (fenceMatch[1] ?? '').trim();
  }

  // Find first { or [
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');

  let startIndex = objectStart;
  if (objectStart === -1 || (arrayStart !== -1 && arrayStart < objectStart)) {
    startIndex = arrayStart;
  }

  if (startIndex === -1) {
    throw new Error('No JSON object found in response');
  }

  text = text.slice(startIndex);

  // Balance brackets/braces
  let depth = 0;
  const opener = text[0] as string;
  const closer = opener === '{' ? '}' : ']';
  let inString = false;
  let escapeNext = false;
  let endIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === opener) {
      depth++;
    } else if (ch === closer) {
      depth--;
      if (depth === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error('Unbalanced JSON in response');
  }

  return text.slice(0, endIndex);
};

// ── Public API: streamChat ────────────────────────────────────

/**
 * Streams a chat completion from the configured text provider.
 *
 * Sends messages via OpenAI-compatible chat completions SSE endpoint.
 * Tokens are delivered via `onChunk` as they arrive.
 *
 * @throws On fetch failure, timeout, or abort.
 */
export const streamChat = async (options: StreamChatOptions): Promise<void> => {
  const { messages, onChunk, signal, provider } = options;

  const abortController = new AbortController();
  const timeoutId = setTimeout(
    () => abortController.abort(new Error('Fetch timed out')),
    FETCH_TIMEOUT_MS,
  );

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      return;
    }
    signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true });
  }

  try {
    const chatUrl = _resolveChatUrl(provider);

    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // biome-ignore lint/style/useNamingConvention: HTTP header
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        ...(provider.provider === 'openrouter' ? OPENROUTER_HEADERS : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error(`No response body from ${chatUrl}`);
    }

    await _readStream({
      body: response.body,
      signal: abortController.signal,
      onChunk,
    });
  } catch (error: unknown) {
    if ((error as Error).name === 'AbortError') {
      return;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Public API: extractStructure ──────────────────────────────

/**
 * Extracts a strictly-typed object from the LLM using JSON Schema
 * as a structural constraint.
 *
 * Uses native `response_format: json_schema` when available (OpenRouter),
 * falling back to system-prompt-based extraction on 400 rejection.
 *
 * @returns The parsed and validated object matching the schema shape.
 */
export const extractStructure = async (options: ExtractStructureOptions): Promise<unknown> => {
  const { schema, schemaName, prompt, systemPrompt, signal, provider } = options;

  const abortController = new AbortController();

  if (signal) {
    if (signal.aborted) {
      throw new Error('Aborted');
    }
    signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true });
  }

  // Build messages
  const messages: TextChatMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  const schemaInstruction = [
    'You are a structured data extraction tool.',
    'Your response MUST be valid JSON that conforms to the following JSON Schema:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    'Respond ONLY with the JSON object. No markdown fences, no explanations.',
    'Do not include any properties not defined in the schema.',
  ].join('\n');

  messages.push({ role: 'system', content: schemaInstruction });
  messages.push({ role: 'user', content: prompt });

  const chatUrl = _resolveChatUrl(provider);

  // Attempt native json_schema response_format
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    // biome-ignore lint/style/useNamingConvention: OpenAI field
    response_format: {
      type: 'json_schema',
      // biome-ignore lint/style/useNamingConvention: OpenAI field
      json_schema: {
        name: schemaName,
        schema,
        strict: true,
      },
    },
  };

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // biome-ignore lint/style/useNamingConvention: HTTP header
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      ...(provider.provider === 'openrouter' ? OPENROUTER_HEADERS : {}),
    },
    body: JSON.stringify(body),
    signal: abortController.signal,
  });

  if (!response.ok) {
    // If provider rejected structured output, fall back to system-prompt
    if (response.status === 400) {
      let accumulated = '';
      await streamChat({
        messages,
        signal: abortController.signal,
        provider,
        onChunk: (text: string) => {
          accumulated += text;
        },
      });
      const cleaned = _sanitizeJsonResponse(accumulated);
      return JSON.parse(cleaned);
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error('No response body');
  }

  let accumulated = '';
  await _readStream({
    body: response.body,
    signal: abortController.signal,
    onChunk: (text: string) => {
      accumulated += text;
    },
  });

  const cleaned = _sanitizeJsonResponse(accumulated);
  return JSON.parse(cleaned);
};

// ── Public API: generateText ──────────────────────────────────

/**
 * Simple non-streaming text generation (collects full response).
 *
 * Convenience wrapper around {@link streamChat} that accumulates
 * all tokens and returns the complete string.
 *
 * @returns The full generated text.
 */
export const generateText = async (options: {
  messages: TextChatMessage[];
  provider: TextProviderConfig;
  signal?: AbortSignal;
}): Promise<string> => {
  let result = '';

  await streamChat({
    ...options,
    onChunk: (text: string) => {
      result += text;
    },
  });

  return result;
};
