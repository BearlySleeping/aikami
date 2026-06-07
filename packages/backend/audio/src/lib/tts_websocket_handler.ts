// packages/backend/audio/src/lib/tts_websocket_handler.ts

import type { ServerWebSocket } from 'bun';
import type { ChunkEvent } from './sentence_boundary_chunker.ts';
import { SentenceBoundaryChunker } from './sentence_boundary_chunker.ts';
import type { TtsJob } from './tts_worker_pool.ts';
import { TtsWorkerPool } from './tts_worker_pool.ts';

/** Configuration options for the TTS WebSocket handler. */
export type TtsWebSocketOptions = {
  /** Number of concurrent TTS worker threads (default: 1). */
  concurrency?: number;
};

/** Incoming client message types. */
type ClientMessage = { type: 'text'; data: string } | { type: 'end' };

/** Control message sent to the client. */
type ControlMessage = {
  type: 'audio_start' | 'audio_end' | 'error';
  messageId: string;
  timestamp: number;
  error?: string;
};

/**
 * Generate a unique message ID for control messages.
 */
const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
};

/**
 * TTS WebSocket session handler.
 *
 * Manages the full TTS pipeline for a single WebSocket connection:
 * 1. Sentence Boundary Chunker — buffers fragmented text into sentences
 * 2. TTS Worker Pool — dispatches sentences to Bun Worker threads
 * 3. Binary streaming — sends audio as raw Float32Array PCM buffers
 * 4. Control messages — `audio_start`, `audio_end`, `error` as JSON
 * 5. Abort on disconnect — terminates workers immediately when client closes
 *
 * Usage with Bun.serve():
 *
 * ```typescript
 * Bun.serve({
 *   websocket: {
 *     open(ws) {
 *       const session = createTtsWebSocketHandler(ws);
 *       // Store session keyed by ws for cleanup
 *     },
 *     message(ws, message) {
 *       const session = getSession(ws);
 *       session.onMessage(message);
 *     },
 *     close(ws) {
 *       const session = getSession(ws);
 *       session.onClose();
 *     },
 *   },
 * });
 * ```
 *
 * @param ws — The Bun ServerWebSocket for this client connection.
 * @param options — Optional configuration.
 * @returns A handler with `onMessage` and `onClose` callbacks.
 */
export const createTtsWebSocketHandler = (
  ws: ServerWebSocket<unknown>,
  options: TtsWebSocketOptions = {},
): { onMessage: (data: string | Buffer) => void; onClose: () => void } => {
  const chunker = new SentenceBoundaryChunker();
  const pool = new TtsWorkerPool({ concurrency: options.concurrency ?? 1 });

  let sequence = 0;
  let streamStarted = false;

  /**
   * Send a JSON control message to the client.
   */
  const sendControl = (type: ControlMessage['type'], error?: string): void => {
    const message: ControlMessage = {
      type,
      messageId: generateMessageId(),
      timestamp: Math.floor(Date.now() / 1000),
    };
    if (error) {
      message.error = error;
    }
    ws.send(JSON.stringify(message));
  };

  /**
   * Process a completed sentence through the worker pool and stream audio back.
   */
  const processSentence = async ({ sentence }: ChunkEvent): Promise<void> => {
    const currentSequence = sequence;
    sequence++;

    // Emit audio_start on first sentence
    if (!streamStarted) {
      streamStarted = true;
      sendControl('audio_start');
    }

    const job: TtsJob = {
      id: `tts_${currentSequence}`,
      text: sentence,
      sequence: currentSequence,
    };

    try {
      const results = await pool.processBatch({ jobs: [job] });
      const result = results[0];

      if (result && !result.error) {
        // Send audio as binary frame (raw Float32Array buffer)
        ws.send(result.audio.buffer);
      } else if (result?.error) {
        sendControl('error', result.error);
      }
    } catch (error) {
      // AbortError from pool — client may have disconnected
      if (error instanceof DOMException && error.name === 'AbortError') {
        return; // Silently stop
      }
      sendControl('error', error instanceof Error ? error.message : String(error));
    }
  };

  // Register sentence callback
  chunker.onSentence(processSentence);

  return {
    /**
     * Handle an incoming message from the client.
     *
     * Call this from Bun's `websocket.message` callback.
     */
    onMessage(data: string | Buffer): void {
      const raw = typeof data === 'string' ? data : new TextDecoder().decode(data);
      let message: ClientMessage;

      try {
        message = JSON.parse(raw);
      } catch {
        sendControl('error', 'Invalid JSON message');
        return;
      }

      if (message.type === 'text') {
        if (typeof message.data === 'string') {
          chunker.feed(message.data);
        }
      } else if (message.type === 'end') {
        chunker.close();

        // Wait for any in-flight jobs, then send audio_end
        setTimeout(() => {
          if (streamStarted) {
            sendControl('audio_end');
          }
        }, 50);
      }
    },

    /**
     * Handle client disconnect.
     *
     * Call this from Bun's `websocket.close` callback.
     * Terminates all workers immediately to free CPU resources.
     */
    onClose(): void {
      pool.terminate();
    },
  };
};
