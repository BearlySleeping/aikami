// apps/frontend/client/src/lib/views/settings/settings_view_model.test.ts
//
// Unit tests for SettingsViewModel — group/section selection and deep links.
// Contract: C-333 grouped shell (feat/settings-shell-groups)

// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names for module mocking

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SettingsViewModel as SettingsViewModelClass } from './settings_view_model.svelte.ts';

const _stubViewModel = (extra: Record<string, unknown> = {}) => ({
  masterVolume: 1,
  setMasterVolume: () => {},
  aiConnectionStatus: 'not_configured',
  ...extra,
});

mock.module('../agent/editor/agent_editor_view_model.svelte.ts', () => ({
  getAgentEditorViewModel: () => _stubViewModel(),
}));
mock.module('../agent/list/agent_list_view_model.svelte.ts', () => ({
  getAgentListViewModel: () => _stubViewModel(),
}));
mock.module('./audio/settings_audio_view_model.svelte', () => ({
  getSettingsAudioViewModel: () => _stubViewModel(),
}));
mock.module('./autonomous/autonomous_settings_view_model.svelte', () => ({
  getAutonomousSettingsViewModel: () => _stubViewModel(),
}));
mock.module('./connection/connection_manager_view_model.svelte', () => ({
  getConnectionManagerViewModel: () => _stubViewModel(),
}));
mock.module('./controls/settings_controls_view_model.svelte', () => ({
  getSettingsControlsViewModel: () => _stubViewModel(),
}));
mock.module('./display/settings_display_view_model.svelte', () => ({
  getSettingsDisplayViewModel: () => _stubViewModel(),
}));
mock.module('./export/export_view_model.svelte', () => ({
  getExportViewModel: () => _stubViewModel(),
}));
mock.module('./gameplay/gameplay_composition.ts', () => ({
  getGameplayViewModel: () => _stubViewModel(),
}));
mock.module('./music/settings_music_composition.ts', () => ({
  getSettingsMusicViewModel: () => _stubViewModel(),
}));

type SettingsViewModelType = InstanceType<typeof SettingsViewModelClass>;

describe('SettingsViewModel — group/section selection', () => {
  let vm: SettingsViewModelType;

  beforeEach(async () => {
    const { SettingsViewModel } = await import('./settings_view_model.svelte.ts');
    vm = SettingsViewModel.create({ className: 'SettingsViewModel' });
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
    expect(vm.sectionsInActiveGroup.length).toBe(3);
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
  let settingsViewModelClass: typeof SettingsViewModelClass;

  beforeEach(async () => {
    const { SettingsViewModel } = await import('./settings_view_model.svelte.ts');
    settingsViewModelClass = SettingsViewModel;
  });

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
    const vm = settingsViewModelClass.create({ className: 'SettingsViewModel' });
    await vm.initialize();
    expect(vm.activeSectionId).toBe('music');
    expect(vm.activeGroupId).toBe('content');
  });

  test('?group=<id> selects that group and its first section', async () => {
    setSearch('?group=data');
    const vm = settingsViewModelClass.create({ className: 'SettingsViewModel' });
    await vm.initialize();
    expect(vm.activeGroupId).toBe('data');
    expect(vm.activeSectionId).toBe('export');
  });

  test('an unknown ?section= falls back to the default', async () => {
    setSearch('?section=does-not-exist');
    const vm = settingsViewModelClass.create({ className: 'SettingsViewModel' });
    await vm.initialize();
    expect(vm.activeSectionId).toBe('controls');
    expect(vm.activeGroupId).toBe('play');
  });
});

describe('SettingsViewModel — search', () => {
  let vm: SettingsViewModelType;

  beforeEach(async () => {
    const { SettingsViewModel } = await import('./settings_view_model.svelte.ts');
    vm = SettingsViewModel.create({ className: 'SettingsViewModel' });
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
