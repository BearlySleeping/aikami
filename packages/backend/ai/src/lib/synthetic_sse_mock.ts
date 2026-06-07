// packages/backend/ai/src/lib/synthetic_sse_mock.ts

import type { SseStreamEvent, SyntheticSseMockOptions } from './text_generation_types.ts';

/** Default chunks used when no custom chunks are provided. */
const DEFAULT_CHUNKS: SseStreamEvent[] = [
  { data: { text: 'Hello' } },
  { data: { text: ' from' } },
  { data: { text: ' the mock!' } },
];

/**
 * Format a single SSE event into the wire protocol string.
 *
 * Produces output like:
 * ```
 * event: message\n
 * data: {"key":"value"}\n\n
 * ```
 *
 * @param event — The event to serialize.
 * @returns The SSE-formatted string.
 */
const formatSseEvent = (event: SseStreamEvent): string => {
  let output = '';

  if (event.event) {
    output += `event: ${event.event}\n`;
  }

  const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
  output += `data: ${data}\n\n`;

  return output;
};

/**
 * Promise-based sleep for chunk delay simulation.
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

/**
 * Synthetic SSE Mock Service — yields fake SSE streams without hitting a real LLM.
 *
 * Implements AC-4: intercepts completion requests during testing and returns
 * pre-defined, static streams of chunks. Makes zero external HTTP requests —
 * pure in-memory, suitable for CI and watch-mode TDD.
 *
 * @example
 * ```typescript
 * const mock = new SyntheticSseMock();
 * const stream = mock.createStream({
 *   chunks: [{ data: { text: 'Hello ' } }, { data: { text: 'World!' } }],
 * });
 * // Read stream as SSE events...
 * ```
 */
export class SyntheticSseMock {
  private _history: SyntheticSseMockOptions[] = [];

  /**
   * Create a synthetic SSE ReadableStream.
   *
   * The stream yields pre-defined chunks as SSE events, with configurable
   * inter-chunk delay, optional [DONE] termination, and error simulation.
   *
   * @param options — Stream configuration.
   * @returns A ReadableStream of Uint8Array-encoded SSE events.
   */
  createStream(options: SyntheticSseMockOptions): ReadableStream<Uint8Array> {
    this._history.push({ ...options });

    const chunks = options.chunks ?? DEFAULT_CHUNKS;
    const delayMs = options.chunkDelayMs ?? 10;
    const emitDone = options.emitDone ?? true;
    const forceError = options.forceError;

    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        if (forceError) {
          controller.enqueue(
            new TextEncoder().encode(
              formatSseEvent({ event: 'error', data: { message: forceError } }),
            ),
          );
          controller.close();
          return;
        }

        for (const chunk of chunks) {
          await sleep(delayMs);
          controller.enqueue(new TextEncoder().encode(formatSseEvent(chunk)));
        }

        if (emitDone) {
          await sleep(delayMs);
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        }

        controller.close();
      },
    });
  }

  /**
   * Return the chronological call history for test assertions.
   */
  getStreamHistory(): readonly SyntheticSseMockOptions[] {
    return this._history;
  }

  /**
   * Reset all state: clears call history. Seeded chunks must be re-provided
   * on each `createStream` call (no persistent state to reset beyond history).
   */
  reset(): void {
    this._history = [];
  }
}
