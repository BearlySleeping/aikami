// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.providers.test.ts
//
// The connection editor's provider surface: which API key field a provider
// shows, and which stored provider ACCOUNT a draft continues. Both matter for
// one user story — pasting your own key against your own endpoint — which is
// exactly what the fixed-origin-only editor left nowhere to do.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { BUILT_IN_PRESETS } from '@aikami/constants';
import type { AiConnection, AiProvider } from '@aikami/types';
import { createAiConnectionStatus } from './ai_connection_status.svelte';

// ── Config port ─────────────────────────────────────────────────────────────

let nextId = 1;
let providers: AiProvider[] = [];
let connections: AiConnection[] = [];
const defaultByCapability: Record<string, string> = {};

const config = {
  state: { voice: { voiceArchetypes: [] }, defaultByCapability },
  load: mock(async () => {}),
  save: mock(async () => {}),
  getProviders: () => providers,
  getProvider: (id: string) => providers.find((provider) => provider.id === id),
  getAiConnections: () => connections,
  getAiConnection: (id: string) => connections.find((connection) => connection.id === id),
  getRoleAssignments: () => ({}),
  getPresets: () => [...BUILT_IN_PRESETS],
  addProvider: (fields: Omit<AiProvider, 'id'>) => {
    const id = `provider-${nextId++}`;
    providers.push({ id, ...fields });
    return id;
  },
  updateProvider: (id: string, patch: Partial<Omit<AiProvider, 'id'>>) => {
    const provider = providers.find((candidate) => candidate.id === id);
    if (provider) {
      Object.assign(provider, patch);
    }
  },
  addAiConnection: (fields: Omit<AiConnection, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = `conn-${nextId++}`;
    connections.push({ id, createdAt: 0, updatedAt: 0, ...fields } as AiConnection);
    return id;
  },
  updateAiConnection: (id: string, patch: Partial<AiConnection>) => {
    const connection = connections.find((candidate) => candidate.id === id);
    if (connection) {
      Object.assign(connection, patch);
    }
  },
  deleteAiConnection: mock((id: string) => {
    connections = connections.filter((connection) => connection.id !== id);
  }),
  setRoleAssignment: mock(() => {}),
  clearRoleAssignment: mock(() => {}),
  setDefaultConnection: (id: string) => {
    defaultByCapability[connections.find((connection) => connection.id === id)?.capability ?? ''] =
      id;
  },
};

// ── Unrelated capabilities (a text-only page never touches them) ────────────

const createAiSettingsViewModel: typeof import('./ai_settings_view_model.svelte').createAiSettingsViewModel =
  async () =>
    (await import('./ai_settings_view_model.svelte')).createAiSettingsViewModel({
      className: 'AiSettingsViewModel',
      capability: 'text',
      config,
      campaign: { activeCampaign: undefined },
      image: {
        checkpoints: [],
        loadCheckpoints: mock(async () => {}),
        generateImage: mock(async () => ({ url: '' })),
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
        download: mock(async () => ({ status: 'not-downloaded' as const })),
        cancel: mock(() => {}),
        checkStatus: mock(async () => ({ status: 'not-downloaded' as const })),
      },
      ai: {
        providerModelFetch: {},
        hasVerificationStrategy: () => false,
        fetchModelsFromProvider: mock(async () => []),
        fetchWithCredentialPolicy: mock(async () => undefined),
        resolveChatTestRequest: () => undefined,
        verifyConnection: mock(async () => ({ ok: true, latencyMs: 1 })),
      },
      status: createAiConnectionStatus(),
    });

const openTextDraft = async (registryId: string) => {
  const vm = await createAiSettingsViewModel();
  await vm.initialize();
  vm.openAddProvider('text');
  vm.setDraftProvider(registryId);
  return vm;
};

const addProvider = (fields: Omit<AiProvider, 'id'>): string => config.addProvider(fields);

beforeEach(() => {
  nextId = 1;
  providers = [];
  connections = [];
  for (const key of Object.keys(defaultByCapability)) {
    delete defaultByCapability[key];
  }
});

// ── API key field ───────────────────────────────────────────────────────────

describe('AI settings editor — the API key field', () => {
  test('a fixed-origin cloud provider requires a key', async () => {
    const vm = await openTextDraft('nanogpt');

    expect(vm.needsApiKey).toBe(true);
    expect(vm.apiKeyIsOptional).toBe(false);
    expect(vm.apiKeyPlaceholder).toBe('Enter API key');
  });

  test('a custom endpoint shows an OPTIONAL key — somewhere to paste one', async () => {
    const vm = await openTextDraft('custom');

    expect(vm.needsApiKey).toBe(true);
    expect(vm.apiKeyIsOptional).toBe(true);
    expect(vm.apiKeyPlaceholder).toBe('Leave empty if the endpoint needs no key');
  });

  test('a keyless local server shows no key field at all', async () => {
    const vm = await openTextDraft('ollama');

    expect(vm.needsApiKey).toBe(false);
  });
});

// ── Account identity ────────────────────────────────────────────────────────

describe('AI settings editor — provider account identity', () => {
  const addCustom = (baseUrl: string, credential: string) =>
    addProvider({
      registryId: 'custom',
      label: 'Custom API',
      baseUrl,
      credential,
      source: 'stored',
    });

  test('a second custom endpoint gets its own account', async () => {
    addCustom('https://a.example.test/v1', 'key-a');
    const vm = await openTextDraft('custom');
    vm.setDraftField('baseUrl', 'https://b.example.test/v1');
    vm.setDraftField('apiKey', 'key-b');
    vm.setDraftField('model', 'b-model');
    await vm.saveDraft();

    expect(providers.map((provider) => provider.baseUrl).sort()).toEqual([
      'https://a.example.test/v1',
      'https://b.example.test/v1',
    ]);
  });

  test('retargeting a connection leaves the account its siblings share intact', async () => {
    const first = addCustom('https://a.example.test/v1', 'key-a');
    const second = addCustom('https://b.example.test/v1', 'key-b');
    const connectionId = config.addAiConnection({
      providerId: second,
      capability: 'text',
      label: 'B',
      model: 'b-model',
      params: {},
    });
    const vm = await createAiSettingsViewModel();
    await vm.initialize();

    vm.openEditConnection(connectionId);
    vm.setDraftField('baseUrl', 'https://c.example.test/v1');
    vm.setDraftField('apiKey', 'key-c');
    await vm.saveDraft();

    expect(providers.find((provider) => provider.id === first)).toMatchObject({
      baseUrl: 'https://a.example.test/v1',
      credential: 'key-a',
    });
    expect(providers.find((provider) => provider.id === second)).toMatchObject({
      baseUrl: 'https://b.example.test/v1',
      credential: 'key-b',
    });
    const moved = connections.find((connection) => connection.id === connectionId);
    expect(providers.find((provider) => provider.id === moved?.providerId)).toMatchObject({
      baseUrl: 'https://c.example.test/v1',
      credential: 'key-c',
    });
  });

  test('retyping an existing endpoint continues that account instead of forking it', async () => {
    addCustom('https://a.example.test/v1', 'key-a');
    const vm = await openTextDraft('custom');
    vm.setDraftField('baseUrl', 'https://a.example.test');
    vm.setDraftField('model', 'a-model');
    await vm.saveDraft();

    expect(providers.length).toBe(1);
    expect(connections[0]?.providerId).toBe(providers[0]?.id);
  });
});
