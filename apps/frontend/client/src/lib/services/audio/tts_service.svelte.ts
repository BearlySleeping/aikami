// apps/frontend/client/src/lib/services/audio/tts_service.svelte.ts

import { resolveOrtBaseUrl } from '@aikami/frontend/local-runtime';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { VoiceParams } from '@aikami/types';
import type { SpeakOutcome, TtsBackend, TtsStatus, VoiceInfo } from '$types';
import { configService } from '../config/config_service.svelte.ts';
import { runtimeConfigService } from '../config/runtime_config_service.svelte.ts';
import { audioContextManager } from './audio_context_manager';
import { audioService } from './audio_service.svelte.ts';
import {
  fetchKokoroVoices,
  probeKokoroServer,
  requestKokoroSpeech,
} from './kokoro_server_client.ts';
import { KokoroWorkerClient } from './kokoro_worker_client.ts';
import { resolveTtsPlan, type TtsPlan } from './tts_backend_plan.ts';
import { voiceModelService } from './voice_model_service.svelte.ts';

/** Options used to construct the text-to-speech service. */
export type TtsServiceOptions = TtsOptions;
/** True when running inside a Tauri webview. */
const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined; // guard-ignore lint/type-safety/casting: custom window property for Tauri detection

type TtsOptions = BaseFrontendClassOptions;

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

  /** TTS output volume (0–1). Scales all synthesized speech. */
  readonly ttsVolume: number;

  /** Sets the TTS output volume (0–1). */
  setTtsVolume(volume: number): void;

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
   *
   * Waits for an in-flight {@link initialize} rather than refusing, so a
   * click during the ~7s cold model load is honoured instead of dropped.
   * Resolves with a {@link SpeakOutcome}; rejects only on a genuine failure.
   *
   * @param options.text The text to convert to speech.
   * @param options.voiceId Optional voice ID to use (defaults to {@link selectedVoice}).
   */
  speak(options: { text: string; voiceId?: string }): Promise<SpeakOutcome>;

  /**
   * Stops any currently playing audio, aborts the in-progress synthesis
   * request, and resets state.
   *
   * A superseded request resolves as `{ kind: 'cancelled' }` rather than
   * hanging or pretending audio played.
   */
  stop(): void;

  /**
   * Tears the TTS engine down to its uninitialized state: terminates the
   * browser worker, drops the server-mode URL, and reports `unavailable`
   * (C-389 CR — used after deleting the voice model so a stale worker or
   * backend can never outlive the model it loaded).
   */
  reset(): void;

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
   * Spawns a dedicated worker that loads the 82M Kokoro model.
   *
   * Single-flight: concurrent callers share one load. Resolves when the
   * engine is actually ready (not merely when the message was posted), and
   * never rejects — inspect {@link status} for the outcome. Safe for
   * `void this._tts.initialize()`.
   */
  initialize(): Promise<void>;

  /**
   * Synthesizes text to speech, using an explicit Kokoro voice key.
   *
   * A thin alias of {@link speak}; kept because the combat and settings
   * surfaces address voices by Kokoro id rather than by {@link selectedVoice}.
   */
  synthesize(options: { text: string; voice: string }): Promise<SpeakOutcome>;

  /**
   * Converts raw PCM Float32Array data into an AudioBuffer and schedules
   * gapless playback through the Web Audio API.
   *
   * Used by the worker path (kokoro-js offline synthesis).
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
// docs/guides/cross-origin-isolation.md.
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
  ttsVolume = $state(1);

  private _kokoroServerUrl: string | undefined; // server-mode TTS URL (C-389)
  private _voiceSpeed: number | undefined; // from the narrator-voice connection's VoiceParams, when resolved
  private _voiceApiKey: string | undefined; // credential for a cloud server-mode voice provider (e.g. OpenAI TTS)
  private _currentAudio: HTMLAudioElement | null = null;
  private _ttsGain: GainNode | undefined; // volume control for synthesized speech

  /**
   * The in-browser engine, or null for server mode / no engine.
   *
   * The client object is its own identity key: readiness cannot be recorded
   * for a worker that has been replaced, and a superseded worker is
   * unreachable by construction.
   */
  private _engine: KokoroWorkerClient | null = null;
  /**
   * Governs the current engine's whole lifetime. `reset()` aborts it, which
   * terminates a worker even mid-load — the fix for an in-flight
   * `initialize()` resuming after a reset and spawning a second engine.
   */
  private _lifetime = new AbortController();
  /** The single in-flight `initialize()`. Concurrent callers join it. */
  private _flight: Promise<void> | null = null;
  /** The utterance currently being produced; `stop()` aborts it. */
  private _utterance: AbortController | undefined;

  // --- Playback state (gapless scheduling, word tracking) ---
  private _streamEnded = false;
  private _nextStartTime = 0;
  private _wordBoundaries: WordBoundary[] = [];
  private _sourceNodes: AudioBufferSourceNode[] = [];
  private _rafId: ReturnType<typeof requestAnimationFrame> | undefined;

  /** Whether a server-mode TTS endpoint was detected (C-389 AC-8). */
  isKokoroServerAvailable = $state(false);

  isDemoMode(): boolean {
    return false;
  }

  /** @inheritdoc */
  setTtsVolume(volume: number): void {
    // Reject NaN so a malformed value can never corrupt stored state or the
    // live gain node. Valid numeric inputs still go through the 0–1 clamp.
    if (Number.isNaN(volume)) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, volume));
    this.ttsVolume = clamped;
    if (this._ttsGain) {
      this._ttsGain.gain.value = clamped;
    }
  }

  /**
   * Returns the TTS gain node, creating it on first use. All synthesized
   * speech sources connect through it so the TTS volume slider applies
   * uniformly across the server and browser-worker backends.
   */
  private _getTtsGain(): GainNode {
    if (!this._ttsGain) {
      const ctx = audioContextManager.context;
      this._ttsGain = ctx.createGain();
      this._ttsGain.gain.value = this.ttsVolume;
      // Route through the shared master audio graph so the master volume
      // control applies to synthesized speech too.
      this._ttsGain.connect(audioService.masterGainNode);
    }
    return this._ttsGain;
  }

  /** @inheritdoc */
  /**
   * Records a worker's 'ready' for the CURRENT generation only.
   *
   * The worker id is retained because a later "session not initialized" can
   * only mean the request crossed into a different instance, and that is only
   * provable by comparing ids.
   */
  /**
   * Tears the engine down.
   *
   * Aborting the lifetime is what makes this safe mid-load: a worker still
   * fetching the 92 MB model is terminated, and an `initialize()` still
   * awaiting configuration cannot resume and spawn a second one.
   */
  reset(): void {
    this.stop();
    this._lifetime.abort(new DOMException('TTS reset', 'AbortError'));
    this._lifetime = new AbortController();
    this._engine?.dispose();
    this._engine = null;
    this._flight = null;
    this._kokoroServerUrl = undefined;
    this.isKokoroServerAvailable = false;
    this.status = 'uninitialized';
    this.backend = 'unavailable';
    this.errorMessage = null;
    this.debug('reset');
  }

  async loadVoices(): Promise<void> {
    const baseUrl = this._kokoroServerUrl;
    if (!baseUrl) {
      return;
    }
    try {
      const voices = await fetchKokoroVoices({
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiKey: this._voiceApiKey,
      });
      if (voices) {
        this.voices = voices;
        this.debug('loadVoices', { count: voices.length });
      }
    } catch (error) {
      this.error('loadVoices:failed', error);
    }
  }

  async speak(options: { text: string; voiceId?: string }): Promise<SpeakOutcome> {
    if (!options.text.trim()) {
      return { kind: 'unavailable', status: this.status };
    }

    // A click during the cold model load must be honoured, not dropped: join
    // the in-flight initialize and speak once it lands. This is what removed
    // the "click Test TTS twice" requirement.
    if (this._flight) {
      await this._flight;
    }
    // Supersede: a newer request cancels the previous one rather than letting
    // both play (synthesize() previously failed to do this, so utterances
    // overlapped).
    this.stop();

    if (this.status === 'not-downloaded' || this.status === 'disabled') {
      return { kind: 'unavailable', status: this.status };
    }
    if (this.status !== 'ready') {
      this.debug('speak:not-ready', { status: this.status, backend: this.backend });
      return { kind: 'unavailable', status: this.status };
    }

    const voice = options.voiceId ?? this.selectedVoice;
    const utterance = new AbortController();
    this._utterance = utterance;
    const { signal } = utterance;
    this.isSynthesizing = true;
    try {
      // Server dispatch and worker dispatch are the same decision as
      // synthesize() — preview and gameplay must never diverge.
      if (this.backend === 'server' && this._kokoroServerUrl) {
        await this._synthesizeViaServer({ text: options.text, voice, signal });
      } else if (this._engine) {
        const result = await this._engine.synthesize({ text: options.text, voice, signal });
        signal.throwIfAborted();
        audioContextManager.unlock();
        this._nextStartTime = 0;
        await this.playAudioBuffer(result);
      } else {
        return { kind: 'unavailable', status: this.status };
      }
      return { kind: 'scheduled' };
    } catch (error: unknown) {
      if (signal.aborted) {
        return { kind: 'cancelled' };
      }
      throw error;
    } finally {
      if (this._utterance === utterance) {
        this._utterance = undefined;
        this.isSynthesizing = false;
      }
    }
  }

  stop(): void {
    // Abort the in-flight utterance. The client rejects it with the abort
    // reason and tells the worker to skip generating it, so a superseded
    // request costs no forward pass and the caller settles as 'cancelled'
    // rather than hanging.
    this._utterance?.abort(new DOMException('TTS stopped', 'AbortError'));
    this._utterance = undefined;

    // Stop HTMLAudioElement playback
    if (this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio = null;
    }

    // Stop all scheduled source nodes
    for (const node of this._sourceNodes) {
      try {
        node.stop();
      } catch {
        // Already stopped — ignore
      }
    }
    this._sourceNodes = [];

    // Cancel rAF loop
    if (this._rafId !== undefined) {
      cancelAnimationFrame(this._rafId);
      this._rafId = undefined;
    }

    this.isPlaying = false;
    this.isSynthesizing = false;
    this.currentWordIndex = -1;
    this.activeMessageId = undefined;
    this._nextStartTime = 0;
    this._wordBoundaries = [];
    this._streamEnded = false;
  }

  startStream(options: { messageId: string; text: string }): void {
    this.stop();

    this.activeMessageId = options.messageId;

    // Split text into words for proportional timing
    const words = options.text.split(/\s+/).filter(Boolean);
    this._wordBoundaries = new Array(words.length);

    // Pre-compute boundary slots — actual times filled as chunks arrive
    for (let i = 0; i < words.length; i++) {
      this._wordBoundaries[i] = { startTime: 0, endTime: 0 };
    }

    audioContextManager.unlock();
    this._nextStartTime = audioContextManager.context.currentTime;

    this.isPlaying = true;

    // Start the rAF word-tracking loop
    this._startWordTrackingLoop();
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
    source.connect(this._getTtsGain());

    // Schedule gapless playback
    const scheduleTime = Math.max(ctx.currentTime, this._nextStartTime);
    source.start(scheduleTime);

    // Track source for cleanup
    this._sourceNodes.push(source);

    source.onended = () => {
      const idx = this._sourceNodes.indexOf(source);
      if (idx !== -1) {
        this._sourceNodes.splice(idx, 1);
      }
    };

    // Update word boundaries for proportional tracking
    const chunkDuration = audioBuffer.duration;
    if (words && words.length > 0) {
      // Find the next unfilled boundary slot and fill it
      const chunkStartTime = scheduleTime;
      const perWordDuration = chunkDuration / words.length;

      let boundaryIdx = 0;
      for (let i = 0; i < this._wordBoundaries.length; i++) {
        if (this._wordBoundaries[i].endTime <= 0) {
          boundaryIdx = i;
          break;
        }
      }

      for (let w = 0; w < words.length && boundaryIdx + w < this._wordBoundaries.length; w++) {
        this._wordBoundaries[boundaryIdx + w] = {
          startTime: chunkStartTime + w * perWordDuration,
          endTime: chunkStartTime + (w + 1) * perWordDuration,
        };
      }
    }

    // Advance the scheduling clock
    this._nextStartTime = scheduleTime + chunkDuration;
  }

  endStream(): void {
    this._streamEnded = true;
  }

  // ── Kokoro TTS ──

  /**
   * Brings an engine up, single-flight.
   *
   * Three properties this buys, all of which the previous version lacked:
   *
   * 1. **One load, however many callers.** The in-flight promise is stored
   *    synchronously, so app boot, a settings page mounting, and a Test TTS
   *    click can no longer each spawn a worker. Before, `status` was claimed
   *    ~90 lines after the guard across several `await`s, so concurrent
   *    callers all passed the guard and each leaked a full 7-second model
   *    load.
   * 2. **Resolves when the engine is actually ready**, not when the
   *    `initialize` message was posted. `await initialize()` is therefore
   *    meaningful, and a click during load can be honoured.
   * 3. **Never rejects**, so the several `void this._tts.initialize()`
   *    call sites are safe; the outcome is in {@link status}.
   */
  initialize(): Promise<void> {
    if (this._flight) {
      return this._flight;
    }
    if (this.status === 'ready' || this.status === 'disabled') {
      return Promise.resolve();
    }
    const signal = this._lifetime.signal;
    const flight: Promise<void> = this._runInit(signal)
      .catch((error: unknown) => {
        if (!signal.aborted) {
          this._fail(error);
        }
      })
      .finally(() => {
        if (this._flight === flight) {
          this._flight = null;
        }
      });
    this._flight = flight;
    return flight;
  }

  private async _runInit(signal: AbortSignal): Promise<void> {
    // Claimed synchronously, before the first await, so a concurrent caller
    // joins this flight instead of starting a second one.
    this.status = 'initializing';
    this.errorMessage = null;

    // C-389: the runtime engine config comes from config.json, never a
    // baked-in default. C-463: prefer the `narrator-voice` role's
    // connection, falling back to runtimeConfigService unchanged when no
    // voice role resolves (the local-stack path).
    await runtimeConfigService.loadConfig();
    signal.throwIfAborted();

    const roleResolution = configService.resolveRole('narrator-voice');
    const voiceParams = roleResolution?.params as VoiceParams | undefined;
    if (voiceParams?.voiceId) {
      this.selectedVoice = voiceParams.voiceId;
    }
    this._voiceSpeed = voiceParams?.speed;
    this._voiceApiKey = roleResolution?.apiKey || undefined;

    const plan: TtsPlan = resolveTtsPlan({
      mode: roleResolution?.endpoint ? 'server' : runtimeConfigService.getVoiceTtsMode(),
      serverUrl: roleResolution?.endpoint || runtimeConfigService.getVoiceTtsUrl(),
      providerId: roleResolution?.provider,
      apiKey: this._voiceApiKey,
      isDesktop: isTauriRuntime(),
    });

    if (plan.kind === 'disabled') {
      this.status = 'disabled';
      this.backend = 'unavailable';
      this.info('initialize:disabled');
      return;
    }
    if (plan.kind === 'terminal') {
      // Discard a credential we have just refused to transmit.
      if (plan.message.includes('API key')) {
        this._voiceApiKey = undefined;
      }
      this.status = 'error';
      this.backend = 'unavailable';
      this.errorMessage = plan.message;
      this.warn('initialize:terminal-plan', { message: plan.message });
      return;
    }
    if (plan.kind === 'server') {
      this._kokoroServerUrl = plan.url;
      this._voiceApiKey = plan.apiKey;
      await this.checkKokoroServer();
      signal.throwIfAborted();
      if (this.isKokoroServerAvailable) {
        this.status = 'ready';
        this.backend = 'server';
        this.debug('initialize:server-ready', { url: this._kokoroServerUrl });
        return;
      }
      // Unreachable → fall through to the in-browser engine (AC-7: only the
      // configured URL is ever probed, never a blind localhost scan).
      this.warn('initialize:server-unreachable', { url: this._kokoroServerUrl });
      this._kokoroServerUrl = undefined;
    }

    // AC-4b: the model is never downloaded implicitly.
    const modelState = await voiceModelService.checkStatus();
    signal.throwIfAborted();
    if (modelState.status !== 'ready') {
      this.status = 'not-downloaded';
      this.backend = 'unavailable';
      this.info('initialize:model-not-downloaded', { modelState: modelState.status });
      return;
    }

    // ORT runtime assets come from the `aikami-dist` plane under a
    // version-pinned path (the shared seam owns version and location). The
    // backend is chosen by the worker: the main thread and the worker are
    // different contexts, and probing here only delayed the load.
    const started = await KokoroWorkerClient.start({
      wasmPath: resolveOrtBaseUrl(import.meta.env.PUBLIC_ORT_WASM_URL as string | undefined),
      signal,
      onFailure: (failure) => {
        // Identity-checked: a failure from an engine we already replaced
        // must not fail the one now in use.
        if (this._engine === failure.client) {
          this._engine = null;
          this._fail(failure.error);
        }
      },
    });
    signal.throwIfAborted();
    this._engine = started.client;
    this.backend = started.backend;
    this.status = 'ready';
  }

  /** Records a fatal engine failure. */
  private _fail(error: unknown): void {
    this.status = 'error';
    this.backend = 'unavailable';
    this.errorMessage = error instanceof Error ? error.message : String(error);
    this.error('tts:engine-failed', error);
  }

  /**
   * Synthesizes with an explicit Kokoro voice key.
   *
   * A thin alias of {@link speak}. The two had drifted — `synthesize` did
   * not supersede prior playback, so utterances overlapped, and it resolved
   * `void` whether or not anything was ever scheduled.
   */
  async synthesize(options: { text: string; voice: string }): Promise<SpeakOutcome> {
    return await this.speak({ text: options.text, voiceId: options.voice });
  }

  /**
   * Server path: POSTs the text to the Kokoro REST API, decodes the
   * returned WAV, and plays it through the Web Audio API.
   *
   * Throws on a real failure. It used to log and return `undefined`, which
   * made a dead server indistinguishable from a successful, silent one.
   */
  private async _synthesizeViaServer(options: {
    text: string;
    voice: string;
    signal: AbortSignal;
  }): Promise<void> {
    const { text, voice, signal } = options;

    this.isSynthesizing = true;
    try {
      const buffer = await this._requestSpeech({ text, voice, signal });
      signal.throwIfAborted();
      if (!buffer) {
        throw new Error('Voice server returned no audio');
      }

      // Resume the AudioContext — combat flows call this from user
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
      signal.throwIfAborted();

      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
      } catch (error) {
        this.error('synthesize:decode-failed', error);
        throw new Error('Voice server returned audio that could not be decoded');
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this._getTtsGain());
      source.start();

      this.isPlaying = true;
      // Track the source so stop()/dispose() can terminate this playback,
      // and drop it on ended so a stale onended cannot clear isPlaying while
      // a newer source is active.
      this._sourceNodes.push(source);
      source.onended = () => {
        const idx = this._sourceNodes.indexOf(source);
        if (idx !== -1) {
          this._sourceNodes.splice(idx, 1);
        }
        if (this._sourceNodes.length === 0) {
          this.isPlaying = false;
        }
      };
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      this.error('synthesize:server-failed', error);
      throw error;
    } finally {
      this.isSynthesizing = false;
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
    if (!this._kokoroServerUrl) {
      return undefined;
    }

    const buffer = await requestKokoroSpeech({
      connection: { baseUrl: this._kokoroServerUrl, apiKey: this._voiceApiKey },
      text: options.text,
      voice: options.voice,
      speed: this._voiceSpeed,
      signal: options.signal,
    });
    if (!buffer) {
      this.error('tts:speech-request-failed', { baseUrl: this._kokoroServerUrl });
    }
    return buffer;
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

    this.isKokoroServerAvailable = await probeKokoroServer({
      baseUrl: url,
      apiKey: this._voiceApiKey,
    });
    this.debug(
      this.isKokoroServerAvailable ? 'checkKokoroServer:found' : 'checkKokoroServer:not-found',
      { url },
    );
  }

  async playAudioBuffer(options: { pcmData: Float32Array; sampleRate: number }): Promise<void> {
    const { pcmData, sampleRate } = options;

    audioContextManager.unlock();
    const ctx = audioContextManager.context;

    const audioBuffer = ctx.createBuffer(1, pcmData.length, sampleRate);
    audioBuffer.getChannelData(0).set(pcmData);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this._getTtsGain());

    // Schedule gapless playback
    const scheduleTime = Math.max(ctx.currentTime, this._nextStartTime);
    source.start(scheduleTime);

    // Playback has begun — reflect it in state so callers can observe it.
    this.isPlaying = true;

    // Update scheduling clock
    this._nextStartTime = scheduleTime + audioBuffer.duration;

    // Track source for cleanup
    this._sourceNodes.push(source);

    source.onended = () => {
      const idx = this._sourceNodes.indexOf(source);
      if (idx !== -1) {
        this._sourceNodes.splice(idx, 1);
      }
      // Clear isPlaying only once the final queued source has ended, so a
      // stale onended from an earlier source cannot clear it mid-stream.
      if (this._sourceNodes.length === 0) {
        this.isPlaying = false;
      }
    };
  }

  // ── Private ──

  override async dispose(): Promise<void> {
    // reset() also aborts the lifetime, so an initialize() still in flight
    // cannot resume and spawn an engine we just disposed.
    this.reset();
    await super.dispose();
  }

  private _startWordTrackingLoop(): void {
    const ctx = audioContextManager.context;

    const tick = () => {
      const now = ctx.currentTime;

      // Find current word via binary search over boundaries
      let wordIdx = this._findWordIndex(now);

      // If we're past the last word, check if sources are all done
      if (wordIdx >= this._wordBoundaries.length && this._sourceNodes.length === 0) {
        this._cleanupStream();
        return;
      }

      // Fallback: if the stream has explicitly ended and all audio nodes
      // are consumed, clean up regardless of word boundary tracking state.
      if (this._streamEnded && this._sourceNodes.length === 0) {
        this._cleanupStream();
        return;
      }

      if (wordIdx >= this._wordBoundaries.length) {
        wordIdx = this._wordBoundaries.length - 1;
      }

      this.currentWordIndex = wordIdx;
      this._rafId = requestAnimationFrame(tick);
    };

    this._rafId = requestAnimationFrame(tick);
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
    this._nextStartTime = 0;
    this._wordBoundaries = [];
    this._streamEnded = false;
    this._rafId = undefined;
  }

  private _findWordIndex(currentTime: number): number {
    // Binary search for the word whose time window contains currentTime
    let lo = 0;
    let hi = this._wordBoundaries.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const b = this._wordBoundaries[mid];

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
