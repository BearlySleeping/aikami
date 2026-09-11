// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.test.ts
//
// C-465 AC-1/2/3/4/5/6/7/8: AI Settings section tests.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { BUILT_IN_PRESETS } from '@aikami/constants';
import { createDeferred } from '@aikami/utils';
import type { ConnectionTestResult } from '$types';
import { aiConnectionStatus } from './ai_connection_status.svelte';

// Mock configService with a controlled test state
const mockProviders: Array<{
  id: string;
  registryId: string;
  label: string;
  credential?: string;
  source: string;
}> = [];
const mockAiConnections: Array<{
  id: string;
  providerId: string;
  capability: string;
  label: string;
  model: string;
  params: Record<string, unknown>;
}> = [];
const mockRoleAssignments: Record<string, string> = {};
const mockDefaultByCapability: Record<string, string> = {};
let nextId = 1;
const mockFetchModelsFromProvider = mock(
  async (): Promise<Array<{ id: string; name: string }>> => [],
);
const mockVerifyConnection = mock(async () => ({ ok: true, latencyMs: 42 }));
// Defaults to false so the save-verification gate stays out of the way of
// tests about other behaviour; the gate's own suite flips it on.
const mockHasVerificationStrategy = mock(() => false);
const mockProviderModelFetch: Record<string, unknown> = {
  openrouter: {
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
    chatBaseUrl: 'https://openrouter.ai/api/v1',
    url: 'https://openrouter.ai/api/v1/models',
    parseResponse: (_json: unknown) => [],
  },
};
// Mirrors the real resolveChatTestRequest for the mocked registry, so
// testDraftModel exercises the same URL/body shape without importing real
// provider modules (which need build aliases unavailable under bun test).
const mockResolveChatTestRequest = mock(
  ({
    model,
    registryId,
    apiKey,
  }: {
    model: string;
    registryId: string;
    apiKey?: string;
  }): { url: string; headers: Record<string, string>; body: string } | undefined => {
    const config = mockProviderModelFetch[registryId] as { chatBaseUrl?: string } | undefined;
    if (!config?.chatBaseUrl) {
      return undefined;
    }
    return {
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
        max_tokens: 5,
      }),
      // biome-ignore lint/style/useNamingConvention: HTTP Authorization header name
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      url: `${config.chatBaseUrl}/chat/completions`,
    };
  },
);
const mockFetchWithCredentialPolicy = mock(async () => new Response('{}', { status: 200 }));

const mockConfigService = {
  isLoaded: true,
  state: {
    voice: { voiceArchetypes: [] },
    providers: mockProviders,
    aiConnections: mockAiConnections,
    roles: mockRoleAssignments,
    defaultByCapability: mockDefaultByCapability,
  },
  load: mock(async () => {}),
  save: mock(async () => {}),
  getProviders: mock(() => [...mockProviders]),
  getAiConnections: mock(() => [...mockAiConnections]),
  getProvider: mock((id: string) => mockProviders.find((p) => p.id === id)),
  getAiConnection: mock((id: string) => mockAiConnections.find((c) => c.id === id)),
  getRoleAssignments: mock(() => ({ ...mockRoleAssignments })),
  addProvider: mock((opts: { registryId: string }) => {
    const id = `provider-${nextId++}`;
    mockProviders.push({ id, ...opts, source: 'stored' });
    return id;
  }),
  addAiConnection: mock((opts: Record<string, unknown>) => {
    const id = `conn-${nextId++}`;
    mockAiConnections.push({ id, ...opts } as (typeof mockAiConnections)[0]);
    return id;
  }),
  updateAiConnection: mock((id: string, patch: Record<string, unknown>) => {
    const connection = mockAiConnections.find((candidate) => candidate.id === id);
    if (connection) {
      Object.assign(connection, patch);
    }
  }),
  updateProvider: mock((id: string, patch: Record<string, unknown>) => {
    const provider = mockProviders.find((candidate) => candidate.id === id);
    if (provider) {
      Object.assign(provider, patch);
    }
  }),
  deleteAiConnection: mock((id: string) => {
    const idx = mockAiConnections.findIndex((c) => c.id === id);
    if (idx >= 0) {
      mockAiConnections.splice(idx, 1);
    }
  }),
  setRoleAssignment: mock((role: string, connectionId: string) => {
    mockRoleAssignments[role] = connectionId;
  }),
  setDefaultConnection: mock((connectionId: string) => {
    const connection = mockAiConnections.find((candidate) => candidate.id === connectionId);
    if (connection) {
      mockDefaultByCapability[connection.capability] = connectionId;
    }
  }),
  clearRoleAssignment: mock((role: string) => {
    delete mockRoleAssignments[role];
  }),
  getPresets: mock(() => [...BUILT_IN_PRESETS]),
};

// AC-6: real TTS preview. isSynthesizing/isPlaying/status/errorMessage are
// plain mutable fields (not $state) — tests set them directly to drive the
// ViewModel's derived voicePreviewState/voiceRuntimeStatus getters.
const mockTtsService = {
  speak: mock(async (_options: { text: string; voiceId?: string }) => {}),
  stop: mock(() => {}),
  reset: mock(() => {}),
  initialize: mock(async () => {}),
  isSynthesizing: false,
  isPlaying: false,
  status: 'uninitialized' as string,
  errorMessage: null as string | null,
};

// Kokoro model download state — tests drive `state.status` directly.
const mockVoiceModelService = {
  state: { status: 'not-downloaded' } as { status: string; message?: string },
  totalBytes: 0,
  cancel: mock(() => {}),
  download: mock(async () => ({ status: 'ready' })),
};

// AC-6: real-campaign-line fallback (Edge Cases & Gotchas — "no active campaign").
const mockCampaignService: { activeCampaign: { name: string } | undefined } = {
  activeCampaign: undefined,
};

// AC-7: real image preview through the same generateImage() path #239 wired.
const mockImageGenerationService = {
  checkpoints: [{ id: 'sd_xl_base_1.0', description: 'SDXL Base' }],
  loadCheckpoints: mock(async () => {}),
  generateImage: mock(async (_options: Record<string, unknown>) => ({
    url: 'blob:preview-url',
    isDemo: false,
  })),
};

const mockStyleProfile = { id: 'default', name: 'Default', positiveTags: 'high quality' };
const mockStyleProfileService = {
  profiles: [mockStyleProfile],
  activeProfileId: 'default',
  activeProfile: mockStyleProfile,
  setActiveProfile: mock((_id: string) => {}),
};

mock.module('$lib/utils/fuzzy_match', () => ({
  fuzzyMatch: mock((query: string, target: string) =>
    target.toLowerCase().includes(query.toLowerCase()),
  ),
}));

type TestViewModelOptions = {
  className?: string;
  capability?: import('$types').ConnectionCapability;
  showAdvancedSections?: boolean;
};

let getAiSettingsViewModel: (
  options?: TestViewModelOptions,
) => import('./ai_settings_view_model.svelte').AiSettingsViewModelInterface;
let voicePreviewFallbackLine: typeof import('./ai_settings_view_model.svelte').VOICE_PREVIEW_FALLBACK_LINE;

beforeEach(async () => {
  // Clear all mock state
  aiConnectionStatus.reset();
  mockProviders.length = 0;
  mockAiConnections.length = 0;
  for (const k of Object.keys(mockRoleAssignments)) {
    delete mockRoleAssignments[k];
  }
  for (const capability of Object.keys(mockDefaultByCapability)) {
    delete mockDefaultByCapability[capability];
  }
  nextId = 1;
  mockConfigService.load.mockClear();
  mockConfigService.save.mockClear();
  mockConfigService.addProvider.mockClear();
  mockConfigService.addAiConnection.mockClear();
  mockConfigService.updateProvider.mockClear();
  mockConfigService.updateAiConnection.mockClear();
  mockConfigService.setRoleAssignment.mockClear();
  mockConfigService.setDefaultConnection.mockClear();
  mockConfigService.clearRoleAssignment.mockClear();
  mockFetchModelsFromProvider.mockClear();
  mockFetchWithCredentialPolicy.mockClear();
  mockVerifyConnection.mockClear();
  mockTtsService.speak.mockClear();
  mockTtsService.stop.mockClear();
  mockTtsService.reset.mockClear();
  mockTtsService.initialize.mockClear();
  mockTtsService.isSynthesizing = false;
  mockTtsService.isPlaying = false;
  mockTtsService.status = 'uninitialized';
  mockTtsService.errorMessage = null;
  mockVoiceModelService.state = { status: 'not-downloaded' };
  mockCampaignService.activeCampaign = undefined;
  mockImageGenerationService.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'SDXL Base' }];
  mockImageGenerationService.loadCheckpoints.mockClear();
  mockImageGenerationService.generateImage.mockClear();
  mockStyleProfileService.setActiveProfile.mockClear();

  const { createAiSettingsViewModel, VOICE_PREVIEW_FALLBACK_LINE } = await import(
    './ai_settings_view_model.svelte'
  );
  voicePreviewFallbackLine = VOICE_PREVIEW_FALLBACK_LINE;
  getAiSettingsViewModel = (options: TestViewModelOptions = {}) =>
    createAiSettingsViewModel({
      className: options.className ?? 'AiSettingsViewModel',
      capability: options.capability,
      showAdvancedSections: options.showAdvancedSections,
      config: mockConfigService,
      campaign: mockCampaignService,
      image: mockImageGenerationService,
      styleProfiles: mockStyleProfileService,
      tts: mockTtsService,
      voiceModel: mockVoiceModelService,
      ai: {
        providerModelFetch: mockProviderModelFetch,
        hasVerificationStrategy: mockHasVerificationStrategy,
        fetchModelsFromProvider: mockFetchModelsFromProvider,
        fetchWithCredentialPolicy: mockFetchWithCredentialPolicy,
        resolveChatTestRequest: mockResolveChatTestRequest,
        verifyConnection: mockVerifyConnection,
      },
    });
});

describe('AiSettingsViewModel — AC-1: Second model reuses key', () => {
  test('prefills key from existing provider when adding a second connection', async () => {
    // Seed: one provider with one connection
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-test-key',
    });
    mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    // When adding a new provider with the same registryId
    vm.openAddProvider();
    vm.setDraftProvider('openrouter');

    // Then the key should be prefilled from the existing provider
    expect(vm.draft.apiKey).toBe('sk-or-v1-test-key');
  });

  test('prefills key from the default provider and exposes its label as a hint', async () => {
    mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-init-key',
    });

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();

    expect(vm.draft.registryId).toBe('openrouter');
    expect(vm.draft.apiKey).toBe('sk-or-v1-init-key');
    expect(vm.draft.label).toBe('');
    expect(vm.labelHint).toBe('OpenRouter');
    expect(vm.draft.providerId).toBeDefined();
  });

  test('auto-generated labels avoid duplicates by appending a number', async () => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-test-key',
    });
    mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'OpenRouter',
      model: '',
      params: {},
    });
    mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'OpenRouter 2',
      model: '',
      params: {},
    });

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.openAddProvider();

    await vm.saveDraft();

    const created = mockAiConnections[mockAiConnections.length - 1];
    expect(created?.label).toBe('OpenRouter 3');
  });
});

describe('AiSettingsViewModel — AC-3: Key conflict prompt', () => {
  afterEach(() => {
    mockHasVerificationStrategy.mockReturnValue(false);
  });

  test('shows conflict prompt when key differs from existing provider', async () => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-existing-key',
    });
    mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();
    // Set a different key first
    vm.setDraftField('apiKey', 'sk-or-v1-different-key');
    // Then switch to a provider that already has a key
    vm.setDraftProvider('openrouter');

    // Should show conflict prompt
    expect(vm.keyConflictPrompt).toBeDefined();
    expect(vm.keyConflictPrompt?.newKey).toBe('sk-or-v1-different-key');
    expect(vm.keyConflictPrompt?.providerLabel).toBe('OpenRouter');
  });

  test('resolving conflict with update changes the provider credential', async () => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-existing-key',
    });
    mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();
    vm.setDraftField('apiKey', 'sk-or-v1-different-key');
    vm.setDraftProvider('openrouter');

    expect(vm.keyConflictPrompt).toBeDefined();
    vm.resolveKeyConflict(true);

    expect(mockConfigService.updateProvider).toHaveBeenCalledWith(
      pid,
      expect.objectContaining({ credential: 'sk-or-v1-different-key' }),
    );
    expect(vm.keyConflictPrompt).toBeUndefined();
  });

  test('resolving conflict separately creates a provider for the new connection', async () => {
    const existingProviderId = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-existing-key',
    });
    mockConfigService.addAiConnection({
      providerId: existingProviderId,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {},
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();
    vm.setDraftField('apiKey', 'sk-or-v1-separate-key');
    vm.setDraftProvider('openrouter');
    vm.setDraftField('model', 'anthropic/claude-haiku');
    vm.resolveKeyConflict(false);

    const separateProvider = mockProviders.find((provider) => provider.id !== existingProviderId);
    expect(separateProvider?.credential).toBe('sk-or-v1-separate-key');
    expect(mockConfigService.addAiConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerId: separateProvider?.id }),
    );
    expect(mockProviders.find((provider) => provider.id === existingProviderId)?.credential).toBe(
      'sk-or-v1-existing-key',
    );
  });

  test('separate-provider resolution survives asynchronous verification', async () => {
    mockHasVerificationStrategy.mockReturnValue(true);
    const verification = createDeferred<ConnectionTestResult, Error>();
    mockVerifyConnection.mockImplementationOnce(async () => verification.promise);
    const existingProviderId = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-existing-key',
    });
    mockConfigService.addAiConnection({
      providerId: existingProviderId,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {},
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();
    vm.setDraftField('apiKey', 'sk-or-v1-separate-key');
    vm.setDraftProvider('openrouter');
    vm.resolveKeyConflict(false);
    expect(vm.keyConflictPrompt).toBeUndefined();

    verification.resolve({ ok: true, latencyMs: 42 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const separateProvider = mockProviders.find((provider) => provider.id !== existingProviderId);
    expect(separateProvider?.credential).toBe('sk-or-v1-separate-key');
    expect(mockConfigService.addAiConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerId: separateProvider?.id }),
    );
  });
});

describe('AiSettingsViewModel — AC-4: Status board', () => {
  test('shows not_configured for all capabilities when no connections exist', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    expect(vm.statusEntries.length).toBe(3);
    for (const entry of vm.statusEntries) {
      expect(entry.status).toBe('not_configured');
    }
  });

  test('shows not_tested for text when a text connection exists but has not been verified', async () => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-key',
    });
    mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    const textEntry = vm.statusEntries.find((e) => e.capability === 'text');
    expect(textEntry).toBeDefined();
    expect(textEntry?.status).toBe('not_tested');
    expect(textEntry?.modelName).toBe('anthropic/claude-sonnet');

    const voiceEntry = vm.statusEntries.find((e) => e.capability === 'voice');
    expect(voiceEntry?.status).toBe('not_configured');

    const imageEntry = vm.statusEntries.find((e) => e.capability === 'image');
    expect(imageEntry?.status).toBe('not_configured');
  });

  test('reflects in-flight, failed, and successful connection tests', async () => {
    const providerId = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-key',
    });
    const connectionId = mockConfigService.addAiConnection({
      providerId,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {},
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.testingIds.add(connectionId);
    expect(vm.statusEntries.find((entry) => entry.capability === 'text')?.status).toBe('testing');

    vm.testingIds.delete(connectionId);
    vm.testResults[connectionId] = { ok: false, latencyMs: 10, error: 'Rejected' };
    expect(vm.statusEntries.find((entry) => entry.capability === 'text')?.status).toBe(
      'unreachable',
    );

    vm.testResults[connectionId] = { ok: true, latencyMs: 42 };
    const textEntry = vm.statusEntries.find((entry) => entry.capability === 'text');
    expect(textEntry?.status).toBe('reachable');
    expect(textEntry?.latencyMs).toBe(42);
    expect(textEntry?.connectionId).toBe(connectionId);
  });
});

describe('AiSettingsViewModel — AC-5: Role assignment', () => {
  test('assigning a role persists and reflects in connectionsWithRoles', async () => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-key',
    });
    const cid1 = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });
    mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Haiku',
      model: 'anthropic/claude-haiku',
      params: {
        temperature: 0.5,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 1024,
        contextSize: 4096,
      },
    });

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.assignRole('narration', cid1);

    expect(mockConfigService.setRoleAssignment).toHaveBeenCalledWith('narration', cid1);
    const cwr = vm.connectionsWithRoles.find((c) => c.connection.id === cid1);
    expect(cwr).toBeDefined();
    expect(cwr?.roles).toContain('narration');
  });
});

describe('AiSettingsViewModel — AC-6: Voice archetypes', () => {
  test('setting a voice archetype persists to the narrator connection', async () => {
    const pid = mockConfigService.addProvider({
      registryId: 'kokoro',
      label: 'Kokoro',
    });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'voice',
      label: 'Kokoro TTS',
      model: 'kokoro',
      params: { voiceId: 'af_bella', speed: 1.0, pitch: 0 },
    });
    mockConfigService.setRoleAssignment('narrator-voice', cid);

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.setVoiceArchetype('female-warm', 'af_heart');

    const expectedArchetype = {
      id: 'female-warm',
      label: 'female-warm',
      voiceId: 'af_heart',
    };
    expect(mockConfigService.updateAiConnection).toHaveBeenCalledWith(
      cid,
      expect.objectContaining({
        params: expect.objectContaining({ archetypes: [expectedArchetype] }),
      }),
    );
    expect(vm.voiceArchetypes).toEqual([expectedArchetype]);

    vm.setVoiceArchetype('male-calm', 'am_adam');
    vm.setVoiceArchetype('female-warm', 'af_bella');

    expect(vm.voiceArchetypes).toEqual([
      { ...expectedArchetype, voiceId: 'af_bella' },
      { id: 'male-calm', label: 'male-calm', voiceId: 'am_adam' },
    ]);
    expect(mockConfigService.updateAiConnection).toHaveBeenLastCalledWith(
      cid,
      expect.objectContaining({
        params: expect.objectContaining({ archetypes: vm.voiceArchetypes }),
      }),
    );
  });

  test('preview uses the changed voice id and a real fallback line when no campaign is active', async () => {
    const pid = mockConfigService.addProvider({ registryId: 'kokoro', label: 'Kokoro' });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'voice',
      label: 'Kokoro TTS',
      model: 'kokoro',
      params: { voiceId: 'af_bella', speed: 1.0, pitch: 0 },
    });
    mockConfigService.setRoleAssignment('narrator-voice', cid);
    mockCampaignService.activeCampaign = undefined;

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.setVoiceArchetype('female-warm', 'af_heart');
    await vm.previewVoiceArchetype('female-warm');

    expect(mockTtsService.speak).toHaveBeenCalledTimes(1);
    const [call] = mockTtsService.speak.mock.calls;
    expect(call?.[0].voiceId).toBe('af_heart');
    expect(call?.[0].text).toBe(voicePreviewFallbackLine);
  });

  test('preview uses a real line from the active campaign when one is playing', async () => {
    const pid = mockConfigService.addProvider({ registryId: 'kokoro', label: 'Kokoro' });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'voice',
      label: 'Kokoro TTS',
      model: 'kokoro',
      params: { voiceId: 'af_bella', speed: 1.0, pitch: 0 },
    });
    mockConfigService.setRoleAssignment('narrator-voice', cid);
    mockCampaignService.activeCampaign = { name: 'The Sunken Citadel' };

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.setVoiceArchetype('female-warm', 'af_heart');
    await vm.previewVoiceArchetype('female-warm');

    const [call] = mockTtsService.speak.mock.calls;
    expect(call?.[0].text).toContain('The Sunken Citadel');
  });
});

describe('AiSettingsViewModel — voice runtime completion (browser Kokoro)', () => {
  test('voicePreviewState reflects live ttsService signals, not a fire-and-forget flag', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    expect(vm.voicePreviewState).toEqual({ status: 'idle' });

    mockTtsService.isSynthesizing = true;
    expect(vm.voicePreviewState).toEqual({ status: 'synthesizing' });

    mockTtsService.isSynthesizing = false;
    mockTtsService.isPlaying = true;
    expect(vm.voicePreviewState).toEqual({ status: 'playing' });

    // A resolved speak() promise while audio is still playing must not be
    // reported as idle/success — the "playing" status remains until
    // ttsService itself reports playback has ended.
    vm.setVoiceArchetype('female-warm', 'af_heart');
    mockTtsService.speak.mockImplementationOnce(async () => {});
    await vm.previewVoiceArchetype('female-warm');
    expect(mockTtsService.speak).toHaveBeenCalledTimes(1);
    expect(vm.voicePreviewState).toEqual({ status: 'playing' });

    mockTtsService.isPlaying = false;
    expect(vm.voicePreviewState).toEqual({ status: 'idle' });
  });

  test('stopVoicePreview calls ttsService.stop() and clears any error', async () => {
    mockTtsService.speak.mockImplementationOnce(async () => {
      throw new Error('worker error');
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.setVoiceArchetype('female-warm', 'af_heart');
    await vm.previewVoiceArchetype('female-warm');
    expect(vm.voicePreviewState).toEqual({ status: 'error', error: 'worker error' });

    vm.stopVoicePreview();

    expect(mockTtsService.stop).toHaveBeenCalledTimes(1);
    expect(vm.voicePreviewState).toEqual({ status: 'idle' });
  });

  test('testVoice speaks the preview line with the default voice (no archetype override)', async () => {
    mockCampaignService.activeCampaign = undefined;
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testVoice();

    expect(mockTtsService.speak).toHaveBeenCalledTimes(1);
    const [call] = mockTtsService.speak.mock.calls;
    expect(call?.[0].voiceId).toBeUndefined();
    expect(call?.[0].text).toBe(voicePreviewFallbackLine);
  });

  test('testVoice surfaces a failure through voicePreviewState instead of throwing', async () => {
    mockTtsService.speak.mockImplementationOnce(async () => {
      throw new Error('not supported by this provider');
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testVoice();

    expect(vm.voicePreviewState).toEqual({
      status: 'error',
      error: 'not supported by this provider',
    });
  });

  test('voiceRuntimeStatus/voiceRuntimeError mirror the live ttsService state, distinct from download state', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    expect(vm.voiceRuntimeStatus).toBe('uninitialized');
    expect(vm.voiceRuntimeError).toBeNull();

    mockTtsService.status = 'error';
    mockTtsService.errorMessage = 'Kokoro worker error';
    expect(vm.voiceRuntimeStatus).toBe('error');
    expect(vm.voiceRuntimeError).toBe('Kokoro worker error');
  });

  test('retryVoiceRuntime resets and re-initializes the TTS runtime without re-downloading', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.retryVoiceRuntime();

    expect(mockTtsService.reset).toHaveBeenCalledTimes(1);
    expect(mockTtsService.initialize).toHaveBeenCalledTimes(1);
  });
});

describe('AiSettingsViewModel — AC-7: Image preview uses the same ImageParams path', () => {
  test('initialization loads checkpoint options from the image service', async () => {
    mockImageGenerationService.checkpoints = [];
    mockImageGenerationService.loadCheckpoints.mockImplementationOnce(async () => {
      mockImageGenerationService.checkpoints = [
        { id: 'loaded-checkpoint', description: 'Loaded checkpoint' },
      ];
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });

    await vm.initialize();

    expect(mockImageGenerationService.loadCheckpoints).toHaveBeenCalledTimes(1);
    expect(vm.imageCheckpoints).toEqual(['loaded-checkpoint']);
  });

  test('generateImage() is called with the connection resolved checkpoint and size', async () => {
    const pid = mockConfigService.addProvider({ registryId: 'comfyui', label: 'This computer' });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'image',
      label: 'ComfyUI',
      model: 'sd_xl_base_1.0',
      params: { checkpoint: 'sd_xl_base_1.0', width: 512, height: 512, steps: 20, cfg: 7 },
    });
    const otherCid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'image',
      label: 'Other ComfyUI',
      model: 'sd_xl_base_1.0',
      params: { checkpoint: 'sd_xl_base_1.0', width: 512, height: 512, steps: 20, cfg: 7 },
    });

    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.setImageSizePreset(cid, 'portrait');
    await vm.previewImage(cid);

    expect(mockImageGenerationService.generateImage).toHaveBeenCalledTimes(1);
    expect(mockImageGenerationService.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: 'sd_xl_base_1.0',
        width: 768,
        height: 1024,
        steps: 20,
        cfgScale: 7,
      }),
    );
    expect(vm.imagePreviewStateFor(cid)).toEqual({ status: 'ready', url: 'blob:preview-url' });
    expect(vm.imagePreviewStateFor(otherCid)).toEqual({ status: 'idle' });
  });

  test('advanced disclosure state is scoped to each image connection', async () => {
    const pid = mockConfigService.addProvider({ registryId: 'comfyui', label: 'This computer' });
    const firstCid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'image',
      label: 'First ComfyUI',
      model: 'sd_xl_base_1.0',
      params: { checkpoint: 'sd_xl_base_1.0', width: 512, height: 512, steps: 20, cfg: 7 },
    });
    const secondCid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'image',
      label: 'Second ComfyUI',
      model: 'sd_xl_base_1.0',
      params: { checkpoint: 'sd_xl_base_1.0', width: 512, height: 512, steps: 20, cfg: 7 },
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.toggleImageAdvanced(firstCid);

    expect(vm.isImageAdvancedOpenFor(firstCid)).toBe(true);
    expect(vm.isImageAdvancedOpenFor(secondCid)).toBe(false);
  });
});

describe('AiSettingsViewModel — continuous settings persistence', () => {
  test('updates voice params immediately and saves only on explicit commit', async () => {
    const pid = mockConfigService.addProvider({ registryId: 'kokoro', label: 'Kokoro' });
    mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'voice',
      label: 'Kokoro TTS',
      model: 'kokoro',
      params: { voiceId: 'af_bella', speed: 1.0, pitch: 0 },
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.setVoiceSpeed(1.25);

    expect(vm.voiceSpeed).toBe(1.25);
    expect(mockConfigService.save).not.toHaveBeenCalled();

    vm.commitConfigChanges();

    expect(mockConfigService.save).toHaveBeenCalledTimes(1);
  });

  test('updates image params immediately and saves only on explicit commit', async () => {
    const pid = mockConfigService.addProvider({ registryId: 'comfyui', label: 'This computer' });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'image',
      label: 'ComfyUI',
      model: 'sd_xl_base_1.0',
      params: { checkpoint: 'sd_xl_base_1.0', width: 512, height: 512, steps: 20, cfg: 7 },
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.setImageParamField(cid, 'steps', 30);

    expect(vm.imageParamsFor(cid).steps).toBe(30);
    expect(mockConfigService.save).not.toHaveBeenCalled();

    vm.commitConfigChanges();

    expect(mockConfigService.save).toHaveBeenCalledTimes(1);
  });
});

describe('AiSettingsViewModel — provider credential persistence', () => {
  test('updates a resolved provider before persisting the connection', async () => {
    const providerId = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-existing-key',
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();
    vm.setDraftProvider('openrouter');
    vm.setDraftField('apiKey', 'sk-or-v1-updated-key');
    vm.setDraftField('model', 'anthropic/claude-sonnet');
    vm.saveDraft();

    expect(mockConfigService.updateProvider).toHaveBeenCalledTimes(1);
    expect(mockConfigService.updateProvider).toHaveBeenCalledWith(providerId, {
      credential: 'sk-or-v1-updated-key',
    });
    expect(mockConfigService.addAiConnection).toHaveBeenCalledWith(
      expect.objectContaining({ providerId }),
    );
    expect(mockProviders.find((provider) => provider.id === providerId)?.credential).toBe(
      'sk-or-v1-updated-key',
    );
  });

  test('surfaces model-fetch failures and resets loading state', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    mockFetchModelsFromProvider.mockImplementationOnce(async () => {
      throw new Error('Model request failed');
    });

    await vm.fetchModels();

    expect(vm.fetchModelsError).toBe('Model request failed');
    expect(vm.isFetchingModels).toBe(false);
  });

  test('clears a model-fetch failure when the editor resets', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    mockFetchModelsFromProvider.mockImplementationOnce(async () => {
      throw new Error('Model request failed');
    });
    await vm.fetchModels();

    vm.cancelEdit();

    expect(vm.fetchModelsError).toBeUndefined();
  });
});

describe('AiSettingsViewModel — capability setup', () => {
  test('opens provider setup for text and image capabilities', () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });

    vm.openCapabilitySetup('image');

    expect(vm.isEditorOpen).toBe(true);
    expect(vm.draft.capability).toBe('image');
  });

  test('opens the connection editor scoped to voice with Kokoro default', () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });

    vm.openCapabilitySetup('voice');

    expect(vm.isEditorOpen).toBe(true);
    expect(vm.draft.capability).toBe('voice');
    expect(vm.draft.registryId).toBe('kokoro');
    expect(vm.isLocalBinaryProvider).toBe(true);
    expect(vm.needsUrl).toBe(false);
  });
});

describe('AiSettingsViewModel — model query', () => {
  test('a typed model lands in the draft while fetched results still filter', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    mockFetchModelsFromProvider.mockImplementationOnce(async () => [
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet' },
    ]);
    await vm.fetchModels();

    vm.setModelQuery('claude');

    expect(vm.modelQuery).toBe('claude');
    // The field is a real input, not only a search box — the typed ID must be
    // saved, not silently discarded.
    expect(vm.draft.model).toBe('claude');
    expect(vm.modelOptions.map((model) => model.id)).toEqual(['anthropic/claude-sonnet']);
  });

  test('preserves free-text models for providers without model discovery', () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    vm.openAddProvider('image');
    vm.setDraftProvider('comfyui');

    vm.setModelQuery('sdxl-custom');

    expect(vm.modelQuery).toBe('sdxl-custom');
    expect(vm.draft.model).toBe('sdxl-custom');
  });

  test('clears query and selected model when the provider changes', () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    vm.selectModel('openai/gpt-4o');

    vm.setDraftProvider('openrouter');

    expect(vm.modelQuery).toBe('');
    expect(vm.draft.model).toBe('');
  });
});

describe('AiSettingsViewModel — capability defaults', () => {
  test('assigns the first connection for a capability as its default', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();
    vm.setDraftProvider('openrouter');
    vm.setDraftField('model', 'anthropic/claude-sonnet');
    vm.saveDraft();

    const createdConnectionId = mockAiConnections[0]?.id;
    expect(createdConnectionId).toBeDefined();
    expect(mockConfigService.setDefaultConnection).toHaveBeenCalledWith(createdConnectionId);
    expect(mockDefaultByCapability.text).toBe(createdConnectionId);
  });

  test('preserves an existing capability default when adding another connection', async () => {
    const providerId = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-existing-key',
    });
    const existingConnectionId = mockConfigService.addAiConnection({
      providerId,
      capability: 'text',
      label: 'Existing model',
      model: 'openai/gpt-4o',
      params: {},
    });
    mockDefaultByCapability.text = existingConnectionId;
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    mockConfigService.setDefaultConnection.mockClear();

    vm.openAddProvider();
    vm.setDraftProvider('openrouter');
    vm.setDraftField('model', 'anthropic/claude-sonnet');
    vm.saveDraft();

    expect(mockConfigService.setDefaultConnection).not.toHaveBeenCalled();
    expect(mockDefaultByCapability.text).toBe(existingConnectionId);
  });
});

describe('AiSettingsViewModel — editor open has no side effects', () => {
  test('opening the add-provider editor does not persist anything', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();

    expect(mockConfigService.addAiConnection).not.toHaveBeenCalled();
    expect(mockConfigService.save).not.toHaveBeenCalled();
  });
});

describe('AiSettingsViewModel — AC-8: Generation params reach the request, defaults stay silent', () => {
  const seedTextConnection = () => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-key',
    });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });
    return { pid, cid };
  };

  test('opening the Advanced disclosure alone never calls updateAiConnection', async () => {
    const { cid } = seedTextConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openEditConnection(cid);
    vm.toggleGenParamsDisclosure();

    expect(mockConfigService.updateAiConnection).not.toHaveBeenCalled();
  });

  test('saving with the disclosure never opened omits params from the patch entirely', async () => {
    const { cid } = seedTextConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openEditConnection(cid);
    vm.setDraftField('label', 'Sonnet (renamed)');
    vm.saveDraft();

    expect(mockConfigService.updateAiConnection).toHaveBeenCalledTimes(1);
    const [, patch] = mockConfigService.updateAiConnection.mock.calls[0] ?? [];
    expect(patch).not.toHaveProperty('params');
  });

  test('editing one field patches only that field, the rest keep their prior values', async () => {
    const { cid } = seedTextConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openEditConnection(cid);
    vm.toggleGenParamsDisclosure();
    vm.setGenParamField('temperature', 0.42);
    vm.saveDraft();

    expect(mockConfigService.updateAiConnection).toHaveBeenCalledWith(
      cid,
      expect.objectContaining({
        params: {
          temperature: 0.42,
          topP: 1,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 2048,
          contextSize: 4096,
        },
      }),
    );

    const updated = mockAiConnections.find((c) => c.id === cid);
    expect(updated).toBeDefined();
    expect((updated?.params as { temperature: number } | undefined)?.temperature).toBe(0.42);
  });

  test('applying a built-in preset overwrites every field it defines, not a merge over a prior edit', async () => {
    const { cid } = seedTextConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openEditConnection(cid);
    vm.toggleGenParamsDisclosure();
    vm.setGenParamField('temperature', 0.05);
    vm.applyGenPreset('creative');

    const creative = BUILT_IN_PRESETS.find((p) => p.id === 'creative');
    expect(vm.genParamsDisplay).toEqual(creative?.params);
  });
});

describe('AiSettingsViewModel — P02: testConnection delegates to verifyConnection', () => {
  const seedConnection = (overrides?: Record<string, unknown>) => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-test-key',
      baseUrl: undefined,
      source: 'stored',
      ...overrides,
    });
    return mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });
  };

  test('delegates to verifyConnection and stores the result', async () => {
    const cid = seedConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testConnection(cid);

    expect(mockVerifyConnection).toHaveBeenCalledTimes(1);
    expect(vm.testResults[cid]).toEqual({ ok: true, latencyMs: 42 });
    expect(vm.testingIds.has(cid)).toBe(false);
  });

  test('passes provider and baseUrl to verifyConnection', async () => {
    const cid = seedConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testConnection(cid);

    const [options] = mockVerifyConnection.mock.calls[0] ?? [];
    expect(options.provider?.registryId).toBe('openrouter');
    expect(options.provider?.credential).toBe('sk-or-v1-test-key');
  });

  test('passes provider baseUrl when set', async () => {
    const cid = seedConnection({
      registryId: 'ollama',
      credential: undefined,
      baseUrl: 'http://localhost:11434',
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testConnection(cid);

    const [options] = mockVerifyConnection.mock.calls[0] ?? [];
    expect(options.baseUrl).toBe('http://localhost:11434');
  });

  test('sets testingIds during test and clears after', async () => {
    const cid = seedConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    // Make verifyConnection hang so we can check loading state
    const deferredVerify = createDeferred<ConnectionTestResult, Error>();
    mockVerifyConnection.mockImplementationOnce(async () => deferredVerify.promise);

    const testPromise = vm.testConnection(cid);
    expect(vm.testingIds.has(cid)).toBe(true);

    deferredVerify.resolve({ ok: true, latencyMs: 10 });
    await testPromise;

    expect(vm.testingIds.has(cid)).toBe(false);
  });

  test('stale response does not overwrite newer result', async () => {
    const cid = seedConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    // Simulate two rapid test calls where the first response arrives after
    // the second has already completed.
    const deferredSlow = createDeferred<ConnectionTestResult, Error>();

    // First call — will be slow
    mockVerifyConnection.mockImplementationOnce(async () => deferredSlow.promise);
    // Second call — fast, returns success
    mockVerifyConnection.mockImplementationOnce(async () => ({
      ok: true,
      latencyMs: 5,
    }));

    const firstPromise = vm.testConnection(cid);
    await vm.testConnection(cid);

    // Now resolve the first (stale) response
    deferredSlow.resolve({ ok: true, latencyMs: 999 });
    await firstPromise;

    // The result should be the fast one, not the slow stale one
    expect(vm.testResults[cid]?.latencyMs).toBe(5);
  });

  test('an older test finishing does not clear a newer test loading state', async () => {
    const cid = seedConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    const first = createDeferred<ConnectionTestResult, Error>();
    const second = createDeferred<ConnectionTestResult, Error>();
    mockVerifyConnection.mockImplementationOnce(async () => first.promise);
    mockVerifyConnection.mockImplementationOnce(async () => second.promise);

    const firstPromise = vm.testConnection(cid);
    const secondPromise = vm.testConnection(cid);
    first.resolve({ ok: true, latencyMs: 10 });
    await firstPromise;

    expect(vm.testingIds.has(cid)).toBe(true);

    second.resolve({ ok: true, latencyMs: 5 });
    await secondPromise;
    expect(vm.testingIds.has(cid)).toBe(false);
  });

  test('an edit prevents an older test from sharing the next test generation', async () => {
    const cid = seedConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    const first = createDeferred<ConnectionTestResult, Error>();
    mockVerifyConnection.mockImplementationOnce(async () => first.promise);
    mockVerifyConnection.mockImplementationOnce(async () => ({ ok: true, latencyMs: 5 }));

    const firstPromise = vm.testConnection(cid);
    vm.openEditConnection(cid);
    vm.saveDraft();
    await vm.testConnection(cid);
    first.resolve({ ok: true, latencyMs: 999 });
    await firstPromise;

    expect(vm.testResults[cid]?.latencyMs).toBe(5);
  });

  test('handles verifyConnection error gracefully', async () => {
    const cid = seedConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    mockVerifyConnection.mockImplementationOnce(async () => ({
      ok: false,
      latencyMs: 100,
      error: 'Connection refused',
    }));

    await vm.testConnection(cid);

    expect(vm.testResults[cid]).toEqual({ ok: false, latencyMs: 100, error: 'Connection refused' });
  });

  test('no-op when connectionId is undefined', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testConnection(undefined);

    expect(mockVerifyConnection).not.toHaveBeenCalled();
  });

  test('no-op when connection does not exist', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testConnection('nonexistent');

    expect(mockVerifyConnection).not.toHaveBeenCalled();
  });
});

describe('AiSettingsViewModel — Kokoro connection test uses local readiness', () => {
  const seedKokoroConnection = () => {
    const pid = mockConfigService.addProvider({
      registryId: 'kokoro',
      label: 'Kokoro (local)',
      credential: undefined,
      baseUrl: undefined,
      source: 'stored',
    });
    return mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'voice',
      label: 'Kokoro',
      model: '',
      params: {},
    });
  };

  test('does not call verifyConnection for the bundled Kokoro binary', async () => {
    const cid = seedKokoroConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    mockVoiceModelService.state = { status: 'ready' };
    mockTtsService.status = 'ready';

    await vm.testConnection(cid);

    expect(mockVerifyConnection).not.toHaveBeenCalled();
    expect(vm.testResults[cid]?.ok).toBe(true);
  });

  test('reports the model as not downloaded when the Kokoro model is missing', async () => {
    const cid = seedKokoroConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    mockVoiceModelService.state = { status: 'not-downloaded' };

    await vm.testConnection(cid);

    expect(mockVerifyConnection).not.toHaveBeenCalled();
    expect(vm.testResults[cid]?.ok).toBe(false);
    expect(vm.testResults[cid]?.error).toBe('Voice model not downloaded');
  });

  test('initializes the TTS runtime when the model is ready but the runtime is not', async () => {
    const cid = seedKokoroConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    mockVoiceModelService.state = { status: 'ready' };
    mockTtsService.status = 'uninitialized';
    mockTtsService.initialize.mockImplementationOnce(async () => {
      mockTtsService.status = 'ready';
    });

    await vm.testConnection(cid);

    expect(mockTtsService.reset).toHaveBeenCalled();
    expect(mockTtsService.initialize).toHaveBeenCalled();
    expect(vm.testResults[cid]?.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P03 — Replace inferred Running labels with honest connection status
// ─────────────────────────────────────────────────────────────────────────────

describe('AiSettingsViewModel — P03: provider tree status replaces inferred Running badge', () => {
  const seedLocalProvider = (
    overrides?: Partial<{
      registryId: string;
      credential: string | undefined;
      baseUrl: string;
    }>,
  ) => {
    const pid = mockConfigService.addProvider({
      registryId: overrides?.registryId ?? 'ollama',
      label: 'Ollama',
      credential: overrides?.credential,
      baseUrl: overrides?.baseUrl ?? 'http://localhost:11434',
    });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Local model',
      model: 'llama3',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });
    return { pid, cid };
  };

  const seedCloudProvider = (
    overrides?: Partial<{
      registryId: string;
      credential: string | undefined;
    }>,
  ) => {
    const pid = mockConfigService.addProvider({
      registryId: overrides?.registryId ?? 'openrouter',
      label: 'OpenRouter',
      credential: overrides?.credential ?? 'sk-or-v1-key',
    });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });
    return { pid, cid };
  };

  test('AC-1: untested local provider shows not checked, not running', async () => {
    seedLocalProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    expect(vm.providerTree.length).toBe(1);
    const entry = vm.providerTree[0];
    expect(entry).toBeDefined();
    expect(entry.isLocal).toBe(true);
    // Must NOT say "running" or "reachable" — no test was ever run
    expect(entry.statusLabel).toBe('not checked');
    expect(entry.statusColorClass).toBe('badge-ghost');
  });

  test('AC-1: untested cloud provider shows not checked with same semantics', async () => {
    seedCloudProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    const entry = vm.providerTree[0];
    expect(entry).toBeDefined();
    expect(entry.isLocal).toBe(false);
    // Same status semantics as local — locality does not determine status
    expect(entry.statusLabel).toBe('not checked');
    expect(entry.statusColorClass).toBe('badge-ghost');
  });

  test('AC-3: testing provider shows testing…', async () => {
    const { cid } = seedLocalProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.testingIds.add(cid);

    const entry = vm.providerTree[0];
    expect(entry.statusLabel).toBe('testing…');
    expect(entry.statusColorClass).toBe('badge-warning');
  });

  test('AC-2: all connections reachable shows reachable', async () => {
    const { cid } = seedLocalProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.testResults[cid] = { ok: true, latencyMs: 42 };

    const entry = vm.providerTree[0];
    expect(entry.statusLabel).toBe('reachable');
    expect(entry.statusColorClass).toBe('badge-success');
  });

  test('AC-3: unreachable connection shows unreachable', async () => {
    const { cid } = seedLocalProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.testResults[cid] = { ok: false, latencyMs: 100, error: 'Connection refused' };

    const entry = vm.providerTree[0];
    expect(entry.statusLabel).toBe('unreachable');
    expect(entry.statusColorClass).toBe('badge-error');
  });

  test('AC-3: one failed connection reports unreachable even with sibling passing', async () => {
    const pid = mockConfigService.addProvider({
      registryId: 'ollama',
      label: 'Ollama',
      baseUrl: 'http://localhost:11434',
    });
    const goodId = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Working model',
      model: 'llama3',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });
    const badId = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Broken model',
      model: 'broken-model',
      params: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.testResults[goodId] = { ok: true, latencyMs: 42 };
    vm.testResults[badId] = { ok: false, latencyMs: 100, error: 'Timeout' };

    const entry = vm.providerTree[0];
    // One failure makes the whole provider unreachable, but individual
    // connection status must distinguish good from bad
    expect(entry.statusLabel).toBe('unreachable');
    expect(entry.statusColorClass).toBe('badge-error');

    // Per-connection status must not incorrectly report the working sibling
    expect(vm.connectionStatusFor(goodId).label).toContain('reachable');
    expect(vm.connectionStatusFor(goodId).colorClass).toBe('text-success');
    expect(vm.connectionStatusFor(badId).label).toContain('unreachable');
    expect(vm.connectionStatusFor(badId).colorClass).toBe('text-error');
    expect(entry.connections.find((connection) => connection.id === goodId)?.statusColorClass).toBe(
      'text-success',
    );
    expect(entry.connections.find((connection) => connection.id === badId)?.statusColorClass).toBe(
      'text-error',
    );
  });

  test('AC-5: no network request on mount or initialize', async () => {
    seedLocalProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    // Must not trigger any connection test during mount
    expect(mockVerifyConnection).not.toHaveBeenCalled();
    // providerTree must still render without network activity
    expect(vm.providerTree.length).toBe(1);
  });

  test('AC-4: deleting a connection clears its test result', async () => {
    const { cid } = seedLocalProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.testResults[cid] = { ok: true, latencyMs: 42 };
    expect(cid in vm.testResults).toBe(true);

    vm.deleteConnection(cid);

    expect(cid in vm.testResults).toBe(false);
    // Provider now has no connections → status changes
    expect(vm.providerTree[0].statusLabel).toBe('no connections');
  });

  test('AC-4: editing a connection invalidates its test result', async () => {
    const { cid } = seedLocalProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.testResults[cid] = { ok: true, latencyMs: 42 };
    expect(cid in vm.testResults).toBe(true);

    // Open editor and save (simulating credential/endpoint change)
    vm.openEditConnection(cid);
    vm.saveDraft();

    // Test result must be cleared after edit
    expect(cid in vm.testResults).toBe(false);
  });

  test('connectionStatusFor returns per-connection status', async () => {
    const { cid } = seedLocalProvider();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    // Untested
    expect(vm.connectionStatusFor(cid).label).toBe('not checked');
    expect(vm.connectionStatusFor(cid).colorClass).toBe('text-base-content/40');

    // Testing
    vm.testingIds.add(cid);
    expect(vm.connectionStatusFor(cid).label).toBe('testing…');
    expect(vm.connectionStatusFor(cid).colorClass).toBe('text-warning');
    vm.testingIds.delete(cid);

    // Reachable
    vm.testResults[cid] = { ok: true, latencyMs: 50 };
    expect(vm.connectionStatusFor(cid).label).toContain('reachable');
    expect(vm.connectionStatusFor(cid).label).toContain('50ms');
    expect(vm.connectionStatusFor(cid).colorClass).toBe('text-success');

    // Unreachable with error
    vm.testResults[cid] = { ok: false, latencyMs: 200, error: 'Timeout' };
    expect(vm.connectionStatusFor(cid).label).toContain('unreachable');
    expect(vm.connectionStatusFor(cid).label).toContain('Timeout');
    expect(vm.connectionStatusFor(cid).colorClass).toBe('text-error');
  });
});

describe('AiSettingsViewModel — P03: truthful status presentation', () => {
  const _params = {
    temperature: 0.7,
    topP: 1,
    topK: 40,
    repetitionPenalty: 1,
    presencePenalty: 0,
    maxTokens: 2048,
    contextSize: 4096,
  };

  /** Seeds one provider carrying two sibling connections on the same account. */
  const seedSiblings = () => {
    const providerId = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-original',
      baseUrl: undefined,
      source: 'stored',
    });
    const first = mockConfigService.addAiConnection({
      providerId,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: _params,
    });
    const second = mockConfigService.addAiConnection({
      providerId,
      capability: 'text',
      label: 'Haiku',
      model: 'anthropic/claude-haiku',
      params: _params,
    });
    return { providerId, first, second };
  };

  test('a local connection is "not checked" until it is actually tested', async () => {
    const providerId = mockConfigService.addProvider({
      registryId: 'ollama',
      label: 'Ollama',
      credential: undefined,
      baseUrl: 'http://localhost:11434',
      source: 'stored',
    });
    const cid = mockConfigService.addAiConnection({
      providerId,
      capability: 'text',
      label: 'Llama',
      model: 'llama3.2',
      params: _params,
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    // AC-1: locality alone must never read as running/ready.
    const status = vm.connectionStatusFor(cid);
    expect(status.label).toBe('not checked');
    expect(status.label).not.toContain('running');
    expect(status.label).not.toContain('ready');
  });

  test('a reachable result reports reachability, not model readiness', async () => {
    const { first } = seedSiblings();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testConnection(first);

    // AC-2: reachable + latency, with no claim about generation.
    const status = vm.connectionStatusFor(first);
    expect(status.label).toContain('reachable');
    expect(status.label).not.toContain('ready');
  });

  test('a sibling on the same provider stays unchecked after one test', async () => {
    const { first, second } = seedSiblings();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testConnection(first);

    // AC-3: one tested connection says nothing about its siblings.
    expect(vm.connectionStatusFor(second).label).toBe('not checked');
  });

  test('rotating the shared credential invalidates every sibling result', async () => {
    const { providerId, first, second } = seedSiblings();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    await vm.testConnection(first);
    await vm.testConnection(second);
    expect(vm.connectionStatusFor(first).label).toContain('reachable');
    expect(vm.connectionStatusFor(second).label).toContain('reachable');

    // AC-4: the credential is shared, so the measurement is stale for both.
    vm.openEditConnection(first);
    vm.setDraftField('apiKey', 'sk-or-v1-rotated');
    vm.saveDraft();

    expect(vm.connectionStatusFor(first).label).toBe('not checked');
    expect(vm.connectionStatusFor(second).label).toBe('not checked');
    expect(mockConfigService.getProvider(providerId)?.credential).toBe('sk-or-v1-rotated');
  });

  test('an in-flight sibling probe cannot restore a pre-rotation result', async () => {
    const { providerId, first, second } = seedSiblings();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    // Hold the sibling's probe open across the credential rotation.
    let release: ((value: unknown) => void) | undefined;
    mockVerifyConnection.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = vm.testConnection(second);

    vm.openEditConnection(first);
    vm.setDraftField('apiKey', 'sk-or-v1-rotated');
    vm.saveDraft();

    release?.({ ok: true, latencyMs: 42 });
    await pending;

    // The probe measured the replaced key — its result must be discarded.
    expect(vm.connectionStatusFor(second).label).toBe('not checked');
    expect(vm.testingIds.has(second)).toBe(false);
    expect(mockConfigService.getProvider(providerId)?.credential).toBe('sk-or-v1-rotated');
  });

  test('a deleted connection does not leave a result behind for a new one', async () => {
    const { first } = seedSiblings();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    await vm.testConnection(first);

    vm.deleteConnection(first);

    expect(vm.testResults[first]).toBeUndefined();
  });

  test('a failed check reads as unreachable with text, not colour alone', async () => {
    const { first } = seedSiblings();
    mockVerifyConnection.mockResolvedValueOnce({
      ok: false,
      latencyMs: 12,
      error: 'connection refused',
    });
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    await vm.testConnection(first);

    // AC-3: failures are legible as text, not only as a colour class.
    const status = vm.connectionStatusFor(first);
    expect(status.label).toContain('unreachable');
    expect(status.label).toContain('connection refused');
  });
});

describe('AiSettingsViewModel — the save gate verifies before it writes', () => {
  const openNewTextDraft = async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.openAddProvider('text');
    vm.setDraftProvider('openrouter');
    vm.setDraftField('apiKey', 'sk-typo');
    return vm;
  };

  beforeEach(() => {
    mockHasVerificationStrategy.mockReturnValue(true);
  });

  afterEach(() => {
    mockHasVerificationStrategy.mockReturnValue(false);
  });

  test('a key that fails verification is refused, not silently accepted', async () => {
    mockVerifyConnection.mockResolvedValueOnce({
      ok: false,
      latencyMs: 30,
      error: 'HTTP 401',
    });
    const vm = await openNewTextDraft();

    await vm.saveDraft();

    expect(mockConfigService.addAiConnection).not.toHaveBeenCalled();
    expect(vm.isSaveBlocked).toBeTrue();
    expect(vm.draftTestResult?.error).toBe('HTTP 401');
    // The editor stays open so the key can be corrected in place.
    expect(vm.isEditorOpen).toBeTrue();
  });

  test('a key that verifies is written without a second probe', async () => {
    const vm = await openNewTextDraft();

    await vm.saveDraft();

    expect(mockVerifyConnection).toHaveBeenCalledTimes(1);
    expect(mockConfigService.addAiConnection).toHaveBeenCalledTimes(1);
    expect(vm.isSaveBlocked).toBeFalse();
    expect(vm.isEditorOpen).toBeFalse();
  });

  test('saveDraftAnyway is the escape hatch for an endpoint we cannot reach', async () => {
    mockVerifyConnection.mockResolvedValueOnce({ ok: false, latencyMs: 5, error: 'offline' });
    const vm = await openNewTextDraft();
    await vm.saveDraft();
    expect(vm.isSaveBlocked).toBeTrue();

    await vm.saveDraftAnyway();

    expect(mockConfigService.addAiConnection).toHaveBeenCalledTimes(1);
    expect(vm.isEditorOpen).toBeFalse();
  });

  test('editing the key after a failure clears the block and the stale result', async () => {
    mockVerifyConnection.mockResolvedValueOnce({ ok: false, latencyMs: 5, error: 'HTTP 401' });
    const vm = await openNewTextDraft();
    await vm.saveDraft();
    expect(vm.isSaveBlocked).toBeTrue();

    vm.setDraftField('apiKey', 'sk-corrected');

    expect(vm.isSaveBlocked).toBeFalse();
    expect(vm.draftTestResult).toBeUndefined();
    vm.cancelEdit();
  });

  test('a provider with no verification strategy saves without a probe', async () => {
    mockHasVerificationStrategy.mockReturnValue(false);
    const vm = await openNewTextDraft();

    await vm.saveDraft();

    expect(mockVerifyConnection).not.toHaveBeenCalled();
    expect(mockConfigService.addAiConnection).toHaveBeenCalledTimes(1);
  });

  test('testDraftConnection probes the unsaved draft, so no save is needed first', async () => {
    const vm = await openNewTextDraft();

    await vm.testDraftConnection();

    expect(mockConfigService.addAiConnection).not.toHaveBeenCalled();
    expect(vm.draftTestResult?.ok).toBeTrue();
    const [options] = mockVerifyConnection.mock.calls[0] ?? [];
    expect((options as { provider: { credential: string } }).provider.credential).toBe('sk-typo');
    vm.cancelEdit();
  });
});

describe('AiSettingsViewModel — generation parameters on an unsaved connection', () => {
  test('the Advanced disclosure is editable before the connection is saved', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.openAddProvider('text');

    vm.toggleGenParamsDisclosure();

    // Previously undefined, which the View rendered as "save this connection
    // first" — a display bug, since the create path already merges these.
    expect(vm.genParamsDisplay).toBeDefined();
    expect(vm.genParamsDisplay?.temperature).toBe(0.7);
    vm.cancelEdit();
  });

  test('a parameter edited before the first save is written with the new connection', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.openAddProvider('text');
    vm.setDraftProvider('openrouter');
    vm.setDraftField('apiKey', 'sk-key');
    vm.toggleGenParamsDisclosure();
    vm.setGenParamField('temperature', 0.31);

    await vm.saveDraft();

    const [opts] = mockConfigService.addAiConnection.mock.calls[0] ?? [];
    expect((opts as { params: { temperature: number } }).params.temperature).toBe(0.31);
  });

  test('a non-text draft still has no generation parameters to show', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.openAddProvider('image');

    expect(vm.genParamsDisplay).toBeUndefined();
    vm.cancelEdit();
  });
});

describe('AiSettingsViewModel — cancelling a voice preview is not a failure', () => {
  const originalSpeak = mockTtsService.speak;

  afterEach(() => {
    mockTtsService.speak = originalSpeak;
  });

  test('stopVoicePreview leaves the preview idle, not in error', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    // speak() rejects the way ttsService.stop() rejects an in-flight request.
    let rejectSpeak: ((error: Error) => void) | undefined;
    mockTtsService.speak = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSpeak = reject;
        }),
    );

    const preview = vm.testVoice();
    vm.stopVoicePreview();
    rejectSpeak?.(new Error('stop() called before synthesis completed'));
    await preview;

    expect(vm.voicePreviewState.status).toBe('idle');
  });

  test('a genuine synthesis failure still surfaces as an error', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    mockTtsService.speak = mock(async () => {
      throw new Error('engine exploded');
    });

    await vm.testVoice();

    expect(vm.voicePreviewState.status).toBe('error');
  });
});

describe('AiSettingsViewModel — a failed persist must not duplicate the connection', () => {
  beforeEach(() => {
    mockHasVerificationStrategy.mockReturnValue(false);
  });

  test('retrying after a failed save updates the row instead of adding a second', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.openAddProvider('text');
    vm.setDraftProvider('openrouter');
    vm.setDraftField('apiKey', 'sk-key');

    mockConfigService.save.mockImplementationOnce(async () => {
      throw new Error('vault write failed');
    });
    await vm.saveDraft();

    expect(vm.saveError).toBeDefined();
    expect(vm.isEditorOpen).toBeTrue();
    expect(mockConfigService.addAiConnection).toHaveBeenCalledTimes(1);

    // The retry must land on the row the failed attempt already created.
    await vm.saveDraft();

    expect(mockConfigService.addAiConnection).toHaveBeenCalledTimes(1);
    expect(mockConfigService.updateAiConnection).toHaveBeenCalledTimes(1);
    expect(mockAiConnections.length).toBe(1);
  });
});

describe('AiSettingsViewModel — editing an existing connection', () => {
  const seedTextConnection = () => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-test-key',
    });
    const cid = mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model: 'anthropic/claude-sonnet',
      params: {},
    });
    return { pid, cid };
  };

  test('openEditConnection prefills the stored API key and model', async () => {
    const { cid } = seedTextConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openEditConnection(cid);

    expect(vm.draft.isEditing).toBe(true);
    expect(vm.draft.apiKey).toBe('sk-or-v1-test-key');
    expect(vm.draft.model).toBe('anthropic/claude-sonnet');
    expect(vm.modelQuery).toBe('anthropic/claude-sonnet');
  });

  test('persists a Server URL edit to the provider account', async () => {
    const { pid, cid } = seedTextConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openEditConnection(cid);
    vm.setDraftField('baseUrl', 'http://localhost:11434');
    await vm.saveDraft();

    const provider = mockProviders.find((p) => p.id === pid) as { baseUrl?: string } | undefined;
    expect(provider?.baseUrl).toBe('http://localhost:11434');
  });

  test('switching the provider dropdown repoints the connection', async () => {
    const { pid, cid } = seedTextConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openEditConnection(cid);
    vm.setDraftProvider('ollama');
    await vm.saveDraft();

    const conn = mockAiConnections.find((c) => c.id === cid);
    expect(conn?.providerId).not.toBe(pid);
    const provider = mockProviders.find((p) => p.id === conn?.providerId);
    expect(provider?.registryId).toBe('ollama');
  });
});

describe('AiSettingsViewModel — model chat-test', () => {
  const seedTextConnection = (model = 'anthropic/claude-sonnet') => {
    const pid = mockConfigService.addProvider({
      registryId: 'openrouter',
      label: 'OpenRouter',
      credential: 'sk-or-v1-test-key',
    });
    return mockConfigService.addAiConnection({
      providerId: pid,
      capability: 'text',
      label: 'Sonnet',
      model,
      params: {},
    });
  };

  test('sends a "hi" chat completion to the selected model', async () => {
    const cid = seedTextConnection();
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.openEditConnection(cid);

    await vm.testDraftModel();

    expect(mockFetchWithCredentialPolicy).toHaveBeenCalledTimes(1);
    const [options] = mockFetchWithCredentialPolicy.mock.calls[0] as [
      { url: string; init: RequestInit },
    ];
    expect(options.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(options.init.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('anthropic/claude-sonnet');
    expect(body.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(vm.draftModelTestResult?.ok).toBe(true);
    expect(typeof vm.draftModelTestResult?.latencyMs).toBe('number');
    expect(vm.isTestingDraftModel).toBe(false);
  });

  test('reports a missing model without making a request', async () => {
    const cid = seedTextConnection('');
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();
    vm.openEditConnection(cid);

    await vm.testDraftModel();

    expect(mockFetchWithCredentialPolicy).not.toHaveBeenCalled();
    expect(vm.draftModelTestResult).toEqual({
      ok: false,
      latencyMs: 0,
      error: 'No model selected',
    });
  });
});
