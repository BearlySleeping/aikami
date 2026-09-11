// apps/frontend/client/src/lib/views/settings/ai/ai_settings_view_model.async.test.ts
//
// Regression coverage for editor async ownership. Every operation below is
// driven by a deferred response (never a sleep): a save awaiting verification,
// a model discovery, and a model chat-test must not mutate editor state once
// the session or draft they belong to has been cancelled, replaced, changed,
// or disposed.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { BUILT_IN_PRESETS } from '@aikami/constants';
import { createDeferred } from '@aikami/utils';
import type { ConnectionTestResult } from '$types';
import { createAiConnectionStatus } from './ai_connection_status.svelte';

// ── Fixtures ────────────────────────────────────────────────────────────────

type ProviderFixture = {
  id: string;
  registryId: string;
  label: string;
  credential?: string;
  baseUrl?: string;
  source: string;
};
type ConnectionFixture = {
  id: string;
  providerId: string;
  capability: string;
  label: string;
  model: string;
  params: Record<string, unknown>;
};

const mockProviders: ProviderFixture[] = [];
const mockAiConnections: ConnectionFixture[] = [];
const mockRoleAssignments: Record<string, string> = {};
const mockDefaultByCapability: Record<string, string> = {};
let nextId = 1;

const mockFetchModelsFromProvider = mock(
  async (): Promise<Array<{ id: string; name: string }>> => [],
);
const mockVerifyConnection = mock(async () => ({ ok: true, latencyMs: 42 }));
const mockHasVerificationStrategy = mock(() => false);
const mockProviderModelFetch: Record<string, unknown> = {
  openrouter: {
    auth: { location: 'header', name: 'Authorization', prefix: 'Bearer ' },
    chatBaseUrl: 'https://openrouter.ai/api/v1',
    url: 'https://openrouter.ai/api/v1/models',
    parseResponse: (_json: unknown) => [],
  },
};
const mockResolveChatTestRequest = mock(
  ({ model, registryId, apiKey }: { model: string; registryId: string; apiKey?: string }) => {
    const config = mockProviderModelFetch[registryId] as { chatBaseUrl?: string } | undefined;
    if (!config?.chatBaseUrl) {
      return undefined;
    }
    return {
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
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
    mockAiConnections.push({ id, ...opts } as ConnectionFixture);
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
  deleteAiConnection: mock(() => {}),
  setRoleAssignment: mock(() => {}),
  setDefaultConnection: mock((connectionId: string) => {
    const connection = mockAiConnections.find((candidate) => candidate.id === connectionId);
    if (connection) {
      mockDefaultByCapability[connection.capability] = connectionId;
    }
  }),
  clearRoleAssignment: mock(() => {}),
  getPresets: mock(() => [...BUILT_IN_PRESETS]),
};

const mockTtsService = {
  speak: mock(async () => {}),
  stop: mock(() => {}),
  reset: mock(() => {}),
  initialize: mock(async () => {}),
  isSynthesizing: false,
  isPlaying: false,
  status: 'uninitialized' as string,
  errorMessage: null as string | null,
};

const mockVoiceModelService = {
  state: { status: 'not-downloaded' } as { status: string; message?: string },
  totalBytes: 0,
  cancel: mock(() => {}),
  download: mock(async () => ({ status: 'ready' })),
};

const mockImageGenerationService = {
  checkpoints: [{ id: 'sd_xl_base_1.0', description: 'SDXL Base' }],
  loadCheckpoints: mock(async () => {}),
  generateImage: mock(async () => ({ url: 'blob:preview-url', isDemo: false })),
};

const mockStyleProfile = { id: 'default', name: 'Default', positiveTags: 'high quality' };
const mockStyleProfileService = {
  profiles: [mockStyleProfile],
  activeProfileId: 'default',
  activeProfile: mockStyleProfile,
  setActiveProfile: mock(() => {}),
};

let createAiSettingsViewModel: typeof import('./ai_settings_view_model.svelte').createAiSettingsViewModel;

const getAiSettingsViewModel = () =>
  createAiSettingsViewModel({
    className: 'AiSettingsViewModel',
    config: mockConfigService,
    campaign: { activeCampaign: undefined },
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
    status: createAiConnectionStatus(),
  });

const seedTextConnection = (model = 'anthropic/claude-sonnet') => {
  const providerId = mockConfigService.addProvider({
    registryId: 'openrouter',
    label: 'OpenRouter',
    credential: 'sk-or-v1-test-key',
  });
  return mockConfigService.addAiConnection({
    providerId,
    capability: 'text',
    label: 'Sonnet',
    model,
    params: {},
  });
};

const openNewTextDraft = async () => {
  const vm = getAiSettingsViewModel();
  await vm.initialize();
  vm.openAddProvider('text');
  vm.setDraftProvider('openrouter');
  vm.setDraftField('apiKey', 'sk-typo');
  return vm;
};

const okResponse = () => new Response('{}', { status: 200 });

beforeEach(async () => {
  mockProviders.length = 0;
  mockAiConnections.length = 0;
  for (const key of Object.keys(mockRoleAssignments)) {
    delete mockRoleAssignments[key];
  }
  for (const capability of Object.keys(mockDefaultByCapability)) {
    delete mockDefaultByCapability[capability];
  }
  nextId = 1;
  mockConfigService.save.mockClear();
  mockConfigService.addProvider.mockClear();
  mockConfigService.addAiConnection.mockClear();
  mockConfigService.updateAiConnection.mockClear();
  mockConfigService.updateProvider.mockClear();
  mockFetchModelsFromProvider.mockReset();
  mockFetchModelsFromProvider.mockImplementation(async () => []);
  mockFetchWithCredentialPolicy.mockReset();
  mockFetchWithCredentialPolicy.mockImplementation(async () => new Response('{}', { status: 200 }));
  mockVerifyConnection.mockReset();
  mockVerifyConnection.mockImplementation(async () => ({ ok: true, latencyMs: 42 }));
  mockHasVerificationStrategy.mockReturnValue(false);
  mockTtsService.stop.mockClear();
  mockTtsService.speak.mockClear();

  const module = await import('./ai_settings_view_model.svelte');
  createAiSettingsViewModel = module.createAiSettingsViewModel;
});

// ── The save gate owns the draft it verified ────────────────────────────────

describe('AiSettingsViewModel async — save verification ownership', () => {
  test('cancelling during save verification abandons the save instead of writing a reset draft', async () => {
    mockHasVerificationStrategy.mockReturnValue(true);
    const verification = createDeferred<ConnectionTestResult, Error>();
    mockVerifyConnection.mockImplementationOnce(async () => verification.promise);

    const vm = await openNewTextDraft();
    const save = vm.saveDraft();
    vm.cancelEdit();
    verification.resolve({ ok: true, latencyMs: 10 });
    await save;

    expect(mockConfigService.addAiConnection).not.toHaveBeenCalled();
    expect(vm.isEditorOpen).toBeFalse();
  });

  test('editing the draft during save verification abandons the stale save', async () => {
    mockHasVerificationStrategy.mockReturnValue(true);
    const verification = createDeferred<ConnectionTestResult, Error>();
    mockVerifyConnection.mockImplementationOnce(async () => verification.promise);

    const vm = await openNewTextDraft();
    const save = vm.saveDraft();
    vm.setDraftField('apiKey', 'sk-other');
    verification.resolve({ ok: true, latencyMs: 10 });
    await save;

    expect(mockConfigService.addAiConnection).not.toHaveBeenCalled();
    expect(vm.isEditorOpen).toBeTrue();
  });

  test('an unchanged draft still commits after verification', async () => {
    mockHasVerificationStrategy.mockReturnValue(true);
    const verification = createDeferred<ConnectionTestResult, Error>();
    mockVerifyConnection.mockImplementationOnce(async () => verification.promise);

    const vm = await openNewTextDraft();
    const save = vm.saveDraft();
    verification.resolve({ ok: true, latencyMs: 10 });
    await save;

    expect(mockConfigService.addAiConnection).toHaveBeenCalledTimes(1);
  });

  test('a second save while the first is persisting is ignored', async () => {
    const persist = createDeferred<void, Error>();
    mockConfigService.save.mockImplementationOnce(async () => persist.promise);

    const vm = await openNewTextDraft();
    const first = vm.saveDraft();
    const second = vm.saveDraft();
    await second;

    expect(mockConfigService.addAiConnection).toHaveBeenCalledTimes(1);

    persist.resolve();
    await first;
    expect(mockConfigService.addAiConnection).toHaveBeenCalledTimes(1);
  });
});

// ── Model discovery belongs to the current editor session ───────────────────

describe('AiSettingsViewModel async — model discovery ownership', () => {
  test('models discovered after the editor closes do not reopen the dropdown', async () => {
    const discovery = createDeferred<Array<{ id: string; name: string }>, Error>();
    mockFetchModelsFromProvider.mockImplementationOnce(async () => discovery.promise);

    const vm = await openNewTextDraft();
    const pending = vm.fetchModels();
    vm.cancelEdit();
    discovery.resolve([{ id: 'gpt-4o', name: 'GPT-4o' }]);
    await pending;

    expect(vm.hasFetchedModels).toBeFalse();
    expect(vm.isModelDropdownOpen).toBeFalse();
    expect(vm.isFetchingModels).toBeFalse();
  });

  test('models for a replaced provider are discarded', async () => {
    const discovery = createDeferred<Array<{ id: string; name: string }>, Error>();
    mockFetchModelsFromProvider.mockImplementationOnce(async () => discovery.promise);

    const vm = await openNewTextDraft();
    const pending = vm.fetchModels();
    vm.setDraftProvider('ollama');
    discovery.resolve([{ id: 'llama3', name: 'Llama 3' }]);
    await pending;

    expect(vm.hasFetchedModels).toBeFalse();
    expect(vm.isFetchingModels).toBeFalse();
  });

  test('an older discovery cannot overwrite a newer result', async () => {
    const first = createDeferred<Array<{ id: string; name: string }>, Error>();
    const second = createDeferred<Array<{ id: string; name: string }>, Error>();
    mockFetchModelsFromProvider
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);

    const vm = await openNewTextDraft();
    const firstPending = vm.fetchModels();
    const secondPending = vm.fetchModels();

    second.resolve([{ id: 'newer', name: 'Newer' }]);
    await secondPending;
    expect(vm.isFetchingModels).toBeFalse();

    first.resolve([{ id: 'older', name: 'Older' }]);
    await firstPending;

    expect(vm.modelOptions.map((model) => model.id)).toEqual(['newer']);
    expect(vm.isFetchingModels).toBeFalse();
  });
});

// ── Model chat-test belongs to the current draft/model ──────────────────────

describe('AiSettingsViewModel async — model chat-test ownership', () => {
  test('a test finishing for a previous model cannot report success on the new one', async () => {
    const cid = seedTextConnection();
    const vm = getAiSettingsViewModel();
    await vm.initialize();
    vm.openEditConnection(cid);

    const request = createDeferred<Response, Error>();
    mockFetchWithCredentialPolicy.mockImplementationOnce(async () => request.promise);

    const pending = vm.testDraftModel();
    vm.setModelQuery('openai/gpt-4o');
    request.resolve(okResponse());
    await pending;

    expect(vm.draftModelTestResult).toBeUndefined();
    expect(vm.isTestingDraftModel).toBeFalse();
  });

  test("an older test cannot clear a newer test's loading flag", async () => {
    const cid = seedTextConnection();
    const vm = getAiSettingsViewModel();
    await vm.initialize();
    vm.openEditConnection(cid);

    const first = createDeferred<Response, Error>();
    const second = createDeferred<Response, Error>();
    mockFetchWithCredentialPolicy
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);

    const firstPending = vm.testDraftModel();
    const secondPending = vm.testDraftModel();

    first.resolve(okResponse());
    await firstPending;
    expect(vm.isTestingDraftModel).toBeTrue();
    expect(vm.draftModelTestResult).toBeUndefined();

    second.resolve(okResponse());
    await secondPending;
    expect(vm.draftModelTestResult?.ok).toBe(true);
    expect(vm.isTestingDraftModel).toBeFalse();
  });

  test('invalidating a model test aborts its owned request', async () => {
    const cid = seedTextConnection();
    const vm = getAiSettingsViewModel();
    await vm.initialize();
    vm.openEditConnection(cid);

    mockFetchWithCredentialPolicy.mockImplementationOnce(
      async () => new Promise<Response>(() => {}),
    );

    void vm.testDraftModel();
    const [options] = mockFetchWithCredentialPolicy.mock.calls[0] as [
      { init: { signal: AbortSignal } },
    ];
    expect(options.init.signal.aborted).toBeFalse();

    vm.setModelQuery('openai/gpt-4o');

    expect(options.init.signal.aborted).toBeTrue();
  });
});

// ── Disposal invalidates VM-owned work, not shared services ─────────────────

describe('AiSettingsViewModel async — disposal', () => {
  test('disposing invalidates in-flight discovery without stopping shared TTS', async () => {
    const discovery = createDeferred<Array<{ id: string; name: string }>, Error>();
    mockFetchModelsFromProvider.mockImplementationOnce(async () => discovery.promise);

    const vm = await openNewTextDraft();
    const pending = vm.fetchModels();
    await vm.dispose();
    discovery.resolve([{ id: 'late', name: 'Late' }]);
    await pending;

    expect(vm.hasFetchedModels).toBeFalse();
    expect(vm.isFetchingModels).toBeFalse();
    expect(mockTtsService.stop).not.toHaveBeenCalled();
  });
});
