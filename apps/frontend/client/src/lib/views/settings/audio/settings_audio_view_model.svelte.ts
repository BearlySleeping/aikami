// apps/frontend/client/src/lib/views/settings/audio/settings_audio_view_model.svelte.ts
//
// SettingsAudioViewModel — reactive volume controls wired to the AudioService
// singleton. Used by the Settings > Game > Audio sub-tab.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { audioService } from '$lib/services/audio/audio_service.svelte';

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
  /** Last test-playback feedback message. */
  readonly feedback: string;

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

  async testExploreBgm(): Promise<void> {
    this.feedback = 'Crossfading to Exploration BGM…';
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
    this.feedback = 'Playing: Exploration BGM';
  }

  async testCombatBgm(): Promise<void> {
    this.feedback = 'Crossfading to Combat BGM…';
    await audioService.transitionToBgm('/assets/audio/music/bgm_combat.webm');
    this.feedback = 'Playing: Combat BGM';
  }

  async testHitSfx(): Promise<void> {
    this.feedback = 'Playing: Hit SFX';
    await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');
  }

  stopAll(): void {
    audioService.stopAll();
    this.feedback = 'All audio stopped.';
  }
}

export const getSettingsAudioViewModel = (
  options: SettingsAudioViewModelOptions,
): SettingsAudioViewModelInterface => SettingsAudioViewModel.create(options);
