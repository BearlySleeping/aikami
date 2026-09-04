// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.test.ts
//
// C-465 AC-1/2/3/4/5/6/7/8: AI Settings section tests.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { BUILT_IN_PRESETS } from '@aikami/constants';
import { localServicesMockBase } from '../../../test_preload.ts';

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
let nextId = 1;
const mockFetchModelsFromProvider = mock(async () => []);

const mockConfigService = {
  isLoaded: true,
  state: {
    voice: { voiceArchetypes: [] },
    providers: mockProviders,
    aiConnections: mockAiConnections,
    roles: mockRoleAssignments,
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
  clearRoleAssignment: mock((role: string) => {
    delete mockRoleAssignments[role];
  }),
  getPresets: mock(() => [...BUILT_IN_PRESETS]),
};

// AC-6: real TTS preview.
const mockTtsService = { speak: mock(async (_options: { text: string; voiceId?: string }) => {}) };

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

mock.module('$services', () => ({
  ...localServicesMockBase(),
  configService: mockConfigService,
  // biome-ignore lint/style/useNamingConvention: matches actual $services export name
  PROVIDER_MODEL_FETCH: { openrouter: {} },
  fetchModelsFromProvider: mockFetchModelsFromProvider,
  ttsService: mockTtsService,
  campaignService: mockCampaignService,
  imageGenerationService: mockImageGenerationService,
  styleProfileService: mockStyleProfileService,
}));

let getAiSettingsViewModel: typeof import('./ai_settings_view_model.svelte').getAiSettingsViewModel;
let voicePreviewFallbackLine: typeof import('./ai_settings_view_model.svelte').VOICE_PREVIEW_FALLBACK_LINE;

beforeEach(async () => {
  // Clear all mock state
  mockProviders.length = 0;
  mockAiConnections.length = 0;
  for (const k of Object.keys(mockRoleAssignments)) {
    delete mockRoleAssignments[k];
  }
  nextId = 1;
  mockConfigService.load.mockClear();
  mockConfigService.save.mockClear();
  mockConfigService.addProvider.mockClear();
  mockConfigService.addAiConnection.mockClear();
  mockConfigService.updateProvider.mockClear();
  mockConfigService.updateAiConnection.mockClear();
  mockConfigService.setRoleAssignment.mockClear();
  mockConfigService.clearRoleAssignment.mockClear();
  mockFetchModelsFromProvider.mockClear();
  mockTtsService.speak.mockClear();
  mockCampaignService.activeCampaign = undefined;
  mockImageGenerationService.checkpoints = [{ id: 'sd_xl_base_1.0', description: 'SDXL Base' }];
  mockImageGenerationService.loadCheckpoints.mockClear();
  mockImageGenerationService.generateImage.mockClear();
  mockStyleProfileService.setActiveProfile.mockClear();

  ({ getAiSettingsViewModel, VOICE_PREVIEW_FALLBACK_LINE: voicePreviewFallbackLine } = await import(
    './ai_settings_view_model.svelte'
  ));
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
});

describe('AiSettingsViewModel — AC-3: Key conflict prompt', () => {
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

  test('shows connected for text when a text connection exists', async () => {
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
    expect(textEntry?.status).toBe('connected');
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
    expect(vm.statusEntries.find((entry) => entry.capability === 'text')?.status).toBe('loading');

    vm.testingIds.delete(connectionId);
    vm.testResults[connectionId] = { ok: false, latencyMs: 10, error: 'Rejected' };
    expect(vm.statusEntries.find((entry) => entry.capability === 'text')?.status).toBe('offline');

    vm.testResults[connectionId] = { ok: true, latencyMs: 42 };
    const textEntry = vm.statusEntries.find((entry) => entry.capability === 'text');
    expect(textEntry?.status).toBe('connected');
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
