// apps/frontend/client/src/lib/views/settings/audio/settings_audio_view_model.svelte.ts
//
// SettingsAudioViewModel — reactive volume controls wired to the AudioService
// singleton. Used by the Settings > Game > Audio sub-tab.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { playSceneBgm, playSfxByName } from '$lib/services/audio/audio_asset_resolver';
import { audioService, musicPlayerService, ttsService, voiceModelService } from '$services';
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
    await playSfxByName('sfx_hit');
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
    await voiceModelService.download();
    // Re-initialize TTS now that the model exists.
    if (voiceModelService.state.status === 'ready' && ttsService.status === 'not-downloaded') {
      (ttsService as unknown as { status: string }).status = 'uninitialized';
      await ttsService.initialize().catch(() => {});
    }
  }

  cancelVoiceModelDownload(): void {
    voiceModelService.cancel();
  }

  async deleteVoiceModel(): Promise<void> {
    await voiceModelService.deleteModel();
    (ttsService as unknown as { status: string }).status = 'uninitialized';
  }
}

export const getSettingsAudioViewModel = (
  options: SettingsAudioViewModelOptions,
): SettingsAudioViewModelInterface => SettingsAudioViewModel.create(options);
