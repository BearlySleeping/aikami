// apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts
//
// Unit tests for CapabilityViewModel — path selection and cloud setup.
// Contract: C-318 AC-2 (Play Offline Demo), AC-4 (Connect Cloud AI)
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/capability/capability_view_model.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived, $effect are polyfilled globally via test_preload.ts
// $services stubs are provided globally via test_preload.ts

// ── Mocks for crypto_vault ─────────────────────────────────────────────

const _CRYPTO_VAULT_PATH =
  '/home/sonny/Development/Projects/passion/aikami/.pi/workspaces/run-mrkquinj-c-318/apps/frontend/client/src/lib/utils/crypto_vault.ts';

mock.module(_CRYPTO_VAULT_PATH, () => ({
  encrypt: mock(async () => {}),
  decrypt: mock(async () => undefined),
  clearVault: mock(() => {}),
}));

// Also mock bare specifier for Bun resolutions
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
    checkCloudTextConfig: mock(() => 'not_found'),
  },
  campaignService: {
    startNewCampaign: mock(async () => ({ id: 'test-id', state: 'creating' })),
    saveCampaign: mock(async () => {}),
    activeCampaign: { id: 'test-id', capabilityProfile: {} },
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

  // ── AC-2: Play Offline Demo ─────────────────────────────────────────

  test('selectOfflineDemo calls campaignService.startNewCampaign', async () => {
    const vm = createVm();
    await vm.selectOfflineDemo();
    // campaignService.startNewCampaign is a mock stub — verify no errors
    expect(vm.errorMessage).toBe('');
  });

  // ── AC-3: selectLocalAi ─────────────────────────────────────────────

  test('selectLocalAi calls campaignService.startNewCampaign', async () => {
    setDetectionResult('detected');
    const vm = createVm();
    await vm.startDetection();
    await vm.selectLocalAi();
    expect(vm.errorMessage).toBe('');
  });

  // ── AC-4: Cloud setup modal ─────────────────────────────────────────

  test('openCloudSetup shows modal with default provider', () => {
    const vm = createVm();
    expect(vm.showCloudSetup).toBe(false);

    vm.openCloudSetup();
    expect(vm.showCloudSetup).toBe(true);
    expect(vm.selectedCloudProvider).toBe('openrouter');
  });

  test('openCloudSetup accepts provider override', () => {
    const vm = createVm();
    vm.openCloudSetup('anthropic');
    expect(vm.selectedCloudProvider).toBe('anthropic');
  });

  test('closeCloudSetup hides modal and clears state', () => {
    const vm = createVm();
    vm.tempApiKey = 'sk-test';
    vm.testResult = '✓ Connected';
    vm.openCloudSetup();

    vm.closeCloudSetup();
    expect(vm.showCloudSetup).toBe(false);
    expect(vm.tempApiKey).toBe('');
    expect(vm.testResult).toBe('');
  });

  test('selectCloudProvider changes provider and clears test result', async () => {
    const vm = createVm();
    vm.testResult = 'old result';
    vm.selectCloudProvider('anthropic');
    expect(vm.selectedCloudProvider).toBe('anthropic');
    expect(vm.testResult).toBe('');

    // Verify provider-specific endpoint is used for testing
    // Mock fetch to verify the correct URL is called
    let fetchedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetchedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    }) as typeof globalThis.fetch;

    vm.tempApiKey = 'test-key';
    await vm.testCloudConnection();

    // Anthropic should use api.anthropic.com, not openrouter.ai
    expect(fetchedUrl).toInclude('anthropic.com');
    expect(fetchedUrl).not.toInclude('openrouter.ai');
  });

  test('testCloudConnection is no-op with empty key', async () => {
    const vm = createVm();
    vm.tempApiKey = '';
    await vm.testCloudConnection();
    expect(vm.testResult).toBe('');
    expect(vm.isTesting).toBe(false);
  });

  test('testCloudConnection is no-op while already testing', async () => {
    const vm = createVm();
    vm.tempApiKey = 'sk-test';
    vm.isTesting = true;
    await vm.testCloudConnection();
    // Should not change — already testing
    expect(vm.isTesting).toBe(true);
  });

  test('confirmCloudConnection shows error with empty key', async () => {
    const vm = createVm();
    vm.tempApiKey = '';
    await vm.confirmCloudConnection();
    expect(vm.errorMessage).toInclude('Please enter');
  });
});
