// apps/frontend/client/src/lib/services/audio/tts_service.svelte.ts
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { TtsBackend, VoiceInfo } from '$types';
import { runtimeConfigService } from '../config/runtime_config_service.svelte.ts';
import { audioContextManager } from './audio_context_manager';
import { voiceModelService } from './voice_model_service.svelte.ts';

/** Lifecycle status of the native Kokoro TTS engine. */
export type TtsStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'not-downloaded'
  | 'disabled';

export type TtsOptions = BaseFrontendClassOptions;

export type TtsServiceInterface = BaseFrontendClassInterface & {
  /** Lifecycle status of the native Kokoro WebGPU engine. */
  readonly status: TtsStatus;

  /** Which synthesis backend is active (C-389 AC-6). */
  readonly backend: TtsBackend;

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
   * Checks whether a server-mode TTS endpoint is reachable at the
   * runtime-configured URL (C-389 AC-7/AC-8). Never probes localhost
   * blindly — when no `voice.tts.url` is configured this is a no-op.
   */
  checkKokoroServer(): Promise<void>;

  /**
   * Converts text to speech and plays the resulting audio immediately.
   * Fetches the full WAV from the Kokoro REST endpoint and schedules
   * gapless playback through the Web Audio API.
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
   * Synthesizes text to speech.
   *
   * Routes to the Kokoro REST server (docker/local dev, detected by
   * {@link checkKokoroServer}) or the WebGPU worker (browser-native
   * fallback, kokoro-js offline synthesis).
   *
   * @param options.text — The text to synthesize.
   * @param options.voice — The Kokoro voice key (e.g., 'af_bella').
   */
  synthesize(options: { text: string; voice: string }): Promise<void>;

  /**
   * Updates the spatial position of the active TTS stream.
   *
   * Reserved for spatial audio. The previous PannerNode-based
   * implementation was tied to the removed SharedArrayBuffer streaming
   * pipeline; playback now goes straight to the destination, so this is
   * a no-op.
   *
   * @param options.x — World-space X coordinate.
   * @param options.y — World-space Y coordinate.
   */
  updateSpatialPosition(options: { x: number; y: number }): void;

  /**
   * Converts raw PCM Float32Array data into an AudioBuffer and schedules
   * gapless playback through the Web Audio API.
   *
   * Used by the WebGPU worker path (kokoro-js offline synthesis).
   *
   * @param options.pcmData — Raw PCM audio samples.
   * @param options.sampleRate — Sample rate in Hz (e.g., 24000).
   */
  playAudioBuffer(options: { pcmData: Float32Array; sampleRate: number }): Promise<void>;
};

type WordBoundary = {
  startTime: number;
  endTime: number;
};

// ---------------------------------------------------------------------------
// TtsService
//
// Text-to-speech with two backends — neither requires SharedArrayBuffer:
//   A) Kokoro REST server (docker / local dev, detected via
//      checkKokoroServer) — fetches the full WAV from the server and plays
//      it through the Web Audio API.
//   B) WebGPU worker (kokoro-js offline synthesis) — C-131 fallback
//      Web Worker → PCM Float32Array → AudioBuffer → destination
//
// The former SharedArrayBuffer streaming pipeline (C-211: Web Worker →
// wait-free ring buffer → AudioWorkletProcessor) was removed: it required
// cross-origin isolation (COOP: same-origin + COEP: require-corp), which
// breaks Firebase Auth popup sign-in and is unavailable in webviews. See
// docs/gotchas/cross-origin-isolation.md.
//
//   1. initialize() → checkKokoroServer()
//      ├─ Found: status = 'ready'; synthesize() fetches audio from the server
//      └─ Not found: spawns kokoro_worker.ts (WebGPU)
//
//   2. synthesize() / speak()
//      ├─ Server: POST /v1/audio/speech → full WAV → decode → play
//      └─ WebGPU: postMessage to worker → PCM → playAudioBuffer
//
// Contract: C-131, C-148
// ---------------------------------------------------------------------------

class TtsService extends BaseFrontendClass<TtsOptions> implements TtsServiceInterface {
  status: TtsStatus = $state('uninitialized');
  errorMessage: string | null = $state(null);
  backend: TtsBackend = $state('unavailable');
  isPlaying = $state(false);
  isSynthesizing = $state(false);
  currentWordIndex = $state(-1);
  activeMessageId = $state<string | undefined>(undefined);
  voices: VoiceInfo[] = $state([]);
  selectedVoice = $state('af_heart');

  private _worker: Worker | null = null; // kokoro-js worker (browser TTS)
  private _kokoroServerUrl: string | undefined; // server-mode TTS URL (C-389)
  private _abortController: AbortController | undefined;
  private currentAudio: HTMLAudioElement | null = null;

  // --- Playback state (gapless scheduling, word tracking) ---
  private _streamEnded = false;
  private nextStartTime = 0;
  private wordBoundaries: WordBoundary[] = [];
  private sourceNodes: AudioBufferSourceNode[] = [];
  private rafId: ReturnType<typeof requestAnimationFrame> | undefined;

  /** Whether a server-mode TTS endpoint was detected (C-389 AC-8). */
  isKokoroServerAvailable = $state(false);

  isDemoMode(): boolean {
    return false;
  }

  async loadVoices(): Promise<void> {
    const baseUrl = this._kokoroServerUrl;
    if (!baseUrl) {
      return;
    }
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/voices`);
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
      const buffer = await this._requestSpeech({
        text,
        voice: voiceId ?? this.selectedVoice,
        signal,
      });
      if (signal.aborted) {
        return;
      }
      if (!buffer) {
        return;
      }

      // Play the WAV audio through the gapless AudioBufferSourceNode queue.
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

    // Stop HTMLAudioElement playback
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

  // ── Kokoro TTS ──

  async initialize(): Promise<void> {
    if (this.status !== 'uninitialized') {
      this.debug('initialize:skipped', { status: this.status });
      return;
    }

    // C-389: resolve the runtime engine config first — TTS mode and the
    // server URL come from config.json, never from a baked-in default.
    await runtimeConfigService.loadConfig();
    const mode = runtimeConfigService.getVoiceTtsMode();
    const serverUrl = runtimeConfigService.getVoiceTtsUrl();

    // AC (voice.tts.mode = disabled): TTS is off; nothing is probed.
    if (mode === 'disabled') {
      this.status = 'disabled';
      this.backend = 'unavailable';
      this.info('initialize:disabled');
      return;
    }

    // Server mode: probe ONLY the configured URL (AC-7 — no blind
    // localhost probing). Unreachable → fall through to browser TTS.
    if (mode === 'server' && serverUrl) {
      this._kokoroServerUrl = serverUrl.replace(/\/+$/, '');
      await this.checkKokoroServer();
      if (this.isKokoroServerAvailable) {
        this.status = 'ready';
        this.backend = 'server';
        this.debug('initialize:server-ready', { url: this._kokoroServerUrl });
        return;
      }
      this.warn('initialize:server-unreachable', { url: this._kokoroServerUrl });
      this._kokoroServerUrl = undefined;
    }

    // Browser mode: the voice model must have been downloaded explicitly
    // (AC-4b — never implicit). No model → report not-downloaded and stop.
    const modelState = await voiceModelService.checkStatus();
    if (modelState.status !== 'ready') {
      this.status = 'not-downloaded';
      this.backend = 'unavailable';
      this.info('initialize:model-not-downloaded', { modelState: modelState.status });
      return;
    }

    // Spawn the worker and load the model from the pre-warmed local cache.
    this.status = 'initializing';
    this.errorMessage = null;

    try {
      this._worker = new Worker(new URL('./kokoro_worker.ts', import.meta.url), {
        type: 'module',
      });

      this._worker.onmessage = (event: MessageEvent) => {
        const payload = event.data as {
          type: 'ready' | 'complete' | 'error';
          backend?: 'webgpu' | 'wasm';
          pcmData?: Float32Array;
          sampleRate?: number;
          message?: string;
        };

        switch (payload.type) {
          case 'ready':
            this.status = 'ready';
            this.backend = payload.backend ?? 'wasm';
            this.info('initialize:ready', { backend: this.backend });
            break;

          case 'complete':
            if (payload.pcmData && payload.sampleRate !== undefined) {
              this.debug('kokoro:complete', {
                pcmLength: payload.pcmData.length,
                sampleRate: payload.sampleRate,
                durationSec: (payload.pcmData.length / payload.sampleRate).toFixed(2),
              });
              audioContextManager.unlock();
              this.nextStartTime = 0;
              this.playAudioBuffer({
                pcmData: payload.pcmData,
                sampleRate: payload.sampleRate,
              });
            }
            break;

          case 'error':
            this.status = 'error';
            this.backend = 'unavailable';
            this.errorMessage = payload.message ?? 'Kokoro worker error';
            this.error('kokoro:worker-error', { message: this.errorMessage });
            break;

          default:
            break;
        }
      };

      this._worker.onerror = (error: ErrorEvent) => {
        this.status = 'error';
        this.backend = 'unavailable';
        this.errorMessage = error.message || 'Unknown worker error';
        this.error('kokoro:worker-onerror', { message: this.errorMessage });
      };

      // Vendored ORT WASM lives in the app's static assets (C-389).
      const baseHref =
        typeof document !== 'undefined'
          ? document.baseURI
          : typeof location !== 'undefined'
            ? location.href
            : undefined;
      const wasmPath = baseHref ? new URL('/ort/', baseHref).href : '/ort/';
      this._worker.postMessage({
        action: 'initialize',
        wasmPath,
        device: (await this._preferWebGpu()) ? 'webgpu' : 'wasm',
        modelId: 'onnx-community/Kokoro-82M-ONNX',
        revision: 'f46687f7e41512228ae953af24a11b2640ea0f22',
      });
    } catch (error: unknown) {
      this.status = 'error';
      this.backend = 'unavailable';
      this.errorMessage = error instanceof Error ? error.message : 'Failed to spawn Kokoro worker';
      this.error('initialize:failed', error);
    }
  }

  /** Quick WebGPU capability gate (AC-6): adapter request must not hang. */
  private async _preferWebGpu(): Promise<boolean> {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } })
        .gpu;
      if (!gpu?.requestAdapter) {
        return false;
      }
      const adapter = await Promise.race([
        gpu.requestAdapter(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2000)),
      ]);
      return adapter !== undefined && adapter !== null;
    } catch {
      return false;
    }
  }

  async synthesize(options: { text: string; voice: string }): Promise<void> {
    const { text, voice } = options;

    if (!text.trim()) {
      return;
    }

    // AC-4b: never download the model implicitly. If the voice model has
    // not been downloaded, synthesis is a no-op and the UI directs the
    // user to the download control.
    if (this.status === 'not-downloaded') {
      this.debug('synthesize:not-downloaded', {
        hint: 'Download the voice model from Settings → Audio first.',
      });
      return;
    }

    if (this.status === 'disabled') {
      this.debug('synthesize:disabled');
      return;
    }

    // Path 1: server mode (config-gated URL — C-389 AC-8)
    if (this.backend === 'server' && this.isKokoroServerAvailable && this._kokoroServerUrl) {
      await this._synthesizeViaServer({ text, voice });
      return;
    }

    // Path 2: browser worker (WebGPU or WASM — C-389 AC-6)
    if (!this._worker || this.status !== 'ready') {
      this.debug('synthesize:not-ready', {
        status: this.status,
        backend: this.backend,
        hasWorker: !!this._worker,
      });
      return;
    }

    this._worker.postMessage({ action: 'synthesize', text, voice });
  }

  /**
   * Server path: POSTs the text to the Kokoro REST API, decodes the
   * returned WAV, and plays it through the Web Audio API.
   */
  private async _synthesizeViaServer(options: { text: string; voice: string }): Promise<void> {
    const { text, voice } = options;

    // Stop existing playback and reset scheduling state (sourceNodes,
    // nextStartTime, wordBoundaries) before starting new synthesis, and
    // abort any in-flight speech request.
    this.stop();

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    this.isSynthesizing = true;

    try {
      const buffer = await this._requestSpeech({ text, voice, signal });
      if (signal.aborted) {
        return;
      }
      if (!buffer) {
        return;
      }

      // Resume the AudioContext — game combat flows call this from user
      // gestures (button clicks), which makes resume() safe.
      const ctx = audioContextManager.context;
      audioContextManager.unlock();
      if (ctx.state !== 'running') {
        try {
          await ctx.resume();
        } catch (error) {
          this.warn('synthesize:audio-context-resume-failed', error);
        }
      }
      if (signal.aborted) {
        return;
      }

      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
      } catch (error) {
        this.error('synthesize:decode-failed', error);
        return;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start();

      this.isPlaying = true;
      // Track the source so stop()/dispose() can terminate this playback,
      // and drop it on ended so a stale onended cannot clear isPlaying while
      // a newer source is active.
      this.sourceNodes.push(source);
      source.onended = () => {
        const idx = this.sourceNodes.indexOf(source);
        if (idx !== -1) {
          this.sourceNodes.splice(idx, 1);
        }
        if (this.sourceNodes.length === 0) {
          this.isPlaying = false;
        }
      };
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      this.error('synthesize:server-failed', error);
    } finally {
      this.isSynthesizing = false;
      if (this._abortController === abortController) {
        this._abortController = undefined;
      }
    }
  }

  /**
   * Shared speech request: POSTs text to the discovered Kokoro REST server
   * (`_kokoroServerUrl` + `/v1/audio/speech`) and returns the raw WAV bytes.
   * Used by both {@link speak} and the server synthesis path.
   *
   * @returns The WAV ArrayBuffer, or undefined when the request failed.
   */
  private async _requestSpeech(options: {
    text: string;
    voice: string;
    signal: AbortSignal;
  }): Promise<ArrayBuffer | undefined> {
    const { text, voice, signal } = options;

    if (!this._kokoroServerUrl) {
      return undefined;
    }

    const response = await fetch(`${this._kokoroServerUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice,
        // biome-ignore lint/style/useNamingConvention: API contract field name
        response_format: 'wav',
      }),
      signal,
    });

    if (!response.ok) {
      this.error('tts:speech-request-failed', {
        status: response.status,
        statusText: response.statusText,
      });
      return undefined;
    }

    return await response.arrayBuffer();
  }

  /** @inheritdoc */
  async checkKokoroServer(): Promise<void> {
    // C-389 AC-7: never blind-probe ports. Only the runtime-configured
    // server URL is checked, and only when one is present.
    const url = this._kokoroServerUrl;
    if (!url) {
      this.isKokoroServerAvailable = false;
      this.debug('checkKokoroServer:no-url-configured');
      return;
    }

    try {
      const response = await fetch(`${url}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'tts-1',
          input: 'test',
          voice: 'af_heart',
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok || response.status === 422) {
        this.isKokoroServerAvailable = true;
        this.debug('checkKokoroServer:found', { url });
        return;
      }
    } catch {
      // Server not reachable at the configured URL.
    }

    this.isKokoroServerAvailable = false;
    this.debug('checkKokoroServer:not-found', { url });
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

  /**
   * Updates the spatial position of the active TTS stream.
   *
   * No-op — the previous PannerNode-based spatial panning was tied to the
   * SharedArrayBuffer streaming pipeline (removed). Playback now connects
   * straight to the AudioContext destination.
   */
  updateSpatialPosition(_options: { x: number; y: number }): void {
    // No-op (see class doc comment).
  }

  // ── Private ──

  override async dispose(): Promise<void> {
    this.stop();

    // Terminate WebGPU worker
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }

    await super.dispose();
  }

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
