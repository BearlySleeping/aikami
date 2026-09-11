// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.test.ts
//
// Unit tests for SettingsOverlayViewModel — registry-driven section list,
// "Full Settings" navigation, retained-instance caching, and revert-on-close.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.test.ts

import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SettingsSection } from '../../../../settings/settings_sections';
import type { SimpleSectionViewModelMount } from '../../../../settings/settings_sections_composition';
import {
  createSettingsOverlayViewModel,
  type SettingsOverlayViewModelInterface,
} from './settings_overlay_view_model.svelte';

// ── Fixtures ───────────────────────────────────────────────────────────────
// The ViewModel receives its section factory and router/overlay capabilities as
// injected options, so the test supplies fresh fixtures instead of mocking a
// production module.

const _sectionMounts = new Map<string, SimpleSectionViewModelMount>();

const _createSectionMount = mock((sectionId: string): SimpleSectionViewModelMount | undefined => {
  const base = {
    _className: `${sectionId}ViewModel`,
    __mounted: false,
    errorMessage: undefined,
    showLoadingView: false,
    initialize: mock(async () => {}),
    dispose: mock(async () => {}),
  };
  let mount: SimpleSectionViewModelMount | undefined;
  if (sectionId === 'audio') {
    mount = {
      id: 'audio',
      viewModel: {
        ...base,
        masterVolume: 0.8,
        setMasterVolume: mock((_volume: number) => {}),
      },
    } as unknown as SimpleSectionViewModelMount;
  } else if (sectionId === 'controls') {
    mount = { id: 'controls', viewModel: base } as unknown as SimpleSectionViewModelMount;
  } else if (sectionId === 'display') {
    mount = { id: 'display', viewModel: base } as unknown as SimpleSectionViewModelMount;
  } else if (sectionId === 'gameplay') {
    mount = { id: 'gameplay', viewModel: base } as unknown as SimpleSectionViewModelMount;
  }
  if (mount) {
    _sectionMounts.set(sectionId, mount);
  }
  return mount;
});

// ── Helpers ────────────────────────────────────────────────────────────────

type Vm = SettingsOverlayViewModelInterface;
let productionPauseSections: readonly SettingsSection[];
let productionExpectedPauseSections: readonly SettingsSection[];
let goToHref: ReturnType<typeof mock>;
let popOverlay: ReturnType<typeof mock>;

const createVm = (): Vm => {
  goToHref = mock(async () => {});
  popOverlay = mock(() => {});
  return createSettingsOverlayViewModel({
    className: 'SettingsOverlayViewModel',
    createSectionMount: _createSectionMount,
    router: { goToHref },
    overlay: { popOverlay },
  });
};

beforeAll(async () => {
  const productionSettingsSections = await import('../../../../settings/settings_sections');
  productionExpectedPauseSections = productionSettingsSections.SETTINGS_SECTIONS.filter((section) =>
    section.contexts.includes('pause'),
  );
  productionPauseSections = productionSettingsSections.sectionsForContext('pause');
});

beforeEach(() => {
  _sectionMounts.clear();
  _createSectionMount.mockClear();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SettingsOverlayViewModel', () => {
  test('production pause sections match the real registry', () => {
    expect(productionPauseSections).toEqual(productionExpectedPauseSections);
    expect(productionExpectedPauseSections.map((section) => section.id)).toEqual([
      'controls',
      'audio',
      'display',
      'gameplay',
    ]);
  });

  test('AC-1: pauseSections includes all sections flagged with pause context', () => {
    const vm = createVm();

    expect(vm.pauseSections.length).toBeGreaterThanOrEqual(4);
    const ids = vm.pauseSections.map((s) => s.id);
    expect(ids).toContain('controls');
    expect(ids).toContain('audio');
    expect(ids).toContain('display');
    expect(ids).toContain('gameplay');
    // Sections NOT flagged for pause should NOT appear
    expect(ids).not.toContain('ai');
    expect(ids).not.toContain('account');
    expect(ids).not.toContain('export');
  });

  test('AC-1: sections appear in registry order', () => {
    const vm = createVm();
    const ids = vm.pauseSections.map((s) => s.id);
    const controlsIdx = ids.indexOf('controls');
    const audioIdx = ids.indexOf('audio');
    const displayIdx = ids.indexOf('display');
    const gameplayIdx = ids.indexOf('gameplay');
    expect(controlsIdx).toBeLessThan(audioIdx);
    expect(audioIdx).toBeLessThan(displayIdx);
    expect(displayIdx).toBeLessThan(gameplayIdx);
  });

  test('AC-1: activeSectionId defaults to the first pause section', () => {
    const vm = createVm();
    expect(vm.activeSectionId).toBe(vm.pauseSections[0]?.id);
  });

  test('AC-1: setActiveSection switches to a valid section', () => {
    const vm = createVm();
    vm.setActiveSection('gameplay');
    expect(vm.activeSectionId).toBe('gameplay');
  });

  test('AC-1: setActiveSection ignores invalid section ids', () => {
    const vm = createVm();
    const original = vm.activeSectionId;
    vm.setActiveSection('nonexistent');
    expect(vm.activeSectionId).toBe(original);
  });

  test('AC-2: gameplay appears automatically (the concrete bug)', () => {
    const vm = createVm();
    expect(vm.pauseSections.map((s) => s.id)).toContain('gameplay');
  });

  test('AC-2: every pause section has pause context', () => {
    const vm = createVm();
    expect(vm.pauseSections.every((s) => s.contexts.includes('pause'))).toBe(true);
  });

  test('AC-3: audio volume reverts on dispose', async () => {
    const vm = createVm();
    await vm.initialize();
    vm.setActiveSection('audio');

    const audioVm = vm.activeAudioViewModel;
    if (!audioVm) {
      throw new Error('Audio ViewModel was not initialized');
    }
    const originalVolume = audioVm.masterVolume;

    audioVm.setMasterVolume(0.5);
    await vm.dispose();

    expect(audioVm.setMasterVolume).toHaveBeenCalledWith(originalVolume);
  });

  test('dispose does not dispose retained section ViewModels (container owns lifecycle)', async () => {
    const vm = createVm();
    await vm.initialize();
    vm.setActiveSection('controls');

    const controlsVm = vm.activeControlsViewModel;
    await vm.dispose();

    expect(controlsVm?.dispose).not.toHaveBeenCalled();
  });

  test('retains and reuses one section instance across repeated activation', async () => {
    const vm = createVm();
    await vm.initialize();

    vm.setActiveSection('controls');
    const firstAccess = vm.activeControlsViewModel;
    vm.setActiveSection('audio');
    vm.setActiveSection('controls');
    const secondAccess = vm.activeControlsViewModel;

    expect(firstAccess).toBeDefined();
    expect(secondAccess).toBe(firstAccess);
    expect(_createSectionMount.mock.calls.filter(([id]) => id === 'controls')).toHaveLength(1);
  });

  test('active section is created synchronously (no initialize race)', () => {
    const vm = createVm();
    // No initialize() — the typed getter must already expose the retained mount.
    vm.setActiveSection('display');
    expect(vm.activeDisplayViewModel).toBe(_sectionMounts.get('display')?.viewModel);
  });

  test('AC-4: navigateToFullSettings calls goToHref with section/group params', async () => {
    const vm = createVm();
    vm.setActiveSection('controls');
    await vm.navigateToFullSettings();

    expect(goToHref).toHaveBeenCalledTimes(1);
    const href = goToHref.mock.calls[0]?.[0] as string;
    expect(href).toContain('/settings');
    expect(href).toContain('group=play');
    expect(href).toContain('section=controls');
  });

  test('AC-4: navigateToFullSettings from gameplay includes correct params', async () => {
    const vm = createVm();
    vm.setActiveSection('gameplay');
    await vm.navigateToFullSettings();

    const href = goToHref.mock.calls[0]?.[0] as string;
    expect(href).toContain('section=gameplay');
    expect(href).toContain('group=play');
  });

  test('close sets isOpen to false and pops the overlay', () => {
    const vm = createVm();
    expect(vm.isOpen).toBe(true);
    vm.close();
    expect(vm.isOpen).toBe(false);
    expect(popOverlay).toHaveBeenCalledTimes(1);
  });
});
