// apps/frontend/client/src/lib/services/audio/tts_service.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { audioContextManager } from './audio_context_manager';

/** Voice descriptor returned by GET /v1/voices. */
export type VoiceInfo = {
  readonly id: string;
  readonly description: string;
};

/** Lifecycle status of the native Kokoro WebGPU TTS engine. */
export type TtsStatus = 'uninitialized' | 'initializing' | 'ready' | 'error';

export type TtsOptions = BaseFrontendClassOptions;

export type TtsServiceInterface = BaseFrontendClassInterface & {
  /** Lifecycle status of the native Kokoro WebGPU engine. */
  readonly status: TtsStatus;

  /** Error message when status is 'error'. */
  readonly errorMessage: string | null;

  /** Whether audio is currently playing. */
  readonly isPlaying: boolean;

  /** Whether a speech synthesis request is in progress. */
  readonly isSynthesizing: boolean;

  /** Index of the currently spoken word (-1 when idle). */
  readonly currentWordIndex: number;

  /** ID of the message whose TTS is currently active (undefined when idle). */
  readonly activeMessageId: string | undefined;

  /** Available Kokoro voice presets. */
  readonly voices: readonly VoiceInfo[];

  /** The currently selected voice ID. */
  selectedVoice: string;

  /** Whether a running Kokoro REST API server was detected (faster than WebGPU). */
  readonly isKokoroServerAvailable: boolean;

  /** Fetches the list of available voices from the Kokoro REST API. */
  loadVoices(): Promise<void>;

  /**
   * Checks whether a Kokoro REST API server is reachable at localhost:8880.
   * If found, future {@link synthesize} calls will use the REST API
   * instead of the WebGPU worker (faster + higher quality).
   */
  checkKokoroServer(): Promise<void>;

  /**
   * Converts text to speech and plays the resulting audio immediately.
   * Fetches from the Kokoro REST endpoint and pipes the WAV response
   * through the audio streaming pipeline.
   *
   * @param options.text The text to convert to speech.
   * @param options.voiceId Optional voice ID to use (defaults to {@link selectedVoice}).
   */
  speak(options: { text: string; voiceId?: string }): Promise<void>;

  /**
   * Stops any currently playing audio, aborts the in-progress synthesis
   * request, and resets state.
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

  /**
   * Initializes the native Kokoro TTS Web Worker.
   * Spawns a dedicated worker that loads the 82M Kokoro model via WebGPU.
   * Must be called before {@link synthesize}.
   */
  initialize(): Promise<void>;

  /**
   * Synthesizes text to speech using the native Kokoro WebGPU engine.
   * Posts a synthesize message to the worker and awaits the PCM result.
   *
   * @param options.text The text to synthesize.
   * @param options.voice The Kokoro voice key (e.g., 'af_bella').
   */
  synthesize(options: { text: string; voice: string }): Promise<void>;

  /**
   * Converts raw PCM Float32Array data into an AudioBuffer and schedules
   * gapless playback through the Web Audio API.
   *
   * @param options.pcmData Raw PCM audio samples.
   * @param options.sampleRate Sample rate in Hz (e.g., 24000).
   */
  playAudioBuffer(options: { pcmData: Float32Array; sampleRate: number }): Promise<void>;
};

type WordBoundary = {
  startTime: number;
  endTime: number;
};

class TtsService extends BaseFrontendClass<TtsOptions> implements TtsServiceInterface {
  status: TtsStatus = $state('uninitialized');
  errorMessage: string | null = $state(null);
  isPlaying = $state(false);
  isSynthesizing = $state(false);
  currentWordIndex = $state(-1);
  activeMessageId = $state<string | undefined>(undefined);
  voices: VoiceInfo[] = $state([]);
  selectedVoice = $state('af_heart');

  private _worker: Worker | null = null;
  private _abortController: AbortController | undefined;
  private currentAudio: HTMLAudioElement | null = null;

  // --- Streaming state ---
  private _streamEnded = false;
  private nextStartTime = 0;
  private wordBoundaries: WordBoundary[] = [];
  private sourceNodes: AudioBufferSourceNode[] = [];
  private rafId: ReturnType<typeof requestAnimationFrame> | undefined;

  /** Whether a running Kokoro REST API server was detected on localhost:8880. */
  isKokoroServerAvailable = $state(false);

  /** Kokoro REST API base URL (detected from docker/local server). */
  private _kokoroServerUrl = '';

  isDemoMode(): boolean {
    return false;
  }

  async loadVoices(): Promise<void> {
    try {
      const response = await fetch('/api/voice/v1/voices');
      if (!response.ok) {
        this.error('loadVoices:fetch-failed', { status: response.status });
        return;
      }

      const data = (await response.json()) as { voices?: VoiceInfo[] };
      if (data.voices && data.voices.length > 0) {
        this.voices = data.voices;
        this.debug('loadVoices', { count: this.voices.length });
      }
    } catch (error) {
      this.error('loadVoices:failed', error);
    }
  }

  async speak(options: { text: string; voiceId?: string }): Promise<void> {
    const { text, voiceId } = options;

    if (!text.trim()) {
      return;
    }

    // Cancel any in-progress request
    this.stop();

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    this.isSynthesizing = true;

    try {
      const speechUrl = '/api/voice/v1/audio/speech';

      const response = await fetch(speechUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: voiceId ?? this.selectedVoice,
          response_format: 'wav',
        }),
        signal,
      });

      if (!response.ok) {
        this.error('speak:fetch-failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return;
      }

      const buffer = await response.arrayBuffer();
      if (signal.aborted) {
        return;
      }

      // Play the WAV audio through the streaming pipeline.
      // Pass words so the rAF tracking loop can detect when playback ends.
      const words = text.split(/\s+/).filter(Boolean);
      this.startStream({ messageId: `tts_${Date.now()}`, text });
      await this.enqueueChunk({ buffer, words });
      this.endStream();
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      this.error('speak:failed', error);
    } finally {
      this.isSynthesizing = false;
      this._abortController = undefined;
    }
  }

  stop(): void {
    // Abort in-progress synthesis fetch
    const controller = this._abortController;
    if (controller) {
      controller.abort();
      this._abortController = undefined;
    }

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

    this.isPlaying = false;
    this.isSynthesizing = false;
    this.currentWordIndex = -1;
    this.activeMessageId = undefined;
    this.nextStartTime = 0;
    this.wordBoundaries = [];
    this._streamEnded = false;
  }

  startStream(options: { messageId: string; text: string }): void {
    this.stop();

    this.activeMessageId = options.messageId;

    // Split text into words for proportional timing
    const words = options.text.split(/\s+/).filter(Boolean);
    this.wordBoundaries = new Array(words.length);

    // Pre-compute boundary slots — actual times filled as chunks arrive
    for (let i = 0; i < words.length; i++) {
      this.wordBoundaries[i] = { startTime: 0, endTime: 0 };
    }

    audioContextManager.unlock();
    this.nextStartTime = audioContextManager.context.currentTime;

    this.isPlaying = true;

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
    this._streamEnded = true;
  }

  // ── Kokoro WebGPU TTS ──

  async initialize(): Promise<void> {
    if (this.status !== 'uninitialized') {
      this.debug('initialize:skipped', { status: this.status });
      return;
    }

    // ── Step 1: Check for a running Kokoro REST API server ──
    // If a Docker container or local binary is running on port 8880,
    // we use the REST API (faster, higher quality) and skip WebGPU.
    await this.checkKokoroServer();

    if (this.isKokoroServerAvailable) {
      this.status = 'ready';
      this.debug('initialize:using-kokoro-server', { url: this._kokoroServerUrl });
      return;
    }

    // ── Step 2: Fall back to browser-native WebGPU worker ──
    this.status = 'initializing';
    this.errorMessage = null;

    try {
      this._worker = new Worker(new URL('./kokoro_worker.ts', import.meta.url), {
        type: 'module',
      });

      this._worker.onmessage = (event: MessageEvent) => {
        const payload = event.data as {
          type: 'ready' | 'complete' | 'error';
          pcmData?: Float32Array;
          sampleRate?: number;
          message?: string;
        };

        switch (payload.type) {
          case 'ready':
            this.status = 'ready';
            this.debug('initialize:ready');
            break;

          case 'complete':
            if (payload.pcmData && payload.sampleRate !== undefined) {
              this.debug('kokoro:complete', {
                pcmLength: payload.pcmData.length,
                sampleRate: payload.sampleRate,
                durationSec: (payload.pcmData.length / payload.sampleRate).toFixed(2),
              });
              // Single-shot playback — reset scheduling clock so audio
              // starts immediately rather than waiting for stale stream timing.
              audioContextManager.unlock();
              this.nextStartTime = 0;
              this.playAudioBuffer({
                pcmData: payload.pcmData,
                sampleRate: payload.sampleRate,
              });
            }
            break;

          case 'error':
            this.error('kokoro:worker-error', { message: payload.message });
            break;

          default:
            break;
        }
      };

      this._worker.onerror = (error: ErrorEvent) => {
        this.status = 'error';
        this.errorMessage = error.message || 'Unknown worker error';
        this.error('kokoro:worker-onerror', { message: this.errorMessage });
      };

      this._worker.postMessage({ action: 'initialize' });
    } catch (error: unknown) {
      this.status = 'error';
      this.errorMessage = error instanceof Error ? error.message : 'Failed to spawn Kokoro worker';
      this.error('initialize:failed', error);
    }
  }

  async synthesize(options: { text: string; voice: string }): Promise<void> {
    const { text, voice } = options;

    if (!text.trim()) {
      return;
    }

    // ── Path 1: Kokoro REST API (Docker / local server on port 8880) ──
    if (this.isKokoroServerAvailable && this._kokoroServerUrl) {
      await this._synthesizeViaRestApi({ text, voice });
      return;
    }

    // ── Path 2: WebGPU worker (browser-native) ──
    if (!this._worker || this.status !== 'ready') {
      this.debug('synthesize:not-ready', {
        status: this.status,
        hasWorker: !!this._worker,
        hasKokoroServer: this.isKokoroServerAvailable,
      });
      return;
    }

    this._worker.postMessage({ action: 'synthesize', text, voice });
  }

  /**
   * Synthesizes text via the Kokoro REST API (Docker container on port 8880).
   * Returns a WAV blob which is decoded and played through the Web Audio API.
   */
  private async _synthesizeViaRestApi(options: { text: string; voice: string }): Promise<void> {
    const { text, voice } = options;

    try {
      const response = await fetch(`${this._kokoroServerUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'kokoro',
          input: text,
          voice,
          response_format: 'wav',
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        this.error('_synthesizeViaRestApi:fetch-failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return;
      }

      const arrayBuffer = await response.arrayBuffer();

      audioContextManager.unlock();
      const ctx = audioContextManager.context;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start();

      this.debug('_synthesizeViaRestApi:playing', {
        durationSec: audioBuffer.duration.toFixed(2),
        sampleRate: audioBuffer.sampleRate,
      });
    } catch (error) {
      this.error('_synthesizeViaRestApi:failed', error);
    }
  }

  /** @inheritdoc */
  async checkKokoroServer(): Promise<void> {
    const urls = ['http://localhost:8880', 'http://127.0.0.1:8880'];

    for (const url of urls) {
      try {
        const response = await fetch(`${url}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'kokoro',
            input: 'test',
            voice: 'af_heart',
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok || response.status === 422) {
          // 422 = validation error (empty text "test" may be too short),
          // but this still proves the server is running.
          this._kokoroServerUrl = url;
          this.isKokoroServerAvailable = true;
          this.debug('checkKokoroServer:found', { url });
          return;
        }
      } catch {
        // Server not reachable at this URL — try next
      }
    }

    this.isKokoroServerAvailable = false;
    this.debug('checkKokoroServer:not-found');
  }

  async playAudioBuffer(options: { pcmData: Float32Array; sampleRate: number }): Promise<void> {
    const { pcmData, sampleRate } = options;

    audioContextManager.unlock();
    const ctx = audioContextManager.context;

    const audioBuffer = ctx.createBuffer(1, pcmData.length, sampleRate);
    audioBuffer.getChannelData(0).set(pcmData);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    // Schedule gapless playback
    const scheduleTime = Math.max(ctx.currentTime, this.nextStartTime);
    source.start(scheduleTime);

    // Update scheduling clock
    this.nextStartTime = scheduleTime + audioBuffer.duration;

    // Track source for cleanup
    this.sourceNodes.push(source);

    source.onended = () => {
      const idx = this.sourceNodes.indexOf(source);
      if (idx !== -1) {
        this.sourceNodes.splice(idx, 1);
      }
    };
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
        this._cleanupStream();
        return;
      }

      // Fallback: if the stream has explicitly ended and all audio nodes
      // are consumed, clean up regardless of word boundary tracking state.
      if (this._streamEnded && this.sourceNodes.length === 0) {
        this._cleanupStream();
        return;
      }

      if (wordIdx >= this.wordBoundaries.length) {
        wordIdx = this.wordBoundaries.length - 1;
      }

      this.currentWordIndex = wordIdx;
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  /**
   * Shared stream cleanup — resets all streaming state and stops the rAF
   * loop. Called both when word tracking detects completion and as a
   * fallback when {@link endStream} has been called and all audio nodes
   * have finished.
   */
  private _cleanupStream(): void {
    this.isPlaying = false;
    this.currentWordIndex = -1;
    this.activeMessageId = undefined;
    this.nextStartTime = 0;
    this.wordBoundaries = [];
    this._streamEnded = false;
    this.rafId = undefined;
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

export const ttsService: TtsServiceInterface = TtsService.create({
  className: 'TtsService',
});
