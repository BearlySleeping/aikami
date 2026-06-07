// apps/frontend/pwa/src/routes/api/text/+server.ts
import { json } from '@sveltejs/kit';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Types (local — avoids bundling @aikami/backend/ai in static PWA build)
// ---------------------------------------------------------------------------

/** Provider type for the text generation gateway. */
type TextGenerationProvider = 'openrouter' | 'ollama';

/** Text generation request payload. */
type TextGenerationRequest = {
  prompt: string;
  provider?: TextGenerationProvider;
  model?: string;
  systemPrompt?: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
};

/** Text generation configuration. */
type TextGenerationConfig = {
  provider: TextGenerationProvider;
  openrouterBaseUrl?: string;
  openrouterApiKey?: string;
  ollamaBaseUrl?: string;
};

// ---------------------------------------------------------------------------
// Ollama adapter (VRAM eviction AC-2)
// ---------------------------------------------------------------------------

const OLLAMA_VRAM_EVICTION_PARAMS = {
  stream: true,
  keep_alive: 0,
  options: { num_parallel: 1 },
};

const buildOllamaPayload = (request: TextGenerationRequest): Record<string, unknown> => {
  let fullPrompt = '';

  if (request.systemPrompt) {
    fullPrompt += `System: ${request.systemPrompt}\n\n`;
  }

  for (const message of request.messages ?? []) {
    fullPrompt += `${message.role}: ${message.content}\n`;
  }

  fullPrompt += `user: ${request.prompt}`;

  return {
    model: request.model ?? 'llama3.2',
    prompt: fullPrompt,
    ...OLLAMA_VRAM_EVICTION_PARAMS,
  };
};

// ---------------------------------------------------------------------------
// OpenRouter adapter
// ---------------------------------------------------------------------------

const buildOpenRouterPayload = (request: TextGenerationRequest): Record<string, unknown> => {
  const messages: Array<{ role: string; content: string }> = [];

  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }

  for (const message of request.messages ?? []) {
    messages.push({ role: message.role, content: message.content });
  }

  messages.push({ role: 'user', content: request.prompt });

  return {
    model: request.model ?? 'openai/gpt-4o',
    messages,
    stream: true,
  };
};

// ---------------------------------------------------------------------------
// SSE stream helpers
// ---------------------------------------------------------------------------

const streamProviderResponse = async (
  response: Response,
  format: 'ollama' | 'openrouter',
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Provider response has no readable body');
  }

  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal?.aborted) {
        controller.close();
        return;
      }

      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }

      const text = decoder.decode(value, { stream: true });

      if (format === 'ollama') {
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const chunk = JSON.parse(line);

            if (chunk.done) {
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            } else if (chunk.response) {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ text: chunk.response })}\n\n`),
              );
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      } else {
        // OpenRouter format (SSE lines starting with "data: ")
        const lines = text.split('\n').filter((line) => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          } else {
            try {
              const chunk = JSON.parse(data);
              const content = chunk.choices?.[0]?.delta?.content;
              if (content) {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ text: content })}\n\n`),
                );
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    },

    cancel() {
      reader.cancel();
    },
  });
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const getTextGenerationConfig = (): TextGenerationConfig => {
  return {
    provider: (process.env.PUBLIC_TEXT_GEN_PROVIDER as TextGenerationProvider) ?? 'ollama',
    openrouterBaseUrl: process.env.PUBLIC_OPENROUTER_BASE_URL || undefined,
    openrouterApiKey: process.env.OPENROUTER_API_KEY || undefined,
    ollamaBaseUrl: process.env.PUBLIC_OLLAMA_BASE_URL || 'http://localhost:11434',
  };
};

// ---------------------------------------------------------------------------
// Synthetic SSE mock (AC-4 — test mode)
// ---------------------------------------------------------------------------

const createMockStream = (): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"text":"Mock "}\n\n',
    'data: {"text":"SSE "}\n\n',
    'data: {"text":"response"}\n\n',
    'data: [DONE]\n\n',
  ];

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
};

// ---------------------------------------------------------------------------
// POST /api/text — SSE text generation endpoint (AC-3)
// ---------------------------------------------------------------------------

export const POST = async ({ request }: { request: Request }) => {
  logger.debug('POST /api/text');

  // AC-4: test mode — synthetic mock
  const isTestMode = request.headers.get('x-test-mode') === 'true';

  if (isTestMode) {
    return new Response(createMockStream(), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // Parse request body
  let body: TextGenerationRequest;

  try {
    body = await request.json();
  } catch {
    logger.warn('POST /api/text: invalid JSON body');
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.prompt || typeof body.prompt !== 'string') {
    logger.warn('POST /api/text: missing prompt');
    return json({ error: 'Missing required field: prompt' }, { status: 400 });
  }

  const config = getTextGenerationConfig();
  const provider = body.provider ?? config.provider;

  try {
    let response: Response;
    let format: 'ollama' | 'openrouter';

    if (provider === 'openrouter') {
      const baseUrl = config.openrouterBaseUrl ?? 'https://openrouter.ai/api/v1';
      const url = `${baseUrl}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (config.openrouterApiKey) {
        headers['Authorization'] = `Bearer ${config.openrouterApiKey}`;
      }

      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(buildOpenRouterPayload(body)),
          signal: request.signal,
        });
      } catch {
        // Fallback to Ollama
        const ollamaUrl = `${config.ollamaBaseUrl ?? 'http://localhost:11434'}/api/generate`;
        response = await fetch(ollamaUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildOllamaPayload(body)),
          signal: request.signal,
        });
        format = 'ollama';
      }

      format = 'openrouter';
    } else {
      const ollamaUrl = `${config.ollamaBaseUrl ?? 'http://localhost:11434'}/api/generate`;
      response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOllamaPayload(body)),
        signal: request.signal,
      });
      format = 'ollama';
    }

    if (!response.ok) {
      logger.error('POST /api/text: provider error', {
        status: response.status,
        provider,
      });
      return json({ error: `Provider returned ${response.status}` }, { status: 502 });
    }

    const stream = await streamProviderResponse(response, format, request.signal);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return new Response(null, { status: 499 });
    }

    logger.error('POST /api/text: stream creation failed', error);
    return json({ error: 'Text generation failed' }, { status: 500 });
  }
};
