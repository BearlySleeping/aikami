// apps/frontend/client/src/lib/views/dev/audio/dev_audio_view_model.svelte.ts
//
// DevAudioViewModel — dev sandbox for testing BGM transitions and SFX
// playback via the AudioService singleton.
//
// Contract: C-150 Audio System
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { audioService } from '$lib/services/audio/audio_service.svelte';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type DevAudioViewModelInterface = BaseViewModelInterface & {
  /** Current master volume (0–1). */
  readonly masterVolume: number;
  /** Current BGM volume (0–1). */
  readonly bgmVolume: number;
  /** Current SFX volume (0–1). */
  readonly sfxVolume: number;
  /** Whether a BGM crossfade is in progress. */
  readonly isCrossfading: boolean;
  /** Last action feedback message. */
  readonly feedback: string;

  playExploreBgm(): Promise<void>;
  playCombatBgm(): Promise<void>;
  playHitSfx(): Promise<void>;
  playPickupSfx(): Promise<void>;
  stopAll(): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type DevAudioViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class DevAudioViewModel
  extends BaseViewModel<DevAudioViewModelOptions>
  implements DevAudioViewModelInterface
{
  masterVolume = $state<number>(audioService.masterVolume);
  bgmVolume = $state<number>(audioService.bgmVolume);
  sfxVolume = $state<number>(audioService.sfxVolume);
  isCrossfading = $state<boolean>(false);
  feedback = $state<string>('Ready — press a button to test audio.');

  /** Polling interval for syncing display from audioService. */
  private _pollInterval: ReturnType<typeof setInterval> | undefined;

  /** @inheritdoc */
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

  /** @inheritdoc */
  override async dispose(): Promise<void> {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = undefined;
    }
    await super.dispose();
  }

  /** @inheritdoc */
  async playExploreBgm(): Promise<void> {
    this.feedback = 'Crossfading to Exploration BGM…';
    await audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
    this.feedback = 'Playing: Exploration BGM';
  }

  /** @inheritdoc */
  async playCombatBgm(): Promise<void> {
    this.feedback = 'Crossfading to Combat BGM…';
    await audioService.transitionToBgm('/assets/audio/music/bgm_combat.webm');
    this.feedback = 'Playing: Combat BGM';
  }

  /** @inheritdoc */
  async playHitSfx(): Promise<void> {
    this.feedback = 'Playing: Hit SFX';
    await audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');
  }

  /** @inheritdoc */
  async playPickupSfx(): Promise<void> {
    this.feedback = 'Playing: Pickup SFX';
    await audioService.playSfx('/assets/audio/sfx/sfx_pickup.wav');
  }

  /** @inheritdoc */
  stopAll(): void {
    audioService.stopAll();
    this.feedback = 'All audio stopped.';
  }
}

export const getDevAudioViewModel = (
  options: DevAudioViewModelOptions,
): DevAudioViewModelInterface => new DevAudioViewModel(options);
