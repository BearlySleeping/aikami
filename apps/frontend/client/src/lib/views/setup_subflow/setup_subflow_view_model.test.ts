// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.test.ts
//
// Unit tests for SetupSubflowViewModel — entry paths, scoped discovery,
// honest provider labeling, manual configuration fallback, plan
// application gating, navigation/leave(), and stale-operation invalidation.
// Contract: C-483 AC-1..AC-6 — regression fixes for the C-481..C-484 audit.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/setup_subflow/

// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CapabilitySnapshot } from '@aikami/types';
import { localServicesMockBase } from '../../test_preload.ts';

// ── Mocks ──────────────────────────────────────────────────────────────
//
// Spread the shared base and override only what this file needs — see
// localServicesMockBase's doc comment. Replacing the whole `$services`
// barrel here (as this file previously did) leaks a partial mock into
// every other test file that runs in the same `bun test` process,
// including ai_settings_view_model.test.ts (SetupSubflowViewModel now
// composes a real AiSettingsViewModel instance for manual configuration).

const configServiceMock = {
  state: {
    connections: [] as Array<Record<string, unknown>>,
    defaultByCapability: {} as Record<string, string>,
  },
  addConnection: mock(() => 'mock-connection-id'),
  setDefaultConnection: mock(() => {}),
  save: mock(async () => {}),
};

const createDetectedSnapshot = (): CapabilitySnapshot => ({
  isComplete: true,
  textStatus: 'detected',
  textProviderId: 'ollama',
  textModelName: 'llama3.2',
  imageStatus: 'skipped',
  voiceStatus: 'skipped',
  summary: 'Local AI detected',
  detectedAt: new Date().toISOString(),
});

const detectMock = mock(async (): Promise<CapabilitySnapshot> => createDetectedSnapshot());
const startNewCampaignMock = mock(async () => ({ id: 'campaign-1' }));
const goToRouteMock = mock(async () => {});

mock.module('$services', () => ({
  ...localServicesMockBase(),
  configService: configServiceMock,
  capabilityService: { detect: detectMock },
  runtimeConfigService: {
    getTextUrl: mock(() => 'http://localhost:11434'),
    getImageUrl: mock(() => 'http://localhost:8188'),
  },
  campaignService: { startNewCampaign: startNewCampaignMock },
  routerService: { goToRoute: goToRouteMock },
  inventoryService: { reset: mock(() => {}) },
  worldStateService: { reset: mock(() => {}) },
  playerStateService: { reset: mock(() => {}) },
  equipmentService: { reset: mock(() => {}) },
  gameModeService: { reset: mock(() => {}) },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

const { getSetupSubflowViewModel } = await import('./setup_subflow_view_model.svelte');

describe('SetupSubflowViewModel', () => {
  let vm: import('./setup_subflow_view_model.svelte').SetupSubflowViewModelInterface;

  beforeEach(() => {
    configServiceMock.state = { connections: [], defaultByCapability: {} };
    detectMock.mockClear();
    detectMock.mockImplementation(async () => createDetectedSnapshot());
    startNewCampaignMock.mockClear();
    goToRouteMock.mockClear();
    vm = getSetupSubflowViewModel({ className: 'SetupSubflowTest' });
  });

  afterEach(() => {
    vm.dispose();
  });

  // ── Entry path selection ────────────────────────────────────────────────

  test('starts in entry step with null entry path', () => {
    expect(vm.step).toBe('entry');
    expect(vm.entryPath).toBeNull();
    expect(vm.capabilityToggles.length).toBe(3);
  });

  test('selectEntryPath sets entry path and shows toggles for recommended', () => {
    vm.selectEntryPath('recommended');

    expect(vm.entryPath).toBe('recommended');
    expect(vm.step).toBe('results');
  });

  test('selectEntryPath shows toggles for existing', () => {
    vm.selectEntryPath('existing');

    expect(vm.entryPath).toBe('existing');
    expect(vm.step).toBe('results');
  });

  test('selectEntryPath text-only opens manual text setup when nothing is configured', () => {
    vm.selectEntryPath('text-only');

    expect(vm.entryPath).toBe('text-only');
    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('text');
    expect(vm.editorViewModel.isAddProviderOpen).toBeTrue();
  });

  test('selectEntryPath text-only goes straight to ready when text is already usable', () => {
    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key' },
    ];

    vm.selectEntryPath('text-only');

    expect(vm.step).toBe('ready');
  });

  // ── Capability toggles ─────────────────────────────────────────────────

  test('text capability is always required and enabled', () => {
    const textToggle = vm.capabilityToggles.find((t) => t.id === 'text');
    expect(textToggle?.required).toBeTrue();
    expect(textToggle?.enabled).toBeTrue();
  });

  test('image and voice capabilities are optional and disabled by default', () => {
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeFalse();
    expect(vm.capabilityToggles.find((t) => t.id === 'voice')?.enabled).toBeFalse();
  });

  test('toggleCapability enables and disables an optional capability', () => {
    vm.toggleCapability('image');
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeTrue();
    vm.toggleCapability('image');
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeFalse();
  });

  test('toggleCapability does not change required text', () => {
    vm.toggleCapability('text');
    expect(vm.capabilityToggles.find((t) => t.id === 'text')?.enabled).toBeTrue();
  });

  // ── Discovery scoping (Recommended) ─────────────────────────────────────

  test('continueFromResults on recommended only detects enabled capabilities', async () => {
    vm.selectEntryPath('recommended');
    vm.toggleCapability('voice');

    await vm.continueFromResults();

    expect(detectMock).toHaveBeenCalledWith({ capabilities: ['text', 'voice'] });
    expect(vm.step).toBe('plan');
  });

  test('discovered providers use the real detected provider id and label, never a hardcoded engine', async () => {
    detectMock.mockResolvedValueOnce({
      ...createDetectedSnapshot(),
      textProviderId: 'llamacpp',
    });

    vm.selectEntryPath('recommended');
    await vm.continueFromResults();

    const textProvider = vm.discoveredProviders.find((p) => p.capability === 'text');
    expect(textProvider?.provider).toBe('llamacpp');
    expect(textProvider?.label).not.toBe('ComfyUI (local)');
  });

  test('startDiscovery handles errors gracefully', async () => {
    detectMock.mockRejectedValueOnce(new Error('Connection refused'));

    vm.selectEntryPath('recommended');
    await vm.startDiscovery();

    expect(vm.step).toBe('error');
    expect(vm.errorMessage.length).toBeGreaterThan(0);
  });

  test('goBack ignores a discovery result that completes after cancellation', async () => {
    const deferredDetection = Promise.withResolvers<CapabilitySnapshot>();
    detectMock.mockImplementationOnce(async () => deferredDetection.promise);
    vm.selectEntryPath('recommended');

    const discoveryPromise = vm.startDiscovery();
    vm.goBack();
    deferredDetection.resolve(createDetectedSnapshot());
    await discoveryPromise;

    expect(vm.step).toBe('entry');
    expect(vm.isDetecting).toBeFalse();
    expect(vm.snapshot).toBeNull();
    expect(vm.discoveredProviders).toHaveLength(0);
  });

  // ── Connect Existing skips discovery entirely ───────────────────────────

  test('continueFromResults on existing never calls detect and opens manual setup', async () => {
    vm.selectEntryPath('existing');

    await vm.continueFromResults();

    expect(detectMock).not.toHaveBeenCalled();
    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('text');
  });

  test('continueFromResults on existing goes straight to ready when everything enabled is already usable', async () => {
    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key' },
    ];
    vm.selectEntryPath('existing');

    await vm.continueFromResults();

    expect(vm.step).toBe('ready');
  });

  // ── Plan application gating ─────────────────────────────────────────────

  test('applyPlan seeds connections via configService when text was detected', async () => {
    vm.selectEntryPath('recommended');
    await vm.continueFromResults();

    await vm.applyPlan();

    expect(vm.step).toBe('ready');
    expect(configServiceMock.addConnection.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(configServiceMock.save.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('applyPlan opens manual text setup instead of throwing when text was not found', async () => {
    detectMock.mockResolvedValueOnce({
      ...createDetectedSnapshot(),
      textStatus: 'not_found',
      textProviderId: undefined,
      textModelName: undefined,
      summary: 'No text AI detected',
    });
    vm.selectEntryPath('recommended');
    await vm.continueFromResults();

    await vm.applyPlan();

    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('text');
    expect(vm.editorViewModel.isAddProviderOpen).toBeTrue();
  });

  test('canApplyPlan is false without a usable text choice and true once one exists', async () => {
    detectMock.mockResolvedValueOnce({
      ...createDetectedSnapshot(),
      textStatus: 'not_found',
      textProviderId: undefined,
    });
    vm.selectEntryPath('recommended');
    await vm.continueFromResults();
    expect(vm.canApplyPlan).toBeFalse();

    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key' },
    ];
    expect(vm.canApplyPlan).toBeTrue();
  });

  // ── Manual setup flow ────────────────────────────────────────────────────

  test('finishManualSetup advances to ready once text becomes usable', () => {
    vm.selectEntryPath('text-only');
    expect(vm.step).toBe('manual');

    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key' },
    ];
    vm.finishManualSetup();

    expect(vm.step).toBe('ready');
    expect(vm.manualCapability).toBeNull();
  });

  test('finishManualSetup returns to entry for text-only when still unconfigured', () => {
    vm.selectEntryPath('text-only');

    vm.finishManualSetup();

    expect(vm.step).toBe('entry');
  });

  // ── Navigation / leave() ─────────────────────────────────────────────────

  test('leave() from a new-adventure origin resumes campaign creation', async () => {
    const originVm = getSetupSubflowViewModel({
      className: 'SetupSubflowTestOrigin',
      origin: 'new-adventure',
    });

    await originVm.leave();

    expect(startNewCampaignMock).toHaveBeenCalled();
    expect(goToRouteMock).toHaveBeenCalledWith(
      'personaCreate',
      expect.objectContaining({ queryParameters: { onboarding: '1' } }),
    );
    originVm.dispose();
  });

  test('leave() from a settings origin returns to settings without creating a campaign', async () => {
    const originVm = getSetupSubflowViewModel({
      className: 'SetupSubflowTestOrigin',
      origin: 'settings',
    });

    await originVm.leave();

    expect(startNewCampaignMock).not.toHaveBeenCalled();
    expect(goToRouteMock).toHaveBeenCalledWith('settings', expect.anything());
    originVm.dispose();
  });

  test('leave() from a direct origin goes home without creating a campaign', async () => {
    await vm.leave();

    expect(startNewCampaignMock).not.toHaveBeenCalled();
    expect(goToRouteMock).toHaveBeenCalledWith('index', expect.anything());
  });

  test('goBack from results returns to entry', () => {
    vm.selectEntryPath('recommended');
    vm.goBack();
    expect(vm.step).toBe('entry');
    expect(vm.entryPath).toBeNull();
  });

  test('goBack from plan returns to results', async () => {
    vm.selectEntryPath('recommended');
    await vm.continueFromResults();
    expect(vm.step).toBe('plan');

    vm.goBack();
    expect(vm.step).toBe('results');
  });

  test('reset returns to initial state and invalidates in-flight operations', () => {
    vm.selectEntryPath('recommended');
    vm.toggleCapability('image');
    vm.reset();

    expect(vm.step).toBe('entry');
    expect(vm.entryPath).toBeNull();
    expect(vm.errorMessage).toBe('');
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeFalse();
  });

  test('retry after error goes back to plan when snapshot exists', async () => {
    vm.selectEntryPath('recommended');
    await vm.continueFromResults();

    detectMock.mockRejectedValueOnce(new Error('test error'));
    await vm.startDiscovery();
    expect(vm.step).toBe('error');

    vm.retry();
    expect(vm.step).toBe('plan');
  });

  test('errorMessage is cleared on new entry selection', () => {
    vm.selectEntryPath('recommended');
    vm.errorMessage = 'previous error';
    vm.selectEntryPath('existing');

    expect(vm.errorMessage).toBe('');
  });
});
