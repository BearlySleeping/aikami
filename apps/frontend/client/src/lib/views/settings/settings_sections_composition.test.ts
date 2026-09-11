// apps/frontend/client/src/lib/views/settings/settings_sections_composition.test.ts
//
// Production section-factory lookup lives in settings_sections_composition.ts
// (split out of the inert metadata registry). These tests pin its correctness
// — including the prototype-pollution guard on inherited object keys.
//
// The section ViewModel modules are mocked so this test exercises the factory
// lookup without loading the application service graph.

import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { sectionsForContext } from './settings_sections';

const _stubSectionViewModel = (): Record<string, unknown> => ({
  _className: 'SectionViewModel',
  __mounted: false,
  errorMessage: undefined,
  showLoadingView: false,
  initialize: mock(async () => {}),
  dispose: mock(async () => {}),
});

mock.module('./audio/settings_audio_composition.ts', () => ({
  getSettingsAudioViewModel: _stubSectionViewModel,
}));
mock.module('./controls/settings_controls_view_model.svelte', () => ({
  getSettingsControlsViewModel: _stubSectionViewModel,
}));
mock.module('./display/settings_display_view_model.svelte', () => ({
  getSettingsDisplayViewModel: _stubSectionViewModel,
}));
mock.module('./gameplay/gameplay_composition.ts', () => ({
  getGameplayViewModel: _stubSectionViewModel,
}));

type CompositionModule = typeof import('./settings_sections_composition');
let composition: CompositionModule;

beforeAll(async () => {
  composition = await import('./settings_sections_composition');
});

describe('settings_sections metadata', () => {
  test('sectionsForContext("pause") returns the four play sections in registry order', () => {
    expect(sectionsForContext('pause').map((section) => section.id)).toEqual([
      'controls',
      'audio',
      'display',
      'gameplay',
    ]);
  });
});

describe('settings_sections_composition factory lookup', () => {
  test('rejects inherited object keys instead of resolving Object.prototype members', () => {
    expect(composition.hasSectionViewModel('constructor')).toBe(false);
    expect(composition.hasSectionViewModel('toString')).toBe(false);
    expect(composition.createSectionViewModel('constructor')).toBeUndefined();
    expect(composition.createSectionViewModel('toString')).toBeUndefined();
    expect(composition.createSectionViewModelMount('constructor')).toBeUndefined();
  });

  test('resolves registered simple sections', () => {
    expect(composition.hasSectionViewModel('audio')).toBe(true);
    const mount = composition.createSectionViewModelMount('audio');
    expect(mount?.id).toBe('audio');
  });

  test('returns undefined for an unregistered section', () => {
    expect(composition.hasSectionViewModel('export')).toBe(false);
    expect(composition.createSectionViewModelMount('export')).toBeUndefined();
  });
});
