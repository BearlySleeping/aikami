// apps/frontend/client/src/lib/views/settings/settings_view_model.svelte.ts
//
// ViewModel for the Settings page. Manages the group + section registry,
// per-section reset, and immediate preview/revert for Display and Audio.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { readSearchParam, syncSearchParams } from '$lib/utils/url_search_params';
import type { ConnectionCapability, CustomAgentDefinition } from '$types';
import type { AgentEditorViewModelInterface } from '../agent/editor/agent_editor_view_model.svelte';
import type { AgentListViewModelInterface } from '../agent/list/agent_list_view_model.svelte';
import type { AccountViewModelInterface } from './account/account_view_model.svelte';
import type { AiCapabilityBadgeViewModelInterface } from './ai/ai_capability_badge_view_model.svelte';
import type { CapabilityDetailViewModelInterface } from './ai/capability_detail_view_model.svelte';
import type { SettingsAudioViewModelInterface } from './audio/settings_audio_view_model.svelte';
import type { AutonomousSettingsViewModelInterface } from './autonomous/autonomous_settings_view_model.svelte';
import type { SettingsControlsViewModelInterface } from './controls/settings_controls_view_model.svelte';
import type { SettingsDisplayViewModelInterface } from './display/settings_display_view_model.svelte';
import type { ExportViewModelInterface } from './export/export_view_model.svelte';
import type { GameplayViewModelInterface } from './gameplay/gameplay_view_model.svelte';
import type { SettingsMusicViewModelInterface } from './music/settings_music_view_model.svelte';

import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsGroup,
  type SettingsGroupId,
  type SettingsPlatform,
  type SettingsSection,
} from './settings_sections';

// ---------------------------------------------------------------------------
// Capability contracts
// ---------------------------------------------------------------------------

/** Router capability used when closing the settings page. */
export type SettingsRouterCapabilities = {
  goBack(): Promise<void>;
};

/** Callbacks the agent list uses to open the shared agent editor. */
export type SettingsAgentListCallbacks = {
  onCreateAgent: () => void;
  onEditAgent: (agent: CustomAgentDefinition) => void;
};

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
  readonly searchQuery: string;
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

/**
 * Construction options required to instrument the settings page ViewModel.
 *
 * Every sub-ViewModel is supplied as an explicit construction capability, so
 * this module never imports a sibling factory or a production singleton.
 * Production wiring lives in ./settings_composition.ts.
 */
export type SettingsViewModelOptions = BaseViewModelOptions & {
  /** Router capability. */
  router: SettingsRouterCapabilities;
  createAccount: (options: BaseViewModelOptions) => AccountViewModelInterface;
  createGameplay: (options: BaseViewModelOptions) => GameplayViewModelInterface;
  createAudio: (options: BaseViewModelOptions) => SettingsAudioViewModelInterface;
  createDisplay: (options: BaseViewModelOptions) => SettingsDisplayViewModelInterface;
  createControls: (options: BaseViewModelOptions) => SettingsControlsViewModelInterface;
  createMusic: (options: BaseViewModelOptions) => SettingsMusicViewModelInterface;
  createAutonomous: (options: BaseViewModelOptions) => AutonomousSettingsViewModelInterface;
  createExport: (options: BaseViewModelOptions) => ExportViewModelInterface;
  createAiCapabilityBadge: (options: BaseViewModelOptions) => AiCapabilityBadgeViewModelInterface;
  createCapabilityDetail: (options: {
    className: string;
    capability: ConnectionCapability;
  }) => CapabilityDetailViewModelInterface;
  createAgentList: (
    options: BaseViewModelOptions & SettingsAgentListCallbacks,
  ) => AgentListViewModelInterface;
  createAgentEditor: (options: BaseViewModelOptions) => AgentEditorViewModelInterface;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SettingsViewModel
  extends BaseViewModel<SettingsViewModelOptions>
  implements SettingsViewModelInterface
{
  // ── Advanced sub-ViewModels (lazily created) ──
  private _musicViewModel: SettingsMusicViewModelInterface | undefined;
  private _autonomousViewModel: AutonomousSettingsViewModelInterface | undefined;
  private _exportViewModel: ExportViewModelInterface | undefined;
  private _aiCapabilityBadgeViewModel: AiCapabilityBadgeViewModelInterface | undefined;
  private _storyDialogueViewModel: CapabilityDetailViewModelInterface | undefined;
  private _artworkViewModel: CapabilityDetailViewModelInterface | undefined;
  private _readAloudViewModel: CapabilityDetailViewModelInterface | undefined;
  private _agentListViewModel: AgentListViewModelInterface | undefined;
  private _agentEditorViewModel: AgentEditorViewModelInterface | undefined;

  // ── Injected construction capabilities ──
  private readonly _router: SettingsRouterCapabilities;
  private readonly _createAccount: (options: BaseViewModelOptions) => AccountViewModelInterface;
  private readonly _createGameplay: (options: BaseViewModelOptions) => GameplayViewModelInterface;
  private readonly _createAudio: (options: BaseViewModelOptions) => SettingsAudioViewModelInterface;
  private readonly _createDisplay: (
    options: BaseViewModelOptions,
  ) => SettingsDisplayViewModelInterface;
  private readonly _createControls: (
    options: BaseViewModelOptions,
  ) => SettingsControlsViewModelInterface;
  private readonly _createMusic: (options: BaseViewModelOptions) => SettingsMusicViewModelInterface;
  private readonly _createAutonomous: (
    options: BaseViewModelOptions,
  ) => AutonomousSettingsViewModelInterface;
  private readonly _createExport: (options: BaseViewModelOptions) => ExportViewModelInterface;
  private readonly _createAiCapabilityBadge: (
    options: BaseViewModelOptions,
  ) => AiCapabilityBadgeViewModelInterface;
  private readonly _createCapabilityDetail: (options: {
    className: string;
    capability: ConnectionCapability;
  }) => CapabilityDetailViewModelInterface;
  private readonly _createAgentList: (
    options: BaseViewModelOptions & SettingsAgentListCallbacks,
  ) => AgentListViewModelInterface;
  private readonly _createAgentEditor: (
    options: BaseViewModelOptions,
  ) => AgentEditorViewModelInterface;

  // ── Preview/revert state ──
  private _preEditAudioVolume: number | undefined;

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
      this._musicViewModel = this._createMusic({ className: 'SettingsMusicViewModel' });
    }
    return this._musicViewModel;
  }

  get autonomousViewModel(): AutonomousSettingsViewModelInterface {
    if (!this._autonomousViewModel) {
      this._autonomousViewModel = this._createAutonomous({
        className: 'AutonomousSettingsViewModel',
      });
    }
    return this._autonomousViewModel;
  }

  get exportViewModel(): ExportViewModelInterface {
    if (!this._exportViewModel) {
      this._exportViewModel = this._createExport({ className: 'ExportViewModel' });
    }
    return this._exportViewModel;
  }

  /**
   * Lightweight badge ViewModel. Critically, rendering the header does NOT
   * construct the full AI settings editor — it reads the shared connection
   * status store through this capability instead.
   */
  private _getAiCapabilityBadgeViewModel(): AiCapabilityBadgeViewModelInterface {
    if (!this._aiCapabilityBadgeViewModel) {
      this._aiCapabilityBadgeViewModel = this._createAiCapabilityBadge({
        className: 'AiCapabilityBadgeViewModel',
      });
    }
    return this._aiCapabilityBadgeViewModel;
  }

  get storyDialogueViewModel(): CapabilityDetailViewModelInterface {
    if (!this._storyDialogueViewModel) {
      this._storyDialogueViewModel = this._createCapabilityDetail({
        className: 'StoryDialogueViewModel',
        capability: 'text',
      });
    }
    return this._storyDialogueViewModel;
  }

  get artworkViewModel(): CapabilityDetailViewModelInterface {
    if (!this._artworkViewModel) {
      this._artworkViewModel = this._createCapabilityDetail({
        className: 'ArtworkViewModel',
        capability: 'image',
      });
    }
    return this._artworkViewModel;
  }

  get readAloudViewModel(): CapabilityDetailViewModelInterface {
    if (!this._readAloudViewModel) {
      this._readAloudViewModel = this._createCapabilityDetail({
        className: 'ReadAloudViewModel',
        capability: 'voice',
      });
    }
    return this._readAloudViewModel;
  }

  get agentListViewModel(): AgentListViewModelInterface {
    if (!this._agentListViewModel) {
      this._agentListViewModel = this._createAgentList({
        className: 'AgentListViewModel',
        onCreateAgent: () => this.agentEditorViewModel.openCreate(),
        onEditAgent: (agent: CustomAgentDefinition) => this.agentEditorViewModel.openEdit(agent),
      });
    }
    return this._agentListViewModel;
  }

  get agentEditorViewModel(): AgentEditorViewModelInterface {
    if (!this._agentEditorViewModel) {
      this._agentEditorViewModel = this._createAgentEditor({
        className: 'AgentEditorViewModel',
      });
    }
    return this._agentEditorViewModel;
  }

  get aiCapabilityBadge(): string {
    return this._getAiCapabilityBadgeViewModel().label;
  }

  get aiCapabilityBadgeColor(): string {
    return this._getAiCapabilityBadgeViewModel().color;
  }

  // ── Constructor ──

  constructor(options: SettingsViewModelOptions) {
    super(options);

    this._router = options.router;
    this._createAccount = options.createAccount;
    this._createGameplay = options.createGameplay;
    this._createAudio = options.createAudio;
    this._createDisplay = options.createDisplay;
    this._createControls = options.createControls;
    this._createMusic = options.createMusic;
    this._createAutonomous = options.createAutonomous;
    this._createExport = options.createExport;
    this._createAiCapabilityBadge = options.createAiCapabilityBadge;
    this._createCapabilityDetail = options.createCapabilityDetail;
    this._createAgentList = options.createAgentList;
    this._createAgentEditor = options.createAgentEditor;

    // Always create basic sub-ViewModels
    this.accountViewModel = this._createAccount({ className: 'AccountViewModel' });
    this.gameplayViewModel = this._createGameplay({ className: 'GameplayViewModel' });
    this.audioViewModel = this._createAudio({ className: 'SettingsAudioViewModel' });
    this.displayViewModel = this._createDisplay({ className: 'SettingsDisplayViewModel' });
    this.controlsViewModel = this._createControls({
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

  /** Mirrors the active section/group onto `?section=`/`?group=` so a refresh (or a
   *  later deep link) restores the same tab. Uses history.replaceState — no reload. */
  private _syncActiveTabToUrl(): void {
    try {
      syncSearchParams({ section: this.activeSectionId, group: this.activeGroupId });
    } catch {
      // location/history unavailable (tests) — safe to skip.
    }
  }

  async closeSettings(): Promise<void> {
    this.debug('closeSettings');

    // Revert any unsaved preview changes
    this._revertPreviewChanges();

    await this._router.goBack();
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

/**
 * Builds the settings ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getSettingsViewModel` in ./settings_composition.ts.
 */
export const createSettingsViewModel = (
  options: SettingsViewModelOptions,
): SettingsViewModelInterface => SettingsViewModel.create(options);
