// apps/frontend/pwa/src/lib/client/services/media/stream_orchestrator.svelte.ts
import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';
import type { AudioQueuePlayerInterface } from './audio_queue_player';
import type { ConversationMessage } from './context_builder.ts';
import type { ConversationRepositoryInterface } from './conversation_repository.svelte.ts';
import type { ExpressionAssetResolverInterface } from './expression_asset_resolver';
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
   *
   * @param options.messages — conversation history sent to the backend
   *   so the LLM has full dialogue context.
   */
  start(options: {
    signal: AbortSignal;
    onChunk: (text: string) => void;
    messages: ConversationMessage[];
  }): Promise<void>;
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
  /**
   * Optional repository adapter for persisting completed dialogue turns.
   * When omitted, dialogue history is NOT saved (useful for transient
   * NPCs or testing).
   */
  conversationRepository?: ConversationRepositoryInterface;
  /**
   * Optional callback fired when an emotion tag is extracted from the
   * text stream. The raw tag (e.g. `<emotion:joy>`) is intercepted and
   * never exposed to `currentText` or the TTS worker.
   *
   * Called synchronously during chunk processing. The consumer should
   * handle the emotion quickly (e.g. dispatch to asset resolver).
   *
   * When omitted AND `expressionAssetResolver` is provided, the
   * orchestrator handles emotion extraction internally via the hybrid
   * trigger pipeline (AC4).
   */
  onEmotionExtracted?: (options: { npcId: string; emotion: string }) => void;
  /**
   * Maximum milliseconds to hold a partial tag in the buffer before
   * flushing it as regular text. Prevents dangling `<` from being
   * permanently swallowed (e.g. in math like `"5 < 10"`).
   *
   * @default 500
   */
  tagBufferTimeoutMs?: number;
  /**
   * Resolver for pre-generated static expression assets (AC3).
   *
   * When provided, the orchestrator wires up the hybrid trigger pipeline
   * internally: extracted emotion tags are resolved against this resolver.
   * Static hits bypass ComfyUI (fast-path). Misses fall back to
   * `expressionGenerator`.
   *
   * When omitted, only `onEmotionExtracted` is called (raw callback mode).
   */
  expressionAssetResolver?: ExpressionAssetResolverInterface;
  /**
   * Generator for dynamic expression images (ComfyUI fallback, AC4).
   *
   * Called when `expressionAssetResolver` returns no static asset for
   * the emotion. Must respect the AbortSignal — the orchestrator aborts
   * the previous request when a new emotion arrives before completion.
   *
   * When omitted and no static asset is found, expression extraction
   * is silently skipped (no dynamic generation).
   */
  expressionGenerator?: (options: {
    npcId: string;
    emotion: string;
    signal: AbortSignal;
  }) => Promise<ArrayBuffer>;
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
   *
   * @param options.messages — conversation history to pass to the LLM
   *   gateway.  Should be built by the {@link ContextBuilder} before
   *   calling this method.
   * @param options.chatId — ID of the chat document for persisting
   *   completed turns.  Required when `conversationRepository` is set.
   */
  generateDialogue(options: {
    prompt: string;
    npcId: string;
    personaId: string;
    messages?: ConversationMessage[];
    chatId?: string;
  }): Promise<void>;

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
  private readonly _conversationRepository: ConversationRepositoryInterface | undefined;

  private _abortController: AbortController | undefined;
  /** Staged save options for the current generation — populated in generateDialogue, consumed in _onStreamComplete. */
  private _pendingSaveOptions:
    | { chatId: string; npcId: string; playerMessage: ConversationMessage }
    | undefined;

  // ── Tag Buffer (AC1: Stream Interception) ──────────────────────────
  // Holds partial `<emotion:…` fragments across chunk boundaries so the
  // raw tag is never exposed to currentText or the TTS worker.
  private _tagBuffer = '';

  /** Timeout ID for flushing a dangling tag buffer (e.g. "5 <"). */
  private _tagBufferTimeoutId: ReturnType<typeof setTimeout> | undefined;

  /**
   * Maximum milliseconds to hold a partial tag before flushing it as
   * regular text. Prevents text like "5 <" from being swallowed permanently.
   */
  private readonly _tagBufferTimeoutMs: number;

  private readonly _onEmotionExtracted:
    | ((options: { npcId: string; emotion: string }) => void)
    | undefined;

  // ── Hybrid Trigger Pipeline (AC4) ─────────────────────────────────
  private readonly _expressionAssetResolver: ExpressionAssetResolverInterface | undefined;
  private readonly _expressionGenerator:
    | ((options: { npcId: string; emotion: string; signal: AbortSignal }) => Promise<ArrayBuffer>)
    | undefined;
  /** Currently active emotion — used to suppress duplicate requests. */
  private _currentEmotion: string | null = null;
  /** Abort controller for the active expression generation request. */
  private _expressionAbortController: AbortController | undefined;

  constructor(options: StreamOrchestratorOptions) {
    super(options);
    this._textStream = options.textStream;
    this._audioStream = options.audioStream;
    this._imageStream = options.imageStream;
    this._audioQueue = options.audioQueuePlayer;
    this._textureInjector = options.textureInjector;
    this._conversationRepository = options.conversationRepository;
    this._onEmotionExtracted = options.onEmotionExtracted;
    this._tagBufferTimeoutMs = options.tagBufferTimeoutMs ?? 500;
    this._expressionAssetResolver = options.expressionAssetResolver;
    this._expressionGenerator = options.expressionGenerator;
  }

  // -- Public API ----------------------------------------------------------

  async generateDialogue(options: {
    prompt: string;
    npcId: string;
    personaId: string;
    messages?: ConversationMessage[];
    chatId?: string;
  }): Promise<void> {
    this.debug('generateDialogue', options);
    const { chatId, messages, npcId, prompt } = options;

    // Cancel any in-progress generation
    this.cancelGeneration();

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    this.isGenerating = true;
    this.currentText = '';
    this.currentSpeakerId = npcId;
    this.currentAudioQueueSize = 0;
    this._currentEmotion = null;

    // Stage the save payload for the repository hook (AC2).
    // Cleared on cancel / new generation — only consumed on successful
    // stream completion.
    this._pendingSaveOptions =
      chatId && this._conversationRepository
        ? {
            chatId,
            npcId,
            playerMessage: { role: 'user', content: prompt },
          }
        : undefined;

    // Start audio queue for the new stream
    this._audioQueue.startStream();
    this._syncAudioQueueSize();

    // ── Text SSE ──────────────────────────────────────────────────────
    this._startTextStream({ signal, messages: messages ?? [] });

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

    // Discard pending save — aborted streams must not persist (AC3)
    this._pendingSaveOptions = undefined;

    // Abort active expression generation (AC4)
    this._cancelExpressionGeneration();

    // Reset tag buffer state
    this._clearTagBuffer();

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
   * Each text chunk is processed through {@link _processTextChunk} to
   * intercept `<emotion:...>` tags before the clean text reaches
   * {@link currentText}. The Promise from `start()` is intentionally
   * not awaited — it resolves only when the stream ends or is aborted.
   *
   * On natural stream completion (NOT abort), fires the memory hook
   * to persist the completed dialogue turn (AC2).
   */
  private _startTextStream(options: {
    signal: AbortSignal;
    messages: ConversationMessage[];
  }): void {
    const { signal, messages } = options;

    this._textStream
      .start({
        signal,
        messages,
        onChunk: (text: string) => {
          if (signal.aborted) {
            return;
          }
          const { cleanText, emotions } = this._processTextChunk(text);
          if (cleanText.length > 0) {
            this.currentText += cleanText;
          }
          // Fire extracted emotion tags (AC1: invisible to UI/TTS)
          if (emotions.length > 0) {
            const npcId = this.currentSpeakerId;
            if (npcId) {
              for (const emotion of emotions) {
                // External callback (if set)
                if (this._onEmotionExtracted) {
                  this._onEmotionExtracted({ npcId, emotion });
                }
                // Internal hybrid trigger pipeline (AC4)
                this._handleExtractedEmotion({ npcId, emotion });
              }
            }
          }
        },
      })
      .then(() => {
        // SSE stream ended naturally (server closed the connection)
        if (!signal.aborted) {
          // Flush any remaining tag buffer as text before completing
          this._flushTagBuffer();
          this.isGenerating = false;
          this._audioQueue.endStream();

          // ── Memory Hook (AC2): persist completed dialogue turn ──
          void this._saveCompletedTurn();
        }
      })
      .catch(() => {
        // AbortError or network error — silently handled.
        // cancelGeneration / abort path DOES NOT call _saveCompletedTurn (AC3).
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

  /**
   * Persists the completed dialogue turn via the {@link ConversationRepositoryInterface}.
   *
   * Only called when the text stream completes naturally (never on abort).
   * The save payload is staged in {@link _pendingSaveOptions} during
   * `generateDialogue` and consumed here.
   */
  private async _saveCompletedTurn(): Promise<void> {
    const saveOptions = this._pendingSaveOptions;
    this._pendingSaveOptions = undefined;

    if (!saveOptions || !this._conversationRepository) {
      return;
    }

    const npcText = this.currentText;
    if (npcText.length === 0) {
      return;
    }

    try {
      await this._conversationRepository.saveDialogueTurn({
        chatId: saveOptions.chatId,
        npcId: saveOptions.npcId,
        playerMessage: saveOptions.playerMessage,
        npcMessage: { role: 'assistant', content: npcText },
      });
      this.debug('_saveCompletedTurn:saved', {
        chatId: saveOptions.chatId,
        textLength: npcText.length,
      });
    } catch (error) {
      this.error('_saveCompletedTurn:failed', error);
    }
  }

  // -- Tag Buffer (AC1: Stream Interception) -------------------------------

  /**
   * Processes an incoming text chunk through the emotion tag buffer.
   *
   * Extracts complete `<emotion:value>` tags and returns the clean text
   * that should be exposed to the UI. Partial tags (e.g. `<emot`) are
   * held in `_tagBuffer` across chunk boundaries. Invalid tag prefixes
   * (e.g. `5 < 10`) are flushed immediately as regular text.
   *
   * @param chunk - Raw text chunk from the SSE stream.
   * @returns Clean text and any emotion values extracted from complete tags.
   */
  private _processTextChunk(chunk: string): { cleanText: string; emotions: string[] } {
    const emotions: string[] = [];

    // Clear any pending flush timeout — new data arrived
    if (this._tagBufferTimeoutId !== undefined) {
      clearTimeout(this._tagBufferTimeoutId);
      this._tagBufferTimeoutId = undefined;
    }

    // Combine buffer with incoming chunk
    const combined = this._tagBuffer + chunk;

    // Find all complete emotion tags
    const tagRegex = /<emotion:([a-zA-Z0-9_-]+)>/g;

    let lastIndex = 0;
    let cleanText = '';

    let match = tagRegex.exec(combined);
    while (match !== null) {
      // Add text before this match to clean output
      cleanText += combined.slice(lastIndex, match.index);
      emotions.push(match[1]);
      lastIndex = tagRegex.lastIndex;
      match = tagRegex.exec(combined);
    }

    // Check if there's a potential partial tag at the end of the remaining text
    const remaining = combined.slice(lastIndex);
    const partialTagStart = remaining.lastIndexOf('<');

    if (partialTagStart !== -1) {
      const possibleTag = remaining.slice(partialTagStart);
      if (this._isPotentialTagPrefix(possibleTag)) {
        // Hold the potential tag in the buffer for the next chunk
        cleanText += remaining.slice(0, partialTagStart);
        this._tagBuffer = possibleTag;
        // Arm a timeout — if we don't get more chunks soon, flush as text
        this._armTagBufferTimeout();
      } else {
        // The < is not a valid tag start — release everything
        cleanText += remaining;
        this._tagBuffer = '';
      }
    } else {
      cleanText += remaining;
      this._tagBuffer = '';
    }

    return { cleanText, emotions };
  }

  /**
   * Checks whether a string could be the prefix of a valid `<emotion:value>`
   * tag. Used to decide whether to buffer or flush a `<` character.
   *
   * Valid examples: `'<'`, `'<emot'`, `'<emotion:jo'`
   * Invalid examples: `'< '`, `'<x'`, `'<emotion:joy!'`
   */
  private _isPotentialTagPrefix(buffer: string): boolean {
    const TAG_PREFIX = '<emotion:';

    if (buffer.length === 0) {
      return false;
    }

    if (buffer[0] !== '<') {
      return false;
    }

    for (let i = 1; i < buffer.length; i++) {
      if (i < TAG_PREFIX.length) {
        // Must match the literal prefix character-for-character
        if (buffer[i] !== TAG_PREFIX[i]) {
          return false;
        }
      } else {
        // After the prefix — must be valid emotion name chars or closing >
        if (buffer[i] === '>') {
          return i === buffer.length - 1;
        }
        if (!/[a-zA-Z0-9_-]/.test(buffer[i])) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Arms a timeout that flushes the tag buffer if no new chunks arrive
   * within {@link _tagBufferTimeoutMs} milliseconds.
   *
   * Prevents dangling `<` characters (e.g. from math like "5 < 10") from
   * being permanently swallowed when a chunk boundary falls right after `<`.
   */
  private _armTagBufferTimeout(): void {
    this._tagBufferTimeoutId = setTimeout(() => {
      this._flushTagBuffer();
    }, this._tagBufferTimeoutMs);
  }

  /**
   * Flushes the current tag buffer to `currentText` as regular text and
   * clears the pending timeout. Safe to call when the buffer is empty.
   */
  private _flushTagBuffer(): void {
    if (this._tagBufferTimeoutId !== undefined) {
      clearTimeout(this._tagBufferTimeoutId);
      this._tagBufferTimeoutId = undefined;
    }

    if (this._tagBuffer.length > 0) {
      this.currentText += this._tagBuffer;
      this._tagBuffer = '';
    }
  }

  /**
   * Clears the tag buffer and timeout without flushing to currentText.
   * Used on cancel/abort — partial tag text should not be saved.
   */
  private _clearTagBuffer(): void {
    if (this._tagBufferTimeoutId !== undefined) {
      clearTimeout(this._tagBufferTimeoutId);
      this._tagBufferTimeoutId = undefined;
    }
    this._tagBuffer = '';
  }

  // -- Hybrid Trigger Pipeline (AC3, AC4) ---------------------------------

  /**
   * Handles an extracted emotion tag through the hybrid trigger pipeline.
   *
   * 1. Dedup: skip if same emotion as currently active.
   * 2. Fast-path: check {@link _expressionAssetResolver} for static asset.
   *    If found → fetch the image and inject via {@link _textureInjector}.
   * 3. Fallback: if no static asset, cancel any active generation and
   *    dispatch to {@link _expressionGenerator}.
   *
   * @param options.npcId — The NPC identifier.
   * @param options.emotion — The extracted emotion name (e.g. 'joy').
   */
  private _handleExtractedEmotion(options: { npcId: string; emotion: string }): void {
    const { npcId, emotion } = options;

    // Skip if resolver is not configured — only external callback matters
    if (!this._expressionAssetResolver) {
      return;
    }

    // Dedup: skip if same emotion is already active
    if (this._currentEmotion === emotion) {
      return;
    }

    this._currentEmotion = emotion;

    // 1. Check for static asset (fast-path, AC3)
    const staticPath = this._expressionAssetResolver.resolve({ npcId, emotion });

    if (staticPath) {
      this.debug('_handleExtractedEmotion:fast-path', { npcId, emotion, staticPath });
      void this._loadStaticExpression({ path: staticPath });
      return;
    }

    // 2. No static asset — fall back to dynamic generation (AC4)
    if (this._expressionGenerator) {
      this.debug('_handleExtractedEmotion:fallback', { npcId, emotion });
      void this._generateExpression({ npcId, emotion });
    }
  }

  /**
   * Fast-path: loads a static expression image and injects it into the
   * PixiJS scene via {@link _textureInjector}, bypassing ComfyUI entirely.
   */
  private async _loadStaticExpression(options: { path: string }): Promise<void> {
    const { path } = options;
    try {
      const response = await fetch(path);
      if (!response.ok) {
        this.debug('_loadStaticExpression:fetch-failed', {
          path,
          status: response.status,
        });
        return;
      }
      const buffer = await response.arrayBuffer();
      await this._textureInjector.injectTexture({ buffer });
      this.debug('_loadStaticExpression:injected', { path, byteLength: buffer.byteLength });
    } catch (error) {
      this.error('_loadStaticExpression:failed', error);
    }
  }

  /**
   * Fallback: cancels any active expression generation and fires a new
   * request to the {@link _expressionGenerator} (ComfyUI).
   *
   * Uses an internal {@link _expressionAbortController} so that rapid
   * emotion shifts cancel the previous generation before starting the next.
   */
  private async _generateExpression(options: { npcId: string; emotion: string }): Promise<void> {
    const { npcId, emotion } = options;

    // Cancel any active expression generation
    this._cancelExpressionGeneration();

    const abortController = new AbortController();
    this._expressionAbortController = abortController;

    try {
      const generator = this._expressionGenerator;
      if (!generator) {
        return;
      }
      const buffer = await generator({
        npcId,
        emotion,
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) {
        return;
      }
      await this._textureInjector.injectTexture({ buffer });
      this.debug('_generateExpression:injected', { npcId, emotion, byteLength: buffer.byteLength });
    } catch (error) {
      if (!abortController.signal.aborted) {
        this.error('_generateExpression:failed', error);
      }
    } finally {
      if (this._expressionAbortController === abortController) {
        this._expressionAbortController = undefined;
      }
    }
  }

  /**
   * Aborts the currently active expression generation request (AC4).
   *
   * Safe to call when no generation is in progress. Called by
   * {@link cancelGeneration} and before starting a new expression request.
   */
  private _cancelExpressionGeneration(): void {
    const controller = this._expressionAbortController;
    if (controller) {
      controller.abort();
      this._expressionAbortController = undefined;
    }
  }

  override async dispose(): Promise<void> {
    this.cancelGeneration();
    await super.dispose();
  }
}

export const getStreamOrchestrator = (
  options: StreamOrchestratorOptions,
): StreamOrchestratorInterface => new StreamOrchestrator(options);
