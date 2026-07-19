// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.svelte.ts
//
// Lightweight Settings overlay ViewModel for in-game use (AC-4).
// Composes only the sections relevant during gameplay: Controls, Audio, Display.
// Uses the same sub-ViewModels as the full-page settings route.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import {
  getSettingsAudioViewModel,
  type SettingsAudioViewModelInterface,
} from '$lib/views/settings/audio/settings_audio_view_model.svelte';
import {
  getSettingsControlsViewModel,
  type SettingsControlsViewModelInterface,
} from '$lib/views/settings/controls/settings_controls_view_model.svelte';
import {
  getSettingsDisplayViewModel,
  type SettingsDisplayViewModelInterface,
} from '$lib/views/settings/display/settings_display_view_model.svelte';
import { gameOverlayService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsOverlayTab = 'controls' | 'audio' | 'display';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsOverlayViewModelInterface = BaseViewModelInterface & {
  readonly activeTab: SettingsOverlayTab;
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;

  setActiveTab(tab: SettingsOverlayTab): void;
  close(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SettingsOverlayViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements SettingsOverlayViewModelInterface
{
  activeTab: SettingsOverlayTab = $state('audio');
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;

  // Cache pre-edit state for revert on close
  private _preEditAudioVolume: number | undefined;

  constructor(options: BaseViewModelOptions) {
    super(options);
    this.audioViewModel = getSettingsAudioViewModel({ className: 'OverlayAudioViewModel' });
    this.displayViewModel = getSettingsDisplayViewModel({ className: 'OverlayDisplayViewModel' });
    this.controlsViewModel = getSettingsControlsViewModel({
      className: 'OverlayControlsViewModel',
    });
  }

  override async initialize(): Promise<void> {
    this._preEditAudioVolume = this.audioViewModel.masterVolume;
    await super.initialize();
  }

  setActiveTab(tab: SettingsOverlayTab): void {
    this.activeTab = tab;
  }

  close(): void {
    // Revert audio changes that weren't explicitly saved
    if (this._preEditAudioVolume !== undefined) {
      this.audioViewModel.setMasterVolume(this._preEditAudioVolume);
    }
    gameOverlayService.popOverlay();
  }
}

export const getSettingsOverlayViewModel = (
  options: BaseViewModelOptions,
): SettingsOverlayViewModelInterface => SettingsOverlayViewModel.create(options);
