// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.test.ts
//
// Unit tests for SetupSubflowViewModel — entry paths, scoped discovery,
// honest provider labeling, manual configuration fallback, plan
// application gating, navigation/leave(), and stale-operation invalidation.
// Contract: C-483 AC-1..AC-6 — regression fixes for the C-481..C-484 audit.
//
// Run with:
//   bun test --preload ./src/lib/test_setup.ts --tsconfig tsconfig.test.json \
//     src/lib/views/setup_subflow/

// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CapabilitySnapshot, ConnectionCapability } from '@aikami/types';
import { createAiConnectionStatus } from '../settings/ai/ai_connection_status.svelte';
import {
  type AiSettingsViewModelOptions,
  createAiSettingsViewModel,
} from '../settings/ai/ai_settings_view_model.svelte';
import {
  createSetupSubflowViewModel,
  type SetupOrigin,
  type SetupSubflowViewModelInterface,
  type SetupSubflowViewModelOptions,
} from './setup_subflow_view_model.svelte';

// ── Explicit capability doubles ──────────────────────────────────────────
//
// Every dependency is injected, so this suite never mocks the global
// `$services` barrel. The connection editor is composed from the same doubles
// through `createEditor`, which keeps the manual-setup assertions a real
// integration path rather than a stub.

const configServiceMock = {
  state: {
    connections: [] as Array<Record<string, unknown>>,
    defaultByCapability: {} as Record<string, string>,
  },
  load: mock(async () => {}),
  addConnection: mock(() => 'mock-connection-id'),
  setDefaultConnection: mock(() => {}),
  save: mock(async () => {}),
  getProviders: mock((): Array<Record<string, unknown>> => []),
  getAiConnections: mock((): Array<Record<string, unknown>> => []),
  getRoleAssignments: mock((): Record<string, string> => ({})),
  addProvider: mock(() => 'mock-provider-id'),
  updateProvider: mock(() => {}),
  addAiConnection: mock(() => 'mock-ai-connection-id'),
  updateAiConnection: mock(() => {}),
  deleteAiConnection: mock(() => {}),
  setRoleAssignment: mock(() => {}),
  clearRoleAssignment: mock(() => {}),
  getPresets: mock((): Array<Record<string, unknown>> => []),
  // The editor reads the v3 aiConnections/providers pair while the setup flow
  // reads the legacy projection of the same rows. config_service derives one
  // from the other and keeps the ids, so the mock projects them the same way
  // rather than letting the two views disagree.
  getAiConnection: mock((id: string) => {
    const c = configServiceMock.state.connections.find((x) => x.id === id);
    return c
      ? {
          id: c.id as string,
          providerId: `provider-${c.id}`,
          capability: (c.capability ?? 'text') as string,
          label: c.name as string,
          model: (c.model ?? '') as string,
          params: {},
        }
      : undefined;
  }),
  getProvider: mock((providerId: string) => {
    const id = providerId.replace(/^provider-/, '');
    const c = configServiceMock.state.connections.find((x) => x.id === id);
    return c
      ? {
          id: providerId,
          registryId: c.provider as string,
          label: c.provider as string,
          credential: c.apiKey as string | undefined,
          baseUrl: c.baseUrl as string | undefined,
          source: 'stored',
        }
      : undefined;
  }),
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

type DetectOptions = { capabilities: readonly ConnectionCapability[] };

const detectMock = mock(
  async (_options: DetectOptions): Promise<CapabilitySnapshot> => createDetectedSnapshot(),
);
const startNewCampaignMock = mock(async () => ({ id: 'campaign-1' }));
const goToRouteMock = mock(async () => {});
const getVoiceTtsUrlMock = mock((): string | undefined => undefined);
// The flow forks hard on platform: only the desktop shell can discover a
// local runtime, so web skips the entry choice and never scans. Tests default
// to desktop and opt into web explicitly.
const isTauriMock = mock((): boolean => true);

/** Capabilities for the real connection editor the flow mounts for manual setup. */
const editorCapabilities = {
  status: createAiConnectionStatus(),
  config: configServiceMock,
  campaign: { activeCampaign: undefined },
  image: {
    checkpoints: [] as readonly { id: string }[],
    loadCheckpoints: mock(async () => {}),
    generateImage: mock(async () => ({ url: '', isDemo: false })),
  },
  styleProfiles: {
    profiles: [],
    activeProfileId: '',
    activeProfile: undefined,
    setActiveProfile: mock(() => {}),
  },
  tts: {
    status: 'uninitialized',
    errorMessage: null,
    isPlaying: false,
    isSynthesizing: false,
    speak: mock(async () => {}),
    stop: mock(() => {}),
    reset: mock(() => {}),
    initialize: mock(async () => {}),
  },
  voiceModel: {
    state: { status: 'not-downloaded' },
    totalBytes: 0,
    download: mock(async () => ({ status: 'not-downloaded' })),
    cancel: mock(() => {}),
    checkStatus: mock(async () => {}),
  },
  ai: {
    providerModelFetch: {},
    fetchModelsFromProvider: mock(async () => []),
    fetchWithCredentialPolicy: mock(async () => undefined),
    hasVerificationStrategy: mock(() => false),
    resolveChatTestRequest: mock(() => undefined),
    verifyConnection: mock(async () => ({ ok: true, latencyMs: 0 })),
  },
};

const createEditor = () =>
  createAiSettingsViewModel({
    className: 'SetupSubflowEditor',
    ...editorCapabilities,
  } as unknown as AiSettingsViewModelOptions);

const createVm = (options: { className?: string; origin?: SetupOrigin } = {}) =>
  createSetupSubflowViewModel({
    className: options.className ?? 'SetupSubflowTest',
    origin: options.origin,
    config: configServiceMock,
    detection: { detect: detectMock },
    runtimeConfig: {
      getTextUrl: () => 'http://localhost:11434',
      getImageUrl: () => 'http://localhost:8188',
      getVoiceTtsUrl: getVoiceTtsUrlMock,
    },
    campaign: { startNewCampaign: startNewCampaignMock },
    router: { goToRoute: goToRouteMock },
    reset: {
      inventory: { reset: mock(() => {}) },
      worldState: { reset: mock(() => {}) },
      playerState: { reset: mock(() => {}) },
      equipment: { reset: mock(() => {}) },
      gameMode: { reset: mock(() => {}) },
    },
    isDesktop: () => isTauriMock(),
    createEditor,
  } as unknown as SetupSubflowViewModelOptions);

describe('SetupSubflowViewModel', () => {
  let vm: SetupSubflowViewModelInterface;

  beforeEach(() => {
    configServiceMock.state = { connections: [], defaultByCapability: {} };
    detectMock.mockClear();
    detectMock.mockImplementation(async () => createDetectedSnapshot());
    startNewCampaignMock.mockClear();
    goToRouteMock.mockClear();
    configServiceMock.addConnection.mockClear();
    configServiceMock.load.mockClear();
    configServiceMock.load.mockImplementation(async () => {});
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    getVoiceTtsUrlMock.mockReset();
    getVoiceTtsUrlMock.mockReturnValue(undefined);
    vm = createVm({ className: 'SetupSubflowTest' });
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

  test('selectEntryPath recommended scans immediately instead of asking first', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();

    expect(vm.entryPath).toBe('recommended');
    expect(detectMock).toHaveBeenCalled();
    expect(vm.step).toBe('plan');
  });

  test('selectEntryPath existing opens the editor and never scans', () => {
    vm.selectEntryPath('existing');

    expect(vm.entryPath).toBe('existing');
    expect(detectMock).not.toHaveBeenCalled();
    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('text');
  });

  test('selectEntryPath existing lands on review when text is already usable', () => {
    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key' },
    ];

    vm.selectEntryPath('existing');

    expect(vm.step).toBe('plan');
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

  test('toggleCapability cannot enable an optional capability without backing', () => {
    // No connection and nothing detected → the toggle is disabled and the
    // enable is refused, so the state stays off.
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeFalse();
    expect(vm.capabilityRows.find((r) => r.id === 'image')?.disabled).toBeTrue();
    vm.toggleCapability('image');
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeFalse();
  });

  test('toggleCapability enables and disables an optional capability that has backing', () => {
    configServiceMock.state.connections = [
      {
        capability: 'image',
        provider: 'comfyui',
        apiKey: '',
        baseUrl: 'http://x',
        name: 'ComfyUI',
      },
    ];
    expect(vm.capabilityRows.find((r) => r.id === 'image')?.disabled).toBeFalse();
    vm.toggleCapability('image');
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeTrue();
    vm.toggleCapability('image');
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeFalse();
  });

  test('toggleCapability does not change required text', () => {
    vm.toggleCapability('text');
    expect(vm.capabilityToggles.find((t) => t.id === 'text')?.enabled).toBeTrue();
  });

  test('entry selection preserves only optional capabilities with usable connections', () => {
    configServiceMock.state.connections = [
      { capability: 'voice', provider: 'kokoro', apiKey: '', name: 'Kokoro' },
    ];

    vm.selectEntryPath('existing');

    expect(vm.capabilityToggles.find((t) => t.id === 'voice')?.enabled).toBeTrue();
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeFalse();
  });

  test('a stored optional connection is auto-enabled on load', async () => {
    configServiceMock.load.mockImplementation(async () => {
      configServiceMock.state.connections = [
        { id: 'v1', capability: 'voice', provider: 'kokoro', apiKey: '', name: 'Kokoro' },
      ];
    });
    const fresh = createVm({ className: 'SetupSubflowReloadTest' });
    await fresh.initialize();

    expect(fresh.capabilityToggles.find((t) => t.id === 'voice')?.enabled).toBeTrue();
    expect(fresh.capabilityRows.find((r) => r.id === 'voice')?.checked).toBeTrue();
    expect(fresh.capabilityRows.find((r) => r.id === 'voice')?.disabled).toBeFalse();
    await fresh.dispose();
  });

  test('finishManualSetup auto-enables an optional capability once its connection is saved', () => {
    vm.selectEntryPath('existing');
    vm.openManualSetup('voice');
    expect(vm.step).toBe('manual');
    expect(vm.capabilityToggles.find((t) => t.id === 'voice')?.enabled).toBeFalse();

    configServiceMock.state.connections = [
      { capability: 'voice', provider: 'kokoro', apiKey: '', name: 'Kokoro' },
    ];
    vm.finishManualSetup();

    expect(vm.step).toBe('plan');
    expect(vm.capabilityToggles.find((t) => t.id === 'voice')?.enabled).toBeTrue();
  });

  test('removing a connection disables the toggle and prevents re-enabling', async () => {
    configServiceMock.load.mockImplementation(async () => {
      configServiceMock.state.connections = [
        { id: 'v1', capability: 'voice', provider: 'kokoro', apiKey: '', name: 'Kokoro' },
      ];
    });
    const fresh = createVm({ className: 'SetupSubflowReloadTest' });
    await fresh.initialize();
    expect(fresh.capabilityToggles.find((t) => t.id === 'voice')?.enabled).toBeTrue();

    // Remove the connection — the checkbox drops to off and is locked.
    configServiceMock.state.connections = [];
    const voiceRow = fresh.capabilityRows.find((r) => r.id === 'voice');
    expect(voiceRow?.checked).toBeFalse();
    expect(voiceRow?.disabled).toBeTrue();
    fresh.toggleCapability('voice');
    expect(fresh.capabilityToggles.find((t) => t.id === 'voice')?.enabled).toBeFalse();
    await fresh.dispose();
  });

  // ── Discovery scoping (Recommended) ─────────────────────────────────────

  test('recommended initially probes optional capabilities, then rescan honours opt-ins', async () => {
    detectMock.mockImplementation(async ({ capabilities }: DetectOptions) => {
      if (!capabilities.includes('voice')) {
        // A text-only request explicitly skips both optional capabilities.
        return createDetectedSnapshot();
      }
      return {
        ...createDetectedSnapshot(),
        voiceStatus: 'detected',
        voiceProviderId: 'kokoro',
      };
    });
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    expect(detectMock).toHaveBeenCalledWith({ capabilities: ['text', 'image', 'voice'] });
    expect(vm.discoveredProviders.some((provider) => provider.capability === 'voice')).toBeTrue();

    vm.toggleCapability('voice');
    await vm.rescan();

    expect(detectMock).toHaveBeenLastCalledWith({ capabilities: ['text', 'voice'] });
    expect(vm.step).toBe('plan');
  });

  test('discovered providers use the real detected provider id and label, never a hardcoded engine', async () => {
    detectMock.mockResolvedValueOnce({
      ...createDetectedSnapshot(),
      textProviderId: 'llamacpp',
    });

    vm.selectEntryPath('recommended');
    await vm.startDiscovery();

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

  // ── Plan application gating ─────────────────────────────────────────────

  test('applyPlan seeds connections via configService when text was detected', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();

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
    await vm.startDiscovery();

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
    await vm.startDiscovery();
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

  test('finishManualSetup lands on review, never back on the entry choice', () => {
    vm.selectEntryPath('text-only');

    vm.finishManualSetup();

    // Returning to 'entry' here was the loop the user hit: pick a path,
    // fail to configure, land back on the same three buttons with no reason
    // given. Review shows text as unconfigured and says why Continue is off.
    expect(vm.step).toBe('plan');
    expect(vm.canApplyPlan).toBeFalse();
    expect(vm.blockedHint.length).toBeGreaterThan(0);
  });

  test('finishManualSetup on the existing path lands on review, not a dead end', () => {
    vm.selectEntryPath('existing');
    expect(vm.step).toBe('manual');

    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key', name: 'My OpenRouter' },
    ];
    vm.finishManualSetup();

    expect(vm.step).toBe('plan');
    const textRow = vm.capabilityRows.find((r) => r.id === 'text');
    expect(textRow?.configured).toBeTrue();
    expect(textRow?.connectionName).toBe('My OpenRouter');
  });

  test('a configured text provider can still be reopened for editing from review', () => {
    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key' },
    ];
    vm.selectEntryPath('existing');
    expect(vm.step).toBe('plan');

    vm.openManualSetup('text');

    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('text');
  });

  test('Go back from the ready screen returns to the review, not the entry choice', () => {
    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key' },
    ];
    vm.selectEntryPath('text-only');
    expect(vm.step).toBe('ready');

    vm.goBack();

    expect(vm.step).toBe('plan');
    // Going back must not discard what was just configured.
    expect(vm.canApplyPlan).toBeTrue();
  });

  // ── Navigation / leave() ─────────────────────────────────────────────────

  test('leave() from a new-adventure origin resumes campaign creation', async () => {
    const originVm = createVm({
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
    const originVm = createVm({
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

  test('goBack from plan returns to entry', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    expect(vm.step).toBe('plan');

    vm.goBack();
    expect(vm.step).toBe('entry');
    expect(vm.entryPath).toBeNull();
  });

  test('goBack from a manual step opened over a scan returns to review', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    vm.openManualSetup('text');

    vm.goBack();

    expect(vm.step).toBe('plan');
    expect(vm.manualCapability).toBeNull();
  });

  test('reset returns to initial state and invalidates in-flight operations', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    vm.toggleCapability('image');
    vm.reset();

    expect(vm.step).toBe('entry');
    expect(vm.entryPath).toBeNull();
    expect(vm.errorMessage).toBe('');
    expect(vm.capabilityToggles.find((t) => t.id === 'image')?.enabled).toBeFalse();
  });

  test('retry after error goes back to plan when snapshot exists', async () => {
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();

    detectMock.mockRejectedValueOnce(new Error('test error'));
    await vm.startDiscovery();
    expect(vm.step).toBe('error');

    vm.retry();
    expect(vm.step).toBe('plan');
  });

  // ── Optional capabilities must be skippable (CodeRabbit: manual-step trap) ──

  test('declining an optional capability leaves the manual step instead of reopening it', () => {
    configServiceMock.state.connections = [
      { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key' },
    ];
    vm.selectEntryPath('existing');
    vm.toggleCapability('image');
    vm.openManualSetup('image');
    expect(vm.step).toBe('manual');

    // Continue without configuring image: the flow used to re-select the same
    // unconfigured capability and reopen the editor, so only Back escaped.
    vm.finishManualSetup();

    expect(vm.step).toBe('plan');
    expect(vm.manualCapability).toBeNull();
  });

  // ── Seeding an optional capability (CodeRabbit: voice re-seeded forever) ──

  test('a detected Kokoro voice provider with no endpoint is seeded and persisted', async () => {
    detectMock.mockResolvedValueOnce({
      ...createDetectedSnapshot(),
      voiceStatus: 'detected',
      voiceProviderId: 'kokoro',
    });
    getVoiceTtsUrlMock.mockReturnValue(undefined);
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    vm.toggleCapability('voice');

    await vm.applyPlan();

    const voiceWrites = configServiceMock.addConnection.mock.calls.filter(
      ([c]: [{ capability?: string }]) => c.capability === 'voice',
    );
    expect(voiceWrites).toHaveLength(1);
    expect(voiceWrites[0]?.[0].baseUrl).toBe('');
    expect(configServiceMock.save).toHaveBeenCalled();
  });

  test('a detected local voice provider with an endpoint is seeded once and stays usable', async () => {
    detectMock.mockResolvedValue({
      ...createDetectedSnapshot(),
      voiceStatus: 'detected',
      voiceProviderId: 'kokoro',
    });
    getVoiceTtsUrlMock.mockReturnValue('http://localhost:8880');
    vm.selectEntryPath('recommended');
    await vm.startDiscovery();
    vm.toggleCapability('voice');

    await vm.applyPlan();

    const voiceWrites = configServiceMock.addConnection.mock.calls.filter(
      ([c]: [{ capability?: string }]) => c.capability === 'voice',
    );
    expect(voiceWrites).toHaveLength(1);
    expect(voiceWrites[0]?.[0].baseUrl).toBe('http://localhost:8880');

    // Re-applying must not add a duplicate: the seeded row is now usable.
    configServiceMock.state.connections.push({
      capability: 'voice',
      provider: 'kokoro',
      baseUrl: 'http://localhost:8880',
      apiKey: '',
    });
    await vm.applyPlan();

    const afterSecond = configServiceMock.addConnection.mock.calls.filter(
      ([c]: [{ capability?: string }]) => c.capability === 'voice',
    );
    expect(afterSecond).toHaveLength(1);
  });

  // ── Reopening the editor keeps the capability scope (CodeRabbit) ──

  test('reopenManualEditor reuses the scoped setup path for the active capability', () => {
    vm.openManualSetup('voice');

    vm.reopenManualEditor();

    expect(vm.manualCapability).toBe('voice');
    // Voice now opens the connection editor with the local binary default.
    expect(vm.editorViewModel.isEditorOpen).toBeTrue();
    expect(vm.editorViewModel.draft.capability).toBe('voice');
    expect(vm.editorViewModel.draft.registryId).toBe('kokoro');
  });

  test('reopenManualEditor falls back to text when nothing is being configured', () => {
    vm.reopenManualEditor();

    expect(vm.manualCapability).toBe('text');
  });

  test('errorMessage is cleared on new entry selection', () => {
    vm.selectEntryPath('recommended');
    vm.errorMessage = 'previous error';
    vm.selectEntryPath('existing');

    expect(vm.errorMessage).toBe('');
  });
  // ── Stored configuration must survive a refresh ──────────────────────────

  test('initialize reads the stored configuration before deciding what is set up', async () => {
    // A refresh starts from an empty in-memory state; only load() restores it.
    configServiceMock.load.mockImplementation(async () => {
      configServiceMock.state.connections = [
        { id: 'c1', capability: 'text', provider: 'openrouter', apiKey: 'sk-saved', name: 'Saved' },
      ];
    });
    const fresh = createVm({ className: 'SetupSubflowReloadTest' });

    await fresh.initialize();

    expect(configServiceMock.load).toHaveBeenCalled();
    expect(fresh.capabilityRows.find((r) => r.id === 'text')?.configured).toBeTrue();
    expect(fresh.canApplyPlan).toBeTrue();
    await fresh.dispose();
  });

  test('a text-only entry after reload goes straight to ready instead of asking again', async () => {
    configServiceMock.load.mockImplementation(async () => {
      configServiceMock.state.connections = [
        { id: 'c1', capability: 'text', provider: 'openrouter', apiKey: 'sk-saved', name: 'Saved' },
      ];
    });
    const fresh = createVm({ className: 'SetupSubflowReloadTest' });
    await fresh.initialize();

    fresh.selectEntryPath('text-only');

    expect(fresh.step).toBe('ready');
    await fresh.dispose();
  });

  // ── The manual step must show what is already saved ──────────────────────

  test('the manual step lists nothing and offers a blank editor when no connection exists', () => {
    vm.openManualSetup('text');

    expect(vm.hasManualConnections).toBeFalse();
    expect(vm.manualAddButtonLabel).toBe('Open Connection Editor');
  });

  test('a saved connection appears on the manual step instead of vanishing', () => {
    vm.openManualSetup('text');

    configServiceMock.state.connections = [
      {
        id: 'conn-1',
        capability: 'text',
        provider: 'openrouter',
        apiKey: 'sk-real-key',
        name: 'My OpenRouter',
        model: 'anthropic/claude-sonnet',
      },
    ];

    // Saving closes the editor; the step used to show no sign it had worked.
    expect(vm.hasManualConnections).toBeTrue();
    const [row] = vm.manualConnections;
    expect(row?.name).toBe('My OpenRouter');
    expect(row?.detailText).toContain('anthropic/claude-sonnet');
    expect(row?.usable).toBeTrue();
    expect(vm.manualAddButtonLabel).toBe('Add another connection');
    expect(vm.headingTitle).toBe('Your connections');
  });

  test('editConnection opens the editor on the saved row, not a blank draft', () => {
    configServiceMock.state.connections = [
      {
        id: 'conn-1',
        capability: 'text',
        provider: 'openrouter',
        apiKey: 'sk-real-key',
        name: 'My OpenRouter',
        model: 'anthropic/claude-sonnet',
      },
    ];
    vm.openManualSetup('text');

    vm.editConnection('conn-1');

    expect(vm.editorViewModel.isEditorOpen).toBeTrue();
    expect(vm.editorViewModel.draft.isEditing).toBeTrue();
    expect(vm.editorViewModel.draft.editingConnectionId).toBe('conn-1');
  });

  test('an incomplete connection is listed as unusable rather than hidden', () => {
    configServiceMock.state.connections = [
      {
        id: 'conn-2',
        capability: 'text',
        provider: 'ollama',
        name: 'Local',
        model: '',
        baseUrl: '',
      },
    ];
    vm.openManualSetup('text');

    expect(vm.manualConnections[0]?.usable).toBeFalse();
  });

  test('the manual list is scoped to the capability being configured', () => {
    configServiceMock.state.connections = [
      {
        id: 't1',
        capability: 'text',
        provider: 'openrouter',
        apiKey: 'k',
        name: 'Text',
        model: '',
      },
      {
        id: 'v1',
        capability: 'voice',
        provider: 'kokoro',
        baseUrl: 'http://x',
        name: 'Voice',
        model: '',
      },
    ];

    vm.openManualSetup('voice');
    expect(vm.manualConnections.map((c) => c.id)).toEqual(['v1']);

    vm.openManualSetup('text');
    expect(vm.manualConnections.map((c) => c.id)).toEqual(['t1']);
  });

  test('showManualStep opens the connections list without opening the editor', () => {
    vm.showManualStep('text');

    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('text');
    expect(vm.editorViewModel.isEditorOpen).toBeFalse();
  });

  test('reviewCapability opens the editor directly when nothing is configured', () => {
    vm.reviewCapability('text');

    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('text');
    expect(vm.editorViewModel.isEditorOpen).toBeTrue();
  });

  test('reviewCapability shows the connections list when one is already configured', () => {
    configServiceMock.state.connections = [
      {
        id: 't1',
        capability: 'text',
        provider: 'openrouter',
        apiKey: 'k1',
        name: 'Cloud',
        model: '',
      },
    ];

    vm.reviewCapability('text');

    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('text');
    expect(vm.editorViewModel.isEditorOpen).toBeFalse();
  });

  test('reviewCapability opens the editor prefilled with the detected image engine', async () => {
    detectMock.mockResolvedValueOnce({
      ...createDetectedSnapshot(),
      textStatus: 'skipped',
      textProviderId: undefined,
      textModelName: undefined,
      imageStatus: 'detected',
      imageProviderId: 'comfyui',
      summary: 'ComfyUI reachable',
    });

    await vm.reviewCapability('image');

    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('image');
    expect(vm.editorViewModel.isEditorOpen).toBeTrue();
    expect(vm.editorViewModel.draft.capability).toBe('image');
    expect(vm.editorViewModel.draft.registryId).toBe('comfyui');
    expect(vm.editorViewModel.draft.baseUrl).toBe('http://localhost:8188');
    expect(vm.editorViewModel.draft.isEditing).toBeFalse();
  });

  test('reviewCapability prefills the editor with a detected sd-server', async () => {
    detectMock.mockResolvedValueOnce({
      ...createDetectedSnapshot(),
      textStatus: 'skipped',
      textProviderId: undefined,
      textModelName: undefined,
      imageStatus: 'detected',
      imageProviderId: 'sdcpp',
      summary: 'Local image engine reachable (sdcpp)',
    });

    await vm.reviewCapability('image');

    expect(vm.editorViewModel.draft.registryId).toBe('sdcpp');
    expect(vm.editorViewModel.draft.baseUrl).toBe('http://localhost:8188');
    expect(vm.editorViewModel.providerOptions.some((option) => option.id === 'sdcpp')).toBeTrue();
  });

  test('reviewCapability falls back to the editor when no image engine is found', async () => {
    detectMock.mockResolvedValueOnce({
      ...createDetectedSnapshot(),
      textStatus: 'skipped',
      textProviderId: undefined,
      textModelName: undefined,
      imageStatus: 'not_found',
      summary: 'No image engine reachable',
    });

    await vm.reviewCapability('image');

    expect(vm.step).toBe('manual');
    expect(vm.manualCapability).toBe('image');
    expect(vm.editorViewModel.isEditorOpen).toBeTrue();
  });

  test('useConnection marks a saved connection as the default for its capability', () => {
    configServiceMock.state.connections = [
      {
        id: 't1',
        capability: 'text',
        provider: 'openrouter',
        apiKey: 'k1',
        name: 'Cloud',
        model: '',
      },
      {
        id: 't2',
        capability: 'text',
        provider: 'openrouter',
        apiKey: 'k2',
        name: 'Backup',
        model: '',
      },
    ];
    vm.openManualSetup('text');

    vm.useConnection('t2');

    expect(configServiceMock.setDefaultConnection).toHaveBeenCalledWith('t2');
    // The mock's setDefaultConnection is a no-op, so drive the projection here.
    configServiceMock.state.defaultByCapability = { text: 't2' };
    const rows = vm.manualConnections;
    expect(rows.find((r) => r.id === 't2')?.isDefault).toBeTrue();
    expect(rows.find((r) => r.id === 't1')?.isDefault).toBeFalse();
  });

  test('the plan row reports the default connection when several are saved', () => {
    configServiceMock.state.connections = [
      {
        id: 't1',
        capability: 'text',
        provider: 'openrouter',
        apiKey: 'k1',
        name: 'Cloud',
        model: '',
      },
      {
        id: 't2',
        capability: 'text',
        provider: 'openrouter',
        apiKey: 'k2',
        name: 'Backup',
        model: '',
      },
    ];
    configServiceMock.state.defaultByCapability = { text: 't2' };

    expect(vm.requiredRow?.connectionName).toBe('Backup');
  });

  // ── Web has nothing to scan ──────────────────────────────────────────────

  describe('on the web build', () => {
    beforeEach(() => {
      isTauriMock.mockReturnValue(false);
      vm = createVm({ className: 'SetupSubflowWebTest' });
    });

    test('opens on the review screen instead of the entry choice', async () => {
      await vm.initialize();

      // "Find AI for me" has nothing to find in a browser tab, which left the
      // three entry buttons doing the same thing.
      expect(vm.showsEntryChoice).toBeFalse();
      expect(vm.step).toBe('plan');
    });

    test('never offers or runs discovery', async () => {
      await vm.initialize();

      expect(vm.canScan).toBeFalse();

      await vm.rescan();
      await vm.startDiscovery();

      expect(detectMock).not.toHaveBeenCalled();
      expect(vm.step).toBe('plan');
    });

    test('selecting the recommended path does not scan', async () => {
      await vm.initialize();

      vm.selectEntryPath('recommended');

      expect(detectMock).not.toHaveBeenCalled();
    });

    test('offers no Back button out of the only screen', async () => {
      await vm.initialize();

      expect(vm.canGoBackFromPlan).toBeFalse();
    });

    test('reset returns to review, not to a screen the web build never shows', async () => {
      await vm.initialize();

      vm.reset();

      expect(vm.step).toBe('plan');
    });

    test('required text is named as the reason Continue is unavailable', async () => {
      await vm.initialize();

      expect(vm.canApplyPlan).toBeFalse();
      expect(vm.blockedHint).toContain('Text');
      // No scan ran, so the empty-discovery message must not appear either.
      expect(vm.showNoProvidersMessage).toBeFalse();
    });

    test('configuring text through the editor completes setup', async () => {
      await vm.initialize();
      vm.openManualSetup('text');
      expect(vm.step).toBe('manual');

      configServiceMock.state.connections = [
        { capability: 'text', provider: 'openrouter', apiKey: 'sk-real-key', name: 'OpenRouter' },
      ];
      vm.finishManualSetup();

      expect(vm.step).toBe('plan');
      expect(vm.canApplyPlan).toBeTrue();
    });
  });
});
