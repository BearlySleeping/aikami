// apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts
//
// Unit tests for CapabilityViewModel — tabs, connection entries, selection, campaign start.
// C-466: rebuilt on AiSettingsViewModel; connection manager mock replaced with AI settings mock.
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

// Mock AiSettingsViewModel (C-466 replacement for ConnectionManagerViewModel)
mock.module('$views/settings/ai/ai_settings_view_model.svelte', () => ({
  getAiSettingsViewModel: mock(() => ({
    statusEntries: [],
    providerTree: [],
    isEditorOpen: false,
    isAddProviderOpen: false,
    draft: {
      providerId: undefined,
      registryId: 'openrouter',
      capability: 'text',
      label: '',
      model: '',
      apiKey: '',
      baseUrl: '',
      showApiKey: false,
      isEditing: false,
      editingConnectionId: undefined,
    },
    openAddProvider: mock(() => {}),
    closeAddProvider: mock(() => {}),
    openEditConnection: mock(() => {}),
    cancelEdit: mock(() => {}),
    setDraftField: mock(() => {}),
    setDraftProvider: mock(() => {}),
    saveDraft: mock(() => {}),
    deleteConnection: mock(() => {}),
    testConnection: mock(async () => {}),
    testDraftConnection: mock(async () => {}),
    fetchModels: mock(async () => {}),
    toggleApiKeyVisibility: mock(() => {}),
    resolveKeyConflict: mock(() => {}),
    dismissKeyConflict: mock(() => {}),
    toggleRolesDrawer: mock(() => {}),
    assignRole: mock(() => {}),
    clearRole: mock(() => {}),
    isRolesDrawerOpen: false,
    connectionsWithRoles: [],
    availableRoles: [],
    unassignedConnections: [],
    voiceConnections: [],
    activeVoiceConnectionId: undefined,
    setActiveVoiceConnection: mock(() => {}),
    voiceArchetypes: [],
    setVoiceArchetype: mock(() => {}),
    voiceIdInputLabelFor: mock(() => ''),
    voiceSpeed: 1,
    voicePitch: 0,
    setVoiceSpeed: mock(() => {}),
    setVoicePitch: mock(() => {}),
    commitConfigChanges: mock(() => {}),
    voicePreviewState: { status: 'idle' },
    previewVoiceArchetype: mock(async () => {}),
    showVoiceLocalDownload: false,
    voiceModelState: { status: 'not-downloaded', receivedBytes: 0, totalBytes: 92887435 },
    voiceModelProgress: 0,
    voiceModelSizeLabel: '',
    downloadVoiceModel: mock(async () => {}),
    cancelVoiceModelDownload: mock(() => {}),
    imageConnections: [],
    activeImageConnectionId: undefined,
    setActiveImageConnection: mock(() => {}),
    imageSizePresets: [],
    setImageSizePreset: mock(() => {}),
    imageQualityLevels: [],
    setImageQuality: mock(() => {}),
    isImageAdvancedOpenFor: mock(() => false),
    toggleImageAdvanced: mock(() => {}),
    imageParamsFor: mock(() => ({})),
    setImageParamField: mock(() => {}),
    imageCheckpoints: [],
    setImageCheckpoint: mock(() => {}),
    imageStyleProfiles: [],
    activeStyleProfileId: '',
    setImageStyleProfile: mock(() => {}),
    imagePreviewStateFor: mock(() => ({ status: 'idle' })),
    imagePreviewUrlFor: mock(() => ''),
    imagePreviewErrorFor: mock(() => ''),
    previewImage: mock(async () => {}),
    isGenParamsOpen: false,
    toggleGenParamsDisclosure: mock(() => {}),
    genParamsDisplay: undefined,
    setGenParamField: mock(() => {}),
    genParamPresets: [],
    applyGenPreset: mock(() => {}),
    modelOptions: [],
    isFetchingModels: false,
    fetchModelsError: undefined,
    canFetchModels: false,
    needsApiKey: false,
    needsUrl: false,
    isLocalProvider: false,
    providerOptions: [],
    testResults: {},
    testingIds: new Set(),
    keyConflictPrompt: undefined,
  })),
}));

mock.module('$types', () => ({
  Connection: class {},
  ConnectionCapability: 'text',
  VoiceModelState: class {},
  DEFAULT_IMAGE_OPTIONS: {},
  DEFAULT_VOICE_OPTIONS: {},
}));

mock.module('$lib/views/utils/crypto_vault', () => ({
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
  voiceModelService: {
    state: { status: 'not-downloaded', receivedBytes: 0, totalBytes: 92887435 },
    totalBytes: 92887435,
    download: mock(async () => ({ status: 'ready' })),
    cancel: mock(() => {}),
    checkStatus: mock(async () => ({ status: 'not-downloaded' })),
  },
  runtimeConfigService: {
    getTextUrl: () => undefined,
    getImageUrl: () => undefined,
    getVoiceTtsUrl: () => undefined,
  },
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
      connections: Array<{ id: string; provider: string; capability?: string; apiKey?: string; source?: string }>;
      defaultConnectionId: null;
      defaultByCapability?: Record<string, string>;
    } = {
      connections: [],
      defaultConnectionId: null,
    };
    return {
      state,
      addConnection: mock((params: { provider: string; capability?: string; apiKey?: string }) => {
        const id = `conn-${_nextId++}`;
        state.connections.push({
          id,
          provider: params.provider,
          capability: params.capability ?? 'text',
          apiKey: params.apiKey ?? '',
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

const createVm = (): Vm => getCapabilityViewModel({ className: 'CapabilityViewModel' });

const setDetectionResult = (
  textStatus: string,
  imageStatus = 'not_found',
  voiceStatus = 'not_found',
  textProviderId = 'ollama',
) => {
  _detectResult.textStatus = textStatus;
  _detectResult.imageStatus = imageStatus;
  _detectResult.voiceStatus = voiceStatus;
  _detectResult.textProviderId = textStatus === 'detected' ? textProviderId : undefined;
  _detectResult.summary =
    textStatus === 'detected' ? 'Local AI detected' : 'No AI providers detected';
};

describe('CapabilityViewModel', () => {
  beforeEach(async () => {
    setDetectionResult('not_found');
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

  test('C-417 AC-3: pre-detection snapshot never reports a literal detected status', () => {
    const vm = createVm();
    expect(vm.snapshot.voiceStatus).toBe('pending');
    expect(vm.snapshot.textStatus).toBe('pending');
    expect(vm.snapshot.imageStatus).toBe('pending');
    expect(vm.snapshot.voiceStatus).not.toBe('detected');
  });

  test('C-417 AC-3: no connection is auto-seeded before detection runs', () => {
    const vm = createVm();
    expect(vm.connectionEntries).toEqual([]);
    expect(vm.hasTextProvider).toBe(false);
    expect(vm.hasImageProvider).toBe(false);
    expect(vm.hasVoiceProvider).toBe(false);
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

  test('initialize does NOT auto-run detection (local probes are user-initiated)', async () => {
    const { capabilityService } = await import('$services');
    const detectMock = capabilityService.detect as ReturnType<typeof mock>;
    detectMock.mockClear();

    const vm = createVm();
    await vm.initialize();

    expect(detectMock).not.toHaveBeenCalled();
    expect(vm.isDetecting).toBe(false);
  });

  test('startCampaign calls campaignService.startNewCampaign', async () => {
    setDetectionResult('detected');
    const vm = createVm();
    await vm.startDetection();

    const { campaignService } = await import('$services');
    const startMock = campaignService.startNewCampaign as ReturnType<typeof mock>;
    startMock.mockClear();

    await vm.startCampaign();

    expect(startMock).toHaveBeenCalledWith({
      capabilityProfile: {
        textProvider: true,
        imageProvider: false,
        voiceProvider: false,
      },
    });
  });

  test('startDetection seeds connections and sets hasTextProvider to true', async () => {
    setDetectionResult('detected');
    const vm = createVm();
    await vm.startDetection();

    expect(vm.hasTextProvider).toBe(true);
    expect(vm.connectionEntries.length).toBeGreaterThan(0);
    expect(vm.connectionEntries[0].providerLabel).toBe('Ollama (local)');
  });

  test('startDetection with llamacpp detected seeds a distinct llama.cpp connection, not ollama', async () => {
    setDetectionResult('detected', 'not_found', 'not_found', 'llamacpp');
    const vm = createVm();
    await vm.startDetection();

    expect(vm.hasTextProvider).toBe(true);
    expect(vm.connectionEntries.length).toBeGreaterThan(0);
    expect(vm.connectionEntries[0].providerLabel).toBe('llama.cpp (local)');
    expect(vm.connectionEntries[0].connection.provider).toBe('llamacpp');
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

  // ── C-449 AC-2: Voice/image capability UX differentiation ────────────

  test('showVoiceLocalDownload is true on voice tab when no voice provider configured', () => {
    const vm = createVm();
    vm.setActiveTab('voice');
    expect(vm.showVoiceLocalDownload).toBe(true);
  });

  test('showVoiceLocalDownload is false on non-voice tabs', () => {
    const vm = createVm();
    expect(vm.showVoiceLocalDownload).toBe(false); // text tab
    vm.setActiveTab('image');
    expect(vm.showVoiceLocalDownload).toBe(false); // image tab
  });

  test('showVoiceLocalDownload is false on voice tab when voice provider exists', async () => {
    const { configService } = await import('$services');
    configService.addConnection({
      provider: 'elevenlabs',
      capability: 'voice',
      name: 'ElevenLabs',
      model: '',
      baseUrl: '',
      apiKey: 'test',
    });
    const vm = createVm();
    vm.setActiveTab('voice');
    expect(vm.showVoiceLocalDownload).toBe(false);
  });

  test('voiceModelState and voiceModelSizeLabel surface from voiceModelService', () => {
    const vm = createVm();
    expect(vm.voiceModelSizeLabel).toMatch(/MB/);
    expect(vm.voiceModelState).toBeDefined();
  });

  // ── C-466: AI settings ViewModel integration ─────────────────────────

  test('AC-5: aiSettingsViewModel is available and has the expected interface', () => {
    const vm = createVm();
    expect(vm.aiSettingsViewModel).toBeDefined();
    expect(typeof vm.aiSettingsViewModel.openAddProvider).toBe('function');
    expect(typeof vm.aiSettingsViewModel.saveDraft).toBe('function');
    expect(Array.isArray(vm.aiSettingsViewModel.statusEntries)).toBe(true);
    expect(Array.isArray(vm.aiSettingsViewModel.providerTree)).toBe(true);
  });
});
