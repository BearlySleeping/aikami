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
  createSectionViewModel,
  sectionsForContext,
  type SettingsSection,
  type SimpleSectionViewModel,
} from '$lib/views/settings/settings_sections';

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

  /** ViewModel for the currently active section. */
  readonly activeSectionViewModel: SimpleSectionViewModel | undefined;

  /** Section-ViewModel map keyed by section id. */
  readonly sectionViewModels: ReadonlyMap<string, SimpleSectionViewModel>;

  /** Whether the overlay is visible (used by the view). */
  readonly isOpen: boolean;

  setActiveSection(id: string): void;
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

  /** Cached section ViewModels, created on first access. */
  private _sectionViewModels = new Map<string, SimpleSectionViewModel>();

  /** Cache pre-edit state for revert on close. */
  private _preEditAudioVolume: number | undefined;

  constructor(options: BaseViewModelOptions) {
    super(options);

    // Derive sections from the registry using the shared helper
    this.pauseSections = sectionsForContext('pause');
    this.activeSectionId = this.pauseSections[0]?.id ?? '';
  }

  get sectionViewModels(): ReadonlyMap<string, SimpleSectionViewModel> {
    return this._sectionViewModels;
  }

  get activeSectionViewModel(): SimpleSectionViewModel | undefined {
    return this._getOrCreateViewModel(this.activeSectionId);
  }

  override async initialize(): Promise<void> {
    this._preEditAudioVolume = this._getAudioVolume();
    await super.initialize();
  }

  setActiveSection(id: string): void {
    if (this.pauseSections.some((s) => s.id === id)) {
      this.activeSectionId = id;
    }
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
      this._setAudioVolume(this._preEditAudioVolume);
    }
    await super.dispose();
  }

  // ── Private helpers ──

  private _getOrCreateViewModel(sectionId: string): SimpleSectionViewModel | undefined {
    if (this._sectionViewModels.has(sectionId)) {
      return this._sectionViewModels.get(sectionId);
    }
    const vm = createSectionViewModel(sectionId);
    if (!vm) {
      return undefined;
    }
    this._sectionViewModels.set(sectionId, vm as SimpleSectionViewModel);
    return vm as SimpleSectionViewModel;
  }

  private _getAudioVolume(): number | undefined {
    const audioVm = this._sectionViewModels.get('audio') as
      | { masterVolume: number }
      | undefined;
    return audioVm?.masterVolume;
  }

  private _setAudioVolume(volume: number): void {
    const audioVm = this._sectionViewModels.get('audio') as
      | { setMasterVolume: (v: number) => void }
      | undefined;
    audioVm?.setMasterVolume(volume);
  }
}

export const getSettingsOverlayViewModel = (
  options: BaseViewModelOptions,
): SettingsOverlayViewModelInterface => SettingsOverlayViewModel.create(options);
