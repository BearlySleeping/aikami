// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.svelte.ts
//
// In-game Settings overlay ViewModel — registry-driven section list (C-466).
// Renders all sections flagged with 'pause' context, in registry order.
// Settings are immediate-save: edits persist as they change, so closing the
// overlay rolls nothing back.
// Adds a "Full Settings" navigation action to reach groups the overlay doesn't show.
//
// Lifecycle ownership: the overlay retains one ViewModel instance per visited
// section for the duration of the overlay (so drafts survive tab switches), but
// it does NOT initialize/dispose them. Each rendered section view's
// BaseViewModelContainer is the single lifecycle owner. The overlay only reads
// retained instances.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { SettingsAudioViewModelInterface } from '$lib/views/settings/audio/settings_audio_view_model.svelte';
import type { SettingsControlsViewModelInterface } from '$lib/views/settings/controls/settings_controls_view_model.svelte';
import type { SettingsDisplayViewModelInterface } from '$lib/views/settings/display/settings_display_view_model.svelte';
import type { GameplayViewModelInterface } from '$lib/views/settings/gameplay/gameplay_view_model.svelte';
import { type SettingsSection, sectionsForContext } from '$lib/views/settings/settings_sections';
import type { SimpleSectionViewModelMount } from '$lib/views/settings/settings_sections_composition';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Router navigation capability for the overlay. */
export type SettingsOverlayRouterCapabilities = {
  goToHref(href: string): Promise<void>;
};

/** Overlay stack capability for the overlay. */
export type SettingsOverlayStackCapabilities = {
  popOverlay(): void;
};

/**
 * Construction options for the in-game settings overlay.
 *
 * `createSectionMount` is the injected section-factory capability. Production
 * wiring lives in `settings_overlay_composition.ts`; tests pass a fixture. The
 * ViewModel never imports the production factory directly.
 */
export type SettingsOverlayViewModelOptions = BaseViewModelOptions & {
  createSectionMount: (sectionId: string) => SimpleSectionViewModelMount | undefined;
  /** Router capability. */
  router: SettingsOverlayRouterCapabilities;
  /** Overlay-stack capability. */
  overlay: SettingsOverlayStackCapabilities;
};

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

  setActiveSection(id: string): void;
  close(): void;
  /** Navigates to the full /settings page, deep-linked to the active section. */
  navigateToFullSettings(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SettingsOverlayViewModel
  extends BaseViewModel<SettingsOverlayViewModelOptions>
  implements SettingsOverlayViewModelInterface
{
  /** Registry-driven: all sections flagged for pause context. */
  readonly pauseSections: readonly SettingsSection[];

  activeSectionId = $state<string>('');
  isOpen = $state(true);

  /** Retained section mounts for the overlay's lifetime. The section views' containers own lifecycle. */
  private readonly _sectionViewModelMounts = new Map<string, SimpleSectionViewModelMount>();
  private _activeSectionMount: SimpleSectionViewModelMount | undefined = $state(undefined);

  private readonly _createSectionMount: (
    sectionId: string,
  ) => SimpleSectionViewModelMount | undefined;
  private readonly _router: SettingsOverlayRouterCapabilities;
  private readonly _overlay: SettingsOverlayStackCapabilities;

  constructor(options: SettingsOverlayViewModelOptions) {
    super(options);
    this._createSectionMount = options.createSectionMount;
    this._router = options.router;
    this._overlay = options.overlay;

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
    this._activateSection(this.activeSectionId);
    await super.initialize();
  }

  setActiveSection(id: string): void {
    if (!this.pauseSections.some((s) => s.id === id)) {
      return;
    }
    this.activeSectionId = id;
    this._activateSection(id);
  }

  close(): void {
    this.isOpen = false;
    this._overlay.popOverlay();
  }

  /** Navigate to the full /settings page, deep-linked to the active section. */
  async navigateToFullSettings(): Promise<void> {
    this.debug('navigateToFullSettings', { activeSectionId: this.activeSectionId });
    const activeSection = this.pauseSections.find((s) => s.id === this.activeSectionId);
    const group = activeSection?.group ?? 'play';
    const section = activeSection?.id ?? 'controls';
    // Use goToHref because the settings route's typed queryParameters don't
    // include the ?section= / ?group= params that settings_view_model parses.
    await this._router.goToHref(`/settings?group=${group}&section=${section}`);
  }

  override async dispose(): Promise<void> {
    // Section ViewModels themselves are disposed by their rendered
    // BaseViewModelContainer. Settings are immediate-save, so there is nothing
    // to roll back here — just drop the retained references.
    this._sectionViewModelMounts.clear();
    this._activeSectionMount = undefined;
    await super.dispose();
  }

  // ── Private helpers ──

  private _activateSection(sectionId: string): void {
    this._activeSectionMount = this._getOrCreateViewModelMount(sectionId);
  }

  /**
   * Returns the retained section mount, creating it synchronously on first use.
   * No `initialize()` here — the rendered section view's container owns the
   * lifecycle, which avoids the duplicate-create / stale-cache races caused by
   * populating the cache only after an async initialize resolved.
   */
  private _getOrCreateViewModelMount(sectionId: string): SimpleSectionViewModelMount | undefined {
    const existing = this._sectionViewModelMounts.get(sectionId);
    if (existing) {
      return existing;
    }
    const mount = this._createSectionMount(sectionId);
    if (!mount) {
      return undefined;
    }
    this._sectionViewModelMounts.set(sectionId, mount);
    return mount;
  }
}

/**
 * Testable factory — takes the section-factory capability explicitly and
 * imports no production singletons. Production wiring lives in
 * ./settings_overlay_composition.ts.
 */
export const createSettingsOverlayViewModel = (
  options: SettingsOverlayViewModelOptions,
): SettingsOverlayViewModelInterface => SettingsOverlayViewModel.create(options);
