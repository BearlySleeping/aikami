// apps/frontend/client/src/lib/views/settings/settings_view_model.svelte.ts
//
// ViewModel for the Settings page. Manages Game (Display / Audio / Controls) and
// AI Engine (Text / Image / Voice) tab navigation. The Text sub-tab hosts the
// full ProvidersView from C-120 for AI provider configuration.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { routerService } from '$services';
import {
  getSettingsAudioViewModel,
  type SettingsAudioViewModelInterface,
} from './audio/settings_audio_view_model.svelte';
import {
  getSettingsControlsViewModel,
  type SettingsControlsViewModelInterface,
} from './controls/settings_controls_view_model.svelte';
import {
  getSettingsDisplayViewModel,
  type SettingsDisplayViewModelInterface,
} from './display/settings_display_view_model.svelte';
import {
  getProvidersViewModel,
  type ProvidersViewModelInterface,
} from './providers/providers_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsCategory = 'game' | 'ai_engine';

export type GameSubTab = 'display' | 'audio' | 'controls';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsViewModelInterface = BaseViewModelInterface & {
  /** Currently selected primary category. */
  readonly activeCategory: SettingsCategory;
  /** Currently selected sub-tab under the Game category. */
  readonly gameSubTab: GameSubTab;
  /** The C-120 ProvidersViewModel for AI provider configuration. */
  readonly providersViewModel: ProvidersViewModelInterface;
  /** Audio settings view model wired to AudioService. */
  readonly audioViewModel: SettingsAudioViewModelInterface;
  /** Display settings view model wired to Tauri window API. */
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  /** Controls settings view model with localStorage keybindings. */
  readonly controlsViewModel: SettingsControlsViewModelInterface;

  setActiveCategory(category: SettingsCategory): void;
  setGameSubTab(tab: GameSubTab): void;
  /**
   * Closes settings and navigates back to the originating page.
   * Reads the `from` query parameter to determine the destination:
   *   - `?from=game` → navigates to `/game`
   *   - `?from=start` (or any other value) → navigates to `/`
   *   - No parameter → defaults to `/`
   */
  closeSettings(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingsViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SettingsViewModel
  extends BaseViewModel<SettingsViewModelOptions>
  implements SettingsViewModelInterface
{
  activeCategory: SettingsCategory = $state('game');
  gameSubTab: GameSubTab = $state('display');
  readonly providersViewModel: ProvidersViewModelInterface;
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;

  constructor(options: SettingsViewModelOptions) {
    super(options);
    this.providersViewModel = getProvidersViewModel({ className: 'ProvidersViewModel' });
    this.audioViewModel = getSettingsAudioViewModel({ className: 'SettingsAudioViewModel' });
    this.displayViewModel = getSettingsDisplayViewModel({ className: 'SettingsDisplayViewModel' });
    this.controlsViewModel = getSettingsControlsViewModel({
      className: 'SettingsControlsViewModel',
    });
  }

  override async initialize(): Promise<void> {
    this.debug('initialize');
    // ProvidersViewModel handles its own initialization (config load + service
    // detection) when its BaseViewModelContainer mounts.
    await super.initialize();
  }

  setActiveCategory(category: SettingsCategory): void {
    this.activeCategory = category;
  }

  setGameSubTab(tab: GameSubTab): void {
    this.gameSubTab = tab;
  }

  async closeSettings(): Promise<void> {
    this.debug('closeSettings');

    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');

    if (from === 'game') {
      await routerService.goToRoute('game', {
        pathParameters: undefined,
        queryParameters: undefined,
      });
      return;
    }

    await routerService.navigateToApp();
  }
}

export const getSettingsViewModel = (
  options: SettingsViewModelOptions,
): SettingsViewModelInterface => new SettingsViewModel(options);
