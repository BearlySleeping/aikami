// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.svelte.ts
//
// In-game Settings overlay ViewModel — registry-driven section list (C-466).
// Renders all sections flagged with 'pause' context, in registry order.
// Preserves the existing revert-on-close behavior for audio.
// Adds a "Full Settings" navigation action to reach groups the overlay doesn't show.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
  routerService,
} from '@aikami/frontend/services';
import { gameOverlayService } from '$services';
import {
  createSectionViewModelMount,
  sectionsForContext,
  type SettingsSection,
  type SimpleSectionViewModelMount,
} from '$lib/views/settings/settings_sections';
import type { SettingsAudioViewModelInterface } from '$lib/views/settings/audio/settings_audio_view_model.svelte';
import type { SettingsControlsViewModelInterface } from '$lib/views/settings/controls/settings_controls_view_model.svelte';
import type { SettingsDisplayViewModelInterface } from '$lib/views/settings/display/settings_display_view_model.svelte';
import type { GameplayViewModelInterface } from '$lib/views/settings/gameplay/gameplay_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Base configuration used to create the in-game settings overlay ViewModel. */
export type SettingsOverlayViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsOverlayViewModelInterface = BaseViewModelInterface & {
  /** All sections available in the pause context, in registry order. */
  readonly pauseSections: readonly SettingsSection[];

  /** Currently active section id. */
  readonly activeSectionId: string;

  /** Ready, typed ViewModel for the active section, when Audio is selected. */
  readonly activeAudioViewModel: SettingsAudioViewModelInterface | undefined;
  /** Ready, typed ViewModel for the active section, when Controls is selected. */
  readonly activeControlsViewModel: SettingsControlsViewModelInterface | undefined;
  /** Ready, typed ViewModel for the active section, when Display is selected. */
  readonly activeDisplayViewModel: SettingsDisplayViewModelInterface | undefined;
  /** Ready, typed ViewModel for the active section, when Gameplay is selected. */
  readonly activeGameplayViewModel: GameplayViewModelInterface | undefined;

  /** Whether the overlay is visible (used by the view). */
  readonly isOpen: boolean;

  setActiveSection(id: string): Promise<void>;
  close(): void;
  /** Navigates to the full /settings page, deep-linked to the active section. */
  navigateToFullSettings(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SettingsOverlayViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements SettingsOverlayViewModelInterface
{
  /** Registry-driven: all sections flagged for pause context. */
  readonly pauseSections: readonly SettingsSection[];

  activeSectionId = $state<string>('');
  isOpen = $state(true);

  /** Cached section mounts, exposed only after their ViewModels initialize. */
  private _sectionViewModelMounts = new Map<string, SimpleSectionViewModelMount>();
  private _activeSectionMount: SimpleSectionViewModelMount | undefined = $state(undefined);

  /** Cache pre-edit state for revert on close. */
  private _preEditAudioVolume: number | undefined;

  constructor(options: BaseViewModelOptions) {
    super(options);

    // Derive sections from the registry using the shared helper
    this.pauseSections = sectionsForContext('pause');
    this.activeSectionId = this.pauseSections[0]?.id ?? '';
  }

  get activeAudioViewModel(): SettingsAudioViewModelInterface | undefined {
    return this._activeSectionMount?.id === 'audio'
      ? this._activeSectionMount.viewModel
      : undefined;
  }

  get activeControlsViewModel(): SettingsControlsViewModelInterface | undefined {
    return this._activeSectionMount?.id === 'controls'
      ? this._activeSectionMount.viewModel
      : undefined;
  }

  get activeDisplayViewModel(): SettingsDisplayViewModelInterface | undefined {
    return this._activeSectionMount?.id === 'display'
      ? this._activeSectionMount.viewModel
      : undefined;
  }

  get activeGameplayViewModel(): GameplayViewModelInterface | undefined {
    return this._activeSectionMount?.id === 'gameplay'
      ? this._activeSectionMount.viewModel
      : undefined;
  }

  override async initialize(): Promise<void> {
    const audioMount = await this._getOrCreateViewModelMount('audio');
    this._preEditAudioVolume = audioMount?.id === 'audio' ? audioMount.viewModel.masterVolume : undefined;
    await this._activateSection(this.activeSectionId);
    await super.initialize();
  }

  async setActiveSection(id: string): Promise<void> {
    if (!this.pauseSections.some((s) => s.id === id)) {
      return;
    }
    this.activeSectionId = id;
    await this._activateSection(id);
  }

  close(): void {
    this.isOpen = false;
    gameOverlayService.popOverlay();
  }

  /** Navigate to the full /settings page, deep-linked to the active section. */
  async navigateToFullSettings(): Promise<void> {
    this.debug('navigateToFullSettings', { activeSectionId: this.activeSectionId });
    const activeSection = this.pauseSections.find((s) => s.id === this.activeSectionId);
    const group = activeSection?.group ?? 'play';
    const section = activeSection?.id ?? 'controls';
    // Use goToHref because the settings route's typed queryParameters don't
    // include the ?section= / ?group= params that settings_view_model parses.
    await routerService.goToHref(`/settings?group=${group}&section=${section}`);
  }

  override async dispose(): Promise<void> {
    // Revert audio changes that weren't explicitly saved
    if (this._preEditAudioVolume !== undefined) {
      const audioMount = this._sectionViewModelMounts.get('audio');
      if (audioMount?.id === 'audio') {
        audioMount.viewModel.setMasterVolume(this._preEditAudioVolume);
      }
    }
    for (const mount of this._sectionViewModelMounts.values()) {
      await mount.viewModel.dispose();
    }
    this._sectionViewModelMounts.clear();
    this._activeSectionMount = undefined;
    await super.dispose();
  }

  // ── Private helpers ──

  private async _activateSection(sectionId: string): Promise<void> {
    this._activeSectionMount = undefined;
    const mount = await this._getOrCreateViewModelMount(sectionId);
    if (this.activeSectionId === sectionId) {
      this._activeSectionMount = mount;
    }
  }

  private async _getOrCreateViewModelMount(
    sectionId: string,
  ): Promise<SimpleSectionViewModelMount | undefined> {
    const existing = this._sectionViewModelMounts.get(sectionId);
    if (existing) {
      return existing;
    }
    const mount = createSectionViewModelMount(sectionId);
    if (!mount) {
      return undefined;
    }
    await mount.viewModel.initialize();
    mount.viewModel.__mounted = true;
    this._sectionViewModelMounts.set(sectionId, mount);
    return mount;
  }
}

export const getSettingsOverlayViewModel = (
  options: BaseViewModelOptions,
): SettingsOverlayViewModelInterface => SettingsOverlayViewModel.create(options);
