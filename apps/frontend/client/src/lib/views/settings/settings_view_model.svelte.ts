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
import type { CustomAgentDefinition } from '$types/agent_types';
import {
  type AgentEditorViewModelInterface,
  getAgentEditorViewModel,
} from '../agent/editor/agent_editor_view_model.svelte.ts';
import {
  type AgentListViewModelInterface,
  getAgentListViewModel,
} from '../agent/list/agent_list_view_model.svelte.ts';
import {
  getSettingsAudioViewModel,
  type SettingsAudioViewModelInterface,
} from './audio/settings_audio_view_model.svelte';
import {
  type AutonomousSettingsViewModelInterface,
  getAutonomousSettingsViewModel,
} from './autonomous/autonomous_settings_view_model.svelte';
import {
  getSettingsControlsViewModel,
  type SettingsControlsViewModelInterface,
} from './controls/settings_controls_view_model.svelte';
import {
  getSettingsDisplayViewModel,
  type SettingsDisplayViewModelInterface,
} from './display/settings_display_view_model.svelte';
import {
  type ExportViewModelInterface,
  getExportViewModel,
} from './export/export_view_model.svelte';
import {
  getSettingsMusicViewModel,
  type SettingsMusicViewModelInterface,
} from './music/settings_music_view_model.svelte';
import {
  getProvidersViewModel,
  type ProvidersViewModelInterface,
} from './providers/providers_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsCategory = 'game' | 'ai_engine' | 'agents';

export type GameSubTab = 'display' | 'audio' | 'controls' | 'export' | 'music' | 'autonomous';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsViewModelInterface = BaseViewModelInterface & {
  /** Currently selected primary category. */
  readonly activeCategory: SettingsCategory;
  /** Currently selected sub-tab under the Game category. */
  readonly gameSubTab: GameSubTab;
  /** Whether advanced settings (agents, export, autonomous, music) are visible. */
  readonly isAdvanced: boolean;
  /** Toggles advanced mode on/off. */
  toggleAdvanced(): void;
  /** The C-120 ProvidersViewModel for AI provider configuration. */
  readonly providersViewModel: ProvidersViewModelInterface;
  /** Audio settings view model wired to AudioService. */
  readonly audioViewModel: SettingsAudioViewModelInterface;
  /** Music DJ settings view model — track library, scene overrides, provider. */
  readonly musicViewModel: SettingsMusicViewModelInterface;
  /** Autonomous NPCs settings view model (C-248). */
  readonly autonomousViewModel: AutonomousSettingsViewModelInterface;
  /** Display settings view model wired to Tauri window API. */
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  /** Controls settings view model with localStorage keybindings. */
  readonly controlsViewModel: SettingsControlsViewModelInterface;
  /** Export & Data settings view model (C-246). */
  readonly exportViewModel: ExportViewModelInterface;
  /** Agent list view model (C-247). */
  readonly agentListViewModel: AgentListViewModelInterface;
  /** Agent editor view model (C-247). */
  readonly agentEditorViewModel: AgentEditorViewModelInterface;

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
  /** C-328: Progressive disclosure — advanced settings hidden by default. */
  isAdvanced = $state(false);
  readonly providersViewModel: ProvidersViewModelInterface;
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly musicViewModel: SettingsMusicViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;
  readonly exportViewModel: ExportViewModelInterface;
  readonly autonomousViewModel: AutonomousSettingsViewModelInterface;
  readonly agentListViewModel: AgentListViewModelInterface;
  readonly agentEditorViewModel: AgentEditorViewModelInterface;

  constructor(options: SettingsViewModelOptions) {
    super(options);
    this.providersViewModel = getProvidersViewModel({ className: 'ProvidersViewModel' });
    this.audioViewModel = getSettingsAudioViewModel({ className: 'SettingsAudioViewModel' });
    this.musicViewModel = getSettingsMusicViewModel({ className: 'SettingsMusicViewModel' });
    this.displayViewModel = getSettingsDisplayViewModel({ className: 'SettingsDisplayViewModel' });
    this.controlsViewModel = getSettingsControlsViewModel({
      className: 'SettingsControlsViewModel',
    });
    this.exportViewModel = getExportViewModel({
      className: 'ExportViewModel',
    });
    this.autonomousViewModel = getAutonomousSettingsViewModel({
      className: 'AutonomousSettingsViewModel',
    });
    this.agentEditorViewModel = getAgentEditorViewModel({
      className: 'AgentEditorViewModel',
    });
    this.agentListViewModel = getAgentListViewModel({
      className: 'AgentListViewModel',
      onCreateAgent: () => this.agentEditorViewModel.openCreate(),
      onEditAgent: (agent: CustomAgentDefinition) => this.agentEditorViewModel.openEdit(agent),
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

  /** C-328: Toggles advanced settings visibility. */
  toggleAdvanced(): void {
    this.isAdvanced = !this.isAdvanced;
    // When disabling advanced mode, reset active category to 'game' if
    // currently on a hidden category (agents) or hidden sub-tab.
    if (!this.isAdvanced) {
      if (this.activeCategory === 'agents') {
        this.activeCategory = 'game';
      }
      const advancedSubTabs: GameSubTab[] = ['export', 'music', 'autonomous'];
      if (advancedSubTabs.includes(this.gameSubTab)) {
        this.gameSubTab = 'display';
      }
      // When advanced is off, AI Engine only shows providers (text config).
      // Agents tab is hidden entirely.
    }
  }

  /** Navigates to the Agents tab. */
  showAgentsTab(): void {
    this.activeCategory = 'agents';
    this.agentListViewModel.refresh();
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
): SettingsViewModelInterface => SettingsViewModel.create(options);
