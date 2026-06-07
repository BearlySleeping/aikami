// apps/frontend/pwa/src/lib/client/services/media/stream_orchestrator.svelte.ts
import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';
import type { AudioQueuePlayerInterface } from './audio_queue_player';
import type { PixiTextureInjectorInterface } from './pixi_texture_injector';

// ---------------------------------------------------------------------------
// Network Connection Interfaces
//
// These are the contracts that the StreamOrchestrator expects from the
// three network layers (Text SSE, Voice WS, Image WS). They are defined
// as minimal types so they can be easily mocked in tests and swapped
// for different transport implementations.
// ---------------------------------------------------------------------------

/** SSE-based text stream connection. */
export type TextStreamConnection = {
  /**
   * Starts receiving text chunks from the SSE endpoint.
   *
   * The `onChunk` callback is invoked for each text delta received.
   * The connection is long-lived and only terminates when the
   * {@link AbortSignal} is aborted.
   */
  start(options: { signal: AbortSignal; onChunk: (text: string) => void }): Promise<void>;
};

/** WebSocket-based audio (TTS) stream connection. */
export type AudioStreamConnection = {
  /**
   * Opens the WebSocket and begins receiving audio ArrayBuffers.
   *
   * The `onChunk` callback is invoked for each binary audio message.
   * The connection terminates when the signal is aborted or {@link close}
   * is called.
   */
  connect(options: { signal: AbortSignal; onChunk: (buffer: ArrayBuffer) => void }): void;

  /** Closes the WebSocket connection immediately. */
  close(): void;
};

/** WebSocket-based image generation stream connection. */
export type ImageStreamConnection = {
  /**
   * Opens the WebSocket and begins receiving image generation progress.
   *
   * The `onComplete` callback is invoked when the final image buffer
   * is received. The connection terminates when the signal is aborted
   * or {@link close} is called.
   */
  connect(options: { signal: AbortSignal; onComplete: (buffer: ArrayBuffer) => void }): void;

  /** Closes the WebSocket connection immediately. */
  close(): void;
};

// ---------------------------------------------------------------------------
// StreamOrchestrator
// ---------------------------------------------------------------------------

export type StreamOrchestratorOptions = BaseClassOptions & {
  textStream: TextStreamConnection;
  audioStream: AudioStreamConnection;
  imageStream: ImageStreamConnection;
  audioQueuePlayer: AudioQueuePlayerInterface;
  textureInjector: PixiTextureInjectorInterface;
};

export type StreamOrchestratorInterface = BaseClassInterface & {
  /** Whether dialogue generation is currently active. */
  readonly isGenerating: boolean;

  /** The progressively accumulated text from the SSE text stream. */
  readonly currentText: string;

  /** The ID of the NPC currently speaking (undefined when idle). */
  readonly currentSpeakerId: string | undefined;

  /** Number of audio chunks currently buffered in the audio queue. */
  readonly currentAudioQueueSize: number;

  /**
   * Initiates a full dialogue generation cycle.
   *
   * Opens all three streams simultaneously (text SSE, audio WS, image WS)
   * using a shared {@link AbortController}. Text is progressively
   * accumulated into {@link currentText}, audio chunks are fed to the
   * audio queue player, and the final image is injected into the PixiJS
   * scene when ready.
   *
   * If a generation is already in progress, it is cancelled before the
   * new one starts.
   */
  generateDialogue(options: { prompt: string; npcId: string; personaId: string }): Promise<void>;

  /**
   * Immediately aborts all active streams, stops audio playback, and
   * clears the injected texture.
   *
   * Safe to call when idle (no-op).
   */
  cancelGeneration(): void;
};

/**
 * Master controller for synchronized AI generation streams.
 *
 * Coordinates three concurrent network connections (Text SSE, Audio WS,
 * Image WS) through a single {@link AbortController}. Accumulates text
 * reactively via `$state`, delegates audio to the {@link AudioQueuePlayer},
 * and image injection to the {@link PixiTextureInjector}.
 *
 * The Svelte `$state` runes on `isGenerating`, `currentText`, and
 * `currentAudioQueueSize` allow the UI to react to stream progress
 * without polling.
 */
export class StreamOrchestrator
  extends BaseClass<StreamOrchestratorOptions>
  implements StreamOrchestratorInterface
{
  // NOTE: These are declared as regular class properties for unit test
  // compatibility (bun test doesn't process $state runes in .svelte.ts
  // files consistently). When used inside SvelteKit, the .svelte.ts
  // extension enables reactive $state wrappers via the Svelte compiler.
  isGenerating = false;
  currentText = '';
  currentSpeakerId: string | undefined = undefined;
  currentAudioQueueSize = 0;

  private readonly _textStream: TextStreamConnection;
  private readonly _audioStream: AudioStreamConnection;
  private readonly _imageStream: ImageStreamConnection;
  private readonly _audioQueue: AudioQueuePlayerInterface;
  private readonly _textureInjector: PixiTextureInjectorInterface;

  private _abortController: AbortController | undefined;

  constructor(options: StreamOrchestratorOptions) {
    super(options);
    this._textStream = options.textStream;
    this._audioStream = options.audioStream;
    this._imageStream = options.imageStream;
    this._audioQueue = options.audioQueuePlayer;
    this._textureInjector = options.textureInjector;
  }

  // -- Public API ----------------------------------------------------------

  async generateDialogue(options: {
    prompt: string;
    npcId: string;
    personaId: string;
  }): Promise<void> {
    this.debug('generateDialogue', options);
    const { npcId } = options;

    // Cancel any in-progress generation
    this.cancelGeneration();

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    this.isGenerating = true;
    this.currentText = '';
    this.currentSpeakerId = npcId;
    this.currentAudioQueueSize = 0;

    // Start audio queue for the new stream
    this._audioQueue.startStream();
    this._syncAudioQueueSize();

    // ── Text SSE ──────────────────────────────────────────────────────
    this._startTextStream(signal);

    // ── Audio WS ──────────────────────────────────────────────────────
    this._audioStream.connect({
      signal,
      onChunk: (buffer: ArrayBuffer) => {
        if (signal.aborted) {
          return;
        }
        this._audioQueue.enqueueChunk({ buffer });
        this._syncAudioQueueSize();
      },
    });

    // ── Image WS ──────────────────────────────────────────────────────
    this._imageStream.connect({
      signal,
      onComplete: async (buffer: ArrayBuffer) => {
        if (signal.aborted) {
          return;
        }
        try {
          await this._textureInjector.injectTexture({ buffer });
        } catch (error) {
          this.error('Texture injection failed', error);
        }
      },
    });
  }

  cancelGeneration(): void {
    this.debug('cancelGeneration');

    const controller = this._abortController;
    if (controller) {
      controller.abort();

      // Close WebSocket connections explicitly (AbortSignal handles
      // SSE fetches, but WebSockets need explicit close)
      this._audioStream.close();
      this._imageStream.close();

      this._abortController = undefined;
    }

    // Stop audio playback
    this._audioQueue.stop();

    // Clear injected texture
    this._textureInjector.clearTexture();

    // Reset state
    this.isGenerating = false;
    this.currentText = '';
    this.currentSpeakerId = undefined;
    this.currentAudioQueueSize = 0;
  }

  // -- Private helpers -----------------------------------------------------

  /**
   * Starts the text SSE stream.
   *
   * Each text chunk is accumulated into {@link currentText}. The
   * Promise from `start()` is intentionally not awaited — it resolves
   * only when the stream ends or is aborted.
   */
  private _startTextStream(signal: AbortSignal): void {
    this._textStream
      .start({
        signal,
        onChunk: (text: string) => {
          if (signal.aborted) {
            return;
          }
          this.currentText += text;
        },
      })
      .then(() => {
        // SSE stream ended naturally (server closed the connection)
        if (!signal.aborted) {
          this.isGenerating = false;
          this._audioQueue.endStream();
        }
      })
      .catch(() => {
        // AbortError or network error — silently handled, cancelGeneration
        // already updated the state if the abort came from us
        if (!signal.aborted) {
          this.isGenerating = false;
          this._audioQueue.stop();
        }
      });
  }

  /**
   * Syncs the reactive {@link currentAudioQueueSize} from the audio queue.
   *
   * Uses a rAF loop because the queue size changes as chunks are
   * scheduled and played, and Web Audio API scheduling doesn't emit
   * events for queue size changes.
   *
   * Falls back to setInterval in environments without rAF (e.g., unit tests).
   */
  private _syncAudioQueueSize(): void {
    const raf = (globalThis as Record<string, unknown>).requestAnimationFrame as
      | typeof requestAnimationFrame
      | undefined;
    const schedule =
      typeof raf === 'function'
        ? (cb: () => void) => raf(cb)
        : (cb: () => void) => setTimeout(cb, 16);

    const tick = (): void => {
      if (!this.isGenerating) {
        return;
      }
      this.currentAudioQueueSize = this._audioQueue.queueSize;
      schedule(tick);
    };

    schedule(tick);
  }

  override async dispose(): Promise<void> {
    this.cancelGeneration();
    await super.dispose();
  }
}

export const getStreamOrchestrator = (
  options: StreamOrchestratorOptions,
): StreamOrchestratorInterface => new StreamOrchestrator(options);
