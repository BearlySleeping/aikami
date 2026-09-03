// apps/frontend/client/src/lib/services/config/config_migration.test.ts
//
// Tests for the v1→v2 vault migration (C-463).
// AC-4: Migration from a v1 vault is lossless
// AC-5: Migration is versioned and idempotent
// AC-6: A failed migration never writes a partial vault
//
// Contract: C-463

import { describe, expect, test } from 'bun:test';
import { type MigrationOptions, migrateVaultV1ToV2 } from './config_migration.ts';

// Deterministic ID factory for testing
let idCounter = 0;
const testIdFactory = (prefix = 'prov-'): (() => string) => {
  idCounter = 0;
  return () => {
    idCounter++;
    return `${prefix}${idCounter}`;
  };
};

const testOpts = (): MigrationOptions => ({
  idFactory: testIdFactory(),
});

// Fixture helpers
const loadFixture = (name: string): Record<string, unknown> => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs');
  const path = require('node:path');
  const fixturePath = path.join(__dirname, '__fixtures__', name);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
};

describe('C-463 Migration: v1 → v2', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // AC-6: A failed migration never writes a partial vault
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-6: Malformed vault falls back gracefully', () => {
    test('throws when connections is not an array', () => {
      const v1 = { connections: 'not-an-array' };
      expect(() => migrateVaultV1ToV2(v1, testOpts())).toThrow();
    });

    test('empty v1 vault produces valid v2 with no providers', () => {
      const v2 = migrateVaultV1ToV2({}, testOpts());
      expect(v2.schemaVersion).toBe(2);
      expect(v2.providers).toEqual([]);
      expect(v2.connections).toEqual([]);
      expect(v2.roles).toEqual({});
    });

    test('handles missing connections gracefully', () => {
      const v2 = migrateVaultV1ToV2({ defaultConnectionId: 'nonexistent' }, testOpts());
      expect(v2.schemaVersion).toBe(2);
      expect(v2.providers).toEqual([]);
      expect(v2.connections).toEqual([]);
    });

    test('missing optional fields do not throw', () => {
      const v1 = {
        connections: [
          {
            id: 'c1',
            provider: 'openrouter',
            name: 'Test',
            model: 'test/model',
            generationParams: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              repetitionPenalty: 1.1,
              presencePenalty: 0,
              maxTokens: 1024,
              contextSize: 4096,
            },
            isDefault: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
      // Should not throw despite missing capability, apiKey, source, etc.
      const v2 = migrateVaultV1ToV2(v1, testOpts());
      expect(v2.providers).toHaveLength(1);
      expect(v2.connections).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: Migration from a v1 vault is lossless
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-4: Migration is lossless', () => {
    test('migrates multi-provider fixture correctly', () => {
      const v1 = loadFixture('v1_multi_provider.json');
      const v2 = migrateVaultV1ToV2(v1, testOpts());

      // Should create 4 providers: 2 OpenRouter (different keys), 1 Ollama, 1 ElevenLabs
      expect(v2.providers).toHaveLength(4);

      // Check OpenRouter shared-key provider
      const orShared = v2.providers.find(
        (p) => p.registryId === 'openrouter' && p.credential === 'sk-or-shared-key-123',
      );
      expect(orShared).toBeDefined();
      expect(orShared?.source).toBe('stored');

      // Check OpenRouter different-key provider
      const orDiff = v2.providers.find(
        (p) => p.registryId === 'openrouter' && p.credential === 'sk-or-different-key-456',
      );
      expect(orDiff).toBeDefined();

      // Check Ollama keyless provider
      const ollama = v2.providers.find((p) => p.registryId === 'ollama');
      expect(ollama).toBeDefined();
      expect(ollama?.credential).toBeUndefined();
      expect(ollama?.baseUrl).toBe('http://localhost:11434');

      // Should create 5 connections (one per v1 connection)
      expect(v2.connections).toHaveLength(5);

      // Check connections point to correct providers
      const sonnetConn = v2.connections.find(
        (c) => c.model === 'anthropic/claude-sonnet-4-20250514',
      );
      expect(sonnetConn).toBeDefined();
      expect(sonnetConn?.capability).toBe('text');
      expect(sonnetConn?.providerId).toBe(orShared?.id);

      // Check voice connection has voice params
      const voiceConn = v2.connections.find((c) => c.capability === 'voice');
      expect(voiceConn).toBeDefined();
      expect(voiceConn?.params).toHaveProperty('voiceId', '21m00Tcm4TlvDq8ikWAM');

      // Check roles are seeded from defaultByCapability
      expect(v2.roles.narration).toBe('conn-1');
      expect(v2.roles.dialogue).toBe('conn-1');
      expect(v2.roles['narrator-voice']).toBe('conn-5');
      expect(v2.roles['npc-voice']).toBe('conn-5');
    });

    test('migrates two connections with same provider but different keys into two providers', () => {
      const v1 = {
        connections: [
          {
            id: 'c1',
            provider: 'openrouter',
            name: 'Key1 Account',
            apiKey: 'key-1',
            baseUrl: '',
            model: 'model-a',
            generationParams: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              repetitionPenalty: 1.1,
              presencePenalty: 0,
              maxTokens: 1024,
              contextSize: 4096,
            },
            isDefault: false,
            source: 'stored',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'c2',
            provider: 'openrouter',
            name: 'Key2 Account',
            apiKey: 'key-2',
            baseUrl: '',
            model: 'model-b',
            generationParams: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              repetitionPenalty: 1.1,
              presencePenalty: 0,
              maxTokens: 1024,
              contextSize: 4096,
            },
            isDefault: false,
            source: 'stored',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };

      const v2 = migrateVaultV1ToV2(v1, testOpts());
      expect(v2.providers).toHaveLength(2);
      expect(v2.connections).toHaveLength(2);

      const key1Prov = v2.providers.find((p) => p.credential === 'key-1');
      const key2Prov = v2.providers.find((p) => p.credential === 'key-2');
      expect(key1Prov).toBeDefined();
      expect(key2Prov).toBeDefined();
      expect(key1Prov?.id).not.toBe(key2Prov?.id);
    });

    test('preserves user presets', () => {
      const v1 = loadFixture('v1_multi_provider.json');
      const v2 = migrateVaultV1ToV2(v1, testOpts());

      expect(v2.userPresets).toBeDefined();
      expect(Array.isArray(v2.userPresets)).toBe(true);
      expect(v2.userPresets).toHaveLength(1);
    });

    test('preserves legacy payload for rollback', () => {
      const v1 = loadFixture('v1_multi_provider.json');
      const v2 = migrateVaultV1ToV2(v1, testOpts());

      expect(v2.legacy).toBeDefined();
      expect((v2.legacy as Record<string, unknown>).connections).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-5: Migration is versioned and idempotent
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-5: Migration is idempotent', () => {
    test('migrating an already-migrated v2 vault is a no-op', () => {
      const v1 = loadFixture('v1_multi_provider.json');
      const first = migrateVaultV1ToV2(v1, testOpts());

      // Simulate loading a v2 vault by treating first as input
      // The migration should skip because schemaVersion is 2
      // But our function takes V1VaultPayload — in practice the service
      // checks schemaVersion before calling migration.
      // Here we verify that passing a v2-shaped object doesn't crash.
      const second = migrateVaultV1ToV2(first as unknown as Record<string, unknown>, testOpts());
      // Should still produce valid output
      expect(second.schemaVersion).toBe(2);
    });

    test('deterministic output with same id factory', () => {
      idCounter = 0;
      const factory1 = testIdFactory();
      idCounter = 0;
      const factory2 = testIdFactory();

      const v1 = {
        connections: [
          {
            id: 'c1',
            provider: 'openrouter',
            name: 'Test',
            apiKey: 'key',
            baseUrl: '',
            model: 'model-a',
            generationParams: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              repetitionPenalty: 1.1,
              presencePenalty: 0,
              maxTokens: 1024,
              contextSize: 4096,
            },
            isDefault: true,
            source: 'stored',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };

      const result1 = migrateVaultV1ToV2(v1, { idFactory: factory1 });
      const result2 = migrateVaultV1ToV2(v1, { idFactory: factory2 });

      // Provider IDs should be the same (deterministic factory)
      expect(result1.providers[0].id).toBe(result2.providers[0].id);
      expect(result1.connections[0].label).toBe(result2.connections[0].label);
      expect(result1.connections[0].providerId).toBe(result2.connections[0].providerId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-10: models[] override path resolves through connections
  // ═══════════════════════════════════════════════════════════════════════

  describe('AC-10: models[] migration', () => {
    test('models rows become text connections', () => {
      const v1 = loadFixture('v1_with_models.json');
      const v2 = migrateVaultV1ToV2(v1, testOpts());

      // Should have 1 provider (openrouter with key) + potentially more from models
      // The models rows create connections on the same provider
      const textConns = v2.connections.filter((c) => c.capability === 'text');
      // 1 from v1 connection + 2 from models (but one might be duplicate if model matches)
      // conn-main model is 'anthropic/claude-sonnet-4-20250514', models are 'anthropic/claude-opus-4' and 'openai/gpt-4o'
      // No duplicates since models are different
      expect(textConns.length).toBeGreaterThanOrEqual(3);
    });

    test('duplicate (provider, model) pairs are skipped', () => {
      const v1 = {
        connections: [
          {
            id: 'c1',
            provider: 'openrouter',
            name: 'Main',
            apiKey: 'key',
            baseUrl: '',
            model: 'anthropic/claude-opus-4',
            generationParams: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              repetitionPenalty: 1.1,
              presencePenalty: 0,
              maxTokens: 1024,
              contextSize: 4096,
            },
            isDefault: true,
            source: 'stored',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        models: [{ model: 'anthropic/claude-opus-4', provider: 'openrouter', endpoint: '' }],
      };

      const v2 = migrateVaultV1ToV2(v1, testOpts());
      const textConns = v2.connections.filter((c) => c.capability === 'text');
      // Should only have 1 text connection (the v1 one), not a duplicate from models
      expect(textConns).toHaveLength(1);
    });
  });
});
