// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.test.ts
//
// Unit tests for SettingsOverlayViewModel — registry-driven section list,
// "Full Settings" navigation, and revert-on-close (C-466).
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/game/ui/overlays/settings/settings_overlay_view_model.test.ts

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// ── Mocks ──────────────────────────────────────────────────────────────────
// test_preload.ts provides global mocks for @aikami/frontend/services and $services.
// We only mock modules that the overlay ViewModel imports via $lib aliases.

// Mock the settings sections module (used via $lib alias)
const _PAUSE_SECTIONS = [
  { id: 'controls', label: 'Controls', group: 'play', contexts: ['page', 'pause'], icon: 'keyboard' },
  { id: 'audio', label: 'Audio', group: 'play', contexts: ['page', 'pause'], icon: 'speaker' },
  { id: 'display', label: 'Display', group: 'play', contexts: ['page', 'pause'], icon: 'monitor' },
  { id: 'gameplay', label: 'Gameplay', group: 'play', contexts: ['page', 'pause'], icon: 'cog' },
  { id: 'ai', label: 'AI', group: 'ai', contexts: ['page'], icon: 'cpu' },
  { id: 'account', label: 'Account', group: 'account', contexts: ['page'], icon: 'user' },
  { id: 'export', label: 'Export & Data', group: 'data', contexts: ['page'], icon: 'download' },
];

mock.module('$lib/views/settings/settings_sections', () => ({
  sectionsForContext: (context: string) =>
    _PAUSE_SECTIONS.filter((s) => s.contexts.includes(context)),
  SETTINGS_SECTIONS: _PAUSE_SECTIONS,
  SETTINGS_GROUPS: [
    { id: 'play', label: 'Play' },
    { id: 'ai', label: 'AI' },
  ],
  createSectionViewModel: mock((sectionId: string) => {
    if (sectionId === 'audio') {
      return { masterVolume: 0.8, setMasterVolume: mock((_v: number) => {}) };
    }
    return {};
  }),
  hasSectionViewModel: mock((sectionId: string) =>
    ['audio', 'controls', 'display', 'gameplay'].includes(sectionId),
  ),
}));

// Mock the overlay's ViewModel file imports for section ViewModels
mock.module('$lib/views/settings/audio/settings_audio_view_model.svelte', () => ({
  getSettingsAudioViewModel: mock(() => ({
    masterVolume: 0.8,
    setMasterVolume: mock((_v: number) => {}),
  })),
}));

mock.module('$lib/views/settings/controls/settings_controls_view_model.svelte', () => ({
  getSettingsControlsViewModel: mock(() => ({})),
}));

mock.module('$lib/views/settings/display/settings_display_view_model.svelte', () => ({
  getSettingsDisplayViewModel: mock(() => ({})),
}));

mock.module('$lib/views/settings/gameplay/gameplay_view_model.svelte', () => ({
  getGameplayViewModel: mock(() => ({})),
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

await _augmentRouterService();

// ── Helpers ────────────────────────────────────────────────────────────────

const { getSettingsOverlayViewModel } = await import(
  './settings_overlay_view_model.svelte'
);
type Vm = ReturnType<typeof getSettingsOverlayViewModel>;

const createVm = (): Vm =>
  getSettingsOverlayViewModel({ className: 'SettingsOverlayViewModel' });

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SettingsOverlayViewModel', () => {
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
    // Set active section to audio to trigger lazy creation of audio VM
    vm.setActiveSection('audio');
    // Access activeSectionViewModel to force creation
    const _created = vm.activeSectionViewModel;
    await vm.initialize();

    const audioVm = vm.sectionViewModels.get('audio') as {
      masterVolume: number;
      setMasterVolume: (v: number) => void;
    };
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
    vm.setActiveSection('controls');
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
    vm.setActiveSection('gameplay');
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

  test('sectionViewModels lazily creates VMs on access', () => {
    const vm = createVm();
    const vm1 = vm.activeSectionViewModel;
    expect(vm1).toBeDefined();
    // Access again — should return the same instance (same reference)
    const vm2 = vm.activeSectionViewModel;
    expect(vm1).toBe(vm2);
  });
});
