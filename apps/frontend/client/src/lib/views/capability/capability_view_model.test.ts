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
  configService: {
    state: {
      connections: [],
      defaultConnectionId: null,
    },
    addConnection: mock(() => 'test-connection-id'),
    setDefaultConnection: mock(() => {}),
    save: mock(async () => {}),
  },
  aiSettingsService: {
    textProvider: { apiKey: 'test-key', endpoint: 'http://localhost:11434', model: 'llama3' },
    imageProvider: { apiKey: '', endpoint: '' },
    ttsProvider: { apiKey: '', endpoint: '' },
  },
  routerService: {
    goToRoute: mock(async () => {}),
  },
}));

const { getCapabilityViewModel } = await import('./capability_view_model.svelte');
type Vm = ReturnType<typeof getCapabilityViewModel>;

const createVm = (): Vm => {
  return getCapabilityViewModel({ className: 'CapabilityViewModel' });
};

const setDetectionResult = (textStatus: string, imageStatus = 'not_found') => {
  _detectResult.textStatus = textStatus;
  _detectResult.imageStatus = imageStatus;
  _detectResult.textProviderId = textStatus === 'detected' ? 'ollama' : undefined;
  _detectResult.summary =
    textStatus === 'detected' ? 'Local AI detected' : 'No AI providers detected';
};

describe('CapabilityViewModel', () => {
  beforeEach(() => {
    setDetectionResult('not_found');
  });

  afterEach(() => {
    setDetectionResult('not_found');
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

    // Note: no text connections in state, so hasTextProvider=false
    // but the mock still fires when startCampaign is called
    await vm.startCampaign();

    // Without text connections, textProvider is false
    expect(startMock).toHaveBeenCalledWith({
      capabilityProfile: {
        textProvider: false,
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
});
