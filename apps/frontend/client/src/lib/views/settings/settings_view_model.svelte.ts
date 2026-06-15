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
  getProvidersViewModel,
  type ProvidersViewModelInterface,
} from './providers/providers_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsCategory = 'game' | 'ai_engine';

export type GameSubTab = 'display' | 'audio' | 'controls';

export type AiEngineSubTab = 'text' | 'image' | 'voice';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsViewModelInterface = BaseViewModelInterface & {
  /** Currently selected primary category. */
  readonly activeCategory: SettingsCategory;
  /** Currently selected sub-tab under the Game category. */
  readonly gameSubTab: GameSubTab;
  /** Currently selected sub-tab under the AI Engine category. */
  readonly aiEngineSubTab: AiEngineSubTab;
  /** The C-120 ProvidersViewModel for AI provider configuration. */
  readonly providersViewModel: ProvidersViewModelInterface;

  setActiveCategory(category: SettingsCategory): void;
  setGameSubTab(tab: GameSubTab): void;
  setAiEngineSubTab(tab: AiEngineSubTab): void;
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

class SettingsViewModel
  extends BaseViewModel<SettingsViewModelOptions>
  implements SettingsViewModelInterface
{
  activeCategory: SettingsCategory = $state('game');
  gameSubTab: GameSubTab = $state('display');
  aiEngineSubTab: AiEngineSubTab = $state('text');

  readonly providersViewModel: ProvidersViewModelInterface;

  constructor(options: SettingsViewModelOptions) {
    super(options);
    this.providersViewModel = getProvidersViewModel({ className: 'ProvidersViewModel' });
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

  setAiEngineSubTab(tab: AiEngineSubTab): void {
    this.aiEngineSubTab = tab;
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
