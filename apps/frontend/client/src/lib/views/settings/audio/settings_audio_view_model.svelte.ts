// apps/frontend/client/src/lib/views/settings/audio/settings_audio_view_model.svelte.ts
//
// SettingsAudioViewModel — reactive volume controls wired to the AudioService
// singleton. Used by the Settings > Game > Audio sub-tab.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  audioService,
  musicPlayerService,
  playSceneBgm,
  runtimeConfigService,
  ttsService,
  voiceModelService,
} from '$services';
import type { VoiceModelState } from '$types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsAudioViewModelInterface = BaseViewModelInterface & {
  /** Master volume (0–1). Mirrors audioService.masterVolume. */
  readonly masterVolume: number;
  /** BGM volume (0–1). Mirrors audioService.bgmVolume. */
  readonly bgmVolume: number;
  /** SFX volume (0–1). Mirrors audioService.sfxVolume. */
  readonly sfxVolume: number;
  /** TTS volume (0–1). Mirrors ttsService.ttsVolume. */
  readonly ttsVolume: number;
  /** Whether a BGM crossfade is currently in progress. */
  readonly isCrossfading: boolean;
  /** Whether the in-game music player overlay is visible. */
  readonly musicPlayerVisible: boolean;
  /** Last test-playback feedback message. */
  readonly feedback: string;

  /** Shows/hides the in-game music player overlay. */
  toggleMusicPlayer(): void;

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
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingsAudioViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SettingsAudioViewModel
  extends BaseViewModel<SettingsAudioViewModelOptions>
  implements SettingsAudioViewModelInterface
{
  masterVolume = $state<number>(audioService.masterVolume);
  bgmVolume = $state<number>(audioService.bgmVolume);
  sfxVolume = $state<number>(audioService.sfxVolume);
  ttsVolume = $state<number>(ttsService.ttsVolume);
  isCrossfading = $state<boolean>(false);
  feedback = $state<string>('');
  private _pollInterval: ReturnType<typeof setInterval> | undefined;

  override async initialize(): Promise<void> {
    // Refresh the voice-model download state on open (C-389 AC-4c).
    void voiceModelService.checkStatus();
    void ttsService.initialize().catch(() => {});
    // Poll audioService every ~200ms to keep the display in sync
    this._pollInterval = setInterval(() => {
      this.masterVolume = audioService.masterVolume;
      this.bgmVolume = audioService.bgmVolume;
      this.sfxVolume = audioService.sfxVolume;
      this.ttsVolume = ttsService.ttsVolume;
      this.isCrossfading = audioService.isCrossfading;
    }, 200);
    await super.initialize();
  }

  override async dispose(): Promise<void> {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = undefined;
    }
    await super.dispose();
  }

  setMasterVolume(volume: number): void {
    audioService.setMasterVolume(volume);
    this.masterVolume = audioService.masterVolume;
  }

  setBgmVolume(volume: number): void {
    audioService.setBgmVolume(volume);
    this.bgmVolume = audioService.bgmVolume;
  }

  setSfxVolume(volume: number): void {
    audioService.setSfxVolume(volume);
    this.sfxVolume = audioService.sfxVolume;
  }

  setTtsVolume(volume: number): void {
    ttsService.setTtsVolume(volume);
    this.ttsVolume = ttsService.ttsVolume;
  }

  get musicPlayerVisible(): boolean {
    return musicPlayerService.visible;
  }

  toggleMusicPlayer(): void {
    musicPlayerService.toggleVisible();
  }

  async testExploreBgm(): Promise<void> {
    this.feedback = 'Crossfading to Exploration BGM…';
    await playSceneBgm('explore');
    this.feedback = 'Playing: Exploration BGM';
  }

  async testCombatBgm(): Promise<void> {
    this.feedback = 'Crossfading to Combat BGM…';
    await playSceneBgm('combat');
    this.feedback = 'Playing: Combat BGM';
  }

  async testHitSfx(): Promise<void> {
    this.feedback = 'Playing: Hit SFX';
    // No SFX asset files are bundled, so use a synthesized test tone routed
    // through the SFX bus — it always produces audible feedback and respects
    // the SFX + master volume sliders.
    audioService.playTestSfx();
  }

  stopAll(): void {
    audioService.stopAll();
    this.feedback = 'All audio stopped.';
  }

  // ── Voice model download control (C-389 AC-4c) ────────────────────────

  get voiceModelState(): VoiceModelState {
    return voiceModelService.state;
  }

  get voiceModelSizeLabel(): string {
    const bytes = voiceModelService.totalBytes;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  get voiceModelProgress(): number {
    const state = voiceModelService.state;
    if (state.status === 'downloading') {
      return Math.round((state.receivedBytes / Math.max(1, state.totalBytes)) * 100);
    }
    if (state.status === 'verifying') {
      return 100;
    }
    return 0;
  }

  get ttsBackendLabel(): string {
    switch (ttsService.backend) {
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
    switch (ttsService.status) {
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
      const state = await voiceModelService.download();
      if (state.status === 'ready') {
        // Re-initialize TTS now that the model exists (C-389 CR): whenever the
        // engine is not already ready after a successful download — but never
        // tear down an active server backend.
        if (voiceModelService.state.status === 'ready' && ttsService.status !== 'ready') {
          ttsService.reset();
          await ttsService.initialize().catch(() => {});
        }
        this.feedback = 'Voice model downloaded successfully.';
      } else {
        this.feedback = state.message ?? 'Download failed';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.feedback = `Download failed: ${message}`;
      this.warn('downloadVoiceModel:failed', error);
    }
  }

  cancelVoiceModelDownload(): void {
    voiceModelService.cancel();
  }

  async deleteVoiceModel(): Promise<void> {
    await voiceModelService.deleteModel();
    // Reset through the service-owned lifecycle method so the browser
    // worker is terminated and the backend reports unavailable again
    // (C-389 CR — previously only the status flag was cleared).
    ttsService.reset();
  }

  /** Sample phrase spoken by the TTS test button. */
  private static readonly _ttsTestText =
    'Hello! This is a speech test. The voice model is working perfectly.';

  get isTtsPlaying(): boolean {
    return ttsService.isPlaying;
  }

  async testTts(): Promise<void> {
    // The TTS service only probes the Kokoro server once, during initialize().
    // If the voice server started after Settings opened (or was briefly down),
    // re-discover it so server-mode synthesis actually works instead of
    // silently falling back to the browser worker.
    const mode = runtimeConfigService.getVoiceTtsMode();
    const serverUrl = runtimeConfigService.getVoiceTtsUrl();
    if (mode === 'server' && serverUrl && !ttsService.isKokoroServerAvailable) {
      this.feedback = 'Probing voice server…';
      ttsService.reset();
      await ttsService.initialize().catch(() => {});
    }

    if (ttsService.status !== 'ready') {
      this.feedback = 'TTS not ready — download the voice model first.';
      return;
    }

    this.feedback = 'Speaking test phrase…';
    await ttsService.synthesize({
      text: SettingsAudioViewModel._ttsTestText,
      voice: ttsService.selectedVoice,
    });
    // synthesize() resolves once the request is queued, not when playback
    // finishes — so report that playback started rather than claiming
    // completion. Surface real failures instead of always claiming success.
    if (ttsService.errorMessage) {
      this.feedback = `TTS failed: ${ttsService.errorMessage}`;
    } else if (ttsService.isPlaying) {
      this.feedback = 'TTS test playing…';
    } else {
      this.feedback = 'TTS test queued.';
    }
  }

  stopTts(): void {
    ttsService.stop();
    this.feedback = 'TTS playback stopped.';
  }
}

export const getSettingsAudioViewModel = (
  options: SettingsAudioViewModelOptions,
): SettingsAudioViewModelInterface => SettingsAudioViewModel.create(options);
