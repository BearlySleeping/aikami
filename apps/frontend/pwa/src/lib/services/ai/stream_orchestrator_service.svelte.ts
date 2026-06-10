// apps/frontend/pwa/src/lib/services/ai/stream_orchestrator_service.svelte.ts
import { BaseClass, type BaseClassInterface, type BaseClassOptions } from '@aikami/utils';
import type { AudioQueuePlayerInterface } from '../audio/audio_queue_player';
import type { ConversationMessage } from '../chat/context_builder.ts';
import type { ConversationRepositoryInterface } from '../chat/conversation_repository.svelte.ts';
import type { ExpressionAssetResolverInterface } from '../expression/expression_asset_resolver';
import type { PixiTextureInjectorInterface } from '../game/pixi_texture_injector';
import { SentenceBoundaryChunker } from './sentence_boundary_chunker.ts';

// ---------------------------------------------------------------------------
// Network Connection Interfaces
// ---------------------------------------------------------------------------

/** SSE-based text stream connection. */
export type TextStreamConnection = {
  start(options: {
    signal: AbortSignal;
    onChunk: (text: string) => void;
    messages: ConversationMessage[];
  }): Promise<void>;
};

/** WebSocket-based image generation stream connection. */
export type ImageStreamConnection = {
  connect(options: { signal: AbortSignal; onComplete: (buffer: ArrayBuffer) => void }): void;
  close(): void;
};

// ---------------------------------------------------------------------------
// Kokoro TTS Configuration
// ---------------------------------------------------------------------------

/** Payload shape for POST /v1/audio/speech (OpenAI-compatible). */
type KokoroRequest = {
  model: string;
  input: string;
  voice: string;
  response_format: 'wav';
};

/** Endpoint for the headless Kokoro container. */
const KOKORO_SPEECH_URL = `${import.meta.env.PUBLIC_VOICE_URL ?? 'http://localhost:8089'}/v1/audio/speech`;

// ---------------------------------------------------------------------------
// StreamOrchestrator
// ---------------------------------------------------------------------------

export type StreamOrchestratorOptions = BaseClassOptions & {
  textStream: TextStreamConnection;
  imageStream: ImageStreamConnection;
  audioQueuePlayer: AudioQueuePlayerInterface;
  textureInjector: PixiTextureInjectorInterface;
  conversationRepository?: ConversationRepositoryInterface;
  onEmotionExtracted?: (options: { npcId: string; emotion: string }) => void;
  tagBufferTimeoutMs?: number;
  expressionAssetResolver?: ExpressionAssetResolverInterface;
  expressionGenerator?: (options: {
    npcId: string;
    emotion: string;
    signal: AbortSignal;
  }) => Promise<ArrayBuffer>;
};

export type StreamOrchestratorInterface = BaseClassInterface & {
  readonly isGenerating: boolean;
  readonly currentText: string;
  readonly currentSpeakerId: string | undefined;
  readonly currentAudioQueueSize: number;

  generateDialogue(options: {
    prompt: string;
    npcId: string;
    personaId: string;
    messages?: ConversationMessage[];
    chatId?: string;
  }): Promise<void>;

  cancelGeneration(): void;
};

/**
 * Master controller for synchronized AI generation streams.
 *
 * Coordinates SSE text + ComfyUI image streams through a single
 * {@link AbortController}. Text is chunked into sentences via
 * {@link SentenceBoundaryChunker} and dispatched as HTTP POST requests
 * to the headless Kokoro TTS container. Audio is played sequentially
 * through the {@link AudioQueuePlayer}.
 */
export class StreamOrchestrator
  extends BaseClass<StreamOrchestratorOptions>
  implements StreamOrchestratorInterface
{
  isGenerating = false;
  currentText = '';
  currentSpeakerId: string | undefined = undefined;
  currentAudioQueueSize = 0;

  private readonly _textStream: TextStreamConnection;
  private readonly _imageStream: ImageStreamConnection;
  private readonly _audioQueue: AudioQueuePlayerInterface;
  private readonly _textureInjector: PixiTextureInjectorInterface;
  private readonly _conversationRepository: ConversationRepositoryInterface | undefined;
  private readonly _chunker: SentenceBoundaryChunker;

  private _abortController: AbortController | undefined;
  private _pendingSaveOptions:
    | { chatId: string; npcId: string; playerMessage: ConversationMessage }
    | undefined;

  // ── Tag Buffer ──────────────────────────────────────────────
  private _tagBuffer = '';
  private _tagBufferTimeoutId: ReturnType<typeof setTimeout> | undefined;
  private readonly _tagBufferTimeoutMs: number;
  private readonly _onEmotionExtracted:
    | ((options: { npcId: string; emotion: string }) => void)
    | undefined;

  // ── Hybrid Trigger Pipeline ─────────────────────────────────
  private readonly _expressionAssetResolver: ExpressionAssetResolverInterface | undefined;
  private readonly _expressionGenerator:
    | ((options: { npcId: string; emotion: string; signal: AbortSignal }) => Promise<ArrayBuffer>)
    | undefined;
  private _currentEmotion: string | null = null;
  private _expressionAbortController: AbortController | undefined;

  // ── Sentence ordering ───────────────────────────────────────
  private _sentenceIndex = 0;

  constructor(options: StreamOrchestratorOptions) {
    super(options);
    this._textStream = options.textStream;
    this._imageStream = options.imageStream;
    this._audioQueue = options.audioQueuePlayer;
    this._textureInjector = options.textureInjector;
    this._conversationRepository = options.conversationRepository;
    this._onEmotionExtracted = options.onEmotionExtracted;
    this._tagBufferTimeoutMs = options.tagBufferTimeoutMs ?? 500;
    this._expressionAssetResolver = options.expressionAssetResolver;
    this._expressionGenerator = options.expressionGenerator;
    this._chunker = new SentenceBoundaryChunker();
  }

  // -- Public API ----------------------------------------------------------

  async generateDialogue(options: {
    prompt: string;
    npcId: string;
    personaId: string;
    messages?: ConversationMessage[];
    chatId?: string;
  }): Promise<void> {
    const { chatId, messages, npcId, prompt } = options;

    this.cancelGeneration();

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    this.isGenerating = true;
    this.currentText = '';
    this.currentSpeakerId = npcId;
    this.currentAudioQueueSize = 0;
    this._currentEmotion = null;
    this._sentenceIndex = 0;

    this._pendingSaveOptions =
      chatId && this._conversationRepository
        ? { chatId, npcId, playerMessage: { role: 'user', content: prompt } }
        : undefined;

    // Wire up the sentence chunker for this generation
    this._chunker.reset();
    this._chunker.onSentence(({ sentence }) => {
      if (signal.aborted) {
        return;
      }
      this._dispatchToKokoro(sentence, this._sentenceIndex++, signal);
    });

    // Start audio queue for the new stream
    this._audioQueue.startStream();
    this._syncAudioQueueSize();

    // ── Text SSE ───────────────────────────────────────────────
    this._startTextStream({ signal, messages: messages ?? [] });

    // ── Image WS ───────────────────────────────────────────────
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
    const controller = this._abortController;
    if (controller) {
      controller.abort();
      this._imageStream.close();
      this._abortController = undefined;
    }

    this._audioQueue.stop();
    this._textureInjector.clearTexture();
    this._pendingSaveOptions = undefined;
    this._cancelExpressionGeneration();
    this._clearTagBuffer();
    this._chunker.reset();

    this.isGenerating = false;
    this.currentText = '';
    this.currentSpeakerId = undefined;
    this.currentAudioQueueSize = 0;
  }

  // -- Private: Text Stream ------------------------------------------------

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
            // Feed clean text to the sentence chunker for TTS dispatch
            this._chunker.feed(cleanText);
          }

          if (emotions.length > 0) {
            const npcId = this.currentSpeakerId;
            if (npcId) {
              for (const emotion of emotions) {
                if (this._onEmotionExtracted) {
                  this._onEmotionExtracted({ npcId, emotion });
                }
                this._handleExtractedEmotion({ npcId, emotion });
              }
            }
          }
        },
      })
      .then(() => {
        if (!signal.aborted) {
          this._flushTagBuffer();
          // Flush remaining chunker buffer
          this._chunker.close();
          this.isGenerating = false;
          this._audioQueue.endStream();
          void this._saveCompletedTurn();
        }
      })
      .catch(() => {
        if (!signal.aborted) {
          this.isGenerating = false;
          this._audioQueue.stop();
        }
      });
  }

  // -- Private: Kokoro TTS HTTP dispatch -----------------------------------

  /**
   * POSTs a completed sentence to the Kokoro TTS container and enqueues
   * the returned WAV buffer for sequential gapless playback.
   */
  private async _dispatchToKokoro(
    sentence: string,
    sentenceIndex: number,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const payload: KokoroRequest = {
        model: 'tts-1',
        input: sentence,
        voice: 'af_bella',
        response_format: 'wav',
      };

      this.debug('_dispatchToKokoro', { sentenceIndex, sentenceLength: sentence.length });

      const response = await fetch(KOKORO_SPEECH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        this.error('Kokoro returned non-200', {
          status: response.status,
          sentenceIndex,
        });
        return;
      }

      const buffer = await response.arrayBuffer();
      if (signal.aborted) {
        return;
      }

      await this._audioQueue.enqueueChunk({ buffer, sentenceIndex });
      this._syncAudioQueueSize();
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      this.error('_dispatchToKokoro failed', error);
    }
  }

  // -- Private: Audio Queue Size Sync --------------------------------------

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

  // -- Private: Dialogue Persistence ---------------------------------------

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

  // -- Private: Emotion Tag Interception -----------------------------------

  private _processTextChunk(chunk: string): { cleanText: string; emotions: string[] } {
    const emotions: string[] = [];

    if (this._tagBufferTimeoutId !== undefined) {
      clearTimeout(this._tagBufferTimeoutId);
      this._tagBufferTimeoutId = undefined;
    }

    const combined = this._tagBuffer + chunk;
    const tagRegex = /<emotion:([a-zA-Z0-9_-]+)>/g;

    let lastIndex = 0;
    let cleanText = '';

    let match = tagRegex.exec(combined);
    while (match !== null) {
      cleanText += combined.slice(lastIndex, match.index);
      emotions.push(match[1]);
      lastIndex = tagRegex.lastIndex;
      match = tagRegex.exec(combined);
    }

    const remaining = combined.slice(lastIndex);
    const partialTagStart = remaining.lastIndexOf('<');

    if (partialTagStart !== -1) {
      const possibleTag = remaining.slice(partialTagStart);
      if (this._isPotentialTagPrefix(possibleTag)) {
        cleanText += remaining.slice(0, partialTagStart);
        this._tagBuffer = possibleTag;
        this._armTagBufferTimeout();
      } else {
        cleanText += remaining;
        this._tagBuffer = '';
      }
    } else {
      cleanText += remaining;
      this._tagBuffer = '';
    }

    return { cleanText, emotions };
  }

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
        if (buffer[i] !== TAG_PREFIX[i]) {
          return false;
        }
      } else {
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

  private _armTagBufferTimeout(): void {
    this._tagBufferTimeoutId = setTimeout(() => {
      this._flushTagBuffer();
    }, this._tagBufferTimeoutMs);
  }

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

  private _clearTagBuffer(): void {
    if (this._tagBufferTimeoutId !== undefined) {
      clearTimeout(this._tagBufferTimeoutId);
      this._tagBufferTimeoutId = undefined;
    }
    this._tagBuffer = '';
  }

  // -- Private: Expression Pipeline ----------------------------------------

  private _handleExtractedEmotion(options: { npcId: string; emotion: string }): void {
    const { npcId, emotion } = options;
    if (!this._expressionAssetResolver) {
      return;
    }
    if (this._currentEmotion === emotion) {
      return;
    }
    this._currentEmotion = emotion;

    const staticPath = this._expressionAssetResolver.resolve({ npcId, emotion });
    if (staticPath) {
      this.debug('_handleExtractedEmotion:fast-path', { npcId, emotion, staticPath });
      void this._loadStaticExpression({ path: staticPath });
      return;
    }

    if (this._expressionGenerator) {
      this.debug('_handleExtractedEmotion:fallback', { npcId, emotion });
      void this._generateExpression({ npcId, emotion });
    }
  }

  private async _loadStaticExpression(options: { path: string }): Promise<void> {
    const { path } = options;
    try {
      const response = await fetch(path);
      if (!response.ok) {
        this.debug('_loadStaticExpression:fetch-failed', { path, status: response.status });
        return;
      }
      const buffer = await response.arrayBuffer();
      await this._textureInjector.injectTexture({ buffer });
    } catch (error) {
      this.error('_loadStaticExpression:failed', error);
    }
  }

  private async _generateExpression(options: { npcId: string; emotion: string }): Promise<void> {
    const { npcId, emotion } = options;
    this._cancelExpressionGeneration();

    const abortController = new AbortController();
    this._expressionAbortController = abortController;

    try {
      const generator = this._expressionGenerator;
      if (!generator) {
        return;
      }
      const buffer = await generator({ npcId, emotion, signal: abortController.signal });
      if (abortController.signal.aborted) {
        return;
      }
      await this._textureInjector.injectTexture({ buffer });
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
