// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.test.ts
//
// C-465 AC-1/2/3/4/5/6/7/8: AI Settings section tests.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
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
  updateAiConnection: mock((_id: string, _patch: Record<string, unknown>) => {}),
  updateProvider: mock((_id: string, _patch: Record<string, unknown>) => {}),
  deleteAiConnection: mock((id: string) => {
    const idx = mockAiConnections.findIndex((c) => c.id === id);
    if (idx >= 0) mockAiConnections.splice(idx, 1);
  }),
  setRoleAssignment: mock((role: string, connectionId: string) => {
    mockRoleAssignments[role] = connectionId;
  }),
  clearRoleAssignment: mock((role: string) => {
    delete mockRoleAssignments[role];
  }),
};

mock.module('$services', () => ({
  ...localServicesMockBase(),
  configService: mockConfigService,
  PROVIDER_MODEL_FETCH: { openrouter: {} },
  fetchModelsFromProvider: mock(async () => []),
}));

let getAiSettingsViewModel: typeof import('./ai_settings_view_model.svelte').getAiSettingsViewModel;

beforeEach(async () => {
  // Clear all mock state
  mockProviders.length = 0;
  mockAiConnections.length = 0;
  Object.keys(mockRoleAssignments).forEach((k) => delete mockRoleAssignments[k]);
  nextId = 1;
  mockConfigService.load.mockClear();
  mockConfigService.save.mockClear();
  mockConfigService.addProvider.mockClear();
  mockConfigService.addAiConnection.mockClear();
  mockConfigService.setRoleAssignment.mockClear();
  mockConfigService.clearRoleAssignment.mockClear();

  ({ getAiSettingsViewModel } = await import('./ai_settings_view_model.svelte'));
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

    expect(mockConfigService.updateAiConnection).toHaveBeenCalled();
  });
});

describe('AiSettingsViewModel — AC-8: Generation params stay silent', () => {
  test('opening the editor does not write default params', async () => {
    const vm = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
    await vm.initialize();

    vm.openAddProvider();

    // Opening the editor should NOT trigger any save or connection update
    expect(mockConfigService.addAiConnection).not.toHaveBeenCalled();
    expect(mockConfigService.save).not.toHaveBeenCalled();
  });
});
