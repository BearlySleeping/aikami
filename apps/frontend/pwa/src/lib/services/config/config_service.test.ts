// apps/frontend/pwa/src/lib/services/config/config_service.test.ts
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
      expect(service.state.apiKeys).toEqual({});
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
      service.setApiKeys({ openrouter: 'sk-or-abc123' });

      expect(service.state.apiKeys.openrouter).toBe('sk-or-abc123');
    });

    test('setApiKeys should preserve existing keys on partial update', async () => {
      const service = await createService();
      service.setApiKeys({ openrouter: 'sk-or-abc', openai: 'sk-oa-xyz' });
      service.setApiKeys({ gemini: 'gm-123' });

      expect(service.state.apiKeys.openrouter).toBe('sk-or-abc');
      expect(service.state.apiKeys.openai).toBe('sk-oa-xyz');
      expect(service.state.apiKeys.gemini).toBe('gm-123');
    });

    test('setApiKeys should overwrite existing key', async () => {
      const service = await createService();
      service.setApiKeys({ openrouter: 'old' });
      service.setApiKeys({ openrouter: 'new' });

      expect(service.state.apiKeys.openrouter).toBe('new');
    });

    test('setApiKeys with undefined provider should keep it undefined', async () => {
      const service = await createService();
      expect(service.state.apiKeys.anthropic).toBeUndefined();
    });
  });

  describe('AC-2: save encrypts API keys', () => {
    test('save should call encrypt with vault payload', async () => {
      const service = await createService();
      service.setApiKeys({ openrouter: 'sk-secret' });

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
      service.setApiKeys({ openrouter: 'sk-secret' });

      await service.save();

      const plain = store.get('aikami_config');
      expect(plain).toBeDefined();
      if (!plain) {
        throw new Error('Expected plain config to be defined');
      }
      const parsed = JSON.parse(plain);
      expect(parsed.apiKeys).toBeUndefined();
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

      expect(service.state.apiKeys.openrouter).toBe('sk-restored');
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
      vaultStore.set('__vault', 'not-json');

      const service = await createService();
      await service.load();

      expect(service.isLoaded).toBe(true);
      expect(service.state.apiKeys).toEqual({});
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
      service.setApiKeys({ openrouter: 'sk-secret' });
      service.setPreferredModel('claude-3');

      await service.reset();

      expect(service.state.preferredModel).toBe('');
      expect(service.state.apiKeys).toEqual({});
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
