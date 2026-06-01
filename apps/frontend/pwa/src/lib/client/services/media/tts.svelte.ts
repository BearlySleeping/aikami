/** biome-ignore-all lint/style/useNamingConvention: TTS service naming convention */
// apps/frontend/pwa/src/lib/client/services/media/tts.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { audioContextManager } from './audio_context_manager';

export type TtsOptions = BaseFrontendClassOptions;

export type TtsResult = {
  audioUrl: string;
  isDemo: boolean;
};

export type TtsServiceInterface = BaseFrontendClassInterface & {
  /** Whether audio is currently playing. */
  readonly is_playing: boolean;

  /** Index of the currently spoken word (-1 when idle). */
  readonly current_word_index: number;

  /** ID of the message whose TTS is currently active (undefined when idle). */
  readonly active_message_id: string | undefined;

  /**
   * Converts text to speech via full-request API.
   * @param options - Configuration object.
   * @param options.text The text to convert to speech.
   * @param options.voiceId Optional voice ID to use.
   * @returns A promise that resolves to the audio URL.
   */
  speak(options: { text: string; voiceId?: string }): Promise<TtsResult>;

  /**
   * Stops any currently playing audio and resets state.
   */
  stop(): void;

  /**
   * Checks if the service is running in demo/emulator mode.
   */
  isDemoMode(): boolean;

  /**
   * Enqueues a raw audio chunk for gapless playback.
   * Use this for SSE-streamed TTS where audio arrives in chunks.
   *
   * @param options.buffer - Raw PCM/WAV ArrayBuffer.
   * @param options.words - Words corresponding to this audio chunk (for word-level highlighting).
   */
  enqueueChunk(options: { buffer: ArrayBuffer; words?: string[] }): Promise<void>;

  /**
   * Begins streaming playback for a given message. Sets the active message ID
   * and resets the scheduling clock. Must be called before {@link enqueueChunk}.
   *
   * @param options.messageId - The chat message ID.
   * @param options.text - Full message text (for word-count tracking).
   */
  startStream(options: { messageId: string; text: string }): void;

  /** Marks the streaming session as complete (flushes final chunk). */
  endStream(): void;
};

type WordBoundary = {
  startTime: number;
  endTime: number;
};

class TtsService extends BaseFrontendClass<TtsOptions> implements TtsServiceInterface {
  is_playing = $state(false);
  current_word_index = $state(-1);
  active_message_id = $state<string | undefined>(undefined);

  private isDemo = true;
  private currentAudio: HTMLAudioElement | null = null;

  // --- Streaming state ---
  private nextStartTime = 0;
  private wordBoundaries: WordBoundary[] = [];
  private sourceNodes: AudioBufferSourceNode[] = [];
  private rafId: ReturnType<typeof requestAnimationFrame> | undefined;

  isDemoMode(): boolean {
    return this.isDemo;
  }

  async speak(options: { text: string; voiceId?: string }): Promise<TtsResult> {
    this.debug('speak', options);
    const { text, voiceId } = options;

    this.stop();

    if (this.isDemo) {
      this.debug('speak: demo mode - returning mock audio');
      return {
        audioUrl: `https://placehold.co/1x1.mp3?text=${encodeURIComponent(text.slice(0, 20))}`,
        isDemo: true,
      };
    }

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId }),
      });

      if (!response.ok) {
        throw new Error(`TTS failed: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        audioUrl: data.audioUrl,
        isDemo: false,
      };
    } catch (error) {
      this.error('speak failed', error);
      throw error;
    }
  }

  stop(): void {
    this.debug('stop');

    // Stop legacy HTMLAudioElement playback
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    // Stop all scheduled source nodes
    for (const node of this.sourceNodes) {
      try {
        node.stop();
      } catch {
        // Already stopped — ignore
      }
    }
    this.sourceNodes = [];

    // Cancel rAF loop
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }

    this.is_playing = false;
    this.current_word_index = -1;
    this.active_message_id = undefined;
    this.nextStartTime = 0;
    this.wordBoundaries = [];
    this.streamMessageId = undefined;
  }

  startStream(options: { messageId: string; text: string }): void {
    this.debug('startStream', { messageId: options.messageId, textLength: options.text.length });

    this.stop();

    this.streamMessageId = options.messageId;
    this.active_message_id = options.messageId;

    // Split text into words for proportional timing
    const words = options.text.split(/\s+/).filter(Boolean);
    this.wordBoundaries = new Array(words.length);

    // Pre-compute boundary slots — actual times filled as chunks arrive
    for (let i = 0; i < words.length; i++) {
      this.wordBoundaries[i] = { startTime: 0, endTime: 0 };
    }

    audioContextManager.unlock();
    this.nextStartTime = audioContextManager.context.currentTime;

    this.is_playing = true;

    // Start the rAF word-tracking loop
    this.startWordTrackingLoop();
  }

  async enqueueChunk(options: { buffer: ArrayBuffer; words?: string[] }): Promise<void> {
    const { buffer, words } = options;

    this.debug('enqueueChunk', { byteLength: buffer.byteLength, wordCount: words?.length ?? 0 });

    const ctx = audioContextManager.context;

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
    } catch (error) {
      this.error('decodeAudioData failed — chunk may be truncated', error);
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    // Schedule gapless playback
    const scheduleTime = Math.max(ctx.currentTime, this.nextStartTime);
    source.start(scheduleTime);

    // Track source for cleanup
    this.sourceNodes.push(source);

    source.onended = () => {
      const idx = this.sourceNodes.indexOf(source);
      if (idx !== -1) {
        this.sourceNodes.splice(idx, 1);
      }
    };

    // Update word boundaries for proportional tracking
    const chunkDuration = audioBuffer.duration;
    if (words && words.length > 0) {
      // Find the next unfilled boundary slot and fill it
      const chunkStartTime = scheduleTime;
      const perWordDuration = chunkDuration / words.length;

      let boundaryIdx = 0;
      for (let i = 0; i < this.wordBoundaries.length; i++) {
        if (this.wordBoundaries[i].endTime <= 0) {
          boundaryIdx = i;
          break;
        }
      }

      for (let w = 0; w < words.length && boundaryIdx + w < this.wordBoundaries.length; w++) {
        this.wordBoundaries[boundaryIdx + w] = {
          startTime: chunkStartTime + w * perWordDuration,
          endTime: chunkStartTime + (w + 1) * perWordDuration,
        };
      }
    }

    // Advance the scheduling clock
    this.nextStartTime = scheduleTime + chunkDuration;
  }

  endStream(): void {
    this.debug('endStream');
    // rAF loop will naturally detect when all audio is done and reset state
  }

  // ── Private ──

  private startWordTrackingLoop(): void {
    const ctx = audioContextManager.context;

    const tick = () => {
      const now = ctx.currentTime;

      // Find current word via binary search over boundaries
      let wordIdx = this.findWordIndex(now);

      // If we're past the last word, check if sources are all done
      if (wordIdx >= this.wordBoundaries.length && this.sourceNodes.length === 0) {
        this.is_playing = false;
        this.current_word_index = -1;
        this.active_message_id = undefined;
        this.nextStartTime = 0;
        this.wordBoundaries = [];
        this.streamMessageId = undefined;
        this.rafId = undefined;
        return;
      }

      if (wordIdx >= this.wordBoundaries.length) {
        wordIdx = this.wordBoundaries.length - 1;
      }

      this.current_word_index = wordIdx;
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private findWordIndex(currentTime: number): number {
    // Binary search for the word whose time window contains currentTime
    let lo = 0;
    let hi = this.wordBoundaries.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const b = this.wordBoundaries[mid];

      if (b.startTime <= 0) {
        // Not yet filled — return previous word
        hi = mid - 1;
        continue;
      }

      if (currentTime >= b.startTime && currentTime < b.endTime) {
        return mid;
      }
      if (currentTime < b.startTime) {
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    return lo;
  }
}

export const ttsService: TtsServiceInterface = new TtsService({
  className: 'TtsService',
});
