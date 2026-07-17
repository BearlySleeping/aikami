// packages/frontend/ai-gateway/src/lib/sse.ts
//
// Chat-completions SSE stream reader — relocated verbatim from the client's
// text_generation_service (C-080/C-111) so streaming semantics (chunk
// delivery order, first-chunk timeout, idle timeout) are identical.
// Contract: C-320 AC-2

/** Timeout for the entire fetch+stream operation (90 seconds). */
export const GATEWAY_FETCH_TIMEOUT_MS = 90_000;

/** Maximum time to wait for the first SSE chunk (15 seconds). */
export const GATEWAY_FIRST_CHUNK_TIMEOUT_MS = 15_000;

/**
 * Timeout for individual SSE stream read operations after content has started
 * flowing. Kept short (5s) to prevent inputs staying disabled when the
 * provider delays the [DONE] signal after the last text chunk.
 */
export const GATEWAY_IDLE_TIMEOUT_MS = 5_000;

/**
 * Reads a chat completions SSE response stream.
 *
 * Each line is `data: {"id":"...","choices":[{"delta":{"content":"token"}}]}`.
 * The stream ends with `data: [DONE]`.
 */
export const readChatSseStream = async (options: {
  body: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  onChunk: (text: string) => void;
  firstChunkTimeoutMs?: number;
  idleTimeoutMs?: number;
  /** Optional debug hook, e.g. ('done', { chunkCount }). */
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
}): Promise<void> => {
  const {
    body,
    signal,
    onChunk,
    firstChunkTimeoutMs = GATEWAY_FIRST_CHUNK_TIMEOUT_MS,
    idleTimeoutMs = GATEWAY_IDLE_TIMEOUT_MS,
    onEvent,
  } = options;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;
  let isFirstChunk = true;
  let hasReceivedContent = false;

  try {
    while (true) {
      if (signal.aborted) {
        return;
      }

      const timeout = isFirstChunk
        ? firstChunkTimeoutMs
        : hasReceivedContent
          ? idleTimeoutMs
          : firstChunkTimeoutMs;
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

        // Skip non-data lines
        if (!trimmed.startsWith('data: ')) {
          continue;
        }

        const data = trimmed.slice(6);

        // End of stream signal
        if (data === '[DONE]') {
          onEvent?.('done', { chunkCount });
          return;
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
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
            chunkCount++;
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
