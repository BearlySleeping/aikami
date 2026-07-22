// apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts
//
// Unit tests for CapabilityViewModel — tabs, connection entries, selection, campaign start.
// Contract: C-323 AC-2 (offline demo removed, only local + cloud paths)
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/capability/capability_view_model.test.ts

// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names for module mocking

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('@aikami/utils', () => ({
  AiTextProviderRequiredError: class AiTextProviderRequiredError extends Error {
    readonly code = 'text-provider-required' as const;
    constructor(message?: string) {
      super(message ?? 'A text AI provider is required to start a campaign.');
      this.name = 'AiTextProviderRequiredError';
    }
  },
  isAiTextProviderRequiredError: (error: unknown): boolean =>
    error instanceof Error && error.message.includes('text AI provider'),
}));

mock.module('$views/settings/connection/connection_manager_view_model.svelte', () => ({
  getConnectionManagerViewModel: mock(() => ({
    connections: [],
    defaultConnectionId: undefined,
    isEditorOpen: false,
    providerLabels: {},
    openCreate: mock(() => {}),
    openCreateFor: mock(() => {}),
    cancelEdit: mock(() => {}),
  })),
}));

mock.module('$lib/utils/crypto_vault', () => ({
  encrypt: mock(async () => {}),
  decrypt: mock(async () => undefined),
  clearVault: mock(() => {}),
}));

const _detectResult = {
  isComplete: true,
  textStatus: 'not_found' as string,
  imageStatus: 'not_found' as string,
  voiceStatus: 'detected' as string,
  detectedAt: new Date().toISOString(),
  summary: 'No AI providers detected',
  textProviderId: undefined as string | undefined,
  textModelName: undefined as string | undefined,
};

const _createSvcStub = () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (!(prop in target)) {
        (target as Record<string, unknown>)[prop] = mock(() => {});
      }
      return (target as Record<string, unknown>)[prop];
    },
  };
  return new Proxy({} as Record<string, unknown>, handler) as Record<string, unknown>;
};

mock.module('$services', () => ({
  ..._createSvcStub(),
  capabilityService: {
    detect: mock(async () => ({ ..._detectResult })),
    detectText: mock(async () => _detectResult.textStatus),
    detectImage: mock(async () => _detectResult.imageStatus),
  },
  campaignService: {
    startNewCampaign: mock(async () => ({ id: 'test-id', state: 'creating' })),
    saveCampaign: mock(async () => {}),
    completeSetup: mock(() => {}),
    activeCampaign: { id: 'test-id', capabilityProfile: {} },
  },
  configService: (() => {
    let _nextId = 1;
    const state: {
      connections: Array<{ id: string; provider: string; capability?: string }>;
      defaultConnectionId: null;
      defaultByCapability?: Record<string, string>;
    } = {
      connections: [],
      defaultConnectionId: null,
    };
    return {
      state,
      addConnection: mock((params: { provider: string; capability?: string }) => {
        const id = `conn-${_nextId++}`;
        state.connections.push({
          id,
          provider: params.provider,
          capability: params.capability ?? 'text',
        });
        return id;
      }),
      setDefaultConnection: mock((connectionId: string) => {
        state.defaultByCapability ??= {};
        const conn = state.connections.find((c) => c.id === connectionId);
        if (conn) {
          state.defaultByCapability[conn.capability ?? 'text'] = connectionId;
        }
      }),
      save: mock(async () => {}),
      _resetForTest: () => {
        _nextId = 1;
        state.connections.length = 0;
        delete state.defaultByCapability;
        state.defaultConnectionId = null;
      },
    };
  })(),
  aiSettingsService: {
    textProvider: { apiKey: 'test-key', endpoint: 'http://localhost:11434', model: 'llama3' },
    imageProvider: { apiKey: '', endpoint: '' },
    ttsProvider: { apiKey: '', endpoint: '' },
  },
  routerService: {
    goToRoute: mock(async () => {}),
  },
  IMAGE_PROVIDERS: [
    { id: 'comfyui', label: 'ComfyUI (local)', description: 'Local ComfyUI via Docker' },
    { id: 'webui', label: 'AUTOMATIC1111 WebUI', description: 'Local Stable Diffusion WebUI' },
    { id: 'novelai', label: 'NovelAI', description: 'Cloud-based anime/SD' },
    { id: 'dalle', label: 'DALL·E', description: 'OpenAI DALL·E' },
    { id: 'stability', label: 'Stability AI', description: 'Stability API' },
    { id: 'fal', label: 'fal.ai', description: 'Serverless generative media' },
    { id: 'openai-compat', label: 'OpenAI Compatible', description: 'OpenAI-compatible image API' },
  ],
  VOICE_PROVIDERS: [
    { id: 'kokoro', label: 'Kokoro (local)', description: 'Local Kokoro TTS via Docker' },
    { id: 'elevenlabs', label: 'ElevenLabs', description: 'Cloud-based TTS' },
    { id: 'voicevox', label: 'VOICEVOX', description: 'Local Japanese TTS engine' },
    { id: 'openai', label: 'OpenAI TTS', description: 'OpenAI cloud TTS' },
    { id: 'fish-speech', label: 'Fish Speech', description: 'Open-source TTS' },
  ],
}));

const { getCapabilityViewModel } = await import('./capability_view_model.svelte');
type Vm = ReturnType<typeof getCapabilityViewModel>;

const createVm = (): Vm => {
  return getCapabilityViewModel({ className: 'CapabilityViewModel' });
};

const setDetectionResult = (
  textStatus: string,
  imageStatus = 'not_found',
  voiceStatus = 'not_found',
) => {
  _detectResult.textStatus = textStatus;
  _detectResult.imageStatus = imageStatus;
  _detectResult.voiceStatus = voiceStatus;
  _detectResult.textProviderId = textStatus === 'detected' ? 'ollama' : undefined;
  _detectResult.summary =
    textStatus === 'detected' ? 'Local AI detected' : 'No AI providers detected';
};

describe('CapabilityViewModel', () => {
  beforeEach(async () => {
    setDetectionResult('not_found');
    // Reset config mock state between tests so seed assertions don't leak.
    const { configService } = await import('$services');
    (configService as unknown as { _resetForTest: () => void })._resetForTest();
  });

  afterEach(async () => {
    setDetectionResult('not_found');
    const { configService } = await import('$services');
    (configService as unknown as { _resetForTest: () => void })._resetForTest();
  });

  test('starts with text tab active', () => {
    const vm = createVm();
    expect(vm.activeTab).toBe('text');
  });

  test('setActiveTab switches tabs', () => {
    const vm = createVm();
    vm.setActiveTab('image');
    expect(vm.activeTab).toBe('image');
    vm.setActiveTab('voice');
    expect(vm.activeTab).toBe('voice');
  });

  test('has three tabs: text, image, voice', () => {
    const vm = createVm();
    expect(vm.tabs.length).toBe(3);
    expect(vm.tabs[0].id).toBe('text');
    expect(vm.tabs[1].id).toBe('image');
    expect(vm.tabs[2].id).toBe('voice');
  });

  test('hasTextProvider is false when no text connections', () => {
    const vm = createVm();
    expect(vm.hasTextProvider).toBe(false);
  });

  test('tabs have hasProvider false when no connections', () => {
    const vm = createVm();
    for (const tab of vm.tabs) {
      expect(tab.hasProvider).toBe(false);
    }
  });

  test('connectionEntries returns empty when no connections exist', () => {
    const vm = createVm();
    expect(vm.connectionEntries).toEqual([]);
  });

  test('startCampaign calls campaignService.startNewCampaign', async () => {
    setDetectionResult('detected');
    const vm = createVm();
    await vm.startDetection();

    const { campaignService } = await import('$services');
    const startMock = campaignService.startNewCampaign as ReturnType<typeof mock>;
    startMock.mockClear();

    // With seeding working, hasTextProvider should be true when ollama detected
    await vm.startCampaign();

    expect(startMock).toHaveBeenCalledWith({
      capabilityProfile: {
        textProvider: true,
        imageProvider: false,
        voiceProvider: false,
      },
    });
  });

  test('openCloudSetup shows modal', () => {
    const vm = createVm();
    expect(vm.showCloudSetup).toBe(false);
    vm.openCloudSetup();
    expect(vm.showCloudSetup).toBe(true);
  });

  test('closeCloudSetup hides modal', () => {
    const vm = createVm();
    vm.openCloudSetup();
    expect(vm.showCloudSetup).toBe(true);
    vm.closeCloudSetup();
    expect(vm.showCloudSetup).toBe(false);
  });

  test('startDetection seeds connections and sets hasTextProvider to true', async () => {
    setDetectionResult('detected');
    const vm = createVm();
    await vm.startDetection();

    // After detection with ollama, the seed should have pushed a text connection
    expect(vm.hasTextProvider).toBe(true);
    expect(vm.connectionEntries.length).toBeGreaterThan(0);
    expect(vm.connectionEntries[0].providerLabel).toBe('Ollama (local)');
  });

  test('startDetection with image detected seeds image connection', async () => {
    setDetectionResult('not_found', 'detected');
    const vm = createVm();
    await vm.startDetection();

    vm.setActiveTab('image');
    expect(vm.hasImageProvider).toBe(true);
    expect(vm.connectionEntries.length).toBeGreaterThan(0);
    expect(vm.connectionEntries[0].providerLabel).toBe('ComfyUI (local)');
  });
});
