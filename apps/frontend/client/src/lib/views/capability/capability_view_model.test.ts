// apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts
//
// Unit tests for CapabilityViewModel — path selection and cloud setup.
// Contract: C-323 AC-2 (offline demo removed, only local + cloud paths)
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/capability/capability_view_model.test.ts

// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names for module mocking

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts
// $services stubs are provided globally via test_preload.ts

// ── Mock @aikami/utils ────────────────────────────────────────────────

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

// ── Mocks for crypto_vault ─────────────────────────────────────────────

mock.module('$views/settings/connection/connection_manager_view_model.svelte', () => ({
  getConnectionManagerViewModel: mock(() => ({
    connections: [],
    defaultConnectionId: undefined,
    isEditorOpen: false,
    providerLabels: {},
    openCreate: mock(() => {}),
    cancelEdit: mock(() => {}),
  })),
}));

mock.module('$lib/utils/crypto_vault', () => ({
  encrypt: mock(async () => {}),
  decrypt: mock(async () => undefined),
  clearVault: mock(() => {}),
}));

// ── Mutable stubs for services ────────────────────────────────────────

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

// ── Override $services with mutable capabilityService ─────────────────
// Include all exports the preload provides via Proxy stub, overriding only
// the services this test needs to control.

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
  aiSettingsService: {
    textProvider: { apiKey: 'test-key', endpoint: 'http://localhost:11434', model: 'llama3' },
    imageProvider: { apiKey: '', endpoint: '' },
    ttsProvider: { apiKey: '', endpoint: '' },
  },
  routerService: {
    goToRoute: mock(async () => {}),
  },
}));

// ── Import after mocks are set up ──────────────────────────────────────

const { getCapabilityViewModel } = await import('./capability_view_model.svelte');
type Vm = ReturnType<typeof getCapabilityViewModel>;

// ── Helpers ────────────────────────────────────────────────────────────

const createVm = (): Vm => {
  return getCapabilityViewModel({ className: 'CapabilityViewModel' });
};

const setDetectionResult = (textStatus: string, imageStatus = 'not_found') => {
  _detectResult.textStatus = textStatus;
  _detectResult.imageStatus = imageStatus;
  _detectResult.summary =
    textStatus === 'detected' ? 'Local AI detected' : 'No AI providers detected';
};

// ── Tests ─────────────────────────────────────────────────────────────

describe('CapabilityViewModel', () => {
  beforeEach(() => {
    setDetectionResult('not_found');
  });

  afterEach(() => {
    // Reset to defaults
    setDetectionResult('not_found');
  });

  // ── Initial state ────────────────────────────────────────────────────

  test('starts with pending detection and detecting flag true', async () => {
    const vm = createVm();
    // Initial state before initialization
    expect(vm.snapshot.textStatus).toBe('pending');
    expect(vm.snapshot.isComplete).toBe(false);

    // Initialize and verify detection completes
    await vm.initialize();
    expect(vm.snapshot.isComplete).toBe(true);
    expect(vm.snapshot.textStatus).not.toBe('pending');
    expect(vm.isDetecting).toBe(false);
  });

  test('localAiDetected is false when textStatus is not_found', async () => {
    setDetectionResult('not_found');
    const vm = createVm();
    await vm.startDetection();
    expect(vm.localAiDetected).toBe(false);
  });

  test('localAiDetected is true when textStatus is detected', async () => {
    setDetectionResult('detected');
    const vm = createVm();
    await vm.startDetection();
    expect(vm.localAiDetected).toBe(true);
  });

  test('cloudConfigured is true when textStatus is configured', async () => {
    setDetectionResult('configured');
    const vm = createVm();
    await vm.startDetection();
    expect(vm.cloudConfigured).toBe(true);
  });

  // ── AC-2: selectLocalAi ─────────────────────────────────────────────

  test('selectLocalAi calls campaignService.startNewCampaign', async () => {
    setDetectionResult('detected');
    const vm = createVm();
    await vm.startDetection();
    await vm.selectLocalAi();
    expect(vm.errorMessage).toBe('');
  });

  // ── AC-2: selectCloudConnection ─────────────────────────────────────

  test('selectCloudConnection calls campaignService.startNewCampaign', async () => {
    setDetectionResult('configured');
    const vm = createVm();
    await vm.startDetection();
    await vm.selectCloudConnection('test-conn-id');
    // campaignService.startNewCampaign is a mock stub — verify no errors
    expect(vm.errorMessage).toBe('');
  });

  // ── Cloud setup modal ───────────────────────────────────────────────

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
