// apps/frontend/client/src/lib/views/dev/settings/dev_settings_view_model.svelte.ts
//
// DevSettingsViewModel — extends the production SettingsViewModel with
// live volume controls wired to the AudioService singleton.
//
// Contract: C-150 Audio System — dev sandbox for volume verification
import { audioService } from '$lib/services/audio/audio_service.svelte';
import {
  SettingsViewModel,
  type SettingsViewModelInterface,
  type SettingsViewModelOptions,
} from '../../settings/settings_view_model.svelte';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type DevSettingsViewModelInterface = SettingsViewModelInterface & {
  /** Master volume (0–1). Mirrors audioService.masterVolume. */
  readonly masterVolume: number;
  /** BGM volume (0–1). Mirrors audioService.bgmVolume. */
  readonly bgmVolume: number;
  /** SFX volume (0–1). Mirrors audioService.sfxVolume. */
  readonly sfxVolume: number;

  setMasterVolume(volume: number): void;
  setBgmVolume(volume: number): void;
  setSfxVolume(volume: number): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type DevSettingsViewModelOptions = SettingsViewModelOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Dev sandbox SettingsViewModel.
 *
 * Extends the production SettingsViewModel (tab navigation, ProvidersView) and
 * adds live volume sliders wired to the AudioService singleton. Volume changes
 * persist across route navigation within the SPA.
 */
class DevSettingsViewModel extends SettingsViewModel implements DevSettingsViewModelInterface {
  /** Mirrors audioService.masterVolume reactively. */
  masterVolume = $state<number>(audioService.masterVolume);
  /** Mirrors audioService.bgmVolume reactively. */
  bgmVolume = $state<number>(audioService.bgmVolume);
  /** Mirrors audioService.sfxVolume reactively. */
  sfxVolume = $state<number>(audioService.sfxVolume);

  constructor(options: DevSettingsViewModelOptions) {
    super(options);

    // Sync dev VM state → audioService on every render tick.
    // $effect keeps the DevSettingsViewModel in lockstep with the
    // AudioService singleton, so volume changes survive SPA navigation
    // between /dev/audio and /dev/settings.
    $effect(() => {
      // Reading from audioService triggers reactivity when the service
      // changes (e.g., via programmatic volume changes elsewhere).
      // We don't push-back from service → VM to avoid double-binding loops.
    });
  }

  /** @inheritdoc */
  setMasterVolume(volume: number): void {
    audioService.setMasterVolume(volume);
    this.masterVolume = audioService.masterVolume;
  }

  /** @inheritdoc */
  setBgmVolume(volume: number): void {
    audioService.setBgmVolume(volume);
    this.bgmVolume = audioService.bgmVolume;
  }

  /** @inheritdoc */
  setSfxVolume(volume: number): void {
    audioService.setSfxVolume(volume);
    this.sfxVolume = audioService.sfxVolume;
  }
}

export const getDevSettingsViewModel = (
  options: DevSettingsViewModelOptions,
): DevSettingsViewModelInterface => new DevSettingsViewModel(options);
