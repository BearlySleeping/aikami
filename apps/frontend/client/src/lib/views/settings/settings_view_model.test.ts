// apps/frontend/client/src/lib/views/settings/settings_view_model.test.ts
//
// Unit tests for SettingsViewModel — group/section selection and deep links.
// Contract: C-333 grouped shell (feat/settings-shell-groups)
//
// The aggregate ViewModel receives every sub-ViewModel as a construction
// capability, so these tests inject inert stubs and never touch the global
// service registry.

// biome-ignore-all lint/style/useNamingConvention: capability stubs mirror PascalCase ViewModel names

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { BaseViewModelInterface } from '@aikami/frontend/services/base';
import type { AgentEditorViewModelInterface } from '../agent/editor/agent_editor_view_model.svelte';
import type { AgentListViewModelInterface } from '../agent/list/agent_list_view_model.svelte';
import type { AccountViewModelInterface } from './account/account_view_model.svelte';
import type { AiActivityViewModelInterface } from './ai/ai_activity_view_model.svelte';
import type { AiCapabilityBadgeViewModelInterface } from './ai/ai_capability_badge_view_model.svelte';
import { createAiConnectionStatus } from './ai/ai_connection_status.svelte';
import type { CapabilityDetailViewModelInterface } from './ai/capability_detail_view_model.svelte';
import type { SettingsAudioViewModelInterface } from './audio/settings_audio_view_model.svelte';
import type { AutonomousSettingsViewModelInterface } from './autonomous/autonomous_settings_view_model.svelte';
import type { SettingsControlsViewModelInterface } from './controls/settings_controls_view_model.svelte';
import type { SettingsDisplayViewModelInterface } from './display/settings_display_view_model.svelte';
import type { ExportViewModelInterface } from './export/export_view_model.svelte';
import type { GameplayViewModelInterface } from './gameplay/gameplay_view_model.svelte';
import type { SettingsMusicViewModelInterface } from './music/settings_music_view_model.svelte';
import {
  createSettingsViewModel,
  type SettingsViewModelInterface,
  type SettingsViewModelOptions,
} from './settings_view_model.svelte.ts';

/** Inert sub-ViewModel stand-in for capabilities the tests never exercise. */
const subStub = {} as BaseViewModelInterface;

const buildOptions = (
  overrides: Partial<SettingsViewModelOptions> = {},
): SettingsViewModelOptions => ({
  className: 'SettingsViewModel',
  router: { goBack: mock(async () => {}) },
  connectionStatus: createAiConnectionStatus(),
  createAccount: () => subStub as AccountViewModelInterface,
  createGameplay: () => subStub as GameplayViewModelInterface,
  createAudio: () => subStub as SettingsAudioViewModelInterface,
  createDisplay: () => subStub as SettingsDisplayViewModelInterface,
  createControls: () => subStub as SettingsControlsViewModelInterface,
  createMusic: () => subStub as SettingsMusicViewModelInterface,
  createAutonomous: () => subStub as AutonomousSettingsViewModelInterface,
  createExport: () => subStub as ExportViewModelInterface,
  createAiCapabilityBadge: () => subStub as AiCapabilityBadgeViewModelInterface,
  createCapabilityDetail: () => subStub as CapabilityDetailViewModelInterface,
  createAiActivity: () => subStub as AiActivityViewModelInterface,
  createAgentList: () => subStub as AgentListViewModelInterface,
  createAgentEditor: () => subStub as AgentEditorViewModelInterface,
  ...overrides,
});

const createVm = (overrides: Partial<SettingsViewModelOptions> = {}): SettingsViewModelInterface =>
  createSettingsViewModel(buildOptions(overrides));

describe('SettingsViewModel — group/section selection', () => {
  let vm: SettingsViewModelInterface;

  beforeEach(() => {
    vm = createVm();
  });

  test('defaults to the Play group with Controls as the active section', () => {
    expect(vm.activeGroupId).toBe('play');
    expect(vm.activeSectionId).toBe('controls');
  });

  test('visibleGroups lists all five groups in order', () => {
    expect(vm.visibleGroups.map((g) => g.id)).toEqual(['play', 'ai', 'content', 'data', 'account']);
  });

  test('sectionsInActiveGroup only returns sections for the active group', () => {
    expect(vm.sectionsInActiveGroup.map((s) => s.id)).toEqual([
      'controls',
      'audio',
      'display',
      'gameplay',
    ]);
  });

  test('setActiveGroup switches group and activates its first section', () => {
    vm.setActiveGroup('ai');
    expect(vm.activeGroupId).toBe('ai');
    expect(vm.activeSectionId).toBe('story-dialogue');
    expect(vm.sectionsInActiveGroup.length).toBe(4);
    expect(vm.sectionsInActiveGroup[0].id).toBe('story-dialogue');
  });

  test('setActiveSection changes only the section, not the group', () => {
    vm.setActiveGroup('content');
    vm.setActiveSection('music');
    expect(vm.activeGroupId).toBe('content');
    expect(vm.activeSectionId).toBe('music');
  });
});

describe('SettingsViewModel — deep links', () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  const setSearch = (search: string): void => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search },
      writable: true,
      configurable: true,
    });
  };

  test('?section=<id> selects that section and its owning group', async () => {
    setSearch('?section=music');
    const vm = createVm();
    await vm.initialize();
    expect(vm.activeSectionId).toBe('music');
    expect(vm.activeGroupId).toBe('content');
  });

  test('?group=<id> selects that group and its first section', async () => {
    setSearch('?group=data');
    const vm = createVm();
    await vm.initialize();
    expect(vm.activeGroupId).toBe('data');
    expect(vm.activeSectionId).toBe('export');
  });

  test('an unknown ?section= falls back to the default', async () => {
    setSearch('?section=does-not-exist');
    const vm = createVm();
    await vm.initialize();
    expect(vm.activeSectionId).toBe('controls');
    expect(vm.activeGroupId).toBe('play');
  });
});

describe('SettingsViewModel — search', () => {
  let vm: SettingsViewModelInterface;

  beforeEach(() => {
    vm = createVm();
  });

  test('isSearching is false by default', () => {
    expect(vm.isSearching).toBe(false);
  });

  test('setSearchQuery updates searchQuery and isSearching', () => {
    vm.setSearchQuery('audio');
    expect(vm.searchQuery).toBe('audio');
    expect(vm.isSearching).toBe(true);
  });

  test('clearSearch resets the query', () => {
    vm.setSearchQuery('audio');
    vm.clearSearch();
    expect(vm.searchQuery).toBe('');
    expect(vm.isSearching).toBe(false);
  });

  test('filteredSections returns sections matching by label', () => {
    vm.setSearchQuery('audio');
    const results = vm.filteredSections;
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((s) => s.id === 'audio')).toBe(true);
  });

  test('filteredSections returns sections matching by searchTags', () => {
    vm.setSearchQuery('keyboard');
    const results = vm.filteredSections;
    expect(results.some((s) => s.id === 'controls')).toBe(true);
  });

  test('filteredSections returns sections matching by id', () => {
    vm.setSearchQuery('read-aloud');
    const results = vm.filteredSections;
    expect(results.some((s) => s.id === 'read-aloud')).toBe(true);
  });

  test('filteredSections is empty when query is empty', () => {
    expect(vm.filteredSections).toEqual([]);
  });

  test('filteredSections includes groupLabel for each result', () => {
    vm.setSearchQuery('audio');
    const results = vm.filteredSections;
    for (const r of results) {
      expect(r.groupLabel).toBeTruthy();
    }
  });

  test('filteredSections is empty when nothing matches', () => {
    vm.setSearchQuery('xyznonexistent');
    expect(vm.filteredSections).toEqual([]);
  });
});
