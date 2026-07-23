// apps/frontend/client/src/lib/views/settings/settings_view_model.svelte.ts
//
// ViewModel for the Settings page. Manages the section registry, progressive
// disclosure (Basic/Advanced toggle), search filtering, per-section reset,
// and immediate preview/revert for Display and Audio.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
  routerService,
} from '@aikami/frontend/services';
import type { CustomAgentDefinition } from '$types';
import {
  type AgentEditorViewModelInterface,
  getAgentEditorViewModel,
} from '../agent/editor/agent_editor_view_model.svelte.ts';
import {
  type AgentListViewModelInterface,
  getAgentListViewModel,
} from '../agent/list/agent_list_view_model.svelte.ts';
import {
  type AIPrivacyViewModelInterface,
  getAIPrivacyViewModel,
} from './ai_privacy/ai_privacy_view_model.svelte';
import {
  getSettingsAudioViewModel,
  type SettingsAudioViewModelInterface,
} from './audio/settings_audio_view_model.svelte';
import {
  type AutonomousSettingsViewModelInterface,
  getAutonomousSettingsViewModel,
} from './autonomous/autonomous_settings_view_model.svelte';
import {
  type ConnectionManagerViewModelInterface,
  getConnectionManagerViewModel,
} from './connection/connection_manager_view_model.svelte';
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
  type GameplayViewModelInterface,
  getGameplayViewModel,
} from './gameplay/gameplay_view_model.svelte';
import {
  getSettingsMusicViewModel,
  type SettingsMusicViewModelInterface,
} from './music/settings_music_view_model.svelte';
import {
  getProvidersViewModel,
  type ProvidersViewModelInterface,
} from './providers/providers_view_model.svelte';
import { SETTINGS_SECTIONS, type SettingsSection } from './settings_sections';

// ---------------------------------------------------------------------------
// Types (backward-compatible aliases)
// ---------------------------------------------------------------------------

/** @deprecated — use SettingsSection instead. Kept for backward compat. */
export type SettingsCategory = 'game' | 'ai_engine' | 'agents';

/** @deprecated — use SettingsSection instead. Kept for backward compat. */
export type GameSubTab = 'display' | 'audio' | 'controls' | 'export' | 'music' | 'autonomous';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsViewModelInterface = BaseViewModelInterface & {
  // ── Section registry ──
  readonly allSections: readonly SettingsSection[];
  readonly visibleSections: readonly SettingsSection[];
  readonly activeSectionId: string;

  // ── Progressive disclosure ──
  readonly isAdvanced: boolean;
  readonly canToggleAdvanced: boolean;

  // ── Search ──
  readonly searchQuery: string;

  // ── Capability badges ──
  readonly aiCapabilityBadge: string;
  readonly aiCapabilityBadgeColor: string;

  // ── Sub-ViewModels ──
  readonly gameplayViewModel: GameplayViewModelInterface;
  readonly aiPrivacyViewModel: AIPrivacyViewModelInterface;
  readonly providersViewModel: ProvidersViewModelInterface;
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly musicViewModel: SettingsMusicViewModelInterface;
  readonly autonomousViewModel: AutonomousSettingsViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;
  readonly exportViewModel: ExportViewModelInterface;
  readonly connectionViewModel: ConnectionManagerViewModelInterface;
  readonly agentListViewModel: AgentListViewModelInterface;
  readonly agentEditorViewModel: AgentEditorViewModelInterface;

  // ── Actions ──
  setActiveSection(id: string): void;
  setSearchQuery(query: string): void;
  toggleAdvanced(): void;
  closeSettings(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SettingsViewModelOptions = BaseViewModelOptions & {
  /** Whether this instance is running in the in-game overlay (vs full-page). */
  overlayMode?: boolean;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SettingsViewModel
  extends BaseViewModel<SettingsViewModelOptions>
  implements SettingsViewModelInterface
{
  // ── Section registry ──
  readonly allSections = SETTINGS_SECTIONS;
  activeSectionId = $state<string>(SETTINGS_SECTIONS[0].id);
  isAdvanced = $state<boolean>(false);
  searchQuery = $state<string>('');

  // ── Basic sub-ViewModels (always created) ──
  readonly gameplayViewModel: GameplayViewModelInterface;
  readonly aiPrivacyViewModel: AIPrivacyViewModelInterface;
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;

  // ── Advanced sub-ViewModels (lazily created) ──
  private _providersViewModel: ProvidersViewModelInterface | undefined;
  private _musicViewModel: SettingsMusicViewModelInterface | undefined;
  private _autonomousViewModel: AutonomousSettingsViewModelInterface | undefined;
  private _exportViewModel: ExportViewModelInterface | undefined;
  private _connectionViewModel: ConnectionManagerViewModelInterface | undefined;
  private _agentListViewModel: AgentListViewModelInterface | undefined;
  private _agentEditorViewModel: AgentEditorViewModelInterface | undefined;

  // ── Preview/revert state ──
  private _preEditAudioVolume: number | undefined;

  // ── Search debounce ──
  private _searchTimeout: ReturnType<typeof setTimeout> | undefined;
  private _pendingSearchQuery = $state<string>('');

  // ── Overlay mode ──
  private readonly _overlayMode: boolean;

  // ── Getters ──

  get visibleSections(): readonly SettingsSection[] {
    const filtered = this.allSections.filter((s) => {
      // In basic mode, only show basic sections
      if (!this.isAdvanced && s.category === 'advanced') {
        return false;
      }
      return true;
    });

    // Apply search filter
    if (this.searchQuery.trim().length === 0) {
      return filtered;
    }

    const query = this.searchQuery.toLowerCase().trim();
    return filtered.filter(
      (s) =>
        s.label.toLowerCase().includes(query) ||
        s.keywords.some((kw) => kw.toLowerCase().includes(query)),
    );
  }

  get providersViewModel(): ProvidersViewModelInterface {
    if (!this._providersViewModel) {
      this._providersViewModel = getProvidersViewModel({ className: 'ProvidersViewModel' });
    }
    return this._providersViewModel;
  }

  get musicViewModel(): SettingsMusicViewModelInterface {
    if (!this._musicViewModel) {
      this._musicViewModel = getSettingsMusicViewModel({ className: 'SettingsMusicViewModel' });
    }
    return this._musicViewModel;
  }

  get autonomousViewModel(): AutonomousSettingsViewModelInterface {
    if (!this._autonomousViewModel) {
      this._autonomousViewModel = getAutonomousSettingsViewModel({
        className: 'AutonomousSettingsViewModel',
      });
    }
    return this._autonomousViewModel;
  }

  get exportViewModel(): ExportViewModelInterface {
    if (!this._exportViewModel) {
      this._exportViewModel = getExportViewModel({ className: 'ExportViewModel' });
    }
    return this._exportViewModel;
  }

  get connectionViewModel(): ConnectionManagerViewModelInterface {
    if (!this._connectionViewModel) {
      this._connectionViewModel = getConnectionManagerViewModel({
        className: 'ConnectionManagerViewModel',
      });
    }
    return this._connectionViewModel;
  }

  get agentListViewModel(): AgentListViewModelInterface {
    if (!this._agentListViewModel) {
      this._agentListViewModel = getAgentListViewModel({
        className: 'AgentListViewModel',
        onCreateAgent: () => this.agentEditorViewModel.openCreate(),
        onEditAgent: (agent: CustomAgentDefinition) => this.agentEditorViewModel.openEdit(agent),
      });
    }
    return this._agentListViewModel;
  }

  get agentEditorViewModel(): AgentEditorViewModelInterface {
    if (!this._agentEditorViewModel) {
      this._agentEditorViewModel = getAgentEditorViewModel({
        className: 'AgentEditorViewModel',
      });
    }
    return this._agentEditorViewModel;
  }

  get canToggleAdvanced(): boolean {
    // Always allow toggling — no confirmation needed in this implementation
    // (advanced fields are lazily created and have no dirty state to lose)
    return true;
  }

  get aiCapabilityBadge(): string {
    const status = this.aiPrivacyViewModel.aiConnectionStatus;
    if (status === 'loading') {
      return 'Loading…';
    }
    if (status === 'connected') {
      return 'AI: Connected';
    }
    return 'AI: Not Set Up';
  }

  get aiCapabilityBadgeColor(): string {
    const status = this.aiPrivacyViewModel.aiConnectionStatus;
    if (status === 'loading') {
      return 'badge-ghost';
    }
    if (status === 'connected') {
      return 'badge-success';
    }
    return 'badge-ghost';
  }

  // ── Constructor ──

  constructor(options: SettingsViewModelOptions) {
    super(options);
    this._overlayMode = options.overlayMode ?? false;

    // Always create basic sub-ViewModels
    this.gameplayViewModel = getGameplayViewModel({ className: 'GameplayViewModel' });
    this.aiPrivacyViewModel = getAIPrivacyViewModel({ className: 'AIPrivacyViewModel' });
    this.audioViewModel = getSettingsAudioViewModel({ className: 'SettingsAudioViewModel' });
    this.displayViewModel = getSettingsDisplayViewModel({ className: 'SettingsDisplayViewModel' });
    this.controlsViewModel = getSettingsControlsViewModel({
      className: 'SettingsControlsViewModel',
    });
  }

  override async initialize(): Promise<void> {
    this.debug('initialize', { overlayMode: this._overlayMode });
    // Capture pre-edit state for preview/revert
    this._capturePreEditState();
    await super.initialize();
  }

  // ── Actions ──

  setActiveSection(id: string): void {
    this.activeSectionId = id;
  }

  setSearchQuery(query: string): void {
    // Store incoming query as pending input
    this._pendingSearchQuery = query;

    // Clear and replace existing timeout
    if (this._searchTimeout) {
      clearTimeout(this._searchTimeout);
    }

    // Assign searchQuery only after debounce
    this._searchTimeout = setTimeout(() => {
      this.searchQuery = this._pendingSearchQuery;
    }, 150);
  }

  toggleAdvanced(): void {
    this.isAdvanced = !this.isAdvanced;
    this.debug('toggleAdvanced', { isAdvanced: this.isAdvanced });

    // When disabling Advanced mode, check if current section is advanced
    if (!this.isAdvanced) {
      const currentSection = this.allSections.find((s) => s.id === this.activeSectionId);
      if (currentSection?.category === 'advanced') {
        // Switch to the first basic section
        const firstBasicSection = this.allSections.find((s) => s.category === 'basic');
        if (firstBasicSection) {
          this.activeSectionId = firstBasicSection.id;
        }
      }
    }
  }

  async closeSettings(): Promise<void> {
    this.debug('closeSettings');

    // Revert any unsaved preview changes
    this._revertPreviewChanges();

    await routerService.goBack();
  }

  // ── Preview/revert helpers ──

  private _capturePreEditState(): void {
    this._preEditAudioVolume = this.audioViewModel.masterVolume;
    // Display state capture is deferred to initialize() of displayViewModel
  }

  private _revertPreviewChanges(): void {
    // Audio revert
    if (this._preEditAudioVolume !== undefined) {
      this.audioViewModel.setMasterVolume(this._preEditAudioVolume);
    }
    // Display revert — handled by the displayViewModel itself
  }
}

export const getSettingsViewModel = (
  options: SettingsViewModelOptions,
): SettingsViewModelInterface => SettingsViewModel.create(options);
