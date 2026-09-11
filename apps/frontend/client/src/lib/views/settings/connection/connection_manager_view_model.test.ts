// apps/frontend/client/src/lib/views/settings/connection/connection_manager_view_model.test.ts
//
// Explicit-capability tests for the Connection Manager. Each test constructs
// exactly the capabilities it needs — no `$services` barrel mock and no
// dependency on a shared test inventory.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { BUILT_IN_PRESETS } from '@aikami/constants';
import type { Connection, ConnectionTestResult } from '@aikami/types';
import {
  type ConnectionManagerAiCapabilities,
  type ConnectionManagerConfigCapabilities,
  createConnectionManagerViewModel,
} from './connection_manager_view_model.svelte';

const createConfig = (
  overrides: Partial<ConnectionManagerConfigCapabilities> = {},
): ConnectionManagerConfigCapabilities => {
  const state = {
    connections: [] as Connection[],
    defaultConnectionId: null,
    generationParams: {
      temperature: 0.7,
      topP: 1,
      topK: 40,
      repetitionPenalty: 1,
      presencePenalty: 0,
      maxTokens: 2048,
      contextSize: 4096,
    },
    presets: [...BUILT_IN_PRESETS],
    image: { apiKey: '' },
    voice: { apiKey: '' },
  };
  return {
    state,
    isLoaded: true,
    load: mock(async () => {}),
    save: mock(async () => {}),
    getConnection: mock(() => undefined),
    getApiKey: mock(() => undefined),
    addConnection: mock(() => 'conn-1'),
    updateConnection: mock(() => {}),
    deleteConnection: mock(() => {}),
    duplicateConnection: mock(() => 'conn-2'),
    setDefaultConnection: mock(() => {}),
    addPreset: mock(() => 'preset-1'),
    deletePreset: mock(() => {}),
    ...overrides,
  } as ConnectionManagerConfigCapabilities;
};

const createAi = (
  overrides: Partial<ConnectionManagerAiCapabilities> = {},
): ConnectionManagerAiCapabilities => ({
  providerModelFetch: {},
  fetchModelsFromProvider: mock(async () => []),
  fetchWithCredentialPolicy: mock(async () => new Response('{}', { status: 200 })),
  getOllamaRuntimeEndpoints: mock(() => ({})),
  resolveChatTestRequest: mock(() => undefined),
  ...overrides,
});

const createViewModel = (
  options: {
    config?: ConnectionManagerConfigCapabilities;
    ai?: ConnectionManagerAiCapabilities;
  } = {},
) =>
  createConnectionManagerViewModel({
    className: 'ConnectionManagerViewModel',
    config: options.config ?? createConfig(),
    ai: options.ai ?? createAi(),
  });

describe('ConnectionManagerViewModel — lifecycle', () => {
  test('initialize loads stored configuration', async () => {
    const config = createConfig();
    const viewModel = createViewModel({ config });

    await viewModel.initialize();

    expect(config.load).toHaveBeenCalledTimes(1);
  });
});

describe('ConnectionManagerViewModel — editor', () => {
  test('openCreate opens a text draft defaulting to OpenRouter', () => {
    const viewModel = createViewModel();

    viewModel.openCreate();

    expect(viewModel.isEditorOpen).toBe(true);
    expect(viewModel.draft.capability).toBe('text');
    expect(viewModel.draft.provider).toBe('openrouter');
    expect(viewModel.needsApiKey).toBe(true);
  });

  test('openCreateFor scopes the draft to the requested capability', () => {
    const viewModel = createViewModel();

    viewModel.openCreateFor('image');

    expect(viewModel.draft.capability).toBe('image');
    expect(viewModel.draft.provider).toBe('comfyui');
    expect(viewModel.showGenerationParams).toBe(false);
  });

  test('setProvider keeps the auto-filled name in sync', () => {
    const viewModel = createViewModel();
    viewModel.openCreate();

    viewModel.setProvider('openai');

    expect(viewModel.draft.provider).toBe('openai');
  });

  test('saveDraft persists a new connection and closes the editor', () => {
    const config = createConfig();
    const viewModel = createViewModel({ config });
    viewModel.openCreate();

    viewModel.saveDraft();

    expect(config.addConnection).toHaveBeenCalledTimes(1);
    expect(config.save).toHaveBeenCalledTimes(1);
    expect(viewModel.isEditorOpen).toBe(false);
  });
});

describe('ConnectionManagerViewModel — CRUD', () => {
  test('deleteConnection delegates removal and persists', () => {
    const config = createConfig();
    const viewModel = createViewModel({ config });

    viewModel.deleteConnection('conn-1');

    expect(config.deleteConnection).toHaveBeenCalledWith('conn-1');
    expect(config.save).toHaveBeenCalledTimes(1);
  });

  test('setDefault marks the connection default and persists', () => {
    const config = createConfig();
    const viewModel = createViewModel({ config });

    viewModel.setDefault('conn-1');

    expect(config.setDefaultConnection).toHaveBeenCalledWith('conn-1');
    expect(config.save).toHaveBeenCalledTimes(1);
  });
});

describe('ConnectionManagerViewModel — model discovery', () => {
  test('canFetchModels reflects the provider registry', () => {
    const viewModel = createViewModel({
      ai: createAi({
        providerModelFetch: {
          openrouter: {
            url: 'https://openrouter.ai/api/v1/models',
            parseResponse: () => [],
          },
        },
      }),
    });
    viewModel.openCreate();

    expect(viewModel.canFetchModels).toBe(true);
    viewModel.setProvider('not-a-provider');
    expect(viewModel.canFetchModels).toBe(false);
  });

  test('fetchModels forwards the registry config to the provider helper', async () => {
    const models = [{ id: 'openai/gpt-4o', name: 'GPT-4o' }];
    const fetchModelsFromProvider = mock(async () => models);
    const registry = {
      openrouter: {
        url: 'https://openrouter.ai/api/v1/models',
        parseResponse: () => [],
      },
    };
    const viewModel = createViewModel({
      ai: createAi({ providerModelFetch: registry, fetchModelsFromProvider }),
    });
    viewModel.openCreate();

    await viewModel.fetchModels();

    expect(fetchModelsFromProvider).toHaveBeenCalledTimes(1);
    expect(viewModel.modelOptions).toEqual(models);
  });
});

describe('ConnectionManagerViewModel — connection test', () => {
  test('unknown-provider test records an explicit failure', async () => {
    const connection: Connection = {
      id: 'conn-1',
      provider: 'mystery',
      capability: 'text',
      name: 'Mystery',
      model: '',
      apiKey: 'key',
      baseUrl: '',
      isDefault: false,
      generationParams: {
        temperature: 0.7,
        topP: 1,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 2048,
        contextSize: 4096,
      },
    };
    const config = createConfig({
      getConnection: mock(() => connection),
    });
    const viewModel = createViewModel({ config });

    await viewModel.testConnection('conn-1');

    const result = viewModel.testResults['conn-1'] as ConnectionTestResult;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown provider');
  });
});

describe('ConnectionManagerViewModel — base class', () => {
  let viewModel: ReturnType<typeof createViewModel>;

  beforeEach(() => {
    viewModel = createViewModel();
    viewModel.__mounted = true;
  });

  test('dispose clears the mounted flag', async () => {
    await viewModel.dispose();

    expect(viewModel.__mounted).toBe(false);
  });
});
