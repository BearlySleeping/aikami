// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.test.ts
//
// Unit tests for SettingsOverlayViewModel — registry-driven section list,
// "Full Settings" navigation, and revert-on-close (C-466).
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.test.ts

import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SettingsSection } from '../../../../settings/settings_sections';
import type {
  getSettingsOverlayViewModel as getSettingsOverlayViewModelFactory,
  SettingsOverlayViewModelInterface,
} from './settings_overlay_view_model.svelte';

// ── Mocks ──────────────────────────────────────────────────────────────────
// test_preload.ts provides global mocks for @aikami/frontend/services and $services.
// We only mock modules that the overlay ViewModel imports via $lib aliases.

// Mock the settings sections module (used via $lib alias)
const _OVERLAY_SECTIONS = [
  {
    id: 'controls',
    label: 'Controls',
    group: 'play',
    contexts: ['page', 'pause'],
    icon: 'keyboard',
  },
  { id: 'audio', label: 'Audio', group: 'play', contexts: ['page', 'pause'], icon: 'speaker' },
  { id: 'display', label: 'Display', group: 'play', contexts: ['page', 'pause'], icon: 'monitor' },
  { id: 'gameplay', label: 'Gameplay', group: 'play', contexts: ['page', 'pause'], icon: 'cog' },
  { id: 'ai', label: 'AI', group: 'ai', contexts: ['page'], icon: 'cpu' },
  { id: 'account', label: 'Account', group: 'account', contexts: ['page'], icon: 'user' },
  { id: 'export', label: 'Export & Data', group: 'data', contexts: ['page'], icon: 'download' },
];

const _createSectionViewModelMount = mock((sectionId: string) => {
  const baseViewModel = {
    _className: `${sectionId}ViewModel`,
    __mounted: false,
    errorMessage: undefined,
    showLoadingView: false,
    initialize: mock(async () => {}),
    dispose: mock(async () => {}),
  };
  if (sectionId === 'audio') {
    return {
      id: 'audio',
      viewModel: {
        ...baseViewModel,
        masterVolume: 0.8,
        setMasterVolume: mock((_volume: number) => {}),
      },
    };
  }
  return { id: sectionId, viewModel: baseViewModel };
});

const _registerOverlaySettingsSectionsMock = (): void => {
  mock.module('$lib/views/settings/settings_sections', () => ({
    sectionsForContext: (context: string) =>
      _OVERLAY_SECTIONS.filter((section) => section.contexts.includes(context)),
    createSectionViewModelMount: _createSectionViewModelMount,
  }));
};

const _baseSectionViewModel = () => ({
  _className: 'SectionViewModel',
  __mounted: false,
  errorMessage: undefined,
  showLoadingView: false,
  initialize: mock(async () => {}),
  dispose: mock(async () => {}),
});

mock.module('../../../../settings/audio/settings_audio_view_model.svelte', () => ({
  getSettingsAudioViewModel: () => ({
    ..._baseSectionViewModel(),
    masterVolume: 0.8,
    setMasterVolume: mock((_volume: number) => {}),
  }),
}));

mock.module('../../../../settings/controls/settings_controls_view_model.svelte', () => ({
  getSettingsControlsViewModel: _baseSectionViewModel,
}));

mock.module('../../../../settings/display/settings_display_view_model.svelte', () => ({
  getSettingsDisplayViewModel: _baseSectionViewModel,
}));

mock.module('../../../../settings/gameplay/gameplay_view_model.svelte', () => ({
  getGameplayViewModel: _baseSectionViewModel,
}));

// Mock $services to provide gameOverlayService as an object (not a bare mock function)
mock.module('$services', () => ({
  gameOverlayService: {
    popOverlay: mock(() => {}),
  },
}));

// ── Setup: augment global routerService mock ──────────────────────────────
// test_preload provides routerService: {} — add navigation methods here.
const _augmentRouterService = async () => {
  const mod = await import('@aikami/frontend/services');
  const rs = mod.routerService as Record<string, unknown>;
  rs.goToHref = mock(async () => {});
  rs.goBack = mock(async () => {});
  rs.goToRoute = mock(async () => {});
};

// ── Helpers ────────────────────────────────────────────────────────────────

let getSettingsOverlayViewModel: typeof getSettingsOverlayViewModelFactory;
type Vm = SettingsOverlayViewModelInterface;
let productionPauseSections: readonly SettingsSection[];
let productionExpectedPauseSections: readonly SettingsSection[];
let productionInheritedFactoryResults: {
  hasConstructor: boolean;
  hasToString: boolean;
  constructorViewModel: unknown;
  toStringViewModel: unknown;
};

const createVm = (): Vm => getSettingsOverlayViewModel({ className: 'SettingsOverlayViewModel' });

beforeAll(async () => {
  const productionSettingsSections = await import('../../../../settings/settings_sections');
  productionExpectedPauseSections = productionSettingsSections.SETTINGS_SECTIONS.filter((section) =>
    section.contexts.includes('pause'),
  );
  productionPauseSections = productionSettingsSections.sectionsForContext('pause');
  productionInheritedFactoryResults = {
    hasConstructor: productionSettingsSections.hasSectionViewModel('constructor'),
    hasToString: productionSettingsSections.hasSectionViewModel('toString'),
    constructorViewModel: productionSettingsSections.createSectionViewModel('constructor'),
    toStringViewModel: productionSettingsSections.createSectionViewModel('toString'),
  };
});

beforeEach(async () => {
  _registerOverlaySettingsSectionsMock();
  await _augmentRouterService();
  ({ getSettingsOverlayViewModel } = await import('./settings_overlay_view_model.svelte'));
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

  test('production section factories reject inherited object keys', () => {
    expect(productionInheritedFactoryResults.hasConstructor).toBe(false);
    expect(productionInheritedFactoryResults.hasToString).toBe(false);
    expect(productionInheritedFactoryResults.constructorViewModel).toBeUndefined();
    expect(productionInheritedFactoryResults.toStringViewModel).toBeUndefined();
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

  test('AC-1: setActiveSection switches to a valid section', async () => {
    const vm = createVm();
    await vm.setActiveSection('gameplay');
    expect(vm.activeSectionId).toBe('gameplay');
  });

  test('AC-1: setActiveSection ignores invalid section ids', async () => {
    const vm = createVm();
    const original = vm.activeSectionId;
    await vm.setActiveSection('nonexistent');
    expect(vm.activeSectionId).toBe(original);
  });

  test('AC-2: gameplay appears automatically (the concrete bug)', () => {
    // gameplay was the concrete bug — it existed in the registry with
    // contexts: ['page', 'pause'] but never appeared in the old hardcoded TABS.
    // Its presence here proves the fix.
    const vm = createVm();
    const ids = vm.pauseSections.map((s) => s.id);
    expect(ids).toContain('gameplay');
  });

  test('AC-2: every pause section has pause context', () => {
    const vm = createVm();
    expect(vm.pauseSections.every((s) => s.contexts.includes('pause'))).toBe(true);
  });

  test('AC-3: audio volume reverts on dispose', async () => {
    const vm = createVm();
    await vm.initialize();
    await vm.setActiveSection('audio');

    const audioVm = vm.activeAudioViewModel;
    if (!audioVm) {
      throw new Error('Audio ViewModel was not initialized');
    }
    const originalVolume = audioVm.masterVolume;

    // Simulate volume change
    audioVm.setMasterVolume(0.5);

    // Dispose should revert
    await vm.dispose();

    // Verify volume was reverted to the captured pre-open value
    expect(audioVm.setMasterVolume).toHaveBeenCalledWith(originalVolume);
  });

  test('AC-4: navigateToFullSettings calls goToHref with section/group params', async () => {
    const { routerService } = await import('@aikami/frontend/services');
    const goToHrefMock = routerService.goToHref as ReturnType<typeof mock>;
    goToHrefMock.mockClear();

    const vm = createVm();
    await vm.setActiveSection('controls');
    await vm.navigateToFullSettings();

    expect(goToHrefMock).toHaveBeenCalledTimes(1);
    const href = goToHrefMock.mock.calls[0]?.[0] as string;
    expect(href).toContain('/settings');
    expect(href).toContain('group=');
    expect(href).toContain('section=controls');
  });

  test('AC-4: navigateToFullSettings from gameplay includes correct params', async () => {
    const { routerService } = await import('@aikami/frontend/services');
    const goToHrefMock = routerService.goToHref as ReturnType<typeof mock>;
    goToHrefMock.mockClear();

    const vm = createVm();
    await vm.setActiveSection('gameplay');
    await vm.navigateToFullSettings();

    const href = goToHrefMock.mock.calls[0]?.[0] as string;
    expect(href).toContain('section=gameplay');
    expect(href).toContain('group=play');
  });

  test('close sets isOpen to false', () => {
    const vm = createVm();
    expect(vm.isOpen).toBe(true);
    vm.close();
    expect(vm.isOpen).toBe(false);
  });

  test('active section exposes the same initialized ViewModel instance', async () => {
    const vm = createVm();
    await vm.initialize();

    const firstAccess = vm.activeControlsViewModel;
    await vm.setActiveSection('controls');
    const secondAccess = vm.activeControlsViewModel;

    expect(firstAccess).toBeDefined();
    expect(secondAccess).toBe(firstAccess);
  });
});
