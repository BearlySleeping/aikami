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
      expect(typeof parsed.voice).toBe('object');
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

  // ═══════════════════════════════════════════════════════════════════════
  // Per-capability connection defaults
  //
  // Invariants under test:
  //   1. `defaultByCapability[cap]` is authoritative.
  //   2. `connection.isDefault` is true iff it is its capability's default.
  //   3. `defaultConnectionId` mirrors the text default (legacy alias).
  // ═══════════════════════════════════════════════════════════════════════

  describe('Connection defaults are per-capability', () => {
    const _params = {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      repetitionPenalty: 1,
      presencePenalty: 0,
      maxTokens: 1024,
      contextSize: 4096,
    };

    const _conn = (options: {
      capability: 'text' | 'image' | 'voice';
      provider: string;
      model?: string;
    }) => ({
      name: `${options.provider} (${options.capability})`,
      provider: options.provider,
      capability: options.capability,
      apiKey: 'sk-test',
      baseUrl: '',
      model: options.model ?? `${options.provider}/model`,
      generationParams: _params,
      isDefault: false,
      // load() prunes rows without a recognised source, so user-created
      // connections must carry 'stored' to survive a round trip.
      source: 'stored' as const,
    });

    test('the first connection of each capability becomes that capability default', async () => {
      const service = await createService();
      const textId = service.addConnection(_conn({ capability: 'text', provider: 'openrouter' }));
      const voiceId = service.addConnection(_conn({ capability: 'voice', provider: 'kokoro' }));

      expect(service.state.defaultByCapability.text).toBe(textId);
      expect(service.state.defaultByCapability.voice).toBe(voiceId);
    });

    test('setting a voice default does not steal the text default', async () => {
      const service = await createService();
      service.addConnection(_conn({ capability: 'text', provider: 'openai' }));
      const chosenText = service.addConnection(
        _conn({ capability: 'text', provider: 'anthropic' }),
      );
      const voiceId = service.addConnection(_conn({ capability: 'voice', provider: 'kokoro' }));

      service.setDefaultConnection(chosenText);
      service.setDefaultConnection(voiceId);

      expect(service.state.defaultByCapability.text).toBe(chosenText);
      expect(service.state.defaultByCapability.voice).toBe(voiceId);
      // The text resolution must still honour the chosen text connection,
      // not fall through to insertion order.
      expect(service.getActiveTextProvider().provider).toBe('anthropic');
    });

    test('exactly one connection per capability carries isDefault', async () => {
      const service = await createService();
      const first = service.addConnection(_conn({ capability: 'text', provider: 'openrouter' }));
      const second = service.addConnection(_conn({ capability: 'text', provider: 'openai' }));

      service.setDefaultConnection(second);

      const flagged = service.state.connections.filter((c) => c.isDefault).map((c) => c.id);
      expect(flagged).toEqual([second]);
      expect(service.getConnection(first)?.isDefault).toBe(false);
    });

    test('updateConnection({ isDefault: true }) clears the previous default', async () => {
      const service = await createService();
      const first = service.addConnection(_conn({ capability: 'text', provider: 'openrouter' }));
      const second = service.addConnection(_conn({ capability: 'text', provider: 'openai' }));

      service.updateConnection(second, { isDefault: true });

      const flagged = service.state.connections.filter((c) => c.isDefault).map((c) => c.id);
      expect(flagged).toEqual([second]);
      expect(service.state.defaultByCapability.text).toBe(second);
      expect(service.getConnection(first)?.isDefault).toBe(false);
    });

    test('updateConnection applies the patch to the target connection', async () => {
      const service = await createService();
      const id = service.addConnection(_conn({ capability: 'text', provider: 'openrouter' }));

      service.updateConnection(id, { model: 'anthropic/claude-sonnet-4.5' });

      expect(service.getConnection(id)?.model).toBe('anthropic/claude-sonnet-4.5');
    });

    test('deleting a capability default promotes another of the same capability', async () => {
      const service = await createService();
      const voiceId = service.addConnection(_conn({ capability: 'voice', provider: 'kokoro' }));
      const textA = service.addConnection(_conn({ capability: 'text', provider: 'openrouter' }));
      const textB = service.addConnection(_conn({ capability: 'text', provider: 'openai' }));

      service.setDefaultConnection(textA);
      service.deleteConnection(textA);

      expect(service.state.defaultByCapability.text).toBe(textB);
      expect(service.state.defaultByCapability.voice).toBe(voiceId);
      expect(service.getActiveTextProvider().provider).toBe('openai');
    });

    test('deleting the last connection of a capability clears its default', async () => {
      const service = await createService();
      service.addConnection(_conn({ capability: 'text', provider: 'openrouter' }));
      const voiceId = service.addConnection(_conn({ capability: 'voice', provider: 'kokoro' }));

      service.deleteConnection(voiceId);

      expect(service.state.defaultByCapability.voice ?? null).toBeNull();
      // The unrelated text default survives.
      expect(service.state.defaultByCapability.text).toBeDefined();
    });

    test('per-capability defaults survive a save/load round trip', async () => {
      const service = await createService();
      service.addConnection(_conn({ capability: 'text', provider: 'openrouter' }));
      const textB = service.addConnection(_conn({ capability: 'text', provider: 'openai' }));
      const voiceId = service.addConnection(_conn({ capability: 'voice', provider: 'kokoro' }));
      service.setDefaultConnection(textB);
      await service.save();

      const reloaded = await createService();
      await reloaded.load();

      expect(reloaded.state.defaultByCapability.text).toBe(textB);
      expect(reloaded.state.defaultByCapability.voice).toBe(voiceId);
      expect(reloaded.getActiveTextProvider().provider).toBe('openai');
    });
  });

  describe('Voice and image API keys are encrypted at rest', () => {
    test('save keeps voice and image keys out of plain localStorage', async () => {
      const service = await createService();
      await service.load();
      service.setVoiceConfig({ apiKey: 'el-voice-secret' });
      service.setImageConfig({ apiKey: 'sd-image-secret' });

      await service.save();

      const plain = store.get('aikami_config') ?? '';
      expect(plain).not.toContain('el-voice-secret');
      expect(plain).not.toContain('sd-image-secret');
    });

    test('voice and image keys round-trip through the vault', async () => {
      const service = await createService();
      await service.load();
      service.setVoiceConfig({ apiKey: 'el-voice-secret' });
      service.setImageConfig({ apiKey: 'sd-image-secret' });
      await service.save();

      const reloaded = await createService();
      await reloaded.load();

      expect(reloaded.state.voice.apiKey).toBe('el-voice-secret');
      expect(reloaded.state.image.apiKey).toBe('sd-image-secret');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // The legacy Connection API writes through to the C-463 model.
  //
  // The first C-463 build left `addConnection` appending to the legacy array
  // only, so `providers` / `aiConnections` / `roles` stayed empty for
  // anything created through the UI and `legacy` became load-bearing.
  // ═══════════════════════════════════════════════════════════════════════

  describe('Legacy Connection API writes through', () => {
    const _params = {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      repetitionPenalty: 1,
      presencePenalty: 0,
      maxTokens: 1024,
      contextSize: 4096,
    };
    const _conn = (over: Record<string, unknown> = {}) => ({
      name: 'OpenRouter',
      provider: 'openrouter',
      capability: 'text' as const,
      apiKey: 'sk-or-a',
      baseUrl: '',
      model: 'anthropic/claude-sonnet-4.5',
      generationParams: _params,
      isDefault: false,
      source: 'stored' as const,
      ...over,
    });

    test('addConnection creates a provider, an aiConnection and a role', async () => {
      const service = await createService();
      const id = service.addConnection(_conn());

      expect(service.state.providers).toHaveLength(1);
      expect(service.state.aiConnections).toHaveLength(1);
      expect(service.state.roles.narration).toBe(id);
      expect(service.state.providers[0].credential).toBe('sk-or-a');
      // The legacy array remains readable as a projection.
      expect(service.getConnection(id)?.apiKey).toBe('sk-or-a');
    });

    test('two models on one key share a single provider', async () => {
      const service = await createService();
      service.addConnection(_conn({ model: 'anthropic/claude-sonnet-4.5' }));
      service.addConnection(_conn({ model: 'anthropic/claude-haiku-4.5' }));

      expect(service.state.providers).toHaveLength(1);
      expect(service.state.aiConnections).toHaveLength(2);
    });

    test('two accounts on the same registry stay separate providers', async () => {
      const service = await createService();
      service.addConnection(_conn({ apiKey: 'sk-or-a' }));
      service.addConnection(_conn({ apiKey: 'sk-or-b', model: 'openai/gpt-4o' }));

      expect(service.state.providers).toHaveLength(2);
    });

    test('editing the key updates every connection on that provider', async () => {
      const service = await createService();
      const a = service.addConnection(_conn({ model: 'm1' }));
      const b = service.addConnection(_conn({ model: 'm2' }));

      service.updateConnection(a, { apiKey: 'sk-or-rotated' });

      expect(service.state.providers).toHaveLength(1);
      expect(service.getConnection(a)?.apiKey).toBe('sk-or-rotated');
      expect(service.getConnection(b)?.apiKey).toBe('sk-or-rotated');
      expect(service.getApiKey('openrouter', 'text')).toBe('sk-or-rotated');
    });

    test('updating a direct AI connection preserves params before projection', async () => {
      const service = await createService();
      const params = { ..._params, temperature: 0.25 };
      const id = service.addAiConnection({
        providerId: crypto.randomUUID(),
        capability: 'text',
        label: 'Direct connection',
        model: 'old-model',
        params,
      });

      service.updateConnection(id, { name: 'Renamed connection', model: 'new-model' });

      expect(service.getAiConnection(id)).toMatchObject({
        label: 'Renamed connection',
        model: 'new-model',
        params,
      });
    });

    test('params-only edits replace the legacy projection and persist it', async () => {
      const service = await createService();
      const id = service.addConnection(_conn());
      const previous = service.state.connections[0];
      const generationParams = { ..._params, temperature: 0.25 };

      service.updateConnection(id, { generationParams });
      await service.save();

      expect(service.state.connections[0]).not.toBe(previous);
      expect(service.getConnection(id)?.generationParams).toEqual(generationParams);
      const persisted = JSON.parse(vaultStore.get('__vault') ?? '{}');
      expect(persisted.legacy.connections[0].generationParams).toEqual(generationParams);
    });

    test('deleting the last connection on a provider removes the provider', async () => {
      const service = await createService();
      const id = service.addConnection(_conn());
      service.deleteConnection(id);

      expect(service.state.aiConnections).toHaveLength(0);
      expect(service.state.providers).toHaveLength(0);
      expect(service.state.roles.narration).toBeUndefined();
    });

    test('a UI-created connection survives save + load without the legacy key', async () => {
      const service = await createService();
      await service.load();
      const id = service.addConnection(_conn());
      await service.save();

      // Strip `legacy` from the persisted vault — nothing should depend on it.
      const stored = JSON.parse(vaultStore.get('__vault') ?? '{}');
      delete stored.legacy;
      vaultStore.set('__vault', JSON.stringify(stored));

      const reloaded = await createService();
      await reloaded.load();

      expect(reloaded.getConnection(id)?.model).toBe('anthropic/claude-sonnet-4.5');
      expect(reloaded.getApiKey('openrouter', 'text')).toBe('sk-or-a');
      expect(reloaded.getActiveTextProvider().model).toBe('anthropic/claude-sonnet-4.5');
    });

    test('a vault from the first C-463 build absorbs its legacy-only rows', async () => {
      // providers/connections empty, everything under `legacy` — the exact
      // shape the merged-but-unfixed build produced.
      vaultStore.set(
        '__vault',
        JSON.stringify({
          schemaVersion: 2,
          providers: [],
          connections: [],
          roles: {},
          legacy: {
            connections: [
              {
                id: 'legacy-conn-1',
                name: 'OpenRouter',
                capability: 'text',
                provider: 'openrouter',
                apiKey: 'sk-or-legacy',
                baseUrl: '',
                model: 'anthropic/claude-sonnet-4.5',
                generationParams: _params,
                isDefault: true,
                source: 'stored',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            defaultByCapability: { text: 'legacy-conn-1' },
            defaultConnectionId: 'legacy-conn-1',
          },
        }),
      );

      const service = await createService();
      await service.load();

      expect(service.state.providers).toHaveLength(1);
      expect(service.state.aiConnections).toHaveLength(1);
      // The id is preserved so per-agent overrides keep resolving.
      expect(service.state.aiConnections[0].id).toBe('legacy-conn-1');
      expect(service.state.roles.narration).toBe('legacy-conn-1');
      expect(service.getActiveTextProvider().apiKey).toBe('sk-or-legacy');
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
    // `connections` / `defaultConnectionId` are projections of the C-463
    // model — clearing only those leaves the real rows behind and the next
    // mutation reprojects them back.
    configService.state.providers = [];
    configService.state.aiConnections = [];
    configService.state.roles = {};
    configService.state.connections = [];
    configService.state.defaultByCapability = {};
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
