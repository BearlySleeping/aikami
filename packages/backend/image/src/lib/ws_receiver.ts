// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case field names
// packages/backend/image/src/lib/ws_receiver.ts
import { logger } from '$logger';
import type { GenerationResult } from './types.ts';

/** Default timeout for waiting on a WebSocket generation to complete. */
const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;

/**
 * ComfyUI WebSocket Receiver — connects to a ComfyUI instance's WebSocket
 * endpoint and listens for generation progress, capturing binary image
 * frames as they arrive.
 *
 * **AC3 gotcha**: ComfyUI's binary WebSocket messages have an 8-byte header
 * that must be stripped before the remaining bytes are treated as image data.
 */
export class ComfyUIWsReceiver {
  private readonly _baseUrl: string;
  private readonly _clientId: string;
  private _ws: WebSocket | undefined;

  constructor(options: { baseUrl: string; clientId: string }) {
    this._baseUrl = options.baseUrl.replace(/\/$/, '');
    this._clientId = options.clientId;
  }

  /**
   * Opens a WebSocket connection to ComfyUI.
   *
   * The connection URL includes the clientId query param which ComfyUI
   * uses to route execution events back to this client.
   */
  async connect(): Promise<void> {
    logger.debug('connect', { clientId: this._clientId });

    const wsUrl = `${this._baseUrl.replace(/^http/, 'ws')}/ws?clientId=${this._clientId}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        logger.debug('connect: WebSocket opened', { clientId: this._clientId });
        this._ws = ws;
        resolve();
      };

      ws.onerror = (event: unknown) => {
        logger.error('connect: WebSocket error', { clientId: this._clientId, event });
        reject(new Error(`WebSocket connection failed for client ${this._clientId}`));
      };
    });
  }

  /**
   * Listens for the generation lifecycle of a specific prompt.
   *
   * The flow:
   * 1. Listen for `executing` messages with the matching prompt_id
   * 2. When `executing` sends `node: null`, the generation is complete
   * 3. Capture the next binary frame as the image output
   * 4. Strip the 8-byte ComfyUI binary header
   * 5. Detect the MIME type from the image magic bytes
   * 6. Resolve with the GenerationResult
   */
  async listenForGeneration(options: {
    promptId: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<GenerationResult> {
    const { promptId, signal, timeoutMs = DEFAULT_GENERATION_TIMEOUT_MS } = options;
    logger.debug('listenForGeneration', { promptId, timeoutMs });

    const ws = this._ws;
    if (!ws) {
      throw new Error('WebSocket not connected — call connect() first');
    }

    return new Promise<GenerationResult>((resolve, reject) => {
      let settled = false;
      let executionCompleted = false;
      let imageReceived = false;

      const settle = (result: GenerationResult | Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);

        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      };

      // AbortSignal handler
      const onAbort = () => {
        logger.debug('listenForGeneration: aborted', { promptId });
        settle(new Error('Generation aborted'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        settle(new Error('Generation aborted'));
        return;
      }

      // Timeout handler
      const timer = setTimeout(() => {
        logger.warn('listenForGeneration: timed out', { promptId, timeoutMs });
        settle(new Error(`Generation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.onmessage = (event: { data: unknown }) => {
        const rawData = event.data;

        // Binary frame — image data with 8-byte header
        if (rawData instanceof ArrayBuffer || rawData instanceof Uint8Array) {
          if (!executionCompleted) {
            // Binary frame before execution completed — unexpected, ignore
            logger.warn('listenForGeneration: binary frame before execution completion', {
              promptId,
            });
            return;
          }

          if (imageReceived) {
            // Already captured the first image — ignore subsequent frames
            return;
          }

          imageReceived = true;
          try {
            const result = this._parseBinaryFrame(rawData);
            settle(result);
          } catch (error) {
            logger.error('listenForGeneration: failed to parse binary frame', {
              promptId,
              error,
            });
            settle(new Error(`Binary frame parsing failed: ${String(error)}`));
          }
          return;
        }

        // Text frame — JSON message
        if (typeof rawData !== 'string') {
          logger.warn('listenForGeneration: unexpected message type', {
            promptId,
            type: typeof rawData,
          });
          return;
        }

        try {
          const message = JSON.parse(rawData) as {
            type: string;
            data: { prompt_id?: string; node?: string | null };
          };

          // Filter messages for our prompt
          if (message.data?.prompt_id && message.data.prompt_id !== promptId) {
            return;
          }

          if (message.type === 'executing') {
            if (message.data?.node === null) {
              // Execution complete — the next binary frame is our image
              logger.debug('listenForGeneration: execution complete', { promptId });
              executionCompleted = true;
            }
          } else if (message.type === 'execution_error') {
            settle(new Error('ComfyUI execution error'));
          } else if (message.type === 'execution_interrupted') {
            settle(new Error('ComfyUI execution interrupted'));
          }
        } catch {
          logger.warn('listenForGeneration: failed to parse WS message', { promptId });
        }
      };

      ws.onerror = () => {
        logger.error('listenForGeneration: WebSocket error', { promptId });
        settle(new Error('WebSocket error during generation'));
      };

      ws.onclose = () => {
        logger.debug('listenForGeneration: WebSocket closed', { promptId });
        if (!settled) {
          settle(new Error('WebSocket closed before generation completed'));
        }
      };
    });
  }

  /**
   * Closes the WebSocket connection.
   */
  close(): void {
    logger.debug('close', { clientId: this._clientId });
    if (this._ws) {
      this._ws.close();
      this._ws = undefined;
    }
  }

  // ── Private helpers ────────────────────────────────────────────

  /**
   * Parses a binary WebSocket frame received from ComfyUI.
   *
   * **AC3 gotcha**: ComfyUI prepends an 8-byte header to binary frames:
   * - Bytes 0-3: A 32-bit unsigned integer (likely the output node ID)
   * - Bytes 4-7: Additional metadata (often "imag" or image format marker)
   *
   * This method strips that header and detects the MIME type from the
   * magic bytes of the remaining image data.
   */
  private _parseBinaryFrame(rawData: ArrayBuffer | Uint8Array): GenerationResult {
    const buffer = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);

    if (buffer.length <= 8) {
      throw new Error(`Binary frame too short: ${buffer.length} bytes (expected > 8)`);
    }

    // Strip the 8-byte ComfyUI header
    const imageData = buffer.slice(8);
    const mimeType = this._detectMimeType(imageData);

    return {
      imageData,
      mimeType,
      promptId: '', // Filled in by the orchestrator
    };
  }

  /**
   * Detects MIME type from magic bytes at the start of image data.
   */
  private _detectMimeType(data: Uint8Array): string {
    if (data.length < 4) {
      return 'application/octet-stream';
    }

    // PNG: 89 50 4E 47
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
      return 'image/png';
    }

    // JPEG: FF D8 FF
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return 'image/jpeg';
    }

    // WebP: 52 49 46 46 ... 57 45 42 50
    if (
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data.length >= 12 &&
      data[8] === 0x57 &&
      data[9] === 0x45 &&
      data[10] === 0x42 &&
      data[11] === 0x50
    ) {
      return 'image/webp';
    }

    // GIF: 47 49 46
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
      return 'image/gif';
    }

    return 'application/octet-stream';
  }
}
