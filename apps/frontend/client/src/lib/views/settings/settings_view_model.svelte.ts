// apps/frontend/client/src/lib/views/settings/settings_view_model.svelte.ts
//
// ViewModel for the Settings page. Manages the group + section registry,
// per-section reset, and immediate preview/revert for Display and Audio.
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
  type AccountViewModelInterface,
  getAccountViewModel,
} from './account/account_view_model.svelte';
import {
  type GameplayViewModelInterface,
  getGameplayViewModel,
} from './gameplay/gameplay_view_model.svelte';
import {
  getSettingsMusicViewModel,
  type SettingsMusicViewModelInterface,
} from './music/settings_music_view_model.svelte';

import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsGroup,
  type SettingsGroupId,
  type SettingsSection,
} from './settings_sections';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type SettingsViewModelInterface = BaseViewModelInterface & {
  // ── Section registry ──
  readonly allSections: readonly SettingsSection[];
  readonly activeSectionId: string;

  // ── Groups ──
  readonly visibleGroups: readonly SettingsGroup[];
  readonly activeGroupId: SettingsGroupId;
  readonly sectionsInActiveGroup: readonly SettingsSection[];

  // ── Capability badges ──
  readonly aiCapabilityBadge: string;
  readonly aiCapabilityBadgeColor: string;

  // ── Sub-ViewModels ──
  readonly accountViewModel: AccountViewModelInterface;
  readonly gameplayViewModel: GameplayViewModelInterface;
  readonly aiPrivacyViewModel: AIPrivacyViewModelInterface;
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
  setActiveGroup(id: SettingsGroupId): void;
  closeSettings(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Construction options required to instrument the settings page ViewModel. */
export type SettingsViewModelOptions = BaseViewModelOptions;

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
  activeGroupId = $state<SettingsGroupId>(SETTINGS_SECTIONS[0].group);

  // ── Basic sub-ViewModels (always created) ──
  readonly accountViewModel: AccountViewModelInterface;
  readonly gameplayViewModel: GameplayViewModelInterface;
  readonly aiPrivacyViewModel: AIPrivacyViewModelInterface;
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;

  // ── Advanced sub-ViewModels (lazily created) ──
  private _musicViewModel: SettingsMusicViewModelInterface | undefined;
  private _autonomousViewModel: AutonomousSettingsViewModelInterface | undefined;
  private _exportViewModel: ExportViewModelInterface | undefined;
  private _connectionViewModel: ConnectionManagerViewModelInterface | undefined;
  private _agentListViewModel: AgentListViewModelInterface | undefined;
  private _agentEditorViewModel: AgentEditorViewModelInterface | undefined;

  // ── Preview/revert state ──
  private _preEditAudioVolume: number | undefined;

  // ── Getters ──

  get visibleGroups(): readonly SettingsGroup[] {
    return SETTINGS_GROUPS;
  }

  get sectionsInActiveGroup(): readonly SettingsSection[] {
    return this.allSections.filter((s) => s.group === this.activeGroupId);
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

    // Always create basic sub-ViewModels
    this.accountViewModel = getAccountViewModel({ className: 'AccountViewModel' });
    this.gameplayViewModel = getGameplayViewModel({ className: 'GameplayViewModel' });
    this.aiPrivacyViewModel = getAIPrivacyViewModel({ className: 'AIPrivacyViewModel' });
    this.audioViewModel = getSettingsAudioViewModel({ className: 'SettingsAudioViewModel' });
    this.displayViewModel = getSettingsDisplayViewModel({ className: 'SettingsDisplayViewModel' });
    this.controlsViewModel = getSettingsControlsViewModel({
      className: 'SettingsControlsViewModel',
    });
  }

  override async initialize(): Promise<void> {
    this.debug('initialize');
    // Deep-link a settings section via `?section=<id>` (e.g. /settings?section=audio),
    // or a group via `?group=<id>` (e.g. /settings?group=ai).
    try {
      const params = new URLSearchParams(window.location.search);
      const sectionParam = params.get('section');
      const section = SETTINGS_SECTIONS.find((s) => s.id === sectionParam);
      if (section) {
        this.activeSectionId = section.id;
        this.activeGroupId = section.group;
      } else {
        const groupParam = params.get('group');
        if (groupParam && SETTINGS_GROUPS.some((g) => g.id === groupParam)) {
          this.setActiveGroup(groupParam as SettingsGroupId);
        }
      }
    } catch {
      // location unavailable (tests) — keep the default section/group.
    }
    // Capture pre-edit state for preview/revert
    this._capturePreEditState();
    await super.initialize();
  }

  // ── Actions ──

  setActiveSection(id: string): void {
    this.activeSectionId = id;
  }

  setActiveGroup(id: SettingsGroupId): void {
    this.activeGroupId = id;
    const firstSection = this.allSections.find((s) => s.group === id);
    if (firstSection) {
      this.activeSectionId = firstSection.id;
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
