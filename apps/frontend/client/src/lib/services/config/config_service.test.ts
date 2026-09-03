// apps/frontend/client/src/lib/services/config/config_service.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

const mockLocalStorage = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
};

(globalThis as Record<string, unknown>).localStorage = mockLocalStorage as Storage;

// ---------------------------------------------------------------------------
// Mock crypto_vault
// ---------------------------------------------------------------------------

const vaultStore = new Map<string, string>();
let encryptCalls = 0;
let decryptCalls = 0;
let clearCalls = 0;

mock.module('$lib/views/utils/crypto_vault', () => ({
  encrypt: mock(async (options: { text: string; pin?: string }): Promise<void> => {
    encryptCalls++;
    vaultStore.set('__vault', options.text);
  }),
  decrypt: mock(async (_options: { pin?: string }): Promise<string | undefined> => {
    decryptCalls++;
    return vaultStore.get('__vault');
  }),
  clearVault: mock((): void => {
    clearCalls++;
    vaultStore.delete('__vault');
  }),
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Mock $logger
// ---------------------------------------------------------------------------

mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Mocks for the AI gateway's heavy client adapters (C-322)
// ---------------------------------------------------------------------------
// The connection-visibility tests below import the real aiGatewayService.
// Its composition pulls in TTS / image singletons that
// are irrelevant here — stub them with alias-path module mocks.

mock.module('$lib/services/audio/tts_service.svelte.ts', () => ({
  ttsService: {
    status: 'uninitialized',
    isKokoroServerAvailable: false,
    speak: mock(async () => {}),
  },
  __esModule: true,
}));

mock.module('$lib/services/image/image_generation_service.svelte.ts', () => ({
  imageGenerationService: {
    generateImage: mock(async () => ({})),
  },
  __esModule: true,
}));

// AC-2 requires the gateway to
// see C-230 connections without AI settings populated.
mock.module('$lib/services/settings/ai_settings.svelte.ts', () => ({
  aiSettingsService: {
    get textProvider() {
      return { apiKey: '', endpoint: '', model: '' };
    },
    get imageProvider() {
      return { apiKey: '', endpoint: '', model: '' };
    },
  },
  __esModule: true,
}));

// ---------------------------------------------------------------------------
// Tests: C-079 — ConfigService
// ---------------------------------------------------------------------------

import type { ConfigServiceInterface } from './config_service.svelte.ts';

/** Creates a fresh ConfigService instance for each test. */
const createService = async (): Promise<ConfigServiceInterface> => {
  const mod = await import('./config_service.svelte.ts');
  return mod.ConfigService.create({ className: 'ConfigService' });
};

describe('ConfigService — C-079', () => {
  beforeEach(() => {
    store.clear();
    vaultStore.clear();
    encryptCalls = 0;
    decryptCalls = 0;
    clearCalls = 0;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-2: API Key Management & Sync
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-2: Initial state', () => {
    test('should return default state before load', async () => {
      const service = await createService();

      // C-230: API keys now live in connections[] (no text.apiKeys).
      expect(service.state.connections).toEqual([]);
      expect(service.state.models).toEqual([]);
      expect(service.state.voice.engine).toBe('kokoro');
      expect(service.state.image.checkpoint).toBe('sd_xl_base_1.0');
    });

    test('isLoaded should be false before load', async () => {
      const service = await createService();
      expect(service.isLoaded).toBe(false);
    });

    test('isLoaded should be true after load', async () => {
      const service = await createService();
      await service.load();
      expect(service.isLoaded).toBe(true);
    });
  });

  describe('AC-2: Connection API key management (C-230)', () => {
    const _testParams = {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      repetitionPenalty: 1.1,
      presencePenalty: 0,
      maxTokens: 1024,
      contextSize: 4096,
    };

    const _textConn = (apiKey: string, provider = 'openrouter') => ({
      name: 'Test provider',
      provider,
      apiKey,
      baseUrl: '',
      model: 'provider/model',
      generationParams: _testParams,
      isDefault: false,
    });

    test('addConnection stores the API key readable via getApiKey', async () => {
      const service = await createService();
      service.addConnection(_textConn('sk-or-abc123'));

      expect(service.getApiKey('openrouter')).toBe('sk-or-abc123');
    });

    test('multiple providers keep independent API keys', async () => {
      const service = await createService();
      service.addConnection(_textConn('sk-or-abc', 'openrouter'));
      service.addConnection(_textConn('sk-oa-xyz', 'openai'));
      service.addConnection(_textConn('gm-123', 'google'));

      expect(service.getApiKey('openrouter')).toBe('sk-or-abc');
      expect(service.getApiKey('openai')).toBe('sk-oa-xyz');
      expect(service.getApiKey('google')).toBe('gm-123');
    });

    test('updateConnection replaces the API key', async () => {
      const service = await createService();
      const id = service.addConnection(_textConn('old'));
      service.updateConnection(id, { apiKey: 'new' });

      expect(service.getApiKey('openrouter')).toBe('new');
    });

    test('getApiKey returns undefined for unknown provider', async () => {
      const service = await createService();
      expect(service.getApiKey('anthropic')).toBeUndefined();
    });
  });

  describe('AC-2: save encrypts API keys', () => {
    const _testParams = {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      repetitionPenalty: 1.1,
      presencePenalty: 0,
      maxTokens: 1024,
      contextSize: 4096,
    };

    test('save should call encrypt with vault payload', async () => {
      const service = await createService();
      service.addConnection({
        name: 'OpenRouter',
        provider: 'openrouter',
        apiKey: 'sk-secret',
        baseUrl: '',
        model: 'openrouter/auto',
        generationParams: _testParams,
        isDefault: true,
      });

      await service.save();

      expect(encryptCalls).toBe(1);
    });

    test('save should store plain config in localStorage', async () => {
      const service = await createService();

      await service.save();

      const plain = store.get('aikami_config');
      expect(plain).toBeDefined();

      if (!plain) {
        throw new Error('Expected plain config to be defined');
      }
      const parsed = JSON.parse(plain);
      expect(typeof parsed.models).toBe('object');
    });

    test('save should NOT include API keys in plain localStorage', async () => {
      const service = await createService();
      service.addConnection({
        name: 'OpenRouter',
        provider: 'openrouter',
        apiKey: 'sk-secret',
        baseUrl: '',
        model: 'openrouter/auto',
        generationParams: _testParams,
        isDefault: true,
      });

      await service.save();

      const plain = store.get('aikami_config');
      expect(plain).toBeDefined();
      if (!plain) {
        throw new Error('Expected plain config to be defined');
      }
      const parsed = JSON.parse(plain);
      // Connections (API keys) are only in the encrypted vault.
      expect(parsed.connections).toBeUndefined();
    });
  });

  describe('AC-2: load restores state', () => {
    test('load should call decrypt', async () => {
      const service = await createService();
      await service.load();
      expect(decryptCalls).toBe(1);
    });

    test('load should restore connections from vault', async () => {
      // Pre-populate vault with stored connections (source: 'stored' survives
      // the load-time pruning filter). The default connection (conn-1) is NOT
      // the first match, so the assertion proves default selection rather than
      // first-match fallback.
      vaultStore.set(
        '__vault',
        JSON.stringify({
          connections: [
            {
              id: 'conn-2',
              name: 'OpenRouter (legacy)',
              provider: 'openrouter',
              apiKey: 'sk-fallback',
              baseUrl: '',
              model: 'openrouter/auto',
              generationParams: {},
              isDefault: false,
              source: 'stored',
            },
            {
              id: 'conn-1',
              name: 'OpenRouter',
              provider: 'openrouter',
              apiKey: 'sk-restored',
              baseUrl: '',
              model: 'openrouter/auto',
              generationParams: {},
              isDefault: true,
              source: 'stored',
            },
          ],
          defaultConnectionId: 'conn-1',
        }),
      );

      const service = await createService();
      await service.load();

      // The default connection (conn-1) wins over the first match (conn-2).
      expect(service.getApiKey('openrouter')).toBe('sk-restored');
    });

    test('load keeps a keyless llamacpp connection (detected or env source), same as ollama/ooba', async () => {
      // C-406: llamacpp is a distinct local provider from ollama — it must
      // survive the load-time prune the same way ollama/ooba do, or a
      // reload would silently drop the auto-seeded local-stack connection.
      vaultStore.set(
        '__vault',
        JSON.stringify({
          connections: [
            {
              id: 'conn-detected',
              name: 'llama.cpp (local)',
              provider: 'llamacpp',
              apiKey: '',
              baseUrl: 'http://localhost:11434/v1',
              model: 'qwen2.5-1.5b-instruct',
              generationParams: {},
              isDefault: true,
              source: 'detected',
            },
          ],
          defaultConnectionId: 'conn-detected',
        }),
      );

      const service = await createService();
      await service.load();

      expect(service.state.connections).toHaveLength(1);
      expect(service.state.connections[0].provider).toBe('llamacpp');
    });

    test('load should restore plain config from localStorage', async () => {
      store.set(
        'aikami_config',
        JSON.stringify({
          preferredModel: 'gpt-4',
          memory: { contextWindow: 32768 },
        }),
      );

      const service = await createService();
      await service.load();

      // preferredModel and memory are no longer stored
      expect(service.state.voice.engine).toBe('kokoro');
    });

    test('load should merge partial plain config with defaults', async () => {
      store.set('aikami_config', JSON.stringify({}));

      const service = await createService();
      await service.load();

      // Defaults should still be present
      expect(service.state.voice.engine).toBe('kokoro');
      expect(service.state.image.width).toBe(1024);
    });

    test('load should work with empty vault and empty localStorage', async () => {
      const service = await createService();
      await service.load();

      // Should have defaults
      expect(service.isLoaded).toBe(true);
    });

    test('load should handle malformed vault gracefully', async () => {
      const service = await createService();
      await service.reset();

      vaultStore.set('__vault', 'not-json');
      await service.load();

      expect(service.isLoaded).toBe(true);
      expect(service.state.connections).toHaveLength(0);
    });

    test('load should handle malformed plain config gracefully', async () => {
      store.set('aikami_config', 'not-json');

      const service = await createService();
      await service.load();

      expect(service.isLoaded).toBe(true);
    });
  });

  describe('AC-2: reset', () => {
    test('reset should clear all state', async () => {
      const service = await createService();
      service.addConnection({
        name: 'OpenRouter',
        provider: 'openrouter',
        apiKey: 'sk-secret',
        baseUrl: '',
        model: 'openrouter/auto',
        generationParams: {},
        isDefault: true,
      });

      await service.reset();

      expect(service.state.connections).toHaveLength(0);
    });

    test('reset should call clearVault', async () => {
      const service = await createService();
      await service.reset();
      expect(clearCalls).toBe(1);
    });

    test('reset should remove plain config from localStorage', async () => {
      store.set('aikami_config', JSON.stringify({ preferredModel: 'test' }));

      const service = await createService();
      await service.reset();

      expect(store.has('aikami_config')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: Domain settings (Voice, Image)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Domain: Voice config', () => {
    test('setVoiceConfig should merge partial config', async () => {
      const service = await createService();
      service.setVoiceConfig({ engine: 'elevenlabs' });

      expect(service.state.voice.engine).toBe('elevenlabs');
      expect(service.state.voice.speed).toBe(1.0); // Default preserved
    });

    test('setVoiceConfig should update all fields', async () => {
      const service = await createService();
      service.setVoiceConfig({
        engine: 'elevenlabs',
        pitch: 5,
        speed: 1.5,
        voiceId: 'rachel',
      });

      expect(service.state.voice.engine).toBe('elevenlabs');
      expect(service.state.voice.pitch).toBe(5);
      expect(service.state.voice.speed).toBe(1.5);
      expect(service.state.voice.voiceId).toBe('rachel');
    });
  });

  describe('Domain: Image config', () => {
    test('setImageConfig should merge partial config', async () => {
      const service = await createService();
      service.setImageConfig({ width: 512 });

      expect(service.state.image.width).toBe(512);
      expect(service.state.image.height).toBe(1024); // Default preserved
    });

    test('setImageConfig should update all fields', async () => {
      const service = await createService();
      service.setImageConfig({
        backend: 'automatic1111',
        cfgScale: 12,
        checkpoint: 'dreamshaper',
        height: 512,
        steps: 20,
        width: 512,
      });

      expect(service.state.image.backend).toBe('automatic1111');
      expect(service.state.image.cfgScale).toBe(12);
      expect(service.state.image.checkpoint).toBe('dreamshaper');
      expect(service.state.image.height).toBe(512);
      expect(service.state.image.steps).toBe(20);
      expect(service.state.image.width).toBe(512);
    });
  });

  describe('Models', () => {
    test('setModels should replace models array', async () => {
      const service = await createService();
      service.setModels([{ model: 'claude-3', provider: 'anthropic', endpoint: '' }]);

      expect(service.state.models.length).toBe(1);
      expect(service.state.models[0].model).toBe('claude-3');
    });

    test('updateModel should update single model by index', async () => {
      const service = await createService();
      service.setModels([
        { model: 'claude-3', provider: 'anthropic', endpoint: '' },
        { model: 'gpt-4', provider: 'openai', endpoint: '' },
      ]);

      service.updateModel(0, { endpoint: 'https://api.anthropic.com' });

      expect(service.state.models[0].endpoint).toBe('https://api.anthropic.com');
      expect(service.state.models[0].model).toBe('claude-3'); // Unchanged
      expect(service.state.models[1].endpoint).toBe(''); // Unchanged
    });

    test('updateModel with out-of-bounds index should no-op', async () => {
      const service = await createService();
      service.setModels([{ model: 'test', provider: 'test', endpoint: '' }]);

      service.updateModel(99, { model: 'should-not-change' });

      expect(service.state.models[0].model).toBe('test');
    });

    test('updateModel with negative index should no-op', async () => {
      const service = await createService();
      service.setModels([{ model: 'test', provider: 'test', endpoint: '' }]);

      service.updateModel(-1, { model: 'should-not-change' });

      expect(service.state.models[0].model).toBe('test');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: C-322 AC-2 — Saved connections visible to gateway text detection
// ---------------------------------------------------------------------------
// Uses the real configService singleton (the same live $state the gateway
// reads) and the real aiGatewayService — no provider fetch stubs. Only the
// gateway's unrelated adapter dependencies are mocked above.

describe('ConfigService × AiGateway — C-322 connection visibility', () => {
  /** Base generation params for test connections. */
  const _params = {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repetitionPenalty: 1.1,
    presencePenalty: 0,
    maxTokens: 1024,
    contextSize: 4096,
  };

  const _getSingletons = async () => {
    const configMod = await import('./config_service.svelte.ts');
    const gatewayMod = await import('../ai/ai_gateway_service.svelte.ts');
    return {
      configService: configMod.configService,
      aiGatewayService: gatewayMod.aiGatewayService,
    };
  };

  const _clearConnections = async () => {
    const { configService } = await _getSingletons();
    configService.state.connections = [];
    configService.state.defaultConnectionId = null;
  };

  beforeEach(async () => {
    await _clearConnections();
  });

  test('a cloud connection saved via addConnection is configured on the next text detection (no reload)', async () => {
    const { configService, aiGatewayService } = await _getSingletons();

    configService.addConnection({
      name: 'OpenRouter',
      provider: 'openrouter',
      apiKey: 'sk-or-test',
      baseUrl: '',
      model: 'openrouter/auto',
      generationParams: _params,
      isDefault: true,
    });

    const result = await aiGatewayService.detect('text');
    expect(result.available).toBe(true);
    expect(result.mode).toBe('byok');
  });

  test('a cloud connection with baseUrl+model but no key is configured', async () => {
    const { configService, aiGatewayService } = await _getSingletons();

    configService.addConnection({
      name: 'Custom endpoint',
      provider: 'custom',
      apiKey: '',
      baseUrl: 'https://llm.example.com/v1',
      model: 'my-model',
      generationParams: _params,
      isDefault: true,
    });

    const result = await aiGatewayService.detect('text');
    expect(result.available).toBe(true);
    expect(result.mode).toBe('byok');
  });

  test('a cloud connection with its own API key is configured', async () => {
    const { configService, aiGatewayService } = await _getSingletons();

    // C-230: API keys live on the connection itself (no shared text.apiKeys).
    configService.addConnection({
      name: 'OpenRouter (own key)',
      provider: 'openrouter',
      apiKey: 'sk-or-shared',
      baseUrl: '',
      model: 'openrouter/auto',
      generationParams: _params,
      isDefault: true,
    });

    const result = await aiGatewayService.detect('text');
    expect(result.available).toBe(true);
    expect(result.mode).toBe('byok');
  });

  test('a local ollama connection does NOT short-circuit as cloud-configured', async () => {
    const { configService, aiGatewayService } = await _getSingletons();

    configService.addConnection({
      name: 'Ollama (local)',
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.2',
      generationParams: _params,
      isDefault: true,
    });

    // The gateway must exercise the real Ollama ping path — the result
    // depends on whether a local Ollama is running, but it must never be
    // reported as byok (cloud-configured).
    const result = await aiGatewayService.detect('text');
    expect(result.mode).not.toBe('byok');
  }, 10_000);

  test('a local llamacpp connection does NOT short-circuit as cloud-configured', async () => {
    // C-406: llamacpp is a distinct local provider from ollama (the
    // local-stack's bundled llama.cpp speaks OpenAI's /v1/models, not
    // Ollama's native API) — it must get the same local-provider treatment
    // as ollama in _hasCloudTextConnection, or detection would wrongly
    // report it as byok/cloud-configured and skip the real local ping.
    const { configService, aiGatewayService } = await _getSingletons();

    configService.addConnection({
      name: 'llama.cpp (local)',
      provider: 'llamacpp',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-1.5b-instruct',
      generationParams: _params,
      isDefault: true,
    });

    const result = await aiGatewayService.detect('text');
    expect(result.mode).not.toBe('byok');
  }, 10_000);

  test('configService read failures during detection degrade instead of throwing', async () => {
    const { configService, aiGatewayService } = await _getSingletons();
    const originalState = configService.state;

    Object.defineProperty(configService, 'state', {
      configurable: true,
      get() {
        throw new Error('vault read failed');
      },
    });

    try {
      const result = await aiGatewayService.detect('text');
      // Must resolve (never throw) and must not claim cloud config.
      expect(result.capability).toBe('text');
      expect(result.mode).not.toBe('byok');
    } finally {
      Object.defineProperty(configService, 'state', {
        configurable: true,
        writable: true,
        value: originalState,
      });
    }
  }, 10_000);
});
