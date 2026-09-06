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
import { readSearchParam, syncSearchParams } from '$lib/utils/url_search_params';
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
  type AccountViewModelInterface,
  getAccountViewModel,
} from './account/account_view_model.svelte';
import {
  type AiSettingsViewModelInterface,
  getAiSettingsViewModel,
} from './ai/ai_settings_view_model.svelte';
import {
  type CapabilityDetailViewModelInterface,
  getCapabilityDetailViewModel,
} from './ai/capability_detail_view_model.svelte';
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
  type SettingsPlatform,
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

  // ── Search ──
  searchQuery: string;
  readonly filteredSections: readonly (SettingsSection & { groupLabel: string })[];
  readonly isSearching: boolean;
  setSearchQuery(query: string): void;
  clearSearch(): void;

  // ── Platform filtering ──
  readonly platform: SettingsPlatform;

  // ── Capability badges ──
  readonly aiCapabilityBadge: string;
  readonly aiCapabilityBadgeColor: string;

  // ── Sub-ViewModels ──
  readonly accountViewModel: AccountViewModelInterface;
  readonly gameplayViewModel: GameplayViewModelInterface;
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly musicViewModel: SettingsMusicViewModelInterface;
  readonly autonomousViewModel: AutonomousSettingsViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;
  readonly exportViewModel: ExportViewModelInterface;
  readonly aiSettingsViewModel: AiSettingsViewModelInterface;
  readonly storyDialogueViewModel: CapabilityDetailViewModelInterface;
  readonly artworkViewModel: CapabilityDetailViewModelInterface;
  readonly readAloudViewModel: CapabilityDetailViewModelInterface;
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

  // ── Search ──
  searchQuery = $state<string>('');

  // ── Basic sub-ViewModels (always created) ──
  readonly accountViewModel: AccountViewModelInterface;
  readonly gameplayViewModel: GameplayViewModelInterface;
  readonly audioViewModel: SettingsAudioViewModelInterface;
  readonly displayViewModel: SettingsDisplayViewModelInterface;
  readonly controlsViewModel: SettingsControlsViewModelInterface;

  // ── Advanced sub-ViewModels (lazily created) ──
  private _musicViewModel: SettingsMusicViewModelInterface | undefined;
  private _autonomousViewModel: AutonomousSettingsViewModelInterface | undefined;
  private _exportViewModel: ExportViewModelInterface | undefined;
  private _aiSettingsViewModel: AiSettingsViewModelInterface | undefined;
  private _storyDialogueViewModel: CapabilityDetailViewModelInterface | undefined;
  private _artworkViewModel: CapabilityDetailViewModelInterface | undefined;
  private _readAloudViewModel: CapabilityDetailViewModelInterface | undefined;
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

  /** Sections matching the current search query across all groups. */
  get filteredSections(): (SettingsSection & { groupLabel: string })[] {
    const query = this.searchQuery.toLowerCase().trim();
    if (!query) {
      return [];
    }
    const groupMap = new Map(SETTINGS_GROUPS.map((g) => [g.id, g.label]));
    return SETTINGS_SECTIONS.filter((s) => {
      const searchable = [
        s.label.toLowerCase(),
        s.id.toLowerCase(),
        ...(s.searchTags ?? []).map((t) => t.toLowerCase()),
      ];
      return searchable.some((term) => term.includes(query));
    }).map((s) => ({ ...s, groupLabel: groupMap.get(s.group) ?? '' }));
  }

  get isSearching(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  /** Detect platform from user agent. */
  get platform(): SettingsPlatform {
    try {
      if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Tauri')) {
        return 'native';
      }
    } catch {
      // unavailable during tests
    }
    return 'web';
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
  }

  clearSearch(): void {
    this.searchQuery = '';
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

  get aiSettingsViewModel(): AiSettingsViewModelInterface {
    if (!this._aiSettingsViewModel) {
      this._aiSettingsViewModel = getAiSettingsViewModel({
        className: 'AiSettingsViewModel',
      });
    }
    return this._aiSettingsViewModel;
  }

  get storyDialogueViewModel(): CapabilityDetailViewModelInterface {
    if (!this._storyDialogueViewModel) {
      this._storyDialogueViewModel = getCapabilityDetailViewModel({
        className: 'StoryDialogueViewModel',
        capability: 'text',
      });
    }
    return this._storyDialogueViewModel;
  }

  get artworkViewModel(): CapabilityDetailViewModelInterface {
    if (!this._artworkViewModel) {
      this._artworkViewModel = getCapabilityDetailViewModel({
        className: 'ArtworkViewModel',
        capability: 'image',
      });
    }
    return this._artworkViewModel;
  }

  get readAloudViewModel(): CapabilityDetailViewModelInterface {
    if (!this._readAloudViewModel) {
      this._readAloudViewModel = getCapabilityDetailViewModel({
        className: 'ReadAloudViewModel',
        capability: 'voice',
      });
    }
    return this._readAloudViewModel;
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
    const entries = this.aiSettingsViewModel.statusEntries;
    const textEntry = entries.find((e) => e.capability === 'text');
    if (textEntry?.status === 'connected') {
      return 'AI: Connected';
    }
    const anyConnected = entries.some((e) => e.status === 'connected');
    if (anyConnected) {
      return 'AI: Partial';
    }
    return 'AI: Not Set Up';
  }

  get aiCapabilityBadgeColor(): string {
    const entries = this.aiSettingsViewModel.statusEntries;
    const textEntry = entries.find((e) => e.capability === 'text');
    if (textEntry?.status === 'connected') {
      return 'badge-success';
    }
    const anyConnected = entries.some((e) => e.status === 'connected');
    if (anyConnected) {
      return 'badge-warning';
    }
    return 'badge-ghost';
  }

  // ── Constructor ──

  constructor(options: SettingsViewModelOptions) {
    super(options);

    // Always create basic sub-ViewModels
    this.accountViewModel = getAccountViewModel({ className: 'AccountViewModel' });
    this.gameplayViewModel = getGameplayViewModel({ className: 'GameplayViewModel' });
    this.audioViewModel = getSettingsAudioViewModel({ className: 'SettingsAudioViewModel' });
    this.displayViewModel = getSettingsDisplayViewModel({ className: 'SettingsDisplayViewModel' });
    this.controlsViewModel = getSettingsControlsViewModel({
      className: 'SettingsControlsViewModel',
    });
  }

  override async initialize(): Promise<void> {
    this.debug('initialize');
    // Deep-link a settings section via `?section=<id>` (e.g. /settings?section=audio),
    // or a group via `?group=<id>` (e.g. /settings?group=ai). Restored on
    // mount so a refresh lands back on the same tab.
    try {
      const sectionParam = readSearchParam('section');
      const section = SETTINGS_SECTIONS.find((s) => s.id === sectionParam);
      if (section) {
        this.activeSectionId = section.id;
        this.activeGroupId = section.group;
      } else {
        const groupParam = readSearchParam('group');
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
    this._syncActiveTabToUrl();
  }

  setActiveGroup(id: SettingsGroupId): void {
    this.activeGroupId = id;
    const firstSection = this.allSections.find((s) => s.group === id);
    if (firstSection) {
      this.activeSectionId = firstSection.id;
    }
    this._syncActiveTabToUrl();
  }

  /** Mirrors the active section/group onto `?section=`/`?group=` so a refresh restores the tab. */
  private _syncActiveTabToUrl(): void {
    try {
      syncSearchParams({ section: this.activeSectionId, group: this.activeGroupId });
    } catch {
      // location unavailable (tests) — safe to skip.
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
