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

mock.module('$lib/utils/crypto_vault', () => ({
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
// Its composition pulls in TTS / image / legacy-settings singletons that
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

// No legacy aiSettingsService text config — AC-2 requires the gateway to
// see C-230 connections without any legacy shape populated.
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

      expect(service.state.preferredModel).toBe('');
      expect(service.state.text.apiKeys).toEqual({});
      expect(service.state.models).toEqual([]);
      expect(service.state.memory.contextWindow).toBe(8192);
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

  describe('AC-2: API key mutations', () => {
    test('setApiKeys should merge keys into state', async () => {
      const service = await createService();
      service.setTextApiKey('openrouter', 'sk-or-abc123');

      expect(service.state.text.apiKeys.openrouter).toBe('sk-or-abc123');
    });

    test('setApiKeys should preserve existing keys on partial update', async () => {
      const service = await createService();
      service.setTextApiKey('openrouter', 'sk-or-abc');
      service.setTextApiKey('openai', 'sk-oa-xyz');
      service.setTextApiKey('gemini', 'gm-123');

      expect(service.state.text.apiKeys.openrouter).toBe('sk-or-abc');
      expect(service.state.text.apiKeys.openai).toBe('sk-oa-xyz');
      expect(service.state.text.apiKeys.gemini).toBe('gm-123');
    });

    test('setApiKeys should overwrite existing key', async () => {
      const service = await createService();
      service.setTextApiKey('openrouter', 'old');
      service.setTextApiKey('openrouter', 'new');

      expect(service.state.text.apiKeys.openrouter).toBe('new');
    });

    test('setApiKeys with undefined provider should keep it undefined', async () => {
      const service = await createService();
      expect(service.state.text.apiKeys.anthropic).toBeUndefined();
    });
  });

  describe('AC-2: save encrypts API keys', () => {
    test('save should call encrypt with vault payload', async () => {
      const service = await createService();
      service.setTextApiKey('openrouter', 'sk-secret');

      await service.save();

      expect(encryptCalls).toBe(1);
    });

    test('save should store plain config in localStorage', async () => {
      const service = await createService();
      service.setPreferredModel('claude-3-opus');
      service.setMemoryConfig({ contextWindow: 16384 });

      await service.save();

      const plain = store.get('aikami_config');
      expect(plain).toBeDefined();

      if (!plain) {
        throw new Error('Expected plain config to be defined');
      }
      const parsed = JSON.parse(plain);
      expect(parsed.preferredModel).toBe('claude-3-opus');
      expect(parsed.memory.contextWindow).toBe(16384);
    });

    test('save should NOT include API keys in plain localStorage', async () => {
      const service = await createService();
      service.setTextApiKey('openrouter', 'sk-secret');

      await service.save();

      const plain = store.get('aikami_config');
      expect(plain).toBeDefined();
      if (!plain) {
        throw new Error('Expected plain config to be defined');
      }
      const parsed = JSON.parse(plain);
      expect(parsed.text?.apiKeys).toBeUndefined();
    });
  });

  describe('AC-2: load restores state', () => {
    test('load should call decrypt', async () => {
      const service = await createService();
      await service.load();
      expect(decryptCalls).toBe(1);
    });

    test('load should restore API keys from vault', async () => {
      // Pre-populate vault
      vaultStore.set('__vault', JSON.stringify({ apiKeys: { openrouter: 'sk-restored' } }));

      const service = await createService();
      await service.load();

      expect(service.state.text.apiKeys.openrouter).toBe('sk-restored');
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

      expect(service.state.preferredModel).toBe('gpt-4');
      expect(service.state.memory.contextWindow).toBe(32768);
    });

    test('load should merge partial plain config with defaults', async () => {
      store.set('aikami_config', JSON.stringify({ preferredModel: 'gemini-pro' }));

      const service = await createService();
      await service.load();

      expect(service.state.preferredModel).toBe('gemini-pro');
      // Defaults should still be present
      expect(service.state.voice.engine).toBe('kokoro');
      expect(service.state.image.width).toBe(1024);
    });

    test('load should work with empty vault and empty localStorage', async () => {
      const service = await createService();
      await service.load();

      // Should have defaults
      expect(service.state.preferredModel).toBe('');
      expect(service.isLoaded).toBe(true);
    });

    test('load should handle malformed vault gracefully', async () => {
      const service = await createService();
      await service.reset();

      vaultStore.set('__vault', 'not-json');
      await service.load();

      expect(service.isLoaded).toBe(true);
      expect(Object.keys(service.state.text.apiKeys)).toHaveLength(0);
    });

    test('load should handle malformed plain config gracefully', async () => {
      store.set('aikami_config', 'not-json');

      const service = await createService();
      await service.load();

      expect(service.isLoaded).toBe(true);
      expect(service.state.preferredModel).toBe('');
    });
  });

  describe('AC-2: reset', () => {
    test('reset should clear all state', async () => {
      const service = await createService();
      service.setTextApiKey('openrouter', 'sk-secret');
      service.setPreferredModel('claude-3');

      await service.reset();

      expect(service.state.preferredModel).toBe('');
      expect(Object.keys(service.state.text.apiKeys)).toHaveLength(0);
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
  // AC-4: Domain settings (Memory, Voice, Image)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Domain: Memory config', () => {
    test('setMemoryConfig should merge partial config', async () => {
      const service = await createService();
      service.setMemoryConfig({ contextWindow: 32768 });

      expect(service.state.memory.contextWindow).toBe(32768);
      expect(service.state.memory.maxTurns).toBe(50); // Default preserved
    });

    test('setMemoryConfig should update all fields', async () => {
      const service = await createService();
      service.setMemoryConfig({
        contextWindow: 4096,
        longTermMemory: true,
        maxTurns: 25,
        summarizationThreshold: 10,
      });

      expect(service.state.memory.contextWindow).toBe(4096);
      expect(service.state.memory.longTermMemory).toBe(true);
      expect(service.state.memory.maxTurns).toBe(25);
      expect(service.state.memory.summarizationThreshold).toBe(10);
    });
  });

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
    configService.state.text.apiKeys = {};
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

  test('a cloud connection using a shared provider API key (text.apiKeys) is configured', async () => {
    const { configService, aiGatewayService } = await _getSingletons();

    configService.setTextApiKey('openrouter', 'sk-or-shared');
    configService.addConnection({
      name: 'OpenRouter (shared key)',
      provider: 'openrouter',
      apiKey: '',
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
