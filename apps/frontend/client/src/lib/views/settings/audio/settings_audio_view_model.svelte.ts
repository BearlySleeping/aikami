// apps/frontend/client/src/lib/views/settings/audio/settings_audio_view_model.svelte.ts
//
// SettingsAudioViewModel — reactive volume controls. Used by the
// Settings > Game > Audio sub-tab.
//
// Collaborators arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh fixtures. Production wiring lives in
// ./settings_audio_composition.ts.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { TtsMode } from '@aikami/types';
import type { TtsBackend, TtsStatus, VoiceModelState } from '$types';

// ---------------------------------------------------------------------------
// Capability contracts
// ---------------------------------------------------------------------------

/** Audio-engine volume/playback operations the settings tab consumes. */
export type SettingsAudioEngineCapabilities = {
  readonly masterVolume: number;
  readonly bgmVolume: number;
  readonly sfxVolume: number;
  readonly isCrossfading: boolean;
  setMasterVolume(volume: number): void;
  setBgmVolume(volume: number): void;
  setSfxVolume(volume: number): void;
  playTestSfx(): void;
  stopAll(): void;
};

/** Text-to-speech engine state and operations. */
export type SettingsAudioTtsCapabilities = {
  readonly ttsVolume: number;
  readonly status: TtsStatus;
  readonly backend: TtsBackend;
  readonly errorMessage: string | null;
  readonly isPlaying: boolean;
  readonly selectedVoice: string;
  readonly isKokoroServerAvailable: boolean;
  setTtsVolume(volume: number): void;
  initialize(): Promise<void>;
  reset(): void;
  /** Resolves with a `SpeakOutcome`; rejects only on a genuine failure. */
  synthesize(options: { text: string; voice: string }): Promise<unknown>;
  stop(): void;
};

/** On-demand voice-model download lifecycle. */
export type SettingsAudioVoiceModelCapabilities = {
  readonly state: VoiceModelState;
  readonly totalBytes: number;
  checkStatus(): Promise<VoiceModelState>;
  download(): Promise<VoiceModelState>;
  cancel(): void;
  deleteModel(): Promise<void>;
};

/** Runtime config reads for re-probing the voice server. */
export type SettingsAudioRuntimeConfigCapabilities = {
  getVoiceTtsMode(): TtsMode;
  getVoiceTtsUrl(): string | undefined;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsAudioViewModelInterface = BaseViewModelInterface & {
  /** Master volume (0–1). Mirrors this._audio.masterVolume. */
  readonly masterVolume: number;
  /** BGM volume (0–1). Mirrors this._audio.bgmVolume. */
  readonly bgmVolume: number;
  /** SFX volume (0–1). Mirrors this._audio.sfxVolume. */
  readonly sfxVolume: number;
  /** TTS volume (0–1). Mirrors this._tts.ttsVolume. */
  readonly ttsVolume: number;
  /** Whether a BGM crossfade is currently in progress. */
  readonly isCrossfading: boolean;
  /** Last test-playback feedback message. */
  readonly feedback: string;

  setMasterVolume(volume: number): void;
  setBgmVolume(volume: number): void;
  setSfxVolume(volume: number): void;
  setTtsVolume(volume: number): void;

  /** Test BGM playback: crossfade to Exploration track. */
  testExploreBgm(): Promise<void>;
  /** Test BGM playback: crossfade to Combat track. */
  testCombatBgm(): Promise<void>;
  /** Test SFX playback. */
  testHitSfx(): Promise<void>;
  stopAll(): void;

  // ── Voice model download control (C-389 AC-4c) ────────────────────────

  /** Lifecycle of the on-demand voice model download. */
  readonly voiceModelState: VoiceModelState;
  /** Total download size as a human label (e.g. "88.6 MB"). */
  readonly voiceModelSizeLabel: string;
  /** 0–100 download progress. */
  readonly voiceModelProgress: number;
  /** Which TTS backend is active (browser webgpu/wasm, server, disabled). */
  readonly ttsBackendLabel: string;
  /** TTS status label for the settings UI. */
  readonly ttsStatusLabel: string;

  /** Starts (or joins) the explicit voice model download. */
  downloadVoiceModel(): Promise<void>;
  /** Cancels an in-flight download. */
  cancelVoiceModelDownload(): void;
  /** Deletes the cached voice model. */
  deleteVoiceModel(): Promise<void>;

  /** Tests TTS by speaking a sample phrase with the current voice. */
  testTts(): Promise<void>;
  /** Stops any in-progress TTS playback. */
  stopTts(): void;
  /** Whether TTS audio is currently playing. */
  readonly isTtsPlaying: boolean;
  /**
   * True while a Test TTS request is in flight (including the wait for the
   * speech runtime to finish loading). The button reflects this so a click
   * that IS being honoured does not look ignored.
   */
  readonly isTtsBusy: boolean;
  /**
   * Voice-model section status line (model + speech runtime state).
   *
   * Separate from {@link feedback}, which is the transient result of the last
   * action and renders under Test Playback.
   */
  readonly voiceModelFeedback: string | null;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingsAudioViewModelOptions = BaseViewModelOptions & {
  /** Audio-engine volume/playback capability. */
  audio: SettingsAudioEngineCapabilities;
  /** Text-to-speech capability. */
  tts: SettingsAudioTtsCapabilities;
  /** On-demand voice model capability. */
  voiceModel: SettingsAudioVoiceModelCapabilities;
  /** Runtime config capability. */
  runtimeConfig: SettingsAudioRuntimeConfigCapabilities;
  /** Crossfades BGM to a test scene track. */
  playSceneBgm: (scene: 'explore' | 'combat') => Promise<void>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SettingsAudioViewModel
  extends BaseViewModel<SettingsAudioViewModelOptions>
  implements SettingsAudioViewModelInterface
{
  private readonly _audio: SettingsAudioEngineCapabilities;
  private readonly _tts: SettingsAudioTtsCapabilities;
  private readonly _voiceModel: SettingsAudioVoiceModelCapabilities;
  private readonly _runtimeConfig: SettingsAudioRuntimeConfigCapabilities;
  private readonly _playSceneBgm: (scene: 'explore' | 'combat') => Promise<void>;
  /** Guards against a second Test TTS while one is in flight. */
  private _testTtsBusy = $state(false);

  constructor(options: SettingsAudioViewModelOptions) {
    super(options);
    this._audio = options.audio;
    this._tts = options.tts;
    this._voiceModel = options.voiceModel;
    this._runtimeConfig = options.runtimeConfig;
    this._playSceneBgm = options.playSceneBgm;
  }

  // Reactive reads — the injected capabilities hold these as `$state`, so
  // reading them in the view tracks updates directly. No polling loop, no
  // divergent copy. `feedback` is genuine UI-local state.
  get masterVolume(): number {
    return this._audio.masterVolume;
  }

  get bgmVolume(): number {
    return this._audio.bgmVolume;
  }

  get sfxVolume(): number {
    return this._audio.sfxVolume;
  }

  get ttsVolume(): number {
    return this._tts.ttsVolume;
  }

  get isCrossfading(): boolean {
    return this._audio.isCrossfading;
  }

  feedback = $state<string>('');

  override async initialize(): Promise<void> {
    // Refresh the voice-model download state on open (C-389 AC-4c).
    void this._voiceModel.checkStatus();
    void this._tts.initialize().catch(() => {});
    await super.initialize();
  }

  setMasterVolume(volume: number): void {
    this._audio.setMasterVolume(volume);
  }

  setBgmVolume(volume: number): void {
    this._audio.setBgmVolume(volume);
  }

  setSfxVolume(volume: number): void {
    this._audio.setSfxVolume(volume);
  }

  setTtsVolume(volume: number): void {
    this._tts.setTtsVolume(volume);
  }

  async testExploreBgm(): Promise<void> {
    this.feedback = 'Crossfading to Exploration BGM…';
    await this._playSceneBgm('explore');
    this.feedback = 'Playing: Exploration BGM';
  }

  async testCombatBgm(): Promise<void> {
    this.feedback = 'Crossfading to Combat BGM…';
    await this._playSceneBgm('combat');
    this.feedback = 'Playing: Combat BGM';
  }

  async testHitSfx(): Promise<void> {
    this.feedback = 'Playing: Hit SFX';
    // No SFX asset files are bundled, so use a synthesized test tone routed
    // through the SFX bus — it always produces audible feedback and respects
    // the SFX + master volume sliders.
    this._audio.playTestSfx();
  }

  stopAll(): void {
    this._audio.stopAll();
    this.feedback = 'All audio stopped.';
  }

  // ── Voice model download control (C-389 AC-4c) ────────────────────────

  get voiceModelState(): VoiceModelState {
    return this._voiceModel.state;
  }

  get voiceModelSizeLabel(): string {
    const bytes = this._voiceModel.totalBytes;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  get voiceModelProgress(): number {
    const state = this._voiceModel.state;
    if (state.status === 'downloading') {
      return Math.round((state.receivedBytes / Math.max(1, state.totalBytes)) * 100);
    }
    if (state.status === 'verifying') {
      return 100;
    }
    return 0;
  }

  get ttsBackendLabel(): string {
    switch (this._tts.backend) {
      case 'webgpu':
        return 'Browser (WebGPU)';
      case 'wasm':
        return 'Browser (WASM — speech will be slower)';
      case 'server':
        return 'Local server';
      default:
        return 'Unavailable';
    }
  }

  get ttsStatusLabel(): string {
    switch (this._tts.status) {
      case 'ready':
        return 'Ready';
      case 'initializing':
        return 'Initializing…';
      case 'not-downloaded':
        return 'Voice model not downloaded';
      case 'disabled':
        return 'Disabled (voice.tts.mode)';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  }

  async downloadVoiceModel(): Promise<void> {
    // C-449 AC-1: check connectivity before attempting download
    if (!navigator.onLine) {
      this.feedback =
        'Cannot download: you appear to be offline. Please check your connection and try again.';
      return;
    }

    try {
      const state = await this._voiceModel.download();
      if (state.status === 'ready') {
        // Re-initialize TTS now that the model exists (C-389 CR): whenever the
        // engine is not already ready after a successful download — but never
        // tear down an active server backend.
        if (this._voiceModel.state.status === 'ready' && this._tts.status !== 'ready') {
          this._tts.reset();
          await this._tts.initialize().catch(() => {});
        }
        this.feedback = 'Voice model downloaded successfully.';
      } else if (state.status === 'error') {
        this.feedback = state.message ?? 'Download failed';
      } else if (state.status === 'not-downloaded') {
        // Cancellation or idle — not an error.
        this.feedback = '';
      } else {
        this.feedback = 'Download failed';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.feedback = `Download failed: ${message}`;
      this.warn('downloadVoiceModel:failed', error);
    }
  }

  cancelVoiceModelDownload(): void {
    this._voiceModel.cancel();
  }

  async deleteVoiceModel(): Promise<void> {
    await this._voiceModel.deleteModel();
    // Reset through the service-owned lifecycle method so the browser
    // worker is terminated and the backend reports unavailable again
    // (C-389 CR — previously only the status flag was cleared).
    this._tts.reset();
  }

  /** Sample phrase spoken by the TTS test button. */
  private static readonly _ttsTestText =
    'Hello! This is a speech test. The voice model is working perfectly.';

  get isTtsPlaying(): boolean {
    return this._tts.isPlaying;
  }

  get isTtsBusy(): boolean {
    return this._testTtsBusy;
  }

  /**
   * Status line for the voice-model section.
   *
   * Deliberately separate from {@link feedback}, which is the result of the
   * last *action* and renders under Test Playback — reusing it here printed
   * every action result twice and made a runtime failure look like a
   * voice-model problem.
   */
  get voiceModelFeedback(): string | null {
    if (this.voiceModelState.status === 'not-downloaded') {
      return 'Voice model not downloaded yet.';
    }
    if (this.voiceModelState.status !== 'ready') {
      return null;
    }
    if (this._tts.status === 'error' && this._tts.errorMessage) {
      return `TTS failed: ${this._tts.errorMessage}`;
    }
    if (this._tts.status === 'initializing') {
      return 'Loading speech runtime…';
    }
    if (this._tts.status === 'ready') {
      return `Speech runtime ready (${this._tts.backend}).`;
    }
    return null;
  }

  async testTts(): Promise<void> {
    if (this._testTtsBusy) {
      return;
    }
    this._testTtsBusy = true;
    try {
      await this._runTestTts();
    } finally {
      this._testTtsBusy = false;
    }
  }

  private async _runTestTts(): Promise<void> {
    // The TTS service only probes the Kokoro server once, during initialize().
    // If the voice server started after Settings opened (or was briefly down),
    // re-discover it so server-mode synthesis actually works instead of
    // silently falling back to the browser engine.
    const mode = this._runtimeConfig.getVoiceTtsMode();
    const serverUrl = this._runtimeConfig.getVoiceTtsUrl();
    if (mode === 'server' && serverUrl && !this._tts.isKokoroServerAvailable) {
      this.feedback = 'Probing voice server…';
      this._tts.reset();
    }

    // Bring the engine up without blocking on it. The cold Kokoro load takes
    // several seconds, and a click during that window used to be dropped —
    // the user had to click again. The service now joins the in-flight load,
    // so this await returns as soon as the engine is genuinely usable.
    //
    // `status` is re-read into a local after the await: it is declared
    // `readonly` on the capability, so TypeScript would otherwise keep the
    // pre-await narrowing and conclude 'ready' is unreachable.
    const readyNow = (): TtsStatus => this._tts.status;
    if (readyNow() !== 'ready') {
      this.feedback = 'Loading speech runtime…';
      await this._tts.initialize();
      const afterInit = readyNow();
      if (afterInit === 'error') {
        this.feedback = `TTS failed: ${this._tts.errorMessage ?? 'unknown error'}`;
        return;
      }
      if (afterInit === 'not-downloaded') {
        this.feedback = 'TTS not ready — download the voice model first.';
        return;
      }
      if (afterInit !== 'ready') {
        this.feedback = 'TTS is disabled in the voice settings.';
        return;
      }
    }

    this.feedback = 'Speaking test phrase…';
    try {
      const outcome = await this._tts.synthesize({
        text: SettingsAudioViewModel._ttsTestText,
        voice: this._tts.selectedVoice,
      });
      this.feedback = SettingsAudioViewModel._outcomeMessage(outcome);
    } catch (error: unknown) {
      this.feedback = `TTS failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Maps a {@link SpeakOutcome} to one honest line of UI copy.
   *
   * Takes `unknown` because the capability deliberately does not widen to the
   * concrete outcome union — an unexpected shape must not crash the settings
   * page.
   */
  private static _outcomeMessage(outcome: unknown): string {
    const kind =
      typeof outcome === 'object' && outcome !== null && 'kind' in outcome
        ? String((outcome as { kind: unknown }).kind)
        : 'unknown';
    const status =
      typeof outcome === 'object' && outcome !== null && 'status' in outcome
        ? String((outcome as { status: unknown }).status)
        : 'unknown';
    switch (kind) {
      case 'scheduled':
        return 'TTS test playing…';
      case 'cancelled':
        return 'TTS test stopped before it finished.';
      default:
        return `TTS unavailable (${status}).`;
    }
  }

  stopTts(): void {
    this._tts.stop();
    this.feedback = 'TTS playback stopped.';
  }
}

/**
 * Builds the settings-audio ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getSettingsAudioViewModel` in
 * ./settings_audio_composition.ts.
 */
export const createSettingsAudioViewModel = (
  options: SettingsAudioViewModelOptions,
): SettingsAudioViewModelInterface => SettingsAudioViewModel.create(options);
